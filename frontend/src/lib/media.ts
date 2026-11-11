/** Client helpers for the downloader tools. All requests go through /api/tools/*. */

import { filenameFrom, saveBlob, type DirectTarget } from "./files";

export type Platform = "youtube" | "instagram" | "facebook";

export type MediaItem = {
  type: "video" | "image";
  url: string;
  label: string;
  /** Bytes, when the server could tell. */
  size?: number;
};

/** One shape for all three platforms, so the UI stays the same everywhere. */
export type MediaPreview = {
  title: string;
  author?: string;
  duration?: number;
  views?: number;
  thumbnail?: string;
  vertical: boolean;
  items: MediaItem[];
  /** What the download button will hand back. */
  output: "MP4" | "ZIP" | "File";
  /** Predicted size of that file in bytes, and whether it's exact or approximate. */
  size?: number;
  sizeExact: boolean;
};

export class ToolError extends Error {}

/* ---------- Backend response shapes (see backend/app/schemas) ---------- */

type VideoItem = { url: string; type?: string; resolution?: string | null; width?: number | null; height?: number | null };
type SizeFields = { estimated_size?: number | null; size_is_exact?: boolean };
type YoutubeRes = SizeFields & {
  title?: string | null;
  uploader?: string | null;
  duration?: number | null;
  view_count?: number | null;
  thumbnail?: string | null;
  is_short?: boolean;
  items: VideoItem[];
};
type FacebookRes = Omit<YoutubeRes, "view_count" | "is_short">;
type InstagramRes = SizeFields & {
  title?: string | null;
  owner_username: string;
  is_carousel: boolean;
  media_count: number;
  items: { type: string; url: string; width?: number | null; height?: number | null; size?: number | null }[];
};

const dims = (w?: number | null, h?: number | null) => (w && h ? `${w}×${h}` : undefined);
const isVertical = (w?: number | null, h?: number | null) => Boolean(w && h && h > w);

function normalize(platform: Platform, raw: unknown): MediaPreview {
  if (platform === "instagram") {
    const r = raw as InstagramRes;
    const first = r.items[0];
    const image = r.items.find((i) => i.type === "image");
    return {
      title: r.title?.split("\n")[0] || `Post by @${r.owner_username}`,
      author: `@${r.owner_username}`,
      thumbnail: image?.url,
      vertical: first ? isVertical(first.width, first.height) || first.type === "video" : false,
      items: r.items.map((i, n) => ({
        type: i.type === "video" ? "video" : "image",
        url: i.url,
        label: [`${i.type === "video" ? "Video" : "Image"} ${r.items.length > 1 ? n + 1 : ""}`.trim(), dims(i.width, i.height)]
          .filter(Boolean)
          .join(" · "),
        size: i.size ?? undefined,
      })),
      output: r.items.length > 1 ? "ZIP" : "File",
      size: r.estimated_size ?? undefined,
      // A ZIP adds a little packaging around the files, so its size is close but not exact.
      sizeExact: Boolean(r.size_is_exact) && r.items.length === 1,
    };
  }

  const r = raw as YoutubeRes | FacebookRes;
  const first = r.items[0];
  return {
    title: r.title || "Untitled video",
    author: r.uploader ?? undefined,
    duration: r.duration ?? undefined,
    views: "view_count" in r ? (r.view_count ?? undefined) : undefined,
    thumbnail: r.thumbnail ?? undefined,
    vertical: ("is_short" in r && Boolean(r.is_short)) || isVertical(first?.width, first?.height),
    items: r.items.map((i) => ({
      type: "video",
      url: i.url,
      label: ["Video", i.resolution || dims(i.width, i.height)].filter(Boolean).join(" · "),
    })),
    output: r.items.length > 1 ? "ZIP" : "MP4",
    size: r.estimated_size ?? undefined,
    // Video and audio are merged into one MP4 after downloading, which shifts the size slightly.
    sizeExact: false,
  };
}

async function readError(res: Response): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new ToolError(body?.detail ?? `Request failed (${res.status}).`);
}

const post = (platform: Platform, action: "extract" | "download", url: string, signal?: AbortSignal) =>
  fetch(`/api/tools/${platform}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });

/**
 * Fetches the file straight from the backend when our route hands out a ticket (hosted frontends
 * stop a route after a few minutes, and a long video can take longer), through the route otherwise.
 */
async function startDownload(platform: Platform, url: string, signal?: AbortSignal) {
  const endpoint = `/api/tools/${platform}/download`;
  const pre = await fetch(`${endpoint}?direct=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return null;
  });
  if (pre && !pre.ok) return pre; // The link itself was rejected; show why.
  const direct = (await pre?.json().catch(() => null)) as (DirectTarget & { body: unknown }) | null;
  if (!direct?.url || !direct.ticket) return post(platform, "download", url, signal);
  return fetch(direct.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Upload-Ticket": direct.ticket },
    body: JSON.stringify(direct.body),
    signal,
  });
}

export async function extract(platform: Platform, url: string, signal?: AbortSignal) {
  const res = await post(platform, "extract", url, signal);
  if (!res.ok) await readError(res);
  const preview = normalize(platform, await res.json());
  if (preview.items.length === 0) throw new ToolError("We found the post, but nothing in it can be downloaded.");
  return preview;
}

/**
 * Asks the backend to prepare the file, streams it with progress, then hands it to the browser.
 * `onProgress` receives a 0–1 fraction once bytes start arriving (null when size is unknown).
 */
export async function download(
  platform: Platform,
  url: string,
  {
    signal,
    onStart,
    onProgress,
  }: {
    signal?: AbortSignal;
    onStart?: (total: number | null) => void;
    /** 0–1 once bytes arrive (null when the size is unknown), plus bytes received so far. */
    onProgress?: (p: number | null, received: number) => void;
  },
) {
  const res = await startDownload(platform, url, signal);
  if (!res.ok) await readError(res);
  const total = Number(res.headers.get("x-file-size") ?? res.headers.get("content-length")) || 0;
  onStart?.(total || null);
  const name = filenameFrom(res.headers.get("content-disposition"), `${platform}-download`);
  const type = res.headers.get("content-type") ?? "application/octet-stream";

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new ToolError("The download stream couldn't be opened.");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(total ? Math.min(received / total, 1) : null, received);
  }

  saveBlob(new Blob(chunks, { type }), name);
  return { name, size: received };
}

/* ---------- Formatting + validation ---------- */

export function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export const formatCount = (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n);

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** A size that may be a prediction: "24.3 MB" when exact, "≈ 24.3 MB" when estimated. */
export const formatSize = (n: number, exact: boolean) => `${exact ? "" : "≈ "}${formatBytes(n)}`;

/** Cheap browser-side check so obvious mistakes don't cost a round trip. */
export function checkLink(input: string, hosts: string[], allowShortcode = false): string | null {
  const value = input.trim();
  if (!value) return "Paste a link first.";
  if (allowShortcode && /^[A-Za-z0-9_-]{10,39}$/.test(value)) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return "That doesn't look like a link.";
  }
  const ok = hosts.some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? null : `This tool only works with ${hosts[0]} links.`;
}
