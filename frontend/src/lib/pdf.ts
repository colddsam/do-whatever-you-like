/** Client helpers for the PDF toolkit. The rules here mirror backend/app/services/pdf.py. */

export type PdfMode = "merge" | "split" | "compress";
export const PDF_MODES: PdfMode[] = ["merge", "split", "compress"];
export const isPdfMode = (v: string | null): v is PdfMode => PDF_MODES.includes(v as PdfMode);

export const PDF_MAX_MB = 150;
export const MERGE_MAX_FILES = 20;

/* ---------- Split: page ranges ---------- */

export type PageRange = { from: number; to: number };

/**
 * Parses "1-3, 5" the way the backend does: comma-separated pages or `a-b` ranges, 1-based.
 * The page count is only known on the server, so bounds above page 1 are checked there.
 */
export function parseRanges(input: string): { ranges: PageRange[]; error: string | null } {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { ranges: [], error: "Type a page or a range, like 1-3, 5." };

  const ranges: PageRange[] = [];
  for (const part of parts) {
    let from: number;
    let to: number;
    const dash = part.indexOf("-");
    if (dash >= 0) {
      const a = part.slice(0, dash).trim();
      const b = part.slice(dash + 1).trim();
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return { ranges, error: `“${part}” isn't a range. Write it like 1-3.` };
      from = Number(a);
      to = Number(b);
    } else {
      if (!/^\d+$/.test(part)) return { ranges, error: `“${part}” isn't a page number.` };
      from = to = Number(part);
    }
    if (from < 1) return { ranges, error: "Pages start at 1." };
    if (from > to) return { ranges, error: `“${part}” runs backwards. Try ${to}-${from}.` };
    ranges.push({ from, to });
  }
  return { ranges, error: null };
}

export const rangeLabel = ({ from, to }: PageRange) => (from === to ? `Page ${from}` : `Pages ${from}–${to}`);

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

const firstPage = (name: string) => Number(/pages?_(\d+)(?:-\d+)?\.pdf$/i.exec(name)?.[1] ?? Infinity);

/** "part_1_pages_1-3.pdf" → "Pages 1–3", "page_5.pdf" → "Page 5". Falls back to the file name. */
export function describePart(name: string) {
  const range = /pages_(\d+)-(\d+)\.pdf$/i.exec(name);
  if (range) return `Pages ${range[1]}–${range[2]}`;
  const page = /page_(\d+)\.pdf$/i.exec(name);
  if (page) return `Page ${page[1]}`;
  return name;
}

/* ---------- Server answers (see backend/app/api/v1/endpoints/pdf.py) ---------- */

/** /pdf/upload: the PDF is kept on the server for a while and referred to by token. */
export type PdfUpload = { token: string; filename: string; size: number; page_count: number };

export type SplitEstimate = {
  output: "pdf" | "zip";
  total_size: number;
  parts: { name: string; first_page: number | null; last_page: number | null; size: number }[];
};

export type CompressSample = { percentage: number; size: number };
export type CompressEstimate = { original_size: number; exact: boolean; samples: CompressSample[] };

/** Pages past the end, checked in the browser once the page count is known. */
export function outOfBounds(ranges: PageRange[], pageCount: number): string | null {
  const bad = ranges.find((r) => r.to > pageCount);
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
