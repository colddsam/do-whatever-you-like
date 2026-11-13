import {
  Archive,
  AudioLines,
  Captions,
  Code2,
  Database,
  FileText,
  Film,
  ImageIcon,
  Library,
  Mail,
  PenTool,
  Presentation,
  Sheet,
  Type,
  FileCode2,
  type LucideIcon,
} from "lucide-react";
import catalogueJson from "./universal-formats.json";

/*
 * The universal converter's formats and routes. A copy ships with the site
 * (universal-formats.json, from backend/scripts/export_universal_formats.py) so the picker works at
 * once; the live server's list replaces it when it answers, leaving out anything that server lacks.
 */

export type Format = { id: string; label: string; category: string; extensions: string[] };
export type Route = {
  target: string;
  /** Engines used, one per step: ["LibreOffice", "PyMuPDF"]. */
  engines: string[];
  /** Formats passed through on the way: ["pdf"]. */
  via: string[];
  /** May come as a ZIP (one file per page, sheet or slide). */
  bundle: boolean;
};
export type Catalogue = {
  categories: { id: string; label: string }[];
  formats: Record<string, Format>;
  routes: Record<string, Route[]>;
  /** False when this came from the copy shipped with the site, not the live server. */
  live: boolean;
};

type Compact = {
  categories: [string, string][];
  formats: [string, string, string, string[]][];
  routes: Record<string, [string, string[], string[], number][]>;
};
type LiveAnswer = {
  categories: { id: string; label: string }[];
  formats: Format[];
  routes: Record<string, { target: string; steps: { source: string; target: string; engine: string }[]; bundle: boolean }[]>;
};

function fromCompact(c: Compact): Catalogue {
  return {
    categories: c.categories.map(([id, label]) => ({ id, label })),
    formats: Object.fromEntries(c.formats.map(([id, label, category, extensions]) => [id, { id, label, category, extensions }])),
    routes: Object.fromEntries(
      Object.entries(c.routes).map(([src, list]) => [
        src,
        list.map(([target, engines, via, bundle]) => ({ target, engines, via, bundle: Boolean(bundle) })),
      ]),
    ),
    live: false,
  };
}

function fromLive(a: LiveAnswer): Catalogue {
  return {
    categories: a.categories,
    formats: Object.fromEntries(a.formats.map((f) => [f.id, f])),
    routes: Object.fromEntries(
      Object.entries(a.routes).map(([src, list]) => [
        src,
        list.map((r) => ({
          target: r.target,
          engines: r.steps.map((s) => s.engine),
          via: r.steps.slice(0, -1).map((s) => s.target),
          bundle: r.bundle,
        })),
      ]),
    ),
    live: true,
  };
}

export const STATIC_CATALOGUE: Catalogue = fromCompact(catalogueJson as unknown as Compact);

let liveRequest: Promise<Catalogue | null> | null = null;
/** The live server's catalogue, asked once per page load; null if it can't be reached. */
export function loadLiveCatalogue(): Promise<Catalogue | null> {
  liveRequest ??= fetch("/api/tools/universal/formats")
    .then((r) => (r.ok ? (r.json() as Promise<LiveAnswer>) : null))
    .then((a) => (a && Array.isArray(a.formats) ? fromLive(a) : null))
    .catch(() => null);
  return liveRequest;
}

/** Which format a file is, from its name (longest extension first, so "x.tar.gz" is TAR.GZ). Mirrors formats.py. */
export function detectFormat(name: string, cat: Catalogue = STATIC_CATALOGUE): string | null {
  const lower = name.toLowerCase();
  let best: { id: string; len: number } | null = null;
  for (const f of Object.values(cat.formats)) {
    for (const ext of f.extensions) {
      if (lower.endsWith(ext) && lower.length > ext.length && (!best || ext.length > best.len)) best = { id: f.id, len: ext.length };
    }
  }
  return best?.id ?? null;
}

/** How a format id is shown: "PDF", "TAR.GZ", "DOCX". */
export const extLabel = (id: string) => id.toUpperCase();

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  document: FileText,
  markup: FileCode2,
  ebook: Library,
  spreadsheet: Sheet,
  data: Database,
  presentation: Presentation,
  drawing: PenTool,
  image: ImageIcon,
  audio: AudioLines,
  video: Film,
  subtitle: Captions,
  font: Type,
  archive: Archive,
  code: Code2,
  email: Mail,
};

/**
 * What people usually want from each kind of file, best first. Shown as the "Most asked" row, so the
 * common jobs are one click away; everything else is in the full grid.
 */
const SUGGESTED: Record<string, string[]> = {
  pdf: ["docx", "jpg", "xlsx", "pptx", "txt", "png"],
  docx: ["pdf", "odt", "txt", "md", "html", "epub"],
  doc: ["docx", "pdf", "odt", "txt"],
  odt: ["docx", "pdf", "txt"],
  rtf: ["docx", "pdf", "txt"],
  txt: ["pdf", "docx", "md", "html"],
  md: ["pdf", "docx", "html", "epub"],
  html: ["pdf", "docx", "md", "txt"],
  epub: ["pdf", "docx", "txt", "md"],
  xlsx: ["csv", "pdf", "json", "ods"],
  xls: ["xlsx", "csv", "pdf"],
  ods: ["xlsx", "csv", "pdf"],
  csv: ["xlsx", "json", "pdf", "sql"],
  tsv: ["csv", "xlsx", "json"],
  json: ["csv", "xlsx", "yaml", "xml"],
  jsonl: ["json", "csv", "xlsx"],
  xml: ["json", "csv", "xlsx", "yaml"],
  yaml: ["json", "toml", "xml"],
  toml: ["json", "yaml"],
  pptx: ["pdf", "jpg", "odp", "png"],
  ppt: ["pptx", "pdf", "jpg"],
  odp: ["pptx", "pdf"],
  heic: ["jpg", "png", "pdf", "webp"],
  png: ["jpg", "webp", "pdf", "ico"],
  jpg: ["png", "pdf", "webp", "txt"],
  webp: ["jpg", "png", "gif"],
  gif: ["mp4", "webp", "png"],
  svg: ["png", "pdf", "jpg"],
  avif: ["jpg", "png"],
  tiff: ["pdf", "jpg", "png"],
  mp4: ["mp3", "gif", "webm", "mov"],
  mov: ["mp4", "mp3", "gif"],
  mkv: ["mp4", "mp3"],
  webm: ["mp4", "mp3", "gif"],
  avi: ["mp4", "mp3"],
  wav: ["mp3", "flac", "m4a"],
  mp3: ["wav", "m4a", "ogg"],
  m4a: ["mp3", "wav"],
  flac: ["mp3", "wav"],
  ogg: ["mp3", "wav"],
  srt: ["vtt", "txt", "ass"],
  vtt: ["srt", "txt"],
  ttf: ["woff2", "woff", "otf"],
  otf: ["woff2", "ttf", "woff"],
  woff: ["ttf", "woff2"],
  woff2: ["ttf", "woff"],
  zip: ["7z", "tar.gz"],
  "7z": ["zip", "tar.gz"],
  ipynb: ["py", "html", "pdf", "md"],
  eml: ["pdf", "html", "txt"],
};

export function suggestedTargets(source: string, routes: Route[]): Route[] {
  const byTarget = new Map(routes.map((r) => [r.target, r]));
  const picks = (SUGGESTED[source] ?? []).map((t) => byTarget.get(t)).filter((r): r is Route => Boolean(r));
  if (picks.length) return picks.slice(0, 6);
  // Source code and anything unlisted: the first few the graph found.
  return routes.slice(0, 4);
}

/** Search across a format's id, name, extensions and category: "word", "jpeg", "excel", "subtitles". */
export function matchesFormat(f: Format, categoryLabel: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^\./, "");
  if (!q) return true;
  const hay = [f.id, f.label, categoryLabel, ...f.extensions].join(" ").toLowerCase();
  const alias: Record<string, string> = { word: "docx doc", excel: "xlsx xls", powerpoint: "pptx ppt", jpeg: "jpg", photo: "jpg png heic", picture: "jpg png", sheet: "xlsx", slides: "pptx" };
  return q.split(/\s+/).every((t) => hay.includes(t) || (alias[t] ?? "").split(" ").includes(f.id));
}

/** "LibreOffice" or "pdf2docx, then Pandoc", for the line that says how a conversion happens. */
export function describeRoute(route: Route): string {
  const engines = route.engines.filter((e, i) => route.engines.indexOf(e) === i);
  return engines.length > 1 ? `${engines.slice(0, -1).join(", ")}, then ${engines[engines.length - 1]}` : engines[0];
}
