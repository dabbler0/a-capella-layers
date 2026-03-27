/** Encode an AudioBuffer to a 16-bit PCM WAV ArrayBuffer. */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * blockAlign;

  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const write = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);           // subchunk1 size
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return ab;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  // Process in chunks to avoid call-stack overflow on large buffers
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buf;
}

/** Synthesise a single metronome click and schedule it at `time`. */
export function scheduleClick(
  ctx: AudioContext | OfflineAudioContext,
  time: number,
  isDownbeat: boolean,
  destination: AudioNode = ctx.destination,
): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.connect(env);
  env.connect(destination);
  osc.frequency.value = isDownbeat ? 1200 : 880;
  env.gain.setValueAtTime(0.7, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  osc.start(time);
  osc.stop(time + 0.08);
}

/** Schedule a full metronome grid starting at `startTime`. */
export function scheduleMetronome(
  ctx: AudioContext | OfflineAudioContext,
  startTime: number,
  tempo: number,
  bars: number,
  beatsPerBar: number,
  destination?: AudioNode,
): void {
  const spb = 60 / tempo; // seconds per beat
  const total = bars * beatsPerBar;
  for (let i = 0; i < total; i++) {
    scheduleClick(ctx, startTime + i * spb, i % beatsPerBar === 0, destination);
  }
}

/** Loop duration in seconds. */
export function loopDuration(tempo: number, bars: number, beatsPerBar: number): number {
  return (bars * beatsPerBar * 60) / tempo;
}

/** Generate a unique id. */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
