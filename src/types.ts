export interface VoiceLayer {
  id: string;
  name: string;
  audioBuffer: AudioBuffer;
  offsetMs: number;   // positive = starts later, negative = starts earlier
  volume: number;     // 0.0 – 1.0
  muted: boolean;
}

// Serialisable form stored in a project file
export interface ProjectLayer {
  id: string;
  name: string;
  audioData: string;  // base64-encoded PCM-16 WAV
  offsetMs: number;
  volume: number;
  muted: boolean;
}

export interface Project {
  version: '1.0';
  tempo: number;        // BPM
  bars: number;         // loop length in bars
  beatsPerBar: number;  // time signature numerator
  layers: ProjectLayer[];
}

export type AppState =
  | 'idle'
  | 'countdown'    // pre-roll before recording
  | 'recording'    // mic is live
  | 'playing';     // playback only
