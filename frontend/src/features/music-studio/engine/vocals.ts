import { SAMPLE_RATE } from "../constants";
import { lineWords, scaleNotes, syllables } from "../lib/theory";
import type { Note, ScaleId } from "../types";
import { autotune, mixDown, timeStretch } from "./dsp";

/**
 * The singer. Lyrics are spoken by a free neural voice (Microsoft Edge's online voices, through
 * the site's backend) with each word's timing; then, on this device, every word is stretched onto
 * the melody notes the composer gave its syllables and pitch-corrected to those notes, with a
 * touch of vibrato on held notes. Rap mode keeps the voice's own pitch and fits each line to its
 * two bars.
 */

export type VocalLine = { text: string; notes: Note[]; start: number };
type Word = { text: string; start: number; end: number };

const ttsCache = new Map<string, Promise<{ pcm: Float32Array; words: Word[] }>>();

async function speak(text: string, voice: string, rate: number): Promise<{ pcm: Float32Array; words: Word[] }> {
  const key = `${voice}|${rate}|${text}`;
  let p = ttsCache.get(key);
  if (!p) {
    p = (async () => {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch("/api/tools/studio/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, rate, pitch: 0 }),
          signal: AbortSignal.timeout(70_000),
        }).catch(() => null);
        if (res?.ok) break;
        // The free backend may be waking up: wait and try again.
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      if (!res?.ok) {
        const j = (await res?.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(j?.detail || "The singing voice service didn't answer. Try again in a minute.");
      }
      const j = (await res.json()) as { audio: string; words: Word[] };
      const bin = Uint8Array.from(atob(j.audio), (ch) => ch.charCodeAt(0));
      const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
      const buf = await ctx.decodeAudioData(bin.buffer);
      const pcm = buf.numberOfChannels > 1 ? mixDown([buf.getChannelData(0), buf.getChannelData(1)]) : buf.getChannelData(0).slice();
      return { pcm, words: j.words ?? [] };
    })();
    ttsCache.set(key, p);
    p.catch(() => ttsCache.delete(key));
  }
  return p;
}

/** Diatonic third above a note (for the harmony voice). */
function thirdAbove(pitch: number, keyRoot: number, scale: ScaleId) {
  const pcs = scaleNotes(keyRoot, scale);
  let p = pitch + 1;
  let steps = 0;
  while (steps < 2 && p < pitch + 6) {
    if (pcs.includes(((p % 12) + 12) % 12)) steps++;
    if (steps < 2) p++;
  }
  return p;
}

/** Words from the TTS timings, falling back to our own split when they don't line up. */
function alignWords(text: string, words: Word[], duration: number): Word[] {
  const ours = lineWords(text);
  if (words.length && words.length >= ours.length * 0.6) return words;
  // Spread our words over the clip in proportion to their syllables.
  const syl = ours.map((w) => Math.max(1, syllables(w)));
  const total = syl.reduce((a, b) => a + b, 0);
  let t = 0.05;
  const span = Math.max(0.2, duration - 0.1);
  return ours.map((w, i) => {
    const d = (span * syl[i]) / total;
    const out = { text: w, start: t, end: t + d };
    t += d;
    return out;
  });
}

function fadeEdges(x: Float32Array, sr: number, ms = 6) {
  const n = Math.min(Math.floor(x.length / 2), Math.round((ms / 1000) * sr));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

/** Sings one line onto `out` (song-length buffer). Returns nothing; adds in place. */
function singLine(out: Float32Array, pcm: Float32Array, words: Word[], notes: Note[], spbSec: number, opts: { harmony?: { keyRoot: number; scale: ScaleId } }) {
  const sr = SAMPLE_RATE;
  const sylPerWord = words.map((w) => Math.max(1, syllables(w.text)));
  const totalSyl = sylPerWord.reduce((a, b) => a + b, 0);
  const sorted = notes.slice().sort((a, b) => a.start - b.start);
  if (!sorted.length) return;
  // Syllable k sings note floor(k * notes / syllables): extra syllables share a note.
  let k = 0;
  words.forEach((w, wi) => {
    const first = Math.floor((k * sorted.length) / totalSyl);
    k += sylPerWord[wi];
    const last = Math.max(first, Math.floor(((k - 1) * sorted.length) / totalSyl));
    const myNotes = sorted.slice(first, last + 1);
    // A word sharing a note with the next word gets only its share of that note.
    const startBeat = myNotes[0].start;
    const endBeat = myNotes[myNotes.length - 1].start + myNotes[myNotes.length - 1].length;
    const share = sorted.length < totalSyl && wi < words.length - 1 && Math.floor((k * sorted.length) / totalSyl) === last ? 0.5 : 1;
    const targetSec = Math.max(0.06, (endBeat - startBeat) * spbSec * share);
    const a = Math.max(0, Math.round((w.start - 0.02) * sr));
    const b = Math.min(pcm.length, Math.round((w.end + 0.03) * sr));
    if (b - a < sr * 0.03) return;
    const seg = pcm.subarray(a, b);
    const segSec = seg.length / sr;
    // Stretch the word to its notes (limits keep it intelligible).
    const rate = Math.max(0.3, Math.min(2.5, segSec / targetSec));
    const stretched = Math.abs(rate - 1) > 0.03 ? timeStretch(seg, sr, rate) : seg.slice();
    // Which note is wanted at each moment of the stretched word.
    const spans = myNotes.map((n) => ({ t: (n.start - startBeat) * spbSec, len: n.length * spbSec, pitch: opts.harmony ? thirdAbove(n.pitch, opts.harmony.keyRoot, opts.harmony.scale) : n.pitch }));
    const targetAt = (sec: number) => {
      let cur = spans[0];
      for (const s of spans) if (sec >= s.t) cur = s;
      const into = sec - cur.t;
      // Natural vibrato on held notes, after a quarter second.
      const vib = cur.len > 0.45 && into > 0.25 ? 0.25 * Math.sin(2 * Math.PI * 5.4 * into) : 0;
      return cur.pitch + vib;
    };
    const tuned = fadeEdges(autotune(stretched, sr, { targetAt, strength: 1, speedMs: 12 }), sr);
    const o = Math.round((startBeat * spbSec - 0.01) * sr);
    const gain = opts.harmony ? 0.5 : 1;
    for (let i = 0; i < tuned.length && o + i < out.length; i++) if (o + i >= 0) out[o + i] += tuned[i] * gain;
  });
}

/** Rap: the line in the voice's own pitch, fitted into its bars and placed on the downbeat. */
function rapLine(out: Float32Array, pcm: Float32Array, notes: Note[], startBeat: number, spbSec: number) {
  const sr = SAMPLE_RATE;
  const end = notes.length ? Math.max(...notes.map((n) => n.start + n.length)) : startBeat + 7;
  const window = Math.max(0.5, (end - startBeat) * spbSec * 0.95);
  const dur = pcm.length / sr;
  const rate = Math.max(0.8, Math.min(1.45, dur / window));
  const x = fadeEdges(Math.abs(rate - 1) > 0.03 ? timeStretch(pcm, sr, rate) : pcm.slice(), sr);
  const o = Math.round(startBeat * spbSec * sr);
  for (let i = 0; i < x.length && o + i < out.length; i++) out[o + i] += x[i];
}

export type SingOptions = {
  voice: string;
  style: "sung" | "rap";
  bpm: number;
  keyRoot: number;
  scale: ScaleId;
  harmony: boolean;
  seconds: number;
  onProgress?: (f: number, label: string) => void;
};

/**
 * Sings every line. Returns the lead vocal (and a harmony for choruses when asked) as mono PCM
 * covering the whole song.
 */
export async function sing(lines: (VocalLine & { chorus?: boolean })[], o: SingOptions): Promise<{ lead: Float32Array; harmony: Float32Array | null }> {
  const sr = SAMPLE_RATE;
  const spbSec = 60 / o.bpm;
  const lead = new Float32Array(Math.ceil((o.seconds + 2) * sr));
  const harmony = o.harmony && o.style === "sung" ? new Float32Array(lead.length) : null;
  // Fetch the voice for every distinct line, three at a time (choruses repeat, so fewer calls).
  const unique = [...new Set(lines.map((l) => l.text))];
  const results = new Map<string, { pcm: Float32Array; words: Word[] }>();
  let done = 0;
  const queue = [...unique];
  const worker = async () => {
    while (queue.length) {
      const text = queue.shift()!;
      results.set(text, await speak(text, o.voice, o.style === "rap" ? 12 : 0));
      done++;
      o.onProgress?.((done / unique.length) * 0.6, `Recording the singer · line ${done} of ${unique.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  let i = 0;
  for (const line of lines) {
    const r = results.get(line.text);
    i++;
    if (!r) continue;
    if (o.style === "rap") rapLine(lead, r.pcm, line.notes, line.start, spbSec);
    else {
      const words = alignWords(line.text, r.words, r.pcm.length / sr);
      singLine(lead, r.pcm, words, line.notes, spbSec, {});
      if (harmony && line.chorus) singLine(harmony, r.pcm, words, line.notes, spbSec, { harmony: { keyRoot: o.keyRoot, scale: o.scale } });
    }
    o.onProgress?.(0.6 + (i / lines.length) * 0.4, `Tuning the vocal · line ${i} of ${lines.length}`);
    // Let the page breathe between lines.
    await new Promise((res) => setTimeout(res, 0));
  }
  // Gentle peak normalisation (the vocal chain's compressor does the rest).
  let peak = 0;
  for (const v of lead) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let k = 0; k < lead.length; k++) lead[k] *= 0.95 / peak;
  return { lead, harmony };
}

/** Speaks a whole text (voice-overs, podcast intros): the clip plus word timings. */
export async function speakText(text: string, voice: string, rate = 0): Promise<{ pcm: Float32Array; words: Word[] }> {
  return speak(text, voice, rate);
}

/** Male voices sing lower: the melody's centre pitch for a voice id. */
export function singerCenter(label: string) {
  return /\bmale\b/i.test(label) && !/female/i.test(label) ? 52 : 64;
}
