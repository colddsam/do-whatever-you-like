/*
 * The pro photo editor's document model.
 *
 * A document is immutable data: every edit makes a new `Doc`, and layers that didn't change keep
 * the same object (and the same canvas). That makes undo a list of documents that share most of
 * their pixels, and "what changed" a reference comparison.
 *
 * Canvases are never drawn into after they enter a document. A tool that edits pixels clones the
 * canvas first (`cloneCanvas`), works on the clone, and commits a new layer that holds it.
 */

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"
  | "lighter";

export type TextMeta = {
  text: string;
  font: string; // a CSS font-family
  size: number; // px in the document
  weight: 400 | 700;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number; // × size
  letterSpacing: number; // px
  stroke: { color: string; width: number } | null;
  background: string | null;
};

export type ShapeKind = "rect" | "ellipse" | "line" | "arrow" | "polygon" | "star";
export type ShapeMeta = {
  kind: ShapeKind;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number; // rect corners
  sides: number; // polygon / star points
};

export type Effects = {
  shadow: { on: boolean; color: string; opacity: number; angle: number; distance: number; size: number };
  glow: { on: boolean; color: string; opacity: number; size: number };
  stroke: { on: boolean; color: string; size: number };
  overlay: { on: boolean; color: string; opacity: number };
};

export const NO_EFFECTS: Effects = {
  shadow: { on: false, color: "#000000", opacity: 60, angle: 120, distance: 12, size: 16 },
  glow: { on: false, color: "#ffe9a8", opacity: 75, size: 18 },
  stroke: { on: false, color: "#000000", size: 4 },
  overlay: { on: false, color: "#eb4a10", opacity: 100 },
};

export type AdjustMeta = { id: string; params: Record<string, unknown> };

/*
 * Vector layers (the Illustrator side): paths of cubic Béziers, drawn into the layer's canvas.
 * A node's `i` and `o` are its incoming and outgoing handles, in the same space as the node
 * (null = a sharp corner on that side).
 */
export type VNode = { x: number; y: number; i: Pt | null; o: Pt | null };
export type VSub = { nodes: VNode[]; closed: boolean };
export type VPath = {
  id: string;
  name?: string;
  subs: VSub[];
  fill: string | null;
  stroke: string | null;
  width: number;
  opacity: number; // 0..1
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  dash: number | null; // dash length (gap the same), null = solid
  rule: "nonzero" | "evenodd";
};
/**
 * Points are stored in document space as they were when the canvas was drawn, at (ox, oy).
 * Moving the layer only changes its x/y; the paths follow by (x − ox, y − oy).
 */
export type VectorMeta = { paths: VPath[]; ox: number; oy: number };

export type SmartFilter = {
  id: string;
  opId: string;
  label: string;
  params: Record<string, unknown>;
  enabled: boolean;
  opacity: number; // 0..1
};

export type SmartMeta = {
  sourceId: string;
  sourceDoc: Doc;
  /** Column-major affine 2D transform [a, b, c, d, e, f] mapping sourceDoc (0..w, 0..h) to parent document coords. */
  matrix: [number, number, number, number, number, number];
  filters: SmartFilter[];
  filtersOn: boolean;
};

export type Layer = {
  id: string;
  name: string;
  kind: "pixel" | "text" | "shape" | "adjustment" | "vector" | "smart";
  /** Pixels (not used by adjustment layers). Position in the document is x, y. */
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  visible: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  locked: boolean;
  lockAlpha: boolean;
  /** Clipped to the layer below (Photoshop's clipping mask). */
  clip: boolean;
  /** Same size and position as `canvas`. Alpha is visibility: opaque shows, clear hides. */
  mask: HTMLCanvasElement | null;
  maskOn: boolean;
  effects: Effects | null;
  text?: TextMeta;
  shape?: ShapeMeta;
  adjust?: AdjustMeta;
  vector?: VectorMeta;
  smart?: SmartMeta;
};

/** A selection is a document-sized alpha mask, plus its bounds for quick tests. */
export type Selection = { mask: HTMLCanvasElement; bounds: Rect };

export type Doc = {
  w: number;
  h: number;
  layers: Layer[]; // bottom first
  active: string;
  selection: Selection | null;
  /** Edit the active layer's mask instead of its pixels. */
  editMask: boolean;
  name: string;
};

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export type ToolId =
  | "move"
  | "marquee-rect"
  | "marquee-ellipse"
  | "lasso"
  | "lasso-poly"
  | "wand"
  | "crop"
  | "eyedropper"
  | "brush"
  | "pencil"
  | "eraser"
  | "bucket"
  | "gradient"
  | "clone"
  | "heal"
  | "spot-heal"
  | "red-eye"
  | "smudge"
  | "blur-brush"
  | "sharpen-brush"
  | "dodge"
  | "burn"
  | "sponge"
  | "liquify"
  | "mosaic-brush"
  | "text"
  | "shape"
  | "pen"
  | "node"
  | "hand"
  | "zoom";

export type SymmetryMode = "off" | "vertical" | "horizontal" | "quad" | "radial6" | "radial8";
export type CropGuide = "thirds" | "grid" | "golden" | "diagonal";

export type BrushSettings = {
  size: number;
  hardness: number; // 0..100
  opacity: number; // 0..100
  flow: number; // 0..100
  spacing: number; // % of size
  strength: number; // pixel tools: 0..100
  sampleAll: boolean;
  spongeMode: "saturate" | "desaturate";
  range: "shadows" | "midtones" | "highlights";
  symmetry: SymmetryMode;
  mosaicSize: number;
};

export type SelectMode = "new" | "add" | "subtract" | "intersect";
