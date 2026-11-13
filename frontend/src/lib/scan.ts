/**
 * The document scanner's brain on the page side: talks to the vision worker (public/scan/scan-worker.js,
 * OpenCV.js served from /vendor) and decides, frame by frame, what to tell the person and when to shoot.
 * Everything runs in the browser and is free: no camera frame ever leaves the device.
 */

export type Point = [number, number];
/** Four corners in 0..1 of the frame: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
export type Filter = "auto" | "gray" | "bw" | "original";

export type Detection = { quad: Quad | null; confidence: number; brightness: number; sharpness: number; text: number };

export const FULL: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]];

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** One worker for the page's lifetime; it loads OpenCV once (about 10 MB, then cached). */
class Vision {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  ready: Promise<void> | null = null;

  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const w = new Worker("/scan/scan-worker.js");
      this.worker = w;
      const timer = setTimeout(() => reject(new Error("The scanner took too long to load. Check your connection and try again.")), 60_000);
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        const p = this.pending.get(m.id);
        if (!p) {
          if (m.type === "error" && m.id === undefined) {
            clearTimeout(timer);
            reject(new Error("The scanner couldn't start in this browser."));
          }
          return;
        }
        this.pending.delete(m.id);
        if (m.type === "error") p.reject(new Error(m.message));
        else p.resolve(m);
      };
      w.onerror = () => {
        clearTimeout(timer);
        reject(new Error("The scanner couldn't start in this browser."));
      };
    });
    this.ready.catch(() => {
      this.worker?.terminate();
      this.worker = null;
      this.ready = null;
    });
    return this.ready;
  }

  private call<T>(msg: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage({ ...msg, id }, transfer);
    });
  }

  async detect(img: ImageData): Promise<Detection> {
    await this.start();
    return this.call<Detection>({ type: "detect", width: img.width, height: img.height, buffer: img.data.buffer }, [img.data.buffer]);
  }

  async process(img: ImageData, quad: Quad | null, filter: Filter, rotate: number, maxSide = 3000): Promise<ImageData> {
    await this.start();
    const r = await this.call<{ width: number; height: number; buffer: ArrayBuffer }>(
      { type: "process", width: img.width, height: img.height, buffer: img.data.buffer, quad, filter, rotate, maxSide },
      [img.data.buffer],
    );
    return new ImageData(new Uint8ClampedArray(r.buffer), r.width, r.height);
  }

  /** Outlines of the dark marks in a picture (pixel coordinates, holes marked). */
  async trace(img: ImageData, epsilon: number): Promise<TracedContour[]> {
    await this.start();
    const r = await this.call<{ contours: TracedContour[] }>({ type: "trace", width: img.width, height: img.height, buffer: img.data.buffer, epsilon }, [img.data.buffer]);
    return r.contours;
  }

  /** A photographed handwriting template: its page number and the traced outline of each cell (0..1 of the cell). */
  async sheet(img: ImageData, layout: SheetLayout): Promise<SheetResult> {
    await this.start();
    return this.call<SheetResult>({ type: "sheet", width: img.width, height: img.height, buffer: img.data.buffer, layout }, [img.data.buffer]);
  }
}

export type TracedContour = { points: number[]; hole: boolean };
export type SheetLayout = { width: number; height: number; scale: number; markers: [number, number][]; bits: number[][]; cells: number[][] };
export type SheetResult = { ok: boolean; reason?: string; page: number; cells: { filled: number; contours: TracedContour[] }[] };

export const vision = new Vision();

/* ---------- pixels ---------- */

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Pixels of a video frame or picture, scaled so the longer side is at most `max`. */
export function pixels(source: CanvasImageSource & { width?: number; height?: number }, sw: number, sh: number, max: number): ImageData {
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = canvas(Math.round(sw * k), Math.round(sh * k));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(source, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height);
}

export function toJpeg(img: ImageData, quality = 0.9): Promise<Blob> {
  const c = canvas(img.width, img.height);
  c.getContext("2d")!.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the page."))), "image/jpeg", quality));
}

export async function decode(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

/* ---------- guidance ---------- */

export type Hint = { key: string; text: string; tone: "search" | "adjust" | "good" | "warn" };

const area = (q: Quad) => {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

const side = (a: Point, b: Point, aspect: number) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);

/**
 * Tracks the page over recent frames: smooths the corners (so the outline glides rather than
 * jitters) and says how steady it is (0..1). Auto-capture fires after ~0.8 s of steadiness.
 */
export class Tracker {
  private smooth: Quad | null = null;
  private steadyFrames = 0;
  private lost = 0;
  /** Frame width / height, so distances are measured in square units. */
  constructor(private aspect = 16 / 9, private need = 8) {}

  update(q: Quad | null): { quad: Quad | null; steady: number } {
    if (!q) {
      this.lost++;
      this.steadyFrames = 0;
      if (this.lost > 4) this.smooth = null;
      return { quad: this.smooth, steady: 0 };
    }
    this.lost = 0;
    if (!this.smooth) {
      this.smooth = q;
      this.steadyFrames = 0;
      return { quad: q, steady: 0 };
    }
    const move = Math.max(...q.map((p, i) => side(p, this.smooth![i], this.aspect)));
    this.steadyFrames = move < 0.018 ? this.steadyFrames + 1 : 0;
    const k = move > 0.08 ? 0.75 : 0.4; // Follow big moves fast, settle small ones.
    this.smooth = this.smooth.map((p, i) => [p[0] + (q[i][0] - p[0]) * k, p[1] + (q[i][1] - p[1]) * k]) as Quad;
    return { quad: this.smooth, steady: Math.min(1, this.steadyFrames / this.need) };
  }

  reset() {
    this.smooth = null;
    this.steadyFrames = 0;
  }
}

/** What to tell the person about this frame, most important first. */
export function hint(d: Detection | null, quad: Quad | null, steady: number, aspect: number): Hint {
  if (!d) return { key: "start", text: "Starting the scanner…", tone: "search" };
  if (d.brightness < 55) return { key: "dark", text: "Too dark. Find more light, or turn on the torch", tone: "warn" };
  if (!quad) return { key: "find", text: "Point the camera at a document", tone: "search" };
  const a = area(quad);
  const edge = quad.some(([x, y]) => x < 0.012 || y < 0.012 || x > 0.988 || y > 0.988);
  if (edge) return { key: "back", text: "Move back a little: keep all four corners in view", tone: "adjust" };
  if (a < 0.18) return { key: "closer", text: "Move closer so the page fills the frame", tone: "adjust" };
  // Very uneven opposite sides: the phone is held at a steep angle.
  const top = side(quad[0], quad[1], aspect);
  const bottom = side(quad[3], quad[2], aspect);
  const left = side(quad[0], quad[3], aspect);
  const right = side(quad[1], quad[2], aspect);
  if (Math.max(top, bottom) / Math.min(top, bottom) > 1.45 || Math.max(left, right) / Math.min(left, right) > 1.45) {
    return { key: "tilt", text: "Hold the phone flatter, straight above the page", tone: "adjust" };
  }
  if (d.brightness > 245) return { key: "glare", text: "Too bright. Avoid glare on the page", tone: "warn" };
  if (d.sharpness < 60) return { key: "blur", text: "Hold steady while it focuses", tone: "adjust" };
  if (steady < 1) return { key: "steady", text: "Hold still…", tone: "good" };
  return { key: "go", text: "Capturing", tone: "good" };
}
