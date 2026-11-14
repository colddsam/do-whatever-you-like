import { unzipSync } from "fflate";

/** Client helpers for the PDF toolkit. The rules here mirror backend/app/services/pdf.py. */

export type PdfMode = "merge" | "split" | "organize" | "compress";
export const PDF_MODES: PdfMode[] = ["merge", "split", "organize", "compress"];
export const isPdfMode = (v: string | null): v is PdfMode => PDF_MODES.includes(v as PdfMode);

export const PDF_MAX_MB = 150;
export const MERGE_MAX_FILES = 20;

/* ---------- Split: page ranges and parts ---------- */

export type PageRange = { from: number; to: number };
/** One output PDF: its ranges, in order. "1-3+5" is [{1,3},{5,5}]. */
export type Part = PageRange[];

/**
 * Parses split ranges the way the backend does (PDFService.parse_page_groups): commas separate
 * the PDFs you get, "+" joins ranges into the same PDF. "1-3, 5" → two PDFs; "1-3+5, 4" → pages
 * 1, 2, 3 and 5 together, then page 4 on its own. The page count is checked separately.
 */
export function parseRanges(input: string): { parts: Part[]; error: string | null } {
  const chunks = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!chunks.length) return { parts: [], error: "Type a page or a range, like 1-3, 5." };

  const parts: Part[] = [];
  for (const chunk of chunks) {
    const pieces = chunk.split("+").map((p) => p.trim());
    if (pieces.some((p) => !p)) return { parts, error: `“${chunk}” has a loose +. Join ranges like 1-3+5.` };
    const part: Part = [];
    for (const piece of pieces) {
      let from: number;
      let to: number;
      const dash = piece.indexOf("-");
      if (dash >= 0) {
        const a = piece.slice(0, dash).trim();
        const b = piece.slice(dash + 1).trim();
        if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return { parts, error: `“${piece}” isn't a range. Write it like 1-3.` };
        from = Number(a);
        to = Number(b);
      } else {
        if (!/^\d+$/.test(piece)) return { parts, error: `“${piece}” isn't a page number.` };
        from = to = Number(piece);
      }
      if (from < 1) return { parts, error: "Pages start at 1." };
      if (from > to) return { parts, error: `“${piece}” runs backwards. Try ${to}-${from}.` };
      part.push({ from, to });
    }
    parts.push(part);
  }
  return { parts, error: null };
}

/** Every page in a part, in order (1-based). */
export const partPages = (part: Part) => part.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, i) => from + i));

/** Pages → the shortest runs: [1,2,3,5] → "1-3+5". */
function runsOf(pages: number[]) {
  const runs: PageRange[] = [];
  for (const p of pages) {
    const last = runs[runs.length - 1];
    if (last && p === last.to + 1) last.to = p;
    else runs.push({ from: p, to: p });
  }
  return runs;
}

/** The text form of parts picked on the page grid: [[1,2,3,5],[4]] → "1-3+5, 4". Empty parts are dropped. */
export const serializeParts = (groups: number[][]) =>
  groups
    .filter((g) => g.length)
    .map((g) => runsOf(g).map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join("+"))
    .join(", ");

/** [1,2,3,5] → "Pages 1–3, 5", [4] → "Page 4". */
export const pagesLabel = (pages: number[]) => partLabel(runsOf(pages));

export const rangeLabel = ({ from, to }: PageRange) => (from === to ? `Page ${from}` : `Pages ${from}–${to}`);

/** "Page 4", "Pages 1–3", "Pages 1–3, 5". */
export function partLabel(part: Part) {
  if (part.length === 1) return rangeLabel(part[0]);
  return `Pages ${part.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(", ")}`;
}

/* ---------- Compress: what a strength actually does ---------- */

export const COMPRESS_PRESETS = [
  { label: "Light", value: 25, hint: "Barely visible. Good for print." },
  { label: "Balanced", value: 50, hint: "Smaller, still sharp on screen." },
  { label: "Strong", value: 80, hint: "Smallest. Photos get soft." },
] as const;

/** Same formula as PDFService.compress_pdf, so the UI can say what a strength means. */
export function compressionSettings(pct: number) {
  return {
    quality: Math.max(10, Math.trunc(95 - pct * 0.85)),
    dpi: Math.max(50, Math.trunc(300 - pct * 2.4)),
  };
}

/* ---------- Split results: list what's inside the ZIP ---------- */

export type ZipEntry = { name: string; size: number };

/**
 * Reads a ZIP's central directory (names and sizes only, no unzipping) so a split result
 * can show its parts before it's saved. Returns null if the archive can't be read.
 */
export async function listZip(blob: Blob): Promise<ZipEntry[] | null> {
  try {
    // The end-of-central-directory record sits in the last 22 bytes + up to 64 KB of comment.
    const tailSize = Math.min(blob.size, 22 + 0xffff);
    const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const count = tail.getUint16(eocd + 10, true);
    const dirSize = tail.getUint32(eocd + 12, true);
    const dirOffset = tail.getUint32(eocd + 16, true);

    const dir = new DataView(await blob.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
    const decoder = new TextDecoder();
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
      if (dir.getUint32(p, true) !== 0x02014b50) break;
      const size = dir.getUint32(p + 24, true);
      const nameLen = dir.getUint16(p + 28, true);
      const extraLen = dir.getUint16(p + 30, true);
      const commentLen = dir.getUint16(p + 32, true);
      const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
      if (!name.endsWith("/")) entries.push({ name, size });
      p += 46 + nameLen + extraLen + commentLen;
    }
    // In page order (page_2 before page_10, "Pages 1–3" before "Page 7"), then by name.
    return entries.sort((a, b) => firstPage(a.name) - firstPage(b.name) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch {
    return null;
  }
}

// Part names from PDFService._part_name: page_5.pdf · part_1_pages_1-3.pdf · part_2_pages_1-3_5.pdf
const PART_NAME = /pages?_(\d+(?:-\d+)?(?:_\d+(?:-\d+)?)*)\.pdf$/i;
const firstPage = (name: string) => Number(PART_NAME.exec(name)?.[1].match(/^\d+/)?.[0] ?? Infinity);

/** "part_1_pages_1-3.pdf" → "Pages 1–3", "part_2_pages_1-3_5.pdf" → "Pages 1–3, 5". Falls back to the name. */
export function describePart(name: string) {
  const m = PART_NAME.exec(name);
  if (!m) return name;
  const runs = m[1].split("_").map((r) => {
    const [a, b] = r.split("-");
    return { from: Number(a), to: Number(b ?? a) };
  });
  return partLabel(runs);
}

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".txt": "text/plain;charset=utf-8",
  ".md": "text/markdown;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".csv": "text/csv;charset=utf-8",
  ".html": "text/html;charset=utf-8",
};

/** Extracts one named entry from a ZIP blob on demand (used to preview individual split PDFs/images). */
export async function extractZipEntry(zipBlob: Blob, entryName: string): Promise<Blob | null> {
  try {
    const buf = new Uint8Array(await zipBlob.arrayBuffer());
    const files = unzipSync(buf, {
      filter: (file) => file.name === entryName || file.name.endsWith(`/${entryName}`),
    });
    const bytes = files[entryName] ?? Object.values(files)[0];
    if (!bytes) return null;
    const dot = entryName.lastIndexOf(".");
    const ext = dot >= 0 ? entryName.slice(dot).toLowerCase() : "";
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    return new Blob([new Uint8Array(bytes)], { type: mime });
  } catch {
    return null;
  }
}

/* ---------- Server answers (see backend/app/api/v1/endpoints/pdf.py) ---------- */

/** /pdf/upload: the PDF is kept on the server for a while and referred to by token. */
export type PdfUpload = {
  token: string;
  filename: string;
  size: number;
  page_count: number;
  /** [width, height] in points of each page as seen (rotation applied). */
  page_sizes?: [number, number][];
};

export type SplitEstimate = {
  output: "pdf" | "zip";
  total_size: number;
  parts: { name: string; first_page: number | null; last_page: number | null; pages?: number[]; size: number }[];
};

export type CompressSample = { percentage: number; size: number };
export type CompressEstimate = { original_size: number; exact: boolean; samples: CompressSample[] };

/** Pages past the end, checked in the browser once the page count is known. */
export function outOfBounds(parts: Part[], pageCount: number): string | null {
  const bad = parts.flat().find((r) => r.to > pageCount);
  if (!bad) return null;
  return `This PDF has ${pageCount} ${pageCount === 1 ? "page" : "pages"}, so ${rangeLabel(bad).toLowerCase()} doesn't exist.`;
}

/**
 * Compressed size at any strength from measured samples. Exact when the strength was measured;
 * otherwise interpolated between the nearest measurements (the UI then asks for the exact value).
 */
export function sizeAt(samples: CompressSample[], pct: number): { size: number; exact: boolean } | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a.percentage - b.percentage);
  const hit = sorted.find((s) => s.percentage === pct);
  if (hit) return { size: hit.size, exact: true };
  const hi = sorted.findIndex((s) => s.percentage > pct);
  if (hi <= 0) {
    const edge = hi === 0 ? sorted[0] : sorted[sorted.length - 1];
    return { size: edge.size, exact: false };
  }
  const a = sorted[hi - 1];
  const b = sorted[hi];
  const t = (pct - a.percentage) / (b.percentage - a.percentage);
  return { size: Math.round(a.size + (b.size - a.size) * t), exact: false };
}

/* ---------- Organize: pages in their new order ---------- */

export type Rotation = 0 | 90 | 180 | 270;
/** One page of the arranged document. `key` stays with the page as it moves. */
export type ArrangedPage = {
  key: string;
  page: number;
  rot: Rotation;
  /** Total degrees turned, only for the animation (so 270° → 0° turns forward). */
  spin?: number;
};

export const arrangeFresh = (pageCount: number): ArrangedPage[] =>
  Array.from({ length: pageCount }, (_, i) => ({ key: `p${i + 1}`, page: i + 1, rot: 0 }));

export const turn = (rot: Rotation, by: 90 | -90): Rotation => (((rot + by + 360) % 360) as Rotation);

/** What /pdf/organize expects: "3, 1:90, 2". Pages left out are removed. */
export const orderSpec = (pages: ArrangedPage[]) => pages.map((p) => (p.rot ? `${p.page}:${p.rot}` : `${p.page}`)).join(",");

/** True when the arrangement is the original document, untouched. */
export const isUnchanged = (pages: ArrangedPage[], pageCount: number) =>
  pages.length === pageCount && pages.every((p, i) => p.page === i + 1 && p.rot === 0);

/* ---------- Page thumbnails ---------- */

/** A page of an uploaded PDF as a PNG (rendered and cached on the server, then by the browser). */
export const thumbUrl = (token: string, page: number, width = 160) =>
  `/api/tools/pdf/thumbnail?${new URLSearchParams({ token, page: String(page), width: String(width) })}`;
