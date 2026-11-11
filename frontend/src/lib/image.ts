/** Client side of the image tools: what each tool accepts, and the maths the page shows before sending. */

import { useEffect, useState } from "react";

export const IMAGE_API = (action: string) => `/api/tools/image/${action}`;
export const IMAGE_MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB on the backend.

const WEB = [".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp"];
const MORE = [".bmp", ".tif", ".tiff", ".avif", ".heic", ".heif"];
const RAW = [".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".rw2", ".orf", ".pef", ".raf", ".dng", ".raw", ".srw", ".3fr", ".kdc", ".mrw", ".x3f"];

/** Mirrors TOOL_INPUTS in backend/app/services/image.py. */
export const IMAGE_INPUTS = {
  compress: [...WEB, ".svg"],
  resize: [...WEB, ".svg", ...MORE],
  crop: [...WEB, ...MORE],
  rotate: [...WEB, ...MORE],
  convert: [...WEB, ...MORE, ".svg", ".psd", ".ico", ...RAW],
  gif: [...WEB, ...MORE],
  watermark: [...WEB, ...MORE],
  mark: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  blur: [...WEB, ...MORE],
  background: [...WEB, ...MORE],
  upscale: [...WEB, ...MORE],
  /** Browser-only tools (meme, photo editor): what a browser can draw on a canvas. */
  canvas: [".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".bmp", ".avif"],
} as const;
export type ImageInputKind = keyof typeof IMAGE_INPUTS;

export const acceptFor = (kind: ImageInputKind) => [...IMAGE_INPUTS[kind], ...(kind === "canvas" ? ["image/*"] : [])].join(",");

/** "JPG · PNG · GIF · WEBP · SVG" for the drop zone. */
export function formatList(kind: ImageInputKind) {
  const seen = new Set<string>();
  for (const e of IMAGE_INPUTS[kind]) {
    if ((RAW as readonly string[]).includes(e) && e !== ".raw") continue;
    const label = { ".jpeg": "JPG", ".jfif": "JPG", ".tiff": "TIFF", ".tif": "TIFF", ".heif": "HEIC", ".raw": "RAW" }[e] ?? e.slice(1).toUpperCase();
    seen.add(label);
  }
  return [...seen].join(" · ");
}

/** Browsers can't show these, so they get a format tag instead of a thumbnail. */
const NOT_PREVIEWABLE = [".heic", ".heif", ".tif", ".tiff", ".psd", ".ico", ...RAW];
export const canPreview = (name: string) => !NOT_PREVIEWABLE.some((e) => name.toLowerCase().endsWith(e));

/** The picture's size as the browser shows it (EXIF orientation applied, like the server). */
export function readSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** What X-Image-Info says about each result file. */
export type ImageResultFile = {
  name: string;
  source: string;
  before: number | null;
  after: number;
  width?: number;
  height?: number;
  frames?: number;
  truncated?: boolean;
};
export function parseImageInfo(raw?: string): ImageResultFile[] {
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as { files?: ImageResultFile[] }).files ?? [];
  } catch {
    return [];
  }
}

/** Mirrors target_size() on the backend: with the ratio kept, width and height are maximums. */
export function targetSize(
  w: number,
  h: number,
  o: { mode: "pixels" | "percent"; width: number | null; height: number | null; percent: number | null; keepRatio: boolean; noEnlarge: boolean },
) {
  let nw: number;
  let nh: number;
  if (o.mode === "percent") {
    const f = (o.percent ?? 100) / 100;
    nw = w * f;
    nh = h * f;
  } else if (o.keepRatio) {
    const sx = o.width ? o.width / w : Infinity;
    const sy = o.height ? o.height / h : Infinity;
    const s = Math.min(sx, sy);
    const k = s === Infinity ? 1 : s;
    nw = w * k;
    nh = h * k;
  } else {
    nw = o.width ?? w;
    nh = o.height ?? h;
  }
  if (o.noEnlarge && (nw > w || nh > h)) {
    if (o.keepRatio || o.mode === "percent") {
      nw = w;
      nh = h;
    } else {
      nw = Math.min(nw, w);
      nh = Math.min(nh, h);
    }
  }
  return { width: Math.max(1, Math.round(nw)), height: Math.max(1, Math.round(nh)) };
}

export type ImageCapabilities = {
  heic: boolean;
  raw: boolean;
  svg: boolean;
  background: boolean;
  upscale: boolean;
  faces: boolean;
  web: boolean;
  max_files: number;
  max_pixels: number;
  upscale_max_output_pixels: number;
};

let capsRequest: Promise<ImageCapabilities | null> | null = null;
/** What the server can do (formats, AI models), asked once per page load. Null while asking. */
export function useImageCapabilities() {
  const [caps, setCaps] = useState<ImageCapabilities | null>(null);
  useEffect(() => {
    capsRequest ??= fetch(IMAGE_API("capabilities"))
      .then((r) => (r.ok ? (r.json() as Promise<ImageCapabilities>) : null))
      .catch(() => null);
    let live = true;
    capsRequest.then((c) => {
      if (!c) capsRequest = null;
      if (live && c) setCaps(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

export const megapixels = (w: number, h: number) => `${((w * h) / 1e6).toFixed(w * h < 1e6 ? 2 : 1)} MP`;
