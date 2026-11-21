import { EFFECTS } from "../../constants";
import { evalAnim } from "../../lib/keyframes";
import { srcOffset } from "../../lib/speed";
import { fitSize } from "../../lib/timeline";
import type { Clip, Direction, Effect, Project, StabilizeData, Track, TrackMatteMode, TransitionType } from "../../types";
import { parseHsl } from "../color";
import { textBlockSize } from "./text";

/**
 * What the frame at time `t` is made of: every visible clip, bottom track first, with its animation
 * already evaluated. Preview and export both render from this, so they can't disagree.
 */

type RGB = [number, number, number];
export type GradeParams = {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  clarity: number;
  fade: number;
  temperature: number;
  tint: number;
  hue: number;
  vignette: number;
};
export type FxValues = {
  grade: GradeParams | null;
  wheels: { lift: [number, number, number, number]; gamma: [number, number, number, number]; gain: [number, number, number, number] } | null;
  curves: { intensity: number; points: string; r: string; g: string; b: string } | null;
  hsl: { amount: number; hue: number[]; sat: number[]; lum: number[] } | null;
  colorKey: { color: RGB; target: RGB; hue: number; range: number; softness: number; minSat: number; mode: number } | null;
  lut: { id: string; mix: number } | null;
  duo: { dark: RGB; light: RGB; amount: number } | null;
  poster: number;
  invert: number;
  blur: number;
  sharpen: number;
  motion: { length: number; angle: number } | null;
  radial: { amount: number; x: number; y: number } | null;
  glow: { radius: number; intensity: number } | null;
  pixel: number;
  mirror: { mode: number; axis: number } | null;
  kaleido: { segments: number; angle: number } | null;
  lens: number;
  wave: { amplitude: number; frequency: number; speed: number } | null;
  shake: { amount: number; speed: number; rotation: number } | null;
  glitch: { amount: number; speed: number } | null;
  split: { amount: number; angle: number } | null;
  vhs: number;
  grain: { amount: number; size: number } | null;
  halftone: number;
  leak: { color: RGB; amount: number; speed: number } | null;
  bars: number;
  lensFlare: { x: number; y: number; intensity: number; streak: number; scale: number; rotation: number; color: RGB } | null;
  godRays: { x: number; y: number; intensity: number; decay: number; threshold: number; color: RGB } | null;
  halation: { threshold: number; radius: number; intensity: number; warmth: number } | null;
  tiltShift: { center: number; band: number; blur: number; angle: number } | null;
  prism: { intensity: number; dispersion: number; angle: number; facets: number } | null;
  heatDistort: { amount: number; speed: number; scale: number; rise: number } | null;
  shockwave: { x: number; y: number; progress: number; width: number; strength: number } | null;
  crt: { curvature: number; scanlines: number; grille: number; flicker: number; vignette: number } | null;
  edgeGlow: { intensity: number; threshold: number; thickness: number; mix: number; color: RGB } | null;
  particles: { amount: number; size: number; speed: number; wind: number; kind: number; color: RGB } | null;
  strobe: { rate: number; duty: number; intensity: number; mode: number; color: RGB } | null;
  perspective: { pitch: number; yaw: number; roll: number; distance: number } | null;
  chromaticLens: { amount: number; falloff: number } | null;
  key: {
    color: RGB;
    similarity: number;
    smoothness: number;
    spill: number;
    clipBlack: number;
    clipWhite: number;
    edgeShrink: number;
    edgeFeather: number;
    lightWrap: number;
    viewMode: number;
  } | null;
  luma: { threshold: number; softness: number; mode: 1 | 2 } | null;
  unmult: { threshold: number; softness: number } | null;
  bg: { threshold: number; feather: number; model: string } | null;
  mask: { shape: number; x: number; y: number; w: number; h: number; rotation: number; feather: number; roundness: number; invert: boolean } | null;
  crop: { l: number; r: number; t: number; b: number; feather: number } | null;
  frame: { radius: number; border: number; color: RGB; shadow: number; size: number } | null;
};

/** A camera move inside the clip's own frame (stabilisation, shake): offset in layer uv, rotation in radians, zoom. */
export type Move = { x: number; y: number; rot: number; zoom: number };

export type LayerDraw = {
  clip: Clip;
  track: Track;
  /** Clip-local time (may fall outside the clip during a transition). */
  local: number;
  /** Source-media time for this frame. */
  source: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** Radians, clockwise on screen. */
  rot: number;
  opacity: number;
  /** Size in project pixels before the clip's scale. */
  baseW: number;
  baseH: number;
  fx: FxValues;
  move: Move | null;
  /** Canvas blur behind the clip (px at project size), 0 for none. */
  backdrop: number;
  /** Optional track matte stencil from the track directly above this clip. */
  matteMode?: TrackMatteMode;
  matteDraw?: LayerDraw | null;
};

export type SceneLayer =
  | { kind: "clip"; d: LayerDraw }
  | { kind: "transition"; a: LayerDraw | null; b: LayerDraw; type: TransitionType; progress: number; direction: Direction };

export type AudioDraw = { clip: Clip; source: number; gain: number };

const sortedCache = new WeakMap<Project, Map<string, Clip[]>>();
function trackClips(p: Project, trackId: string) {
  let m = sortedCache.get(p);
  if (!m) {
    m = new Map();
    for (const c of Object.values(p.clips)) {
      if (!m.has(c.trackId)) m.set(c.trackId, []);
      m.get(c.trackId)!.push(c);
    }
    for (const list of m.values()) list.sort((a, b) => a.start - b.start);
    sortedCache.set(p, m);
  }
  return m.get(trackId) ?? [];
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function param(e: Effect, key: string, t: number) {
  const a = e.params[key];
  if (a) return evalAnim(a, t);
  return EFFECTS[e.type].params.find((p) => p.key === key)?.def ?? 0;
}

const MIRROR_MODE: Record<string, number> = { left: 1, right: 2, top: 3, bottom: 4, quad: 5 };
const MASK_SHAPE: Record<string, number> = { ellipse: 1, rectangle: 2, band: 3, split: 4, star: 5, heart: 6, diamond: 7, gradient: 8 };
const CHROMA_VIEW: Record<string, number> = { composite: 0, alpha: 1, status: 2 };
const COLOR_KEY_MODE: Record<string, number> = { isolate: 1, remove: 2, replace: 3 };
const PARTICLE_KIND: Record<string, number> = { sparks: 1, snow: 2, rain: 3, bokeh: 4, dust: 5 };
const STROBE_MODE: Record<string, number> = { flash: 1, invert: 2, black: 3 };

export function emptyFx(): FxValues {
  return {
    grade: null,
    wheels: null,
    curves: null,
    hsl: null,
    colorKey: null,
    lut: null,
    duo: null,
    poster: 0,
    invert: 0,
    blur: 0,
    sharpen: 0,
    motion: null,
    radial: null,
    glow: null,
    pixel: 0,
    mirror: null,
    kaleido: null,
    lens: 0,
    wave: null,
    shake: null,
    glitch: null,
    split: null,
    vhs: 0,
    grain: null,
    halftone: 0,
    leak: null,
    bars: 0,
    lensFlare: null,
    godRays: null,
    halation: null,
    tiltShift: null,
    prism: null,
    heatDistort: null,
    shockwave: null,
    crt: null,
    edgeGlow: null,
    particles: null,
    strobe: null,
    perspective: null,
    chromaticLens: null,
    key: null,
    luma: null,
    unmult: null,
    bg: null,
    mask: null,
    crop: null,
    frame: null,
  };
}

export function evalEffects(effects: Effect[], t: number): FxValues {
  const fx = emptyFx();
  for (const e of effects) {
    if (!e.enabled) continue;
    const v = (k: string) => param(e, k, t);
    switch (e.type) {
      case "colorGrade":
        fx.grade = {
          exposure: v("exposure"),
          brightness: v("brightness"),
          contrast: v("contrast"),
          highlights: v("highlights"),
          shadows: v("shadows"),
          whites: v("whites"),
          blacks: v("blacks"),
          saturation: v("saturation"),
          vibrance: v("vibrance"),
          clarity: v("clarity"),
          fade: v("fade"),
          temperature: v("temperature"),
          tint: v("tint"),
          hue: v("hue"),
          vignette: v("vignette"),
        };
        break;
      case "colorWheels":
        fx.wheels = {
          lift: [v("liftR"), v("liftG"), v("liftB"), v("liftY")],
          gamma: [v("gammaR"), v("gammaG"), v("gammaB"), v("gammaY")],
          gain: [v("gainR"), v("gainG"), v("gainB"), v("gainY")],
        };
        break;
      case "curves":
        fx.curves = {
          intensity: v("intensity"),
          points: e.options?.points ?? "[[0,0],[1,1]]",
          r: e.options?.r ?? "",
          g: e.options?.g ?? "",
          b: e.options?.b ?? "",
        };
        break;
      case "hsl": {
        const parsed = parseHsl(e.options);
        fx.hsl = { amount: v("amount"), hue: parsed.hue, sat: parsed.sat, lum: parsed.lum };
        break;
      }
      case "colorKey":
        fx.colorKey = {
          color: hexToRgb(e.options?.color ?? "#eb4a10"),
          target: hexToRgb(e.options?.targetColor ?? "#39ff88"),
          hue: v("hue"),
          range: v("range"),
          softness: v("softness"),
          minSat: v("minSat"),
          mode: COLOR_KEY_MODE[e.options?.mode ?? "isolate"] ?? 1,
        };
        break;
      case "lut":
        fx.lut = { id: e.options?.lut ?? "builtin:tealOrange", mix: v("intensity") };
        break;
      case "duotone":
        fx.duo = { dark: hexToRgb(e.options?.dark ?? "#1d1a4f"), light: hexToRgb(e.options?.light ?? "#ff9a62"), amount: v("amount") };
        break;
      case "posterize":
        fx.poster = Math.round(v("levels"));
        break;
      case "invert":
        fx.invert = v("amount");
        break;
      case "blur":
        fx.blur = Math.max(fx.blur, v("radius"));
        break;
      case "sharpen":
        fx.sharpen = v("amount");
        break;
      case "motionBlur":
        fx.motion = { length: v("length"), angle: v("angle") };
        break;
      case "radialBlur":
        fx.radial = { amount: v("amount"), x: v("x"), y: v("y") };
        break;
      case "glow":
        fx.glow = { radius: v("radius"), intensity: v("intensity") };
        break;
      case "pixelate":
        fx.pixel = v("size");
        break;
      case "mirror":
        fx.mirror = { mode: MIRROR_MODE[e.options?.mode ?? "left"] ?? 1, axis: v("axis") };
        break;
      case "kaleidoscope":
        fx.kaleido = { segments: Math.round(v("segments")), angle: v("angle") };
        break;
      case "fisheye":
        fx.lens = v("amount");
        break;
      case "wave":
        fx.wave = { amplitude: v("amplitude"), frequency: v("frequency"), speed: v("speed") };
        break;
      case "shake":
        fx.shake = { amount: v("amount"), speed: v("speed"), rotation: v("rotation") };
        break;
      case "glitch":
        fx.glitch = { amount: v("amount"), speed: v("speed") };
        break;
      case "rgbSplit":
        fx.split = { amount: v("amount"), angle: v("angle") };
        break;
      case "vhs":
        fx.vhs = v("amount");
        break;
      case "filmGrain":
        fx.grain = { amount: v("amount"), size: v("size") };
        break;
      case "halftone":
        fx.halftone = v("size");
        break;
      case "lightLeak":
        fx.leak = { color: hexToRgb(e.options?.color ?? "#ff7a2e"), amount: v("amount"), speed: v("speed") };
        break;
      case "letterbox":
        fx.bars = v("ratio");
        break;
      case "lensFlare":
        fx.lensFlare = { x: v("x"), y: v("y"), intensity: v("intensity"), streak: v("streak"), scale: v("scale"), rotation: v("rotation"), color: hexToRgb(e.options?.color ?? "#ffae42") };
        break;
      case "godRays":
        fx.godRays = { x: v("x"), y: v("y"), intensity: v("intensity"), decay: v("decay"), threshold: v("threshold"), color: hexToRgb(e.options?.color ?? "#fff0c8") };
        break;
      case "halation":
        fx.halation = { threshold: v("threshold"), radius: v("radius"), intensity: v("intensity"), warmth: v("warmth") };
        break;
      case "tiltShift":
        fx.tiltShift = { center: v("center"), band: v("band"), blur: v("blur"), angle: v("angle") };
        break;
      case "prism":
        fx.prism = { intensity: v("intensity"), dispersion: v("dispersion"), angle: v("angle"), facets: Math.round(v("facets")) };
        break;
      case "heatDistort":
        fx.heatDistort = { amount: v("amount"), speed: v("speed"), scale: v("scale"), rise: v("rise") };
        break;
      case "shockwave":
        fx.shockwave = { x: v("x"), y: v("y"), progress: v("progress"), width: v("width"), strength: v("strength") };
        break;
      case "crt":
        fx.crt = { curvature: v("curvature"), scanlines: v("scanlines"), grille: v("grille"), flicker: v("flicker"), vignette: v("vignette") };
        break;
      case "edgeGlow":
        fx.edgeGlow = { intensity: v("intensity"), threshold: v("threshold"), thickness: v("thickness"), mix: v("mix"), color: hexToRgb(e.options?.color ?? "#00f0ff") };
        break;
      case "particles":
        fx.particles = { amount: v("amount"), size: v("size"), speed: v("speed"), wind: v("wind"), kind: PARTICLE_KIND[e.options?.kind ?? "sparks"] ?? 1, color: hexToRgb(e.options?.color ?? "#ffbe55") };
        break;
      case "strobe":
        fx.strobe = { rate: v("rate"), duty: v("duty"), intensity: v("intensity"), mode: STROBE_MODE[e.options?.mode ?? "flash"] ?? 1, color: hexToRgb(e.options?.color ?? "#ffffff") };
        break;
      case "perspective":
        fx.perspective = { pitch: v("pitch"), yaw: v("yaw"), roll: v("roll"), distance: v("distance") };
        break;
      case "chromaticLens":
        fx.chromaticLens = { amount: v("amount"), falloff: v("falloff") };
        break;
      case "chromaKey":
        fx.key = {
          color: hexToRgb(e.options?.color ?? "#00ff00"),
          similarity: v("similarity"),
          smoothness: v("smoothness"),
          spill: v("spill"),
          clipBlack: v("clipBlack"),
          clipWhite: v("clipWhite"),
          edgeShrink: v("edgeShrink"),
          edgeFeather: v("edgeFeather"),
          lightWrap: v("lightWrap"),
          viewMode: CHROMA_VIEW[e.options?.viewMode ?? "composite"] ?? 0,
        };
        break;
      case "lumaKey":
        fx.luma = { threshold: v("threshold"), softness: v("softness"), mode: e.options?.mode === "light" ? 2 : 1 };
        break;
      case "unmult":
        fx.unmult = { threshold: v("threshold"), softness: v("softness") };
        break;
      case "bgRemoval":
        fx.bg = { threshold: v("threshold"), feather: v("feather"), model: e.options?.model ?? "people" };
        break;
      case "mask":
        fx.mask = {
          shape: MASK_SHAPE[e.options?.shape ?? "ellipse"] ?? 1,
          x: v("x"),
          y: v("y"),
          w: v("width"),
          h: v("height"),
          rotation: v("rotation"),
          feather: v("feather"),
          roundness: v("roundness"),
          invert: e.options?.invert === "1",
        };
        break;
      case "crop":
        fx.crop = { l: v("left"), r: v("right"), t: v("top"), b: v("bottom"), feather: v("feather") };
        break;
      case "frame":
        fx.frame = { radius: v("radius"), border: v("border"), color: hexToRgb(e.options?.color ?? "#ffffff"), shadow: v("shadow"), size: v("size") };
        break;
    }
  }
  return fx;
}

const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function bounceOut(x: number) {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x - 1.5 / d) * (x - 1.5 / d) + 0.75;
  if (x < 2.5 / d) return n * (x - 2.25 / d) * (x - 2.25 / d) + 0.9375;
  return n * (x - 2.625 / d) * (x - 2.625 / d) + 0.984375;
}
const hash1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Smooth pseudo-random wobble in -1..1 (three detuned sines; deterministic, so exports match). */
const wobble = (t: number, seed: number) => 0.55 * Math.sin(t * 6.283 + seed) + 0.3 * Math.sin(t * 14.45 + seed * 2.1) + 0.15 * Math.sin(t * 31.4 + seed * 3.7);

/** Where a clip's source is at timeline time `t`, kept inside the media (frozen at the ends during transitions). */
export function sourceTime(p: Project, c: Clip, t: number) {
  const raw = c.in + srcOffset(c, t - c.start);
  const m = c.mediaId ? p.media[c.mediaId] : undefined;
  const fps = m?.fps || p.settings.fps;
  const max = m && m.duration > 0 ? m.duration - 0.5 / fps : Infinity;
  return Math.max(0, Math.min(max, raw));
}

export function baseSize(p: Project, c: Clip): [number, number] {
  const W = p.settings.width;
  const H = p.settings.height;
  if (c.kind === "text" && c.text) return textBlockSize(c.text, W);
  if (c.kind === "solid" || c.kind === "adjustment") return [W, H];
  if (c.kind === "shape" && c.shape) return [Math.max(1, c.shape.width), Math.max(1, c.shape.type === "line" ? Math.max(c.shape.height, c.shape.strokeWidth) : c.shape.height)];
  const m = c.mediaId ? p.media[c.mediaId] : undefined;
  return fitSize(m?.width || W, m?.height || H, W, H, c.fit);
}

/* ---------- Stabilisation ---------- */

const smoothCache = new WeakMap<StabilizeData, { cx: Float32Array; cy: Float32Array; zoom: number }>();

/** The correction that turns the measured shaky path into a smoothed one (cached per measurement). */
function stabilization(s: StabilizeData) {
  let hit = smoothCache.get(s);
  if (hit) return hit;
  const n = Math.min(s.dx.length, s.dy.length);
  const sigma = Math.max(1, s.strength * 1.6 * s.rate);
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp((-0.5 * k * k) / (sigma * sigma)));
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    let ax = 0;
    let ay = 0;
    let w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      const g = kernel[k + radius];
      ax += s.dx[j] * g;
      ay += s.dy[j] * g;
      w += g;
    }
    cx[i] = ax / w - s.dx[i];
    cy[i] = ay / w - s.dy[i];
    worst = Math.max(worst, Math.abs(cx[i]), Math.abs(cy[i]));
  }
  hit = { cx, cy, zoom: Math.min(1.4, 1 / Math.max(0.3, 1 - 2 * worst)) };
  smoothCache.set(s, hit);
  return hit;
}

function stabilizeAt(s: StabilizeData, source: number): Move {
  const st = stabilization(s);
  const n = st.cx.length;
  if (!n) return { x: 0, y: 0, rot: 0, zoom: 1 };
  const f = Math.min(n - 1, Math.max(0, (source - s.t0) * s.rate));
  const i = Math.floor(f);
  const j = Math.min(n - 1, i + 1);
  const k = f - i;
  return { x: st.cx[i] + (st.cx[j] - st.cx[i]) * k, y: st.cy[i] + (st.cy[j] - st.cy[i]) * k, rot: 0, zoom: st.zoom };
}

/* ---------- One clip's draw ---------- */

export function drawFor(p: Project, c: Clip, track: Track, t: number): LayerDraw {
  const local = t - c.start;
  const le = Math.min(c.duration, Math.max(0, local));
  const tr = c.transform;
  const W = p.settings.width;
  const H = p.settings.height;
  let x = evalAnim(tr.x, le);
  let y = evalAnim(tr.y, le);
  let sx = evalAnim(tr.scaleX, le);
  let sy = evalAnim(tr.scaleY, le);
  let rot = (evalAnim(tr.rotation, le) * Math.PI) / 180;
  let opacity = clamp01(evalAnim(tr.opacity, le));
  if (c.fadeIn > 0) opacity *= clamp01(le / c.fadeIn);
  if (c.fadeOut > 0) opacity *= clamp01((c.duration - le) / c.fadeOut);
  const fx = evalEffects(c.effects, le);
  // Text entrance, exit and loop animations ride on top of the keyframed transform.
  if (c.kind === "text" && c.text) {
    const st = c.text.style;
    const inDur = Math.max(0.05, st.animInDuration ?? 0.4);
    const outDur = Math.max(0.05, st.animOutDuration ?? 0.25);
    const applyWholeAnim = (anim: string, p: number, outPhase: boolean) => {
      const e = easeOutCubic(p);
      switch (anim) {
        case "fade":
        case "karaoke":
        case "typewriter":
        case "charFade":
        case "charDrop":
        case "charPop":
        case "charWave":
        case "charSpin":
        case "charGlitch":
        case "wordSlideUp":
        case "wordFade":
        case "wipeLeft":
        case "wipeRight":
        case "revealUp":
        case "trackingIn":
        case "trackingOut":
        case "splitCenter":
        case "scramble":
          opacity *= clamp01(p * 1.4);
          break;
        case "pop":
        case "wordPop": {
          const k = 0.6 + 0.4 * easeOutBack(p);
          sx *= k;
          sy *= k;
          opacity *= clamp01(p * 3);
          break;
        }
        case "elasticPop": {
          const k = p <= 0 ? 0.1 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) * 0.6 + 1;
          sx *= k;
          sy *= k;
          opacity *= clamp01(p * 4);
          break;
        }
        case "slideUp":
          y += (1 - e) * 0.06 * H;
          opacity *= p;
          break;
        case "slideDown":
          y -= (1 - e) * 0.06 * H;
          opacity *= p;
          break;
        case "slideLeft":
          x += (1 - e) * 0.1 * W;
          opacity *= p;
          break;
        case "slideRight":
          x -= (1 - e) * 0.1 * W;
          opacity *= p;
          break;
        case "skewSlide":
          x -= (1 - e) * 0.12 * W;
          rot -= (1 - e) * 0.14;
          opacity *= p;
          break;
        case "zoomIn": {
          const k = 0.25 + 0.75 * e;
          sx *= k;
          sy *= k;
          opacity *= clamp01(p * 2);
          break;
        }
        case "zoomOut": {
          const k = 1.8 - 0.8 * e;
          sx *= k;
          sy *= k;
          opacity *= clamp01(p * 1.4);
          break;
        }
        case "drop":
          y -= (1 - bounceOut(p)) * 0.3 * H;
          opacity *= clamp01(p * 4);
          break;
        case "blurIn":
          fx.blur = Math.max(fx.blur, (1 - e) * 28);
          opacity *= p;
          break;
        case "spin": {
          rot -= (1 - e) * Math.PI;
          const k = 0.4 + 0.6 * e;
          sx *= k;
          sy *= k;
          opacity *= p;
          break;
        }
        case "glitchIn":
          if (p < 1) {
            fx.glitch = { amount: (1 - p) * 0.7, speed: 2.5 };
            fx.split = { amount: (1 - p) * 22, angle: 0 };
          }
          opacity *= clamp01(p * 3);
          break;
        case "bounce":
          if (!outPhase) {
            y -= Math.abs(Math.sin(le * Math.PI * 1.6)) * 0.03 * H;
            opacity *= clamp01(p * 2.5);
          }
          break;
        case "flicker":
          if (!outPhase) opacity *= le < 0.7 ? (hash1(Math.floor(le * 18)) > 0.45 ? 1 : 0.15) : 1;
          else opacity *= p;
          break;
        case "pulse": {
          if (!outPhase) {
            const k = 1 + 0.05 * Math.sin(le * Math.PI * 2 * 1.2);
            sx *= k;
            sy *= k;
          }
          opacity *= clamp01(p * 2);
          break;
        }
        case "swing": {
          if (!outPhase) rot += Math.sin(le * Math.PI * 2) * 0.07;
          opacity *= clamp01(p * 2.5);
          break;
        }
      }
    };
    const inP = clamp01(le / inDur);
    applyWholeAnim(st.animation, inP, false);
    const animOut = st.animOut && st.animOut !== "none" ? st.animOut : null;
    if (animOut) {
      const outP = clamp01((c.duration - le) / outDur);
      applyWholeAnim(animOut, outP, true);
    } else if (st.animation !== "none") {
      opacity *= clamp01((c.duration - le) / 0.25);
    }
  }
  if (c.flipH) sx = -sx;
  if (c.flipV) sy = -sy;
  const [baseW, baseH] = baseSize(p, c);
  const source = sourceTime(p, c, t);

  // Camera moves inside the clip's frame: stabilisation (measured) and shake (synthetic).
  let move: Move | null = null;
  if (c.stabilize && c.kind === "video" && c.stabilize.strength > 0) move = stabilizeAt(c.stabilize, source);
  if (fx.shake && fx.shake.amount > 0) {
    const lw = Math.max(1, Math.abs(baseW * sx));
    const lh = Math.max(1, Math.abs(baseH * sy));
    const st = le * fx.shake.speed;
    const seed = c.id.length * 1.7 + c.id.charCodeAt(c.id.length - 1);
    const m: Move = {
      x: (fx.shake.amount * wobble(st, seed)) / lw,
      y: (fx.shake.amount * wobble(st * 1.13, seed + 5.1)) / lh,
      rot: ((fx.shake.rotation * Math.PI) / 180) * wobble(st * 0.87, seed + 9.4),
      zoom: 1 + (2.2 * fx.shake.amount) / Math.min(lw, lh) + fx.shake.rotation * 0.018,
    };
    move = move ? { x: move.x + m.x, y: move.y + m.y, rot: m.rot, zoom: move.zoom * m.zoom } : m;
  }

  return {
    clip: c,
    track,
    local,
    source,
    x,
    y,
    sx,
    sy,
    rot,
    opacity,
    baseW,
    baseH,
    fx,
    move,
    backdrop: (c.kind === "video" || c.kind === "image") && c.backdrop ? c.backdrop : 0,
  };
}

/** Looks up the active clip on a track at time `t` via binary search. */
function findClipAt(p: Project, trackId: string, t: number): Clip | null {
  const clips = trackClips(p, trackId);
  let lo = 0;
  let hi = clips.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = clips[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.start + c.duration) lo = mid + 1;
    else return c;
  }
  return null;
}

/** Visual layers at `t`, bottom first. Hidden tracks and audio are left out (except matte sources). */
export function buildScene(p: Project, t: number): SceneLayer[] {
  const layers: SceneLayer[] = [];
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i];
    if (track.kind === "audio" || track.hidden) continue;
    const attachMatte = (d: LayerDraw): LayerDraw => {
      if (!d.clip.matte || d.clip.matte === "none" || i === 0) return d;
      const aboveTrack = p.tracks[i - 1];
      if (!aboveTrack || aboveTrack.kind === "audio") return d;
      const matteClip = findClipAt(p, aboveTrack.id, t);
      if (!matteClip) return d;
      return { ...d, matteMode: d.clip.matte, matteDraw: drawFor(p, matteClip, aboveTrack, t) };
    };
    const clips = trackClips(p, track.id);
    let done = false;
    for (let k = 0; k < clips.length && !done; k++) {
      const b = clips[k];
      const tr = b.transitionIn;
      if (!tr || tr.duration <= 0) continue;
      const a = k > 0 && Math.abs(clips[k - 1].start + clips[k - 1].duration - b.start) < 1e-3 ? clips[k - 1] : null;
      const d = Math.min(tr.duration, b.duration, a ? a.duration : Infinity);
      const from = b.start - d / 2;
      if (t >= from && t < from + d) {
        layers.push({
          kind: "transition",
          a: a ? attachMatte(drawFor(p, a, track, t)) : null,
          b: attachMatte(drawFor(p, b, track, t)),
          type: tr.type,
          progress: (t - from) / d,
          direction: tr.direction ?? "left",
        });
        done = true;
      }
    }
    if (done) continue;
    const hit = findClipAt(p, track.id, t);
    if (hit) layers.push({ kind: "clip", d: attachMatte(drawFor(p, hit, track, t)) });
  }
  return layers;
}

/** Every visual clip a frame needs a picture from (both sides of a transition and track mattes). */
export function layerDraws(scene: SceneLayer[]) {
  const out: LayerDraw[] = [];
  const pushWithMatte = (d: LayerDraw) => {
    out.push(d);
    if (d.matteDraw) out.push(d.matteDraw);
  };
  for (const l of scene) {
    if (l.kind === "clip") pushWithMatte(l.d);
    else {
      if (l.a) pushWithMatte(l.a);
      pushWithMatte(l.b);
    }
  }
  return out;
}

export function clipGain(c: Clip, local: number) {
  if (c.muted) return 0;
  let g = evalAnim(c.volume, Math.min(c.duration, Math.max(0, local)));
  if (c.fadeIn > 0) g *= clamp01(local / c.fadeIn);
  if (c.fadeOut > 0) g *= clamp01((c.duration - local) / c.fadeOut);
  return Math.max(0, g);
}

/** Sound playing at `t`: audio clips on unmuted tracks. */
export function audioAt(p: Project, t: number): AudioDraw[] {
  const out: AudioDraw[] = [];
  for (const track of p.tracks) {
    if (track.kind !== "audio" || track.muted) continue;
    for (const c of trackClips(p, track.id)) {
      if (t >= c.start && t < c.start + c.duration) out.push({ clip: c, source: sourceTime(p, c, t), gain: clipGain(c, t - c.start) });
    }
  }
  return out;
}

/** Strips colour grading, LUTs, optical filters and adjustment layers for Before/After comparison while keeping geometry, crops, masks and keys. */
export function stripVisualFx(scene: SceneLayer[]): SceneLayer[] {
  const cleanFx = (fx: FxValues): FxValues => ({
    ...emptyFx(),
    key: fx.key,
    luma: fx.luma,
    unmult: fx.unmult,
    bg: fx.bg,
    mask: fx.mask,
    crop: fx.crop,
  });
  const cleanDraw = (d: LayerDraw): LayerDraw => ({
    ...d,
    fx: cleanFx(d.fx),
    matteDraw: d.matteDraw ? cleanDraw(d.matteDraw) : null,
  });
  const out: SceneLayer[] = [];
  for (const l of scene) {
    if (l.kind === "clip") {
      if (l.d.clip.kind === "adjustment") continue;
      out.push({ kind: "clip", d: cleanDraw(l.d) });
    } else {
      out.push({
        ...l,
        a: l.a ? cleanDraw(l.a) : null,
        b: cleanDraw(l.b),
      });
    }
  }
  return out;
}

export { trackClips };
