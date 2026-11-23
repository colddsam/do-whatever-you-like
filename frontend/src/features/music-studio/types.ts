/**
 * The music studio's project model. Arrangement positions and lengths are in beats (quarter notes);
 * audio offsets and fades are in seconds of the source file. A project is plain JSON (saved in
 * IndexedDB); recorded and imported audio lives beside it as Blobs keyed by asset id.
 */

export type TrackKind = "audio" | "instrument" | "drums";

export type Note = {
  id: string;
  /** MIDI note number (60 = middle C). On drum tracks it picks the drum (36 kick, 38 snare…). */
  pitch: number;
  /** Beats from the clip's start. */
  start: number;
  length: number;
  /** 0..1 */
  velocity: number;
};

export type Clip = {
  id: string;
  trackId: string;
  name: string;
  /** Beats from the song's start. */
  start: number;
  length: number;
  muted?: boolean;
  // Audio clips
  assetId?: string;
  /** Seconds into the asset where the clip starts playing. */
  offset?: number;
  /** Linear gain, 1 = unchanged. */
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  // Instrument and drum clips
  notes?: Note[];
  /** Drum swing, 0..0.5 of a 16th. */
  swing?: number;
};

export type EffectType =
  | "eq"
  | "compressor"
  | "reverb"
  | "delay"
  | "chorus"
  | "phaser"
  | "distortion"
  | "filter"
  | "tremolo"
  | "autopan"
  | "bitcrush"
  | "width"
  | "ringmod"
  | "limiter";

export type Effect = { id: string; type: EffectType; on: boolean; params: Record<string, number> };

export type AutoPoint = { beat: number; value: number };

/** Per-track tweaks applied over the instrument preset. 0 means "use the preset's value". */
export type InstrumentTweaks = { attack: number; release: number; cutoff: number; resonance: number; octave: number; glide: number };

export type Track = {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  /** Linear gain, 0..1.5 (1 = 0 dB). */
  volume: number;
  /** -1..1 */
  pan: number;
  mute: boolean;
  solo: boolean;
  armed: boolean;
  /** Instrument preset or drum kit id (constants.ts INSTRUMENTS / KITS). Unused on audio tracks. */
  instrument: string;
  tweaks?: Partial<InstrumentTweaks>;
  /** The sampler instrument plays this asset chromatically (root = C4). */
  sampleAssetId?: string;
  fx: Effect[];
  /** Lower this track while another (usually a voice) track has sound: podcast-style ducking. */
  duck?: { source: string; amount: number } | null;
  /** Volume automation (linear gain multipliers, 0..1.5). Empty = off. */
  automation?: AutoPoint[];
};

export type AssetMeta = {
  id: string;
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  size: number;
  createdAt: number;
};

export type ScaleId = "major" | "minor" | "dorian" | "mixolydian" | "pentatonic" | "minorPentatonic" | "blues" | "harmonicMinor" | "chromatic";

export type Marker = { id: string; beat: number; name: string };

export type Project = {
  version: 1;
  id: string;
  name: string;
  bpm: number;
  /** Beats per bar. */
  sig: number;
  keyRoot: number;
  scale: ScaleId;
  tracks: Track[];
  clips: Record<string, Clip>;
  assets: Record<string, AssetMeta>;
  /** `lufs`: loudness the export normalises to (null = leave as mixed). */
  master: { volume: number; fx: Effect[]; lufs?: number | null };
  loop: { on: boolean; start: number; end: number };
  markers: Marker[];
  /** The lyric sheet (free text), shown in the Lyrics panel. */
  lyrics?: string;
  createdAt: number;
  updatedAt: number;
};

/** What the AI composer (or the built-in one) decides; composer.ts turns it into tracks and notes. */
export type SongSection = { name: string; bars: number; chords: string[]; energy: number; lyrics: string[] };
export type SongPlan = {
  title: string;
  genre: string;
  mood: string;
  bpm: number;
  key: string;
  mode: "major" | "minor";
  vocal: "sung" | "rap" | "none";
  instruments: { drums: string; bass: string; chords: string; lead: string; pad: string | null };
  sections: SongSection[];
  engine?: string;
};

export type Pcm = { sampleRate: number; channels: Float32Array[] };
