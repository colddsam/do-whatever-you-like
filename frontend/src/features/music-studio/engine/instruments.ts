import { midiToHz } from "../lib/theory";
import type { InstrumentTweaks } from "../types";
import { highpass, lowpass } from "./dsp";

/**
 * The studio's virtual instruments, all synthesised on the device (no sample downloads):
 *
 * - "analog" voices (leads, basses, pads, strings, brass, choir, flute) are live Web Audio graphs:
 *   detuned oscillators → filter with its own envelope → amp envelope, with optional vibrato,
 *   noise and formant filters.
 * - "rendered" voices (piano, e-piano, bells, marimba, guitar, harp, pluck, sitar) are computed in
 *   JavaScript once per pitch (additive, FM or Karplus–Strong) and cached as AudioBuffers.
 *
 * The same code plays through the live AudioContext and the OfflineAudioContext used for export,
 * so what you hear is what you get.
 */

type Env = { a: number; d: number; s: number; r: number };
type Osc = { type: OscillatorType; detune?: number; octave?: number; gain?: number };

type AnalogDef = {
  kind: "analog";
  oscs: Osc[];
  unison?: number;
  spread?: number;
  filter: { type: BiquadFilterType; cutoff: number; q: number; env: number; keytrack?: number };
  amp: Env;
  fenv?: Env;
  vibrato?: { rate: number; depth: number; delay?: number };
  noise?: number;
  /** Formant peaks for a sung "ah" (choir). */
  formants?: [number, number, number][];
  /** 808-style pitch drop at the attack, in semitones. */
  drop?: number;
  drive?: number;
  gain: number;
};

type RenderedDef = {
  kind: "rendered";
  model: "piano" | "epiano" | "bell" | "marimba" | "guitar" | "harp" | "pluck" | "sitar" | "kalimba";
  seconds: number;
  release: number;
  gain: number;
};

type SamplerDef = { kind: "sampler"; amp: Env; gain: number };

export type InstrumentDef = { id: string; label: string; group: string; role: ("chords" | "lead" | "bass" | "pad")[] } & (AnalogDef | RenderedDef | SamplerDef);

const saw = (detune = 0, octave = 0, gain = 1): Osc => ({ type: "sawtooth", detune, octave, gain });
const sq = (detune = 0, octave = 0, gain = 1): Osc => ({ type: "square", detune, octave, gain });
const sine = (detune = 0, octave = 0, gain = 1): Osc => ({ type: "sine", detune, octave, gain });
const tri = (detune = 0, octave = 0, gain = 1): Osc => ({ type: "triangle", detune, octave, gain });

export const INSTRUMENTS: InstrumentDef[] = [
  // Keys
  { id: "piano", label: "Grand piano", group: "Keys", role: ["chords", "lead"], kind: "rendered", model: "piano", seconds: 5, release: 0.25, gain: 0.55 },
  { id: "epiano", label: "Electric piano", group: "Keys", role: ["chords", "lead"], kind: "rendered", model: "epiano", seconds: 3.5, release: 0.3, gain: 0.5 },
  {
    id: "organ",
    label: "Organ",
    group: "Keys",
    role: ["chords", "pad"],
    kind: "analog",
    oscs: [sine(0, 0, 1), sine(0, 1, 0.55), sine(702, 1, 0.32), sine(0, 2, 0.22), sine(0, 3, 0.1)],
    filter: { type: "lowpass", cutoff: 6000, q: 0.5, env: 0 },
    amp: { a: 0.01, d: 0.1, s: 1, r: 0.08 },
    vibrato: { rate: 6.2, depth: 6 },
    gain: 0.16,
  },
  // Plucked & mallets
  { id: "guitar", label: "Acoustic guitar", group: "Plucked", role: ["chords", "lead"], kind: "rendered", model: "guitar", seconds: 3, release: 0.15, gain: 0.6 },
  { id: "pluck", label: "Synth pluck", group: "Plucked", role: ["chords", "lead"], kind: "rendered", model: "pluck", seconds: 1.2, release: 0.1, gain: 0.55 },
  { id: "harp", label: "Harp", group: "Plucked", role: ["chords", "lead"], kind: "rendered", model: "harp", seconds: 3.5, release: 0.4, gain: 0.55 },
  { id: "sitar", label: "Sitar", group: "Plucked", role: ["lead"], kind: "rendered", model: "sitar", seconds: 3, release: 0.25, gain: 0.55 },
  { id: "marimba", label: "Marimba", group: "Mallets & bells", role: ["chords", "lead"], kind: "rendered", model: "marimba", seconds: 1.2, release: 0.1, gain: 0.7 },
  { id: "bell", label: "Bells", group: "Mallets & bells", role: ["lead"], kind: "rendered", model: "bell", seconds: 3.5, release: 0.6, gain: 0.4 },
  { id: "kalimba", label: "Kalimba", group: "Mallets & bells", role: ["lead", "chords"], kind: "rendered", model: "kalimba", seconds: 1.8, release: 0.2, gain: 0.6 },
  // Synths
  {
    id: "lead",
    label: "Soft lead",
    group: "Synths",
    role: ["lead"],
    kind: "analog",
    oscs: [tri(0, 0, 1), saw(7, 0, 0.35)],
    filter: { type: "lowpass", cutoff: 2800, q: 1, env: 1.2, keytrack: 0.5 },
    amp: { a: 0.015, d: 0.2, s: 0.75, r: 0.18 },
    fenv: { a: 0.01, d: 0.3, s: 0.4, r: 0.2 },
    vibrato: { rate: 5.5, depth: 12, delay: 0.25 },
    gain: 0.28,
  },
  {
    id: "saw-lead",
    label: "Supersaw lead",
    group: "Synths",
    role: ["lead"],
    kind: "analog",
    oscs: [saw()],
    unison: 5,
    spread: 18,
    filter: { type: "lowpass", cutoff: 3500, q: 1.5, env: 1.5, keytrack: 0.5 },
    amp: { a: 0.01, d: 0.2, s: 0.8, r: 0.25 },
    fenv: { a: 0.005, d: 0.25, s: 0.5, r: 0.2 },
    gain: 0.14,
  },
  {
    id: "square-lead",
    label: "Square lead",
    group: "Synths",
    role: ["lead"],
    kind: "analog",
    oscs: [sq(0, 0, 1), sq(9, 0, 0.5)],
    filter: { type: "lowpass", cutoff: 2600, q: 2, env: 1, keytrack: 0.5 },
    amp: { a: 0.005, d: 0.15, s: 0.7, r: 0.12 },
    fenv: { a: 0.005, d: 0.2, s: 0.3, r: 0.1 },
    vibrato: { rate: 5, depth: 8, delay: 0.3 },
    gain: 0.16,
  },
  {
    id: "arp-synth",
    label: "Arp synth",
    group: "Synths",
    role: ["lead", "chords"],
    kind: "analog",
    oscs: [saw(0, 0, 1), sq(-8, 0, 0.5)],
    filter: { type: "lowpass", cutoff: 1400, q: 4, env: 4, keytrack: 0.6 },
    amp: { a: 0.002, d: 0.18, s: 0.15, r: 0.1 },
    fenv: { a: 0.001, d: 0.12, s: 0.05, r: 0.1 },
    gain: 0.22,
  },
  {
    id: "synth-stab",
    label: "Synth stab",
    group: "Synths",
    role: ["chords"],
    kind: "analog",
    oscs: [saw()],
    unison: 3,
    spread: 14,
    filter: { type: "lowpass", cutoff: 1800, q: 2, env: 3, keytrack: 0.4 },
    amp: { a: 0.003, d: 0.22, s: 0.25, r: 0.12 },
    fenv: { a: 0.002, d: 0.18, s: 0.1, r: 0.1 },
    gain: 0.14,
  },
  // Pads, strings, voices
  {
    id: "pad",
    label: "Warm pad",
    group: "Pads & strings",
    role: ["pad", "chords"],
    kind: "analog",
    oscs: [saw(0, 0, 0.8), tri(0, 0, 0.45), tri(0, 1, 0.25)],
    unison: 3,
    spread: 16,
    filter: { type: "lowpass", cutoff: 1500, q: 0.8, env: 0.6, keytrack: 0.3 },
    amp: { a: 0.6, d: 1, s: 0.85, r: 1.2 },
    fenv: { a: 1.2, d: 1.5, s: 0.6, r: 1 },
    vibrato: { rate: 0.3, depth: 4 },
    gain: 0.1,
  },
  {
    id: "strings",
    label: "String ensemble",
    group: "Pads & strings",
    role: ["pad", "chords", "lead"],
    kind: "analog",
    oscs: [saw(0, 0, 1), saw(0, 0, 0.6)],
    unison: 4,
    spread: 12,
    filter: { type: "lowpass", cutoff: 3200, q: 0.7, env: 0.4, keytrack: 0.5 },
    amp: { a: 0.25, d: 0.5, s: 0.9, r: 0.6 },
    fenv: { a: 0.3, d: 0.8, s: 0.8, r: 0.5 },
    vibrato: { rate: 5.2, depth: 9, delay: 0.3 },
    gain: 0.09,
  },
  {
    id: "choir",
    label: "Choir “aah”",
    group: "Pads & strings",
    role: ["pad", "chords"],
    kind: "analog",
    oscs: [saw()],
    unison: 4,
    spread: 14,
    filter: { type: "lowpass", cutoff: 5000, q: 0.5, env: 0 },
    amp: { a: 0.35, d: 0.6, s: 0.9, r: 0.7 },
    vibrato: { rate: 5, depth: 14, delay: 0.2 },
    formants: [
      [800, 8, 1],
      [1150, 9, 0.5],
      [2900, 10, 0.25],
    ],
    noise: 0.02,
    gain: 0.3,
  },
  {
    id: "brass",
    label: "Brass section",
    group: "Wind & brass",
    role: ["lead", "chords"],
    kind: "analog",
    oscs: [saw(0, 0, 1)],
    unison: 3,
    spread: 9,
    filter: { type: "lowpass", cutoff: 900, q: 1.2, env: 3.5, keytrack: 0.6 },
    amp: { a: 0.04, d: 0.25, s: 0.8, r: 0.2 },
    fenv: { a: 0.07, d: 0.4, s: 0.55, r: 0.2 },
    vibrato: { rate: 5.5, depth: 7, delay: 0.35 },
    gain: 0.13,
  },
  {
    id: "flute",
    label: "Flute",
    group: "Wind & brass",
    role: ["lead"],
    kind: "analog",
    oscs: [sine(0, 0, 1), tri(0, 1, 0.12)],
    filter: { type: "lowpass", cutoff: 4500, q: 0.5, env: 0 },
    amp: { a: 0.06, d: 0.2, s: 0.85, r: 0.15 },
    vibrato: { rate: 5, depth: 10, delay: 0.2 },
    noise: 0.06,
    gain: 0.3,
  },
  // Bass
  {
    id: "sub-bass",
    label: "Sub bass",
    group: "Bass",
    role: ["bass"],
    kind: "analog",
    oscs: [sine(0, 0, 1), tri(0, 0, 0.15)],
    filter: { type: "lowpass", cutoff: 400, q: 0.5, env: 0 },
    amp: { a: 0.005, d: 0.2, s: 0.9, r: 0.08 },
    gain: 0.5,
  },
  {
    id: "synth-bass",
    label: "Synth bass",
    group: "Bass",
    role: ["bass"],
    kind: "analog",
    oscs: [saw(0, 0, 1), sq(-7, 0, 0.5)],
    filter: { type: "lowpass", cutoff: 500, q: 3, env: 2.5, keytrack: 0.3 },
    amp: { a: 0.004, d: 0.25, s: 0.6, r: 0.08 },
    fenv: { a: 0.002, d: 0.2, s: 0.2, r: 0.08 },
    gain: 0.3,
  },
  {
    id: "finger-bass",
    label: "Bass guitar",
    group: "Bass",
    role: ["bass"],
    kind: "analog",
    oscs: [tri(0, 0, 1), saw(0, 0, 0.25), sine(0, 0, 0.5)],
    filter: { type: "lowpass", cutoff: 700, q: 1, env: 1.2, keytrack: 0.4 },
    amp: { a: 0.006, d: 0.6, s: 0.4, r: 0.1 },
    fenv: { a: 0.003, d: 0.15, s: 0.3, r: 0.1 },
    gain: 0.45,
  },
  {
    id: "acid-bass",
    label: "Acid bass",
    group: "Bass",
    role: ["bass"],
    kind: "analog",
    oscs: [saw()],
    filter: { type: "lowpass", cutoff: 350, q: 14, env: 6, keytrack: 0.5 },
    amp: { a: 0.003, d: 0.2, s: 0.5, r: 0.06 },
    fenv: { a: 0.002, d: 0.16, s: 0.05, r: 0.06 },
    drive: 0.4,
    gain: 0.22,
  },
  {
    id: "808-bass",
    label: "808 bass",
    group: "Bass",
    role: ["bass"],
    kind: "analog",
    oscs: [sine(0, 0, 1), tri(0, 0, 0.12)],
    filter: { type: "lowpass", cutoff: 900, q: 0.5, env: 0 },
    amp: { a: 0.003, d: 1.6, s: 0.55, r: 0.25 },
    drop: 12,
    drive: 0.35,
    gain: 0.55,
  },
  // Sampler: plays the track's own sample across the keyboard.
  { id: "sampler", label: "Sampler (your sound)", group: "Sampler", role: ["lead", "chords"], kind: "sampler", amp: { a: 0.005, d: 0.1, s: 1, r: 0.2 }, gain: 0.8 },
];

export const instrumentById = (id: string) => INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];

/**
 * Loudness calibration (dB): measured so every instrument playing the same line lands at
 * −20 LUFS (pads with sustained notes). Mixing is then the track faders' job, not the presets'.
 */
const LEVEL: Record<string, number> = { "piano": -5.3, "epiano": -4.2, "organ": 6.4, "guitar": 0.5, "pluck": 4.5, "harp": 2.0, "sitar": 6.4, "marimba": -5.7, "bell": -5.2, "kalimba": -6.3, "lead": 2.8, "saw-lead": 6.9, "square-lead": 4.3, "arp-synth": 9.7, "synth-stab": 11.4, "pad": 13.0, "strings": 8.8, "choir": 0.9, "brass": 7.9, "flute": 0.3, "sub-bass": -3.5, "synth-bass": 2.4, "finger-bass": -0.1, "acid-bass": 1.7, "808-bass": -8.9 };
const levelOf = (id: string) => 10 ** ((LEVEL[id] ?? 0) / 20);

// ---------------------------------------------------------------------------------------------
// Rendered voices (computed in JS, cached per pitch)

const RENDER_RATE = 32_000;
const renderCache = new Map<string, AudioBuffer>();

function makeBuffer(data: Float32Array, rate = RENDER_RATE) {
  const b = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: rate });
  b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return b;
}

function seededNoise(len: number, seed: number) {
  const out = new Float32Array(len);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 4294967296) * 2 - 1;
  }
  return out;
}

const SINE_N = 8192;
const SINE = Float32Array.from({ length: SINE_N + 1 }, (_, i) => Math.sin((2 * Math.PI * i) / SINE_N));
/** Fast sine of a phase in cycles (table + linear interpolation): FM synthesis per sample. */
function fsin(cycles: number) {
  const x = (cycles - Math.floor(cycles)) * SINE_N;
  const i = x | 0;
  return SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
}

/** Karplus–Strong plucked string with a fractional delay line. */
function karplus(hz: number, seconds: number, opts: { decay: number; bright: number; buzz?: number; pick?: number }) {
  const sr = RENDER_RATE;
  const len = Math.round(seconds * sr);
  // The loop filter averages two taps, which adds `w2` samples of delay: take it off the delay
  // line so the string is in tune (uncorrected it drifted flat, ~15 cents in the top octave).
  const w2 = 0.5 - opts.bright * 0.25;
  const delay = Math.max(2, sr / hz - w2);
  const p = Math.floor(delay);
  const frac = delay - p;
  const out = new Float32Array(len);
  const exc = lowpass(seededNoise(p + 2, Math.round(hz * 13)), 200 + opts.bright * 9000, sr);
  // Pick position: comb out some harmonics like a string plucked away from the bridge.
  const pick = Math.round(p * (opts.pick ?? 0.13));
  for (let i = 0; i < p + 2; i++) out[i] = exc[i] - 0.6 * (exc[i - pick] ?? 0);
  // Loop gain per period gives a decay time that depends on pitch the way real strings do.
  const g = Math.pow(0.001, 1 / (opts.decay * hz));
  for (let i = p + 2; i < len; i++) {
    const a = out[i - p] * (1 - frac) + out[i - p - 1] * frac;
    const b = out[i - p - 1] * (1 - frac) + out[i - p - 2] * frac;
    // A two-tap average is the string's loss filter; "bright" tilts it towards the newer tap.
    let v = g * (a * (0.5 + opts.bright * 0.25) + b * (0.5 - opts.bright * 0.25));
    if (opts.buzz) {
      // A sitar's curved bridge (jawari): a soft one-sided clip adds the buzzing overtones.
      v = v > 0 ? v - opts.buzz * v * v : v;
    }
    out[i] = v;
  }
  return out;
}

function renderModel(model: RenderedDef["model"], pitch: number, seconds: number): Float32Array {
  const sr = RENDER_RATE;
  const hz = midiToHz(pitch);
  // Lower notes ring longer.
  const ring = Math.max(0.35, Math.min(1.6, 1.5 - (pitch - 48) / 60));
  const len = Math.round(seconds * Math.min(1.2, ring + 0.2) * sr);
  const out = new Float32Array(len);
  const twoPi = 2 * Math.PI;
  if (model === "piano") {
    const B = 0.00018 * 2 ** ((pitch - 60) / 24);
    const t1 = 4.5 * ring;
    for (let k = 1; k <= 10; k++) {
      // Stretched partials (string stiffness), with the fundamental exactly in tune.
      const fk = (hz * k * Math.sqrt(1 + B * k * k)) / Math.sqrt(1 + B);
      if (fk * 1.001 > sr / 2.2) break;
      const amp = (1 / k ** 1.25) * (k === 1 ? 1 : 0.9);
      const tk = t1 / k ** 0.75;
      // Two slightly detuned strings per note beat against each other like a real unison.
      // Recursive oscillators and decays (no sin/exp per sample): ~10x faster to render.
      const det = 1 + 0.00035 * k;
      const w1 = (twoPi * fk) / sr;
      const w2 = (twoPi * fk * det) / sr;
      const cw1 = Math.cos(w1), sw1 = Math.sin(w1), cw2 = Math.cos(w2), sw2 = Math.sin(w2);
      const d1 = Math.exp(-1 / (tk * sr));
      const d2 = Math.exp(-1 / (tk * 0.15 * sr));
      let c1 = 1, s1 = 0, c2 = 1, s2 = 0, e1 = amp * 0.5, e2 = 1;
      for (let i = 0; i < len && e1 > 1e-5; i++) {
        out[i] += e1 * (0.7 + 0.3 * e2) * (s1 + s2);
        const n1 = s1 * cw1 + c1 * sw1;
        c1 = c1 * cw1 - s1 * sw1;
        s1 = n1;
        const n2 = s2 * cw2 + c2 * sw2;
        c2 = c2 * cw2 - s2 * sw2;
        s2 = n2;
        e1 *= d1;
        e2 *= d2;
      }
    }
    // The hammer's thump.
    const thump = highpass(seededNoise(Math.round(0.02 * sr), pitch), 300, sr);
    for (let i = 0; i < thump.length; i++) out[i] += thump[i] * 0.12 * Math.exp(-i / (0.004 * sr));
  } else if (model === "epiano") {
    // Two-operator FM (a Rhodes-style tine), the modulation fading faster than the tone.
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const c = hz * t;
      const idx = 1.6 * Math.exp(-t / 0.35) + 0.25;
      const tine = 0.22 * Math.exp(-t / 0.05) * fsin(c * 14.2);
      out[i] = Math.exp(-t / (2.2 * ring)) * fsin(c + (idx * fsin(c)) / twoPi) + tine;
    }
  } else if (model === "bell") {
    // FM at a 1:4 ratio keeps the bell's pitch on the note; the 2.76 partial gives the "bell".
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const c = hz * t;
      const idx = 3 * Math.exp(-t / 0.8);
      out[i] = Math.exp(-t / 1.6) * fsin(c + (idx * fsin(c * 4)) / twoPi) * 0.8 + 0.25 * Math.exp(-t / 0.4) * fsin(c * 2.76);
    }
  } else if (model === "marimba") {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const c = hz * t;
      out[i] = Math.exp(-t / (0.45 * ring)) * fsin(c) + 0.35 * Math.exp(-t / 0.05) * fsin(c * 3.93) + 0.12 * Math.exp(-t / 0.02) * fsin(c * 9.2);
    }
  } else if (model === "kalimba") {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const c = hz * t;
      out[i] = Math.exp(-t / (0.9 * ring)) * fsin(c) + 0.3 * Math.exp(-t / 0.08) * fsin(c * 5.4);
    }
  } else if (model === "guitar") {
    out.set(karplus(hz, len / sr, { decay: 2.2 * ring, bright: 0.55, pick: 0.15 }).subarray(0, len));
  } else if (model === "harp") {
    out.set(karplus(hz, len / sr, { decay: 3 * ring, bright: 0.75, pick: 0.5 }).subarray(0, len));
  } else if (model === "pluck") {
    out.set(karplus(hz, len / sr, { decay: 0.6, bright: 0.9, pick: 0.08 }).subarray(0, len));
  } else if (model === "sitar") {
    out.set(karplus(hz, len / sr, { decay: 2.5 * ring, bright: 0.85, buzz: 1.6, pick: 0.08 }).subarray(0, len));
  }
  // Normalise each note to the same peak so the instrument's gain sets the level.
  let p = 0;
  for (let i = 0; i < len; i++) p = Math.max(p, Math.abs(out[i]));
  if (p > 0) for (let i = 0; i < len; i++) out[i] /= p;
  // A tiny fade at the very end avoids a click if a note rings out completely.
  const tail = Math.min(len, Math.round(0.02 * sr));
  for (let i = 0; i < tail; i++) out[len - 1 - i] *= i / tail;
  return out;
}

export function renderedBuffer(def: RenderedDef, pitch: number): AudioBuffer {
  const key = `${def.model}:${pitch}`;
  let b = renderCache.get(key);
  if (!b) {
    b = makeBuffer(renderModel(def.model, pitch, def.seconds));
    renderCache.set(key, b);
  }
  return b;
}

// ---------------------------------------------------------------------------------------------
// Voices

export type Voice = { release: (at: number) => void; end: number };

const curveCache = new Map<number, Float32Array<ArrayBuffer>>();
export function driveCurve(amount: number) {
  const key = Math.round(amount * 100);
  let c = curveCache.get(key);
  if (!c) {
    const k = 1 + amount * 30;
    c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    curveCache.set(key, c);
  }
  return c;
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = new AudioBuffer({ length: ctx.sampleRate * 2, numberOfChannels: 1, sampleRate: ctx.sampleRate });
    noiseBuf.copyToChannel(seededNoise(ctx.sampleRate * 2, 99), 0);
  }
  return noiseBuf;
}

/** Envelope value at `t` seconds after the note started (for releasing mid-attack smoothly). */
function envAt(e: Env, t: number, peak: number) {
  if (t <= 0) return 0;
  if (t < e.a) return (t / e.a) * peak;
  const dt = t - e.a;
  return peak * (e.s + (1 - e.s) * Math.exp(-dt / Math.max(0.001, e.d / 3)));
}

function applyEnv(param: AudioParam, e: Env, when: number, peak: number, base = 0) {
  param.setValueAtTime(base, when);
  param.linearRampToValueAtTime(base + peak, when + Math.max(0.001, e.a));
  param.setTargetAtTime(base + peak * e.s, when + Math.max(0.001, e.a), Math.max(0.001, e.d / 3));
}

/**
 * Note-off on an envelope. Past the attack, the decay curve is cut at `at`. During the attack, a
 * plain cancel would drop the rising ramp (silence, then a click), so the value is held where the
 * ramp has got to: cancelAndHoldAtTime where supported, otherwise the ramp is re-drawn to `at`.
 */
function releaseParam(param: AudioParam, attackEnd: number, when: number, at: number, v: number, target: number, r: number, base: number) {
  if (at < attackEnd) {
    const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at);
    else {
      param.cancelScheduledValues(when);
      param.setValueAtTime(base, when);
      param.linearRampToValueAtTime(v, at);
    }
  } else {
    param.cancelScheduledValues(at);
    param.setValueAtTime(v, at);
  }
  param.setTargetAtTime(target, at, Math.max(0.005, r / 4));
}

function releaseEnv(param: AudioParam, e: Env, when: number, at: number, peak: number, r: number, base = 0) {
  releaseParam(param, when + Math.max(0.001, e.a), when, at, base + envAt(e, at - when, peak), base, r, base);
}

/**
 * Starts one note at `when` (seconds on the context's clock). Call `release(at)` for the note-off;
 * the voice disconnects itself after its release tail.
 */
export function startVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  instrumentId: string,
  pitch: number,
  when: number,
  velocity: number,
  tweaks: Partial<InstrumentTweaks> = {},
  sample?: AudioBuffer | null,
): Voice {
  const def = instrumentById(instrumentId);
  const p = pitch + (tweaks.octave ?? 0) * 12;
  const vel = Math.max(0.05, Math.min(1, velocity));

  if (def.kind === "rendered") {
    const buf = renderedBuffer(def, Math.max(21, Math.min(108, p)));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Softer notes are darker as well as quieter.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = tweaks.cutoff ? tweaks.cutoff : 1200 + vel * vel * 14000;
    tone.Q.value = tweaks.resonance || 0.5;
    const amp = ctx.createGain();
    const peak = def.gain * levelOf(def.id) * (0.25 + 0.75 * vel);
    const attack = tweaks.attack || 0.002;
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(peak, when + attack);
    src.connect(tone).connect(amp).connect(dest);
    src.start(when);
    const natural = when + buf.duration;
    let released = false;
    const voice: Voice = {
      end: natural,
      release: (at) => {
        if (released || at >= natural) return;
        released = true;
        const r = tweaks.release || def.release;
        releaseParam(amp.gain, when + attack, when, at, at - when < attack ? peak * Math.max(0, (at - when) / attack) : peak, 0, r, 0);
        src.stop(at + r * 1.5 + 0.05);
        voice.end = at + r * 1.5;
      },
    };
    src.onended = () => {
      src.disconnect();
      tone.disconnect();
      amp.disconnect();
    };
    return voice;
  }

  if (def.kind === "sampler") {
    const amp = ctx.createGain();
    amp.connect(dest);
    const peak = def.gain * (0.3 + 0.7 * vel);
    const env: Env = { ...def.amp, a: tweaks.attack || def.amp.a, r: tweaks.release || def.amp.r };
    if (!sample) {
      // No sample loaded yet: a quiet sine so the keys still answer.
      const o = ctx.createOscillator();
      o.frequency.value = midiToHz(p);
      o.connect(amp);
      applyEnv(amp.gain, env, when, peak * 0.4);
      o.start(when);
      return {
        end: when + 30,
        release: (at) => {
          releaseEnv(amp.gain, env, when, at, peak * 0.4, env.r);
          o.stop(at + env.r * 1.5 + 0.05);
          o.onended = () => amp.disconnect();
        },
      };
    }
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = 2 ** ((p - 60) / 12);
    src.connect(amp);
    applyEnv(amp.gain, env, when, peak);
    src.start(when);
    const natural = when + sample.duration / src.playbackRate.value;
    src.onended = () => {
      src.disconnect();
      amp.disconnect();
    };
    let released = false;
    const voice: Voice = {
      end: natural,
      release: (at) => {
        if (released || at >= natural) return;
        released = true;
        releaseEnv(amp.gain, env, when, at, peak, env.r);
        src.stop(at + env.r * 1.5 + 0.05);
        voice.end = at + env.r * 1.5;
      },
    };
    return voice;
  }

  // Analog voice
  const hz = midiToHz(p);
  const env: Env = { ...def.amp, a: tweaks.attack || def.amp.a, r: tweaks.release || def.amp.r };
  const out = ctx.createGain();
  out.gain.value = 0;
  let head: AudioNode = out;
  const extra: AudioNode[] = [];
  if (def.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(def.drive);
    ws.connect(out);
    extra.push(ws);
    head = ws;
  }
  out.connect(dest);
  const filter = ctx.createBiquadFilter();
  filter.type = def.filter.type;
  const cutoffBase = (tweaks.cutoff || def.filter.cutoff) * (def.filter.keytrack ? 2 ** (((p - 60) / 12) * def.filter.keytrack) : 1) * (0.6 + 0.4 * vel);
  filter.Q.value = tweaks.resonance || def.filter.q;
  const nyq = ctx.sampleRate / 2 - 100;
  if (def.fenv && def.filter.env) {
    const peakF = Math.min(nyq, cutoffBase * (1 + def.filter.env * vel));
    applyEnv(filter.frequency, def.fenv, when, peakF - cutoffBase, Math.min(nyq, cutoffBase));
  } else filter.frequency.value = Math.min(nyq, cutoffBase);

  const sink: AudioNode = filter;
  if (def.formants) {
    // Parallel band-passes at vowel formants turn the buzz into an "aah".
    const sum = ctx.createGain();
    for (const [f, q, g] of def.formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * (1 + (p - 60) / 240);
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g * 3;
      filter.connect(bp).connect(gg).connect(sum);
      extra.push(bp, gg);
    }
    sum.connect(head);
    extra.push(sum);
  } else filter.connect(head);

  const oscs: (OscillatorNode | AudioBufferSourceNode)[] = [];
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  if (def.vibrato) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = def.vibrato.rate;
    lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, when);
    lfoGain.gain.linearRampToValueAtTime(def.vibrato.depth, when + (def.vibrato.delay ?? 0) + 0.15);
    lfo.connect(lfoGain);
  }
  const unison = def.unison ?? 1;
  const spread = def.spread ?? 0;
  const mixGain = 1 / Math.sqrt(unison * def.oscs.length);
  for (const o of def.oscs) {
    for (let u = 0; u < unison; u++) {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      const f = hz * 2 ** (o.octave ?? 0);
      if (def.drop) {
        osc.frequency.setValueAtTime(f * 2 ** (def.drop / 12), when);
        osc.frequency.exponentialRampToValueAtTime(f, when + 0.06);
      } else osc.frequency.value = f;
      const det = (o.detune ?? 0) + (unison > 1 ? (u / (unison - 1) - 0.5) * 2 * spread : 0);
      osc.detune.value = det;
      if (lfoGain) lfoGain.connect(osc.detune);
      const g = ctx.createGain();
      g.gain.value = (o.gain ?? 1) * mixGain;
      osc.connect(g).connect(sink);
      extra.push(g);
      oscs.push(osc);
    }
  }
  if (def.noise) {
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx);
    n.loop = true;
    n.loopEnd = 2;
    const ng = ctx.createGain();
    ng.gain.value = def.noise;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = Math.min(nyq, hz * 4);
    nf.Q.value = 0.8;
    n.connect(nf).connect(ng).connect(sink);
    extra.push(nf, ng);
    oscs.push(n);
  }
  const peak = def.gain * levelOf(def.id) * (0.35 + 0.65 * vel);
  applyEnv(out.gain, env, when, peak);
  for (const o of oscs) o.start(when);
  lfo?.start(when);
  let stopped = false;
  const voice: Voice = {
    end: Infinity,
    release: (at) => {
      if (stopped) return;
      stopped = true;
      const r = env.r;
      releaseEnv(out.gain, env, when, at, peak, r);
      if (def.fenv && def.filter.env) {
        const fpeak = Math.min(nyq, cutoffBase * (1 + def.filter.env * vel)) - Math.min(nyq, cutoffBase);
        releaseParam(filter.frequency, when + Math.max(0.001, def.fenv.a), when, at, Math.min(nyq, cutoffBase) + envAt(def.fenv, at - when, fpeak), Math.min(nyq, cutoffBase), def.fenv.r || r, Math.min(nyq, cutoffBase));
      }
      const stopAt = at + r * 1.6 + 0.05;
      for (const o of oscs) o.stop(stopAt);
      lfo?.stop(stopAt);
      voice.end = stopAt;
      oscs[0].onended = () => {
        for (const o of oscs) o.disconnect();
        lfo?.disconnect();
        lfoGain?.disconnect();
        filter.disconnect();
        for (const x of extra) x.disconnect();
        out.disconnect();
      };
    },
  };
  return voice;
}

/** Plays a note of known length (scheduled playback and export). */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, instrumentId: string, pitch: number, when: number, duration: number, velocity: number, tweaks?: Partial<InstrumentTweaks>, sample?: AudioBuffer | null) {
  const v = startVoice(ctx, dest, instrumentId, pitch, when, velocity, tweaks, sample);
  v.release(when + Math.max(0.02, duration));
  return v;
}

/** Warms the rendered-voice cache for the pitches a project uses (avoids a hitch on first play). */
export function prewarm(instrumentId: string, pitches: Iterable<number>, tweaks: Partial<InstrumentTweaks> = {}) {
  const def = instrumentById(instrumentId);
  if (def.kind !== "rendered") return;
  for (const p of pitches) renderedBuffer(def, Math.max(21, Math.min(108, p + (tweaks.octave ?? 0) * 12)));
}

/**
 * Pre-renders a rendered instrument's notes a few at a time in idle moments, so the first press
 * of a key (or the first Play) never waits for synthesis.
 */
export function warmInBackground(instrumentId: string, pitches: Iterable<number>, tweaks: Partial<InstrumentTweaks> = {}) {
  const def = instrumentById(instrumentId);
  if (def.kind !== "rendered") return;
  const todo = [...new Set([...pitches].map((p) => Math.max(21, Math.min(108, p + (tweaks.octave ?? 0) * 12))))].filter((p) => !renderCache.has(`${def.model}:${p}`));
  if (!todo.length) return;
  const idle: (cb: () => void) => void = typeof requestIdleCallback === "function" ? (cb) => requestIdleCallback(cb, { timeout: 500 }) : (cb) => setTimeout(cb, 16);
  const step = () => {
    const t = performance.now();
    while (todo.length && performance.now() - t < 12) renderedBuffer(def, todo.shift()!);
    if (todo.length) idle(step);
  };
  idle(step);
}
