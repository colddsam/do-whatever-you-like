import {
  Activity,
  Aperture,
  Binary,
  Blend,
  Camera,
  ChartArea,
  ChartNoAxesColumn,
  Circle,
  CircleDot,
  Cloud,
  Cloudy,
  Columns3,
  Contrast,
  Diamond,
  Disc3,
  Droplet,
  Droplets,
  Eclipse,
  Film,
  Focus,
  Funnel,
  Gem,
  Grid3x3,
  Grip,
  Layers2,
  Lightbulb,
  Merge,
  Mountain,
  MoveDiagonal,
  Orbit,
  Paintbrush,
  Palette,
  Pencil,
  Pipette,
  Radar,
  Rainbow,
  Scan,
  ScanLine,
  ScanSearch,
  SlidersVertical,
  Smile,
  Snowflake,
  Sparkles,
  Spline,
  SquareStack,
  Sun,
  SunDim,
  SunMedium,
  Sunrise,
  Sunset,
  SwatchBook,
  Target,
  Thermometer,
  Tornado,
  Wand,
  Wand2,
  WandSparkles,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { defaults, type Op } from "./ops";

/*
 * How each adjustment, filter and look is presented: an icon that hints at what it does and a
 * one-line description, so a long list of effects can be scanned instead of read.
 */

type Entry = { icon: LucideIcon; blurb: string };

const ENTRIES: Record<string, Entry> = {
  // Light
  "camera-raw": { icon: Aperture, blurb: "Light, colour, detail and effects in one panel" },
  "brightness-contrast": { icon: SunMedium, blurb: "Lighter or darker, flatter or punchier" },
  levels: { icon: ChartArea, blurb: "Set the black, grey and white points" },
  curves: { icon: Spline, blurb: "Bend the tone curve for precise contrast" },
  exposure: { icon: Sun, blurb: "Like changing the camera's exposure" },
  "shadows-highlights": { icon: SunDim, blurb: "Lift dark areas, recover bright ones" },
  // Colour
  "color-mixer": { icon: Palette, blurb: "Change one colour family at a time" },
  "color-grading": { icon: Disc3, blurb: "Tint shadows, midtones and highlights" },
  vibrance: { icon: Sparkles, blurb: "Richer colour without overdoing skin" },
  "hue-saturation": { icon: Rainbow, blurb: "Shift hues, boost or mute colour" },
  "color-balance": { icon: Thermometer, blurb: "Warm, cool or tint the tones" },
  "black-white": { icon: Contrast, blurb: "Black and white with colour control" },
  "photo-filter": { icon: Camera, blurb: "A coloured lens filter" },
  "channel-mixer": { icon: SlidersVertical, blurb: "Remix the red, green and blue channels" },
  "selective-color": { icon: Pipette, blurb: "Shift just one range of colours" },
  "gradient-map": { icon: Blend, blurb: "Map brightness to a colour gradient" },
  "cube-lut": { icon: Film, blurb: "Apply 3D film LUTs or load your own .cube file" },
  // Tone & special
  posterize: { icon: Layers2, blurb: "Reduce to a few flat tones" },
  threshold: { icon: Binary, blurb: "Pure black and white at a cut-off" },
  invert: { icon: Eclipse, blurb: "A photo negative" },
  desaturate: { icon: Droplet, blurb: "Remove all colour" },
  equalize: { icon: ChartNoAxesColumn, blurb: "Spread tones evenly" },
  // Auto
  "auto-tone": { icon: WandSparkles, blurb: "Fix brightness and colour in one tap" },
  "auto-contrast": { icon: Wand2, blurb: "Stretch to full contrast" },
  "auto-color": { icon: Wand, blurb: "Neutralise colour casts" },
  // Effects
  glitch: { icon: Zap, blurb: "Digital glitch: split colour, torn slices" },
  "rgb-split": { icon: Columns3, blurb: "Colour fringes towards the edges" },
  sketch: { icon: Pencil, blurb: "Turns the photo into a pencil drawing" },
  cartoon: { icon: Smile, blurb: "Flat colours with ink outlines" },
  duotone: { icon: SwatchBook, blurb: "Two-colour poster print" },
  neon: { icon: Lightbulb, blurb: "Glowing neon edges on black" },
  orton: { icon: Cloud, blurb: "Soft, dreamy glow" },
  "light-leak": { icon: Sunrise, blurb: "A warm flare from the edge" },
  "pop-art": { icon: Gem, blurb: "Bold, saturated poster colours" },
  halation: { icon: Sunrise, blurb: "Warm 35mm film scatter around bright highlights" },
  bloom: { icon: Sparkles, blurb: "Silky Pro-Mist highlight bloom" },
  // Blur
  "gaussian-blur": { icon: Droplets, blurb: "Soften everything evenly" },
  "motion-blur": { icon: Wind, blurb: "Streaks, as if moving fast" },
  "radial-blur": { icon: Orbit, blurb: "Zoom or spin around a centre" },
  "tilt-shift": { icon: Focus, blurb: "The miniature-model look" },
  // Sharpen
  "unsharp-mask": { icon: ScanSearch, blurb: "Pro sharpening with control" },
  sharpen: { icon: Diamond, blurb: "A quick crisp-up" },
  "high-pass": { icon: Activity, blurb: "Detail layer for overlay sharpening" },
  // Noise
  "add-noise": { icon: Grip, blurb: "Film-like grain" },
  median: { icon: Funnel, blurb: "Smooth away noise and dust" },
  // Pixelate
  mosaic: { icon: Grid3x3, blurb: "Big square pixels" },
  halftone: { icon: CircleDot, blurb: "Comic-book printing dots" },
  // Stylize
  emboss: { icon: Mountain, blurb: "Raised, stamped relief" },
  "find-edges": { icon: ScanLine, blurb: "Outlines only" },
  "oil-paint": { icon: Paintbrush, blurb: "Thick painted brush strokes" },
  solarize: { icon: Sunset, blurb: "Half negative, half positive" },
  // Other
  maximum: { icon: SquareStack, blurb: "Spread light or dark areas" },
  offset: { icon: MoveDiagonal, blurb: "Wrap the picture around" },
  // Distort
  twirl: { icon: Tornado, blurb: "Swirl the centre" },
  pinch: { icon: Target, blurb: "Squeeze in or bulge out" },
  wave: { icon: Waves, blurb: "Wavy distortion" },
  ripple: { icon: Radar, blurb: "Rings like a dropped stone" },
  polar: { icon: Circle, blurb: "Bend into a circle (tiny planet)" },
  perspective: { icon: Scan, blurb: "Straighten leaning verticals & keystone tilt" },
  "lens-correct": { icon: Aperture, blurb: "Remove wide-angle barrel or pincushion bowing" },
  // Render
  vignette: { icon: Scan, blurb: "Darken or lighten the corners" },
  clouds: { icon: Cloudy, blurb: "Soft clouds in your two colours" },
};

export const GROUP_INFO: Record<string, { label: string; icon: LucideIcon }> = {
  Auto: { label: "Auto fixes", icon: WandSparkles },
  Basic: { label: "Light", icon: Sun },
  Colour: { label: "Colour", icon: Palette },
  Special: { label: "Tone & special", icon: Contrast },
  Effects: { label: "Creative effects", icon: Zap },
  Blur: { label: "Blur", icon: Droplets },
  Sharpen: { label: "Sharpen", icon: Diamond },
  Noise: { label: "Noise", icon: Snowflake },
  Pixelate: { label: "Pixelate", icon: Grid3x3 },
  Stylize: { label: "Stylize", icon: Paintbrush },
  Distort: { label: "Distort", icon: Waves },
  Render: { label: "Render", icon: Cloud },
  Other: { label: "Other", icon: Merge },
  Looks: { label: "Looks", icon: Film },
};

/*
 * Settings used only for the preview tiles. Many adjustments start neutral (every slider at 0),
 * which would make their preview look exactly like the photo; these show what each one does.
 */
const ID_CURVE: [number, number][] = [
  [0, 0],
  [255, 255],
];
const DEMO: Record<string, Record<string, unknown>> = {
  "camera-raw": { exposure: 20, contrast: 30, vibrance: 55, clarity: 35, vignette: 30 },
  "brightness-contrast": { brightness: 55, contrast: 35 },
  levels: { levels: { channel: "rgb", inLo: 45, inHi: 205, gamma: 1.25, outLo: 0, outHi: 255 } },
  curves: { curves: { rgb: [[0, 0], [64, 34], [190, 225], [255, 255]], r: ID_CURVE, g: ID_CURVE, b: ID_CURVE } },
  exposure: { exposure: 1 },
  "shadows-highlights": { shadows: 70, highlights: 40 },
  "color-mixer": { h_red: 60, s_red: 60, h_orange: 60, s_blue: 70, l_blue: -30, h_green: -50 },
  "color-grading": { ss: 55, hs: 45, ms: 20 },
  vibrance: { vibrance: 90, saturation: 15 },
  "hue-saturation": { hue: 110, saturation: 20 },
  "color-balance": { cr: 70, yb: -55 },
  "channel-mixer": { r: 30, g: 80, b: 10 },
  "selective-color": { family: "reds", hue: 45, sat: 60 },
  "photo-filter": { density: 55 },
  "black-white": { tint: true },
  posterize: { levels: 4 },
  "unsharp-mask": { amount: 300, radius: 3 },
  "add-noise": { amount: 30 },
  vignette: { amount: 80 },
  glitch: { amount: 70 },
  "cube-lut": { lutId: "kodak-2383", intensity: 100 },
  halation: { amount: 80, threshold: 175, spread: 18 },
  bloom: { amount: 70, threshold: 155, radius: 22, warmth: 15 },
  perspective: { vertical: 22, horizontal: 0, zoom: 112 },
  "lens-correct": { distortion: -45, scale: 108, vignette: 0 },
};

/** An operation's defaults with its preview settings on top. */
export function demoParams(op: Op): Record<string, unknown> {
  return { ...defaults(op), ...(op.group === "Looks" ? { amount: 100 } : DEMO[op.id]) };
}

export const opIcon =(op: Pick<Op, "id" | "group">): LucideIcon => ENTRIES[op.id]?.icon ?? (op.group === "Looks" ? Film : Sparkles);
export const opBlurb = (op: Pick<Op, "id" | "hint">) => ENTRIES[op.id]?.blurb ?? op.hint ?? "";
export const groupLabel = (g: string) => GROUP_INFO[g]?.label ?? g;
export const groupIcon = (g: string) => GROUP_INFO[g]?.icon ?? Sparkles;
