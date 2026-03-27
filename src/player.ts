import { VoiceLayer } from './types.js';
import { scheduleMetronome, loopDuration } from './audio-utils.js';

interface ActiveSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class Player {
  private ctx: AudioContext;
  private activeSources: ActiveSource[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private onStopCallback: (() => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
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
      scheduleMetronome(this.ctx, startTime, tempo, bars, beatsPerBar);
    }

    for (const layer of layers) {
      if (layer.muted) continue;

      const source = this.ctx.createBufferSource();
      source.buffer = layer.audioBuffer;

      const gain = this.ctx.createGain();
      gain.gain.value = layer.volume;
      source.connect(gain);
      gain.connect(this.ctx.destination);

      const layerStart = startTime + layer.offsetMs / 1000;
      if (layerStart >= this.ctx.currentTime) {
        source.start(layerStart);
      } else {
        // Offset is so negative the layer should have already started; trim it
        const trim = this.ctx.currentTime - layerStart;
        if (trim < layer.audioBuffer.duration) {
          source.start(this.ctx.currentTime, trim);
        }
      }

      this.activeSources.push({ source, gain });
    }

    this.stopTimer = setTimeout(() => {
      this.stop();
    }, (duration + 0.2) * 1000);

    return startTime;
  }

  /**
   * Play layers for use during recording (no metronome included here;
   * the recorder schedules the metronome separately so it can start
   * exactly in sync with the recording clock).
   */
  playForRecording(
    layers: VoiceLayer[],
    startTime: number,
  ): void {
    for (const layer of layers) {
      if (layer.muted) continue;

      const source = this.ctx.createBufferSource();
      source.buffer = layer.audioBuffer;

      const gain = this.ctx.createGain();
      gain.gain.value = layer.volume;
      source.connect(gain);
      gain.connect(this.ctx.destination);

      const layerStart = startTime + layer.offsetMs / 1000;
      if (layerStart >= this.ctx.currentTime) {
        source.start(layerStart);
      }

      this.activeSources.push({ source, gain });
    }
  }

  stop(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
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
}
