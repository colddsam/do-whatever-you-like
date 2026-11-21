import { ALL_FORMATS, AudioBufferSink, BlobSource, BufferTarget, CanvasSink, Conversion, Input, Mp4OutputFormat, Output, QUALITY_MEDIUM } from "mediabunny";
import { PEAKS_RATE } from "../constants";
import { uid } from "../lib/time";
import type { MediaAsset, MediaKind } from "../types";
import { getMedia, kv, putMedia } from "./storage";

/**
 * The media runtime: the live, non-serialisable side of the project's media. It turns a MediaAsset
 * (saved in the project) back into a File, an object URL for <video>/<audio>, an ImageBitmap for
 * stills, and the thumbnails and waveform peaks the timeline draws.
 */

export type Thumbs = { times: number[]; urls: string[]; w: number; h: number };
/** Waveform envelope: [min, max] pairs at PEAKS_RATE per second, scaled to -127..127. */
export type Peaks = { rate: number; data: Int8Array };
export type Mask = { data: Uint8Array; width: number; height: number };

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|3gp|ts|mts|m2ts|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba|aif|aiff)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i;

export function kindOf(file: File): MediaKind | null {
  const t = file.type;
  if (t.startsWith("video/") || VIDEO_EXT.test(file.name)) return "video";
  if (t.startsWith("audio/") || AUDIO_EXT.test(file.name)) return "audio";
  if (t.startsWith("image/") || IMAGE_EXT.test(file.name)) return "image";
  return null;
}

export const openInput = (file: Blob) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120];
function normalizeFps(f: number) {
  if (!Number.isFinite(f) || f <= 0) return 30;
  const near = COMMON_FPS.find((c) => Math.abs(c - f) / c < 0.012);
  return near ?? Math.min(240, Math.max(1, Math.round(f * 100) / 100));
}

type Probe = Omit<MediaAsset, "id" | "storage" | "addedAt" | "proxy">;

function probeWithElement(file: File, kind: MediaKind): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    const done = () => URL.revokeObjectURL(url);
    const timer = setTimeout(() => {
      done();
      reject(new Error("This file didn't open in time."));
    }, 15_000);
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      const v = el as HTMLVideoElement;
      const hasVideo = kind !== "audio" && v.videoWidth > 0;
      resolve({
        name: file.name,
        kind: hasVideo ? "video" : "audio",
        mime: file.type,
        size: file.size,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        width: hasVideo ? v.videoWidth : 0,
        height: hasVideo ? v.videoHeight : 0,
        fps: 30,
        rotation: 0,
        hasVideo,
        hasAudio: true,
        decodable: false,
      });
      done();
    };
    el.onerror = () => {
      clearTimeout(timer);
      done();
      reject(new Error("This browser can't play this file. Convert it to MP4 (H.264) first."));
    };
    el.src = url;
  });
}

export async function probe(file: File): Promise<Probe> {
  const kind = kindOf(file);
  if (!kind) throw new Error("That isn't a video, audio or image file.");
  if (kind === "image") {
    const bmp = await createImageBitmap(file);
    const out: Probe = { name: file.name, kind, mime: file.type, size: file.size, duration: 0, width: bmp.width, height: bmp.height, fps: 0, rotation: 0, hasVideo: true, hasAudio: false, decodable: true };
    bmp.close();
    return out;
  }
  const input = openInput(file);
  try {
    const [vt, at] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (!vt && !at) throw new Error("no tracks");
    const duration = await input.computeDuration();
    const out: Probe = { name: file.name, kind: vt ? "video" : "audio", mime: file.type, size: file.size, duration, width: 0, height: 0, fps: 0, rotation: 0, hasVideo: !!vt, hasAudio: !!at, decodable: true };
    if (vt) {
      const [w, h, rot, codec, stats, ok] = await Promise.all([vt.getDisplayWidth(), vt.getDisplayHeight(), vt.getRotation(), vt.getCodec(), vt.computePacketStats(90), vt.canDecode()]);
      Object.assign(out, { width: w, height: h, rotation: rot, codec: codec ?? undefined, fps: normalizeFps(stats.averagePacketRate), decodable: ok });
    }
    if (at) {
      const [sr, ch, codec] = await Promise.all([at.getSampleRate(), at.getNumberOfChannels(), at.getCodec()]);
      Object.assign(out, { sampleRate: sr, channels: ch, audioCodec: codec ?? undefined });
      if (!vt) out.decodable = await at.canDecode().catch(() => false);
    }
    if (!(duration > 0)) throw new Error("no duration");
    return out;
  } catch {
    // Mediabunny can't read it; the browser's own player may still play it (preview only).
    return probeWithElement(file, kind);
  } finally {
    input.dispose();
  }
}

async function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type = "image/jpeg", quality = 0.72): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, quality));
}

const THUMB_H = 72;

async function thumbsFromElement(file: File, times: number[], w: number, h: number): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const out: Blob[] = [];
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("video"));
    });
    for (const t of times) {
      await new Promise<void>((res) => {
        const timer = setTimeout(res, 4000);
        v.onseeked = () => {
          clearTimeout(timer);
          res();
        };
        v.currentTime = t;
      });
      ctx.drawImage(v, 0, 0, w, h);
      out.push(await toBlob(canvas));
    }
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
  return out;
}

async function makeThumbs(file: File, a: MediaAsset): Promise<{ times: number[]; blobs: Blob[]; w: number; h: number } | null> {
  const h = THUMB_H * 2;
  const w = Math.max(32, Math.round((h * (a.width || 16)) / (a.height || 9)));
  if (a.kind === "image") {
    const bmp = await createImageBitmap(file, { resizeHeight: h, resizeQuality: "medium" });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    return { times: [0], blobs: [await toBlob(c)], w: c.width, h: c.height };
  }
  if (!a.hasVideo) return null;
  const count = Math.max(6, Math.min(60, Math.ceil(a.duration / 2)));
  const times = Array.from({ length: count }, (_, i) => (a.duration * (i + 0.5)) / count);
  if (!a.decodable) return { times, blobs: await thumbsFromElement(file, times, w, h), w, h };
  const input = openInput(file);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) return null;
    const sink = new CanvasSink(vt, { width: w, height: h, fit: "cover" });
    const blobs: Blob[] = [];
    let last: Blob | null = null;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (wc) last = await toBlob(wc.canvas);
      if (last) blobs.push(last);
    }
    return blobs.length ? { times: times.slice(0, blobs.length), blobs, w, h } : null;
  } finally {
    input.dispose();
  }
}

function accumulate(buf: AudioBuffer, t0: number, mins: Float32Array, maxs: Float32Array) {
  const sr = buf.sampleRate;
  const a = buf.getChannelData(0);
  const b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const len = buf.length;
  let i = 0;
  while (i < len) {
    const bucket = Math.floor((t0 + i / sr) * PEAKS_RATE);
    const end = Math.min(len, Math.max(i + 1, Math.ceil(((bucket + 1) / PEAKS_RATE - t0) * sr)));
    let mn = 0;
    let mx = 0;
    for (let j = i; j < end; j++) {
      const v = b ? (a[j] + b[j]) * 0.5 : a[j];
      if (v < mn) mn = v;
      else if (v > mx) mx = v;
    }
    if (bucket >= 0 && bucket < mins.length) {
      if (mn < mins[bucket]) mins[bucket] = mn;
      if (mx > maxs[bucket]) maxs[bucket] = mx;
    }
    i = end;
  }
}

async function makePeaks(file: File, a: MediaAsset, onProgress?: (f: number) => void): Promise<Peaks | null> {
  if (!a.hasAudio || !(a.duration > 0)) return null;
  const n = Math.ceil(a.duration * PEAKS_RATE) + 1;
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  let ok = false;
  if (a.decodable || a.kind === "audio") {
    const input = openInput(file);
    try {
      const at = await input.getPrimaryAudioTrack();
      if (at && (await at.canDecode())) {
        let tick = performance.now();
        for await (const { buffer, timestamp } of new AudioBufferSink(at).buffers()) {
          accumulate(buffer, timestamp, mins, maxs);
          if (performance.now() - tick > 32) {
            onProgress?.(Math.min(1, timestamp / a.duration));
            await new Promise((r) => setTimeout(r, 0));
            tick = performance.now();
          }
        }
        ok = true;
      }
    } catch (e) {
      console.warn("[studio] streaming waveform failed, decoding whole file", e);
    } finally {
      input.dispose();
    }
  }
  if (!ok) {
    // Browsers without AudioDecoder (or odd containers): decode the whole file once.
    if (file.size > 600 * 1024 * 1024) return null;
    const ctx = new OfflineAudioContext(1, 1, 44_100);
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    accumulate(buf, 0, mins, maxs);
  }
  const data = new Int8Array(n * 2);
  for (let i = 0; i < n; i++) {
    data[2 * i] = Math.max(-127, Math.round(mins[i] * 127));
    data[2 * i + 1] = Math.min(127, Math.round(maxs[i] * 127));
  }
  return { rate: PEAKS_RATE, data };
}

export type ImportStatus = { stage: "copying" | "reading" | "analyzing"; progress: number };

class MediaRuntime {
  private files = new Map<string, File>();
  private urls = new Map<string, string>();
  private proxyFiles = new Map<string, File>();
  private proxyUrls = new Map<string, string>();
  private bitmaps = new Map<string, ImageBitmap>();
  private bitmapJobs = new Map<string, Promise<void>>();
  readonly thumbs = new Map<string, Thumbs>();
  readonly peaks = new Map<string, Peaks>();
  readonly masks = new Map<string, Mask>();
  private listeners = new Set<() => void>();
  private ver = 0;

  /** For useSyncExternalStore: bumps whenever thumbnails, peaks, masks or bitmaps arrive. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  version = () => this.ver;
  private changed() {
    this.ver++;
    for (const l of this.listeners) l();
  }

  file(id: string) {
    return this.files.get(id) ?? null;
  }
  has(id: string) {
    return this.files.has(id);
  }

  /** An object URL for <video>/<audio>. With `proxy`, the lighter proxy copy when there is one. */
  url(id: string, proxy = false): string | null {
    if (proxy) {
      const pf = this.proxyFiles.get(id);
      if (pf) {
        let u = this.proxyUrls.get(id);
        if (!u) this.proxyUrls.set(id, (u = URL.createObjectURL(pf)));
        return u;
      }
    }
    const f = this.files.get(id);
    if (!f) return null;
    let u = this.urls.get(id);
    if (!u) this.urls.set(id, (u = URL.createObjectURL(f)));
    return u;
  }

  /** A still's decoded picture, or null while it decodes (a change notification follows). */
  bitmap(id: string): ImageBitmap | null {
    const b = this.bitmaps.get(id);
    if (b) return b;
    const f = this.files.get(id);
    if (f && !this.bitmapJobs.has(id)) {
      this.bitmapJobs.set(
        id,
        createImageBitmap(f, { premultiplyAlpha: "premultiply", imageOrientation: "from-image" })
          .then((bmp) => {
            this.bitmaps.set(id, bmp);
            this.changed();
          })
          .catch((e) => console.warn("[studio] image decode failed", e)),
      );
    }
    return null;
  }

  /** Brings a saved asset back after a reload. False when its file is gone (cleared site data). */
  async attach(a: MediaAsset): Promise<boolean> {
    if (this.files.has(a.id)) return true;
    const f = await getMedia(a.id, a.storage, a.name, a.mime);
    if (!f) return false;
    this.files.set(a.id, f);
    if (a.proxy) {
      const pf = await getMedia(a.proxy.id, a.proxy.storage, `${a.name}.proxy.mp4`, "video/mp4");
      if (pf) this.proxyFiles.set(a.id, pf);
    }
    const [th, pk, mk] = await Promise.all([
      kv.get<{ times: number[]; blobs: Blob[]; w: number; h: number }>(`thumbs:${a.id}`),
      kv.get<Peaks>(`peaks:${a.id}`),
      kv.get<Mask>(`mask:${a.id}`),
    ]);
    if (th) this.setThumbs(a.id, th);
    if (pk) this.peaks.set(a.id, pk);
    if (mk) this.masks.set(a.id, mk);
    this.changed();
    return true;
  }

  private setThumbs(id: string, th: { times: number[]; blobs: Blob[]; w: number; h: number }) {
    const old = this.thumbs.get(id);
    old?.urls.forEach((u) => URL.revokeObjectURL(u));
    this.thumbs.set(id, { times: th.times, urls: th.blobs.map((b) => URL.createObjectURL(b)), w: th.w, h: th.h });
  }

  /** Copies a file into local storage and reads its details. Thumbnails and waveform follow via `analyze`. */
  async importFile(file: File, onStatus?: (s: ImportStatus) => void): Promise<MediaAsset> {
    onStatus?.({ stage: "reading", progress: 0 });
    const info = await probe(file);
    const id = uid("m");
    const storage = await putMedia(id, file, (f) => onStatus?.({ stage: "copying", progress: f }));
    const stored = (await getMedia(id, storage, file.name, file.type)) ?? file;
    this.files.set(id, stored);
    return { ...info, id, storage, addedAt: Date.now() };
  }

  /** Thumbnails and waveform peaks, computed once and kept in IndexedDB. */
  async analyze(a: MediaAsset, onProgress?: (f: number) => void) {
    const f = this.files.get(a.id);
    if (!f) return;
    if (!this.thumbs.has(a.id)) {
      const th = await makeThumbs(f, a).catch((e) => (console.warn("[studio] thumbnails failed", e), null));
      if (th) {
        await kv.set(`thumbs:${a.id}`, th);
        this.setThumbs(a.id, th);
        this.changed();
      }
    }
    if (a.hasAudio && !this.peaks.has(a.id)) {
      const pk = await makePeaks(f, a, onProgress).catch((e) => (console.warn("[studio] waveform failed", e), null));
      if (pk) {
        await kv.set(`peaks:${a.id}`, pk);
        this.peaks.set(a.id, pk);
        this.changed();
      }
    }
  }

  /**
   * A 540p H.264 copy for smooth playback of heavy footage (4K, high bit rates). The preview uses it
   * when "Use proxies" is on; exports always read the original.
   */
  async createProxy(a: MediaAsset, onProgress?: (f: number) => void): Promise<MediaAsset["proxy"]> {
    const f = this.files.get(a.id);
    if (!f || !a.hasVideo) throw new Error("Only videos get proxies.");
    const h = Math.min(540, a.height);
    const w = Math.round(((a.width / a.height) * h) / 2) * 2;
    const input = openInput(f);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    try {
      const conv = await Conversion.init({ input, output, video: { width: w, height: h, fit: "contain", codec: "avc", bitrate: QUALITY_MEDIUM }, audio: { codec: "aac" } });
      if (!conv.isValid) throw new Error("This video can't be converted in this browser.");
      conv.onProgress = (p) => onProgress?.(p);
      await conv.execute();
    } finally {
      input.dispose();
    }
    const blob = new Blob([target.buffer!], { type: "video/mp4" });
    const id = uid("px");
    const storage = await putMedia(id, blob);
    this.proxyFiles.set(a.id, new File([blob], `${a.name}.proxy.mp4`, { type: "video/mp4" }));
    const old = this.proxyUrls.get(a.id);
    if (old) URL.revokeObjectURL(old);
    this.proxyUrls.delete(a.id);
    this.changed();
    return { id, storage, width: w, height: h };
  }

  setMask(mediaId: string, m: Mask) {
    this.masks.set(mediaId, m);
    void kv.set(`mask:${mediaId}`, m);
    this.changed();
  }

  release(id: string) {
    for (const map of [this.urls, this.proxyUrls]) {
      const u = map.get(id);
      if (u) URL.revokeObjectURL(u);
      map.delete(id);
    }
    this.thumbs.get(id)?.urls.forEach((u) => URL.revokeObjectURL(u));
    this.thumbs.delete(id);
    this.bitmaps.get(id)?.close();
    this.bitmaps.delete(id);
    this.bitmapJobs.delete(id);
    this.files.delete(id);
    this.proxyFiles.delete(id);
    this.peaks.delete(id);
    this.masks.delete(id);
    this.changed();
  }
}

export const mediaRuntime = new MediaRuntime();
