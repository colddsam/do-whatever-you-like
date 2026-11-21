import { BASE_TEXT_STYLE, CAPTION_STYLES } from "../constants";
import { rt } from "../lib/time";
import * as TL from "../lib/timeline";
import { useStudio } from "../store/studio-store";
import type { CaptionStyleId, Clip, Project, WordTiming } from "../types";

/**
 * Subtitle files: export captions as SRT (YouTube, Facebook, most players) or WebVTT (the web), and
 * import either format as caption clips. Imported lines get estimated per-word timing (shared out
 * by word length), so karaoke and word-pop styles still work on them.
 */

export type Cue = { start: number; end: number; text: string };

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
function stamp(t: number, sep: "," | ".") {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${pad(ms / 3_600_000)}:${pad((ms / 60_000) % 60)}:${pad((ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text.trim()}\n`).join("\n");
}

export function toVtt(cues: Cue[]) {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text.trim()}\n`).join("\n")}`;
}

function parseStamp(s: string) {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s.trim());
  if (!m) return NaN;
  return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000);
}

/** Reads SRT or WebVTT (tags like <i> and positioning cues are dropped). */
export function parseSubtitles(text: string): Cue[] {
  const out: Cue[] = [];
  const blocks = text.replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim());
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, z] = lines[i].split("-->");
    const start = parseStamp(a);
    const end = parseStamp(z.split(/\s+/).filter(Boolean)[0] ?? "");
    const body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]+\}/g, "")
      .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && body) out.push({ start, end, text: body });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** The caption clips to export: the "Captions" track if there is one, else every text clip. */
export function captionCues(p: Project): Cue[] {
  const captionTrack = p.tracks.find((t) => t.kind === "overlay" && t.name === "Captions");
  const clips = Object.values(p.clips)
    .filter((c) => c.kind === "text" && c.text && (captionTrack ? c.trackId === captionTrack.id : true))
    .sort((a, b) => a.start - b.start);
  return clips.map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text!.text }));
}

function estimateWords(text: string, duration: number): WordTiming[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((n, w) => n + w.length + 1, 0) || 1;
  let at = 0;
  return parts.map((w) => {
    const d = (duration * (w.length + 1)) / total;
    const word = { text: w, start: rt(at), end: rt(at + d) };
    at += d;
    return word;
  });
}

/** Adds subtitle cues as caption clips on a new "Captions" track. */
export function importCues(cues: Cue[], style: CaptionStyleId = "clean", name = "Captions") {
  if (!cues.length) throw new Error("No subtitles were found in that file.");
  const st = useStudio.getState();
  st.commit((p) => {
    const [withTrack, trackId] = TL.addTrack(p, "overlay");
    const next = TL.updateTrack(withTrack, trackId, { name });
    const y = next.settings.height > next.settings.width ? 0.7 : 0.82;
    const s = { ...BASE_TEXT_STYLE, ...CAPTION_STYLES[style].style };
    const clips: Clip[] = cues.map((c) =>
      TL.newClip(next, {
        trackId,
        kind: "text",
        name: c.text.split("\n")[0].slice(0, 40),
        start: rt(c.start),
        duration: rt(Math.max(0.2, c.end - c.start)),
        transform: TL.baseTransform(next, y),
        text: { text: c.text, style: s, words: estimateWords(c.text.replace(/\n/g, " "), c.end - c.start) },
      }),
    );
    return TL.placeClips(next, clips);
  });
  st.notify(`Added ${cues.length} subtitle${cues.length === 1 ? "" : "s"}.`, "success");
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function exportSubtitles(format: "srt" | "vtt") {
  const p = useStudio.getState().project;
  const cues = captionCues(p);
  if (!cues.length) throw new Error("There are no captions or text clips to export yet.");
  const body = format === "srt" ? toSrt(cues) : toVtt(cues);
  download(new Blob([body], { type: format === "srt" ? "application/x-subrip" : "text/vtt" }), `${p.name || "captions"}.${format}`);
  return cues.length;
}

/** Translates every caption into another language (the site's free translator), as a new caption track. */
export async function translateCaptions(target: string, label: string) {
  const p = useStudio.getState().project;
  const cues = captionCues(p);
  if (!cues.length) throw new Error("Generate or import captions first.");
  const res = await fetch("/api/tools/translate/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: cues.map((c) => c.text), source: "auto", target }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(j?.detail || "The translator didn't answer. Try again in a moment.");
  }
  const j = (await res.json()) as { translated_texts?: string[]; translations?: string[] };
  const out = j.translated_texts ?? j.translations ?? [];
  if (out.length !== cues.length) throw new Error("The translation came back incomplete.");
  importCues(
    cues.map((c, i) => ({ ...c, text: out[i] || c.text })),
    "clean",
    `Captions (${label})`,
  );
}
