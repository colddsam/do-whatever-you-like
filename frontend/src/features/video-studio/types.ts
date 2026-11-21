/**
 * The video studio's document model. Everything here is plain, serialisable data: the project is
 * saved to IndexedDB as-is and every edit makes a new `Project` (structural sharing), so undo is a
 * list of projects and the renderer never sees half-applied changes.
 *
 * Time is in seconds. `start`/`duration` are timeline time; `in` is source-media time. Keyframe
 * times are clip-local timeline seconds (0 = the clip's first frame), so moving a clip moves its
 * animation with it, as in After Effects.
 */

export type TrackKind = "video" | "overlay" | "audio";
export type ClipKind = "video" | "image" | "audio" | "text" | "solid" | "shape" | "adjustment";
export type MediaKind = "video" | "audio" | "image";

export type Ease = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold" | "bezier" | "back" | "elastic" | "bounce";
/** CSS-style cubic-bezier control points (x1, y1, x2, y2). */
export type Bezier = [number, number, number, number];

export interface Keyframe {
  id: string;
  /** Clip-local time in seconds. */
  t: number;
  v: number;
  /** How the value travels from this keyframe to the next one. */
  ease: Ease;
  bezier?: Bezier;
}

/** A number that may be animated: `v` when there are no keyframes, otherwise the keyframes win. */
export interface Anim {
  v: number;
  k?: Keyframe[];
}

export type TransformProp = "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity";
export const TRANSFORM_PROPS: TransformProp[] = ["x", "y", "scaleX", "scaleY", "rotation", "opacity"];

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "add"
  | "darken"
  | "lighten"
  | "softLight"
  | "hardLight"
  | "colorDodge"
  | "colorBurn"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";
export type FitMode = "contain" | "cover" | "fill";
export type TrackMatteMode = "none" | "alpha" | "alphaInv" | "luma" | "lumaInv";

export type EffectType =
  // Colour
  | "colorGrade"
  | "colorWheels"
  | "curves"
  | "hsl"
  | "colorKey"
  | "lut"
  | "duotone"
  | "posterize"
  | "invert"
  // Blur & sharpen
  | "blur"
  | "sharpen"
  | "motionBlur"
  | "radialBlur"
  | "glow"
  // Distort
  | "pixelate"
  | "mirror"
  | "kaleidoscope"
  | "fisheye"
  | "wave"
  | "shake"
  // Stylise
  | "glitch"
  | "rgbSplit"
  | "vhs"
  | "filmGrain"
  | "halftone"
  | "lightLeak"
  | "letterbox"
  // VFX & Optical
  | "lensFlare"
  | "godRays"
  | "halation"
  | "tiltShift"
  | "prism"
  | "heatDistort"
  | "shockwave"
  | "crt"
  | "edgeGlow"
  | "particles"
  | "strobe"
  | "perspective"
  | "chromaticLens"
  // Keying, masks and framing
  | "chromaKey"
  | "lumaKey"
  | "unmult"
  | "bgRemoval"
  | "mask"
  | "crop"
  | "frame";

export type EffectCategory = "color" | "blur" | "distort" | "stylize" | "vfx" | "key" | "frame";

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  /** Animatable numeric parameters (see EFFECTS in constants.ts for ranges and defaults). */
  params: Record<string, Anim>;
  /** Non-numeric settings: the key colour, the cut-out model. */
  options?: Record<string, string>;
}

export type TransitionType =
  | "crossDissolve"
  | "dipToBlack"
  | "dipToWhite"
  | "whipPan"
  | "zoomBlur"
  | "wipe"
  | "slide"
  | "push"
  | "iris"
  | "clockWipe"
  | "zoomIn"
  | "spin"
  | "blurDissolve"
  | "glitch"
  | "pixelate"
  | "filmBurn"
  | "barnDoor"
  | "lumaDissolve";
export type Direction = "left" | "right" | "up" | "down";

/** The transition into a clip from whatever ends where it starts on the same track. */
export interface Transition {
  type: TransitionType;
  duration: number;
  direction?: Direction;
}

export type TextAnimation =
  | "none"
  | "fade"
  | "pop"
  | "slideUp"
  | "slideDown"
  | "slideLeft"
  | "slideRight"
  | "zoomIn"
  | "zoomOut"
  | "drop"
  | "blurIn"
  | "spin"
  | "bounce"
  | "flicker"
  | "pulse"
  | "typewriter"
  | "karaoke"
  | "wordPop"
  | "charFade"
  | "charDrop"
  | "charPop"
  | "charWave"
  | "charSpin"
  | "charGlitch"
  | "wordSlideUp"
  | "wordFade"
  | "wipeLeft"
  | "wipeRight"
  | "revealUp"
  | "trackingIn"
  | "trackingOut"
  | "elasticPop"
  | "glitchIn"
  | "skewSlide"
  | "splitCenter"
  | "scramble"
  | "swing";

export interface TextStyle {
  font: string;
  weight: number;
  italic: boolean;
  /** Pixels at the project's resolution. */
  size: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  /** Wrap width as a fraction of the frame width. */
  maxWidth: number;
  uppercase: boolean;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowY: number;
  boxColor: string;
  /** 0 hides the box. */
  boxOpacity: number;
  boxPadding: number;
  boxRadius: number;
  /** The word being spoken, for karaoke-style captions. */
  highlightColor: string;
  animation: TextAnimation;
  /** Optional exit animation played symmetrically at the clip's end. */
  animOut?: TextAnimation;
  /** Entrance animation length in seconds. */
  animInDuration?: number;
  /** Exit animation length in seconds. */
  animOutDuration?: number;
  /** Per-character / per-word stagger in seconds. */
  animStagger?: number;
  /** Second fill colour for a gradient fill. */
  gradientColor?: string;
  gradientAngle?: number;
  /** Arch curve amount (-1..1). */
  curve?: number;
  /** 3D block extrude depth in pixels (0 = off). */
  extrude?: number;
  extrudeColor?: string;
  /** Background box layout style. */
  boxStyle?: "line" | "block" | "wordPill";
}

/** One spoken word inside a caption clip, in clip-local seconds. */
export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface TextContent {
  text: string;
  style: TextStyle;
  words?: WordTiming[];
}

/** A point on a speed curve: clip-local timeline seconds and the speed there (1 = normal). */
export interface SpeedPoint {
  t: number;
  v: number;
}

/**
 * Camera shake measured by "Stabilize": the picture's drift (in fractions of its width and height)
 * sampled `rate` times a second from source time `t0`. The correction is worked out from it when
 * drawing, so the strength can change without measuring again.
 */
export interface StabilizeData {
  strength: number;
  rate: number;
  t0: number;
  dx: number[];
  dy: number[];
}

export type VoiceEffect = "none" | "chipmunk" | "deep" | "robot" | "telephone" | "radio" | "megaphone" | "echo" | "hall" | "underwater" | "alien";

/** Per-clip sound processing, identical in playback and export (Web Audio nodes). */
export interface AudioFx {
  /** EQ gains in dB: low shelf, mid peak, high shelf. */
  low: number;
  mid: number;
  high: number;
  /** Cut-offs in Hz (0 = off). */
  highpass: number;
  lowpass: number;
  /** 0..1: how hard the compressor evens out loud and quiet parts. */
  compressor: number;
  /** 0..1 wet mixes. */
  reverb: number;
  echo: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  voice: VoiceEffect;
  /** Speech clean-up: a rumble filter, a de-esser-ish high cut and a soft noise gate. */
  denoise: boolean;
}

export type ShapeType = "rectangle" | "ellipse" | "triangle" | "star" | "polygon" | "heart" | "arrow" | "line";

export interface ShapeContent {
  type: ShapeType;
  /** Size in project pixels. */
  width: number;
  height: number;
  fill: string;
  /** 0 = no fill (outline only). */
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  /** Corner radius in px for rectangles; inner radius (0..1) for stars. */
  radius: number;
  /** Corners of a polygon, points of a star. */
  points: number;
}

/** Point-tracked motion samples captured from footage to pin titles or VFX overlays onto a target. */
export interface TrackPointData {
  x: number;
  y: number;
  rate: number;
  t0: number;
  dx: number[];
  dy: number[];
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  mediaId?: string;
  name: string;
  /** Timeline position and length, in seconds. */
  start: number;
  duration: number;
  /** Source time at the clip's first frame (media clips). */
  in: number;
  /** Playback speed: 1 = normal. The clip covers `duration * speed` seconds of source. */
  speed: number;
  /** Clips that share a link id (a video and its sound) move, trim, split and delete together. */
  linkId?: string;
  transform: Record<TransformProp, Anim>;
  blend: BlendMode;
  fit: FitMode;
  effects: Effect[];
  transitionIn?: Transition;
  /** Linear gain: 1 = as recorded, 2 = +6 dB. */
  volume: Anim;
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
  text?: TextContent;
  /** Solid colour clips. */
  color?: string;
  /** Solid clips: a second colour for a linear gradient, and its angle in degrees. */
  gradient?: { color: string; angle: number };
  shape?: ShapeContent;
  flipH?: boolean;
  flipV?: boolean;
  /** CapCut's "canvas blur": a blurred copy of the clip fills the frame behind it (blur radius in px). */
  backdrop?: number;
  /** A speed curve (CapCut's speed ramps). When set it replaces `speed`, which then holds the average. */
  speedRamp?: SpeedPoint[];
  stabilize?: StabilizeData;
  audioFx?: Partial<AudioFx>;
  /** Track matte stencil taken from the track directly above this clip. */
  matte?: TrackMatteMode;
  /** Measured 2D point-tracking offsets relative to `t0`. */
  trackData?: TrackPointData;
  /** Timeline colour label. */
  label?: string;
  /** The media is a reversed copy made by "Reverse". */
  reversed?: boolean;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  mime: string;
  size: number;
  /** Seconds; 0 for images. */
  duration: number;
  /** Display size, after the file's rotation metadata. */
  width: number;
  height: number;
  fps: number;
  rotation: number;
  hasVideo: boolean;
  hasAudio: boolean;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  audioCodec?: string;
  /** Mediabunny can demux and decode it, so it can be exported frame by frame. */
  decodable: boolean;
  storage: "opfs" | "idb";
  /** Original path reported inside an imported external NLE project file (for smart offline relinking). */
  sourcePath?: string;
  addedAt: number;
  /** A smaller copy made for smooth editing of 4K footage (stored like the original). */
  proxy?: { id: string; storage: "opfs" | "idb"; width: number; height: number };
}

export type AspectId = "16:9" | "9:16" | "1:1" | "4:5" | "21:9";
export type GuideMode = "off" | "broadcast" | "reels" | "tiktok" | "shorts" | "golden";
export type ClipMotionPresetId =
  | "none"
  | "kenBurnsIn"
  | "kenBurnsOut"
  | "panLeft"
  | "panRight"
  | "zoomPunch"
  | "slideLeft"
  | "slideBottom"
  | "spinIn"
  | "floatLoop"
  | "pulseLoop"
  | "impactShake";

export interface ProjectSettings {
  aspect: AspectId;
  /** Base resolution (the 1080p size for the aspect); export scales it to 720p/1080p/4K. */
  width: number;
  height: number;
  fps: number;
  background: string;
}

export interface Marker {
  id: string;
  t: number;
  label: string;
  color?: string;
}

export interface Project {
  id: string;
  name: string;
  version: 1;
  settings: ProjectSettings;
  media: Record<string, MediaAsset>;
  /** Display order: visual tracks top to bottom, then audio tracks. Compositing runs bottom up. */
  tracks: Track[];
  clips: Record<string, Clip>;
  markers: Marker[];
  createdAt: number;
  updatedAt: number;
}

/* ---------- AI Director: the operations a prompt can turn into ---------- */

export type LookId = "warm" | "cool" | "bw" | "vintage" | "cinematic" | "vivid" | "fade" | "none";
export type CaptionStyleId = "bold" | "clean" | "boxed" | "karaoke" | "minimal";

export type LayoutId =
  | "full"
  | "fit"
  | "pip-tl"
  | "pip-tr"
  | "pip-bl"
  | "pip-br"
  | "pip-framed"
  | "split-h"
  | "split-v"
  | "split-3h"
  | "split-3v"
  | "grid";

export type DirectorOp =
  | { op: "split"; at: number; clipId?: string }
  | { op: "delete"; clipId: string; ripple?: boolean }
  | { op: "trim"; clipId: string; start?: number; end?: number }
  | { op: "move"; clipId: string; start: number }
  | { op: "addText"; text: string; start: number; duration: number; preset?: string }
  | { op: "captions"; style?: CaptionStyleId; language?: string }
  | { op: "removeSilence"; thresholdDb?: number; minSilence?: number; padding?: number }
  | { op: "look"; look: LookId; clipId?: string }
  | { op: "effect"; effect: Exclude<EffectType, "bgRemoval">; clipId?: string; params?: Record<string, number>; color?: string }
  | { op: "transition"; type: TransitionType; duration?: number; clipId?: string; direction?: Direction }
  | { op: "speed"; speed: number; clipId?: string }
  | { op: "volume"; volume: number; clipId?: string }
  | { op: "fade"; fadeIn?: number; fadeOut?: number; clipId?: string }
  | { op: "removeBackground"; clipId?: string }
  | { op: "aspect"; aspect: AspectId }
  | { op: "kenBurns"; clipId?: string; from?: number; to?: number }
  | { op: "speedRamp"; preset: string; clipId?: string }
  | { op: "reverse"; clipId?: string }
  | { op: "freeze"; at?: number; duration?: number; clipId?: string }
  | { op: "flip"; axis: "h" | "v"; clipId?: string }
  | { op: "layout"; layout: LayoutId }
  | { op: "backdrop"; amount?: number; clipId?: string }
  | { op: "voice"; voice: VoiceEffect; clipId?: string }
  | { op: "normalize"; target?: number }
  | { op: "duck"; amount?: number }
  | { op: "beats"; cut?: boolean }
  | { op: "scenes"; clipId?: string }
  | { op: "stabilize"; clipId?: string; strength?: number }
  | { op: "reframe"; clipId?: string }
  | { op: "closeGaps" }
  | { op: "addShape"; shape: string; start?: number; duration?: number }
  | { op: "addAdjustment"; start?: number; duration?: number; effects?: { effect: Exclude<EffectType, "bgRemoval">; params?: Record<string, number>; color?: string }[] }
  | { op: "sticker"; emoji: string; start?: number; duration?: number }
  | { op: "sfx"; sound: string; at?: number };
