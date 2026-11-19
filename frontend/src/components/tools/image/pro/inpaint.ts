import { cloneCanvas, ctx2d, opaqueBounds } from "./doc";

/*
 * Fills an area of a picture from what's around it (spot healing brush, content-aware fill).
 * The work runs in /photo/inpaint-worker.js on just the area around the mask, so even a big photo
 * only sends a small patch.
 */

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: { rgba: ArrayBuffer; engine: string }) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker("/photo/inpaint-worker.js");
  worker.onmessage = (e: MessageEvent<{ id: number; rgba?: ArrayBuffer; engine?: string; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error || !e.data.rgba) p.reject(new Error(e.data.error ?? "Healing failed."));
    else p.resolve({ rgba: e.data.rgba, engine: e.data.engine ?? "js" });
  };
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new Error("The healing engine couldn't start."));
    pending.clear();
    worker = null;
  };
  return worker;
}

/**
 * Returns a copy of `pixels` with the area where `mask` is opaque filled in. Both canvases are the
 * same size (layer space).
 */
export async function inpaint(pixels: HTMLCanvasElement, mask: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const b = opaqueBounds(mask);
  if (!b) return pixels;
  // Enough surroundings for the fill to read from.
  const margin = Math.max(24, Math.round(Math.max(b.w, b.h) * 0.6));
  const x = Math.max(0, b.x - margin);
  const y = Math.max(0, b.y - margin);
  const w = Math.min(pixels.width, b.x + b.w + margin) - x;
  const h = Math.min(pixels.height, b.y + b.h + margin) - y;
  const img = ctx2d(pixels, true).getImageData(x, y, w, h);
  const m = ctx2d(mask, true).getImageData(x, y, w, h).data;
  const bytes = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bytes[i] = m[i * 4 + 3] > 20 ? 255 : 0;
  const id = ++seq;
  const res = await new Promise<{ rgba: ArrayBuffer; engine: string }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, width: w, height: h, rgba: img.data.buffer, mask: bytes.buffer, radius: 5 }, [img.data.buffer, bytes.buffer]);
  });
  const out = cloneCanvas(pixels);
  ctx2d(out).putImageData(new ImageData(new Uint8ClampedArray(res.rgba), w, h), x, y);
  return out;
}
