import { VoiceLayer, ProjectLayer, Project } from './types.js';
import { audioBufferToWav, arrayBufferToBase64, base64ToArrayBuffer, loopDuration, scheduleMetronome } from './audio-utils.js';

// ── Serialisation ────────────────────────────────────────────────────────────

export async function layerToProjectLayer(layer: VoiceLayer): Promise<ProjectLayer> {
  const wav = audioBufferToWav(layer.audioBuffer);
  return {
    id: layer.id,
    name: layer.name,
    audioData: arrayBufferToBase64(wav),
    offsetMs: layer.offsetMs,
    volume: layer.volume,
    muted: layer.muted,
  };
}

export async function projectLayerToLayer(
  pl: ProjectLayer,
  ctx: AudioContext,
): Promise<VoiceLayer> {
  const arrayBuf = base64ToArrayBuffer(pl.audioData);
  const audioBuffer = await ctx.decodeAudioData(arrayBuf);
  return {
    id: pl.id,
    name: pl.name,
    audioBuffer,
    offsetMs: pl.offsetMs,
    volume: pl.volume,
    muted: pl.muted,
  };
}

// ── Save / Load ──────────────────────────────────────────────────────────────

export async function saveProject(
  layers: VoiceLayer[],
  tempo: number,
  bars: number,
  beatsPerBar: number,
): Promise<void> {
  const projectLayers = await Promise.all(layers.map(layerToProjectLayer));
  const project: Project = {
    version: '1.0',
    tempo,
    bars,
    beatsPerBar,
    layers: projectLayers,
  };
  const json = JSON.stringify(project, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'project.acap');
}

export async function loadProject(
  ctx: AudioContext,
): Promise<{ layers: VoiceLayer[]; tempo: number; bars: number; beatsPerBar: number } | null> {
  const file = await pickFile('.acap,application/json');
  if (!file) return null;

  const text = await file.text();
  const project: Project = JSON.parse(text);

  if (project.version !== '1.0') {
    alert(`Unknown project version: ${project.version}`);
    return null;
  }

  const layers = await Promise.all(project.layers.map((pl) => projectLayerToLayer(pl, ctx)));
  return { layers, tempo: project.tempo, bars: project.bars, beatsPerBar: project.beatsPerBar };
}

// ── WAV Export ───────────────────────────────────────────────────────────────

export async function exportWav(
  layers: VoiceLayer[],
  tempo: number,
  bars: number,
  beatsPerBar: number,
  includeMetronome: boolean,
): Promise<void> {
  const activeLayers = layers.filter((l) => !l.muted);
  const loopLen = loopDuration(tempo, bars, beatsPerBar);

  // Compute total render duration
  let totalDuration = loopLen;
  for (const l of activeLayers) {
    const end = l.offsetMs / 1000 + l.audioBuffer.duration;
    if (end > totalDuration) totalDuration = end;
  }
  // Add a small tail
  totalDuration += 0.5;

  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

  if (includeMetronome) {
    scheduleMetronome(offlineCtx, 0, tempo, bars, beatsPerBar);
  }

  for (const layer of activeLayers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = layer.audioBuffer;

    const gain = offlineCtx.createGain();
    gain.gain.value = layer.volume;
    source.connect(gain);
    gain.connect(offlineCtx.destination);

    const startAt = Math.max(0, layer.offsetMs / 1000);
    const trimFrom = startAt === 0 && layer.offsetMs < 0 ? -layer.offsetMs / 1000 : 0;
    source.start(startAt, trimFrom);
  }

  const rendered = await offlineCtx.startRendering();
  const wav = audioBufferToWav(rendered);
  downloadBlob(new Blob([wav], { type: 'audio/wav' }), 'export.wav');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
