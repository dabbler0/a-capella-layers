import { VoiceLayer } from './types.js';
import { scheduleMetronome, loopDuration, uid } from './audio-utils.js';
import { Player } from './player.js';

export type RecorderState = 'idle' | 'countdown' | 'recording';

export class Recorder {
  private ctx: AudioContext;
  private player: Player;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;

  state: RecorderState = 'idle';

  constructor(ctx: AudioContext, player: Player) {
    this.ctx = ctx;
    this.player = player;
  }

  /**
   * Begin the recording sequence:
   *   1. Request microphone access
   *   2. Run a visual countdown (countdownSeconds bars of the metronome)
   *   3. Start recording + play back existing layers
   *   4. After loopDuration, stop and call onComplete with the new VoiceLayer
   */
  async start(
    layers: VoiceLayer[],
    tempo: number,
    bars: number,
    beatsPerBar: number,
    layerName: string,
    onCountdown: (secondsLeft: number) => void,
    onRecordingStart: () => void,
    onComplete: (layer: VoiceLayer) => void,
    onError: (msg: string) => void,
  ): Promise<void> {
    if (this.state !== 'idle') return;

    // Request mic
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      onError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    this.state = 'countdown';
    const countdownBeats = beatsPerBar; // one bar countdown
    const spb = 60 / tempo;
    const countdownDuration = countdownBeats * spb;
    const loopLen = loopDuration(tempo, bars, beatsPerBar);

    // Schedule the countdown metronome and the full recording metronome
    const countdownStart = this.ctx.currentTime + 0.05;
    scheduleMetronome(
      this.ctx,
      countdownStart,
      tempo,
      /* countdown bar */ 1,
      beatsPerBar,
    );

    const recordingStart = countdownStart + countdownDuration;

    // Visual countdown
    let remaining = Math.ceil(countdownDuration);
    onCountdown(remaining);
    const tick = () => {
      remaining -= 1;
      if (remaining > 0) {
        onCountdown(remaining);
        this.countdownTimer = setTimeout(tick, 1000);
      }
    };
    this.countdownTimer = setTimeout(tick, 1000);

    // Start MediaRecorder now so it captures the pre-roll silence; we'll
    // note the offset so callers can trim if desired (default offsetMs = 0,
    // user adjusts manually).
    const mr = new MediaRecorder(this.stream, { mimeType: this.pickMimeType() });
    this.mediaRecorder = mr;
    this.chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    mr.start();

    // When recording window opens: play existing layers + full metronome
    const msUntilRecord = (recordingStart - this.ctx.currentTime) * 1000;
    this.countdownTimer = setTimeout(() => {
      this.state = 'recording';
      onRecordingStart();
      scheduleMetronome(this.ctx, recordingStart, tempo, bars, beatsPerBar);
      this.player.playForRecording(layers, recordingStart);

      // Stop after loop completes
      this.recordingTimer = setTimeout(() => {
        this.finishRecording(loopLen, layerName, onComplete, onError);
      }, loopLen * 1000 + 100);
    }, msUntilRecord);
  }

  private async finishRecording(
    loopLen: number,
    layerName: string,
    onComplete: (layer: VoiceLayer) => void,
    onError: (msg: string) => void,
  ): Promise<void> {
    if (!this.mediaRecorder) return;

    this.mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(this.chunks, { type: this.chunks[0]?.type ?? 'audio/webm' });
        const arrayBuf = await blob.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuf);
        const layer: VoiceLayer = {
          id: uid(),
          name: layerName,
          audioBuffer,
          offsetMs: 0,
          volume: 1.0,
          muted: false,
        };
        onComplete(layer);
      } catch (e) {
        onError(`Failed to decode recording: ${e}`);
      } finally {
        this.cleanup();
      }
    };

    this.mediaRecorder.stop();
    this.player.stop();
  }

  abort(): void {
    if (this.countdownTimer) { clearTimeout(this.countdownTimer); this.countdownTimer = null; }
    if (this.recordingTimer) { clearTimeout(this.recordingTimer); this.recordingTimer = null; }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    }
    this.player.stop();
    this.cleanup();
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.state = 'idle';
  }

  private pickMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }
}
