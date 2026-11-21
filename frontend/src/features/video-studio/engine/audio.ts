import { AudioBufferSink, type Input } from "mediabunny";
import { rateAt, srcOffset } from "../lib/speed";
import type { Clip, Project } from "../types";
import { buildChain, audioFxOf, fxTail, hasAudioFx } from "./audio-fx";
import { mediaRuntime, openInput } from "./media";
import { clipGain, trackClips } from "./render/scene";

/**
 * Audio rendering with the Web Audio API's OfflineAudioContext: it resamples, downmixes and applies
 * gain curves faster than real time. Sources are decoded a window at a time (Mediabunny's
 * AudioBufferSink), so an hour-long file never has to be decoded into memory at once; browsers
 * without AudioDecoder fall back to decoding the whole file with decodeAudioData.
 */

const decodedCache = new WeakMap<Blob, Promise<AudioBuffer>>();
function decodeWhole(file: Blob) {
  let p = decodedCache.get(file);
  if (!p) {
    if (file.size > 600 * 1024 * 1024) return Promise.reject(new Error("This file is too large to decode in this browser."));
    p = file.arrayBuffer().then((ab) => new OfflineAudioContext(1, 1, 44_100).decodeAudioData(ab));
    decodedCache.set(file, p);
  }
  return p;
}

/** One media file's sound, ready to be scheduled into offline contexts. */
export class SourceAudio {
  private input: Input | null = null;
  private sink: AudioBufferSink | null | undefined;

  constructor(private file: Blob) {}

  private async getSink() {
    if (this.sink !== undefined) return this.sink;
    try {
      this.input = openInput(this.file);
      const at = await this.input.getPrimaryAudioTrack();
      this.sink = at && (await at.canDecode()) ? new AudioBufferSink(at) : null;
    } catch {
      this.sink = null;
    }
    return this.sink;
  }

  /**
   * Plays source seconds [srcA, srcB) into `dest`, starting at context time `when0`, at `speed`
   * (pitch follows speed, like a tape: CapCut's default without "keep pitch").
   */
  async schedule(ctx: BaseAudioContext, dest: AudioNode, srcA: number, srcB: number, when0: number, speed = 1) {
    if (srcB <= srcA) return;
    const stopAt = when0 + (srcB - srcA) / speed;
    const sink = await this.getSink();
    if (sink) {
      try {
        for await (const wb of sink.buffers(srcA, srcB)) {
          const node = ctx.createBufferSource();
          node.buffer = wb.buffer;
          node.playbackRate.value = speed;
          node.connect(dest);
          const rel = wb.timestamp - srcA;
          if (rel >= 0) node.start(when0 + rel / speed);
          else node.start(when0, -rel);
          node.stop(stopAt);
        }
        return;
      } catch (e) {
        console.warn("[studio] streaming audio decode failed; decoding the whole file", e);
        this.sink = null;
      }
    }
    const buf = await decodeWhole(this.file);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = speed;
    node.connect(dest);
    node.start(when0, Math.max(0, srcA), Math.max(0, srcB - Math.max(0, srcA)));
  }

  /** The source range [srcA, srcB) as one buffer at `sampleRate` (for speed curves, which need it whole). */
  async decodeRange(srcA: number, srcB: number, sampleRate: number, channels = 2): Promise<AudioBuffer> {
    const len = Math.max(1, Math.round((srcB - srcA) * sampleRate));
    const ctx = new OfflineAudioContext(channels, len, sampleRate);
    await this.schedule(ctx, ctx.destination, srcA, srcB, 0, 1);
    return ctx.startRendering();
  }

  dispose() {
    this.input?.dispose();
    this.input = null;
    this.sink = undefined;
  }
}

/**
 * Mono PCM of a file's source range, resampled (16 kHz for Whisper). Rendered in 60 s windows to
 * keep memory flat on long recordings.
 */
export async function extractPcm(file: Blob, start: number, end: number, sampleRate = 16_000, onProgress?: (f: number) => void): Promise<Float32Array> {
  const total = Math.max(1, Math.round((end - start) * sampleRate));
  const out = new Float32Array(total);
  const src = new SourceAudio(file);
  const WIN = 60;
  try {
    for (let w = start; w < end - 1e-6; w += WIN) {
      const we = Math.min(end, w + WIN);
      const len = Math.max(1, Math.round((we - w) * sampleRate));
      const ctx = new OfflineAudioContext(1, len, sampleRate);
      await src.schedule(ctx, ctx.destination, w, we, 0, 1);
      const rendered = await ctx.startRendering();
      const at = Math.round((w - start) * sampleRate);
      out.set(rendered.getChannelData(0).subarray(0, Math.min(len, total - at)), at);
      onProgress?.(Math.min(1, (we - start) / (end - start)));
    }
  } finally {
    src.dispose();
  }
  return out;
}

/**
 * The project's mix, one window at a time, for the exporter: every audio clip on an unmuted track,
 * with its keyframed volume, fades, speed (or speed curve) and sound effects. Effects with memory
 * (reverb, echo, compressors) are rendered with a lead-in before the window, which is then dropped,
 * so a tail that rings across a window boundary joins up without a seam.
 */
export class AudioMixer {
  private sources = new Map<string, SourceAudio>();

  constructor(private p: Project) {}

  hasSound() {
    return this.p.tracks.some((t) => t.kind === "audio" && !t.muted && trackClips(this.p, t.id).some((c) => !c.muted && c.mediaId));
  }

  private source(mediaId: string) {
    let s = this.sources.get(mediaId);
    if (!s) {
      const f = mediaRuntime.file(mediaId);
      if (!f) return null;
      this.sources.set(mediaId, (s = new SourceAudio(f)));
    }
    return s;
  }

  private clips() {
    const out: Clip[] = [];
    for (const track of this.p.tracks) {
      if (track.kind !== "audio" || track.muted) continue;
      for (const c of trackClips(this.p, track.id)) if (!c.muted && c.mediaId) out.push(c);
    }
    return out;
  }

  async render(t0: number, t1: number, sampleRate: number, channels = 2): Promise<AudioBuffer> {
    const all = this.clips();
    // Lead-in long enough for the longest effect tail that can reach into this window.
    let pre = 0;
    for (const c of all) if (c.start < t1 && c.start + c.duration + fxTail(c) > t0 && hasAudioFx(c)) pre = Math.max(pre, fxTail(c));
    pre = Math.min(pre, t0);
    const r0 = t0 - pre;
    const len = Math.max(1, Math.round((t1 - r0) * sampleRate));
    const ctx = new OfflineAudioContext(channels, len, sampleRate);
    for (const c of all) {
      if (c.start >= t1 || c.start + c.duration <= r0) continue;
      const src = this.source(c.mediaId!);
      if (!src) continue;
      const a = Math.max(r0, c.start);
      const b = Math.min(t1, c.start + c.duration);
      const gain = ctx.createGain();
      if (hasAudioFx(c)) {
        const chain = buildChain(ctx, audioFxOf(c));
        gain.connect(chain.input);
        chain.output.connect(ctx.destination);
      } else gain.connect(ctx.destination);
      // Volume keyframes and fades as a gain curve sampled every 10 ms.
      const steps = Math.max(2, Math.ceil((b - a) * 100));
      const curve = new Float32Array(steps + 1);
      for (let i = 0; i <= steps; i++) curve[i] = clipGain(c, a + ((b - a) * i) / steps - c.start);
      gain.gain.value = curve[0];
      gain.gain.setValueCurveAtTime(curve, a - r0, Math.max(0.001, b - a));
      const srcA = c.in + srcOffset(c, a - c.start);
      const srcB = c.in + srcOffset(c, b - c.start);
      if (c.speedRamp?.length) {
        // A speed curve: decode the stretch of source once and play it with an automated rate.
        const buf = await src.decodeRange(srcA, srcB, sampleRate, channels);
        const node = ctx.createBufferSource();
        node.buffer = buf;
        const rates = new Float32Array(steps + 1);
        for (let i = 0; i <= steps; i++) rates[i] = rateAt(c, a + ((b - a) * i) / steps - c.start);
        node.playbackRate.value = rates[0];
        node.playbackRate.setValueCurveAtTime(rates, a - r0, Math.max(0.001, b - a));
        node.connect(gain);
        node.start(a - r0);
        node.stop(b - r0);
      } else await src.schedule(ctx, gain, srcA, srcB, a - r0, c.speed);
    }
    const out = await ctx.startRendering();
    if (pre <= 0) return out;
    // Drop the lead-in.
    const skip = Math.round(pre * sampleRate);
    const keep = Math.max(1, out.length - skip);
    const trimmed = new AudioBuffer({ length: keep, numberOfChannels: out.numberOfChannels, sampleRate });
    for (let ch = 0; ch < out.numberOfChannels; ch++) trimmed.copyToChannel(out.getChannelData(ch).subarray(skip, skip + keep), ch);
    return trimmed;
  }

  dispose() {
    for (const s of this.sources.values()) s.dispose();
    this.sources.clear();
  }
}
