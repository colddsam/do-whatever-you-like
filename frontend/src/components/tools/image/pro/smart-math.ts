/**
 * Pure, DOM-free affine 2D matrix maths for Smart Objects.
 * Uses Canvas/DOMMatrix column-major tuple [a, b, c, d, e, f]:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */

export type Matrix2D = [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

/** Column-major affine matrix multiplication m1 * m2 (equivalent to new DOMMatrix(m1).multiply(new DOMMatrix(m2))). */
export function mulMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMatrixPt(m: Matrix2D, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function translateMatrix(m: Matrix2D, dx: number, dy: number): Matrix2D {
  return [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy];
}

export function translationOnlyMatrix(dx: number, dy: number): Matrix2D {
  return [1, 0, 0, 1, dx, dy];
}

export function scaleMatrix(sx: number, sy: number): Matrix2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotateMatrix(deg: number): Matrix2D {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** Transforms a source rectangle (0..w, 0..h) through `m` and returns tight integer pixel bounds. */
export function transformBounds(w: number, h: number, m: Matrix2D): { x: number; y: number; w: number; h: number } {
  const pts = [
    applyMatrixPt(m, 0, 0),
    applyMatrixPt(m, w, 0),
    applyMatrixPt(m, 0, h),
    applyMatrixPt(m, w, h),
  ];
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
  const y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
  const x1 = Math.ceil(Math.max(...pts.map((p) => p.x)));
  const y1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** Resets scale and rotation back to 100% / 0 deg while keeping the Smart Object's visual centre fixed. */
export function resetSmartMatrix(sourceW: number, sourceH: number, currentMatrix: Matrix2D): Matrix2D {
  const c = applyMatrixPt(currentMatrix, sourceW / 2, sourceH / 2);
  return [1, 0, 0, 1, Math.round(c.x - sourceW / 2), Math.round(c.y - sourceH / 2)];
}

/**
 * Fits new contents `(newW, newH)` inside the old contents slot `(oldW, oldH)` while keeping the
 * Smart Object's outer transform (`currentMatrix`) intact.
 */
export function fitReplacementMatrix(oldW: number, oldH: number, newW: number, newH: number, currentMatrix: Matrix2D): Matrix2D {
  const s = Math.min(oldW / Math.max(1, newW), oldH / Math.max(1, newH));
  const ox = (oldW - newW * s) / 2;
  const oy = (oldH - newH * s) / 2;
  return mulMatrix(currentMatrix, [s, 0, 0, s, ox, oy]);
}

/** Extracts user-facing scale (%) and rotation (deg) from a 2D affine matrix. */
export function smartMetrics(m: Matrix2D): { scaleX: number; scaleY: number; rotationDeg: number } {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = Math.hypot(m[2], m[3]) * (det < 0 ? -1 : 1);
  const rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  return { scaleX: sx, scaleY: sy, rotationDeg: Math.round(rot * 10) / 10 };
}
