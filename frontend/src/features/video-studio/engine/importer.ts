import { proxyAllowed } from "../constants";
import { uid } from "../lib/time";
import { useStudio } from "../store/studio-store";
import type { MediaAsset } from "../types";
import { CONVERTIBLE, convertFile } from "./convert";
import { kindOf, mediaRuntime, probe } from "./media";
import { analyzeMedia } from "./persistence";
import { deleteMedia, persistStorage } from "./storage";

/** Bringing files into a project: from the computer, by drag and drop, or from a stock-media link. */

const STAGE = { reading: "Reading", copying: "Saving", analyzing: "Analysing" } as const;

/** True when the editor can decode the file frame by frame as it is. */
async function decodable(file: File) {
  try {
    const info = await probe(file);
    return info.kind === "image" || info.decodable;
  } catch {
    return false;
  }
}

/** Converts a file the browser can't decode (AVI, WMV, MPEG-2, ProRes…) with ffmpeg.wasm, showing progress under `temp`. */
async function convertForEditing(file: File, temp: string) {
  const st = useStudio.getState();
  st.setMediaStatus(temp, { state: "importing", progress: 0, message: `Converting ${file.name}` });
  return convertFile(file, {
    onProgress: (f, label) => useStudio.getState().setMediaStatus(temp, { state: "importing", progress: f, message: `${label} · ${file.name}` }),
    probeOk: decodable,
  });
}

export async function importFiles(files: File[], opts: { toTimeline?: boolean; at?: number; prefer?: { visual?: string; audio?: string } } = {}) {
  const st = useStudio.getState();
  void persistStorage();
  let at = opts.at;
  const added: string[] = [];
  for (const original of files) {
    const convertible = CONVERTIBLE.test(original.name);
    if (!kindOf(original) && !convertible) {
      st.notify(`${original.name} isn't a video, audio or image file.`, "warning");
      continue;
    }
    const temp = uid("tmp");
    st.setMediaStatus(temp, { state: "importing", progress: 0, message: original.name });
    try {
      let file = original;
      let converted = false;
      // Containers the browser can't open at all go straight to the converter.
      if (convertible && !(await decodable(original))) {
        file = await convertForEditing(original, temp);
        converted = true;
      }
      const run = (f: File) =>
        mediaRuntime.importFile(f, (s) => useStudio.getState().setMediaStatus(temp, { state: "importing", progress: s.progress, message: `${STAGE[s.stage]} ${f.name}` }));
      let asset: MediaAsset;
      try {
        asset = await run(file);
      } catch (e) {
        if (converted || kindOf(original) === "image") throw e;
        file = await convertForEditing(original, temp);
        converted = true;
        asset = await run(file);
      }
      // Plays but can't be decoded frame by frame (an unusual codec): convert so it exports too.
      if (!asset.decodable && asset.kind !== "image" && !converted) {
        try {
          const better = await convertForEditing(original, temp);
          const replacement = await run(better);
          await deleteMedia(asset.id, asset.storage).catch(() => undefined);
          mediaRuntime.release(asset.id);
          asset = replacement;
          converted = true;
        } catch (e) {
          console.warn("[studio] conversion failed; keeping the original", e);
        }
      }
      const s = useStudio.getState();
      s.setMediaStatus(temp, null);
      s.commit((p) => ({ ...p, media: { ...p.media, [asset.id]: asset } }));
      added.push(asset.id);
      if (converted) s.notify(`${original.name} was converted to ${asset.kind === "audio" ? "M4A" : "MP4"} on this device so it can be edited and exported.`, "success");
      else if (!asset.decodable && asset.kind !== "image") {
        s.notify(`${original.name} plays here, but this browser can't decode it frame by frame, so it won't export. Convert it to MP4 first.`, "warning");
      }
      if (opts.toTimeline) {
        s.addMedia(asset.id, at, opts.prefer);
        if (at !== undefined) at += asset.kind === "image" ? 5 : asset.duration;
      }
      void analyzeMedia(asset);
    } catch (e) {
      const s = useStudio.getState();
      s.setMediaStatus(temp, null);
      s.notify(`${original.name}: ${e instanceof Error ? e.message : "couldn't be opened"}`, "danger");
    }
  }
  return added;
}

async function viaProxy(url: string): Promise<Response> {
  const q = encodeURIComponent(url);
  // In production the route hands out a signed ticket and the browser downloads straight from the
  // backend (Vercel caps what a route may pass through); locally it streams through the route.
  try {
    const t = await fetch(`/api/tools/studio/proxy?direct=1&url=${q}`, { cache: "no-store" });
    if (t.ok) {
      const j = (await t.json()) as { url?: string; ticket?: string };
      if (j.url && j.ticket) return fetch(`${j.url}?url=${q}`, { headers: { "X-Upload-Ticket": j.ticket } });
    }
  } catch {
    /* fall back to streaming through the route */
  }
  return fetch(`/api/tools/studio/proxy?url=${q}`);
}

async function readWithProgress(res: Response, onProgress: (f: number) => void) {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    onProgress(got / total);
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get("content-type") ?? "" });
}

/**
 * A free stock clip, song or font file by its address (Pexels, Pixabay, Wikimedia Commons, the
 * Internet Archive…). Hosts that allow cross-origin reads are fetched directly; the rest go through
 * our backend's allowlisted proxy.
 */
export async function importFromUrl(raw: string) {
  const url = raw.trim();
  if (!proxyAllowed(url)) throw new Error("Use a direct file link from Pexels, Pixabay, Unsplash, Wikimedia Commons, the Internet Archive, Freesound, Mixkit or Coverr.");
  const st = useStudio.getState();
  const temp = uid("tmp");
  const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "download");
  st.setMediaStatus(temp, { state: "importing", progress: 0, message: `Downloading ${name}` });
  try {
    let res: Response | null = null;
    try {
      res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) res = null;
    } catch {
      res = null;
    }
    res ??= await viaProxy(url);
    if (!res.ok) {
      const detail = await res.json().then((j: { detail?: string }) => j.detail).catch(() => undefined);
      throw new Error(detail ?? `The download failed (${res.status}).`);
    }
    const blob = await readWithProgress(res, (f) => useStudio.getState().setMediaStatus(temp, { state: "importing", progress: f, message: `Downloading ${name}` }));
    const file = new File([blob], /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${(blob.type.split("/")[1] || "bin").replace("mpeg", "mp3")}`, { type: blob.type });
    useStudio.getState().setMediaStatus(temp, null);
    return importFiles([file]);
  } catch (e) {
    useStudio.getState().setMediaStatus(temp, null);
    throw e;
  }
}
