/**
 * Pure, DOM-free chroma-key colour science and clip UV projection helpers.
 * Mirrors the WebGL `LAYER_FS` chroma-key & BT.709 despill math bit-for-bit
 * so unit tests can validate keying behaviour directly in Node.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Normalized RGB (0..1) -> BT.709 [Y, Cb, Cr] (Y in 0..1, Cb/Cr in -0.5..0.5). */
export function rgbToYCbCr709(r: number, g: number, b: number): [number, number, number] {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const cb = (b - y) / 1.8556;
  const cr = (r - y) / 1.5748;
  return [y, cb, cr];
}

/** BT.709 [Y, Cb, Cr] -> clamped normalized RGB (0..1). */
export function ycbcrToRgb709(y: number, cb: number, cr: number): [number, number, number] {
  const r = y + 1.5748 * cr;
  const b = y + 1.8556 * cb;
  const g = y - 0.187324 * cb - 0.468124 * cr;
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export interface ChromaKeyParams {
  keyRgb: [number, number, number];
  similarity: number;
  smoothness: number;
  spill: number;
  clipBlack?: number;
  clipWhite?: number;
}

/**
 * Evaluates a single linear/sRGB 0..1 pixel through the calibrated BT.709 chroma key +
 * hue-preserving CbCr projection despill pipeline.
 */
export function evalChromaKeyPixel(
  r: number,
  g: number,
  b: number,
  opts: ChromaKeyParams,
): { r: number; g: number; b: number; alpha: number } {
  const [y, cb, cr] = rgbToYCbCr709(r, g, b);
  const [ky, kcb, kcr] = rgbToYCbCr709(opts.keyRgb[0], opts.keyRgb[1], opts.keyRgb[2]);

  const dCb = cb - kcb;
  const dCr = cr - kcr;
  const dChroma = Math.hypot(dCb, dCr);
  const dLuma = Math.abs(y - ky) * 0.12;
  const dist = Math.hypot(dChroma, dLuma);

  const sim = opts.similarity * 0.42;
  const smooth = Math.max(opts.smoothness * 0.35, 0.002);
  let rawM = smoothstep(0, 1, (dist - sim) / smooth);

  const clipBlack = opts.clipBlack ?? 0.05;
  const clipWhite = opts.clipWhite ?? 0.92;
  rawM = clamp01((rawM - clipBlack) / Math.max(clipWhite - clipBlack, 0.001));

  // Hue-preserving despill: project CbCr onto key chroma direction and pull positive key projection toward neutral.
  let outR = r;
  let outG = g;
  let outB = b;
  const kLen = Math.hypot(kcb, kcr);
  if (opts.spill > 0.001 && kLen > 1e-4) {
    const dirCb = kcb / kLen;
    const dirCr = kcr / kLen;
    const proj = cb * dirCb + cr * dirCr;
    if (proj > 0) {
      // Spill suppression is strongest near key hues and gentle on skin / foreground hues.
      const proximity = 1 - smoothstep(sim * 0.5, sim + smooth * 2.2 + 0.12, dChroma);
      const strength = clamp01(opts.spill) * (0.35 + 0.65 * proximity);
      const reduce = proj * Math.min(1, strength);
      [outR, outG, outB] = ycbcrToRgb709(y, cb - dirCb * reduce, cr - dirCr * reduce);
    }
  }

  return { r: outR, g: outG, b: outB, alpha: rawM };
}

/**
 * Converts project-space coordinates `(px, py)` into source texture UV `(u, v)` in `0..1`
 * for an oriented clip, correctly accounting for `rotation`, `flipH`, and `flipV`.
 * Returns `null` if `(px, py)` falls outside the clip rectangle.
 */
export function clipUvFromProject(
  px: number,
  py: number,
  g: { x: number; y: number; sx: number; sy: number; bw: number; bh: number; rotDeg: number },
  flipH?: boolean,
  flipV?: boolean,
): { u: number; v: number } | null {
  const rad = (-g.rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - g.x;
  const dy = py - g.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const w = g.bw * g.sx;
  const h = g.bh * g.sy;
  if (Math.abs(w) < 1e-5 || Math.abs(h) < 1e-5) return null;
  let u = lx / w + 0.5;
  let v = ly / h + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  if (flipH) u = 1 - u;
  if (flipV) v = 1 - v;
  return { u, v };
}
