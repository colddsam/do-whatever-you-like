import type { EffectType, ScaleId } from "./types";

export const STUDIO_PATH = "/tools/music-studio";
export const SAMPLE_RATE = 48_000;
export const PPQ = 480;

/**
 * Track colours: soft tints of the site's tokens (DESIGN.md) plus three muted companions, so a
 * busy arrangement stays readable on the ink band without introducing loud new hues.
 */
export const TRACK_COLORS = ["#EB4A10", "#B7791F", "#2F7D4F", "#6B7FA3", "#A9A496", "#8C6BA3", "#4F8C8C", "#C2410C"];

export const GENRES: { id: string; label: string }[] = [
  { id: "pop", label: "Pop" },
  { id: "hiphop", label: "Hip-hop" },
  { id: "trap", label: "Trap" },
  { id: "lofi", label: "Lo-fi" },
  { id: "house", label: "House" },
  { id: "edm", label: "EDM" },
  { id: "rock", label: "Rock" },
  { id: "cinematic", label: "Cinematic" },
  { id: "ambient", label: "Ambient" },
  { id: "rnb", label: "R&B" },
  { id: "jazz", label: "Jazz" },
  { id: "reggaeton", label: "Reggaeton" },
  { id: "synthwave", label: "Synthwave" },
  { id: "funk", label: "Funk" },
  { id: "piano", label: "Solo piano" },
  { id: "afrobeats", label: "Afrobeats" },
  { id: "folk", label: "Folk" },
  { id: "bollywood", label: "Bollywood" },
];

export const MOODS = ["Happy", "Sad", "Chill", "Energetic", "Romantic", "Dark", "Epic", "Dreamy", "Hopeful", "Angry", "Calm", "Mysterious"] as const;

export const LANGUAGES = ["English", "Hindi", "Bengali", "Spanish", "French", "German", "Portuguese", "Italian", "Japanese", "Korean", "Chinese", "Arabic", "Tamil", "Telugu", "Marathi"];

/** A sensible singing voice for each lyric language (Edge's free neural voices). */
export const SINGER_VOICES: { id: string; label: string; lang: string }[] = [
  { id: "en-US-AriaNeural", label: "Aria (female)", lang: "English" },
  { id: "en-US-GuyNeural", label: "Guy (male)", lang: "English" },
  { id: "en-US-JennyNeural", label: "Jenny (female)", lang: "English" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew (male)", lang: "English" },
  { id: "en-GB-SoniaNeural", label: "Sonia (British female)", lang: "English" },
  { id: "en-GB-RyanNeural", label: "Ryan (British male)", lang: "English" },
  { id: "hi-IN-SwaraNeural", label: "Swara (female)", lang: "Hindi" },
  { id: "hi-IN-MadhurNeural", label: "Madhur (male)", lang: "Hindi" },
  { id: "bn-IN-TanishaaNeural", label: "Tanishaa (female)", lang: "Bengali" },
  { id: "bn-IN-BashkarNeural", label: "Bashkar (male)", lang: "Bengali" },
  { id: "es-ES-ElviraNeural", label: "Elvira (female)", lang: "Spanish" },
  { id: "es-MX-JorgeNeural", label: "Jorge (male)", lang: "Spanish" },
  { id: "fr-FR-DeniseNeural", label: "Denise (female)", lang: "French" },
  { id: "fr-FR-HenriNeural", label: "Henri (male)", lang: "French" },
  { id: "de-DE-KatjaNeural", label: "Katja (female)", lang: "German" },
  { id: "de-DE-ConradNeural", label: "Conrad (male)", lang: "German" },
  { id: "pt-BR-FranciscaNeural", label: "Francisca (female)", lang: "Portuguese" },
  { id: "it-IT-ElsaNeural", label: "Elsa (female)", lang: "Italian" },
  { id: "ja-JP-NanamiNeural", label: "Nanami (female)", lang: "Japanese" },
  { id: "ko-KR-SunHiNeural", label: "SunHi (female)", lang: "Korean" },
  { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao (female)", lang: "Chinese" },
  { id: "ar-SA-ZariyahNeural", label: "Zariyah (female)", lang: "Arabic" },
  { id: "ta-IN-PallaviNeural", label: "Pallavi (female)", lang: "Tamil" },
  { id: "te-IN-ShrutiNeural", label: "Shruti (female)", lang: "Telugu" },
  { id: "mr-IN-AarohiNeural", label: "Aarohi (female)", lang: "Marathi" },
];

export const SCALE_IDS: ScaleId[] = ["major", "minor", "dorian", "mixolydian", "harmonicMinor", "pentatonic", "minorPentatonic", "blues", "chromatic"];

/** The 12 drum rows (General MIDI note numbers), top to bottom in the step sequencer. */
export const DRUM_ROWS: { pitch: number; label: string }[] = [
  { pitch: 49, label: "Crash" },
  { pitch: 51, label: "Ride" },
  { pitch: 46, label: "Open hat" },
  { pitch: 42, label: "Closed hat" },
  { pitch: 70, label: "Shaker" },
  { pitch: 56, label: "Cowbell" },
  { pitch: 48, label: "High tom" },
  { pitch: 45, label: "Low tom" },
  { pitch: 37, label: "Rim" },
  { pitch: 39, label: "Clap" },
  { pitch: 38, label: "Snare" },
  { pitch: 36, label: "Kick" },
];

export type ParamDef = { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string };
export type EffectDef = { type: EffectType; label: string; hint: string; params: ParamDef[] };

export const EFFECTS: EffectDef[] = [
  {
    type: "eq",
    label: "EQ",
    hint: "Three-band equaliser",
    params: [
      { key: "low", label: "Low", min: -18, max: 18, step: 0.5, def: 0, unit: "dB" },
      { key: "mid", label: "Mid", min: -18, max: 18, step: 0.5, def: 0, unit: "dB" },
      { key: "midFreq", label: "Mid freq", min: 200, max: 6000, step: 10, def: 1000, unit: "Hz" },
      { key: "high", label: "High", min: -18, max: 18, step: 0.5, def: 0, unit: "dB" },
      { key: "lowCut", label: "Low cut", min: 20, max: 600, step: 5, def: 20, unit: "Hz" },
    ],
  },
  {
    type: "compressor",
    label: "Compressor",
    hint: "Evens out loud and quiet parts",
    params: [
      { key: "threshold", label: "Threshold", min: -60, max: 0, step: 1, def: -18, unit: "dB" },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, def: 4 },
      { key: "attack", label: "Attack", min: 0.001, max: 0.3, step: 0.001, def: 0.01, unit: "s" },
      { key: "release", label: "Release", min: 0.02, max: 1, step: 0.01, def: 0.2, unit: "s" },
      { key: "makeup", label: "Makeup", min: 0, max: 24, step: 0.5, def: 3, unit: "dB" },
    ],
  },
  {
    type: "reverb",
    label: "Reverb",
    hint: "Room, hall or plate space",
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.25 },
      { key: "size", label: "Size", min: 0.2, max: 8, step: 0.1, def: 2.2, unit: "s" },
      { key: "damp", label: "Damping", min: 1000, max: 16000, step: 100, def: 7000, unit: "Hz" },
      { key: "predelay", label: "Pre-delay", min: 0, max: 0.2, step: 0.005, def: 0.02, unit: "s" },
    ],
  },
  {
    type: "delay",
    label: "Delay",
    hint: "Echoes in time with the song",
    params: [
      { key: "beats", label: "Time", min: 0.125, max: 2, step: 0.125, def: 0.75, unit: "beats" },
      { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01, def: 0.35 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.25 },
      { key: "tone", label: "Tone", min: 800, max: 16000, step: 100, def: 5000, unit: "Hz" },
      { key: "pingpong", label: "Ping-pong", min: 0, max: 1, step: 1, def: 0 },
    ],
  },
  {
    type: "chorus",
    label: "Chorus / doubler",
    hint: "Widens and thickens",
    params: [
      { key: "rate", label: "Rate", min: 0.05, max: 6, step: 0.05, def: 0.8, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.4 },
    ],
  },
  {
    type: "phaser",
    label: "Phaser",
    hint: "Swirling sweep",
    params: [
      { key: "rate", label: "Rate", min: 0.05, max: 8, step: 0.05, def: 0.5, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, def: 0.7 },
      { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01, def: 0.4 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  {
    type: "distortion",
    label: "Distortion",
    hint: "Saturation, overdrive, fuzz",
    params: [
      { key: "drive", label: "Drive", min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: "tone", label: "Tone", min: 500, max: 16000, step: 100, def: 6000, unit: "Hz" },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  {
    type: "filter",
    label: "Filter",
    hint: "Low-pass, high-pass or band-pass sweep",
    params: [
      { key: "mode", label: "Mode (LP/HP/BP)", min: 0, max: 2, step: 1, def: 0 },
      { key: "freq", label: "Cutoff", min: 40, max: 18000, step: 10, def: 2000, unit: "Hz" },
      { key: "q", label: "Resonance", min: 0.1, max: 18, step: 0.1, def: 1 },
      { key: "lfoRate", label: "LFO rate", min: 0, max: 10, step: 0.05, def: 0, unit: "Hz" },
      { key: "lfoDepth", label: "LFO depth", min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  {
    type: "tremolo",
    label: "Tremolo",
    hint: "Volume pulse",
    params: [
      { key: "rate", label: "Rate", min: 0.5, max: 16, step: 0.1, def: 5, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  {
    type: "autopan",
    label: "Auto-pan",
    hint: "Moves the sound left and right",
    params: [
      { key: "rate", label: "Rate", min: 0.05, max: 8, step: 0.05, def: 0.5, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, def: 0.7 },
    ],
  },
  {
    type: "bitcrush",
    label: "Bitcrusher",
    hint: "Lo-fi digital grit",
    params: [
      { key: "bits", label: "Bits", min: 2, max: 16, step: 1, def: 6 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.6 },
    ],
  },
  {
    type: "width",
    label: "Stereo width",
    hint: "Narrower (0) to extra wide (2)",
    params: [{ key: "width", label: "Width", min: 0, max: 2, step: 0.01, def: 1.4 }],
  },
  {
    type: "ringmod",
    label: "Robot (ring mod)",
    hint: "Metallic robot voice",
    params: [
      { key: "freq", label: "Frequency", min: 10, max: 1200, step: 1, def: 60, unit: "Hz" },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0.8 },
    ],
  },
  {
    type: "limiter",
    label: "Limiter",
    hint: "Loud and safe from clipping",
    params: [
      { key: "gain", label: "Input gain", min: 0, max: 18, step: 0.5, def: 3, unit: "dB" },
      { key: "ceiling", label: "Ceiling", min: -6, max: 0, step: 0.1, def: -1, unit: "dB" },
    ],
  },
];

export const effectDef = (t: EffectType) => EFFECTS.find((e) => e.type === t)!;

type FxSpec = { type: EffectType; params?: Record<string, number> };

/** One-tap vocal and instrument chains (BandLab-style "Voice" presets). */
export const FX_PRESETS: { id: string; label: string; chain: FxSpec[] }[] = [
  {
    id: "clean-vocal",
    label: "Clean vocal",
    chain: [
      { type: "eq", params: { lowCut: 90, low: -2, mid: 1, midFreq: 3000, high: 3 } },
      { type: "compressor", params: { threshold: -20, ratio: 3.5, makeup: 4 } },
      { type: "reverb", params: { mix: 0.16, size: 1.6 } },
    ],
  },
  {
    id: "pop-vocal",
    label: "Pop star",
    chain: [
      { type: "eq", params: { lowCut: 110, low: -3, mid: 2, midFreq: 2800, high: 5 } },
      { type: "compressor", params: { threshold: -24, ratio: 5, attack: 0.005, makeup: 6 } },
      { type: "chorus", params: { rate: 0.6, depth: 0.25, mix: 0.25 } },
      { type: "delay", params: { beats: 0.5, feedback: 0.25, mix: 0.14 } },
      { type: "reverb", params: { mix: 0.24, size: 2.4 } },
    ],
  },
  {
    id: "podcast",
    label: "Podcast voice",
    chain: [
      { type: "eq", params: { lowCut: 80, low: 2, mid: -2, midFreq: 400, high: 3 } },
      { type: "compressor", params: { threshold: -22, ratio: 4, makeup: 6 } },
      { type: "limiter", params: { gain: 2, ceiling: -1 } },
    ],
  },
  {
    id: "radio",
    label: "Radio",
    chain: [
      { type: "eq", params: { lowCut: 300, low: -12, mid: 6, midFreq: 1800, high: -10 } },
      { type: "distortion", params: { drive: 0.25, tone: 4000, mix: 0.6 } },
      { type: "compressor", params: { threshold: -26, ratio: 8, makeup: 8 } },
    ],
  },
  {
    id: "telephone",
    label: "Telephone",
    chain: [
      { type: "filter", params: { mode: 2, freq: 1400, q: 1.2 } },
      { type: "distortion", params: { drive: 0.3, tone: 3500, mix: 0.5 } },
    ],
  },
  { id: "robot", label: "Robot", chain: [{ type: "ringmod", params: { freq: 50, mix: 0.85 } }, { type: "delay", params: { beats: 0.125, feedback: 0.4, mix: 0.25 } }] },
  { id: "big-hall", label: "Big hall", chain: [{ type: "reverb", params: { mix: 0.45, size: 5.5, predelay: 0.04 } }] },
  { id: "echo", label: "Echo", chain: [{ type: "delay", params: { beats: 0.75, feedback: 0.55, mix: 0.35, pingpong: 1 } }] },
  {
    id: "lofi",
    label: "Lo-fi",
    chain: [
      { type: "filter", params: { mode: 0, freq: 3800, q: 0.7 } },
      { type: "bitcrush", params: { bits: 8, mix: 0.4 } },
      { type: "chorus", params: { rate: 0.3, depth: 0.5, mix: 0.3 } },
    ],
  },
  { id: "underwater", label: "Underwater", chain: [{ type: "filter", params: { mode: 0, freq: 500, q: 4, lfoRate: 0.4, lfoDepth: 0.4 } }, { type: "chorus", params: { rate: 1.5, depth: 0.8, mix: 0.6 } }] },
  { id: "guitar-amp", label: "Guitar amp", chain: [{ type: "distortion", params: { drive: 0.7, tone: 3500, mix: 1 } }, { type: "eq", params: { low: 2, mid: 4, midFreq: 800, high: -2 } }, { type: "reverb", params: { mix: 0.15, size: 1.2 } }] },
  { id: "wide-synth", label: "Wide synth", chain: [{ type: "chorus", params: { rate: 0.5, depth: 0.5, mix: 0.45 } }, { type: "width", params: { width: 1.7 } }, { type: "reverb", params: { mix: 0.3, size: 3 } }] },
];

/** Mastering chains (BandLab-style), applied to the master bus. */
export const MASTER_PRESETS: { id: string; label: string; hint: string; chain: FxSpec[]; lufs: number }[] = [
  {
    id: "universal",
    label: "Universal",
    hint: "Balanced and streaming-ready",
    lufs: -14,
    chain: [
      { type: "eq", params: { lowCut: 25, low: 1, mid: -0.5, midFreq: 400, high: 1.5 } },
      { type: "compressor", params: { threshold: -16, ratio: 2, attack: 0.02, release: 0.25, makeup: 1.5 } },
      { type: "width", params: { width: 1.1 } },
      { type: "limiter", params: { gain: 2, ceiling: -1 } },
    ],
  },
  {
    id: "fire",
    label: "Fire",
    hint: "Loud, punchy low end",
    lufs: -9,
    chain: [
      { type: "eq", params: { lowCut: 28, low: 3, mid: -1, midFreq: 350, high: 2 } },
      { type: "compressor", params: { threshold: -20, ratio: 3, attack: 0.01, release: 0.15, makeup: 3 } },
      { type: "distortion", params: { drive: 0.08, tone: 14000, mix: 0.3 } },
      { type: "limiter", params: { gain: 5, ceiling: -0.8 } },
    ],
  },
  {
    id: "clarity",
    label: "Clarity",
    hint: "Bright, open and detailed",
    lufs: -13,
    chain: [
      { type: "eq", params: { lowCut: 35, low: -1, mid: 1, midFreq: 3200, high: 3.5 } },
      { type: "compressor", params: { threshold: -18, ratio: 2, attack: 0.03, release: 0.3, makeup: 1.5 } },
      { type: "width", params: { width: 1.25 } },
      { type: "limiter", params: { gain: 2, ceiling: -1 } },
    ],
  },
  {
    id: "tape",
    label: "Tape",
    hint: "Warm, vintage glue",
    lufs: -14,
    chain: [
      { type: "eq", params: { lowCut: 30, low: 2, mid: 0.5, midFreq: 250, high: -2 } },
      { type: "distortion", params: { drive: 0.12, tone: 9000, mix: 0.35 } },
      { type: "compressor", params: { threshold: -20, ratio: 2.5, attack: 0.03, release: 0.4, makeup: 2.5 } },
      { type: "limiter", params: { gain: 2, ceiling: -1 } },
    ],
  },
  {
    id: "podcast",
    label: "Podcast",
    hint: "Spoken word at -16 LUFS",
    lufs: -16,
    chain: [
      { type: "eq", params: { lowCut: 70, low: 0, mid: 1, midFreq: 2500, high: 1 } },
      { type: "compressor", params: { threshold: -22, ratio: 3, makeup: 3 } },
      { type: "limiter", params: { gain: 1, ceiling: -1.5 } },
    ],
  },
];

export const SNAPS: { value: string; label: string; beats: number }[] = [
  { value: "0", label: "Off", beats: 0 },
  { value: "0.125", label: "1/32", beats: 0.125 },
  { value: "0.25", label: "1/16", beats: 0.25 },
  { value: "0.5", label: "1/8", beats: 0.5 },
  { value: "1", label: "1/4", beats: 1 },
  { value: "bar", label: "Bar", beats: -1 },
];
