import { AudioLines, FileSpreadsheet, FileText, Film, Presentation, FileStack, type LucideIcon } from "lucide-react";

/**
 * Merge/split families, mirrored from backend/app/services/merge_split/common.py.
 * Files merge only with files of the same family.
 */
export type Family = "pdf" | "word" | "slides" | "sheet" | "audio" | "video";

export const FAMILIES: Record<Family, { exts: string[]; one: string; many: string; label: string; icon: LucideIcon }> = {
  pdf: { exts: ["pdf"], one: "PDF", many: "PDFs", label: "PDF", icon: FileStack },
  word: { exts: ["docx", "doc", "odt", "rtf", "docm", "dotx"], one: "document", many: "documents", label: "Word", icon: FileText },
  slides: { exts: ["pptx", "ppt", "odp", "pps", "ppsx", "pptm"], one: "presentation", many: "presentations", label: "PowerPoint", icon: Presentation },
  sheet: { exts: ["xlsx", "xls", "ods", "xlsm", "csv", "tsv"], one: "spreadsheet", many: "spreadsheets", label: "Excel / CSV", icon: FileSpreadsheet },
  audio: { exts: ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "wma", "aiff", "aif", "weba", "amr"], one: "audio file", many: "audio files", label: "Audio", icon: AudioLines },
  video: { exts: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "3gp", "mpeg", "mpg", "mts", "m2ts", "ogv"], one: "video", many: "videos", label: "Video", icon: Film },
};

export const FAMILY_ORDER: Family[] = ["word", "slides", "sheet", "pdf", "audio", "video"];
export const ALL_EXTS = FAMILY_ORDER.flatMap((f) => FAMILIES[f].exts);
export const ACCEPT_ALL = ALL_EXTS.map((e) => `.${e}`).join(",");

export const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

export function familyOf(name: string): Family | null {
  const ext = extOf(name);
  return FAMILY_ORDER.find((f) => FAMILIES[f].exts.includes(ext)) ?? null;
}

export const MAX_FILES = 20;
export const MAX_MB = 150;

/** What the backend says it did, in X-Convert-Info. */
export type JobInfo = { family?: string; parts?: number; notes: string[] };

export function parseJobInfo(raw?: string): JobInfo {
  try {
    const v = JSON.parse(raw ?? "{}") as Partial<JobInfo>;
    return { family: v.family, parts: v.parts, notes: Array.isArray(v.notes) ? v.notes : [] };
  } catch {
    return { notes: [] };
  }
}

/** 90 → "1:30", 3725 → "1:02:05". */
export function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "1:30" / "90" / "1:02:00" → seconds, or null. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  return t.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** How long an audio or video file is, read by the browser (null if it can't play the format). */
export function mediaDuration(file: File, kind: "audio" | "video"): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(v);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    el.src = url;
  });
}
