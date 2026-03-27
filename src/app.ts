import { VoiceLayer, AppState } from './types.js';
import { loopDuration } from './audio-utils.js';
import { Player } from './player.js';
import { Recorder } from './recorder.js';
import { saveProject, loadProject, exportWav } from './project-io.js';

export interface AppSnapshot {
  state: AppState;
  tempo: number;
  bars: number;
  beatsPerBar: number;
  layers: VoiceLayer[];
  countdownLabel: string;
  recordingProgress: number;  // 0–1 while recording
  nextLayerName: string;
}

type ChangeListener = (snap: AppSnapshot) => void;

export class App {
  // Audio infrastructure
  private ctx: AudioContext;
  private player: Player;
  private recorder: Recorder;

  // Project state
  private layers: VoiceLayer[] = [];
  tempo = 120;
  bars = 4;
  beatsPerBar = 4;

  // UI state
  private state: AppState = 'idle';
  private countdownLabel = '';
  private recordingProgress = 0;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private recordingStart = 0;
  private recordingDuration = 0;
  nextLayerName = 'Voice 1';

  private listeners: ChangeListener[] = [];

  constructor() {
    this.ctx = new AudioContext();
    this.player = new Player(this.ctx);
    this.recorder = new Recorder(this.ctx, this.player);
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  onChange(fn: ChangeListener): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  snapshot(): AppSnapshot {
    return {
      state: this.state,
      tempo: this.tempo,
      bars: this.bars,
      beatsPerBar: this.beatsPerBar,
      layers: [...this.layers],
      countdownLabel: this.countdownLabel,
      recordingProgress: this.recordingProgress,
      nextLayerName: this.nextLayerName,
    };
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  async playAll(): Promise<void> {
    if (this.state !== 'idle') return;
    await this.resumeCtx();
    this.state = 'playing';
    this.notify();
    this.player.play(
      this.layers,
      this.tempo,
      this.bars,
      this.beatsPerBar,
      true,
      () => {
        this.state = 'idle';
        this.notify();
      },
    );
  }

  stopAll(): void {
    this.player.stop();
    this.recorder.abort();
    this.clearProgressTimer();
    this.state = 'idle';
    this.notify();
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  async startRecording(): Promise<void> {
    if (this.state !== 'idle') return;
    await this.resumeCtx();
    this.recordingDuration = loopDuration(this.tempo, this.bars, this.beatsPerBar);

    await this.recorder.start(
      this.layers,
      this.tempo,
      this.bars,
      this.beatsPerBar,
      this.nextLayerName,
      (secsLeft) => {
        this.state = 'countdown';
        this.countdownLabel = secsLeft > 0 ? `${secsLeft}` : 'GO!';
        this.notify();
      },
      () => {
        // Recording has actually started
        this.state = 'recording';
        this.countdownLabel = '';
        this.recordingStart = Date.now();
        this.recordingProgress = 0;
        this.startProgressTimer();
        this.notify();
      },
      (layer) => {
        // Recording finished – add layer
        this.clearProgressTimer();
        this.layers.push(layer);
        this.state = 'idle';
        this.recordingProgress = 0;
        // Suggest next name
        this.nextLayerName = `Voice ${this.layers.length + 1}`;
        this.notify();
      },
      (msg) => {
        this.clearProgressTimer();
        this.state = 'idle';
        alert(msg);
        this.notify();
      },
    );
  }

  // ── Layer management ───────────────────────────────────────────────────────

  updateLayer(id: string, patch: Partial<Pick<VoiceLayer, 'name' | 'offsetMs' | 'volume' | 'muted'>>): void {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    Object.assign(layer, patch);
    this.notify();
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
    this.notify();
  }

  moveLayer(id: string, direction: 'up' | 'down'): void {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= this.layers.length) return;
    [this.layers[idx], this.layers[swapIdx]] = [this.layers[swapIdx], this.layers[idx]];
    this.notify();
  }

  // ── Project I/O ────────────────────────────────────────────────────────────

  async saveProject(): Promise<void> {
    await saveProject(this.layers, this.tempo, this.bars, this.beatsPerBar);
  }

  async loadProject(): Promise<void> {
    await this.resumeCtx();
    const result = await loadProject(this.ctx);
    if (!result) return;
    this.layers = result.layers;
    this.tempo = result.tempo;
    this.bars = result.bars;
    this.beatsPerBar = result.beatsPerBar;
    this.nextLayerName = `Voice ${this.layers.length + 1}`;
    this.notify();
  }

  async exportWav(includeMetronome: boolean): Promise<void> {
    await exportWav(this.layers, this.tempo, this.bars, this.beatsPerBar, includeMetronome);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async resumeCtx(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private startProgressTimer(): void {
    this.progressTimer = setInterval(() => {
      const elapsed = (Date.now() - this.recordingStart) / 1000;
      this.recordingProgress = Math.min(1, elapsed / this.recordingDuration);
      this.notify();
    }, 100);
  }

  private clearProgressTimer(): void {
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }
}
