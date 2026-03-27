import { VoiceLayer } from './types.js';
import { loopDuration, uid, trimAudioBuffer } from './audio-utils.js';
import { Player } from './player.js';

export type RecorderState = 'idle' | 'countdown' | 'recording';

export class Recorder {
  private ctx: AudioContext;
  private player: Player;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  // All pending timers collected here so abort() can cancel every one of them
  private timers: ReturnType<typeof setTimeout>[] = [];

  state: RecorderState = 'idle';

  constructor(ctx: AudioContext, player: Player) {
    this.ctx = ctx;
    this.player = player;
  }

  /**
   * Begin the recording sequence:
   *   1. Request microphone access
   *   2. Play a one-bar metronome countdown (visual label updates each beat)
   *   3. At the exact scheduled start: play existing layers + full metronome
   *   4. After loopDuration, stop and call onComplete with the new VoiceLayer
   */
  async start(
    layers: VoiceLayer[],
    tempo: number,
    bars: number,
    beatsPerBar: number,
    layerName: string,
    onCountdown: (beatsLeft: number) => void,
    onRecordingStart: () => void,
    onComplete: (layer: VoiceLayer) => void,
    onError: (msg: string) => void,
  ): Promise<void> {
    if (this.state !== 'idle') return;

    // Request mic
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch {
      onError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    this.state = 'countdown';

    const spb = 60 / tempo;                         // seconds per beat
    const countdownBeats = beatsPerBar;              // one bar of countdown
    const countdownDuration = countdownBeats * spb;  // seconds
    const loopLen = loopDuration(tempo, bars, beatsPerBar);

    // Anchor everything to a fixed AudioContext time so visual and audio are in sync
    const countdownStart = this.ctx.currentTime + 0.1;
    const recordingStart = countdownStart + countdownDuration;

    // Schedule countdown metronome (tracked so stop() can cancel it)
    this.player.scheduleMetronome(countdownStart, tempo, 1, beatsPerBar);

    // Start MediaRecorder now — it captures the pre-roll silence too.
    // We snapshot ctx.currentTime immediately before mr.start() so we know
    // exactly how many seconds of pre-roll to strip from the decoded buffer.
    const mr = new MediaRecorder(this.stream, { mimeType: this.pickMimeType() });
    this.mediaRecorder = mr;
    this.chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    const mrStartCtxTime = this.ctx.currentTime;  // snapshot before start()
    mr.start();
    // Pre-roll = gap between MediaRecorder start and the actual recording window
    const preRoll = recordingStart - mrStartCtxTime;

    // Visual beat countdown — schedule one timeout per beat
    for (let beat = 0; beat < countdownBeats; beat++) {
      const msFromNow = (countdownStart - this.ctx.currentTime + beat * spb) * 1000;
      const beatsLeft = countdownBeats - beat;
      this.addTimer(setTimeout(() => onCountdown(beatsLeft), msFromNow));
    }

    // At recordingStart: kick off layer playback + full metronome
    const msUntilRecording = (recordingStart - this.ctx.currentTime) * 1000;
    this.addTimer(setTimeout(() => {
      this.state = 'recording';
      onRecordingStart();

      // Schedule full loop metronome (tracked)
      this.player.scheduleMetronome(recordingStart, tempo, bars, beatsPerBar);
      // Play existing layers in sync with the recording window
      this.player.playForRecording(layers, recordingStart);

      // Stop recording after one full loop
      this.addTimer(setTimeout(() => {
        this.finishRecording(preRoll, layerName, onComplete, onError);
      }, loopLen * 1000 + 150));
    }, msUntilRecording));
  }

  private async finishRecording(
    preRoll: number,
    layerName: string,
    onComplete: (layer: VoiceLayer) => void,
    onError: (msg: string) => void,
  ): Promise<void> {
    if (!this.mediaRecorder) return;

    this.mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(this.chunks, { type: this.chunks[0]?.type ?? 'audio/webm' });
        const arrayBuf = await blob.arrayBuffer();
        const raw = await this.ctx.decodeAudioData(arrayBuf);
        // Strip the countdown pre-roll so the buffer starts at beat 1 of the loop
        const audioBuffer = trimAudioBuffer(raw, preRoll);
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
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
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
    this.timers = [];
    this.state = 'idle';
  }

  private addTimer(t: ReturnType<typeof setTimeout>): void {
    this.timers.push(t);
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
