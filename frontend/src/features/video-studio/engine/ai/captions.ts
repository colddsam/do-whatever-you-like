import { ASR_RATE, BASE_TEXT_STYLE, CAPTION_STYLES } from "../../constants";
import { localForSrc, srcSpan } from "../../lib/speed";
import { rt } from "../../lib/time";
import * as TL from "../../lib/timeline";
import { useStudio } from "../../store/studio-store";
import type { CaptionStyleId, Clip, Project, WordTiming } from "../../types";
import { extractPcm } from "../audio";
import { mediaRuntime } from "../media";
import { aiWorker, progressLabel } from "./client";

/**
 * Auto-captions, CapCut style: the sound of the chosen clips is resampled to 16 kHz mono, cut into
 * windows of up to 28 s at the quietest moment near each boundary (so words aren't split), and
 * transcribed by Whisper in the AI worker. Words come back with their times; they're grouped into
 * short lines and placed as caption clips on a Captions track, each with per-word timing for the
 * karaoke and word-pop styles.
 */

export type Progress = (label: string, fraction?: number) => void;

/** The sound clips to work on: the selection's audio (a video's linked sound), else every clip with sound. */
export function soundClips(p: Project, selection: string[]): Clip[] {
  const out = new Map<string, Clip>();
  const add = (c: Clip | undefined) => {
    if (c && c.kind === "audio" && c.mediaId && !c.muted) out.set(c.id, c);
  };
  for (const id of selection) {
    const c = p.clips[id];
    if (!c) continue;
    add(c);
    for (const l of TL.linked(p, c)) add(l);
  }
  if (!out.size) {
    for (const t of p.tracks) if (t.kind === "audio" && !t.muted) for (const c of TL.clipsOnTrack(p, t.id)) add(c);
  }
  return [...out.values()].sort((a, b) => a.start - b.start);
}

/** Window boundaries (in samples) at the quietest 40 ms within the last 4 s before each limit. */
function windows(pcm: Float32Array, rate: number, maxSec = 28) {
  const max = Math.floor(maxSec * rate);
  const out: [number, number][] = [];
  let s = 0;
  while (s < pcm.length) {
    let e = Math.min(pcm.length, s + max);
    if (e < pcm.length) {
      const win = Math.floor(0.04 * rate);
      let best = e;
      let bestE = Infinity;
      for (let k = e - 4 * rate; k + win <= e; k += win) {
        let en = 0;
        for (let i = k; i < k + win; i++) en += pcm[i] * pcm[i];
        if (en < bestE) {
          bestE = en;
          best = k + (win >> 1);
        }
      }
      e = Math.max(s + rate, best);
    }
    out.push([s, e]);
    s = e;
  }
  return out;
}

const NOISE = /^[[(].*[\])]$|^\*.*\*$/;

function groupLines(words: WordTiming[], maxWords: number, maxChars: number) {
  const lines: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  const chars = (l: WordTiming[]) => l.reduce((n, w) => n + w.text.length + 1, 0);
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (
      last &&
      (cur.length >= maxWords || chars(cur) + w.text.length > maxChars || w.start - last.end > 0.7 || w.end - cur[0].start > 3.4 || /[.!?…]$/.test(last.text))
    ) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export async function autoCaptions(opts: { style: CaptionStyleId; maxWords: number; language?: string; translate?: boolean }, onProgress: Progress): Promise<number> {
  // Languages written without spaces between words.
  const joiner = /^(zh|ja|th|lo|my|km)$/.test(opts.language ?? "") && !opts.translate ? "" : " ";
  const s = useStudio.getState();
  const sources = soundClips(s.project, s.selection);
  if (!sources.length) throw new Error("Add a clip with sound first, then generate captions.");
  const words: WordTiming[] = [];
  let mode = "words";
  for (const [i, c] of sources.entries()) {
    const file = mediaRuntime.file(c.mediaId!);
    if (!file) continue;
    const span = srcSpan(c);
    const label = sources.length > 1 ? ` (clip ${i + 1} of ${sources.length})` : "";
    const pcm = await extractPcm(file, c.in, c.in + span, ASR_RATE, (f) => onProgress(`Reading the sound${label}`, f));
    const wins = windows(pcm, ASR_RATE);
    for (const [k, [a, b]] of wins.entries()) {
      const chunk = pcm.slice(a, b);
      const res = await aiWorker.transcribe(
        chunk,
        (p) => {
          const pl = progressLabel(p);
          onProgress(pl.label, pl.fraction);
        },
        { language: opts.language, translate: opts.translate },
      );
      onProgress(`Writing captions${label}`, (k + 1) / wins.length);
      if (!res.wordLevel) mode = "phrases";
      const offset = a / ASR_RATE;
      for (const ch of res.chunks ?? []) {
        const text = ch.text.trim();
        if (!text || NOISE.test(text)) continue;
        const t0 = offset + ch.timestamp[0];
        const t1 = offset + (ch.timestamp[1] ?? ch.timestamp[0] + 0.4);
        const toTimeline = (x: number) => rt(c.start + localForSrc(c, x));
        if (res.wordLevel) words.push({ text, start: toTimeline(t0), end: toTimeline(Math.max(t1, t0 + 0.05)) });
        else {
          // Phrase timing only: share the phrase's time out between its words by length.
          const parts = text.split(/\s+/).filter(Boolean);
          const total = parts.reduce((n, w) => n + w.length + 1, 0);
          let at = t0;
          for (const w of parts) {
            const d = ((t1 - t0) * (w.length + 1)) / total;
            words.push({ text: w, start: toTimeline(at), end: toTimeline(at + d) });
            at += d;
          }
        }
      }
    }
  }
  if (!words.length) throw new Error("No speech was found in that sound.");
  words.sort((a, b) => a.start - b.start);

  const st = useStudio.getState();
  const p = st.project;
  const style = { ...BASE_TEXT_STYLE, maxWidth: 0.86, ...CAPTION_STYLES[opts.style].style };
  const maxChars = Math.max(10, Math.floor((p.settings.width * style.maxWidth) / (style.size * 0.58)));
  const lines = groupLines(words, opts.maxWords, maxChars);
  const y = p.settings.height > p.settings.width ? 0.7 : 0.82;
  st.commit((proj) => {
    let next = proj;
    let trackId = next.tracks.find((t) => t.kind === "overlay" && t.name === "Captions")?.id;
    if (!trackId) {
      [next, trackId] = TL.addTrack(next, "overlay");
      next = TL.updateTrack(next, trackId, { name: "Captions" });
    }
    const clips: Clip[] = lines.map((line, i) => {
      const start = line[0].start;
      const nextStart = lines[i + 1]?.[0].start ?? Infinity;
      const end = Math.min(nextStart, Math.max(line[line.length - 1].end + 0.15, start + 0.4));
      return TL.newClip(next, {
        trackId: trackId!,
        kind: "text",
        name: line.map((w) => w.text).join(joiner).slice(0, 40),
        start,
        duration: rt(Math.max(0.2, end - start)),
        transform: TL.baseTransform(next, y),
        text: {
          text: line.map((w) => w.text).join(joiner),
          style,
          words: line.map((w) => ({ text: w.text, start: rt(w.start - start), end: rt(w.end - start) })),
        },
      });
    });
    return TL.placeClips(next, clips);
  });
  st.notify(`Added ${lines.length} caption${lines.length === 1 ? "" : "s"}${mode === "phrases" ? " (word timing estimated)" : ""}.`, "success");
  return lines.length;
}
