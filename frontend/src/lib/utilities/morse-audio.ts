/**
 * Morse code from sound: finds the tone's pitch, follows its loudness 200 times a second (Goertzel,
 * so other noise barely counts), turns that into on/off runs, and reads dits, dahs and gaps from
 * their lengths. The speed is learnt from the recording itself, so 5 to 50+ WPM and hand-keyed
 * (uneven) Morse both work. Pure functions over samples: no browser APIs here.
 */
import { fromMorse } from "./text";

export type Mark = { start: number; end: number; on: boolean; dah?: boolean };
export type MorseDecode = {
  text: string;
  morse: string;
  pitch: number;
  wpm: number;
  unitMs: number;
  seconds: number;
  /** Tone strength per frame (0–1), for drawing. */
  envelope: Float32Array;
  frameMs: number;
  threshold: number;
  marks: Mark[];
};
export type MorseOptions = { pitch?: number; sensitivity?: number };

const FRAME_MS = 5;

/** Box-filter and decimate to about 8–12 kHz: plenty for tones up to 2 kHz, and much faster. */
export function downsample(x: Float32Array, rate: number): { x: Float32Array; rate: number } {
  const k = Math.max(1, Math.floor(rate / 8000));
  if (k === 1) return { x, rate };
  const out = new Float32Array(Math.floor(x.length / k));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += x[i * k + j];
    out[i] = s / k;
  }
  return { x: out, rate: rate / k };
}

function goertzel(x: Float32Array, start: number, n: number, freq: number, rate: number) {
  const w = (2 * Math.PI * freq) / rate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  const end = Math.min(x.length, start + n);
  for (let i = start; i < end; i++) {
    const s = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2);
}

/** The tone's pitch: the strongest frequency (250–2000 Hz) across the loudest 20 ms frames. */
export function detectPitch(x: Float32Array, rate: number): number {
  const n = Math.round(rate * 0.02);
  const frames: { at: number; rms: number }[] = [];
  for (let at = 0; at + n <= x.length; at += n) {
    let s = 0;
    for (let i = at; i < at + n; i++) s += x[i] * x[i];
    frames.push({ at, rms: s });
  }
  frames.sort((a, b) => b.rms - a.rms);
  const loud = frames.slice(0, 40);
  if (!loud.length) return 600;
  let best = 600;
  let bestP = -1;
  const scan = (lo: number, hi: number, step: number) => {
    for (let f = lo; f <= hi; f += step) {
      let p = 0;
      for (const fr of loud) p += goertzel(x, fr.at, n, f, rate);
      if (p > bestP) {
        bestP = p;
        best = f;
      }
    }
  };
  scan(250, Math.min(2000, rate / 2 - 100), 10);
  const coarse = best;
  scan(coarse - 10, coarse + 10, 1);
  return best;
}

/** Tone strength every 5 ms (10 ms windows), at the given pitch. */
export function envelope(x: Float32Array, rate: number, pitch: number): Float32Array {
  const hop = Math.max(1, Math.round((rate * FRAME_MS) / 1000));
  const n = hop * 2;
  const out = new Float32Array(Math.max(0, Math.floor((x.length - n) / hop) + 1));
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(goertzel(x, i * hop, n, pitch, rate)) / n;
  return out;
}

const quantile = (sorted: Float32Array | number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

/** Two clusters in log space: returns [low centre, high centre]. */
function twoMeans(values: number[]): [number, number] {
  const logs = values.map((v) => Math.log(v));
  let a = Math.min(...logs);
  let b = Math.max(...logs);
  for (let it = 0; it < 20; it++) {
    const lo: number[] = [];
    const hi: number[] = [];
    for (const v of logs) (Math.abs(v - a) <= Math.abs(v - b) ? lo : hi).push(v);
    const na = lo.length ? lo.reduce((s, v) => s + v, 0) / lo.length : a;
    const nb = hi.length ? hi.reduce((s, v) => s + v, 0) / hi.length : b;
    if (na === a && nb === b) break;
    a = na;
    b = nb;
  }
  return [Math.exp(a), Math.exp(b)];
}

export function decodeMorse(samples: Float32Array, sampleRate: number, opts: MorseOptions = {}): MorseDecode | { error: string } {
  const { x, rate } = downsample(samples, sampleRate);
  const seconds = samples.length / sampleRate;
  if (seconds < 0.2) return { error: "The recording is too short." };
  const pitch = opts.pitch ?? detectPitch(x, rate);
  const raw = envelope(x, rate, pitch);
  // Smooth a little (3 frames) so a single noisy frame can't split a dah.
  const env = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) env[i] = (raw[Math.max(0, i - 1)] + raw[i] + raw[Math.min(raw.length - 1, i + 1)]) / 3;
  const sorted = Float32Array.from(env).sort();
  const floor = quantile(sorted, 0.1);
  const peak = quantile(sorted, 0.985);
  // A real tone is far stronger at its pitch than 200 Hz either side; plain noise is about the same.
  const side = Math.max(...[pitch - 200, pitch + 200].filter((f) => f > 100 && f < rate / 2 - 50).map((f) => quantile(Float32Array.from(envelope(x, rate, f)).sort(), 0.985)), 0);
  if (!(peak > 0) || peak < floor * 2.5 || peak < 1e-4 || peak < side * 2.5) return { error: "No clear Morse tone was found. Is there a beeping sound in it?" };
  const scale = peak || 1;
  const sens = opts.sensitivity ?? 0.5;
  const threshold = floor + (peak - floor) * (1 - sens) * 0.9 + (peak - floor) * 0.05;
  const hyst = (peak - floor) * 0.08;

  // On/off runs, with hysteresis.
  const runs: Mark[] = [];
  let on = false;
  let start = 0;
  for (let i = 0; i < env.length; i++) {
    const next: boolean = on ? env[i] > threshold - hyst : env[i] > threshold + hyst;
    if (next !== on) {
      runs.push({ start, end: i, on });
      start = i;
      on = next;
    }
  }
  runs.push({ start, end: env.length, on });
  // Drop glitches of one or two frames (≤10 ms) by folding them into their neighbours.
  const clean: Mark[] = [];
  for (const r of runs) {
    const prev = clean.at(-1);
    if (prev && (r.end - r.start <= 2 || prev.on === r.on)) prev.end = r.end;
    else clean.push({ ...r });
  }
  const merged: Mark[] = [];
  for (const r of clean) {
    const prev = merged.at(-1);
    if (prev && prev.on === r.on) prev.end = r.end;
    else merged.push(r);
  }
  while (merged.length && !merged[0].on) merged.shift();
  while (merged.length && !merged.at(-1)!.on) merged.pop();
  const ons = merged.filter((r) => r.on);
  if (ons.length < 1) return { error: "No Morse beeps were found. Try raising the sensitivity." };

  const ms = (r: Mark) => (r.end - r.start) * FRAME_MS;
  const onMs = ons.map(ms);
  const offMs = merged.filter((r) => !r.on).map(ms);

  // Dits vs dahs (a dah is 3 dits): split the beep lengths into two groups.
  let unit: number;
  let dahAbove: number;
  const [c1, c2] = onMs.length > 1 ? twoMeans(onMs) : [onMs[0], onMs[0]];
  if (c2 / c1 >= 1.8) {
    dahAbove = Math.sqrt(c1 * c2);
    const dits = onMs.filter((v) => v < dahAbove);
    const dahs = onMs.filter((v) => v >= dahAbove);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    unit = dits.length && dahs.length ? (avg(dits) * dits.length + (avg(dahs) / 3) * dahs.length) / (dits.length + dahs.length) : avg(dits.length ? dits : dahs.map((v) => v / 3));
  } else {
    // All beeps alike (EEE, TTT, SSS…): compare them with the shortest gaps, which are one unit.
    const gap = offMs.length ? Math.min(...offMs) : c1;
    const allDah = c1 > gap * 2;
    unit = allDah ? c1 / 3 : c1;
    dahAbove = allDah ? 0 : Infinity;
  }
  for (const r of ons) r.dah = ms(r) >= dahAbove;
  // Thresholding shortens beeps and lengthens gaps by the same amount, so average a dit with the
  // gaps inside letters for the true unit (and an honest WPM).
  const dits = onMs.filter((v) => v < dahAbove);
  const inner = offMs.filter((v) => v < unit * 2);
  if (dits.length && inner.length) unit = (dits.reduce((a, v) => a + v, 0) / dits.length + inner.reduce((a, v) => a + v, 0) / inner.length) / 2;

  // Gaps: inside a letter (1 unit), between letters (3), between words (7). Learnt from the
  // recording when there are clearly two kinds of long gap (also handles Farnsworth spacing).
  const long = offMs.filter((v) => v >= unit * 2);
  let wordAbove = unit * 5;
  if (long.length > 1) {
    const [g1, g2] = twoMeans(long);
    if (g2 / g1 >= 1.6) wordAbove = Math.sqrt(g1 * g2);
    else wordAbove = g1 < unit * 6 ? Infinity : 0;
  }
  let morse = "";
  for (const r of merged) {
    if (r.on) morse += r.dah ? "-" : ".";
    else {
      const g = ms(r);
      if (g >= wordAbove && g >= unit * 2) morse += " / ";
      else if (g >= unit * 2) morse += " ";
    }
  }
  const norm = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) norm[i] = Math.min(1, env[i] / scale);
  return {
    text: fromMorse(morse),
    morse,
    pitch,
    wpm: Math.round((1200 / unit) * 10) / 10,
    unitMs: Math.round(unit),
    seconds,
    envelope: norm,
    frameMs: FRAME_MS,
    threshold: threshold / scale,
    marks: merged,
  };
}
