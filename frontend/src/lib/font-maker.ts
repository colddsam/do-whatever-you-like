/**
 * Font creator, the maths: the character set, the em (1000 units: ascender 800, descender -200),
 * the printable handwriting template's geometry (millimetres), outlines from traced pictures, and the
 * finished OpenType font (opentype.js, built in the browser).
 */

import type { TracedContour, SheetLayout } from "./scan";

export const UPM = 1000;
export const ASC = 800;
export const DESC = -200;
export const CAP = 700;
export const XH = 500;

export const SETS: { id: string; label: string; chars: string }[] = [
  { id: "upper", label: "Capitals", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { id: "lower", label: "Small letters", chars: "abcdefghijklmnopqrstuvwxyz" },
  { id: "digits", label: "Numbers", chars: "0123456789" },
  { id: "punct", label: "Punctuation", chars: ".,;:!?'\"-()&@#%/+=*" },
  { id: "accents", label: "Accents", chars: "ÀÁÂÄÇÈÉÊËÍÎÏÑÓÔÖÚÛÜàáâäçèéêëíîïñóôöúûüß" },
];

/** A contour in font units (y up), flat [x, y, ...]. `smooth` turns its corners into curves. */
export type Contour = { pts: number[]; hole: boolean; smooth: boolean };
export type Stroke = { pts: number[]; width: number };
export type GlyphData = { mode: "draw" | "pixel" | "scan"; contours: Contour[]; strokes?: Stroke[]; pixels?: number[] };

/* ---------- pixel grid: 12 columns × 15 rows, rows 0–11 above the baseline ---------- */

export const PX_COLS = 12;
export const PX_ROWS = 15;
export const PX = UPM / PX_ROWS; // 66.67 units per pixel

/* ---------- the handwriting template (A4, millimetres) ---------- */

export const PAGE = { w: 210, h: 297 };
const COLS = 6;
const ROWS = 7;
const CELL_W = 29;
const CELL_H = 33;
const GRID_X = 18;
const GRID_Y = 28;
const LABEL = 6.5;
export const PER_PAGE = COLS * ROWS;
export const MARKERS: [number, number][] = [
  [12, 12],
  [198, 12],
  [198, 285],
  [12, 285],
];
const BITS = [22, 30, 38].map((x) => [x, 280, 5, 5]);
/** The writing area of each cell (mm): below the label, inside the border. 1000 units tall. */
export const cells = Array.from({ length: PER_PAGE }, (_, i) => {
  const x = GRID_X + (i % COLS) * CELL_W;
  const y = GRID_Y + Math.floor(i / COLS) * CELL_H;
  return { box: [x, y, CELL_W, CELL_H], area: [x + 1.5, y + LABEL + 1, CELL_W - 3, CELL_H - LABEL - 2.5] };
});
export const AREA_W_UNITS = (cells[0].area[2] / cells[0].area[3]) * UPM;

export function sheetLayout(scale: number): SheetLayout {
  return { width: PAGE.w, height: PAGE.h, scale, markers: MARKERS, bits: BITS, cells: cells.map((c) => c.area) };
}

const GUIDE = "#9fd8f0";

/** One template page as SVG (millimetre units), ready to print at 100%. */
export function templatePage(chars: string[], page: number, pages: number, fontName: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const parts: string[] = [];
  MARKERS.forEach(([x, y]) => parts.push(`<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="#000"/>`));
  BITS.forEach(([x, y, w, h], i) => parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${(page >> i) & 1 ? "#000" : "none"}" stroke="#000" stroke-width="0.3"/>`));
  parts.push(`<text x="105" y="20" font-size="5" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#000">${esc(fontName)} · handwriting template</text>`);
  parts.push(`<text x="48" y="284.5" font-size="3" text-anchor="start" font-family="Helvetica, Arial, sans-serif" fill="#555">Page ${page} of ${pages} · print at 100% (actual size) · write in dark pen inside the boxes, sitting on the solid line</text>`);
  chars.forEach((ch, i) => {
    const c = cells[i];
    const [x, y, w, h] = c.box;
    const [ax, ay, aw, ah] = c.area;
    const line = (units: number) => ay + ((ASC - units) / UPM) * ah;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${GUIDE}" stroke-width="0.3"/>`);
    parts.push(`<line x1="${x}" x2="${x + w}" y1="${y + LABEL}" y2="${y + LABEL}" stroke="${GUIDE}" stroke-width="0.25"/>`);
    parts.push(`<text x="${x + 1.5}" y="${y + 4.8}" font-size="4" font-family="Helvetica, Arial, sans-serif" fill="#000">${esc(ch)}</text>`);
    parts.push(`<line x1="${ax}" x2="${ax + aw}" y1="${line(0)}" y2="${line(0)}" stroke="${GUIDE}" stroke-width="0.35"/>`);
    parts.push(`<line x1="${ax}" x2="${ax + aw}" y1="${line(XH)}" y2="${line(XH)}" stroke="${GUIDE}" stroke-width="0.2" stroke-dasharray="1 1"/>`);
    parts.push(`<line x1="${ax}" x2="${ax + aw}" y1="${line(CAP)}" y2="${line(CAP)}" stroke="${GUIDE}" stroke-width="0.2" stroke-dasharray="0.4 1"/>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">${parts.join("")}</svg>`;
}

/* ---------- outlines ---------- */

const area = (p: number[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
};

/** Pixel-space contours → font units, given how pixels map to units. */
export function toUnits(traced: TracedContour[], map: (x: number, y: number) => [number, number], smooth: boolean): Contour[] {
  return traced.map((c) => {
    const pts: number[] = [];
    for (let i = 0; i < c.points.length; i += 2) pts.push(...map(c.points[i], c.points[i + 1]));
    return { pts, hole: c.hole, smooth };
  });
}

/** Drops points closer than `min` units, so curves don't wobble through every pixel step. */
function thin(p: number[], min: number) {
  const out: number[] = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const dx = p[i] - out[out.length - 2];
    const dy = p[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= min * min) out.push(p[i], p[i + 1]);
  }
  return out.length >= 6 ? out : p;
}

type PathLike = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; curveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; close(): void };

/**
 * Writes contours into a path. Outer shapes run counter-clockwise and holes clockwise (y up), so
 * every renderer fills them right. Smooth contours become a closed Catmull-Rom spline as cubic curves.
 */
export function drawContours(path: PathLike, contours: Contour[], dx = 0) {
  for (const c of contours) {
    let p = c.smooth ? thin(c.pts, 14) : c.pts;
    if (p.length < 6) continue;
    const ccw = area(p) > 0;
    if (ccw === c.hole) {
      const r: number[] = [];
      for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
      p = r;
    }
    const n = p.length / 2;
    const X = (i: number) => p[((i + n) % n) * 2] + dx;
    const Y = (i: number) => p[((i + n) % n) * 2 + 1];
    path.moveTo(X(0), Y(0));
    for (let i = 0; i < n; i++) {
      if (c.smooth) {
        path.curveTo(X(i) + (X(i + 1) - X(i - 1)) / 6, Y(i) + (Y(i + 1) - Y(i - 1)) / 6, X(i + 1) - (X(i + 2) - X(i)) / 6, Y(i + 1) - (Y(i + 2) - Y(i)) / 6, X(i + 1), Y(i + 1));
      } else if (i < n - 1) {
        path.lineTo(X(i + 1), Y(i + 1));
      }
    }
    path.close();
  }
}

export function bounds(contours: Contour[]) {
  let x0 = Infinity, x1 = -Infinity;
  for (const c of contours)
    for (let i = 0; i < c.pts.length; i += 2) {
      x0 = Math.min(x0, c.pts[i]);
      x1 = Math.max(x1, c.pts[i]);
    }
  return { x0, x1 };
}

/** An SVG path for a glyph preview (y flipped to screen). */
export function previewPath(contours: Contour[]): string {
  const cmds: string[] = [];
  const P = {
    moveTo: (x: number, y: number) => cmds.push(`M${x.toFixed(0)} ${(-y).toFixed(0)}`),
    lineTo: (x: number, y: number) => cmds.push(`L${x.toFixed(0)} ${(-y).toFixed(0)}`),
    curveTo: (a: number, b: number, c: number, d: number, e: number, f: number) => cmds.push(`C${a.toFixed(0)} ${(-b).toFixed(0)} ${c.toFixed(0)} ${(-d).toFixed(0)} ${e.toFixed(0)} ${(-f).toFixed(0)}`),
    close: () => cmds.push("Z"),
  };
  drawContours(P, contours);
  return cmds.join("");
}

export type BuildOptions = { family: string; style: string; sideBearing: number; space: number; capsForLower: boolean; designer?: string };

/** The finished font (OTF, CFF outlines). Returns its bytes and how many characters it covers. */
export async function buildFont(glyphs: Record<string, GlyphData>, o: BuildOptions): Promise<{ bytes: ArrayBuffer; count: number }> {
  const ot = await import("opentype.js");
  const notdefPath = new ot.Path();
  drawContours(notdefPath, [
    { pts: [50, 0, 450, 0, 450, 700, 50, 700], hole: false, smooth: false },
    { pts: [100, 50, 400, 50, 400, 650, 100, 650], hole: true, smooth: false },
  ]);
  const list = [new ot.Glyph({ name: ".notdef", advanceWidth: 500, path: notdefPath }), new ot.Glyph({ name: "space", unicodes: [32, 160], unicode: 32, advanceWidth: o.space, path: new ot.Path() })];
  const made = Object.entries(glyphs).filter(([, g]) => g.contours.length);
  const madeChars = new Set(made.map(([c]) => c));
  for (const [ch, g] of made) {
    const { x0, x1 } = bounds(g.contours);
    const path = new ot.Path();
    drawContours(path, g.contours, o.sideBearing - x0);
    const cp = ch.codePointAt(0)!;
    const unicodes = [cp];
    // Capitals stand in for small letters nobody drew (and the reverse), if asked.
    if (o.capsForLower) {
      const other = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
      if (other !== ch && other.length === 1 && !madeChars.has(other)) unicodes.push(other.codePointAt(0)!);
    }
    list.push(new ot.Glyph({ name: `uni${cp.toString(16).toUpperCase().padStart(4, "0")}`, unicode: cp, unicodes, advanceWidth: Math.round(x1 - x0 + o.sideBearing * 2), path }));
  }
  const font = new ot.Font({
    familyName: o.family.trim() || "My Font",
    styleName: o.style.trim() || "Regular",
    unitsPerEm: UPM,
    ascender: ASC,
    descender: DESC,
    designer: o.designer,
    version: "Version 1.000",
    license: "Made with Do-Whatever-You-Like's Font creator. The maker of this font owns it.",
    glyphs: list,
  });
  return { bytes: font.toArrayBuffer(), count: made.length };
}
