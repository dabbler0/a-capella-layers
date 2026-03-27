import { VoiceLayer } from './types.js';
import { loopDuration } from './audio-utils.js';

interface ActiveSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class Player {
  private ctx: AudioContext;
  private activeSources: ActiveSource[] = [];
  private activeOscillators: OscillatorNode[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private onStopCallback: (() => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Schedule a metronome grid and track the oscillator nodes so they can be
   * cancelled immediately if stop() is called before they self-terminate.
   */
  scheduleMetronome(
    startTime: number,
    tempo: number,
    bars: number,
    beatsPerBar: number,
  ): void {
    const spb = 60 / tempo;
    const total = bars * beatsPerBar;
    for (let i = 0; i < total; i++) {
      const clickTime = startTime + i * spb;
      const isDownbeat = i % beatsPerBar === 0;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.connect(env);
      env.connect(this.ctx.destination);
      osc.frequency.value = isDownbeat ? 1200 : 880;
      env.gain.setValueAtTime(0.7, clickTime);
      env.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.06);
      osc.start(clickTime);
      osc.stop(clickTime + 0.08);
      this.activeOscillators.push(osc);
    }
  }

  /**
   * Play all active (non-muted) layers plus the metronome click track.
   * @returns the AudioContext time at which playback begins.
   */
  play(
    layers: VoiceLayer[],
    tempo: number,
    bars: number,
    beatsPerBar: number,
    includeMetronome: boolean,
    onStop: () => void,
  ): number {
    this.stop();
    this.onStopCallback = onStop;

    const startTime = this.ctx.currentTime + 0.05;
    const duration = loopDuration(tempo, bars, beatsPerBar);

    if (includeMetronome) {
      this.scheduleMetronome(startTime, tempo, bars, beatsPerBar);
    }

    for (const layer of layers) {
      if (layer.muted) continue;
      this.startLayer(layer, startTime);
    }

    this.stopTimer = setTimeout(() => {
      this.stop();
    }, (duration + 0.2) * 1000);

    return startTime;
  }

  /**
   * Schedule existing layers to play starting at scheduledStart.
   * Called by the recorder while MediaRecorder is already running.
   */
  playForRecording(layers: VoiceLayer[], scheduledStart: number): void {
    for (const layer of layers) {
      if (layer.muted) continue;
      this.startLayer(layer, scheduledStart);
    }
  }

  stop(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    for (const osc of this.activeOscillators) {
      try { osc.stop(); } catch { /* already self-stopped */ }
    }
    this.activeOscillators = [];
    for (const { source } of this.activeSources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.activeSources = [];
    if (this.onStopCallback) {
      const cb = this.onStopCallback;
      this.onStopCallback = null;
      cb();
    }
  }

  isPlaying(): boolean {
    return this.activeSources.length > 0;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private startLayer(layer: VoiceLayer, scheduledStart: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = layer.audioBuffer;

    const gain = this.ctx.createGain();
    gain.gain.value = layer.volume;
    source.connect(gain);
    gain.connect(this.ctx.destination);

    const layerStart = scheduledStart + layer.offsetMs / 1000;
    const now = this.ctx.currentTime;

    if (layerStart >= now) {
      // Future or right-now: schedule at exact beat position
      source.start(layerStart);
    } else {
      // scheduledStart is already in the past (timer fired slightly late);
      // start immediately, trimming the audio to where it would be.
      const elapsed = now - layerStart;
      if (elapsed < layer.audioBuffer.duration) {
        source.start(now, elapsed);
      } else {
        return; // audio would have already finished entirely
      }
    }

    this.activeSources.push({ source, gain });
  }
}
