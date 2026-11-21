/*
 * The vocabulary shared by adjustments and filters: how an operation describes its settings (so one
 * panel can draw controls for all of them) and the pixel helpers they're built from.
 */

/** `when`: show this control only while another setting has a value (the Color Mixer's per-colour sliders). */
type When = { when?: [string, string] };
export type Param = When &
  (
    | { type: "range"; key: string; label: string; min: number; max: number; step?: number; def: number; unit?: string; px?: boolean; bump?: [key: string, value: number] }
    | { type: "color"; key: string; label: string; def: string }
    | { type: "choice"; key: string; label: string; options: { value: string; label: string }[]; def: string }
    | { type: "toggle"; key: string; label: string; def: boolean }
    | { type: "curve"; key: string; label: string }
    | { type: "levels"; key: string; label: string }
    | { type: "lut"; key: string; label: string; def: string }
  );

export type OpContext = {
  /** Preview scale: 1 for the real file, smaller while previewing a zoomed-out view. */
  scale: number;
  fg: string;
  bg: string;
};

export type Op = {
  id: string;
  label: string;
  group: string;
  params: Param[];
  /** Edits the pixels in place (or returns new ones of the same size). */
  apply: (img: ImageData, p: Record<string, unknown>, ctx: OpContext) => ImageData | void;
  /** Can live as a non-destructive adjustment layer (per-pixel, needs no neighbours). */
  layerable?: boolean;
  /** One click, no settings (Invert, Desaturate, Auto tone…). */
  instant?: boolean;
  hint?: string;
};

export function defaults(op: Op): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of op.params) {
    if (p.type === "curve") out[p.key] = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
    else if (p.type === "levels") out[p.key] = { channel: "rgb", inLo: 0, inHi: 255, gamma: 1, outLo: 0, outHi: 255 };
    else out[p.key] = p.def;
  }
  return out;
}

/** Values a spatial setting takes at preview scale (a 20 px blur on a half-size preview is 10 px). */
export function scaled(op: Op, p: Record<string, unknown>, scale: number) {
  if (scale === 1) return p;
  const out = { ...p };
  for (const d of op.params) if (d.type === "range" && d.px) out[d.key] = (p[d.key] as number) * scale;
  return out;
}

export const num = (p: Record<string, unknown>, k: string) => Number(p[k] ?? 0);
export const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/* ---------- Colour ---------- */

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** A 256-entry lookup table applied to R, G and B (alpha untouched). */
export function applyLut(img: ImageData, lr: Uint8ClampedArray | number[], lg = lr, lb = lr) {
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    p[i] = lr[p[i]];
    p[i + 1] = lg[p[i + 1]];
    p[i + 2] = lb[p[i + 2]];
  }
}

export function lut(fn: (v: number) => number) {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = clamp255(Math.round(fn(i)));
  return t;
}

/* ---------- Blur (three box passes ≈ gaussian), premultiplied so edges don't darken ---------- */

function boxesForGauss(sigma: number, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    for (let c = 0; c < 4; c++) {
      const fv = src[base * 4 + c];
      const lv = src[(base + w - 1) * 4 + c];
      // The window for x = 0 is [-r, r]; start one step before it so the loop's first add/sub lands there.
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[(base + Math.min(j, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        const add = x + r < w ? src[(base + x + r) * 4 + c] : lv;
        const sub = x - r - 1 >= 0 ? src[(base + x - r - 1) * 4 + c] : fv;
        val += add - sub;
        dst[(base + x) * 4 + c] = val * iarr;
      }
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      const fv = src[x * 4 + c];
      const lv = src[(x + (h - 1) * w) * 4 + c];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[(x + Math.min(j, h - 1) * w) * 4 + c];
      for (let y = 0; y < h; y++) {
        const add = y + r < h ? src[(x + (y + r) * w) * 4 + c] : lv;
        const sub = y - r - 1 >= 0 ? src[(x + (y - r - 1) * w) * 4 + c] : fv;
        val += add - sub;
        dst[(x + y * w) * 4 + c] = val * iarr;
      }
    }
  }
}

/** Gaussian-like blur of RGBA pixels, in place. `radius` is roughly the visual radius in px. */
export function blurImage(img: ImageData, radius: number) {
  if (radius < 0.5) return;
  const { width: w, height: h, data } = img;
  const a = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const al = data[i + 3] / 255;
    a[i] = data[i] * al;
    a[i + 1] = data[i + 1] * al;
    a[i + 2] = data[i + 2] * al;
    a[i + 3] = data[i + 3];
  }
  const b = new Float32Array(data.length);
  for (const r of boxesForGauss(radius / 2)) {
    const rr = Math.max(0, Math.round(r));
    if (!rr) continue;
    boxH(a, b, w, h, rr);
    boxV(b, a, w, h, rr);
  }
  for (let i = 0; i < data.length; i += 4) {
    const al = a[i + 3];
    data[i + 3] = al;
    if (al > 0) {
      const k = 255 / al;
      data[i] = a[i] * k;
      data[i + 1] = a[i + 1] * k;
      data[i + 2] = a[i + 2] * k;
    }
  }
}

export const copyImage = (img: ImageData) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

/** Bilinear sample of RGBA at a fractional point, edges clamped. Writes into `out` at `o`. */
export function sample(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Uint8ClampedArray, o: number) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
    const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
    out[o + c] = top + (bot - top) * fy;
  }
}

/** Histogram of R, G, B and luminance for a picture (alpha-weighted, see-through pixels skipped). */
export function histogram(img: ImageData) {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] < 8) continue;
    r[p[i]]++;
    g[p[i + 1]]++;
    b[p[i + 2]]++;
    l[Math.round(luma(p[i], p[i + 1], p[i + 2]))]++;
  }
  return { r, g, b, l };
}

/** A monotone curve through control points, as a 256-entry table (Photoshop's Curves). */
export function curveLut(points: [number, number][]) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  if (n < 2) return lut((v) => v);
  // Monotone cubic (Fritsch–Carlson) so the curve never overshoots between points.
  const d = new Array(n - 1).fill(0).map((_, i) => (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return lut((x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / hh;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
  });
}

export function levelsLut(l: { inLo: number; inHi: number; gamma: number; outLo: number; outHi: number }) {
  return lut((v) => {
    let t = (v - l.inLo) / Math.max(1, l.inHi - l.inLo);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = Math.pow(t, 1 / Math.max(0.01, l.gamma));
    return l.outLo + t * (l.outHi - l.outLo);
  });
}
