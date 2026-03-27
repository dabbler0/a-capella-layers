# A Capella Layers — Developer Notes

## What this is

A client-side-only TypeScript/Vite web app for recording and playing back
layered a capella vocals in the browser.  No server, no build artifacts
committed — just run `npm run dev` and open the browser.

## Quick start

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # outputs to dist/
```

## Source layout

```
src/
  types.ts         – Shared data types (VoiceLayer, Project, AppState, …)
  audio-utils.ts   – WAV encoding, base64 helpers, metronome scheduling
  metronome.ts     – (reserved; metronome logic lives in audio-utils for now)
  player.ts        – Player class: schedule layer playback via AudioContext
  recorder.ts      – Recorder class: countdown → MediaRecorder + playback
  project-io.ts    – Save/load .acap projects and export WAV via OfflineAudioContext
  app.ts           – App class: central state machine, wires player + recorder
  main.ts          – DOM rendering, event wiring, entry point
  style.css        – Dark-theme UI (no external CSS deps)
index.html         – Single page; loads src/main.ts as ESM module via Vite
```

## Project file format (.acap)

JSON with schema:

```json
{
  "version": "1.0",
  "tempo": 120,
  "bars": 4,
  "beatsPerBar": 4,
  "layers": [
    {
      "id": "abc123",
      "name": "Soprano",
      "audioData": "<base64 PCM-16 WAV>",
      "offsetMs": 0,
      "volume": 1.0,
      "muted": false
    }
  ]
}
```

Audio is stored as base64-encoded 16-bit PCM WAV per layer.  For long takes
this can produce large files; a future improvement would be to use a ZIP
container (e.g. via `fflate`) with separate audio blobs.

## Recording flow

1. User sets tempo, bars, time signature and a layer name.
2. "Record New Layer" is clicked → `App.startRecording()` →
   `Recorder.start()`.
3. Mic is requested via `getUserMedia`.
4. A one-bar metronome countdown plays (visual counter in the button label).
5. At the exact scheduled start time: `MediaRecorder` is already rolling
   (capturing the countdown silence), the full metronome + all existing
   layers are scheduled via `AudioContext`.
6. After `loopDuration` ms, recording stops, the blob is decoded to an
   `AudioBuffer`, and the new `VoiceLayer` is appended to the layer list.
7. The user can then adjust `offsetMs` (±ms) to line up the new layer.

**Timing note**: MediaRecorder cannot be started at a precise AudioContext
time, so there is always a few-ms drift.  The one-bar pre-roll and the
`offsetMs` control are the manual alignment tools.

## WAV export

Uses `OfflineAudioContext` at 44 100 Hz / stereo.  Each active layer is
scheduled as a `AudioBufferSourceNode` with gain = `layer.volume`, starting
at `max(0, offsetMs/1000)`.  Layers with a negative offset are trimmed at
the start.  The total render length = `max(offset + layer.duration)` + 0.5 s
tail.

## Known limitations / future work

- **File size**: base64 WAV in JSON grows fast.  Consider ZIP + Opus.
- **Drift**: small (< 20 ms) MediaRecorder start drift.  Could add an
  auto-correlate alignment tool.
- **No waveform visualisation**: adding a canvas waveform per layer would
  help alignment.  Use `AnalyserNode` or pre-render with `OfflineAudioContext`.
- **No undo**: deleting layers is irreversible in-session.
- **Mobile**: `getUserMedia` on iOS Safari requires a user gesture and HTTPS.
- **Negative offsets in export**: layers with `offsetMs < 0` are currently
  trimmed to start at t=0.  A full implementation would shift the entire
  timeline so the earliest event is at t=0.
- **Looping during playback**: playback currently plays each layer once.
  Adding a loop mode would be useful for practice.

## Dependencies

Runtime: none (pure Web APIs).
Dev: `vite`, `typescript`.
