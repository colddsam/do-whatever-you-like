/** SRT and WebVTT subtitles: read, edit, shift and write. Times are in milliseconds. */

export type Cue = { id: number; start: number; end: number; text: string };

let nextId = 1;
export const newId = () => nextId++;

/** "01:02:03,450", "02:03.450", "1:02:03.4" → ms. */
export function parseTime(t: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(t);
  if (!m) return null;
  const [, h, mi, s, ms] = m;
  return ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + Number((ms ?? "0").padEnd(3, "0"));
}

export function formatTime(ms: number, kind: "srt" | "vtt"): string {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3_600_000);
  const m = Math.floor(v / 60_000) % 60;
  const s = Math.floor(v / 1000) % 60;
  const f = v % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${kind === "srt" ? "," : "."}${p(f, 3)}`;
}

/** Reads SRT or VTT (detected), tolerant of stray blank lines, BOMs and missing numbers. */
export function parseSubtitles(text: string): { cues: Cue[]; format: "srt" | "vtt"; skipped: number } {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const format = /^WEBVTT/.test(src.trimStart()) ? "vtt" : "srt";
  const blocks = src.split(/\n{2,}/);
  const cues: Cue[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const lines = block.split("\n").filter((l, i) => i > 0 || l.trim());
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at === -1) {
      if (block.trim() && !/^(WEBVTT|NOTE|STYLE|REGION)/.test(block.trim())) skipped++;
      continue;
    }
    const [a, b] = lines[at].split("-->");
    const start = parseTime(a);
    const end = parseTime(b.trim().split(/\s+/)[0]);
    if (start === null || end === null) {
      skipped++;
      continue;
    }
    cues.push({ id: newId(), start, end, text: lines.slice(at + 1).join("\n").trim() });
  }
  return { cues, format, skipped };
}

export function writeSubtitles(cues: Cue[], kind: "srt" | "vtt" | "txt"): string {
  const sorted = [...cues].sort((x, y) => x.start - y.start);
  if (kind === "txt") return sorted.map((c) => c.text.replace(/<[^>]+>/g, "")).join("\n") + "\n";
  const body = sorted
    .map((c, i) => `${kind === "srt" ? `${i + 1}\n` : ""}${formatTime(c.start, kind)} --> ${formatTime(c.end, kind)}\n${c.text}`)
    .join("\n\n");
  return (kind === "vtt" ? "WEBVTT\n\n" : "") + body + "\n";
}

/** Cues that overlap the next one, or end before they start. */
export function problems(cues: Cue[]): Set<number> {
  const sorted = [...cues].sort((x, y) => x.start - y.start);
  const bad = new Set<number>();
  sorted.forEach((c, i) => {
    if (c.end <= c.start) bad.add(c.id);
    const next = sorted[i + 1];
    if (next && c.end > next.start) {
      bad.add(c.id);
      bad.add(next.id);
    }
  });
  return bad;
}

/** Ends every overlapping cue 1 ms before the next starts. */
export function fixOverlaps(cues: Cue[]): Cue[] {
  const sorted = [...cues].sort((x, y) => x.start - y.start);
  return sorted.map((c, i) => {
    const next = sorted[i + 1];
    const end = next && c.end > next.start ? Math.max(c.start + 1, next.start - 1) : c.end;
    return { ...c, end: Math.max(end, c.start + 1) };
  });
}
