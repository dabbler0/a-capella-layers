import './style.css';
import { App, AppSnapshot } from './app.js';
import { loopDuration } from './audio-utils.js';

const app = new App();
app.onChange(render);

// ── DOM helpers ───────────────────────────────────────────────────────────────

function $<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Element not found: ${sel}`);
  return el;
}

// ── Audio device enumeration ──────────────────────────────────────────────────

async function populateAudioDevices(): Promise<void> {
  const wrapper = $<HTMLDivElement>('#audio-device-wrapper');
  const select = $<HTMLSelectElement>('#audio-input-device');
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    if (inputs.length <= 1) { wrapper.style.display = 'none'; return; }

    const prev = select.value;
    select.innerHTML = '<option value="">Default</option>';
    inputs.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${i + 1}`;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === prev)) select.value = prev;
    wrapper.style.display = '';
  } catch {
    wrapper.style.display = 'none';
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(snap: AppSnapshot): void {
  const idle = snap.state === 'idle';

  // ── Loop info label ────
  const dur = loopDuration(snap.tempo, snap.bars, snap.beatsPerBar);
  $('#loop-info').textContent = `≈ ${dur.toFixed(1)} s`;

  // ── Transport buttons ────
  const recBtn = $<HTMLButtonElement>('#btn-record');
  const playBtn = $<HTMLButtonElement>('#btn-play');
  const stopBtn = $<HTMLButtonElement>('#btn-stop');

  recBtn.disabled = !idle;
  playBtn.disabled = !idle;
  stopBtn.disabled = idle;

  recBtn.classList.toggle('recording', snap.state === 'recording');
  if (snap.state === 'idle')       recBtn.textContent = '⏺ Record New Layer';
  else if (snap.state === 'countdown') recBtn.textContent = `⏺ Starting in ${snap.countdownLabel}…`;
  else if (snap.state === 'recording') recBtn.textContent = '⏺ Recording…';
  else                                 recBtn.textContent = '⏺ Record New Layer';

  // ── Recording progress bar ────
  const progress = $<HTMLDivElement>('#recording-progress');
  const progressFill = $<HTMLDivElement>('#recording-progress-fill');
  progress.style.display = snap.state === 'recording' ? 'block' : 'none';
  progressFill.style.width = `${snap.recordingProgress * 100}%`;

  // ── Metronome settings (disabled while busy) ────
  $<HTMLInputElement>('#tempo').value = String(snap.tempo);
  $<HTMLInputElement>('#bars').value = String(snap.bars);
  $<HTMLSelectElement>('#beats-per-bar').value = String(snap.beatsPerBar);
  $<HTMLInputElement>('#tempo').disabled = !idle;
  $<HTMLInputElement>('#bars').disabled = !idle;
  $<HTMLSelectElement>('#beats-per-bar').disabled = !idle;

  // ── Layer name input ────
  const nameInput = $<HTMLInputElement>('#layer-name');
  if (document.activeElement !== nameInput) nameInput.value = snap.nextLayerName;
  nameInput.disabled = !idle;

  // ── Layer list ────
  renderLayerList(snap);

  // ── Export / save buttons ────
  $<HTMLButtonElement>('#btn-export-wav').disabled = snap.layers.length === 0;
  $<HTMLButtonElement>('#btn-save').disabled = snap.layers.length === 0;
}

// ── Layer list ────────────────────────────────────────────────────────────────

function renderLayerList(snap: AppSnapshot): void {
  const list = $<HTMLDivElement>('#layer-list');
  const empty = $<HTMLDivElement>('#layer-empty');

  if (snap.layers.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Remove rows for deleted layers
  const snapIds = new Set(snap.layers.map((l) => l.id));
  list
    .querySelectorAll<HTMLDivElement>('.layer-row')
    .forEach((el) => { if (!snapIds.has(el.dataset.id!)) el.remove(); });

  // Add / update rows in order
  snap.layers.forEach((layer, idx) => {
    let row = list.querySelector<HTMLDivElement>(`[data-id="${layer.id}"]`);
    if (!row) {
      row = buildLayerRow(layer.id);
    }
    updateLayerRow(row, layer, idx, snap.layers.length, snap.state === 'idle');

    // Ensure correct DOM order
    const rows = Array.from(list.children);
    if (rows[idx] !== row) list.appendChild(row);
  });
}

function buildLayerRow(id: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'layer-row';
  row.dataset.id = id;
  row.innerHTML = `
    <div class="layer-header">
      <span class="layer-drag-handle">☰</span>
      <input class="layer-name-input" type="text" placeholder="Layer name" />
      <button class="btn-icon btn-mute" title="Mute/unmute">🔊</button>
      <button class="btn-icon btn-up" title="Move up">▲</button>
      <button class="btn-icon btn-down" title="Move down">▼</button>
      <button class="btn-icon btn-delete" title="Delete layer">✕</button>
    </div>
    <div class="layer-controls">
      <label>
        <span>Volume</span>
        <input class="layer-volume" type="range" min="0" max="1" step="0.01" />
        <span class="layer-volume-value">100%</span>
      </label>
      <label>
        <span>Offset</span>
        <input class="layer-offset" type="number" step="10" />
        <span class="layer-offset-unit">ms</span>
      </label>
    </div>
  `;

  const nameInput = row.querySelector<HTMLInputElement>('.layer-name-input')!;
  const volumeSlider = row.querySelector<HTMLInputElement>('.layer-volume')!;
  const offsetInput = row.querySelector<HTMLInputElement>('.layer-offset')!;

  nameInput.addEventListener('change', () => app.updateLayer(id, { name: nameInput.value }));

  volumeSlider.addEventListener('input', () => {
    app.updateLayer(id, { volume: parseFloat(volumeSlider.value) });
  });

  offsetInput.addEventListener('change', () => {
    app.updateLayer(id, { offsetMs: parseInt(offsetInput.value, 10) || 0 });
  });

  row.querySelector('.btn-mute')!.addEventListener('click', () => {
    const layer = app.snapshot().layers.find((l) => l.id === id);
    if (layer) app.updateLayer(id, { muted: !layer.muted });
  });

  row.querySelector('.btn-up')!.addEventListener('click', () => app.moveLayer(id, 'up'));
  row.querySelector('.btn-down')!.addEventListener('click', () => app.moveLayer(id, 'down'));
  row.querySelector('.btn-delete')!.addEventListener('click', () => {
    if (confirm('Delete this layer?')) app.removeLayer(id);
  });

  return row;
}

function updateLayerRow(
  row: HTMLDivElement,
  layer: AppSnapshot['layers'][number],
  idx: number,
  total: number,
  isIdle: boolean,
): void {
  row.classList.toggle('muted', layer.muted);

  const nameInput = row.querySelector<HTMLInputElement>('.layer-name-input')!;
  if (document.activeElement !== nameInput) nameInput.value = layer.name;
  nameInput.disabled = !isIdle;

  const volumeSlider = row.querySelector<HTMLInputElement>('.layer-volume')!;
  if (document.activeElement !== volumeSlider) volumeSlider.value = String(layer.volume);
  row.querySelector<HTMLSpanElement>('.layer-volume-value')!.textContent =
    `${Math.round(layer.volume * 100)}%`;

  const offsetInput = row.querySelector<HTMLInputElement>('.layer-offset')!;
  if (document.activeElement !== offsetInput) offsetInput.value = String(layer.offsetMs);
  offsetInput.disabled = !isIdle;

  const muteBtn = row.querySelector<HTMLButtonElement>('.btn-mute')!;
  muteBtn.textContent = layer.muted ? '🔇' : '🔊';
  muteBtn.title = layer.muted ? 'Unmute' : 'Mute';

  row.querySelector<HTMLButtonElement>('.btn-up')!.disabled = !isIdle || idx === 0;
  row.querySelector<HTMLButtonElement>('.btn-down')!.disabled = !isIdle || idx === total - 1;
  row.querySelector<HTMLButtonElement>('.btn-delete')!.disabled = !isIdle;
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  populateAudioDevices();
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', populateAudioDevices);
  }

  $<HTMLSelectElement>('#audio-input-device').addEventListener('change', (e) => {
    app.audioDeviceId = (e.target as HTMLSelectElement).value;
  });

  $<HTMLButtonElement>('#btn-record').addEventListener('click', () => {
    app.nextLayerName = $<HTMLInputElement>('#layer-name').value.trim() || app.nextLayerName;
    app.startRecording();
  });

  $<HTMLButtonElement>('#btn-play').addEventListener('click', () => {
    const withMetronome = $<HTMLInputElement>('#playback-metronome').checked;
    app.playAll(withMetronome);
  });
  $<HTMLButtonElement>('#btn-stop').addEventListener('click', () => app.stopAll());

  $<HTMLInputElement>('#tempo').addEventListener('input', (e) => {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (v >= 20 && v <= 300) { app.tempo = v; render(app.snapshot()); }
  });

  $<HTMLInputElement>('#bars').addEventListener('input', (e) => {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (v >= 1 && v <= 64) { app.bars = v; render(app.snapshot()); }
  });

  $<HTMLSelectElement>('#beats-per-bar').addEventListener('change', (e) => {
    app.beatsPerBar = parseInt((e.target as HTMLSelectElement).value, 10);
    render(app.snapshot());
  });

  $<HTMLInputElement>('#layer-name').addEventListener('input', (e) => {
    app.nextLayerName = (e.target as HTMLInputElement).value;
  });

  $<HTMLButtonElement>('#btn-save').addEventListener('click', () => app.saveProject());
  $<HTMLButtonElement>('#btn-load').addEventListener('click', () => app.loadProject());

  $<HTMLButtonElement>('#btn-export-wav').addEventListener('click', () => {
    const includeMet = $<HTMLInputElement>('#export-metronome').checked;
    app.exportWav(includeMet);
  });

  // Initial render
  render(app.snapshot());
});
