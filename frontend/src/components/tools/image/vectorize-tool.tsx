"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, RotateCcw, Sparkles } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { ColorField } from "../utilities/design-engines";
import { CHECKER } from "./task";

/* ========================================================================
 * PURE-TS RASTER -> CLOSED SVG PATH TRACER
 * Boundary half-edge walker -> colinear merge -> RDP simplify -> Bezier fit
 * ======================================================================== */

type Point = [number, number];

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdpClosed(pts: Point[], eps: number): Point[] {
  if (pts.length <= 4 || eps <= 0) return pts;
  const rdpOpen = (arr: Point[], e: number): Point[] => {
    if (arr.length <= 2) return arr;
    let maxD = -1;
    let idx = 0;
    const first = arr[0];
    const last = arr[arr.length - 1];
    for (let i = 1; i < arr.length - 1; i++) {
      const d = distToSegment(arr[i], first, last);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > e) {
      const left = rdpOpen(arr.slice(0, idx + 1), e);
      const right = rdpOpen(arr.slice(idx), e);
      return [...left.slice(0, -1), ...right];
    }
    return [first, last];
  };
  const mid = Math.floor(pts.length / 2);
  const firstHalf = rdpOpen(pts.slice(0, mid + 1), eps);
  const secondHalf = rdpOpen([...pts.slice(mid), pts[0]], eps);
  const combined = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
  return combined.length >= 3 ? combined : pts.slice(0, 3);
}

function mergeColinear(pts: Point[]): Point[] {
  if (pts.length <= 3) return pts;
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (Math.abs(cross) > 1e-6) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
}

function loopToSvgPath(pts: Point[], smooth: "none" | "light" | "smooth", scaleX: number, scaleY: number): string {
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  const scaled: Point[] = pts.map(([x, y]) => [x * scaleX, y * scaleY]);
  if (scaled.length < 3) return "";
  if (smooth === "none") {
    return `M${scaled.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L")}Z`;
  }
  // Smooth closed curve using Chaikin / midpoint quadratic Beziers (weight blends straightness vs curvature)
  const w = smooth === "light" ? 0.25 : 0.5;
  const n = scaled.length;
  const startMidX = scaled[n - 1][0] + (scaled[0][0] - scaled[n - 1][0]) * (1 - w);
  const startMidY = scaled[n - 1][1] + (scaled[0][1] - scaled[n - 1][1]) * (1 - w);
  const cmds: string[] = [`M${fmt(startMidX)},${fmt(startMidY)}`];
  for (let i = 0; i < n; i++) {
    const cur = scaled[i];
    const next = scaled[(i + 1) % n];
    if (w < 0.5) {
      const enterX = scaled[(i - 1 + n) % n][0] + (cur[0] - scaled[(i - 1 + n) % n][0]) * (1 - w);
      const enterY = scaled[(i - 1 + n) % n][1] + (cur[1] - scaled[(i - 1 + n) % n][1]) * (1 - w);
      const exitX = cur[0] + (next[0] - cur[0]) * w;
      const exitY = cur[1] + (next[1] - cur[1]) * w;
      cmds.push(`L${fmt(enterX)},${fmt(enterY)}Q${fmt(cur[0])},${fmt(cur[1])} ${fmt(exitX)},${fmt(exitY)}`);
    } else {
      const mx = (cur[0] + next[0]) / 2;
      const my = (cur[1] + next[1]) / 2;
      cmds.push(`Q${fmt(cur[0])},${fmt(cur[1])} ${fmt(mx)},${fmt(my)}`);
    }
  }
  cmds.push("Z");
  return cmds.join("");
}

function traceBinaryMask(
  mask: Uint8Array,
  w: number,
  h: number,
  opts: { minPerimeter: number; simplify: number; smooth: "none" | "light" | "smooth"; scaleX: number; scaleY: number },
): { d: string; loopCount: number; nodeCount: number } {
  // Collect directed clockwise boundary edges around filled pixels
  const edges = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const k0 = key(x0, y0);
    const k1 = key(x1, y1);
    const list = edges.get(k0);
    if (list) list.push(k1);
    else edges.set(k0, [k1]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (y === 0 || !mask[(y - 1) * w + x]) addEdge(x, y, x + 1, y); // top
      if (x === w - 1 || !mask[y * w + (x + 1)]) addEdge(x + 1, y, x + 1, y + 1); // right
      if (y === h - 1 || !mask[(y + 1) * w + x]) addEdge(x + 1, y + 1, x, y + 1); // bottom
      if (x === 0 || !mask[y * w + (x - 1)]) addEdge(x, y + 1, x, y); // left
    }
  }

  const loops: Point[][] = [];
  for (const [startKey, nexts] of edges) {
    while (nexts.length > 0) {
      const loop: Point[] = [];
      let prevX = startKey % (w + 1);
      let prevY = Math.floor(startKey / (w + 1));
      let cur = nexts.pop()!;
      loop.push([prevX, prevY]);
      let guard = w * h * 4;
      while (cur !== startKey && guard-- > 0) {
        const cx = cur % (w + 1);
        const cy = Math.floor(cur / (w + 1));
        loop.push([cx, cy]);
        const cands = edges.get(cur);
        if (!cands || cands.length === 0) break;
        // Prefer rightmost turn when 2 edges meet at a checkerboard corner to stay on simple contours
        let pickIdx = cands.length - 1;
        if (cands.length > 1) {
          const dx = cx - prevX;
          const dy = cy - prevY;
          for (let i = 0; i < cands.length; i++) {
            const nx = cands[i] % (w + 1);
            const ny = Math.floor(cands[i] / (w + 1));
            const ndx = nx - cx;
            const ndy = ny - cy;
            // Right turn in screen coords (y down): cross = dx*ndy - dy*ndx > 0
            if (dx * ndy - dy * ndx > 0) {
              pickIdx = i;
              break;
            }
          }
        }
        prevX = cx;
        prevY = cy;
        cur = cands.splice(pickIdx, 1)[0];
      }
      if (loop.length >= opts.minPerimeter) {
        loops.push(loop);
      }
    }
  }

  let nodeCount = 0;
  const parts: string[] = [];
  for (const loop of loops) {
    const merged = mergeColinear(loop);
    const simp = rdpClosed(merged, opts.simplify);
    if (simp.length >= 3) {
      nodeCount += simp.length;
      const p = loopToSvgPath(simp, opts.smooth, opts.scaleX, opts.scaleY);
      if (p) parts.push(p);
    }
  }
  return { d: parts.join(" "), loopCount: parts.length, nodeCount };
}

function quantizeColors(data: Uint8ClampedArray, w: number, h: number, k: number): { hex: string; mask: Uint8Array }[] {
  const pts: [number, number, number, number][] = [];
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a < 64) continue;
    pts.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], i]);
  }
  if (pts.length === 0) return [];

  // Sample evenly for fast deterministic initial centroids (k-means++ style spread)
  const stride = Math.max(1, Math.floor(pts.length / 4000));
  const sampled = pts.filter((_, idx) => idx % stride === 0);
  const centroids: [number, number, number][] = [[sampled[0][0], sampled[0][1], sampled[0][2]]];
  while (centroids.length < k && centroids.length < sampled.length) {
    let bestPt = sampled[0];
    let bestDist = -1;
    for (const p of sampled) {
      let minD = Infinity;
      for (const c of centroids) {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < minD) minD = d;
      }
      if (minD > bestDist) {
        bestDist = minD;
        bestPt = p;
      }
    }
    centroids.push([bestPt[0], bestPt[1], bestPt[2]]);
  }

  // Run 6 iterations of K-Means on sampled pixels
  const sums = Array.from({ length: centroids.length }, () => [0, 0, 0, 0]);
  for (let iter = 0; iter < 6; iter++) {
    for (const s of sums) s.fill(0);
    for (const p of sampled) {
      let best = 0;
      let minD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = (p[0] - centroids[c][0]) ** 2 + (p[1] - centroids[c][1]) ** 2 + (p[2] - centroids[c][2]) ** 2;
        if (d < minD) {
          minD = d;
          best = c;
        }
      }
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      sums[best][3]++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [Math.round(sums[c][0] / sums[c][3]), Math.round(sums[c][1] / sums[c][3]), Math.round(sums[c][2] / sums[c][3])];
      }
    }
  }

  // Assign every non-transparent pixel to nearest centroid
  const masks = centroids.map(() => new Uint8Array(w * h));
  const counts = new Int32Array(centroids.length);
  for (const p of pts) {
    let best = 0;
    let minD = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const d = (p[0] - centroids[c][0]) ** 2 + (p[1] - centroids[c][1]) ** 2 + (p[2] - centroids[c][2]) ** 2;
      if (d < minD) {
        minD = d;
        best = c;
      }
    }
    masks[best][p[3]] = 1;
    counts[best]++;
  }

  const toHexByte = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return centroids
    .map((c, idx) => ({
      hex: `#${toHexByte(c[0])}${toHexByte(c[1])}${toHexByte(c[2])}`,
      mask: masks[idx],
      count: counts[idx],
    }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count); // largest area background/base layers first
}

/* ========================================================================
 * REACT COMPONENT
 * ======================================================================== */

async function makeSampleLogoFile(): Promise<File> {
  const c = document.createElement("canvas");
  c.width = 280;
  c.height = 280;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 280, 280);
  // Shield / badge silhouette + inner cutout so users immediately see multi-colour & hole tracing
  ctx.fillStyle = "#18181b";
  ctx.beginPath();
  ctx.roundRect(24, 24, 232, 232, 48);
  ctx.fill();
  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.arc(140, 140, 68, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(140, 92);
  ctx.lineTo(154, 126);
  ctx.lineTo(190, 140);
  ctx.lineTo(154, 154);
  ctx.lineTo(140, 188);
  ctx.lineTo(126, 154);
  ctx.lineTo(90, 140);
  ctx.lineTo(126, 126);
  ctx.closePath();
  ctx.fill();
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  return new File([blob], "sample-badge.png", { type: "image/png" });
}

export function ImageToSvgTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [pixels, setPixels] = useState<{ data: Uint8ClampedArray; w: number; h: number; origW: number; origH: number } | null>(null);
  const [mode, setMode] = useState<"mono" | "color">("color");
  const [threshold, setThreshold] = useState(145);
  const [invert, setInvert] = useState(false);
  const [inkColor, setInkColor] = useState("#18181b");
  const [colorCount, setColorCount] = useState(4);
  const [simplify, setSimplify] = useState(1.2);
  const [smooth, setSmooth] = useState<"none" | "light" | "smooth">("smooth");
  const [minSpeckle, setMinSpeckle] = useState(8);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function loadImageFile(f: File) {
    setError(null);
    const nextUrl = URL.createObjectURL(f);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = nextUrl;
    setFile(f);
    setSrcUrl(nextUrl);

    const img = new Image();
    img.src = nextUrl;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Could not decode that image file."));
    }).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not read image.");
    });

    if (!img.naturalWidth) return;
    // Cap working bitmap at 360px max edge for instant responsive slider updates (<15ms trace time)
    const maxDim = 340;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(16, Math.round(img.naturalWidth * scale));
    const h = Math.max(16, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    setPixels({ data: imgData.data, w, h, origW: img.naturalWidth, origH: img.naturalHeight });
  }

  const traced = useMemo(() => {
    if (!pixels) return null;
    const { data, w, h, origW, origH } = pixels;
    const scaleX = origW / w;
    const scaleY = origH / h;

    if (mode === "mono") {
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const a = data[i * 4 + 3];
        if (a < 96) {
          mask[i] = invert ? 1 : 0;
          continue;
        }
        const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        const filled = lum < threshold;
        mask[i] = (invert ? !filled : filled) ? 1 : 0;
      }
      const res = traceBinaryMask(mask, w, h, { minPerimeter: minSpeckle, simplify, smooth, scaleX, scaleY });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${origW} ${origH}" width="${origW}" height="${origH}">\n  <path fill="${inkColor}" fill-rule="evenodd" d="${res.d}" />\n</svg>`;
      return { svg, paths: res.loopCount, nodes: res.nodeCount };
    }

    const layers = quantizeColors(data, w, h, colorCount);
    const pathEls: string[] = [];
    let paths = 0;
    let nodes = 0;
    for (const layer of layers) {
      const res = traceBinaryMask(layer.mask, w, h, { minPerimeter: minSpeckle, simplify, smooth, scaleX, scaleY });
      if (!res.d) continue;
      paths += res.loopCount;
      nodes += res.nodeCount;
      pathEls.push(`  <path fill="${layer.hex}" fill-rule="evenodd" d="${res.d}" />`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${origW} ${origH}" width="${origW}" height="${origH}">\n${pathEls.join("\n")}\n</svg>`;
    return { svg, paths, nodes };
  }, [pixels, mode, threshold, invert, inkColor, colorCount, simplify, smooth, minSpeckle]);

  const stem = (file?.name ?? "vectorized").replace(/\.[^.]+$/, "");
  const copySvg = async () => {
    if (!traced?.svg) return;
    await navigator.clipboard.writeText(traced.svg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={!file ? 0 : 1}
      footer={<>Vectors are traced locally in your browser using pixel contour extraction and Bézier curve fitting. Nothing is uploaded.</>}
    >
      <div className="space-y-4 p-4 sm:p-5">
        {!file ? (
          <div className="space-y-3">
            <FileDrop
              accept="image/png,image/jpeg,image/webp,image/gif"
              title="Drop a PNG, JPG or WebP logo or sketch"
              formats="PNG · JPG · WEBP · GIF · processed locally"
              error={error}
              onFile={(f) => void loadImageFile(f)}
            />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={async () => void loadImageFile(await makeSampleLogoFile())}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                <Sparkles aria-hidden className="size-4" /> Try sample badge logo
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                {pixels && (
                  <p className="font-mono text-[12px] text-ink-3">
                    {pixels.origW}×{pixels.origH}px · {formatBytes(file.size)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => (setFile(null), setSrcUrl(null), setPixels(null))}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12px] text-ink-2 hover:text-ink"
              >
                <RotateCcw aria-hidden className="size-3.5" /> Different image
              </button>
            </div>

            <Panel>
              <Row label="Trace mode">
                <Chips
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "color", label: "Multi-colour palette" },
                    { value: "mono", label: "Black & white silhouette" },
                  ]}
                />
              </Row>
              {mode === "mono" ? (
                <Row label="Threshold">
                  <div className="grid gap-3 @xl:grid-cols-2">
                    <Slider label="Luminance cutoff" value={threshold} min={20} max={240} onChange={setThreshold} />
                    <ColorField label="Vector ink colour" value={inkColor} onChange={setInkColor} />
                  </div>
                  <div className="mt-2.5">
                    <Toggle checked={invert} onChange={setInvert} label="Invert foreground / background" />
                  </div>
                </Row>
              ) : (
                <Row label="Palette">
                  <Slider label="Max colours" value={colorCount} min={2} max={10} onChange={setColorCount} format={(v) => `${v} colours`} />
                </Row>
              )}
              <Row label="Path tuning">
                <div className="grid gap-3 @xl:grid-cols-2">
                  <Slider label="Curve simplification" value={simplify} min={0} max={4} step={0.2} onChange={setSimplify} format={(v) => `${v} px`} />
                  <Slider label="Noise / speckle filter" value={minSpeckle} min={4} max={48} step={2} onChange={setMinSpeckle} format={(v) => `≥${v} pts`} />
                </div>
                <div className="mt-3">
                  <Chips
                    value={smooth}
                    onChange={setSmooth}
                    options={[
                      { value: "none", label: "Sharp polygons" },
                      { value: "light", label: "Light curves" },
                      { value: "smooth", label: "Smooth Bézier" },
                    ]}
                    label="Corner style"
                  />
                </div>
              </Row>
            </Panel>

            {/* Side-by-side Raster vs Traced Vector */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="overflow-hidden rounded-md border border-line bg-surface">
                <div className="border-b border-line bg-paper px-3.5 py-2">
                  <span className="label-mono text-ink-3">Original raster</span>
                </div>
                <div className={cn("grid min-h-56 place-items-center p-4", CHECKER)}>
                  {srcUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={srcUrl} alt="Original image" className="max-h-64 max-w-full object-contain" />
                  )}
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2">
                  <span className="label-mono text-ink-2">Traced SVG</span>
                  {traced && (
                    <span className="font-mono text-[12px] text-ink-3">
                      {traced.paths} paths · {traced.nodes} nodes · {formatBytes(new TextEncoder().encode(traced.svg).length)}
                    </span>
                  )}
                </div>
                <div className={cn("grid min-h-56 place-items-center p-4", CHECKER)}>
                  {traced?.svg && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`data:image/svg+xml;utf8,${encodeURIComponent(traced.svg)}`}
                      alt="Vectorized SVG"
                      className="max-h-64 max-w-full object-contain"
                    />
                  )}
                </div>
              </div>
            </div>

            {traced && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void copySvg()}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3"
                >
                  {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
                  {copied ? "Copied SVG" : "Copy SVG code"}
                </button>
                <button
                  type="button"
                  onClick={() => saveBlob(new Blob([traced.svg], { type: "image/svg+xml;charset=utf-8" }), `${stem}.svg`)}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-white hover:opacity-95"
                >
                  <Download aria-hidden className="size-4" /> Download .svg
                </button>
              </div>
            )}

            <Notice tone="info">
              Best results come from logos, icons, typography and high-contrast sketches. Lowering &ldquo;Max colours&rdquo; or raising &ldquo;Noise filter&rdquo; keeps the output SVG clean and lightweight.
            </Notice>
          </>
        )}
      </div>
    </Workbench>
  );
}
