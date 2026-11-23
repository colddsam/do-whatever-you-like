import type { ScaleId } from "../types";

/** Music theory helpers: note names, scales, Roman-numeral chords, syllables. Pure functions. */

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLATS: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };

export const SCALES: Record<ScaleId, { label: string; steps: number[] }> = {
  major: { label: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { label: "Mixolydian", steps: [0, 2, 4, 5, 7, 9, 10] },
  harmonicMinor: { label: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
  pentatonic: { label: "Major pentatonic", steps: [0, 2, 4, 7, 9] },
  minorPentatonic: { label: "Minor pentatonic", steps: [0, 3, 5, 7, 10] },
  blues: { label: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  chromatic: { label: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const noteName = (p: number) => `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
export const midiToHz = (p: number) => 440 * 2 ** ((p - 69) / 12);
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function keyIndex(name: string): number {
  const n = FLATS[name] ?? name;
  const i = NOTE_NAMES.indexOf(n as (typeof NOTE_NAMES)[number]);
  return i < 0 ? 0 : i;
}

export function inScale(pitch: number, root: number, scale: ScaleId) {
  return SCALES[scale].steps.includes((((pitch - root) % 12) + 12) % 12);
}

/** The nearest pitch in the scale (ties go down). */
export function snapToScale(pitch: number, root: number, scale: ScaleId) {
  for (let d = 0; d < 12; d++) {
    if (inScale(pitch - d, root, scale)) return pitch - d;
    if (inScale(pitch + d, root, scale)) return pitch + d;
  }
  return pitch;
}

/** The scale degree `deg` (0-based, may exceed 7 or be negative) from a base octave pitch. */
export function degreePitch(deg: number, root: number, scale: ScaleId, base = 60) {
  const steps = SCALES[scale].steps;
  const n = steps.length;
  const oct = Math.floor(deg / n);
  const i = ((deg % n) + n) % n;
  return base + root + oct * 12 + steps[i];
}

export type Chord = { root: number; tones: number[]; symbol: string };

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const CHORD_RE = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|dim|\+|aug)?(maj7|m7|7|sus2|sus4|add9|9)?$/;

/**
 * "vi", "IVmaj7", "bVII", "ii°", "Vsus4" in a key → pitch classes relative to C (root first).
 * Upper case = major triad, lower case = minor. In a minor key numerals count from the minor scale.
 */
export function parseRoman(token: string, keyRoot: number, mode: "major" | "minor"): Chord {
  const m = CHORD_RE.exec(token.trim());
  if (!m) return parseRoman(mode === "minor" ? "i" : "I", keyRoot, mode);
  const [, acc, numeral, qual, ext] = m;
  const deg = ROMAN.indexOf(numeral.toUpperCase());
  const steps = mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  const root = (keyRoot + steps[deg] + (acc === "b" ? -1 : acc === "#" ? 1 : 0) + 12) % 12;
  const minor = numeral === numeral.toLowerCase();
  let third = minor ? 3 : 4;
  let fifth = 7;
  if (qual === "°" || qual === "dim") {
    third = 3;
    fifth = 6;
  } else if (qual === "+" || qual === "aug") fifth = 8;
  let tones = [0, third, fifth];
  if (ext === "sus2") tones = [0, 2, 7];
  else if (ext === "sus4") tones = [0, 5, 7];
  else if (ext === "7") tones.push(minor || qual === "°" ? 10 : 10);
  else if (ext === "maj7") tones.push(11);
  else if (ext === "m7") tones = [0, 3, 7, 10];
  else if (ext === "9") tones.push(10, 14);
  else if (ext === "add9") tones.push(14);
  const quality = qual === "°" || qual === "dim" ? "dim" : qual === "+" || qual === "aug" ? "aug" : minor ? "m" : "";
  return { root, tones: tones.map((t) => root + t), symbol: `${NOTE_NAMES[root]}${quality}${ext ?? ""}` };
}

/** Diatonic chord on a 0-based degree of the key's scale (used by chord pads). */
export function diatonicChord(deg: number, keyRoot: number, scale: ScaleId, seventh = false): Chord {
  const mode = scale === "minor" || scale === "harmonicMinor" || scale === "dorian" || scale === "minorPentatonic" ? "minor" : "major";
  const steps = mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  const tones = [0, 2, 4, ...(seventh ? [6] : [])].map((o) => {
    const i = deg + o;
    return steps[i % 7] + 12 * Math.floor(i / 7);
  });
  const root = (keyRoot + tones[0]) % 12;
  const rel = tones.map((t) => t - tones[0]);
  const quality = rel[1] === 3 ? (rel[2] === 6 ? "dim" : "m") : "";
  return { root, tones: rel.map((t) => root + t), symbol: `${NOTE_NAMES[root]}${quality}${seventh ? "7" : ""}` };
}

/** Places chord tones as a close voicing near `center`, moving as little as possible from `prev`. */
export function voice(chord: Chord, center = 60, prev?: number[]): number[] {
  const pcs = chord.tones.map((t) => ((t % 12) + 12) % 12);
  let best: number[] = [];
  let bestCost = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (const base of [center - 12, center - 6, center]) {
      const out: number[] = [];
      let p = base - 1;
      for (const pc of order) {
        let n = p + 1;
        while (((n % 12) + 12) % 12 !== pc) n++;
        out.push(n);
        p = n;
      }
      const mid = (out[0] + out[out.length - 1]) / 2;
      const cost = prev?.length ? out.reduce((a, n, i) => a + Math.abs(n - (prev[i] ?? prev[prev.length - 1])), 0) + Math.abs(mid - center) * 0.5 : Math.abs(mid - center);
      if (cost < bestCost) {
        bestCost = cost;
        best = out;
      }
    }
  }
  return best;
}

/** Syllable count of a word, for fitting lyrics to a melody (English heuristic; other scripts approximated). */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^\p{L}\p{M}']/gu, "");
  if (!w) return 0;
  if (/^[a-z']+$/.test(w)) {
    if (w.length <= 3) return 1;
    const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups?.length ?? 1);
  }
  // Devanagari, Bengali, Tamil…: one syllable per consonant or independent vowel not silenced by a virama.
  if (/[ऀ-෿]/.test(w)) {
    const units = w.match(/[अ-औक-हঅ-ঔক-হஅ-ஔக-ஹఅ-హഅ-ഹ](?![्্்్്])/g);
    return Math.max(1, units?.length ?? 1);
  }
  // Chinese/Japanese/Korean: one syllable per character.
  if (/[぀-ヿ一-鿿가-힯]/.test(w)) return [...w].length;
  // Other Latin-script languages (Spanish, romanised Hindi…): vowel groups.
  const g = w.match(/[aeiouyáéíóúàèìòùâêîôûäëïöüãõ]+/g);
  return Math.max(1, g?.length ?? 1);
}

export function lineWords(line: string): string[] {
  return line
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}\p{M}']+$/gu, ""))
    .filter(Boolean);
}

/** A tiny deterministic random generator (mulberry32), so a seed always gives the same song. */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

/** The pitch classes of a key's scale, as MIDI notes in the octave above C-1. */
export const scaleNotes = (root: number, scale: ScaleId) => SCALES[scale].steps.map((s) => (root + s) % 12);
