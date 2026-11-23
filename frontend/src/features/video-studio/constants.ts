import type { AspectId, AudioFx, CaptionStyleId, ClipMotionPresetId, EffectCategory, EffectType, LookId, ShapeContent, TextAnimation, TextStyle, TransitionType, VoiceEffect } from "./types";

/** Where the editor lives: the COOP/COEP headers in next.config.ts are scoped to this path. */
export const STUDIO_PATH = "/tools/video-editor";

export const ASPECTS: Record<AspectId, { label: string; hint: string; width: number; height: number }> = {
  "16:9": { label: "16:9", hint: "YouTube, landscape", width: 1920, height: 1080 },
  "9:16": { label: "9:16", hint: "Reels, Shorts, TikTok", width: 1080, height: 1920 },
  "1:1": { label: "1:1", hint: "Square post", width: 1080, height: 1080 },
  "4:5": { label: "4:5", hint: "Instagram portrait", width: 1080, height: 1350 },
  "21:9": { label: "21:9", hint: "Cinematic widescreen", width: 2520, height: 1080 },
};

export const FPS_CHOICES = [24, 25, 30, 50, 60] as const;

/** What the file pickers accept: everything browsers play, plus formats the built-in converter handles. */
export const IMPORT_ACCEPT = "video/*,audio/*,image/*,.mkv,.mov,.m4a,.flac,.opus,.avi,.wmv,.flv,.mpg,.mpeg,.vob,.mts,.m2ts,.ts,.3gp,.mxf,.dv,.wma,.amr,.ac3,.aiff,.aif,.caf";
/** External NLE & project formats that can be opened directly in the editor. */
export const PROJECT_ACCEPT = ".prproj,.xml,.fcpxml,.edl,.json,.capcut,.ccproj,.zip,.aep,.aepx,.dwylvideo";

/** Export sizes, as a multiple of the project's 1080p base (rounded to even pixels). */
export const EXPORT_SIZES = [
  { id: "480p", label: "480p", scale: 4 / 9 },
  { id: "720p", label: "720p", scale: 2 / 3 },
  { id: "1080p", label: "1080p", scale: 1 },
  { id: "1440p", label: "1440p", scale: 4 / 3 },
  { id: "4k", label: "4K", scale: 2 },
] as const;
export type ExportSizeId = (typeof EXPORT_SIZES)[number]["id"];

export const EXPORT_QUALITY = [
  { id: "good", label: "Good", factor: 0.65, hint: "Smaller file" },
  { id: "high", label: "High", factor: 1, hint: "Recommended" },
  { id: "max", label: "Max", factor: 1.6, hint: "Largest file" },
] as const;
export type ExportQualityId = (typeof EXPORT_QUALITY)[number]["id"];

/** H.264 bitrate at "High" quality: about 0.1 bit per pixel per frame, the rate YouTube recommends. */
export function videoBitrate(width: number, height: number, fps: number, quality: ExportQualityId) {
  const factor = EXPORT_QUALITY.find((q) => q.id === quality)?.factor ?? 1;
  const bpp = 0.085 * Math.pow(30 / fps, 0.25);
  return Math.round(Math.min(80_000_000, Math.max(1_500_000, width * height * fps * bpp * factor)));
}
export const AUDIO_BITRATE = 192_000;
export const AUDIO_SAMPLE_RATE = 48_000;

/* ---------- Effects ---------- */

/** `pct` shows a 0..1 value as a percentage. */
export type ParamSpec = { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string; pct?: boolean };

export type EffectSpec = { label: string; hint: string; category: EffectCategory; params: ParamSpec[]; options?: Record<string, string> };

const pct = (key: string, label: string, def: number, min = 0, max = 1): ParamSpec => ({ key, label, min, max, step: 0.005, def, pct: true });

export const EFFECTS: Record<EffectType, EffectSpec> = {
  /* Colour */
  colorGrade: {
    label: "Color grade",
    hint: "Exposure, contrast, highlights, shadows, whites, blacks, saturation, clarity, fade & vignette",
    category: "color",
    params: [
      { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.01, def: 0, unit: " EV" },
      { key: "brightness", label: "Brightness", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "contrast", label: "Contrast", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "highlights", label: "Highlights", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "shadows", label: "Shadows", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "whites", label: "Whites", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "blacks", label: "Blacks", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "vibrance", label: "Vibrance", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "clarity", label: "Clarity", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "fade", label: "Fade", min: 0, max: 1, step: 0.01, def: 0 },
      { key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "tint", label: "Tint", min: -1, max: 1, step: 0.01, def: 0 },
      { key: "hue", label: "Hue", min: -180, max: 180, step: 1, def: 0, unit: "°" },
      { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01, def: 0 },
    ],
  },
  colorWheels: {
    label: "Color wheels (Lift / Gamma / Gain)",
    hint: "3-way colour wheels and luminance sliders for shadows, midtones and highlights",
    category: "color",
    params: [
      { key: "liftR", label: "Lift R", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "liftG", label: "Lift G", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "liftB", label: "Lift B", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "liftY", label: "Lift Luma", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gammaR", label: "Gamma R", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gammaG", label: "Gamma G", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gammaB", label: "Gamma B", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gammaY", label: "Gamma Luma", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gainR", label: "Gain R", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gainG", label: "Gain G", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gainB", label: "Gain B", min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: "gainY", label: "Gain Luma", min: -0.5, max: 0.5, step: 0.005, def: 0 },
    ],
  },
  curves: {
    label: "RGB tone curves",
    hint: "Master, Red, Green and Blue spline curves for filmic contrast and colour balance",
    category: "color",
    params: [pct("intensity", "Intensity", 1)],
    options: { points: "[[0,0],[1,1]]", r: "", g: "", b: "" },
  },
  hsl: {
    label: "HSL secondary mixer",
    hint: "Shift hue, saturation and luminance per colour range (reds to magentas)",
    category: "color",
    params: [pct("amount", "Mix", 1)],
    options: { hue: "[0,0,0,0,0,0,0,0]", sat: "[0,0,0,0,0,0,0,0]", lum: "[0,0,0,0,0,0,0,0]" },
  },
  colorKey: {
    label: "Selective colour (Leave / Replace)",
    hint: "Keep one vibrant hue in a B&W frame, key out a colour or swap it for another",
    category: "color",
    params: [
      { key: "hue", label: "Hue", min: 0, max: 360, step: 1, def: 15, unit: "°" },
      { key: "range", label: "Range", min: 2, max: 120, step: 1, def: 28, unit: "°" },
      { key: "softness", label: "Softness", min: 0, max: 60, step: 1, def: 14, unit: "°" },
      { key: "minSat", label: "Min saturation", min: 0, max: 0.9, step: 0.01, def: 0.15 },
    ],
    options: { color: "#eb4a10", targetColor: "#39ff88", mode: "isolate" },
  },
  lut: {
    label: "LUT film look",
    hint: "Cinematic colour from a 3D LUT: built-in film looks or your own .cube file",
    category: "color",
    params: [pct("intensity", "Intensity", 1)],
    options: { lut: "builtin:tealOrange", name: "Teal & orange" },
  },
  duotone: {
    label: "Duotone",
    hint: "Map the shadows and highlights to two colours",
    category: "color",
    params: [pct("amount", "Amount", 1)],
    options: { dark: "#1d1a4f", light: "#ff9a62" },
  },
  posterize: {
    label: "Posterize",
    hint: "Flatten the colours into bold bands",
    category: "color",
    params: [{ key: "levels", label: "Levels", min: 2, max: 16, step: 1, def: 5 }],
  },
  invert: { label: "Invert", hint: "A photo negative", category: "color", params: [pct("amount", "Amount", 1)] },

  /* Blur & sharpen */
  blur: {
    label: "Gaussian blur",
    hint: "Soft focus; animate it for rack-focus pulls",
    category: "blur",
    params: [{ key: "radius", label: "Radius", min: 0, max: 80, step: 0.5, def: 12, unit: "px" }],
  },
  sharpen: {
    label: "Sharpen",
    hint: "Crisper edges and fine detail",
    category: "blur",
    params: [{ key: "amount", label: "Amount", min: 0, max: 3, step: 0.05, def: 0.8 }],
  },
  motionBlur: {
    label: "Directional blur",
    hint: "Streak the picture one way, like fast motion",
    category: "blur",
    params: [
      { key: "length", label: "Length", min: 0, max: 200, step: 1, def: 30, unit: "px" },
      { key: "angle", label: "Angle", min: -180, max: 180, step: 1, def: 0, unit: "°" },
    ],
  },
  radialBlur: {
    label: "Zoom blur",
    hint: "Rays of motion from a point: punch-ins and impacts",
    category: "blur",
    params: [pct("amount", "Amount", 0.25), pct("x", "Centre X", 0.5), pct("y", "Centre Y", 0.5)],
  },
  glow: {
    label: "Glow",
    hint: "A soft, dreamy bloom",
    category: "blur",
    params: [
      { key: "radius", label: "Radius", min: 1, max: 80, step: 0.5, def: 24, unit: "px" },
      { key: "intensity", label: "Intensity", min: 0, max: 2, step: 0.01, def: 0.6 },
    ],
  },

  /* Distort */
  pixelate: {
    label: "Pixelate",
    hint: "Big square pixels: retro looks, or hide a face with a mask",
    category: "distort",
    params: [{ key: "size", label: "Block size", min: 2, max: 160, step: 1, def: 24, unit: "px" }],
  },
  mirror: {
    label: "Mirror",
    hint: "Reflect one half onto the other, or tile four mirrored copies",
    category: "distort",
    params: [pct("axis", "Axis", 0.5)],
    options: { mode: "left" },
  },
  kaleidoscope: {
    label: "Kaleidoscope",
    hint: "Repeating mirrored wedges around the centre",
    category: "distort",
    params: [
      { key: "segments", label: "Segments", min: 2, max: 16, step: 1, def: 6 },
      { key: "angle", label: "Angle", min: -180, max: 180, step: 1, def: 0, unit: "°" },
    ],
  },
  fisheye: {
    label: "Bulge / pinch",
    hint: "Lens distortion: swell the middle out or pinch it in",
    category: "distort",
    params: [{ key: "amount", label: "Amount", min: -1, max: 1, step: 0.01, def: 0.5 }],
  },
  wave: {
    label: "Wave",
    hint: "Rippling water or heat haze",
    category: "distort",
    params: [
      { key: "amplitude", label: "Amplitude", min: 0, max: 80, step: 0.5, def: 12, unit: "px" },
      { key: "frequency", label: "Frequency", min: 0.5, max: 20, step: 0.1, def: 3 },
      { key: "speed", label: "Speed", min: 0, max: 6, step: 0.05, def: 1 },
    ],
  },
  shake: {
    label: "Camera shake",
    hint: "Handheld wobble or an impact jolt (animate Amount for hits)",
    category: "distort",
    params: [
      { key: "amount", label: "Amount", min: 0, max: 80, step: 0.5, def: 14, unit: "px" },
      { key: "speed", label: "Speed", min: 0.1, max: 8, step: 0.05, def: 2 },
      { key: "rotation", label: "Rotation", min: 0, max: 8, step: 0.1, def: 1, unit: "°" },
    ],
  },

  /* Stylise */
  glitch: {
    label: "Glitch",
    hint: "Digital tear: shifted slices and colour fringes",
    category: "stylize",
    params: [
      { key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: "speed", label: "Speed", min: 0.1, max: 4, step: 0.05, def: 1 },
    ],
  },
  rgbSplit: {
    label: "RGB split",
    hint: "Chromatic aberration: red and blue pulled apart",
    category: "stylize",
    params: [
      { key: "amount", label: "Amount", min: 0, max: 60, step: 0.5, def: 10, unit: "px" },
      { key: "angle", label: "Angle", min: -180, max: 180, step: 1, def: 0, unit: "°" },
    ],
  },
  vhs: { label: "VHS", hint: "Tape wobble, colour bleed, scanlines and noise", category: "stylize", params: [pct("amount", "Amount", 0.6)] },
  filmGrain: {
    label: "Film grain",
    hint: "Organic grain that changes every frame",
    category: "stylize",
    params: [pct("amount", "Amount", 0.35), { key: "size", label: "Size", min: 1, max: 6, step: 0.1, def: 1.5, unit: "px" }],
  },
  halftone: {
    label: "Halftone",
    hint: "Comic-book printing dots",
    category: "stylize",
    params: [{ key: "size", label: "Dot size", min: 3, max: 60, step: 0.5, def: 12, unit: "px" }],
  },
  lightLeak: {
    label: "Light leak",
    hint: "Warm film light drifting across the frame",
    category: "stylize",
    params: [pct("amount", "Amount", 0.6), { key: "speed", label: "Speed", min: 0, max: 3, step: 0.05, def: 0.6 }],
    options: { color: "#ff7a2e" },
  },

  /* Keying & masks */
  chromaKey: {
    label: "Chroma key Pro",
    hint: "Studio green/blue screen keyer with matte choke, feather, spill kill and light wrap",
    category: "key",
    params: [
      { key: "similarity", label: "Similarity", min: 0, max: 1, step: 0.005, def: 0.32 },
      { key: "smoothness", label: "Smoothness", min: 0, max: 0.5, step: 0.005, def: 0.14 },
      { key: "spill", label: "Spill kill", min: 0, max: 1, step: 0.005, def: 0.45 },
      { key: "clipBlack", label: "Clip black", min: 0, max: 0.9, step: 0.005, def: 0.05 },
      { key: "clipWhite", label: "Clip white", min: 0.1, max: 1, step: 0.005, def: 0.92 },
      { key: "edgeShrink", label: "Matte choke", min: -8, max: 8, step: 0.25, def: 0, unit: "px" },
      { key: "edgeFeather", label: "Edge feather", min: 0, max: 10, step: 0.25, def: 0.6, unit: "px" },
      pct("lightWrap", "Light wrap", 0),
    ],
    options: { color: "#00ff00", viewMode: "composite" },
  },
  lumaKey: {
    label: "Luma key",
    hint: "Drop the dark (or bright) parts: fire, smoke and light-leak overlays",
    category: "key",
    params: [pct("threshold", "Threshold", 0.12), pct("softness", "Softness", 0.1, 0, 0.5)],
    options: { mode: "dark" },
  },
  unmult: {
    label: "Unmult (Black screen)",
    hint: "Turn solid black backgrounds (flares, fire, particles, muzzle flashes) into clean alpha",
    category: "key",
    params: [pct("threshold", "Threshold", 0.04, 0, 0.5), pct("softness", "Roll-off", 0.18, 0.01, 0.8)],
  },
  bgRemoval: {
    label: "Remove background",
    hint: "AI cut-out without a green screen (runs on this device)",
    category: "key",
    params: [
      { key: "threshold", label: "Threshold", min: 0.05, max: 0.95, step: 0.01, def: 0.5 },
      { key: "feather", label: "Feather", min: 0, max: 0.5, step: 0.01, def: 0.15 },
    ],
    options: { model: "people" },
  },
  mask: {
    label: "Shape mask",
    hint: "Show only inside (or outside) a shape with a soft edge; animate it to track",
    category: "key",
    params: [
      pct("x", "Centre X", 0.5),
      pct("y", "Centre Y", 0.5),
      pct("width", "Width", 0.6, 0.02, 1.5),
      pct("height", "Height", 0.6, 0.02, 1.5),
      { key: "rotation", label: "Rotation", min: -180, max: 180, step: 1, def: 0, unit: "°" },
      pct("feather", "Feather", 0.06, 0, 0.5),
      pct("roundness", "Roundness", 0.2),
    ],
    options: { shape: "ellipse", invert: "0" },
  },

  /* Crop & frame */
  crop: {
    label: "Crop",
    hint: "Trim the picture's edges (it keeps its place in the frame)",
    category: "frame",
    params: [pct("left", "Left", 0, 0, 0.5), pct("right", "Right", 0, 0, 0.5), pct("top", "Top", 0, 0, 0.5), pct("bottom", "Bottom", 0, 0, 0.5), pct("feather", "Feather", 0, 0, 0.2)],
  },
  frame: {
    label: "Border & shadow",
    hint: "Rounded corners, an outline and a drop shadow: picture-in-picture ready",
    category: "frame",
    params: [
      { key: "radius", label: "Corners", min: 0, max: 400, step: 1, def: 36, unit: "px" },
      { key: "border", label: "Border", min: 0, max: 60, step: 0.5, def: 0, unit: "px" },
      pct("shadow", "Shadow", 0.5),
      { key: "size", label: "Shadow size", min: 0, max: 160, step: 1, def: 40, unit: "px" },
    ],
    options: { color: "#ffffff" },
  },
  letterbox: {
    label: "Cinematic bars",
    hint: "Black bars for a widescreen film look",
    category: "frame",
    params: [{ key: "ratio", label: "Ratio", min: 1, max: 3, step: 0.01, def: 2.39, unit: ":1" }],
  },

  /* VFX & Optical */
  lensFlare: {
    label: "Anamorphic lens flare",
    hint: "Optical sun bursts, hexagonal ghosts and cinema streaks (move X/Y to track)",
    category: "vfx",
    params: [
      pct("x", "Centre X", 0.72, -0.3, 1.3),
      pct("y", "Centre Y", 0.28, -0.3, 1.3),
      pct("intensity", "Intensity", 0.8, 0, 2),
      pct("streak", "Anamorphic streak", 0.6),
      { key: "scale", label: "Scale", min: 0.2, max: 2.5, step: 0.02, def: 1 },
      { key: "rotation", label: "Streak angle", min: -90, max: 90, step: 1, def: 0, unit: "°" },
    ],
    options: { color: "#ffae42" },
  },
  godRays: {
    label: "God rays (Volumetric)",
    hint: "Volumetric light shafts beaming out from bright highlights",
    category: "vfx",
    params: [
      pct("x", "Source X", 0.5, -0.3, 1.3),
      pct("y", "Source Y", 0.18, -0.3, 1.3),
      pct("intensity", "Intensity", 0.65, 0, 2),
      { key: "decay", label: "Ray length", min: 0.7, max: 0.99, step: 0.005, def: 0.92 },
      pct("threshold", "Highlight cutoff", 0.5),
    ],
    options: { color: "#fff0c8" },
  },
  halation: {
    label: "35mm Film halation",
    hint: "Red-orange emulsion scatter around specular highlights, true to 35mm celluloid",
    category: "vfx",
    params: [
      pct("threshold", "Highlight cutoff", 0.72),
      { key: "radius", label: "Spread", min: 2, max: 48, step: 0.5, def: 14, unit: "px" },
      pct("intensity", "Intensity", 0.65, 0, 1.5),
      pct("warmth", "Warmth", 0.85),
    ],
  },
  tiltShift: {
    label: "Tilt-shift miniature",
    hint: "Selective focus band that turns real footage into a miniature model",
    category: "vfx",
    params: [
      pct("center", "Focus line", 0.5),
      pct("band", "Sharp band", 0.22, 0.04, 0.65),
      { key: "blur", label: "Blur radius", min: 1, max: 36, step: 0.5, def: 14, unit: "px" },
      { key: "angle", label: "Angle", min: -90, max: 90, step: 1, def: 0, unit: "°" },
    ],
  },
  prism: {
    label: "Prism refraction",
    hint: "Crystal kaleidoscope spectral edge split and optical facet reflections",
    category: "vfx",
    params: [
      pct("intensity", "Blend", 0.65),
      { key: "dispersion", label: "Dispersion", min: 0, max: 48, step: 0.5, def: 18, unit: "px" },
      { key: "angle", label: "Angle", min: -180, max: 180, step: 1, def: 20, unit: "°" },
      { key: "facets", label: "Facets", min: 2, max: 8, step: 1, def: 3 },
    ],
  },
  heatDistort: {
    label: "Heat haze / Underwater",
    hint: "Procedural shimmer warping footage like desert heat or rising steam",
    category: "vfx",
    params: [
      pct("amount", "Distortion", 0.45),
      { key: "speed", label: "Speed", min: 0.1, max: 5, step: 0.05, def: 1.4 },
      { key: "scale", label: "Turbulence", min: 4, max: 40, step: 0.5, def: 14 },
      { key: "rise", label: "Upward drift", min: 0, max: 2, step: 0.05, def: 0.9 },
    ],
  },
  shockwave: {
    label: "Shockwave ripple",
    hint: "Expanding refractive blast ring; keyframe Progress from 0% to 100%",
    category: "vfx",
    params: [
      pct("x", "Origin X", 0.5),
      pct("y", "Origin Y", 0.5),
      pct("progress", "Progress", 0.35, 0, 1),
      pct("width", "Ring width", 0.12, 0.02, 0.4),
      pct("strength", "Refraction", 0.65, 0, 1.5),
    ],
  },
  crt: {
    label: "CRT monitor",
    hint: "Curved glass tube, RGB phosphor triad grille, scanlines and flicker",
    category: "vfx",
    params: [
      pct("curvature", "Tube curve", 0.25),
      pct("scanlines", "Scanlines", 0.5),
      pct("grille", "RGB grille", 0.35),
      pct("flicker", "Flicker", 0.1),
      pct("vignette", "Edge shadow", 0.45),
    ],
  },
  edgeGlow: {
    label: "Neon edge glow",
    hint: "Sobel contour detection lit up in electric neon hues",
    category: "vfx",
    params: [
      pct("intensity", "Glow", 0.85, 0, 2),
      pct("threshold", "Sensitivity", 0.22, 0.02, 0.8),
      { key: "thickness", label: "Thickness", min: 0.5, max: 5, step: 0.25, def: 1.5, unit: "px" },
      pct("mix", "Original mix", 0.35),
    ],
    options: { color: "#00f0ff" },
  },
  particles: {
    label: "Weather & sparks overlay",
    hint: "Procedural GPU snow, embers, rain streaks, bokeh or vintage dust",
    category: "vfx",
    params: [
      pct("amount", "Density", 0.55),
      { key: "size", label: "Size", min: 1, max: 18, step: 0.25, def: 5, unit: "px" },
      { key: "speed", label: "Speed", min: 0.1, max: 3, step: 0.05, def: 1 },
      { key: "wind", label: "Wind", min: -1, max: 1, step: 0.02, def: 0.15 },
    ],
    options: { kind: "sparks", color: "#ffbe55" },
  },
  strobe: {
    label: "Strobe beat flash",
    hint: "Rhythmic flash, blackout or negative strobe synced to clip time",
    category: "vfx",
    params: [
      { key: "rate", label: "Rate", min: 1, max: 24, step: 0.5, def: 8, unit: " Hz" },
      pct("duty", "Pulse width", 0.25, 0.05, 0.9),
      pct("intensity", "Intensity", 0.85),
    ],
    options: { mode: "flash", color: "#ffffff" },
  },
  perspective: {
    label: "3D Tilt & Perspective",
    hint: "Tilt the clip on 3D pitch, yaw and roll axes with perspective foreshortening",
    category: "vfx",
    params: [
      { key: "pitch", label: "Pitch (X)", min: -45, max: 45, step: 0.5, def: 0, unit: "°" },
      { key: "yaw", label: "Yaw (Y)", min: -45, max: 45, step: 0.5, def: 18, unit: "°" },
      { key: "roll", label: "Roll (Z)", min: -45, max: 45, step: 0.5, def: 0, unit: "°" },
      { key: "distance", label: "FOV depth", min: 0.6, max: 4, step: 0.05, def: 1.6 },
    ],
  },
  chromaticLens: {
    label: "Edge chromatic fringe",
    hint: "Radial colour fringing stronger at frame corners, like a vintage cinema prime",
    category: "vfx",
    params: [
      { key: "amount", label: "Fringe", min: 0, max: 1.5, step: 0.02, def: 0.55 },
      { key: "falloff", label: "Edge curve", min: 0.5, max: 4, step: 0.1, def: 2 },
    ],
  },
};

export const EFFECT_CATEGORIES: { id: EffectCategory; label: string }[] = [
  { id: "color", label: "Colour & Grade" },
  { id: "blur", label: "Blur & sharpen" },
  { id: "distort", label: "Distort" },
  { id: "stylize", label: "Stylise" },
  { id: "vfx", label: "VFX & optical" },
  { id: "key", label: "Keying & masks" },
  { id: "frame", label: "Crop & frame" },
];

export const EFFECT_ORDER: EffectType[] = (Object.keys(EFFECTS) as EffectType[]).sort(
  (a, b) => EFFECT_CATEGORIES.findIndex((c) => c.id === EFFECTS[a].category) - EFFECT_CATEGORIES.findIndex((c) => c.id === EFFECTS[b].category),
);

/** Effects that only make sense on pictures from a file (not text, colour clips or shapes). */
export const MEDIA_ONLY_EFFECTS: EffectType[] = ["chromaKey", "bgRemoval", "lumaKey"];

/** Options with a fixed set of values, for the inspector's pickers (and the AI Director). */
export const EFFECT_CHOICES: Partial<Record<EffectType, { key: string; label: string; options: { value: string; label: string }[] }>> = {
  mirror: {
    key: "mode",
    label: "Mirror",
    options: [
      { value: "left", label: "Left onto right" },
      { value: "right", label: "Right onto left" },
      { value: "top", label: "Top onto bottom" },
      { value: "bottom", label: "Bottom onto top" },
      { value: "quad", label: "Four tiles" },
    ],
  },
  mask: {
    key: "shape",
    label: "Shape",
    options: [
      { value: "ellipse", label: "Ellipse" },
      { value: "rectangle", label: "Rectangle" },
      { value: "band", label: "Band" },
      { value: "split", label: "Split (one side)" },
      { value: "star", label: "Star" },
      { value: "heart", label: "Heart" },
      { value: "diamond", label: "Diamond" },
      { value: "gradient", label: "Linear fade" },
    ],
  },
  chromaKey: {
    key: "viewMode",
    label: "View",
    options: [
      { value: "composite", label: "Final composite" },
      { value: "alpha", label: "Alpha matte" },
      { value: "status", label: "Status matte" },
    ],
  },
  lumaKey: {
    key: "mode",
    label: "Remove",
    options: [
      { value: "dark", label: "Dark areas" },
      { value: "light", label: "Bright areas" },
    ],
  },
  colorKey: {
    key: "mode",
    label: "Mode",
    options: [
      { value: "isolate", label: "Leave colour (B&W rest)" },
      { value: "remove", label: "Drop colour" },
      { value: "replace", label: "Replace with target" },
    ],
  },
  particles: {
    key: "kind",
    label: "Particles",
    options: [
      { value: "sparks", label: "Embers & sparks" },
      { value: "snow", label: "Snowfall" },
      { value: "rain", label: "Rain streaks" },
      { value: "bokeh", label: "Floating bokeh" },
      { value: "dust", label: "Film dust" },
    ],
  },
  strobe: {
    key: "mode",
    label: "Style",
    options: [
      { value: "flash", label: "Flash colour" },
      { value: "invert", label: "Negative flash" },
      { value: "black", label: "Blackout cut" },
    ],
  },
};

export const CHROMA_PRESETS: { id: string; label: string; color: string }[] = [
  { id: "green", label: "Chroma Green", color: "#00ff00" },
  { id: "studioGreen", label: "Studio Green", color: "#00b140" },
  { id: "naturalGreen", label: "Natural Green", color: "#3c8c4a" },
  { id: "blue", label: "Blue Screen", color: "#0047bb" },
  { id: "magenta", label: "Magenta", color: "#ff00ff" },
];

/** One-tap colour looks: recipes for the Color grade effect. */
export const LOOKS: Record<LookId, { label: string; grade: Partial<Record<string, number>> }> = {
  none: { label: "Original", grade: {} },
  warm: { label: "Warm", grade: { temperature: 0.45, saturation: 0.1, contrast: 0.05 } },
  cool: { label: "Cool", grade: { temperature: -0.45, tint: 0.05, contrast: 0.05 } },
  bw: { label: "B&W", grade: { saturation: -1, contrast: 0.2 } },
  vintage: { label: "Vintage", grade: { temperature: 0.3, saturation: -0.35, contrast: -0.15, brightness: 0.05, vignette: 0.45 } },
  cinematic: { label: "Cinematic", grade: { contrast: 0.25, saturation: -0.12, temperature: -0.12, tint: -0.06, vignette: 0.35 } },
  vivid: { label: "Vivid", grade: { saturation: 0.45, contrast: 0.18 } },
  fade: { label: "Faded", grade: { contrast: -0.3, brightness: 0.08, saturation: -0.2 } },
};

/* ---------- Transitions ---------- */

export const TRANSITIONS: Record<TransitionType, { label: string; hint: string; directional?: boolean }> = {
  crossDissolve: { label: "Cross dissolve", hint: "Blend one shot into the next" },
  dipToBlack: { label: "Dip to black", hint: "Fade out to black, then in" },
  dipToWhite: { label: "Flash", hint: "A bright white flash between shots" },
  whipPan: { label: "Whip pan", hint: "A fast, motion-blurred camera swing", directional: true },
  zoomBlur: { label: "Zoom blur", hint: "Punch in with a radial blur" },
  wipe: { label: "Wipe", hint: "A soft edge sweeps across", directional: true },
  slide: { label: "Slide", hint: "The next shot slides in over this one", directional: true },
  push: { label: "Push", hint: "The next shot pushes this one out", directional: true },
  iris: { label: "Iris", hint: "A circle opens from the centre" },
  clockWipe: { label: "Clock wipe", hint: "A hand sweeps round like a clock" },
  zoomIn: { label: "Zoom in", hint: "Push into this shot and land on the next" },
  spin: { label: "Spin", hint: "Rotate out of one shot and into the next" },
  blurDissolve: { label: "Blur dissolve", hint: "Defocus, swap, refocus" },
  glitch: { label: "Glitch", hint: "A burst of digital interference" },
  pixelate: { label: "Pixelate", hint: "Dissolve through big pixels" },
  filmBurn: { label: "Film burn", hint: "A warm light burn across the cut" },
  barnDoor: { label: "Barn doors", hint: "The next shot opens from the middle", directional: true },
  lumaDissolve: { label: "Luma dissolve", hint: "The next shot shows through the brightest parts first" },
};
export const DEFAULT_TRANSITION_DURATION = 0.6;

/* ---------- Speed curves (CapCut's speed ramps) ---------- */

/** Shapes over the clip (x 0..1 → speed). Applying one keeps the source range and refits the length. */
export const SPEED_PRESETS: Record<string, { label: string; hint: string; points: [number, number][] }> = {
  montage: { label: "Montage", hint: "Fast, slow, fast, slow", points: [[0, 1.4], [0.2, 3], [0.38, 0.6], [0.62, 0.6], [0.8, 3], [1, 1.4]] },
  hero: { label: "Hero", hint: "A dramatic slow-motion moment in the middle", points: [[0, 1.2], [0.33, 1.8], [0.43, 0.25], [0.6, 0.25], [0.7, 1.8], [1, 1.2]] },
  bullet: { label: "Bullet", hint: "Fast, then a long bullet-time stretch, then fast", points: [[0, 2.5], [0.25, 2.5], [0.35, 0.2], [0.7, 0.2], [0.8, 2.5], [1, 2.5]] },
  jumpCut: { label: "Jump cut", hint: "Normal speed with sudden bursts", points: [[0, 1], [0.22, 1], [0.28, 5], [0.38, 5], [0.44, 1], [0.66, 1], [0.72, 5], [0.82, 5], [0.88, 1], [1, 1]] },
  flashIn: { label: "Flash in", hint: "Races in, settles to normal", points: [[0, 5], [0.3, 2.5], [0.55, 1], [1, 1]] },
  flashOut: { label: "Flash out", hint: "Normal, then races out", points: [[0, 1], [0.45, 1], [0.7, 2.5], [1, 5]] },
  rampUp: { label: "Speed up", hint: "Starts slow and builds", points: [[0, 0.4], [1, 3]] },
  rampDown: { label: "Slow down", hint: "Starts fast and eases into slow motion", points: [[0, 3], [1, 0.4]] },
};

/* ---------- Sound ---------- */

export const VOICE_EFFECTS: Record<VoiceEffect, { label: string; hint: string }> = {
  none: { label: "None", hint: "As recorded" },
  chipmunk: { label: "Chipmunk", hint: "Higher pitch" },
  deep: { label: "Deep", hint: "Lower pitch" },
  robot: { label: "Robot", hint: "Metallic ring modulation" },
  telephone: { label: "Telephone", hint: "Thin, band-limited phone line" },
  radio: { label: "Radio", hint: "AM radio: narrow and compressed" },
  megaphone: { label: "Megaphone", hint: "Driven and boxy" },
  echo: { label: "Echo", hint: "Repeating delay" },
  hall: { label: "Big hall", hint: "Large reverb" },
  underwater: { label: "Underwater", hint: "Muffled and wobbly" },
  alien: { label: "Alien", hint: "High pitch with ring modulation" },
};

export const DEFAULT_AUDIO_FX: AudioFx = { low: 0, mid: 0, high: 0, highpass: 0, lowpass: 0, compressor: 0, reverb: 0, echo: 0, pan: 0, voice: "none", denoise: false };

/* ---------- 1-Click Clip Motion Presets ---------- */

export const CLIP_MOTION_PRESETS: { id: ClipMotionPresetId; label: string; hint: string }[] = [
  { id: "kenBurnsIn", label: "Slow zoom in", hint: "Smooth Ken Burns push-in across clip" },
  { id: "kenBurnsOut", label: "Slow pull out", hint: "Smooth Ken Burns zoom-out across clip" },
  { id: "panLeft", label: "Pan left", hint: "Cinematic horizontal pan left" },
  { id: "panRight", label: "Pan right", hint: "Cinematic horizontal pan right" },
  { id: "zoomPunch", label: "Zoom punch", hint: "Snappy impact punch into frame" },
  { id: "slideLeft", label: "Slide in ←", hint: "Enters smoothly from the right edge" },
  { id: "slideBottom", label: "Slide up ↑", hint: "Rises cleanly from the bottom edge" },
  { id: "spinIn", label: "Spin pop", hint: "Rotates and scales in with overshoot" },
  { id: "floatLoop", label: "Float hover", hint: "Gentle continuous floating drift" },
  { id: "pulseLoop", label: "Beat pulse", hint: "Subtle breathing scale rhythm" },
  { id: "impactShake", label: "Impact shake", hint: "Short camera hit shake at clip start" },
  { id: "none", label: "Reset motion", hint: "Clear transform keyframes" },
];

/* ---------- Text animations ---------- */

export const TEXT_ANIMATIONS: Record<TextAnimation, string> = {
  none: "None",
  fade: "Fade",
  pop: "Pop",
  slideUp: "Slide up",
  slideDown: "Slide down",
  slideLeft: "Slide from right",
  slideRight: "Slide from left",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  drop: "Drop and bounce",
  blurIn: "Blur in",
  spin: "Spin in",
  bounce: "Bounce (loop)",
  flicker: "Flicker on",
  pulse: "Pulse (loop)",
  typewriter: "Typewriter",
  karaoke: "Karaoke (word highlight)",
  wordPop: "Word pop",
  charFade: "Letters: fade",
  charDrop: "Letters: cascade drop",
  charPop: "Letters: pop wave",
  charWave: "Letters: sine wave (loop)",
  charSpin: "Letters: tumble spin",
  charGlitch: "Letters: glitch scramble",
  wordSlideUp: "Words: slide up",
  wordFade: "Words: stagger fade",
  wipeLeft: "Mask wipe: left -> right",
  wipeRight: "Mask wipe: right -> left",
  revealUp: "Mask reveal: up",
  trackingIn: "Cinematic tracking in",
  trackingOut: "Tracking expand",
  elasticPop: "Elastic overshoot",
  glitchIn: "RGB glitch slice in",
  skewSlide: "Kinetic skew slide",
  splitCenter: "Split from centre",
  scramble: "Cipher decode",
  swing: "Pendulum swing",
};

/* ---------- Shapes ---------- */

export const SHAPE_PRESETS: { id: string; label: string; shape: Partial<ShapeContent> & { type: ShapeContent["type"] } }[] = [
  { id: "rectangle", label: "Rectangle", shape: { type: "rectangle", width: 640, height: 360, radius: 0 } },
  { id: "rounded", label: "Rounded", shape: { type: "rectangle", width: 640, height: 360, radius: 48 } },
  { id: "circle", label: "Circle", shape: { type: "ellipse", width: 420, height: 420 } },
  { id: "triangle", label: "Triangle", shape: { type: "triangle", width: 440, height: 400 } },
  { id: "star", label: "Star", shape: { type: "star", width: 440, height: 440, points: 5, radius: 0.45 } },
  { id: "polygon", label: "Hexagon", shape: { type: "polygon", width: 440, height: 400, points: 6 } },
  { id: "heart", label: "Heart", shape: { type: "heart", width: 440, height: 400 } },
  { id: "arrow", label: "Arrow", shape: { type: "arrow", width: 560, height: 220 } },
  { id: "line", label: "Line", shape: { type: "line", width: 640, height: 24, strokeWidth: 12 } },
  { id: "outline", label: "Frame", shape: { type: "rectangle", width: 900, height: 520, radius: 24, fillOpacity: 0, strokeWidth: 10 } },
  { id: "progress", label: "Progress bar", shape: { type: "rectangle", width: 1920, height: 14, radius: 0 } },
  { id: "bubble", label: "Highlight", shape: { type: "ellipse", width: 520, height: 300, fillOpacity: 0, strokeWidth: 12, stroke: "#ffd60a" } },
];

export const BASE_SHAPE: ShapeContent = { type: "rectangle", width: 640, height: 360, fill: "#eb4a10", fillOpacity: 1, stroke: "#ffffff", strokeWidth: 0, radius: 0, points: 5 };

/** Emoji stickers (drawn with the system's emoji font as text clips). */
export const STICKERS = ["😂", "🔥", "❤️", "👍", "😍", "😮", "🎉", "✨", "💯", "👀", "🙌", "😎", "🤯", "😭", "🥳", "⭐", "💥", "⚡", "✅", "❌", "👉", "👆", "🎬", "🎵", "📌", "💡", "🚀", "🏆", "💰", "📈"];

/* ---------- Fonts (Google Fonts, loaded on demand) ---------- */

export const FONTS: { family: string; weights: number[]; italic?: boolean; category: string }[] = [
  { family: "Inter", weights: [400, 500, 600, 700, 800, 900], category: "Sans" },
  { family: "Montserrat", weights: [400, 500, 600, 700, 800, 900], italic: true, category: "Sans" },
  { family: "Poppins", weights: [400, 500, 600, 700, 800, 900], italic: true, category: "Sans" },
  { family: "Rubik", weights: [400, 500, 600, 700, 800, 900], category: "Sans" },
  { family: "Space Grotesk", weights: [400, 500, 600, 700], category: "Sans" },
  { family: "Oswald", weights: [400, 500, 600, 700], category: "Condensed" },
  { family: "Bebas Neue", weights: [400], category: "Display" },
  { family: "Anton", weights: [400], category: "Display" },
  { family: "Archivo Black", weights: [400], category: "Display" },
  { family: "Bangers", weights: [400], category: "Display" },
  { family: "Righteous", weights: [400], category: "Display" },
  { family: "Playfair Display", weights: [400, 600, 700, 800, 900], italic: true, category: "Serif" },
  { family: "DM Serif Display", weights: [400], italic: true, category: "Serif" },
  { family: "Permanent Marker", weights: [400], category: "Hand" },
  { family: "Caveat", weights: [400, 500, 600, 700], category: "Hand" },
  { family: "Pacifico", weights: [400], category: "Script" },
  { family: "Lobster", weights: [400], category: "Script" },
  { family: "Roboto Mono", weights: [400, 500, 700], italic: true, category: "Mono" },
  { family: "Noto Sans Devanagari", weights: [400, 600, 700, 800], category: "हिन्दी" },
  { family: "Noto Sans Bengali", weights: [400, 600, 700, 800], category: "বাংলা" },
];

export function nearestWeight(family: string, weight: number) {
  const f = FONTS.find((x) => x.family === family);
  if (!f) return weight;
  return f.weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), f.weights[0]);
}

/* ---------- Text ---------- */

export const BASE_TEXT_STYLE: TextStyle = {
  font: "Inter",
  weight: 700,
  italic: false,
  size: 72,
  color: "#ffffff",
  align: "center",
  lineHeight: 1.15,
  letterSpacing: 0,
  maxWidth: 0.86,
  uppercase: false,
  strokeColor: "#000000",
  strokeWidth: 0,
  shadowColor: "#000000",
  shadowBlur: 18,
  shadowY: 4,
  boxColor: "#000000",
  boxOpacity: 0,
  boxPadding: 18,
  boxRadius: 12,
  highlightColor: "#ffd60a",
  animation: "pop",
  animOut: "none",
  animInDuration: 0.45,
  animOutDuration: 0.35,
  animStagger: 0.04,
  gradientColor: "",
  gradientAngle: 90,
  curve: 0,
  extrude: 0,
  extrudeColor: "#14130e",
  boxStyle: "line",
};

export type TextPreset = { id: string; label: string; text: string; style: Partial<TextStyle>; y?: number; duration?: number };

/** `y` is the vertical centre as a fraction of the frame height. */
export const TEXT_PRESETS: TextPreset[] = [
  { id: "title", label: "Title", text: "Your title", style: { font: "Montserrat", weight: 800, size: 110, animation: "pop" } },
  { id: "subtitle", label: "Subtitle", text: "A short subtitle", y: 0.62, style: { font: "Inter", weight: 600, size: 52, boxOpacity: 0.55, shadowBlur: 0, animation: "fade" } },
  {
    id: "lower-third",
    label: "Lower third",
    text: "Name Surname\nRole · Company",
    y: 0.8,
    style: { font: "Inter", weight: 700, size: 46, align: "left", boxColor: "#15140f", boxOpacity: 0.85, boxPadding: 22, boxRadius: 6, shadowBlur: 0, maxWidth: 0.5, animation: "slideUp" },
  },
  {
    id: "bold-caption",
    label: "Bold caption",
    text: "THIS CHANGES EVERYTHING",
    y: 0.74,
    style: { font: "Montserrat", weight: 900, size: 78, uppercase: true, strokeWidth: 10, shadowBlur: 0, animation: "pop" },
  },
  { id: "neon", label: "Neon", text: "Neon nights", style: { font: "Righteous", weight: 400, size: 96, color: "#39ff88", shadowColor: "#39ff88", shadowBlur: 36, shadowY: 0, animation: "fade" } },
  { id: "typewriter", label: "Typewriter", text: "Once upon a time…", style: { font: "Roboto Mono", weight: 500, size: 56, shadowBlur: 0, animation: "typewriter" } },
  { id: "quote", label: "Quote", text: "“Make it simple,\nbut significant.”", style: { font: "Playfair Display", weight: 700, italic: true, size: 80, animation: "fade" } },
  { id: "handwritten", label: "Handwritten", text: "see you soon", style: { font: "Caveat", weight: 700, size: 110, color: "#fff4d6", animation: "pop" } },
  {
    id: "cta",
    label: "Call to action",
    text: "SUBSCRIBE",
    y: 0.84,
    style: { font: "Montserrat", weight: 900, size: 62, uppercase: true, boxColor: "#eb4a10", boxOpacity: 1, boxPadding: 22, boxRadius: 40, shadowBlur: 0, animation: "bounce" },
  },
  { id: "chapter", label: "Chapter", text: "Chapter one\nThe beginning", style: { font: "DM Serif Display", weight: 400, size: 96, animation: "blurIn" } },
  { id: "big-number", label: "Big number", text: "10×", style: { font: "Anton", weight: 400, size: 260, animation: "zoomIn" } },
  { id: "callout", label: "Callout", text: "Look here →", y: 0.35, style: { font: "Permanent Marker", weight: 400, size: 70, color: "#ffd60a", animation: "slideRight" } },
  {
    id: "breaking",
    label: "Breaking news",
    text: "BREAKING NEWS",
    y: 0.82,
    style: { font: "Oswald", weight: 700, size: 56, uppercase: true, boxColor: "#c81e1e", boxOpacity: 1, boxPadding: 16, boxRadius: 2, shadowBlur: 0, align: "left", animation: "slideLeft" },
  },
  { id: "glow-title", label: "Glow title", text: "Night drive", style: { font: "Bebas Neue", weight: 400, size: 150, color: "#ffe6f7", shadowColor: "#ff2bd6", shadowBlur: 40, shadowY: 0, animation: "flicker" } },
  { id: "kinetic-word", label: "Kinetic mask", text: "MOVE FASTER\nBREAK NOTHING", style: { font: "Montserrat", weight: 900, size: 88, uppercase: true, animation: "revealUp", animOut: "wipeLeft", animInDuration: 0.55, animStagger: 0.06 } },
  { id: "cyber-glitch", label: "Cipher decode", text: "SIGNAL_2099", style: { font: "Roboto Mono", weight: 700, size: 78, color: "#00f0ff", shadowColor: "#00f0ff", shadowBlur: 24, animation: "scramble", animInDuration: 0.8 } },
  { id: "arc-badge", label: "Curved badge", text: "LIMITED EDITION", style: { font: "Anton", weight: 400, size: 92, uppercase: true, curve: 0.45, color: "#ffd60a", strokeWidth: 6, animation: "elasticPop" } },
  { id: "word-pill", label: "Word pills", text: "WATCH THIS NEXT", y: 0.78, style: { font: "Poppins", weight: 800, size: 64, boxColor: "#eb4a10", boxOpacity: 1, boxStyle: "wordPill", boxPadding: 18, boxRadius: 18, animation: "wordSlideUp" } },
  { id: "block-headline", label: "Editorial slab", text: "THE COMPLETE\nBREAKDOWN", y: 0.5, style: { font: "Space Grotesk", weight: 700, size: 84, align: "left", boxColor: "#15140f", boxOpacity: 0.92, boxStyle: "block", boxPadding: 28, boxRadius: 12, animation: "skewSlide" } },
  { id: "three-d-impact", label: "3D Extrude", text: "LEVEL UP", style: { font: "Bangers", weight: 400, size: 148, color: "#ffd60a", extrude: 14, extrudeColor: "#eb4a10", strokeWidth: 5, animation: "charPop" } },
  { id: "gradient-title", label: "Gradient metallic", text: "CINEMA", style: { font: "Playfair Display", weight: 900, size: 132, color: "#fff4d6", gradientColor: "#eb4a10", gradientAngle: 120, animation: "trackingIn", animInDuration: 0.9 } },
  { id: "wave-lyric", label: "Wave letters", text: "feelin' good", style: { font: "Caveat", weight: 700, size: 112, color: "#9bf6ff", animation: "charWave" } },
];

export const CAPTION_STYLES: Record<CaptionStyleId, { label: string; style: Partial<TextStyle> }> = {
  bold: {
    label: "Bold pop",
    style: { font: "Montserrat", weight: 900, size: 76, uppercase: true, strokeWidth: 10, shadowBlur: 0, highlightColor: "#ffd60a", animation: "wordPop" },
  },
  karaoke: {
    label: "Karaoke",
    style: { font: "Poppins", weight: 800, size: 70, strokeWidth: 8, shadowBlur: 0, highlightColor: "#39ff88", animation: "karaoke" },
  },
  clean: { label: "Clean", style: { font: "Inter", weight: 700, size: 60, shadowBlur: 14, shadowY: 3, highlightColor: "#ffffff", animation: "fade" } },
  boxed: { label: "Boxed", style: { font: "Inter", weight: 600, size: 54, boxOpacity: 0.72, boxPadding: 16, boxRadius: 10, shadowBlur: 0, highlightColor: "#ffd60a", animation: "karaoke" } },
  minimal: { label: "Minimal", style: { font: "Space Grotesk", weight: 500, size: 50, shadowBlur: 10, shadowY: 2, animation: "none" } },
};

/** Default lengths for things that have no natural duration. */
export const STILL_DURATION = 5;
export const TEXT_DURATION = 4;
export const MIN_CLIP = 1 / 60;

/** Timeline zoom limits, in pixels per second. */
export const ZOOM_MIN = 1.5;
export const ZOOM_MAX = 2400;
export const SNAP_PX = 8;

/** Peaks per second stored for waveforms. */
export const PEAKS_RATE = 100;
/** Whisper's sample rate. */
export const ASR_RATE = 16_000;

/** Hosts the backend's proxy will fetch from (mirrors STUDIO_PROXY_HOSTS on the server). */
export const PROXY_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "pexels.com",
  "pixabay.com",
  "unsplash.com",
  "wikimedia.org",
  "archive.org",
  "freesound.org",
  "mixkit.co",
  "coverr.co",
];

export function proxyAllowed(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    return PROXY_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Caption languages offered (Whisper's codes); "auto" lets the model detect it. */
export const CAPTION_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "auto", label: "Detect automatically" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "ur", label: "Urdu" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
  { code: "id", label: "Indonesian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
];

/** Models (downloaded once from Hugging Face, then cached by the browser). */
export const MODELS = {
  whisperWords: "onnx-community/whisper-tiny.en_timestamped",
  whisper: "onnx-community/whisper-tiny.en",
  /** 99 languages, and speech-to-English translation. */
  whisperMultiWords: "onnx-community/whisper-base_timestamped",
  whisperMulti: "onnx-community/whisper-base",
  rmbg: "briaai/RMBG-1.4",
  selfie: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
  mediapipeWasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm",
};
