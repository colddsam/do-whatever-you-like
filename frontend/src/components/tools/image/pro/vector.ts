import { ctx2d, makeCanvas, newId, opaqueBounds, rgbToHex } from "./doc";
import { layerAsDoc, shapePad } from "./render";
import type { Doc, Layer, Pt, Rect, VNode, VPath, VSub } from "./types";

/*
 * The vector side of the editor (what Illustrator does): paths made of cubic Bézier segments.
 *
 * A vector layer keeps its paths in `layer.vector` and a canvas drawn from them, so compositing,
 * masks, blend modes and layer styles treat it like any other layer. Every edit redraws the canvas
 * from the paths (`vectorPatch`), so the shapes stay sharp however often they're moved, scaled or
 * reshaped. SVG files open as editable paths and the document can be saved back as SVG.
 */

export const K = 0.5522847498; // a quarter circle as one cubic

export const DEFAULT_STYLE: Omit<VPath, "id" | "subs"> = {
  fill: "#eb4a10",
  stroke: "#15140f",
  width: 4,
  opacity: 1,
  cap: "round",
  join: "round",
  dash: null,
  rule: "nonzero",
};

export function newPath(subs: VSub[], style: Partial<Omit<VPath, "id" | "subs">> = {}): VPath {
  return { id: newId(), subs, ...DEFAULT_STYLE, ...style };
}

/* ---------- Geometry ---------- */

const node = (x: number, y: number, i: Pt | null = null, o: Pt | null = null): VNode => ({ x, y, i, o });

export function mapSubs(subs: VSub[], f: (p: Pt) => Pt): VSub[] {
  return subs.map((s) => ({
    closed: s.closed,
    nodes: s.nodes.map((n) => {
      const a = f(n);
      return { x: a.x, y: a.y, i: n.i ? f(n.i) : null, o: n.o ? f(n.o) : null };
    }),
  }));
}

export const mapPaths = (paths: VPath[], f: (p: Pt) => Pt) => paths.map((p) => ({ ...p, subs: mapSubs(p.subs, f) }));

/** Paths through a matrix; stroke widths follow the matrix's average scale. */
export function transformPaths(paths: VPath[], m: DOMMatrix): VPath[] {
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  return paths.map((p) => ({
    ...p,
    width: p.width * k,
    dash: p.dash ? p.dash * k : null,
    subs: mapSubs(p.subs, (q) => {
      const r = m.transformPoint(new DOMPoint(q.x, q.y));
      return { x: r.x, y: r.y };
    }),
  }));
}

/** Traces sub-paths into a canvas context or a Path2D, optionally through a point mapping. */
export function trace(g: CanvasPath, subs: VSub[], f: (p: Pt) => Pt = (p) => p) {
  for (const s of subs) {
    const n = s.nodes;
    if (!n.length) continue;
    const p0 = f(n[0]);
    g.moveTo(p0.x, p0.y);
    const seg = (a: VNode, b: VNode) => {
      const q = f(b);
      if (!a.o && !b.i) return g.lineTo(q.x, q.y);
      const c1 = f(a.o ?? a);
      const c2 = f(b.i ?? b);
      g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y);
    };
    for (let k = 1; k < n.length; k++) seg(n[k - 1], n[k]);
    if (s.closed) {
      if (n.length > 1) seg(n[n.length - 1], n[0]);
      g.closePath();
    }
  }
}

export function path2d(p: VPath, f?: (p: Pt) => Pt) {
  const path = new Path2D();
  trace(path, p.subs, f);
  return path;
}

/** A box that holds the paths (control points bound a Bézier, so this never cuts a curve off). */
export function pathsBounds(paths: VPath[], withStroke = true): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of paths) {
    // Miter joins can poke out up to miterLimit × half the width; round/bevel just half.
    const pad = withStroke && p.stroke && p.width > 0 ? (p.join === "miter" ? p.width * 2 : p.width / 2) + 1 : 0;
    for (const s of p.subs)
      for (const n of s.nodes)
        for (const q of [n, n.i, n.o]) {
          if (!q) continue;
          if (q.x - pad < x0) x0 = q.x - pad;
          if (q.y - pad < y0) y0 = q.y - pad;
          if (q.x + pad > x1) x1 = q.x + pad;
          if (q.y + pad > y1) y1 = q.y + pad;
        }
  }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function drawPaths(g: CanvasRenderingContext2D, paths: VPath[]) {
  for (const p of paths) {
    const path = path2d(p);
    g.save();
    g.globalAlpha = p.opacity;
    if (p.fill) {
      g.fillStyle = p.fill;
      g.fill(path, p.rule);
    }
    if (p.stroke && p.width > 0) {
      g.strokeStyle = p.stroke;
      g.lineWidth = p.width;
      g.lineCap = p.cap;
      g.lineJoin = p.join;
      g.miterLimit = 4;
      g.setLineDash(p.dash ? [p.dash, p.dash] : []);
      g.stroke(path);
    }
    g.restore();
  }
}

/** Draws paths (in document space) into a fresh, snug canvas: the fields a vector layer needs. */
export function vectorPatch(paths: VPath[]): Pick<Layer, "canvas" | "x" | "y" | "vector"> {
  const b = pathsBounds(paths);
  if (!b) return { canvas: makeCanvas(1, 1), x: 0, y: 0, vector: { paths, ox: 0, oy: 0 } };
  const x = Math.floor(b.x) - 1;
  const y = Math.floor(b.y) - 1;
  const w = Math.min(16384, Math.ceil(b.x + b.w) - x + 2);
  const h = Math.min(16384, Math.ceil(b.y + b.h) - y + 2);
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.translate(-x, -y);
  drawPaths(g, paths);
  return { canvas: c, x, y, vector: { paths, ox: x, oy: y } };
}

/**
 * The layer redrawn from new paths (document space). A mask keeps its place: the part it covered
 * is copied over, anywhere new is revealed.
 */
export function withPaths(l: Layer, paths: VPath[]): Layer {
  const patch = vectorPatch(paths);
  let mask = l.mask;
  if (mask) {
    const m = makeCanvas(patch.canvas.width, patch.canvas.height);
    const g = ctx2d(m);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, m.width, m.height);
    g.clearRect(l.x - patch.x, l.y - patch.y, mask.width, mask.height);
    g.drawImage(mask, l.x - patch.x, l.y - patch.y);
    mask = m;
  }
  return { ...l, ...patch, mask, kind: "vector", text: undefined, shape: undefined };
}

/** A vector layer's paths in document space (wherever the layer has been moved to). */
export function layerPaths(l: Layer): VPath[] {
  const v = l.vector;
  if (!v) return [];
  const dx = l.x - v.ox;
  const dy = l.y - v.oy;
  return dx || dy ? mapPaths(v.paths, (p) => ({ x: p.x + dx, y: p.y + dy })) : v.paths;
}

/* ---------- Hit testing and editing ---------- */

let hitG: CanvasRenderingContext2D | null = null;
const hitCtx = () => (hitG ??= ctx2d(makeCanvas(1, 1)));

/** The topmost path under a point (inside its fill, or within `tol` of its stroke), or −1. */
export function hitPath(paths: VPath[], p: Pt, tol: number): number {
  const g = hitCtx();
  for (let i = paths.length - 1; i >= 0; i--) {
    const q = paths[i];
    const path = path2d(q);
    if (q.fill && g.isPointInPath(path, p.x, p.y, q.rule)) return i;
    g.lineWidth = Math.max(q.stroke ? q.width : 0, tol * 2);
    if (g.isPointInStroke(path, p.x, p.y)) return i;
  }
  return -1;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

const segCount = (s: VSub) => (s.closed ? s.nodes.length : s.nodes.length - 1);
const segEnds = (s: VSub, k: number) => [s.nodes[k], s.nodes[(k + 1) % s.nodes.length]] as const;

/** The closest point on any segment of a path: which sub-path, segment and where along it. */
export function nearestOnPath(p: VPath, q: Pt): { sub: number; seg: number; t: number; d: number } | null {
  let best: { sub: number; seg: number; t: number; d: number } | null = null;
  p.subs.forEach((s, si) => {
    for (let k = 0; k < segCount(s); k++) {
      const [a, b] = segEnds(s, k);
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const pt = cubicAt(a, a.o ?? a, b.i ?? b, b, t);
        const d = Math.hypot(pt.x - q.x, pt.y - q.y);
        if (!best || d < best.d) best = { sub: si, seg: k, t, d };
      }
    }
  });
  return best;
}

/** Splits a segment at t (de Casteljau), adding a node there; the shape doesn't change. */
export function splitSegment(s: VSub, k: number, t: number): VSub {
  const nodes = s.nodes.map((n) => ({ ...n }));
  const ai = k;
  const bi = (k + 1) % nodes.length;
  const a = nodes[ai];
  const b = nodes[bi];
  let mid: VNode;
  if (!a.o && !b.i) mid = node(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  else {
    const p1 = a.o ?? a;
    const p2 = b.i ?? b;
    const p01 = lerp(a, p1, t);
    const p12 = lerp(p1, p2, t);
    const p23 = lerp(p2, b, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const p0123 = lerp(p012, p123, t);
    a.o = p01;
    b.i = p23;
    mid = node(p0123.x, p0123.y, p012, p123);
  }
  nodes.splice(ai + 1, 0, mid);
  return { ...s, nodes };
}

/** Smooth ↔ corner: a corner gets handles along its neighbours' direction; a smooth node loses them. */
export function toggleSmooth(s: VSub, k: number): VSub {
  const nodes = s.nodes.map((n) => ({ ...n }));
  const n = nodes[k];
  if (n.i || n.o) {
    n.i = null;
    n.o = null;
    return { ...s, nodes };
  }
  const len = nodes.length;
  const prev = k > 0 ? nodes[k - 1] : s.closed ? nodes[len - 1] : null;
  const next = k < len - 1 ? nodes[k + 1] : s.closed ? nodes[0] : null;
  const from = prev ?? n;
  const to = next ?? n;
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const lp = prev ? Math.hypot(n.x - prev.x, n.y - prev.y) / 3 : 0;
  const ln = next ? Math.hypot(next.x - n.x, next.y - n.y) / 3 : 0;
  n.i = prev ? { x: n.x - dx * lp, y: n.y - dy * lp } : null;
  n.o = next ? { x: n.x + dx * ln, y: n.y + dy * ln } : null;
  return { ...s, nodes };
}

/** Removes a node; a sub-path left with fewer than two nodes goes too, and an empty path with it. */
export function deleteNode(p: VPath, si: number, k: number): VPath | null {
  const subs = p.subs
    .map((s, i) => (i === si ? { ...s, nodes: s.nodes.filter((_, j) => j !== k) } : s))
    .filter((s) => s.nodes.length >= 2);
  return subs.length ? { ...p, subs } : null;
}

/* ---------- Shapes as paths ---------- */

export function rectSub(x: number, y: number, w: number, h: number, rx = 0, ry = rx): VSub {
  rx = Math.max(0, Math.min(rx, w / 2));
  ry = Math.max(0, Math.min(ry, h / 2));
  if (!rx || !ry) return { closed: true, nodes: [node(x, y), node(x + w, y), node(x + w, y + h), node(x, y + h)] };
  const kx = rx * K;
  const ky = ry * K;
  return {
    closed: true,
    nodes: [
      node(x + rx, y, { x: x + rx - kx, y }, null),
      node(x + w - rx, y, null, { x: x + w - rx + kx, y }),
      node(x + w, y + ry, { x: x + w, y: y + ry - ky }, null),
      node(x + w, y + h - ry, null, { x: x + w, y: y + h - ry + ky }),
      node(x + w - rx, y + h, { x: x + w - rx + kx, y: y + h }, null),
      node(x + rx, y + h, null, { x: x + rx - kx, y: y + h }),
      node(x, y + h - ry, { x, y: y + h - ry + ky }, null),
      node(x, y + ry, null, { x, y: y + ry - ky }),
    ],
  };
}

export function ellipseSub(cx: number, cy: number, rx: number, ry: number): VSub {
  const kx = rx * K;
  const ky = ry * K;
  return {
    closed: true,
    nodes: [
      node(cx, cy - ry, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
      node(cx + rx, cy, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
      node(cx, cy + ry, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
      node(cx - rx, cy, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
    ],
  };
}

export const polySub = (pts: Pt[], closed = true): VSub => ({ closed, nodes: pts.map((p) => node(p.x, p.y)) });

/** A shape layer's geometry as editable paths, exactly where it's drawn (see `renderShape`). */
export function shapeToPaths(l: Layer): VPath[] {
  const s = l.shape;
  if (!s) return [];
  const pad = shapePad(s);
  const ox = l.x + pad;
  const oy = l.y + pad;
  const w = Math.max(1, Math.abs(s.w));
  const h = Math.max(1, Math.abs(s.h));
  const style = { fill: s.fill, stroke: s.stroke && s.strokeWidth > 0 ? s.stroke : null, width: s.strokeWidth, cap: "round" as const, join: "round" as const };
  switch (s.kind) {
    case "rect":
      return [newPath([rectSub(ox, oy, w, h, s.radius)], style)];
    case "ellipse":
      return [newPath([ellipseSub(ox + w / 2, oy + h / 2, w / 2, h / 2)], style)];
    case "polygon":
    case "star": {
      const n = Math.max(3, Math.round(s.sides));
      const count = s.kind === "star" ? n * 2 : n;
      const pts: Pt[] = [];
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
        const r = s.kind === "star" && i % 2 ? 0.45 : 1;
        pts.push({ x: ox + w / 2 + (w / 2) * r * Math.cos(a), y: oy + h / 2 + (h / 2) * r * Math.sin(a) });
      }
      return [newPath([polySub(pts)], style)];
    }
    case "line":
    case "arrow": {
      const x0 = s.w >= 0 ? 0 : w;
      const y0 = s.h >= 0 ? 0 : h;
      const a = { x: ox + x0, y: oy + y0 };
      const b = { x: ox + w - x0, y: oy + h - y0 };
      const subs: VSub[] = [polySub([a, b], false)];
      if (s.kind === "arrow") {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.max(10, s.strokeWidth * 4);
        subs.push(polySub([{ x: b.x - head * Math.cos(ang - 0.45), y: b.y - head * Math.sin(ang - 0.45) }, b, { x: b.x - head * Math.cos(ang + 0.45), y: b.y - head * Math.sin(ang + 0.45) }], false));
      }
      return [newPath(subs, { ...style, fill: null, stroke: s.stroke ?? s.fill ?? "#000000", width: Math.max(1, s.strokeWidth) })];
    }
  }
}

/* ---------- SVG path data ---------- */

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function subsToD(subs: VSub[]): string {
  const out: string[] = [];
  for (const s of subs) {
    const n = s.nodes;
    if (!n.length) continue;
    out.push(`M${fmt(n[0].x)} ${fmt(n[0].y)}`);
    const seg = (a: VNode, b: VNode) => {
      if (!a.o && !b.i) out.push(`L${fmt(b.x)} ${fmt(b.y)}`);
      else {
        const c1 = a.o ?? a;
        const c2 = b.i ?? b;
        out.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(b.x)} ${fmt(b.y)}`);
      }
    };
    for (let k = 1; k < n.length; k++) seg(n[k - 1], n[k]);
    if (s.closed) {
      if (n.length > 1 && (n[n.length - 1].o || n[0].i)) seg(n[n.length - 1], n[0]);
      out.push("Z");
    }
  }
  return out.join("");
}

/** SVG elliptical arc → cubic segments [c1x, c1y, c2x, c2y, x, y] (SVG 1.1, appendix F.6). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const sin = Math.sin((phi * Math.PI) / 180);
  const cos = Math.cos((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= Math.PI * 2;
  else if (sweep && dth < 0) dth += Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const d = dth / n;
  const t = (4 / 3) * Math.tan(d / 4);
  const at = (a: number) => [cos * rx * Math.cos(a) - sin * ry * Math.sin(a) + cx, sin * rx * Math.cos(a) + cos * ry * Math.sin(a) + cy];
  const tangent = (a: number) => [-cos * rx * Math.sin(a) - sin * ry * Math.cos(a), -sin * rx * Math.sin(a) + cos * ry * Math.cos(a)];
  const out: number[][] = [];
  let a1 = th1;
  for (let i = 0; i < n; i++) {
    const a2 = a1 + d;
    const p1 = at(a1);
    const p2 = at(a2);
    const d1 = tangent(a1);
    const d2 = tangent(a2);
    out.push([p1[0] + t * d1[0], p1[1] + t * d1[1], p2[0] - t * d2[0], p2[1] - t * d2[1], p2[0], p2[1]]);
    a1 = a2;
  }
  // Land exactly on the end point.
  out[out.length - 1][4] = x2;
  out[out.length - 1][5] = y2;
  return out;
}

/** Parses SVG path data (every command, absolute and relative) into sub-paths of cubic nodes. */
export function parseD(d: string): VSub[] {
  const subs: VSub[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const numRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const readNum = (): number | null => {
    skip();
    numRe.lastIndex = i;
    const m = numRe.exec(d);
    if (!m) return null;
    i = numRe.lastIndex;
    return parseFloat(m[0]);
  };
  const readFlag = (): boolean | null => {
    skip();
    const c = d[i];
    if (c !== "0" && c !== "1") return null;
    i++;
    return c === "1";
  };
  let cmd = "";
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let sub: VSub | null = null;
  let lastC: Pt | null = null; // the previous cubic's second control (for S)
  let lastQ: Pt | null = null; // the previous quadratic's control (for T)
  const open = () => {
    if (!sub || sub.closed) {
      sub = { nodes: [node(cur.x, cur.y)], closed: false };
      subs.push(sub);
    }
    return sub;
  };
  const lineTo = (p: Pt) => {
    open().nodes.push(node(p.x, p.y));
    cur = p;
  };
  const curveTo = (c1: Pt, c2: Pt, p: Pt) => {
    const s = open();
    s.nodes[s.nodes.length - 1].o = c1;
    s.nodes.push(node(p.x, p.y, c2, null));
    cur = p;
  };
  while (i < d.length) {
    skip();
    if (i >= d.length) break;
    const ch = d[i];
    if (/[a-zA-Z]/.test(ch)) {
      cmd = ch;
      i++;
    } else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cur.x : 0;
    const oy = rel ? cur.y : 0;
    let wasC = false;
    let wasQ = false;
    if (C === "Z") {
      if (sub) {
        const s = sub as VSub;
        const n = s.nodes;
        // A path that returns to its start before Z: the last node is the first one.
        if (n.length > 1 && Math.hypot(n[n.length - 1].x - n[0].x, n[n.length - 1].y - n[0].y) < 1e-6) {
          n[0].i = n[n.length - 1].i;
          n.pop();
        }
        s.closed = true;
      }
      cur = start;
      lastC = lastQ = null;
      continue;
    }
    const x = readNum();
    if (x === null && C !== "Z") {
      i++; // not a number where one should be: skip the character
      continue;
    }
    switch (C) {
      case "M": {
        const y = readNum() ?? 0;
        cur = { x: x! + ox, y: y + oy };
        start = cur;
        sub = { nodes: [node(cur.x, cur.y)], closed: false };
        subs.push(sub);
        cmd = rel ? "l" : "L"; // further pairs are line-tos
        break;
      }
      case "L": {
        const y = readNum() ?? 0;
        lineTo({ x: x! + ox, y: y + oy });
        break;
      }
      case "H":
        lineTo({ x: x! + ox, y: cur.y });
        break;
      case "V":
        lineTo({ x: cur.x, y: x! + oy });
        break;
      case "C": {
        const v = [x!, readNum() ?? 0, readNum() ?? 0, readNum() ?? 0, readNum() ?? 0, readNum() ?? 0];
        const c2 = { x: v[2] + ox, y: v[3] + oy };
        curveTo({ x: v[0] + ox, y: v[1] + oy }, c2, { x: v[4] + ox, y: v[5] + oy });
        lastC = c2;
        wasC = true;
        break;
      }
      case "S": {
        const v = [x!, readNum() ?? 0, readNum() ?? 0, readNum() ?? 0];
        const c1 = lastC ? { x: 2 * cur.x - lastC.x, y: 2 * cur.y - lastC.y } : cur;
        const c2 = { x: v[0] + ox, y: v[1] + oy };
        curveTo(c1, c2, { x: v[2] + ox, y: v[3] + oy });
        lastC = c2;
        wasC = true;
        break;
      }
      case "Q": {
        const v = [x!, readNum() ?? 0, readNum() ?? 0, readNum() ?? 0];
        const q = { x: v[0] + ox, y: v[1] + oy };
        const p = { x: v[2] + ox, y: v[3] + oy };
        curveTo(lerp(cur, q, 2 / 3), lerp(p, q, 2 / 3), p);
        lastQ = q;
        wasQ = true;
        break;
      }
      case "T": {
        const y = readNum() ?? 0;
        const prevQ: Pt | null = lastQ;
        const q: Pt = prevQ ? { x: 2 * cur.x - prevQ.x, y: 2 * cur.y - prevQ.y } : cur;
        const p = { x: x! + ox, y: y + oy };
        curveTo(lerp(cur, q, 2 / 3), lerp(p, q, 2 / 3), p);
        lastQ = q;
        wasQ = true;
        break;
      }
      case "A": {
        const ry = readNum() ?? 0;
        const rot = readNum() ?? 0;
        const large = readFlag() ?? false;
        const sw = readFlag() ?? false;
        const ex = (readNum() ?? 0) + ox;
        const ey = (readNum() ?? 0) + oy;
        const segs = arcToCubics(cur.x, cur.y, x!, ry, rot, large, sw, ex, ey);
        if (!segs.length) lineTo({ x: ex, y: ey });
        for (const s of segs) curveTo({ x: s[0], y: s[1] }, { x: s[2], y: s[3] }, { x: s[4], y: s[5] });
        break;
      }
      default:
        i++;
    }
    if (!wasC) lastC = null;
    if (!wasQ) lastQ = null;
  }
  return subs.filter((s) => s.nodes.length > 1 || s.closed);
}

/* ---------- SVG in ---------- */

export type SvgImport = { w: number; h: number; paths: VPath[]; notes: string[] };

const UNITS: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, rem: 16 };
function svgLength(v: string | null) {
  if (!v || v.trim().endsWith("%")) return 0;
  const m = /^\s*([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(v);
  if (!m) return 0;
  return parseFloat(m[1]) * (UNITS[m[2].toLowerCase()] ?? 1);
}

/** "rgb(…)" / "rgba(…)" / "none" / "url(#…)" → a hex colour and its alpha, or null. */
function cssColor(v: string, root: Element, notes: Set<string>): { hex: string; a: number } | null {
  v = v.trim();
  if (!v || v === "none" || v === "transparent") return null;
  const url = /url\(["']?#([^"')]+)["']?\)/.exec(v);
  if (url) {
    // Gradients and patterns become the colour of their first stop.
    const stop = root.querySelector(`[id="${CSS.escape(url[1])}"] stop`);
    notes.add("Gradients became solid colours.");
    if (!stop) return { hex: "#808080", a: 1 };
    return cssColor(getComputedStyle(stop).stopColor || "#808080", root, notes);
  }
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return a <= 0 ? null : { hex: rgbToHex(+m[1], +m[2], +m[3]), a };
  }
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return { hex: v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v.slice(0, 7), a: 1 };
  return { hex: "#000000", a: 1 };
}

function geometryOf(el: Element): VSub[] {
  const len = (a: string) => {
    const v = (el as unknown as Record<string, { baseVal?: { value: number } }>)[a]?.baseVal?.value;
    return typeof v === "number" ? v : parseFloat(el.getAttribute(a) ?? "0") || 0;
  };
  switch (el.tagName.toLowerCase()) {
    case "path":
      return parseD(el.getAttribute("d") ?? "");
    case "rect": {
      const w = len("width");
      const h = len("height");
      if (w <= 0 || h <= 0) return [];
      const hasRx = el.hasAttribute("rx");
      const hasRy = el.hasAttribute("ry");
      const rx = hasRx ? len("rx") : hasRy ? len("ry") : 0;
      const ry = hasRy ? len("ry") : rx;
      return [rectSub(len("x"), len("y"), w, h, rx, ry)];
    }
    case "circle": {
      const r = len("r");
      return r > 0 ? [ellipseSub(len("cx"), len("cy"), r, r)] : [];
    }
    case "ellipse": {
      const rx = len("rx");
      const ry = len("ry");
      return rx > 0 && ry > 0 ? [ellipseSub(len("cx"), len("cy"), rx, ry)] : [];
    }
    case "line":
      return [polySub([{ x: len("x1"), y: len("y1") }, { x: len("x2"), y: len("y2") }], false)];
    case "polyline":
    case "polygon": {
      const nums = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
      const pts: Pt[] = [];
      for (let k = 0; k + 1 < nums.length; k += 2) pts.push({ x: nums[k], y: nums[k + 1] });
      return pts.length > 1 ? [polySub(pts, el.tagName.toLowerCase() === "polygon")] : [];
    }
  }
  return [];
}

/**
 * Reads an SVG file into editable paths, sized for editing (small icons are scaled up). The file is
 * sanitised first and laid out off-screen, so CSS classes, `<style>`, nested transforms and
 * viewBoxes all resolve exactly as a browser would draw them.
 */
export async function importSvg(text: string): Promise<SvgImport> {
  const { default: DOMPurify } = await import("dompurify");
  const clean = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } });
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  // Off-screen and transparent, but not visibility:hidden: that would be inherited by every shape,
  // and shapes the file itself hides are skipped by that very property.
  host.style.cssText = "position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;width:0;height:0;overflow:hidden";
  host.innerHTML = clean;
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("That file has no SVG drawing in it.");
  const notes = new Set<string>();
  document.body.appendChild(host);
  try {
    const vb = svg.viewBox?.baseVal;
    let w = svgLength(svg.getAttribute("width"));
    let h = svgLength(svg.getAttribute("height"));
    if (vb && vb.width > 0 && vb.height > 0) {
      if (!w && !h) {
        w = vb.width;
        h = vb.height;
      } else if (!w) w = (h * vb.width) / vb.height;
      else if (!h) h = (w * vb.height) / vb.width;
    }
    if (!w || !h) {
      w ||= 300;
      h ||= 150;
    }
    // Icons are tiny: give them a canvas worth editing on.
    const k = Math.max(w, h) < 800 ? 1024 / Math.max(w, h) : Math.min(1, 6000 / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k));
    const H = Math.max(1, Math.round(h * k));
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    if (!vb || !vb.width) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const origin = svg.getBoundingClientRect();
    const paths: VPath[] = [];
    const els = svg.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon");
    for (const el of Array.from(els)) {
      if (el.closest("defs,clipPath,mask,symbol,marker,pattern")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const subs = geometryOf(el);
      if (!subs.length) continue;
      const screen = (el as SVGGraphicsElement).getScreenCTM();
      if (!screen) continue;
      const m = new DOMMatrix([1, 0, 0, 1, -origin.left, -origin.top]).multiply(new DOMMatrix([screen.a, screen.b, screen.c, screen.d, screen.e, screen.f]));
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      let opacity = 1;
      for (let a: Element | null = el; a && a !== svg.parentElement; a = a.parentElement) opacity *= parseFloat(getComputedStyle(a).opacity) || 0;
      const fill = cssColor(cs.fill, svg, notes);
      const stroke = cssColor(cs.stroke, svg, notes);
      const tag = el.tagName.toLowerCase();
      const fillable = tag !== "line" && tag !== "polyline";
      const width = (parseFloat(cs.strokeWidth) || 1) * scale;
      const fo = parseFloat(cs.fillOpacity || "1");
      const so = parseFloat(cs.strokeOpacity || "1");
      const dashes = cs.strokeDasharray && cs.strokeDasharray !== "none" ? parseFloat(cs.strokeDasharray) : NaN;
      const join = cs.strokeLinejoin === "round" || cs.strokeLinejoin === "bevel" ? cs.strokeLinejoin : "miter";
      const cap = cs.strokeLinecap === "round" || cs.strokeLinecap === "square" ? cs.strokeLinecap : "butt";
      const f = fillable || tag === "polyline" ? fill : null;
      if (!f && !stroke) continue;
      paths.push(
        newPath(
          mapSubs(subs, (q) => {
            const r = m.transformPoint(new DOMPoint(q.x, q.y));
            return { x: r.x, y: r.y };
          }),
          {
            name: el.id || el.getAttribute("class")?.split(/\s+/)[0] || tag,
            fill: f?.hex ?? null,
            stroke: stroke?.hex ?? null,
            width: stroke ? width : 0,
            opacity: Math.max(0, Math.min(1, opacity * (f ? fo * f.a : so * (stroke?.a ?? 1)))),
            cap,
            join,
            dash: Number.isFinite(dashes) && dashes > 0 ? dashes * scale : null,
            rule: cs.fillRule === "evenodd" ? "evenodd" : "nonzero",
          },
        ),
      );
    }
    if (svg.querySelector("text")) notes.add("Text in the SVG isn't editable as paths.");
    if (svg.querySelector("image")) notes.add("Pictures inside the SVG aren't paths.");
    if (svg.querySelector("use")) notes.add("Reused symbols (<use>) were skipped.");
    if (svg.querySelector("[filter], filter")) notes.add("SVG filters were left out.");
    return { w: W, h: H, paths, notes: [...notes] };
  } finally {
    host.remove();
  }
}

/* ---------- SVG out ---------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function pathEl(p: VPath) {
  const a = [`d="${subsToD(p.subs)}"`, `fill="${p.fill ?? "none"}"`];
  if (p.fill && p.rule === "evenodd") a.push(`fill-rule="evenodd"`);
  if (p.stroke && p.width > 0) {
    a.push(`stroke="${p.stroke}"`, `stroke-width="${fmt(p.width)}"`, `stroke-linecap="${p.cap}"`, `stroke-linejoin="${p.join}"`);
    if (p.dash) a.push(`stroke-dasharray="${fmt(p.dash)} ${fmt(p.dash)}"`);
  }
  if (p.opacity < 1) a.push(`opacity="${fmt(p.opacity)}"`);
  return `<path ${a.join(" ")}/>`;
}

/** An embedded picture of one layer as it looks (mask and styles applied), trimmed to its pixels. */
function imageEl(doc: Doc, l: Layer) {
  const full = layerAsDoc(doc, { ...l, opacity: 1, blend: "normal" });
  const b = opaqueBounds(full);
  if (!b) return "";
  const c = makeCanvas(b.w, b.h);
  ctx2d(c).drawImage(full, -b.x, -b.y);
  return `<image x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" href="${c.toDataURL("image/png")}"/>`;
}

/**
 * The document as SVG: vector and shape layers as real paths, text as live text, pixel layers as
 * embedded PNGs. Blend modes and opacity are kept; adjustment layers can't be expressed and are left out.
 */
export function docToSvg(doc: Doc, fontName: (family: string) => string): { svg: string; notes: string[] } {
  const notes = new Set<string>();
  const body: string[] = [];
  for (const l of doc.layers) {
    if (!l.visible) continue;
    if (l.kind === "adjustment") {
      notes.add("Adjustment layers can't be part of an SVG and were left out (export PNG to keep them).");
      continue;
    }
    if (l.clip) notes.add("Clipping masks were dropped.");
    const styled = !!l.effects || (!!l.mask && l.maskOn);
    let inner = "";
    if (!styled && l.kind === "vector") inner = layerPaths(l).map(pathEl).join("");
    else if (!styled && l.kind === "shape") inner = shapeToPaths(l).map(pathEl).join("");
    else if (!styled && l.kind === "text" && l.text) {
      const t = l.text;
      const lines = t.text.split("\n");
      const lh = t.size * t.lineHeight;
      const pad = Math.ceil((t.stroke?.width ?? 0) + t.size * 0.25 + (t.background ? t.size * 0.3 : 0));
      const w = l.canvas.width;
      const x = l.x + (t.align === "left" ? pad : t.align === "right" ? w - pad : w / 2);
      const anchor = t.align === "left" ? "start" : t.align === "right" ? "end" : "middle";
      if (t.background) inner += `<rect x="${l.x}" y="${l.y}" width="${w}" height="${l.canvas.height}" rx="${fmt(t.size * 0.2)}" fill="${t.background}"/>`;
      const attrs = [
        `font-family="${esc(fontName(t.font))}"`,
        `font-size="${fmt(t.size)}"`,
        `font-weight="${t.weight}"`,
        t.italic ? `font-style="italic"` : "",
        `fill="${t.color}"`,
        `text-anchor="${anchor}"`,
        `dominant-baseline="text-before-edge"`,
        t.letterSpacing ? `letter-spacing="${t.letterSpacing}"` : "",
        t.stroke && t.stroke.width > 0 ? `stroke="${t.stroke.color}" stroke-width="${fmt(t.stroke.width * 2)}" stroke-linejoin="round" paint-order="stroke"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      inner += lines.map((line, i) => `<text x="${fmt(x)}" y="${fmt(l.y + pad + i * lh + (lh - t.size) / 2)}" ${attrs} xml:space="preserve">${esc(line)}</text>`).join("");
    } else inner = imageEl(doc, l);
    if (!inner) continue;
    const g: string[] = [];
    if (l.opacity < 1) g.push(`opacity="${fmt(l.opacity)}"`);
    if (l.blend !== "normal") g.push(`style="mix-blend-mode:${l.blend === "lighter" ? "plus-lighter" : l.blend}"`);
    body.push(`<g id="${esc(l.name.replace(/\s+/g, "-"))}"${g.length ? " " + g.join(" ") : ""}>${inner}</g>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.w}" height="${doc.h}" viewBox="0 0 ${doc.w} ${doc.h}">\n${body.join("\n")}\n</svg>\n`;
  return { svg, notes: [...notes] };
}
