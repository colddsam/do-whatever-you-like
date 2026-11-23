import { scaleNotes } from "../lib/theory";
import type { Pcm, Project } from "../types";
import * as D from "./dsp";

/**
 * Audacity-style edits on a clip's audio. Each takes the whole file (PCM) and a selection in
 * seconds and returns new PCM; the caller stores it as a new asset, so every edit can be undone.
 */

export type Sel = { start: number; end: number };
export type EditResult = Pcm;

const idx = (pcm: Pcm, sec: number) => Math.max(0, Math.min(pcm.channels[0].length, Math.round(sec * pcm.sampleRate)));

function range(pcm: Pcm, sel: Sel | null): [number, number] {
  if (!sel || sel.end - sel.start < 1e-3) return [0, pcm.channels[0].length];
  return [idx(pcm, Math.min(sel.start, sel.end)), idx(pcm, Math.max(sel.start, sel.end))];
}

/** Replaces the selected samples with `fn`'s result (which may be a different length). */
function replace(pcm: Pcm, sel: Sel | null, fn: (seg: Float32Array[]) => Float32Array[]): Pcm {
  const [a, b] = range(pcm, sel);
  const seg = pcm.channels.map((c) => c.slice(a, b));
  const res = fn(seg);
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((c, i) => {
      const r = res[Math.min(i, res.length - 1)];
      const out = new Float32Array(a + r.length + (c.length - b));
      out.set(c.subarray(0, a), 0);
      out.set(r, a);
      out.set(c.subarray(b), a + r.length);
      return out;
    }),
  };
}

const perChannel = (fn: (x: Float32Array) => Float32Array) => (seg: Float32Array[]) => seg.map(fn);

export function copy(pcm: Pcm, sel: Sel | null): Pcm {
  const [a, b] = range(pcm, sel);
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(a, b)) };
}
export const remove = (pcm: Pcm, sel: Sel) => replace(pcm, sel, (seg) => seg.map(() => new Float32Array(0)));
export const silence = (pcm: Pcm, sel: Sel) => replace(pcm, sel, perChannel((x) => new Float32Array(x.length)));
export const trimTo = (pcm: Pcm, sel: Sel) => copy(pcm, sel);

export function paste(pcm: Pcm, at: number, clip: Pcm): Pcm {
  const i = idx(pcm, at);
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((c, ch) => {
      const ins = clip.channels[Math.min(ch, clip.channels.length - 1)];
      const out = new Float32Array(c.length + ins.length);
      out.set(c.subarray(0, i), 0);
      out.set(ins, i);
      out.set(c.subarray(i), i + ins.length);
      return out;
    }),
  };
}

export const fadeIn = (pcm: Pcm, sel: Sel | null) =>
  replace(pcm, sel, perChannel((x) => x.map((v, i) => v * Math.sin(((i / Math.max(1, x.length - 1)) * Math.PI) / 2) ** 2)));
export const fadeOut = (pcm: Pcm, sel: Sel | null) =>
  replace(pcm, sel, perChannel((x) => x.map((v, i) => v * Math.cos(((i / Math.max(1, x.length - 1)) * Math.PI) / 2) ** 2)));

export function normalize(pcm: Pcm, sel: Sel | null, peakDb = -1): Pcm {
  return replace(pcm, sel, (seg) => {
    const p = Math.max(...seg.map(D.peak));
    const g = p > 0 ? D.dbToGain(peakDb) / p : 1;
    return seg.map((x) => x.map((v) => v * g));
  });
}

export const amplify = (pcm: Pcm, sel: Sel | null, db: number) => replace(pcm, sel, perChannel((x) => x.map((v) => Math.max(-1, Math.min(1, v * D.dbToGain(db))))));
export const reverse = (pcm: Pcm, sel: Sel | null) => replace(pcm, sel, perChannel((x) => x.slice().reverse()));
export const invert = (pcm: Pcm, sel: Sel | null) => replace(pcm, sel, perChannel((x) => x.map((v) => -v)));
/** Speed and pitch together, like a tape or record (rate 2 = twice as fast and an octave up). */
export const speed = (pcm: Pcm, sel: Sel | null, rate: number) => replace(pcm, sel, perChannel((x) => D.resample(x, rate)));
/** Tempo only (pitch kept). */
export const tempo = (pcm: Pcm, sel: Sel | null, rate: number) => replace(pcm, sel, perChannel((x) => D.timeStretch(x, pcm.sampleRate, rate)));
/** Pitch only (length kept). */
export const pitch = (pcm: Pcm, sel: Sel | null, semitones: number) => replace(pcm, sel, perChannel((x) => D.pitchShift(x, pcm.sampleRate, semitones)));

export function denoise(pcm: Pcm, sel: Sel | null, profile: Pcm | null, reductionDb = 18, sensitivity = 1.6): Pcm {
  const prof = profile ? D.mixDown(profile.channels) : undefined;
  return replace(pcm, sel, perChannel((x) => D.reduceNoise(x, { profile: prof, reductionDb, sensitivity })));
}

/** Auto-tune to the project's key and scale. */
export function tune(pcm: Pcm, sel: Sel | null, p: Pick<Project, "keyRoot" | "scale">, strength = 1, speedMs = 20): Pcm {
  const notes = scaleNotes(p.keyRoot, p.scale);
  return replace(pcm, sel, perChannel((x) => D.autotune(x, pcm.sampleRate, { scaleNotes: notes, strength, speedMs })));
}

/** Shortens pauses longer than `maxPause` seconds down to `keep` seconds (Audacity's Truncate Silence). */
export function truncateSilence(pcm: Pcm, sel: Sel | null, thresholdDb = -40, maxPause = 0.6, keep = 0.3): Pcm {
  return replace(pcm, sel, (seg) => {
    const mono = D.mixDown(seg);
    const frame = 0.01;
    const db = D.rmsDb(mono, pcm.sampleRate, frame);
    const fs = Math.round(frame * pcm.sampleRate);
    const keepFrames = Math.round(keep / frame);
    const maxFrames = Math.round(maxPause / frame);
    const keepMask = new Uint8Array(db.length).fill(1);
    let i = 0;
    while (i < db.length) {
      if (db[i] >= thresholdDb) {
        i++;
        continue;
      }
      let j = i;
      while (j < db.length && db[j] < thresholdDb) j++;
      if (j - i > maxFrames) {
        // Keep half the allowed pause at each side of the cut.
        const half = Math.floor(keepFrames / 2);
        for (let k = i + half; k < j - (keepFrames - half); k++) keepMask[k] = 0;
      }
      i = j;
    }
    return seg.map((x) => {
      const parts: number[] = [];
      for (let f = 0; f < keepMask.length; f++) if (keepMask[f]) parts.push(f);
      const out = new Float32Array(parts.length * fs);
      let o = 0;
      for (const f of parts) {
        const s = x.subarray(f * fs, Math.min(x.length, (f + 1) * fs));
        out.set(s, o);
        o += s.length;
      }
      return out.subarray(0, o);
    });
  });
}

export function echo(pcm: Pcm, sel: Sel | null, delaySec = 0.35, decay = 0.45, repeats = 5): Pcm {
  return replace(pcm, sel, perChannel((x) => {
    const d = Math.round(delaySec * pcm.sampleRate);
    const out = new Float32Array(x.length + d * repeats);
    out.set(x);
    for (let r = 1; r <= repeats; r++) {
      const g = decay ** r;
      for (let i = 0; i < x.length; i++) out[i + r * d] += x[i] * g;
    }
    return out;
  }));
}

export function toMono(pcm: Pcm): Pcm {
  const m = D.mixDown(pcm.channels);
  return { sampleRate: pcm.sampleRate, channels: [m, m.slice()] };
}

export function swapChannels(pcm: Pcm): Pcm {
  if (pcm.channels.length < 2) return pcm;
  return { sampleRate: pcm.sampleRate, channels: [pcm.channels[1].slice(), pcm.channels[0].slice()] };
}

/** Karaoke: cancels what's panned dead centre (usually the lead vocal), keeping the bass. */
export function removeVocals(pcm: Pcm): Pcm {
  if (pcm.channels.length < 2) throw new Error("Vocal removal needs a stereo recording.");
  const [l, r] = pcm.channels;
  const side = l.map((v, i) => (v - r[i]) / 2);
  const mid = l.map((v, i) => (v + r[i]) / 2);
  const bass = D.lowpass(mid, 140, pcm.sampleRate);
  return { sampleRate: pcm.sampleRate, channels: [side.map((v, i) => v + bass[i]), side.map((v, i) => -v + bass[i])] };
}

/** Bass boost / treble as a quick fix (shelf via filtered blend). */
export function bassBoost(pcm: Pcm, sel: Sel | null, db = 6): Pcm {
  const g = D.dbToGain(db) - 1;
  return replace(pcm, sel, perChannel((x) => {
    const low = D.lowpass(x, 160, pcm.sampleRate);
    return x.map((v, i) => v + low[i] * g);
  }));
}

export function highPassClean(pcm: Pcm, sel: Sel | null, freq = 80): Pcm {
  return replace(pcm, sel, perChannel((x) => D.highpass(x, freq, pcm.sampleRate)));
}

/** Evens out loudness over time (a slow leveller, for speech). */
export function level(pcm: Pcm, sel: Sel | null, targetDb = -20): Pcm {
  return replace(pcm, sel, (seg) => {
    const mono = D.mixDown(seg);
    const frame = 0.05;
    const db = D.rmsDb(mono, pcm.sampleRate, frame);
    const fs = Math.round(frame * pcm.sampleRate);
    const gains = new Float32Array(db.length);
    let g = 1;
    for (let f = 0; f < db.length; f++) {
      const want = db[f] > -50 ? D.dbToGain(Math.max(-12, Math.min(18, targetDb - db[f]))) : g;
      g += (want - g) * 0.15;
      gains[f] = g;
    }
    return seg.map((x) => x.map((v, i) => {
      const f = i / fs;
      const a = gains[Math.min(gains.length - 1, Math.floor(f))];
      const b = gains[Math.min(gains.length - 1, Math.floor(f) + 1)];
      const out = v * (a + (b - a) * (f - Math.floor(f)));
      return Math.max(-1, Math.min(1, out));
    }));
  });
}

export const durationOf = (pcm: Pcm) => pcm.channels[0].length / pcm.sampleRate;

/** The audio editor's clipboard and noise profile (outside React state: they can be large). */
const held: { clip: Pcm | null; noise: Pcm | null } = { clip: null, noise: null };
export const setClipboard = (p: Pcm | null) => void (held.clip = p);
export const getClipboard = () => held.clip;
export const setNoiseProfile = (p: Pcm | null) => void (held.noise = p);
export const getNoiseProfile = () => held.noise;
