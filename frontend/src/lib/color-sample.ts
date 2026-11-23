/**
 * Pure pixel-sampling and colour conversion maths (DOM-free for unit testing and reuse
 * across the standalone colour picker, photo editors, and video editor).
 */

export type SampleSize = 1 | 3 | 5;

export interface ContentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Computes the rendered image rectangle inside a CSS box using `object-contain` semantics.
 * When an image is letterboxed or pillarboxed inside a wider/taller box, `(x, y)` is the offset
 * from the box top-left to the actual drawn bitmap.
 */
export function computeContentRect(boxW: number, boxH: number, imgW: number, imgH: number): ContentRect {
  if (boxW <= 0 || boxH <= 0 || imgW <= 0 || imgH <= 0) {
    return { x: 0, y: 0, w: Math.max(0, boxW), h: Math.max(0, boxH) };
  }
  const boxRatio = boxW / boxH;
  const imgRatio = imgW / imgH;
  if (imgRatio > boxRatio) {
    // Letterboxed top/bottom
    const w = boxW;
    const h = boxW / imgRatio;
    return { x: 0, y: (boxH - h) / 2, w, h };
  }
  // Pillarboxed left/right (or exact fit)
  const h = boxH;
  const w = boxH * imgRatio;
  return { x: (boxW - w) / 2, y: 0, w, h };
}

/**
 * Maps pointer client coordinates over an `object-contain` canvas element to exact integer
 * bitmap pixel coordinates `(x, y)` and normalized content coordinates `(u, v)`.
 * Returns `null` if the pointer is outside the rendered image area (e.g. over letterbox bars).
 */
export function clientToImagePixel(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  imgW: number,
  imgH: number,
): { x: number; y: number; u: number; v: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || imgW <= 0 || imgH <= 0) return null;
  const content = computeContentRect(rect.width, rect.height, imgW, imgH);
  const localX = clientX - rect.left - content.x;
  const localY = clientY - rect.top - content.y;
  // Allow tiny subpixel tolerance at exact right/bottom boundary, exclude outside padding bars
  if (localX < -0.5 || localY < -0.5 || localX > content.w + 0.5 || localY > content.h + 0.5) {
    return null;
  }
  const clampedX = Math.min(Math.max(0, localX), Math.max(0, content.w - 1e-6));
  const clampedY = Math.min(Math.max(0, localY), Math.max(0, content.h - 1e-6));
  const u = content.w > 0 ? clampedX / content.w : 0;
  const v = content.h > 0 ? clampedY / content.h : 0;
  const x = Math.min(imgW - 1, Math.max(0, Math.floor(u * imgW)));
  const y = Math.min(imgH - 1, Math.max(0, Math.floor(v * imgH)));
  return { x, y, u, v };
}

/**
 * Averages a `size × size` square around `(cx, cy)` from tightly packed RGBA pixel data.
 */
export function sampleRgbaPatch(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  size: SampleSize = 1,
): { r: number; g: number; b: number; a: number } {
  const rad = Math.floor(size / 2);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  const y0 = Math.max(0, cy - rad);
  const y1 = Math.min(h - 1, cy + rad);
  const x0 = Math.max(0, cx - rad);
  const x1 = Math.min(w - 1, cx + rad);
  for (let y = y0; y <= y1; y++) {
    const row = y * w * 4;
    for (let x = x0; x <= x1; x++) {
      const o = row + x * 4;
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
      a += data[o + 3];
      n++;
    }
  }
  if (!n) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
    a: Math.round(a / n),
  };
}

export function normalizeHex(input: string): string | null {
  const clean = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toLowerCase();
  }
  return null;
}

/** RGB (0..255) -> HSV (h: 0..360, s: 0..100, v: 0..100). */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
    else if (max === G) h = ((B - R) / d + 2) * 60;
    else h = ((R - G) / d + 4) * 60;
  }
  const s = max <= 1e-6 ? 0 : (d / max) * 100;
  const v = max * 100;
  return [h, s, v];
}

/** HSV (h: 0..360, s: 0..100, v: 0..100) -> RGB (0..255). */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const H = (((h % 360) + 360) % 360) / 60;
  const S = Math.max(0, Math.min(1, s / 100));
  const V = Math.max(0, Math.min(1, v / 100));
  const c = V * S;
  const x = c * (1 - Math.abs((H % 2) - 1));
  const m = V - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (H < 1) [r, g, b] = [c, x, 0];
  else if (H < 2) [r, g, b] = [x, c, 0];
  else if (H < 3) [r, g, b] = [0, c, x];
  else if (H < 4) [r, g, b] = [0, x, c];
  else if (H < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** HSL (h: 0..360, s: 0..100, l: 0..100) -> RGB (0..255). */
export function hslToRgbBytes(h: number, s: number, l: number): [number, number, number] {
  const H = ((h % 360) + 360) % 360;
  const S = Math.max(0, Math.min(1, s / 100));
  const L = Math.max(0, Math.min(1, l / 100));
  const k = (n: number) => (n + H / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
