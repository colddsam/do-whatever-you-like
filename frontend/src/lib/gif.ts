/**
 * Animated GIFs in the browser.
 *
 * - `readGif` lists a GIF's frames, delays and loop setting by walking its blocks (no decoding).
 * - `retime` rewrites the delay of every frame and the loop count in place: the pictures are not
 *   touched, so changing speed this way is lossless and instant.
 * - `decodeFrames` + `encodeGif` re-draw the animation (for reversing, boomerangs, dropping frames to
 *   go faster than browsers allow, and making GIFs from video), with a palette per frame.
 *
 * Delays in GIFs are in centiseconds. Browsers treat 0 and 1 (and some 2) as "slow" (100 ms), so the
 * shortest delay that plays as written is 2 cs = 20 ms: MIN_DELAY_MS.
 */

export const MIN_DELAY_MS = 20;

export type GifInfo = {
  width: number;
  height: number;
  frames: number;
  /** Delay of each frame, in ms (as stored; 0 means "as fast as the viewer likes"). */
  delays: number[];
  /** 0 = forever, n = repeat n times, null = no loop block (plays once). */
  loop: number | null;
  /** Byte offsets of each frame's delay field, for in-place edits. */
  delayAt: number[];
};

class GifError extends Error {}

export function readGif(bytes: Uint8Array): GifInfo {
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (bytes.length < 13 || !ascii(0, 3).startsWith("GIF")) throw new GifError("That isn't a GIF file.");
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  let p = 13;
  if (bytes[10] & 0x80) p += 3 * (1 << ((bytes[10] & 7) + 1));
  const delays: number[] = [];
  const delayAt: number[] = [];
  let loop: number | null = null;
  let pendingDelay: { at: number; ms: number } | null = null;
  const skipSubBlocks = () => {
    while (p < bytes.length && bytes[p] !== 0) p += bytes[p] + 1;
    p++;
  };
  while (p < bytes.length) {
    const b = bytes[p];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p + 1];
      if (label === 0xf9 && bytes[p + 2] === 4) {
        pendingDelay = { at: p + 4, ms: (bytes[p + 4] | (bytes[p + 5] << 8)) * 10 };
        p += 8;
        continue;
      }
      if (label === 0xff && bytes[p + 2] === 11 && ascii(p + 3, 11).startsWith("NETSCAPE")) {
        if (bytes[p + 14] === 3 && bytes[p + 15] === 1) loop = bytes[p + 16] | (bytes[p + 17] << 8);
      }
      p += 2;
      skipSubBlocks();
      continue;
    }
    if (b === 0x2c) {
      const packed = bytes[p + 9];
      p += 10;
      if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
      p++; // LZW minimum code size
      skipSubBlocks();
      delays.push(pendingDelay?.ms ?? 0);
      delayAt.push(pendingDelay?.at ?? -1);
      pendingDelay = null;
      continue;
    }
    throw new GifError("This GIF is damaged (an unknown block).");
  }
  if (!delays.length) throw new GifError("This GIF has no frames.");
  return { width, height, frames: delays.length, delays, loop, delayAt };
}

/** Effective duration of a GIF as browsers play it (delays under 20 ms count as 100 ms). */
export const playedMs = (delays: number[]) => delays.reduce((s, d) => s + (d < MIN_DELAY_MS ? 100 : d), 0);

/**
 * New delays and loop, written into a copy of the file. Frames without a delay block (rare) keep
 * their default. `loop`: 0 forever, n repeats, null plays once.
 */
export function retime(bytes: Uint8Array, info: GifInfo, delaysMs: number[], loop: number | null): Uint8Array {
  let out = bytes.slice();
  info.delayAt.forEach((at, i) => {
    if (at < 0) return;
    const cs = Math.max(0, Math.min(65535, Math.round(delaysMs[i] / 10)));
    out[at] = cs & 0xff;
    out[at + 1] = cs >> 8;
  });
  // Loop: remove any NETSCAPE block, then add one unless it should play once.
  const start = 13 + (bytes[10] & 0x80 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
  const ascii = (o: number, n: number) => String.fromCharCode(...out.subarray(o, o + n));
  let p = start;
  while (p < out.length && out[p] === 0x21) {
    if (out[p + 1] === 0xff && out[p + 2] === 11 && ascii(p + 3, 11).startsWith("NETSCAPE")) {
      let q = p + 14;
      while (q < out.length && out[q] !== 0) q += out[q] + 1;
      out = concat(out.subarray(0, p), out.subarray(q + 1));
      break;
    }
    if (out[p + 1] === 0xf9) p += 8;
    else {
      p += 2;
      while (p < out.length && out[p] !== 0) p += out[p] + 1;
      p++;
    }
  }
  if (loop !== null) {
    const n = Math.max(0, Math.min(65535, loop));
    const block = new Uint8Array([0x21, 0xff, 11, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 3, 1, n & 0xff, n >> 8, 0]);
    out = concat(out.subarray(0, start), block, out.subarray(start));
  }
  return out;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** Every frame as a full picture (disposal methods applied), with its delay. */
export async function decodeFrames(bytes: Uint8Array): Promise<{ width: number; height: number; frames: { rgba: Uint8ClampedArray; delay: number }[] }> {
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const raw = decompressFrames(gif, true);
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames: { rgba: Uint8ClampedArray; delay: number }[] = [];
  let restore: Uint8ClampedArray | null = null;
  for (const f of raw) {
    const { left, top, width: fw, height: fh } = f.dims;
    if (f.disposalType === 3) restore = canvas.slice();
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const s = (y * fw + x) * 4;
        if (f.patch[s + 3] === 0) continue; // Transparent pixel: keep what's below.
        const cx = left + x;
        const cy = top + y;
        if (cx >= width || cy >= height) continue;
        const d = (cy * width + cx) * 4;
        canvas[d] = f.patch[s];
        canvas[d + 1] = f.patch[s + 1];
        canvas[d + 2] = f.patch[s + 2];
        canvas[d + 3] = 255;
      }
    }
    frames.push({ rgba: canvas.slice(), delay: f.delay || 0 });
    if (f.disposalType === 2) {
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const cx = left + x;
        const cy = top + y;
        if (cx < width && cy < height) canvas.fill(0, (cy * width + cx) * 4, (cy * width + cx) * 4 + 4);
      }
    } else if (f.disposalType === 3 && restore) {
      canvas.set(restore);
    }
  }
  return { width, height, frames };
}

/**
 * Encodes frames (RGBA, all the same size) as an animated GIF, each with its own palette of up to
 * `colors` colours. Transparent pixels stay transparent. Calls `onProgress` (0–1) and yields to the
 * browser between frames so the page stays responsive.
 */
export async function encodeGif(
  width: number,
  height: number,
  frames: { rgba: Uint8ClampedArray; delay: number }[],
  { loop = 0, colors = 256, onProgress, signal }: { loop?: number | null; colors?: number; onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const mod = await import("gifenc");
  // The ES build has named exports; the CommonJS one (Node, some tools) puts them on default.
  const { GIFEncoder, quantize, applyPalette } = ("GIFEncoder" in mod ? mod : (mod as unknown as { default: typeof mod }).default) as typeof mod;
  const enc = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { rgba, delay } = frames[i];
    let transparent = false;
    for (let k = 3; k < rgba.length; k += 16) if (rgba[k] < 128) { transparent = true; break; }
    const palette = quantize(rgba, colors, transparent ? { format: "rgba4444", oneBitAlpha: true } : { format: "rgb565" });
    const index = applyPalette(rgba, palette, transparent ? "rgba4444" : "rgb565");
    const transparentIndex = transparent ? palette.findIndex((c) => c.length > 3 && c[3] === 0) : -1;
    enc.writeFrame(index, width, height, {
      palette,
      delay: Math.max(MIN_DELAY_MS, Math.round(delay / 10) * 10),
      repeat: i === 0 ? (loop === null ? -1 : loop) : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: transparentIndex >= 0 ? 2 : 1,
    });
    onProgress?.((i + 1) / frames.length);
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }
  enc.finish();
  return new Blob([enc.bytes()], { type: "image/gif" });
}

export { GifError };
