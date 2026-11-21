import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  WebMOutputFormat,
  type Input,
  type InputVideoTrack,
  type VideoSample,
} from "mediabunny";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { AUDIO_BITRATE, AUDIO_SAMPLE_RATE, EXPORT_SIZES, videoBitrate, type ExportQualityId, type ExportSizeId } from "../constants";
import { projectDuration } from "../lib/timeline";
import type { Project } from "../types";
import { loadSegmenter, segmentFrame } from "./ai/segmenter";
import { AudioMixer } from "./audio";
import { ensureProjectFonts } from "./fonts";
import { ensureLuts } from "./luts";
import { mediaRuntime, openInput } from "./media";
import { WebGLCompositor, type MaskRef, type SourceProvider } from "./render/compositor";
import { buildScene, layerDraws, type LayerDraw } from "./render/scene";
import { encodeWav } from "./sfx";
import { exportFile, opfsWritable } from "./storage";

/**
 * WebCodecsExporter: renders the timeline frame by frame at full resolution and encodes it in the
 * browser, hardware-accelerated where the GPU offers it.
 *
 * - Pictures: every video clip is decoded with Mediabunny's VideoSampleSink at the exact source time
 *   of each output frame (not by seeking a <video>, which can land a frame early), drawn by the same
 *   WebGLCompositor the preview uses into a full-size OffscreenCanvas, and fed to a VideoEncoder.
 * - Sound: the mix is rendered with OfflineAudioContext in 5 s windows, interleaved with the pictures,
 *   and fed to an AudioEncoder (AAC, or Opus where AAC isn't available).
 * - File: Mediabunny's muxer (the successor of mp4-muxer, by the same author) writes an MP4 with its
 *   index at the front, in memory; exports too big for memory stream into the private file system.
 */

/** mp4 = H.264 + AAC (falls back to WebM); webm = VP9 + Opus; gif = animated GIF (no sound); wav/m4a = the sound only. */
export type ExportFormat = "mp4" | "webm" | "gif" | "wav" | "m4a";
export type ExportSettings = { size: ExportSizeId; fps: number; quality: ExportQualityId; name: string; format?: ExportFormat; range?: [number, number] };
export type ExportProgress = { phase: "preparing" | "rendering" | "finishing"; frame: number; total: number; fps: number; eta: number };
export type ExportResult = { blob: Blob; filename: string; mime: string; videoCodec: string; audioCodec: string | null; bytes: number; seconds: number; warnings: string[]; width: number; height: number };

export class ExportCanceled extends Error {
  constructor() {
    super("Export canceled.");
  }
}

export function exportDimensions(p: Project, size: ExportSizeId) {
  const scale = EXPORT_SIZES.find((s) => s.id === size)?.scale ?? 1;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(p.settings.width * scale), height: even(p.settings.height * scale) };
}

/** H.264 level for a frame size and rate (macroblocks per frame / per second, from the spec's table). */
function avcLevel(w: number, h: number, fps: number) {
  const fs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const rate = fs * fps;
  const levels: [number, number, number][] = [
    [0x1f, 3600, 108_000],
    [0x20, 5120, 216_000],
    [0x28, 8192, 245_760],
    [0x2a, 8704, 522_240],
    [0x32, 22_080, 589_824],
    [0x33, 36_864, 983_040],
    [0x34, 36_864, 2_073_600],
    [0x3c, 139_264, 4_177_920],
  ];
  const lv = levels.find(([, f, r]) => fs <= f && rate <= r)?.[0] ?? 0x34;
  return lv.toString(16).padStart(2, "0");
}

type VideoChoice = { config: VideoEncoderConfig; codec: "avc" | "vp9" | "vp8"; container: "mp4" | "webm"; label: string };

async function pickVideo(w: number, h: number, fps: number, bitrate: number, preferWebm = false): Promise<VideoChoice | null> {
  const lv = avcLevel(w, h, fps);
  const avc: [string, VideoChoice["codec"], VideoChoice["container"], string][] = [
    [`avc1.6400${lv}`, "avc", "mp4", "H.264 High"],
    [`avc1.4d00${lv}`, "avc", "mp4", "H.264 Main"],
    [`avc1.42e0${lv}`, "avc", "mp4", "H.264 Baseline"],
  ];
  const vp: [string, VideoChoice["codec"], VideoChoice["container"], string][] = [
    ["vp09.00.40.08", "vp9", "webm", "VP9"],
    ["vp8", "vp8", "webm", "VP8"],
  ];
  const tries = preferWebm ? [...vp, ...avc] : [...avc, ...vp];
  for (const hw of ["prefer-hardware", "no-preference"] as const) {
    for (const [codec, id, container, label] of tries) {
      const config: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw, latencyMode: "quality", ...(id === "avc" ? { avc: { format: "avc" } } : {}) };
      const res = await VideoEncoder.isConfigSupported(config).catch(() => null);
      if (res?.supported) return { config, codec: id, container, label };
    }
  }
  return null;
}

async function pickAudio(container: "mp4" | "webm"): Promise<{ config: AudioEncoderConfig; codec: "aac" | "opus"; label: string } | null> {
  if (typeof AudioEncoder === "undefined") return null;
  const tries: [string, "aac" | "opus", string][] = container === "mp4" ? [["mp4a.40.2", "aac", "AAC"], ["opus", "opus", "Opus"]] : [["opus", "opus", "Opus"]];
  for (const [codec, id, label] of tries) {
    const config: AudioEncoderConfig = { codec, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
    const res = await AudioEncoder.isConfigSupported(config).catch(() => null);
    if (res?.supported) return { config, codec: id, label };
  }
  return null;
}

/** Frames of one clip at a planned list of source times, decoded in order. */
class ClipFrames {
  private iter: AsyncGenerator<VideoSample | null, void, unknown> | null = null;
  private last: VideoSample | null = null;
  constructor(
    private sink: VideoSampleSink,
    private times: number[],
  ) {}
  async next(): Promise<VideoSample | null> {
    this.iter ??= this.sink.samplesAtTimestamps(this.times);
    const r = await this.iter.next();
    if (r.done) return this.last;
    const s = r.value;
    if (!s) return this.last;
    if (s !== this.last) this.last?.close();
    this.last = s;
    return s;
  }
  close() {
    void this.iter?.return(undefined);
    this.last?.close();
    this.last = null;
  }
}

export class WebCodecsExporter {
  private canceled = false;
  cancel() {
    this.canceled = true;
  }

  /** Just the sound: a WAV (lossless) or an M4A (AAC, falling back to Opus in WebM). */
  private async runAudio(p: Project, settings: ExportSettings, format: "wav" | "m4a", t0: number, t1: number, onProgress: (e: ExportProgress) => void): Promise<ExportResult> {
    const mixer = new AudioMixer(p);
    if (!mixer.hasSound()) throw new Error("There's no sound on the timeline to export.");
    const duration = t1 - t0;
    if (format === "wav" && duration > 3 * 3600) throw new Error("WAV exports are limited to 3 hours; use M4A for longer.");
    const WIN = 10;
    const total = Math.ceil(duration / WIN);
    const started = performance.now();
    const base = (settings.name || "audio").replace(/[\\/:*?"<>|]+/g, " ").trim() || "audio";
    onProgress({ phase: "preparing", frame: 0, total, fps: 0, eta: 0 });
    try {
      if (format === "wav") {
        const chunks: AudioBuffer[] = [];
        for (let a = t0, k = 0; a < t1 - 1e-6; a += WIN, k++) {
          if (this.canceled) throw new ExportCanceled();
          chunks.push(await mixer.render(a, Math.min(t1, a + WIN), AUDIO_SAMPLE_RATE, 2));
          onProgress({ phase: "rendering", frame: k + 1, total, fps: 0, eta: 0 });
        }
        const len = chunks.reduce((n, b) => n + b.length, 0);
        const all = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE });
        let o = 0;
        for (const b of chunks) {
          for (let ch = 0; ch < 2; ch++) all.copyToChannel(b.getChannelData(Math.min(ch, b.numberOfChannels - 1)), ch, o);
          o += b.length;
        }
        const blob = encodeWav(all);
        return { blob, filename: `${base}.wav`, mime: "audio/wav", videoCodec: "", audioCodec: "PCM 16-bit", bytes: blob.size, seconds: (performance.now() - started) / 1000, warnings: [], width: 0, height: 0 };
      }
      const audio = (await pickAudio("mp4")) ?? (await pickAudio("webm"));
      if (!audio) throw new Error("This browser can't encode audio; export WAV instead.");
      const webm = audio.codec === "opus";
      const target = new BufferTarget();
      const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }), target });
      const src = new EncodedAudioPacketSource(audio.codec);
      output.addAudioTrack(src);
      await output.start();
      let failure: Error | null = null;
      let chain: Promise<unknown> = Promise.resolve();
      const enc = new AudioEncoder({
        output: (chunk, meta) => {
          chain = chain.then(() => src.add(EncodedPacket.fromEncodedChunk(chunk), meta));
        },
        error: (e) => {
          failure = e;
        },
      });
      enc.configure(audio.config);
      try {
        for (let a = t0, k = 0; a < t1 - 1e-6; a += WIN, k++) {
          if (this.canceled) throw new ExportCanceled();
          if (failure) throw failure;
          const buf = await mixer.render(a, Math.min(t1, a + WIN), AUDIO_SAMPLE_RATE, 2);
          const n = buf.length;
          const data = new Float32Array(n * 2);
          data.set(buf.getChannelData(0), 0);
          data.set(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0), n);
          const ad = new AudioData({ format: "f32-planar", sampleRate: AUDIO_SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((a - t0) * 1e6), data });
          enc.encode(ad);
          ad.close();
          onProgress({ phase: "rendering", frame: k + 1, total, fps: 0, eta: 0 });
        }
        await enc.flush();
        await chain;
        if (failure) throw failure;
        await output.finalize();
      } catch (e) {
        await output.cancel().catch(() => undefined);
        throw e;
      } finally {
        if (enc.state !== "closed") enc.close();
      }
      const mime = webm ? "audio/webm" : "audio/mp4";
      const blob = new Blob([target.buffer!], { type: mime });
      return { blob, filename: `${base}.${webm ? "webm" : "m4a"}`, mime, videoCodec: "", audioCodec: audio.label, bytes: blob.size, seconds: (performance.now() - started) / 1000, warnings: webm ? ["AAC isn't available here, so the sound was saved as Opus in WebM."] : [], width: 0, height: 0 };
    } finally {
      mixer.dispose();
    }
  }

  async run(p: Project, settings: ExportSettings, onProgress: (e: ExportProgress) => void): Promise<ExportResult> {
    const format = settings.format ?? "mp4";
    const full = projectDuration(p);
    if (full <= 0) throw new Error("The timeline is empty.");
    const t0 = Math.max(0, Math.min(full, settings.range?.[0] ?? 0));
    const t1 = Math.max(t0, Math.min(full, settings.range?.[1] ?? full));
    const duration = t1 - t0;
    if (duration < 0.05) throw new Error("The range to export is empty.");
    if (format === "wav" || format === "m4a") return this.runAudio(p, settings, format, t0, t1, onProgress);
    if (typeof VideoFrame === "undefined" || (format !== "gif" && typeof VideoEncoder === "undefined")) {
      throw new Error("This browser can't encode video (WebCodecs). Use a recent Chrome, Edge, Firefox or Safari.");
    }
    const gif = format === "gif";
    let { width, height } = exportDimensions(p, settings.size);
    // GIFs stay small: at most 720 px on the long side and 20 frames a second.
    if (gif) {
      const k = Math.min(1, 720 / Math.max(width, height));
      width = Math.max(2, Math.round((width * k) / 2) * 2);
      height = Math.max(2, Math.round((height * k) / 2) * 2);
      if (duration > 60) throw new Error("GIFs are limited to 60 seconds. Set In and Out points around a shorter part.");
    }
    const fps = gif ? Math.min(20, settings.fps) : settings.fps;
    const total = Math.max(1, Math.round(duration * fps));
    const warnings: string[] = [];
    onProgress({ phase: "preparing", frame: 0, total, fps: 0, eta: 0 });

    const used = Object.values(p.clips).filter((c) => c.mediaId && p.tracks.find((t) => t.id === c.trackId && (t.kind === "audio" ? !t.muted : !t.hidden)));
    const missing = [...new Set(used.filter((c) => !mediaRuntime.file(c.mediaId!)).map((c) => p.media[c.mediaId!]?.name ?? "a file"))];
    if (missing.length) throw new Error(`Some media isn't on this device: ${missing.join(", ")}. Import it again first.`);
    const undecodable = [...new Set(used.filter((c) => c.kind === "video" && !p.media[c.mediaId!]?.decodable).map((c) => p.media[c.mediaId!].name))];
    if (undecodable.length) throw new Error(`This browser can't decode ${undecodable.join(", ")} frame by frame. Convert to MP4 (H.264) and replace the clip.`);

    const bitrate = videoBitrate(width, height, fps, settings.quality);
    const video = gif ? null : await pickVideo(width, height, fps, bitrate, format === "webm");
    if (!gif && !video) throw new Error(`This browser can't encode ${width}×${height} video. Try a smaller size.`);
    if (format === "mp4" && video?.container === "webm") warnings.push("H.264 isn't available in this browser, so the video was saved as WebM (VP9).");
    if (format === "webm" && video?.container === "mp4") warnings.push("VP9 isn't available in this browser, so the video was saved as MP4 (H.264).");

    const mixer = new AudioMixer(p);
    const audio = !gif && video && mixer.hasSound() ? await pickAudio(video.container) : null;
    if (!gif && mixer.hasSound() && !audio) warnings.push("This browser can't encode audio, so the file is silent.");
    else if (audio?.codec === "opus" && video?.container === "mp4") warnings.push("AAC isn't available here, so the sound is Opus (plays in browsers and VLC; some editors can't read it).");
    if (gif && mixer.hasSound()) warnings.push("GIFs have no sound.");

    await ensureProjectFonts(p);
    await ensureLuts(p);
    if (Object.values(p.clips).some((c) => c.effects.some((e) => e.enabled && e.type === "bgRemoval" && (e.options?.model ?? "people") === "people"))) {
      await loadSegmenter().catch(() => warnings.push("The background-removal model couldn't load, so those clips keep their background."));
    }

    // Where the file goes: memory (index at the front) unless it would be huge.
    const estimate = ((bitrate + (audio ? AUDIO_BITRATE : 0)) * duration) / 8;
    const ext = gif ? "gif" : video!.container === "mp4" ? "mp4" : "webm";
    const mime = gif ? "image/gif" : video!.container === "mp4" ? "video/mp4" : "video/webm";
    const filename = `${(settings.name || "video").replace(/[\\/:*?"<>|]+/g, " ").trim() || "video"}.${ext}`;
    const disk = !gif && estimate > 700 * 1024 * 1024 && opfsWritable() ? await exportFile(filename).catch(() => null) : null;
    const target = disk ? new StreamTarget(disk.writable) : new BufferTarget();
    const output = gif ? null : new Output({ format: video!.container === "mp4" ? new Mp4OutputFormat({ fastStart: disk ? false : "in-memory" }) : new WebMOutputFormat(), target });
    const vSource = video ? new EncodedVideoPacketSource(video.codec) : null;
    if (output && vSource) output.addVideoTrack(vSource, { frameRate: fps });
    const aSource = audio ? new EncodedAudioPacketSource(audio.codec) : null;
    if (output && aSource) output.addAudioTrack(aSource);
    await output?.start();
    const gifEnc = gif ? GIFEncoder() : null;
    const gifCanvas = gif ? new OffscreenCanvas(width, height) : null;
    const gifCtx = gifCanvas?.getContext("2d", { willReadFrequently: true }) ?? null;

    let failure: Error | null = null;
    let vChain: Promise<unknown> = Promise.resolve();
    let aChain: Promise<unknown> = Promise.resolve();
    const venc = video
      ? new VideoEncoder({
          output: (chunk, meta) => {
            vChain = vChain.then(() => vSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta));
          },
          error: (e) => {
            failure = e;
          },
        })
      : null;
    if (venc && video) venc.configure(video.config);
    const aenc = audio
      ? new AudioEncoder({
          output: (chunk, meta) => {
            aChain = aChain.then(() => aSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta));
          },
          error: (e) => {
            failure = e;
          },
        })
      : null;
    aenc?.configure(audio!.config);

    // Plan: which source time each video clip needs on each output frame.
    const perClip = new Map<string, number[]>();
    const lastFrame = new Map<string, number>();
    const needs: string[][] = [];
    for (let i = 0; i < total; i++) {
      const ids: string[] = [];
      for (const d of layerDraws(buildScene(p, t0 + i / fps))) {
        if (d.clip.kind !== "video" || !d.clip.mediaId) continue;
        let list = perClip.get(d.clip.id);
        if (!list) perClip.set(d.clip.id, (list = []));
        list.push(d.source + 1e-4);
        lastFrame.set(d.clip.id, i);
        ids.push(d.clip.id);
      }
      needs.push(ids);
    }

    const inputs = new Map<string, Input>();
    const tracks = new Map<string, InputVideoTrack>();
    const readers = new Map<string, ClipFrames>();
    const samples = new Map<string, VideoSample>();
    const bitmaps = new Map<string, ImageBitmap>();
    const rotateCanvas = new Map<string, OffscreenCanvas>();
    const masks = new Map<string, MaskRef>();
    for (const c of used) {
      if (c.kind === "image" && !bitmaps.has(c.mediaId!)) {
        bitmaps.set(c.mediaId!, await createImageBitmap(mediaRuntime.file(c.mediaId!)!, { premultiplyAlpha: "premultiply", imageOrientation: "from-image" }));
      }
    }
    const reader = async (clipId: string) => {
      let r = readers.get(clipId);
      if (r) return r;
      const mediaId = p.clips[clipId].mediaId!;
      let track = tracks.get(mediaId);
      if (!track) {
        const input = openInput(mediaRuntime.file(mediaId)!);
        inputs.set(mediaId, input);
        const vt = await input.getPrimaryVideoTrack();
        if (!vt) throw new Error(`${p.media[mediaId].name} has no picture.`);
        tracks.set(mediaId, (track = vt));
      }
      r = new ClipFrames(new VideoSampleSink(track), perClip.get(clipId) ?? []);
      readers.set(clipId, r);
      return r;
    };

    let frameIndex = 0;
    const sourceOf = (d: LayerDraw): { src: TexImageSource; w: number; h: number } | null => {
      const s = samples.get(d.clip.id);
      if (!s) return null;
      const m = p.media[d.clip.mediaId!];
      if (m?.rotation) {
        let cv = rotateCanvas.get(d.clip.id);
        if (!cv) rotateCanvas.set(d.clip.id, (cv = new OffscreenCanvas(m.width, m.height)));
        s.draw(cv.getContext("2d")!, 0, 0, m.width, m.height);
        return { src: cv, w: m.width, h: m.height };
      }
      return { src: s.toCanvasImageSource(), w: s.displayWidth, h: s.displayHeight };
    };
    const provider: SourceProvider = {
      frame: (d) => {
        const s = sourceOf(d);
        return s ? { source: s.src, width: s.w, height: s.h, version: frameIndex } : null;
      },
      image: (id) => bitmaps.get(id) ?? null,
      mask: (d) => {
        const bg = d.fx.bg;
        if (!bg) return null;
        if (d.clip.kind === "image" && bg.model === "subject") {
          const m = mediaRuntime.masks.get(d.clip.mediaId!);
          return m ? { ...m, version: "rmbg" } : null;
        }
        const key = d.clip.kind === "image" ? "still" : frameIndex;
        const prev = masks.get(d.clip.id);
        if (prev && prev.version === key) return prev;
        const src = d.clip.kind === "image" ? bitmaps.get(d.clip.mediaId!) : sourceOf(d)?.src;
        const m = src ? segmentFrame(src) : null;
        if (!m) return prev ?? null;
        const ref = { ...m, version: key };
        masks.set(d.clip.id, ref);
        return ref;
      },
    };

    const canvas = new OffscreenCanvas(width, height);
    const comp = new WebGLCompositor(canvas, { preserve: true });
    comp.resize(width, height);
    const started = performance.now();
    const AUDIO_WIN = 5;
    let audioAt = t0;
    const encodeAudio = async (a: number, b: number) => {
      const buf = await mixer.render(a, b, AUDIO_SAMPLE_RATE, 2);
      const n = buf.length;
      const data = new Float32Array(n * 2);
      data.set(buf.getChannelData(0), 0);
      data.set(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: AUDIO_SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((a - t0) * 1e6), data });
      aenc!.encode(ad);
      ad.close();
    };

    try {
      for (let i = 0; i < total; i++) {
        if (this.canceled) throw new ExportCanceled();
        if (failure) throw failure;
        frameIndex = i;
        const t = t0 + i / fps;
        while (aenc && audioAt < t1 && audioAt <= t + AUDIO_WIN) {
          const b = Math.min(t1, audioAt + AUDIO_WIN);
          await encodeAudio(audioAt, b);
          audioAt = b;
        }
        for (const id of needs[i]) {
          const s = await (await reader(id)).next();
          if (s) samples.set(id, s);
        }
        comp.render(p, t, buildScene(p, t), provider);
        if (gifEnc && gifCtx) {
          gifCtx.drawImage(canvas, 0, 0);
          const rgba = gifCtx.getImageData(0, 0, width, height).data;
          const palette = quantize(rgba, 256, { format: "rgb565" });
          gifEnc.writeFrame(applyPalette(rgba, palette, "rgb565"), width, height, { palette, delay: Math.round(1000 / fps), ...(i === 0 ? { repeat: 0 } : {}) });
        } else if (venc) {
          const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          venc.encode(frame, { keyFrame: i % Math.round(fps * 2) === 0 });
          frame.close();
        }
        for (const id of needs[i]) {
          if (lastFrame.get(id) === i) {
            readers.get(id)?.close();
            readers.delete(id);
            samples.delete(id);
          }
        }
        while (venc && venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
        if (i % 15 === 0 || i === total - 1) {
          await vChain;
          const elapsed = (performance.now() - started) / 1000;
          const rate = (i + 1) / Math.max(0.001, elapsed);
          onProgress({ phase: "rendering", frame: i + 1, total, fps: rate, eta: (total - i - 1) / Math.max(0.001, rate) });
        }
      }
      onProgress({ phase: "finishing", frame: total, total, fps: 0, eta: 0 });
      while (aenc && audioAt < t1 - 1e-6) {
        const b = Math.min(t1, audioAt + AUDIO_WIN);
        await encodeAudio(audioAt, b);
        audioAt = b;
      }
      if (venc) await venc.flush();
      if (aenc) await aenc.flush();
      await vChain;
      await aChain;
      if (failure) throw failure;
      let blob: Blob;
      if (gifEnc) {
        gifEnc.finish();
        blob = new Blob([gifEnc.bytes()], { type: mime });
      } else {
        await output!.finalize();
        if (disk) await disk.writable.close().catch(() => undefined);
        blob = disk ? await disk.handle.getFile() : new Blob([(target as BufferTarget).buffer!], { type: mime });
      }
      return {
        blob,
        filename,
        mime,
        videoCodec: gif ? "GIF" : video!.label,
        audioCodec: audio?.label ?? null,
        bytes: blob.size,
        seconds: (performance.now() - started) / 1000,
        warnings,
        width,
        height,
      };
    } catch (e) {
      await output?.cancel().catch(() => undefined);
      if (disk) await disk.writable.abort().catch(() => undefined);
      throw e;
    } finally {
      for (const r of readers.values()) r.close();
      for (const i of inputs.values()) i.dispose();
      for (const b of bitmaps.values()) b.close();
      if (venc && venc.state !== "closed") venc.close();
      if (aenc && aenc.state !== "closed") aenc.close();
      mixer.dispose();
      comp.dispose();
    }
  }
}
