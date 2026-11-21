import type { ShapeContent } from "../../types";

/**
 * Shapes (rectangles, ellipses, stars, arrows…) are drawn with Canvas 2D at the size they appear
 * on screen and uploaded as a texture, like text, so their edges stay crisp at any export size.
 * One canvas per clip, redrawn only when the shape or the render scale changes.
 */

type Ctx = OffscreenCanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function poly(ctx: Ctx, pts: [number, number][], x: number, y: number, w: number, h: number) {
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h)));
  ctx.closePath();
}

export function shapePath(ctx: Ctx, s: ShapeContent, x: number, y: number, w: number, h: number, scale: number) {
  ctx.beginPath();
  switch (s.type) {
    case "ellipse":
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
      break;
    case "triangle":
      poly(ctx, [[0.5, 0], [1, 1], [0, 1]], x, y, w, h);
      break;
    case "star": {
      const n = Math.max(3, Math.round(s.points || 5));
      const k = Math.min(0.95, Math.max(0.1, s.radius || 0.45));
      const pts: [number, number][] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        const r = i % 2 ? k : 1;
        pts.push([0.5 + 0.5 * r * Math.cos(a), 0.5 + 0.5 * r * Math.sin(a)]);
      }
      poly(ctx, pts, x, y, w, h);
      break;
    }
    case "polygon": {
      const n = Math.max(3, Math.round(s.points || 6));
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
      }
      poly(ctx, pts, x, y, w, h);
      break;
    }
    case "heart": {
      const X = (v: number) => x + v * w;
      const Y = (v: number) => y + v * h;
      ctx.moveTo(X(0.5), Y(0.18));
      ctx.bezierCurveTo(X(0.5), Y(0.1), X(0.42), Y(0), X(0.26), Y(0));
      ctx.bezierCurveTo(X(0.08), Y(0), X(0), Y(0.16), X(0), Y(0.32));
      ctx.bezierCurveTo(X(0), Y(0.6), X(0.3), Y(0.78), X(0.5), Y(1));
      ctx.bezierCurveTo(X(0.7), Y(0.78), X(1), Y(0.6), X(1), Y(0.32));
      ctx.bezierCurveTo(X(1), Y(0.16), X(0.92), Y(0), X(0.74), Y(0));
      ctx.bezierCurveTo(X(0.58), Y(0), X(0.5), Y(0.1), X(0.5), Y(0.18));
      ctx.closePath();
      break;
    }
    case "arrow":
      poly(ctx, [[0, 0.32], [0.62, 0.32], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.68], [0, 0.68]], x, y, w, h);
      break;
    case "line":
      roundRect(ctx, x, y, w, h, h / 2);
      break;
    default:
      roundRect(ctx, x, y, w, h, (s.radius || 0) * scale);
  }
}

export class ShapeRasterizer {
  private cache = new Map<string, { canvas: OffscreenCanvas; key: string }>();

  draw(id: string, s: ShapeContent, scale: number, baseW: number, baseH: number) {
    const w = Math.max(2, Math.min(8192, Math.round(baseW * scale)));
    const h = Math.max(2, Math.min(8192, Math.round(baseH * scale)));
    const key = `${w}x${h}:${s.type}:${s.fill}:${s.fillOpacity}:${s.stroke}:${s.strokeWidth}:${s.radius}:${s.points}`;
    const hit = this.cache.get(id);
    if (hit && hit.key === key) return hit;
    const canvas = hit && hit.canvas.width === w && hit.canvas.height === h ? hit.canvas : new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    const sw = s.type === "line" ? 0 : Math.max(0, s.strokeWidth * scale);
    shapePath(ctx, s, sw / 2, sw / 2, w - sw, h - sw, scale);
    if (s.type === "line" || s.fillOpacity > 0) {
      ctx.globalAlpha = s.type === "line" ? 1 : s.fillOpacity;
      ctx.fillStyle = s.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (sw > 0) {
      ctx.lineWidth = sw;
      ctx.lineJoin = "round";
      ctx.strokeStyle = s.stroke;
      ctx.stroke();
    }
    const out = { canvas, key };
    this.cache.set(id, out);
    return out;
  }

  clear() {
    this.cache.clear();
  }
}
