import { sampleRgbaPatch, type SampleSize } from "@/lib/color-sample";
import { rateAt, srcOffset } from "../lib/speed";
import { projectDuration } from "../lib/timeline";
import { useStudio } from "../store/studio-store";
import type { Clip, Project } from "../types";
import { audioFxOf, buildChain, fxKey, type FxChain } from "./audio-fx";
import { mediaRuntime } from "./media";
import { WebGLCompositor, type FrameRef, type MaskRef, type SourceProvider } from "./render/compositor";
import { audioAt, buildScene, layerDraws, stripVisualFx, trackClips, type LayerDraw } from "./render/scene";
import { segmenterReady, segmentFrame, loadSegmenter } from "./ai/segmenter";

/**
 * Live preview. The master clock is the AudioContext (sample-accurate and steady), with a -100 dBFS
 * oscillator keeping it running through silent stretches: Chromium otherwise lets an idle context's
 * clock stall. Each visible clip gets a pooled, muted <video> kept in step with the clock (gentle
 * rate nudges for small drift, a seek for large); each sound clip gets an <audio> routed through a
 * GainNode for keyframed volume and fades. Every animation frame the WebGLCompositor draws the
 * scene from those elements, the same renderer the exporter feeds with decoded frames.
 */

type VideoSlot = { el: HTMLVideoElement; mediaId: string; url: string; used: number; canvas?: OffscreenCanvas };
type AudioSlot = { el: HTMLAudioElement; mediaId: string; url: string; used: number; node: MediaElementAudioSourceNode; gain: GainNode; chain: FxChain | null; fx: string };

const MAX_VIDEOS = 8;
const MAX_AUDIOS = 10;
const PREROLL = 1.25;

let current: PlaybackEngine | null = null;
export const getEngine = () => current;
const register = (e: PlaybackEngine | null) => {
  current = e;
};

export class PlaybackEngine {
  readonly compositor: WebGLCompositor;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private meters: AnalyserNode[] = [];
  private videos = new Map<string, VideoSlot>();
  private audios = new Map<string, AudioSlot>();
  private host: HTMLDivElement;
  private raf = 0;
  private playing = false;
  private startT = 0;
  private startClock = 0;
  private clockIsAudio = false;
  private dirty = true;
  private written = -1;
  private display = { w: 960, h: 540, dpr: 1 };
  private masks = new Map<string, MaskRef>();
  private disposed = false;
  private unsubs: (() => void)[] = [];
  private tick = 0;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.compositor = new WebGLCompositor(canvas, { onInvalidate: () => this.invalidate() });
    // Off-screen, in the document: some engines only decode video frames for elements in the DOM.
    this.host = document.createElement("div");
    this.host.setAttribute("aria-hidden", "true");
    this.host.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1";
    document.body.appendChild(this.host);
    this.unsubs.push(
      useStudio.subscribe((s, prev) => {
        const seeked = s.playhead !== prev.playhead && Math.abs(s.playhead - this.written) > 1e-6;
        if (s.playing !== prev.playing) {
          if (s.playing) this.start();
          // A click on the ruler pauses and seeks in one update: keep where it asked to go.
          else this.stop(seeked);
        } else if (seeked) {
          if (this.playing) this.restartAt(s.playhead);
          else this.invalidate();
        }
        if (s.rate !== prev.rate && this.playing) {
          // J/K/L shuttle: re-anchor the clock at the new speed from where we are.
          const t = this.time(prev.rate);
          this.startT = t;
          this.startClock = this.now();
          this.sync(t, true, false);
        }
        if (s.project !== prev.project || s.quality !== prev.quality || s.useProxies !== prev.useProxies) {
          // Another project opened, or proxies toggled: the old <video>/<audio> elements are stale.
          if (s.useProxies !== prev.useProxies || s.project.id !== prev.project.id) this.releaseAll();
          this.applySize();
          this.invalidate();
        }
        if (s.compare !== prev.compare || s.compareX !== prev.compareX || s.checkerboard !== prev.checkerboard) {
          this.invalidate();
        }
      }),
      mediaRuntime.subscribe(() => this.invalidate()),
    );
    register(this);
    this.applySize();
    this.loop();
  }

  invalidate = () => {
    this.dirty = true;
  };

  setDisplaySize(w: number, h: number, dpr: number) {
    this.display = { w: Math.max(2, w), h: Math.max(2, h), dpr: Math.min(2, Math.max(1, dpr)) };
    this.applySize();
    this.invalidate();
  }

  private applySize() {
    const s = useStudio.getState();
    const { width, height } = s.project.settings;
    const factor = s.quality === "full" ? 1 : s.quality === "half" ? 0.5 : 0.25;
    const fit = Math.min((this.display.w * this.display.dpr) / width, (this.display.h * this.display.dpr) / height);
    const k = Math.max(0.1, Math.min(factor, fit * 1.05, 1));
    this.compositor.resize(width * k, height * k);
  }

  /* ---------- Audio graph & clock ---------- */

  private audio() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    this.master.connect(ctx.destination);
    this.master.connect(split);
    this.meters = [0, 1].map((i) => {
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      split.connect(a, i);
      return a;
    });
    // -100 dBFS keep-alive: inaudible, but it stops Chromium from throttling the clock during silence.
    const osc = ctx.createOscillator();
    const quiet = ctx.createGain();
    quiet.gain.value = 1e-5;
    osc.connect(quiet).connect(ctx.destination);
    osc.start();
    this.ctx = ctx;
    return ctx;
  }

  private now() {
    if (this.clockIsAudio && this.ctx?.state === "running") return this.ctx.currentTime;
    return performance.now() / 1000;
  }

  /** Peak level per channel (0..1) for the meters. */
  levels(): [number, number] {
    if (!this.playing || !this.meters.length) return [0, 0];
    const buf = new Float32Array(this.meters[0].fftSize);
    return this.meters.map((m) => {
      m.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      return peak;
    }) as [number, number];
  }

  private start() {
    const s = useStudio.getState();
    const dur = projectDuration(s.project);
    if (dur <= 0) {
      useStudio.setState({ playing: false });
      return;
    }
    const ctx = this.audio();
    if (ctx.state !== "running") void ctx.resume();
    this.clockIsAudio = ctx.state === "running";
    void ctx.resume().then(() => {
      // The context started late (first play): re-anchor the clock on it from here.
      if (this.playing && !this.clockIsAudio) {
        const t = this.time();
        this.clockIsAudio = true;
        this.startT = t;
        this.startClock = ctx.currentTime;
      }
    });
    // With In/Out set and loop on, play the work area; otherwise restart from the top at the end.
    const loopIn = s.loop && s.inPoint !== null ? s.inPoint : 0;
    const end = s.loop && s.outPoint !== null ? Math.min(dur, s.outPoint) : dur;
    const from = s.playhead >= end - 1e-3 || s.playhead < loopIn - 1e-3 ? loopIn : s.playhead;
    this.playing = true;
    this.startT = from;
    this.startClock = this.now();
    this.sync(from, true, true);
  }

  private stop(keepPlayhead = false) {
    if (!this.playing) return;
    const t = this.time();
    this.playing = false;
    for (const v of this.videos.values()) v.el.pause();
    for (const a of this.audios.values()) {
      a.el.pause();
      a.gain.gain.value = 0;
    }
    if (!keepPlayhead) this.publish(t);
    this.invalidate();
  }

  private restartAt(t: number) {
    this.startT = t;
    this.startClock = this.now();
    this.sync(t, true, true);
  }

  private time(rate = useStudio.getState().rate) {
    return this.playing ? this.startT + (this.now() - this.startClock) * rate : useStudio.getState().playhead;
  }

  private publish(t: number) {
    this.written = t;
    useStudio.setState({ playhead: t });
  }

  /* ---------- Media elements ---------- */

  private mediaUrl(mediaId: string) {
    return mediaRuntime.url(mediaId, useStudio.getState().useProxies);
  }

  private video(c: Clip): VideoSlot | null {
    let slot = this.videos.get(c.id);
    const url = c.mediaId ? this.mediaUrl(c.mediaId) : null;
    if (!url) return null;
    if (slot && slot.url !== url) {
      this.dropVideo(c.id);
      slot = undefined;
    }
    if (!slot) {
      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.disablePictureInPicture = true;
      el.addEventListener("seeked", this.invalidate);
      el.addEventListener("loadeddata", this.invalidate);
      el.src = url;
      this.host.appendChild(el);
      slot = { el, mediaId: c.mediaId!, url, used: this.tick };
      this.videos.set(c.id, slot);
      this.evict(this.videos, MAX_VIDEOS, (id) => this.dropVideo(id));
    }
    slot.used = this.tick;
    return slot;
  }

  private sound(c: Clip): AudioSlot | null {
    let slot = this.audios.get(c.id);
    const url = c.mediaId ? mediaRuntime.url(c.mediaId) : null;
    if (!url) return null;
    if (!slot) {
      const ctx = this.audio();
      const el = new Audio();
      el.preload = "auto";
      // Tape-style speed changes, matching the export (OfflineAudioContext playbackRate).
      (el as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = false;
      el.src = url;
      this.host.appendChild(el);
      const node = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain).connect(this.master!);
      slot = { el, mediaId: c.mediaId!, url, used: this.tick, node, gain, chain: null, fx: "" };
      this.audios.set(c.id, slot);
      this.evict(this.audios, MAX_AUDIOS, (id) => this.dropAudio(id));
    }
    slot.used = this.tick;
    // Sound effects: rebuild the clip's graph when its settings change (volume stays on the gain).
    const key = fxKey(c);
    if (key !== slot.fx) {
      slot.gain.disconnect();
      slot.chain?.dispose();
      slot.chain = null;
      if (key) {
        slot.chain = buildChain(this.audio(), audioFxOf(c));
        slot.gain.connect(slot.chain.input);
        slot.chain.output.connect(this.master!);
      } else slot.gain.connect(this.master!);
      slot.fx = key;
    }
    return slot;
  }

  private evict<T extends { used: number }>(map: Map<string, T>, max: number, drop: (id: string) => void) {
    if (map.size <= max) return;
    const victims = [...map.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, map.size - max);
    for (const [id, s] of victims) if (s.used < this.tick) drop(id);
  }

  private dropVideo(id: string) {
    const s = this.videos.get(id);
    if (!s) return;
    s.el.pause();
    s.el.removeAttribute("src");
    s.el.load();
    s.el.remove();
    this.videos.delete(id);
  }

  private dropAudio(id: string) {
    const s = this.audios.get(id);
    if (!s) return;
    s.el.pause();
    s.node.disconnect();
    s.gain.disconnect();
    s.chain?.dispose();
    s.el.removeAttribute("src");
    s.el.load();
    s.el.remove();
    this.audios.delete(id);
  }

  private releaseAll() {
    for (const id of [...this.videos.keys()]) this.dropVideo(id);
    for (const id of [...this.audios.keys()]) this.dropAudio(id);
    this.compositor.invalidate("vid:");
  }

  /** Keeps one element at the right source time: a seek for big jumps, a rate nudge for drift. */
  private follow(el: HTMLMediaElement, want: number, speed: number, playing: boolean, frozen: boolean, fps: number) {
    const rate = Math.min(16, Math.max(0.0625, speed * (playing ? useStudio.getState().rate : 1)));
    if (!playing || frozen) {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.5 / fps && !el.seeking) el.currentTime = want;
      return;
    }
    const diff = want - el.currentTime;
    if (el.paused) {
      if (Math.abs(diff) > 0.02) el.currentTime = want;
      el.playbackRate = rate;
      void el.play().catch(() => undefined);
      return;
    }
    if (Math.abs(diff) > 0.3) {
      el.currentTime = want;
      el.playbackRate = rate;
    } else if (Math.abs(diff) > 0.035) el.playbackRate = rate * (1 + Math.sign(diff) * Math.min(0.08, Math.abs(diff)));
    else if (el.playbackRate !== rate) el.playbackRate = rate;
  }

  private sync(t: number, playing: boolean, hard = false) {
    const p = useStudio.getState().project;
    this.tick++;
    const fps = p.settings.fps;
    const needVideo = new Set<string>();
    const needAudio = new Set<string>();
    for (const d of layerDraws(buildScene(p, t))) {
      if (d.clip.kind !== "video") continue;
      const slot = this.video(d.clip);
      if (!slot) continue;
      needVideo.add(d.clip.id);
      const raw = d.clip.in + srcOffset(d.clip, t - d.clip.start);
      if (hard) slot.el.currentTime = d.source;
      this.follow(slot.el, d.source, rateAt(d.clip, t - d.clip.start), playing, Math.abs(raw - d.source) > 1e-3, fps);
    }
    if (playing) {
      for (const a of audioAt(p, t)) {
        const slot = this.sound(a.clip);
        if (!slot) continue;
        needAudio.add(a.clip.id);
        if (hard) slot.el.currentTime = a.source;
        this.follow(slot.el, a.source, rateAt(a.clip, t - a.clip.start), true, false, fps);
        slot.gain.gain.setTargetAtTime(a.gain, this.ctx!.currentTime, 0.015);
      }
      // Pre-roll: clips starting soon sit paused on their first frame, so they start without a stall.
      for (const track of p.tracks) {
        for (const c of trackClips(p, track.id)) {
          if (c.start <= t || c.start > t + PREROLL || !c.mediaId) continue;
          if (c.kind === "video" && !track.hidden) {
            const slot = this.video(c);
            if (slot && !needVideo.has(c.id)) {
              needVideo.add(c.id);
              if (Math.abs(slot.el.currentTime - c.in) > 0.05 && !slot.el.seeking) slot.el.currentTime = c.in;
            }
          } else if (c.kind === "audio" && !track.muted) {
            const slot = this.sound(c);
            if (slot && !needAudio.has(c.id)) {
              needAudio.add(c.id);
              if (Math.abs(slot.el.currentTime - c.in) > 0.05 && !slot.el.seeking) slot.el.currentTime = c.in;
            }
          }
        }
      }
    }
    for (const [id, s] of this.videos) if (!needVideo.has(id) && !s.el.paused) s.el.pause();
    for (const [id, s] of this.audios) {
      if (!needAudio.has(id)) {
        if (!s.el.paused) s.el.pause();
        s.gain.gain.value = 0;
      }
    }
  }

  /* ---------- Rendering ---------- */

  private provider: SourceProvider = {
    frame: (d: LayerDraw): FrameRef | null => {
      const slot = this.videos.get(d.clip.id);
      if (!slot) return null;
      const el = slot.el;
      if (el.readyState < 2 || el.seeking || !el.videoWidth) return null;
      const m = useStudio.getState().project.media[slot.mediaId];
      if (m?.rotation) {
        // Rotated phone footage: drawImage applies the rotation everywhere; texImage2D doesn't always.
        const w = m.width;
        const h = m.height;
        if (!slot.canvas || slot.canvas.width !== w || slot.canvas.height !== h) slot.canvas = new OffscreenCanvas(w, h);
        slot.canvas.getContext("2d")!.drawImage(el, 0, 0, w, h);
        return { source: slot.canvas, width: w, height: h, version: `${el.currentTime}` };
      }
      return { source: el, width: el.videoWidth, height: el.videoHeight, version: `${el.currentTime}` };
    },
    image: (id) => mediaRuntime.bitmap(id),
    mask: (d) => this.mask(d),
  };

  private mask(d: LayerDraw): MaskRef | null {
    const bg = d.fx.bg;
    if (!bg) return null;
    const mediaId = d.clip.mediaId;
    if (d.clip.kind === "image" && bg.model === "subject" && mediaId) {
      const m = mediaRuntime.masks.get(mediaId);
      return m ? { ...m, version: `rmbg:${mediaId}` } : null;
    }
    if (!segmenterReady()) {
      void loadSegmenter().then(this.invalidate, () => undefined);
      return this.masks.get(d.clip.id) ?? null;
    }
    let source: TexImageSource | null = null;
    let key = "";
    if (d.clip.kind === "video") {
      const slot = this.videos.get(d.clip.id);
      if (!slot || slot.el.readyState < 2 || slot.el.seeking) return this.masks.get(d.clip.id) ?? null;
      source = slot.el;
      key = `${slot.el.currentTime}`;
    } else if (d.clip.kind === "image" && mediaId) {
      source = mediaRuntime.bitmap(mediaId);
      key = `img:${mediaId}`;
    }
    const prev = this.masks.get(d.clip.id);
    if (!source || prev?.version === key) return prev ?? null;
    const m = segmentFrame(source);
    if (!m) return prev ?? null;
    const ref = { ...m, version: key };
    this.masks.set(d.clip.id, ref);
    return ref;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const s = useStudio.getState();
    if (this.playing) {
      let t = this.time();
      const total = projectDuration(s.project);
      const dur = s.loop && s.outPoint !== null ? Math.min(total, s.outPoint) : total;
      if (t >= dur) {
        if (s.loop && dur > 0) {
          const from = s.inPoint !== null && s.inPoint < dur ? s.inPoint : 0;
          this.restartAt(from);
          t = from;
        } else {
          this.publish(dur);
          this.stop();
          useStudio.setState({ playing: false });
          return;
        }
      }
      this.sync(t, true);
      this.draw(s.project, t);
      this.publish(t);
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const t = s.playhead;
    this.sync(t, false);
    this.draw(s.project, t);
  };

  private draw(p: Project, t: number) {
    try {
      const scene = buildScene(p, t);
      const s = useStudio.getState();
      const compare = s.compare ? { x: s.compareX, rawScene: stripVisualFx(scene) } : undefined;
      this.compositor.render(p, t, scene, this.provider, compare, { checker: s.checkerboard });
    } catch (e) {
      console.error("[studio] render failed", e);
    }
  }

  /** Downsampled framebuffer pixels for live Color Scopes (Waveform, RGB Parade, Histogram, Vectorscope). */
  readScopeFrame() {
    return this.compositor.readScopePixels();
  }

  private clipSourceCanvas(clipId: string): { src: CanvasImageSource; w: number; h: number } | null {
    const st = useStudio.getState();
    const c = st.project.clips[clipId];
    if (!c?.mediaId) return null;
    if (c.kind === "video") {
      const slot = this.videos.get(clipId);
      if (!slot || slot.el.readyState < 2) return null;
      const m = st.project.media[slot.mediaId];
      if (m?.rotation) {
        const w = m.width;
        const h = m.height;
        if (!slot.canvas || slot.canvas.width !== w || slot.canvas.height !== h) slot.canvas = new OffscreenCanvas(w, h);
        slot.canvas.getContext("2d")!.drawImage(slot.el, 0, 0, w, h);
        return { src: slot.canvas, w, h };
      }
      return { src: slot.el, w: slot.el.videoWidth, h: slot.el.videoHeight };
    }
    if (c.kind === "image") {
      const b = mediaRuntime.bitmap(c.mediaId);
      if (!b) return null;
      return { src: b, w: b.width, h: b.height };
    }
    return null;
  }

  /** The source colour under a point of a clip (u, v in 0..1 across its picture), for eyedropper sampling. */
  sampleColor(clipId: string, u: number, v: number, sampleSize: SampleSize = 3): string | null {
    const info = this.clipSourceCanvas(clipId);
    if (!info || u < 0 || v < 0 || u > 1 || v > 1) return null;
    const { src, w, h } = info;
    const rad = Math.floor(sampleSize / 2);
    const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
    const py = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
    const x0 = Math.max(0, px - rad);
    const y0 = Math.max(0, py - rad);
    const rw = Math.min(w, px + rad + 1) - x0;
    const rh = Math.min(h, py + rad + 1) - y0;
    const cv = new OffscreenCanvas(rw, rh);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, x0, y0, rw, rh, 0, 0, rw, rh);
    const img = ctx.getImageData(0, 0, rw, rh);
    const avg = sampleRgbaPatch(img.data, rw, rh, px - x0, py - y0, sampleSize);
    return `#${[avg.r, avg.g, avg.b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  }

  /** Reads a magnified `(2*radius+1) x (2*radius+1)` RGBA patch from a clip's unkeyed source frame. */
  sampleClipPatch(clipId: string, u: number, v: number, radius = 5): { data: Uint8ClampedArray; size: number } | null {
    const info = this.clipSourceCanvas(clipId);
    if (!info || u < 0 || v < 0 || u > 1 || v > 1) return null;
    const { src, w, h } = info;
    const size = radius * 2 + 1;
    const cx = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
    const cy = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
    const cv = new OffscreenCanvas(size, size);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    const x0 = Math.max(0, cx - radius);
    const y0 = Math.max(0, cy - radius);
    const x1 = Math.min(w, cx + radius + 1);
    const y1 = Math.min(h, cy + radius + 1);
    if (x1 > x0 && y1 > y0) {
      ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0 - (cx - radius), y0 - (cy - radius), x1 - x0, y1 - y0);
    }
    return { data: ctx.getImageData(0, 0, size, size).data, size };
  }

  /** Reads a magnified RGBA patch from the composited preview frame at normalized coords (0..1). */
  sampleFramePatch(nx: number, ny: number, radius = 5): { data: Uint8Array; size: number } | null {
    return this.compositor.readPatch(nx, ny, radius);
  }

  /** Samples the 4 corners of a clip's source frame and returns the consensus backdrop key colour. */
  autoDetectChromaKey(clipId: string): string | null {
    const pts: [number, number][] = [
      [0.05, 0.05],
      [0.95, 0.05],
      [0.05, 0.95],
      [0.95, 0.95],
    ];
    const samples: { hex: string; r: number; g: number; b: number }[] = [];
    for (const [u, v] of pts) {
      const h = this.sampleColor(clipId, u, v, 5);
      if (h) {
        const n = parseInt(h.slice(1), 16);
        samples.push({ hex: h, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });
      }
    }
    if (!samples.length) return null;
    // Choose the corner sample with smallest total colour distance to all other corners.
    let best = samples[0];
    let bestCost = Infinity;
    for (const a of samples) {
      let cost = 0;
      for (const b of samples) cost += Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
      if (cost < bestCost) {
        bestCost = cost;
        best = a;
      }
    }
    return best.hex;
  }

  /** Renders a single clip cleanly at full project resolution onto a transparent canvas for Rasterize. */
  async snapshotClip(clipId: string): Promise<Blob> {
    const s = useStudio.getState();
    const c = s.project.clips[clipId];
    if (!c) throw new Error("Clip not found.");
    const { width, height } = s.project.settings;
    const singleProj: Project = {
      ...s.project,
      tracks: s.project.tracks.filter((tr) => tr.id === c.trackId).map((tr) => ({ ...tr, hidden: false, muted: false })),
      clips: { [c.id]: c },
    };
    const t = Math.min(c.start + c.duration - 1e-3, Math.max(c.start, s.playhead));
    const canvas = new OffscreenCanvas(width, height);
    const comp = new WebGLCompositor(canvas, { preserve: true });
    try {
      comp.resize(width, height);
      comp.render(singleProj, t, buildScene(singleProj, t), this.provider, undefined, { transparent: true });
      return await canvas.convertToBlob({ type: "image/png" });
    } finally {
      comp.dispose();
    }
  }

  /** A full-resolution still of the current frame (for "Export frame"). */
  async snapshot(): Promise<Blob> {
    const s = useStudio.getState();
    const { width, height } = s.project.settings;
    const canvas = new OffscreenCanvas(width, height);
    const comp = new WebGLCompositor(canvas, { preserve: true });
    try {
      comp.resize(width, height);
      comp.render(s.project, s.playhead, buildScene(s.project, s.playhead), this.provider);
      return await canvas.convertToBlob({ type: "image/png" });
    } finally {
      comp.dispose();
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const u of this.unsubs) u();
    this.releaseAll();
    this.host.remove();
    void this.ctx?.close().catch(() => undefined);
    this.compositor.dispose();
    if (getEngine() === this) register(null);
  }
}
