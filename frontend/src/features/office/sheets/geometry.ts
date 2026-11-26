/** Column/row positions for the canvas grid: prefix sums, frozen panes, hit testing. */
import { DEFAULT_COL_W, DEFAULT_ROW_H, type Sheet } from "./model";

export type Geometry = {
  zoom: number;
  headerW: number;
  headerH: number;
  colX: Float64Array; // left edge of each column (unzoomed), length cols+1
  rowY: Float64Array; // top edge of each row (unzoomed), length rows+1
  cols: number;
  rows: number;
  frozenR: number;
  frozenC: number;
};

export function buildGeometry(sh: Sheet, zoom: number, showHeaders: boolean): Geometry {
  const hiddenC = new Set(sh.hiddenCols);
  const hiddenR = new Set(sh.hiddenRows);
  const colX = new Float64Array(sh.cols + 1);
  for (let c = 0; c < sh.cols; c++) colX[c + 1] = colX[c] + (hiddenC.has(c) ? 0 : (sh.colW[c] ?? DEFAULT_COL_W));
  const rowY = new Float64Array(sh.rows + 1);
  for (let r = 0; r < sh.rows; r++) rowY[r + 1] = rowY[r] + (hiddenR.has(r) ? 0 : (sh.rowH[r] ?? DEFAULT_ROW_H));
  const digits = String(sh.rows).length;
  return {
    zoom,
    headerW: showHeaders ? Math.max(40, 12 + digits * 8) : 0,
    headerH: showHeaders ? 24 : 0,
    colX,
    rowY,
    cols: sh.cols,
    rows: sh.rows,
    frozenR: Math.min(sh.freeze.r, sh.rows),
    frozenC: Math.min(sh.freeze.c, sh.cols),
  };
}

/** Total content size in CSS pixels (for the scroll spacer). */
export function contentSize(g: Geometry) {
  return { w: g.headerW + g.colX[g.cols] * g.zoom, h: g.headerH + g.rowY[g.rows] * g.zoom };
}

/** Screen x of a column's left edge, given horizontal scroll. */
export function colLeft(g: Geometry, c: number, scrollX: number): number {
  const base = g.headerW + g.colX[c] * g.zoom;
  return c < g.frozenC ? base : base - scrollX;
}
export function rowTop(g: Geometry, r: number, scrollY: number): number {
  const base = g.headerH + g.rowY[r] * g.zoom;
  return r < g.frozenR ? base : base - scrollY;
}
export const colWidth = (g: Geometry, c: number) => (g.colX[c + 1] - g.colX[c]) * g.zoom;
export const rowHeight = (g: Geometry, r: number) => (g.rowY[r + 1] - g.rowY[r]) * g.zoom;

/** Index of the column/row under a coordinate in unzoomed content space. */
function search(arr: Float64Array, n: number, v: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type Hit =
  | { kind: "corner" }
  | { kind: "colHeader"; c: number; edge: number | null }
  | { kind: "rowHeader"; r: number; edge: number | null }
  | { kind: "cell"; r: number; c: number };

/** What's under a point in the viewport (x, y relative to the grid's top-left). */
export function hitTest(g: Geometry, x: number, y: number, scrollX: number, scrollY: number): Hit {
  const frozenW = g.colX[g.frozenC] * g.zoom;
  const frozenH = g.rowY[g.frozenR] * g.zoom;
  const cx = x - g.headerW;
  const cy = y - g.headerH;
  const contentX = (cx < frozenW ? cx : cx + scrollX) / g.zoom;
  const contentY = (cy < frozenH ? cy : cy + scrollY) / g.zoom;
  const c = search(g.colX, g.cols, Math.max(0, contentX));
  const r = search(g.rowY, g.rows, Math.max(0, contentY));
  if (x < g.headerW && y < g.headerH) return { kind: "corner" };
  if (y < g.headerH) {
    // resize grip within 4px of a column's right edge
    const right = colLeft(g, c, scrollX) + colWidth(g, c);
    const left = colLeft(g, c, scrollX);
    const edge = Math.abs(x - right) <= 4 ? c : Math.abs(x - left) <= 4 && c > 0 ? c - 1 : null;
    return { kind: "colHeader", c, edge };
  }
  if (x < g.headerW) {
    const bottom = rowTop(g, r, scrollY) + rowHeight(g, r);
    const top = rowTop(g, r, scrollY);
    const edge = Math.abs(y - bottom) <= 4 ? r : Math.abs(y - top) <= 4 && r > 0 ? r - 1 : null;
    return { kind: "rowHeader", r, edge };
  }
  return { kind: "cell", r, c };
}

/** First and last visible indexes of the scrolling (unfrozen) area. */
export function visibleRange(g: Geometry, width: number, height: number, scrollX: number, scrollY: number) {
  const frozenW = g.colX[g.frozenC] * g.zoom;
  const frozenH = g.rowY[g.frozenR] * g.zoom;
  const startX = g.colX[g.frozenC] + scrollX / g.zoom;
  const startY = g.rowY[g.frozenR] + scrollY / g.zoom;
  const c1 = Math.max(g.frozenC, search(g.colX, g.cols, startX));
  const r1 = Math.max(g.frozenR, search(g.rowY, g.rows, startY));
  const c2 = Math.min(g.cols - 1, search(g.colX, g.cols, startX + (width - g.headerW - frozenW) / g.zoom) + 1);
  const r2 = Math.min(g.rows - 1, search(g.rowY, g.rows, startY + (height - g.headerH - frozenH) / g.zoom) + 1);
  return { r1, r2, c1, c2 };
}

/** Scroll position that brings a cell into view (or null if already visible). */
export function scrollToShow(g: Geometry, r: number, c: number, width: number, height: number, scrollX: number, scrollY: number): { x: number; y: number } | null {
  let x = scrollX;
  let y = scrollY;
  const frozenW = g.colX[g.frozenC] * g.zoom;
  const frozenH = g.rowY[g.frozenR] * g.zoom;
  if (c >= g.frozenC) {
    const left = (g.colX[c] - g.colX[g.frozenC]) * g.zoom;
    const right = (g.colX[c + 1] - g.colX[g.frozenC]) * g.zoom;
    const view = width - g.headerW - frozenW;
    if (left < x) x = left;
    else if (right > x + view) x = right - view;
  }
  if (r >= g.frozenR) {
    const top = (g.rowY[r] - g.rowY[g.frozenR]) * g.zoom;
    const bottom = (g.rowY[r + 1] - g.rowY[g.frozenR]) * g.zoom;
    const view = height - g.headerH - frozenH;
    if (top < y) y = top;
    else if (bottom > y + view) y = bottom - view;
  }
  return x === scrollX && y === scrollY ? null : { x: Math.max(0, x), y: Math.max(0, y) };
}
