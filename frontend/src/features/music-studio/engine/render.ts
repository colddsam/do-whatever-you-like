import { SAMPLE_RATE } from "../constants";
import { projectLength, spb } from "../lib/project";
import type { Project } from "../types";
import { loadBuffer } from "./assets";
import { dbToGain, loudness } from "./dsp";
import { drumBuffer, isKit } from "./drums";
import { ProjectGraph } from "./graph";
import { prewarm } from "./instruments";

/**
 * Offline mixdown: the same graph as live playback, rendered faster than real time by an
 * OfflineAudioContext. Used for export, stems, bouncing a track and the mastering preview.
 */

export type RenderOptions = { from?: number; to?: number; only?: string; tail?: number; sampleRate?: number; onProgress?: (f: number) => void };

export async function renderProject(p: Project, opts: RenderOptions = {}): Promise<AudioBuffer> {
  const from = Math.max(0, opts.from ?? 0);
  const to = Math.max(from + 0.25, opts.to ?? projectLength(p));
  const sr = opts.sampleRate ?? SAMPLE_RATE;
  const tail = opts.tail ?? 2.5;
  const seconds = (to - from) * spb(p) + tail;
  if (seconds > 30 * 60) throw new Error("Songs up to 30 minutes can be exported at once.");

  const ids = new Set<string>();
  for (const c of Object.values(p.clips)) if (c.assetId) ids.add(c.assetId);
  for (const t of p.tracks) if (t.sampleAssetId) ids.add(t.sampleAssetId);
  await Promise.all([...ids].map((id) => loadBuffer(id)));
  for (const t of p.tracks) {
    const pitches = new Set<number>();
    for (const c of Object.values(p.clips)) if (c.trackId === t.id) for (const n of c.notes ?? []) pitches.add(n.pitch);
    if (isKit(t.instrument)) for (const pt of pitches) drumBuffer(t.instrument, pt);
    else if (t.kind !== "audio") prewarm(t.instrument, pitches, t.tweaks);
  }

  // Rendering one track (a stem or a bounce): solo it, whatever the mixer says.
  const project: Project = opts.only ? { ...p, tracks: p.tracks.map((t) => ({ ...t, solo: t.id === opts.only, mute: t.id === opts.only ? false : t.mute })) } : p;

  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const graph = new ProjectGraph(ctx, ctx.destination);
  graph.sync(project);
  const beat = spb(p);
  graph.schedule(project, from, to, (b) => (b - from) * beat, true);

  if (opts.onProgress) {
    // Pause every few seconds of output to report progress (Chrome, Edge, Safari, Firefox 117+).
    const step = Math.max(2, seconds / 40);
    try {
      for (let t = step; t < seconds; t += step) {
        const at = t;
        void ctx.suspend(at).then(() => {
          opts.onProgress!(at / seconds);
          void ctx.resume();
        });
      }
    } catch {
      /* no suspend(): no progress, same result */
    }
  }
  const out = await ctx.startRendering();
  graph.dispose();
  opts.onProgress?.(1);
  return out;
}

/** Trims silence after the last sound (keeps a short natural tail). */
export function trimTail(buf: AudioBuffer, keepSec = 0.4): AudioBuffer {
  let last = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) {
      if (Math.abs(d[i]) > 1e-4) {
        last = i;
        break;
      }
    }
  }
  const len = Math.min(buf.length, Math.max(1, last + Math.round(keepSec * buf.sampleRate)));
  if (len >= buf.length) return buf;
  const out = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c).slice(0, len);
    const fade = Math.min(len, Math.round(0.05 * buf.sampleRate));
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    out.copyToChannel(d, c);
  }
  return out;
}

/**
 * Loudness normalisation for release: gain to the target LUFS, then a soft ceiling so nothing
 * clips (a final safety stage after the master chain's limiter).
 */
export function normalizeLoudness(buf: AudioBuffer, targetLufs: number, ceilingDb = -1): { buffer: AudioBuffer; before: number; after: number } {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const before = loudness(chans, buf.sampleRate);
  if (!Number.isFinite(before)) return { buffer: buf, before, after: before };
  const gain = dbToGain(Math.max(-24, Math.min(24, targetLufs - before)));
  const ceil = dbToGain(ceilingDb);
  const knee = ceil * 0.85;
  const out = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  chans.forEach((ch, c) => {
    const d = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] * gain;
      const a = Math.abs(v);
      d[i] = a <= knee ? v : Math.sign(v) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
    }
    out.copyToChannel(d, c);
  });
  const after = loudness(Array.from({ length: out.numberOfChannels }, (_, c) => out.getChannelData(c)), out.sampleRate);
  return { buffer: out, before, after };
}
