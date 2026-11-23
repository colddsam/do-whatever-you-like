"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Box,
  Check,
  ChevronDown,
  Download,
  FileOutput,
  FilePlus2,
  FileImage,
  FolderOpen,
  History as HistoryIcon,
  Image as ImageIcon,
  Info,
  Keyboard,
  Layers as LayersIcon,
  Loader2,
  Eye,
  Maximize,
  Maximize2,
  Minus,
  Palette,
  PanelRight,
  PenTool,
  Pipette,
  Plus,
  RefreshCw,
  Spline,
  SquareSplitHorizontal,
  Stamp,
  Sticker,
  ImageUpscale,
  Minimize2,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  WandSparkles,
  X,
} from "lucide-react";
import { getLenis } from "@/lib/smooth-scroll";
import { sampleRgbaPatch } from "@/lib/color-sample";
import { saveBlob, uploadForm } from "@/lib/files";
import { IMAGE_API } from "@/lib/image";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../../file-drop";
import { Workbench } from "../../workbench";
import { familyFor, FONT_CLASSES, loadFont } from "../fonts";
import { takeHandoff } from "@/lib/handoff";
import { addFrame, addSticker, addStyledText, addWatermark, FRAMES, makeCollage, STICKER_SETS, TEXT_STYLES, type FrameId } from "./create";
import { LOOK_OPS } from "./looks";
import {
  addAdjustmentLayer,
  addMask,
  alignLayer,
  applyMask,
  applyOp,
  applyOpToImage,
  defaultTarget,
  deleteLayers,
  mergeSelected,
  previewOpImage,
  type OpTarget,
  clearSelection,
  commitTransform,
  cropDoc,
  duplicateLayer,
  fillSelection,
  flattenDoc,
  inverseSelection,
  layerVia,
  mergeDown,
  mergeVisible,
  previewOp,
  rasterize,
  rasterizeAll,
  rasterizeLayerStyle,
  resizeCanvas,
  resizeImage,
  selectLayerPixels,
  stampVisible,
  strokeSelection,
  transformCanvas,
  transformMatrix,
  trimDoc,
  type TransformState,
} from "./actions";
import {
  clearSmartFilters,
  cloneDocDeep,
  convertToSmartObject,
  duplicateSmartIndependent,
  moveSmartLayer,
  placeAsSmartObject,
  previewSmartLayer,
  removeSmartFilter,
  reorderSmartFilter,
  renderSmartSource,
  replaceSmartContents,
  resetSmartTransform,
  resolveSmartOp,
  smartMetrics,
  toggleAllSmartFilters,
  updateLinkedSmartObjects,
  updateSmartFilter,
} from "./smart";
import { ADJUSTMENTS, adjustmentById } from "./adjustments";
import {
  activeLayer,
  canvasBytes,
  clamp,
  coverDoc,
  docFromCanvas,
  ctx2d,
  freshName,
  hexToRgb,
  insertAbove,
  layerBounds,
  makeCanvas,
  newDoc,
  newLayer,
  nextFrame,
  replaceLayer,
  rgbToHex,
  selectionInLayer,
} from "./doc";
import { ExportDialog, FillDialog, NewDocDialog, NumberDialog, ShortcutsDialog, SizeDialog, StrokeDialog, type FillChoice } from "./dialogs";
import { FILTERS } from "./filters";
import { inpaint } from "./inpaint";
import { clearSession, copyToClipboard, decodeImage, deserialize, isProject, isPsd, loadSession, openFile, saveSession, writeProject, writePsdFile, PROJECT_EXT, type SavedSession } from "./io";
import { blurImage, defaults, histogram, type Op } from "./ops";
import { beginStroke, BUFFER_TOOLS, bucketFill, endStroke, gradientFill, liveFor, PIXEL_TOOLS, redEye, strokeTo, type StrokeState } from "./paint";
import { groupIcon, groupLabel, opBlurb, opIcon } from "./catalog";
import { EffectsBrowser, rememberEffect, useEffectPreviews } from "./effects";
import { ColorPanel, EffectsEditor, HistogramChart, HistoryPanel, LayersPanel, ParamsEditor, VectorPanel, type LayerApi } from "./panels";
import { compose, flatten, renderShape, renderText, shapePad, type Live } from "./render";
import { colorMask, combine, drawAnts, edgeCanvas, ellipsePath, featherSelection, fromMask, growMask, polyPath, rectPath, selectAll, shapeMask, wandMask } from "./selection";
import { DEFAULT_BRUSH, DEFAULT_OPTS, FONTS, OptionsBar, TOOLS, Toolbar, type GradPreset, type ToolOpts } from "./tools";
import { NO_EFFECTS, type BrushSettings, type Doc, type Layer, type Pt, type Rect, type SelectMode, type ShapeMeta, type TextMeta, type ToolId, type VNode, type VPath } from "./types";
import { Btn, Check2, ColorWell, CompactMenu, MenuBar, RangeRow, Select, type MenuItem } from "./ui";
import { deleteNode, docToSvg, hitPath, importSvg, layerPaths, nearestOnPath, newPath, path2d, shapeToPaths, splitSegment, toggleSmooth, transformPaths as transformPathsFor, withPaths } from "./vector";

/* ---------- History ---------- */

type Entry = { doc: Doc; label: string; at: number; key?: string };
type History = { entries: Entry[]; index: number };
type SmartFrame = { parentHist: History; layerId: string; sourceId: string; parentName: string; layerName: string; view: { z: number; x: number; y: number } };
const MAX_STEPS = 60;
const MAX_BYTES = 900e6; // Undo keeps pixels; past this the oldest steps go.

function docBytes(d: Doc, seen: Set<HTMLCanvasElement>): number {
  let b = 0;
  for (const l of d.layers) {
    for (const c of [l.canvas, l.mask]) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      b += canvasBytes(c);
    }
    if (l.smart?.sourceDoc) b += docBytes(l.smart.sourceDoc, seen);
  }
  const s = d.selection?.mask;
  if (s && !seen.has(s)) {
    seen.add(s);
    b += canvasBytes(s);
  }
  return b;
}

function trimHistory(entries: Entry[]) {
  while (entries.length > MAX_STEPS) entries.shift();
  const size = () => {
    const seen = new Set<HTMLCanvasElement>();
    let b = 0;
    for (const e of entries) b += docBytes(e.doc, seen);
    return b;
  };
  while (entries.length > 4 && size() > MAX_BYTES) entries.shift();
  return entries;
}

/** The biggest picture this device can safely hold (iPhones and iPads cap canvases near 16 MP). */
const pixelLimit = () => {
  if (typeof navigator === "undefined") return 100e6;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? 16e6 : 100e6;
};

function gradStops(p: GradPreset, fg: string, bg: string) {
  const [r, g, b] = hexToRgb(fg);
  switch (p) {
    case "fg-clear":
      return [{ at: 0, color: fg }, { at: 1, color: `rgba(${r},${g},${b},0)` }];
    case "bw":
      return [{ at: 0, color: "#000" }, { at: 1, color: "#fff" }];
    case "rainbow":
      return ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"].map((c, i, a) => ({ at: i / (a.length - 1), color: c }));
    case "sunset":
      return [{ at: 0, color: "#2b1055" }, { at: 0.5, color: "#d53369" }, { at: 1, color: "#ffcc70" }];
    case "chrome":
      return [{ at: 0, color: "#2b2b2b" }, { at: 0.45, color: "#f5f5f5" }, { at: 0.5, color: "#6b6b6b" }, { at: 1, color: "#e0e0e0" }];
    default:
      return [{ at: 0, color: fg }, { at: 1, color: bg }];
  }
}

const ensureFont = (t: TextMeta) => loadFont(t.font, t.weight, Math.min(200, t.size));
const textName = (t: TextMeta) => t.text.split("\n")[0].slice(0, 28) || "Text";

type Drag =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { type: "pinch"; d0: number; z0: number; mid: Pt; vx: number; vy: number }
  | { type: "stroke" }
  | { type: "move"; start: Pt; layerId: string; dx: number; dy: number }
  | { type: "selmove"; start: Pt; dx: number; dy: number }
  | { type: "marquee"; a: Pt; b: Pt; mode: SelectMode; ellipse: boolean }
  | { type: "lasso"; pts: Pt[]; mode: SelectMode }
  | { type: "gradient"; a: Pt; b: Pt }
  | { type: "shape"; a: Pt; b: Pt }
  | { type: "crop"; handle: string; start: Pt; orig: Rect }
  | { type: "transform"; handle: string; start: Pt; orig: TransformState }
  | { type: "pick"; bg: boolean }
  /** Pen: dragging out the handles of the node just placed. */
  | { type: "pen"; idx: number; start: Pt }
  /** Direct selection: a point or one of its handles, or the whole path, being dragged. */
  | { type: "vnode"; layerId: string; path: number; sub: number; node: number; part: "node" | "i" | "o"; start: Pt; base: VPath[]; alt: boolean; next: VPath[] | null }
  | { type: "vpath"; layerId: string; path: number; start: Pt; base: VPath[]; next: VPath[] | null };

type OpEdit = { op: Op; params: Record<string, unknown>; asLayer: boolean; target: OpTarget; from?: Panel; filterId?: string; layerId?: string };
/** The path being edited with the Direct selection tool, and (optionally) one of its points. */
type NodeSel = { layerId: string; path: number; sub: number | null; node: number | null };
type Panel = "properties" | "color" | "looks" | "adjust" | "create" | "history" | "info" | "layers";
type DialogName = null | "new" | "image-size" | "canvas-size" | "rotate" | "fill" | "stroke" | "feather" | "expand" | "contract" | "color-range" | "export" | "shortcuts";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const HANDLE_POS: Record<string, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };

/** The transparency checkerboard (the QR tool's), for thumbnails. */
const CHECKER_BG = "bg-[conic-gradient(var(--color-paper-2)_25%,var(--color-surface)_0_50%,var(--color-paper-2)_0_75%,var(--color-surface)_0)] bg-[length:12px_12px]";

const QUICK_FIXES: { label: string; run: string; icon: typeof Wand2 }[] = [
  { label: "Auto tone", run: "auto-tone", icon: WandSparkles },
  { label: "Auto colour", run: "auto-color", icon: Palette },
  { label: "Camera Raw", run: "camera-raw", icon: Sparkles },
  { label: "Sharpen", run: "unsharp-mask", icon: Spline },
  { label: "Remove BG", run: "remove-bg", icon: Wand2 },
  { label: "Select subject", run: "subject", icon: ImageIcon },
];

/** The Adjust tab's order: quick wins first, then light, colour, and the filter families. */
const ADJUST_ORDER = ["Auto", "Basic", "Colour", "Special"];
/** Every adjustment and filter, for the Adjust tab's preview tiles. */
const ALL_OPS: Op[] = [...ADJUSTMENTS, ...FILTERS];

/** Keeps at least this much of the picture on screen, so it can never be panned out of reach. */
const KEEP_VISIBLE = 64;
const POPULAR_GOOGLE_FONTS = ["Montserrat", "Playfair Display", "Oswald", "Space Grotesk", "Dancing Script"] as const;

/** Largest axis-aligned rectangle inside a rotated w×h image (prevents blank corners when straightening). */
function inscribedCropRect(w: number, h: number, deg: number): Rect {
  const rad = Math.abs((deg * Math.PI) / 180);
  if (rad < 1e-4) return { x: 0, y: 0, w, h };
  const cosA = Math.abs(Math.cos(rad));
  const sinA = Math.abs(Math.sin(rad));
  const nw = Math.ceil(w * cosA + h * sinA);
  const nh = Math.ceil(w * sinA + h * cosA);
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  let wr: number;
  let hr: number;
  if (shortSide <= 2 * sinA * cosA * longSide || Math.abs(sinA - cosA) < 1e-6) {
    const half = 0.5 * shortSide;
    wr = w >= h ? half / Math.max(1e-4, sinA) : half / Math.max(1e-4, cosA);
    hr = w >= h ? half / Math.max(1e-4, cosA) : half / Math.max(1e-4, sinA);
  } else {
    const cos2 = cosA * cosA - sinA * sinA;
    wr = (w * cosA - h * sinA) / cos2;
    hr = (h * cosA - w * sinA) / cos2;
  }
  const cw = Math.max(1, Math.min(nw, Math.floor(wr)));
  const ch = Math.max(1, Math.min(nh, Math.floor(hr)));
  return { x: Math.max(0, Math.round((nw - cw) / 2)), y: Math.max(0, Math.round((nh - ch) / 2)), w: cw, h: ch };
}

/* ---------- The editor ---------- */

export function ProPhotoEditor({ toolId }: { toolId: string }) {
  const tool0 = getTool(toolId)!;
  const [hist, setHistState] = useState<History | null>(null);
  const histRef = useRef<History | null>(null);
  const doc = hist ? hist.entries[hist.index].doc : null;
  // Handlers and the render loop read the document through this; history updates keep it in step.
  const docRef = useRef<Doc | null>(null);

  const [tool, setToolState] = useState<ToolId>("move");
  const [brush, setBrushState] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [opts, setOptsState] = useState<ToolOpts>(DEFAULT_OPTS);
  const [fg, setFg] = useState("#15140f");
  const [bg, setBg] = useState("#ffffff");
  const [panel, setPanel] = useState<Panel>("properties");
  const [opEdit, setOpEdit] = useState<OpEdit | null>(null);
  const [styleEdit, setStyleEdit] = useState(false);
  const [transform, setTransform] = useState<TransformState | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [busy, setBusyState] = useState<string | null>(null);
  // While a job runs (a filter, healing, the AI), history must hold still: the job commits onto
  // the document it started from, so an undo in between would be silently lost.
  const busyRef = useRef(false);
  const setBusy = useCallback((b: string | null) => {
    busyRef.current = !!b;
    setBusyState(b);
  }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [cloneSrc, setCloneSrc] = useState<Pt | null>(null);
  const [poly, setPoly] = useState<{ pts: Pt[]; mode: SelectMode } | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [session, setSession] = useState<(SavedSession & { url: string | null }) | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [exported, setExported] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; hex: string | null } | null>(null);
  const [docHist, setDocHist] = useState<ReturnType<typeof histogram> | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hasClip, setHasClip] = useState(false);
  const [compare, setCompare] = useState(false);
  const [splitCompare, setSplitCompare] = useState(false);
  const [splitX, setSplitX] = useState(0.5);
  const [cropAngle, setCropAngle] = useState(0);
  const [fontsList, setFontsList] = useState<{ label: string; family: string }[]>(() => [...FONTS]);
  const [gFontInput, setGFontInput] = useState("");
  const [wmText, setWmText] = useState("© Studio");
  const [wmMode, setWmMode] = useState<"tile" | "corner">("tile");
  const [wmColor, setWmColor] = useState("#ffffff");
  const [wmOpacity, setWmOpacity] = useState(32);
  const [wmAngle, setWmAngle] = useState(-30);
  const [wmSize, setWmSize] = useState(5);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelW, setPanelW] = useState(() => {
    if (typeof window === "undefined") return 312;
    try {
      const savedW = Number(localStorage.getItem("dw-pro-panel-w"));
      return savedW >= 260 && savedW <= 460 ? savedW : 312;
    } catch {
      return 312;
    }
  });
  // Live previews for the Adjust tab: your picture through each effect, while that tab is open.
  const effectPreviews = useEffectPreviews(doc && panel === "adjust" ? doc : null, ALL_OPS, { fg, bg });
  const [lookThumbs, setLookThumbs] = useState<{ src: HTMLCanvasElement | null; urls: Record<string, string> }>({ src: null, urls: {} });
  const [stickerSet, setStickerSet] = useState(0);
  // Vector editing: the pen's path in progress, and the path (and point) picked for direct selection.
  const [pen, setPen] = useState<VNode[] | null>(null);
  const [nodeSel, setNodeSel] = useState<NodeSel | null>(null);
  const [smartStack, setSmartStack] = useState<SmartFrame[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [smartPrompt, setSmartPrompt] = useState<string | null>(null);
  const [hasScreenEyeDropper, setHasScreenEyeDropper] = useState(false);
  useEffect(() => {
    setHasScreenEyeDropper(typeof window !== "undefined" && "EyeDropper" in window); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);
  const effectiveSelectedIds = useMemo(() => {
    if (!doc) return [];
    const ids = new Set(doc.layers.map((l) => l.id));
    const filtered = selectedIds.filter((id) => ids.has(id));
    return filtered.length ? filtered : [doc.active];
  }, [doc, selectedIds]);
  const replaceSmartRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  // Phones: the panel sheet under the canvas can fold away to give the picture the room.
  const [sheetOpen, setSheetOpen] = useState(true);
  // Desktop: the Layers dock folds down while browsing effects and looks, so their grids get the room.
  const [layersOpen, setLayersOpen] = useState(true);
  const [seenPanel, setSeenPanel] = useState(panel);
  if (seenPanel !== panel) {
    setSeenPanel(panel);
    const browsing = (p: Panel) => p === "adjust" || p === "looks";
    // Picking an effect opens its settings in Properties: those stay roomy too.
    setLayersOpen(!browsing(panel) && !(panel === "properties" && browsing(seenPanel)));
  }
  const pannedHint = useRef(false);
  // Held down in an effect's settings: shows the picture without the effect being previewed.
  const peekRef = useRef(false);
  const [peeking, setPeeking] = useState(false);
  const compareRef = useRef(false);
  const splitCompareRef = useRef(false);
  const splitXRef = useRef(0.5);
  const splitHandleRef = useRef<HTMLDivElement>(null);
  const collageRef = useRef<HTMLInputElement>(null);
  const subjectCache = useRef<{ canvas: HTMLCanvasElement; mask: HTMLCanvasElement } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const view = useRef({ z: 1, x: 0, y: 0 });
  const dirty = useRef(true);
  const live = useRef<Live | undefined>(undefined);
  const stroke = useRef<StrokeState | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const hover = useRef<Pt | null>(null);
  const lastPaint = useRef<Pt | null>(null);
  const space = useRef(false);
  const clipboard = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);
  const lastComp = useRef<{ canvas: HTMLCanvasElement; rx: number; ry: number; s: number } | null>(null);
  const edge = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const tokens = useRef({ checkA: "#EAE6DB", checkB: "#FBFAF6", line: "#DAD5C8", ink: "#15140F", accent: "#EB4A10" });

  const bump = useCallback(() => {
    dirty.current = true;
  }, []);
  const say = useCallback((m: string) => setToast(m), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----- History ----- */

  const setHist = (h: History | null) => {
    histRef.current = h;
    docRef.current = h ? h.entries[h.index].doc : null;
    setHistState(h);
    dirty.current = true;
  };
  /** Puts a new document in history. Same `key` within a moment replaces the last step (slider drags). */
  const commit = useCallback((next: Doc, label: string, key?: string) => {
    const h = histRef.current;
    if (!h) return;
    const top = h.entries[h.index];
    const now = Date.now();
    let entries = h.entries.slice(0, h.index + 1);
    if (key && top.key === key && now - top.at < 1500) entries[entries.length - 1] = { doc: next, label, at: now, key };
    else entries.push({ doc: next, label, at: now, key });
    entries = trimHistory(entries);
    const nh = { entries, index: entries.length - 1 };
    histRef.current = nh;
    docRef.current = next;
    setHistState(nh);
    dirty.current = true;
  }, []);
  const undo = () => {
    if (busyRef.current) return;
    const h = histRef.current;
    if (h && h.index > 0) setHist({ ...h, index: h.index - 1 });
  };
  const redo = () => {
    if (busyRef.current) return;
    const h = histRef.current;
    if (h && h.index < h.entries.length - 1) setHist({ ...h, index: h.index + 1 });
  };
  const jump = (i: number) => {
    if (busyRef.current) return;
    const h = histRef.current;
    if (h) setHist({ ...h, index: i });
  };

  /* ----- View ----- */

  /** Keeps part of the picture in view however far it's dragged or zoomed. */
  const clampView = (v: { z: number; x: number; y: number }) => {
    const w = wrapRef.current;
    const d = docRef.current;
    if (!w || !d) return v;
    const W = w.clientWidth;
    const H = w.clientHeight;
    const dw = d.w * v.z;
    const dh = d.h * v.z;
    const kx = Math.min(KEEP_VISIBLE, dw, W / 2);
    const ky = Math.min(KEEP_VISIBLE, dh, H / 2);
    return { z: v.z, x: clamp(v.x, kx - dw, W - kx), y: clamp(v.y, ky - dh, H - ky) };
  };
  const setView = (v: { z: number; x: number; y: number }) => {
    view.current = clampView(v);
    dirty.current = true;
  };

  const fit = useCallback((d = docRef.current, cap = false) => {
    const w = wrapRef.current;
    if (!d || !w) return;
    const W = w.clientWidth;
    const H = w.clientHeight;
    const pad = W < 640 ? 20 : 48; // phones: let the picture use the width
    let z = Math.min((W - pad) / d.w, (H - pad) / d.h);
    if (cap) z = Math.min(1, z);
    z = Math.max(0.01, z);
    view.current = { z, x: (W - d.w * z) / 2, y: (H - d.h * z) / 2 };
    dirty.current = true;
    setZoom(view.current.z);
  }, []);
  const zoomAt = (factor: number, sx?: number, sy?: number) => {
    const w = wrapRef.current;
    if (!w) return;
    const v = view.current;
    const cx = sx ?? w.clientWidth / 2;
    const cy = sy ?? w.clientHeight / 2;
    const z = clamp(v.z * factor, 0.01, 64);
    setView({ z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z });
    setZoom(view.current.z);
  };
  const actual = () => {
    const w = wrapRef.current;
    const d = docRef.current;
    if (!w || !d) return;
    view.current = { z: 1, x: (w.clientWidth - d.w) / 2, y: (w.clientHeight - d.h) / 2 };
    dirty.current = true;
    setZoom(view.current.z);
  };

  /* ----- Opening ----- */

  const start = useCallback(
    (d: Doc, label = "Open") => {
      const limit = pixelLimit();
      if (d.w * d.h > limit) {
        const k = Math.sqrt(limit / (d.w * d.h));
        d = { ...resizeImage(d, Math.floor(d.w * k), Math.floor(d.h * k)) };
        setToast(`Reduced to ${d.w} × ${d.h} so this device can edit it.`);
      }
      setHist({ entries: [{ doc: d, label, at: Date.now() }], index: 0 });
      setOpEdit(null);
      setTransform(null);
      setCrop(null);
      setPoly(null);
      setCloneSrc(null);
      setExported(false);
      setRejected(null);
      live.current = undefined;
      setPen(null);
      setNodeSel(null);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fit(d, true);
          // Phones: bring the whole editor into view, so the picture and its tools fill the screen.
          const el = rootRef.current;
          if (el && window.innerWidth < 1024) {
            // Clear the site's sticky navbar, which stays on screen above the editor.
            const nav = document.querySelector("header");
            const navH = nav && /sticky|fixed/.test(getComputedStyle(nav).position) ? nav.getBoundingClientRect().height : 0;
            const y = el.getBoundingClientRect().top + window.scrollY - navH - 6;
            const lenis = getLenis();
            if (lenis) lenis.scrollTo(y);
            else window.scrollTo({ top: y, behavior: "smooth" });
          }
        }),
      );
    },
    [fit],
  );

  const openAny = async (f: File) => {
    setBusy("Opening…");
    await nextFrame();
    try {
      if (isSvg(f)) {
        try {
          await openSvg(f, false);
          return;
        } catch {
          // Not drawable as paths (only text or pictures inside): open it as a picture instead.
        }
      }
      start(await openFile(f));
    } catch (e) {
      setRejected(isPsd(f) ? `We couldn't read that PSD: ${(e as Error).message}` : isProject(f) ? (e as Error).message : "This browser can't open that file. Try a JPG, PNG, WebP, GIF, AVIF, BMP, SVG, PSD or a saved project.");
    } finally {
      setBusy(null);
    }
  };

  const placeFile = async (f: File, at?: Pt, embedProject = false) => {
    const d = docRef.current;
    if (!d) return openAny(f);
    if (!embedProject && (isPsd(f) || isProject(f))) return openAny(f);
    if (isSvg(f)) {
      try {
        return await openSvg(f, true);
      } catch {
        // Falls through to placing it as a Smart Object.
      }
    }
    try {
      const name = f.name.replace(/\.[^.]+$/, "") || "Placed";
      const srcDoc = isPsd(f) || isProject(f) ? await openFile(f) : docFromCanvas(await decodeImage(f), name);
      commit(placeAsSmartObject(d, srcDoc, name, at, { fg, bg }), "Place Smart Object");
      say("Placed as a Smart Object. Scale or rotate cleanly anytime, or double-click its thumbnail to edit contents.");
    } catch {
      say("That file isn't a picture this browser can open.");
    }
  };

  // ?open=handoff: a picture passed on from another image tool ("Edit in Pro editor").
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("open")) return;
    takeHandoff().then(async (h) => {
      if (!h) return;
      try {
        const c = await decodeImage(h.blob);
        start(docFromCanvas(c, h.name.replace(/\.[^.]+$/, "") || "Photo"));
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        setRejected("We couldn't open the picture passed from the other tool. Drop it here instead.");
      }
    });
  }, [start]);

  useEffect(() => {
    let url: string | null = null;
    loadSession().then((s) => {
      if (!s) return;
      url = s.thumb ? URL.createObjectURL(s.thumb) : null;
      setSession({ ...s, url });
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  // Autosave a moment after edits stop, so a closed tab can be picked up again.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => saveSession(doc).then((ok) => ok && setSavedAt(Date.now())), 2500);
    return () => clearTimeout(t);
  }, [doc]);

  /* ----- Rendering ----- */

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const read = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
    tokens.current = { checkA: read("--color-paper-2", "#EAE6DB"), checkB: read("--color-surface", "#FBFAF6"), line: read("--color-line", "#DAD5C8"), ink: read("--color-ink", "#15140F"), accent: read("--color-accent", "#EB4A10") };
  }, []);

  /* ----- Helpers that need the view ----- */

  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const r = overRef.current!.getBoundingClientRect();
    const v = view.current;
    return { x: (e.clientX - r.left - v.x) / v.z, y: (e.clientY - r.top - v.y) / v.z };
  };
  const toScreen = (p: Pt): Pt => ({ x: view.current.x + p.x * view.current.z, y: view.current.y + p.y * view.current.z });
  function rotateKnob(t: TransformState) {
    const m = transformMatrix(t);
    const top = new DOMPoint(t.box.x + t.box.w / 2, t.box.y).matrixTransform(m);
    const c = new DOMPoint(t.box.x + t.box.w / 2, t.box.y + t.box.h / 2).matrixTransform(m);
    const len = Math.hypot(top.x - c.x, top.y - c.y) || 1;
    const k = 28 / view.current.z;
    const p = { x: top.x + ((top.x - c.x) / len) * k * Math.sign(t.sy || 1), y: top.y + ((top.y - c.y) / len) * k * Math.sign(t.sy || 1) };
    return toScreen(p);
  }

  /** The colour on screen at a document point (respects Eyedropper sample size & All vs Current Layer). */
  const sampleAt = (p: Pt): string | null => {
    const d = docRef.current;
    if (!d || p.x < 0 || p.y < 0 || p.x >= d.w || p.y >= d.h) return null;
    const size = opts.eyedropperSize;
    const rad = Math.floor(size / 2);
    const ix = Math.min(d.w - 1, Math.max(0, Math.floor(p.x)));
    const iy = Math.min(d.h - 1, Math.max(0, Math.floor(p.y)));
    const x0 = Math.max(0, ix - rad);
    const y0 = Math.max(0, iy - rad);
    const x1 = Math.min(d.w, ix + rad + 1);
    const y1 = Math.min(d.h, iy + rad + 1);
    const rect = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    let c: HTMLCanvasElement;
    if (opts.eyedropperAll) {
      c = compose(d, { rect, scale: 1 });
    } else {
      c = makeCanvas(rect.w, rect.h);
      const l = activeLayer(d);
      if (l.kind !== "adjustment") ctx2d(c).drawImage(l.canvas, l.x - rect.x, l.y - rect.y);
    }
    const img = ctx2d(c, true).getImageData(0, 0, c.width, c.height);
    const px = sampleRgbaPatch(img.data, img.width, img.height, ix - rect.x, iy - rect.y, size);
    return px.a < 8 ? null : rgbToHex(px.r, px.g, px.b);
  };
  /** Faster: reads the colour from what's already drawn on screen (for the Info readout). */
  const peekAt = (p: Pt): string | null => {
    const lc = lastComp.current;
    if (!lc) return null;
    const x = Math.floor((p.x - lc.rx) * lc.s);
    const y = Math.floor((p.y - lc.ry) * lc.s);
    if (x < 0 || y < 0 || x >= lc.canvas.width || y >= lc.canvas.height) return null;
    const px = ctx2d(lc.canvas, true).getImageData(x, y, 1, 1).data;
    return px[3] < 8 ? null : rgbToHex(px[0], px[1], px[2]);
  };

  // Things drawn over the picture: selection, crop, transform box, brush outline…
  const overlayState = useRef({ crop, transform, poly, cloneSrc, showGrid, tool, brush, pen, nodeSel, cropGuide: opts.cropGuide, cropAngle, fg, bg, eyedropperSize: opts.eyedropperSize });
  useLayoutEffect(() => {
    overlayState.current = { crop, transform, poly, cloneSrc, showGrid, tool, brush, pen, nodeSel, cropGuide: opts.cropGuide, cropAngle, fg, bg, eyedropperSize: opts.eyedropperSize };
  });

  /** The paths shown for direct selection: the live (dragged) version if there is one. */
  const editedPaths = (d: Doc, layerId: string): VPath[] => {
    const sw = live.current?.swap;
    const l = sw?.id === layerId ? sw : d.layers.find((x) => x.id === layerId);
    return l?.vector ? layerPaths(l) : [];
  };

  function drawOverlay(o: HTMLCanvasElement, d: Doc, dpr: number, phase: number) {
    const g = ctx2d(o);
    const v = view.current;
    const st = overlayState.current;
    const T = tokens.current;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, o.width, o.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (x: number) => v.x + x * v.z;
    const sy = (y: number) => v.y + y * v.z;
    // The canvas edge.
    g.strokeStyle = T.line;
    g.lineWidth = 1;
    g.strokeRect(Math.round(sx(0)) - 0.5, Math.round(sy(0)) - 0.5, Math.round(d.w * v.z) + 1, Math.round(d.h * v.z) + 1);

    if (st.showGrid) {
      const steps = [10, 25, 50, 100, 250, 500, 1000];
      const step = steps.find((s) => s * v.z >= 28) ?? 1000;
      g.save();
      g.beginPath();
      for (let x = step; x < d.w; x += step) {
        g.moveTo(Math.round(sx(x)) + 0.5, sy(0));
        g.lineTo(Math.round(sx(x)) + 0.5, sy(d.h));
      }
      for (let y = step; y < d.h; y += step) {
        g.moveTo(sx(0), Math.round(sy(y)) + 0.5);
        g.lineTo(sx(d.w), Math.round(sy(y)) + 0.5);
      }
      g.strokeStyle = "rgba(21,20,15,0.18)";
      g.stroke();
      g.beginPath();
      for (const f of [1 / 3, 2 / 3]) {
        g.moveTo(sx(d.w * f), sy(0));
        g.lineTo(sx(d.w * f), sy(d.h));
        g.moveTo(sx(0), sy(d.h * f));
        g.lineTo(sx(d.w), sy(d.h * f));
      }
      g.strokeStyle = "rgba(235,74,16,0.55)";
      g.stroke();
      g.restore();
    }

    // Marching ants around the selection (recomputed when the selection or the view changes).
    const sel = d.selection;
    const dr = drag.current;
    if (sel && !(dr?.type === "selmove")) {
      const key = `${o.width}x${o.height}|${v.z}|${v.x}|${v.y}`;
      if (!edge.current || edge.current.key !== key || (edge.current as { sel?: unknown }).sel !== sel) {
        const ec = edgeCanvas(sel, o.width, o.height, v.z * dpr, v.x * dpr, v.y * dpr);
        edge.current = Object.assign({ key, canvas: ec }, { sel });
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      drawAnts(g, edge.current.canvas, Math.floor(phase / 3));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (sel && dr?.type === "selmove") {
      g.save();
      g.globalAlpha = 0.5;
      g.drawImage(sel.mask, sx(dr.dx), sy(dr.dy), d.w * v.z, d.h * v.z);
      g.restore();
    }

    const dashed = (draw: () => void) => {
      g.save();
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.lineDashOffset = -phase / 3;
      g.strokeStyle = "#000";
      draw();
      g.stroke();
      g.lineDashOffset = -phase / 3 + 4;
      g.strokeStyle = "#fff";
      g.stroke();
      g.restore();
    };

    if (dr?.type === "marquee") {
      const r = normRect(dr.a, dr.b);
      dashed(() => {
        g.beginPath();
        if (dr.ellipse) g.ellipse(sx(r.x + r.w / 2), sy(r.y + r.h / 2), (r.w * v.z) / 2, (r.h * v.z) / 2, 0, 0, Math.PI * 2);
        else g.rect(sx(r.x), sy(r.y), r.w * v.z, r.h * v.z);
      });
    }
    if (dr?.type === "lasso" && dr.pts.length > 1) {
      dashed(() => {
        g.beginPath();
        dr.pts.forEach((p, i) => (i ? g.lineTo(sx(p.x), sy(p.y)) : g.moveTo(sx(p.x), sy(p.y))));
      });
    }
    if (st.poly && st.poly.pts.length) {
      const pts = st.poly.pts;
      dashed(() => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(sx(p.x), sy(p.y)) : g.moveTo(sx(p.x), sy(p.y))));
        if (hover.current) g.lineTo(sx(hover.current.x), sy(hover.current.y));
      });
      g.fillStyle = T.accent;
      g.fillRect(sx(pts[0].x) - 3, sy(pts[0].y) - 3, 6, 6);
    }
    if (dr?.type === "gradient" || dr?.type === "shape") {
      g.save();
      g.strokeStyle = T.ink;
      g.lineWidth = 1.5;
      g.beginPath();
      if (dr.type === "gradient") {
        g.moveTo(sx(dr.a.x), sy(dr.a.y));
        g.lineTo(sx(dr.b.x), sy(dr.b.y));
        g.stroke();
        for (const p of [dr.a, dr.b]) {
          g.beginPath();
          g.arc(sx(p.x), sy(p.y), 4, 0, Math.PI * 2);
          g.fillStyle = "#fff";
          g.fill();
          g.stroke();
        }
      }
      g.restore();
    }

    // Crop: dim outside, guide overlay inside, eight handles, and straighten grid.
    if (st.crop) {
      const r = st.crop;
      g.save();
      g.fillStyle = "rgba(21,20,15,0.55)";
      g.beginPath();
      g.rect(sx(-1e5), sy(-1e5), 2e5 * v.z, 2e5 * v.z);
      g.rect(sx(r.x), sy(r.y), r.w * v.z, r.h * v.z);
      g.fill("evenodd");
      g.strokeStyle = "rgba(255,255,255,0.48)";
      g.beginPath();
      if (st.cropGuide === "thirds") {
        for (const f of [1 / 3, 2 / 3]) {
          g.moveTo(sx(r.x + r.w * f), sy(r.y));
          g.lineTo(sx(r.x + r.w * f), sy(r.y + r.h));
          g.moveTo(sx(r.x), sy(r.y + r.h * f));
          g.lineTo(sx(r.x + r.w), sy(r.y + r.h * f));
        }
      } else if (st.cropGuide === "grid") {
        for (let i = 1; i < 4; i++) {
          const f = i / 4;
          g.moveTo(sx(r.x + r.w * f), sy(r.y));
          g.lineTo(sx(r.x + r.w * f), sy(r.y + r.h));
          g.moveTo(sx(r.x), sy(r.y + r.h * f));
          g.lineTo(sx(r.x + r.w), sy(r.y + r.h * f));
        }
      } else if (st.cropGuide === "golden") {
        for (const f of [0.382, 0.618]) {
          g.moveTo(sx(r.x + r.w * f), sy(r.y));
          g.lineTo(sx(r.x + r.w * f), sy(r.y + r.h));
          g.moveTo(sx(r.x), sy(r.y + r.h * f));
          g.lineTo(sx(r.x + r.w), sy(r.y + r.h * f));
        }
      } else if (st.cropGuide === "diagonal") {
        g.moveTo(sx(r.x), sy(r.y));
        g.lineTo(sx(r.x + r.w), sy(r.y + r.h));
        g.moveTo(sx(r.x + r.w), sy(r.y));
        g.lineTo(sx(r.x), sy(r.y + r.h));
      }
      g.stroke();
      if (st.cropAngle !== 0) {
        const cx = sx(r.x + r.w / 2);
        const cy = sy(r.y + r.h / 2);
        const rw = (r.w * v.z) / 2;
        const rh = (r.h * v.z) / 2;
        g.save();
        g.translate(cx, cy);
        g.rotate((st.cropAngle * Math.PI) / 180);
        g.strokeStyle = "rgba(235,74,16,0.75)";
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(-rw, 0);
        g.lineTo(rw, 0);
        g.moveTo(0, -rh);
        g.lineTo(0, rh);
        g.stroke();
        g.restore();
      }
      g.strokeStyle = "#fff";
      g.lineWidth = 1.5;
      g.strokeRect(sx(r.x), sy(r.y), r.w * v.z, r.h * v.z);
      for (const h of HANDLES) {
        const [hx, hy] = HANDLE_POS[h];
        const px = sx(r.x + ((hx + 1) / 2) * r.w);
        const py = sy(r.y + ((hy + 1) / 2) * r.h);
        g.fillStyle = "#fff";
        g.fillRect(px - 4.5, py - 4.5, 9, 9);
        g.strokeStyle = T.ink;
        g.lineWidth = 1;
        g.strokeRect(px - 4.5, py - 4.5, 9, 9);
      }
      g.fillStyle = "#fff";
      g.font = "12px ui-monospace, monospace";
      g.fillText(`${Math.round(r.w)} × ${Math.round(r.h)}${st.cropAngle ? ` · ${st.cropAngle.toFixed(1)}°` : ""}`, sx(r.x) + 6, sy(r.y) - 8);
      g.restore();
    }

    // Free transform: the box through its matrix, handles, and a rotate knob.
    if (st.transform) {
      const m = transformMatrix(st.transform);
      const b = st.transform.box;
      const P = (x: number, y: number) => {
        const p = new DOMPoint(x, y).matrixTransform(m);
        return { x: sx(p.x), y: sy(p.y) };
      };
      const corners = [P(b.x, b.y), P(b.x + b.w, b.y), P(b.x + b.w, b.y + b.h), P(b.x, b.y + b.h)];
      g.save();
      g.strokeStyle = T.accent;
      g.lineWidth = 1.5;
      g.beginPath();
      corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.stroke();
      for (const h of HANDLES) {
        const [hx, hy] = HANDLE_POS[h];
        const p = P(b.x + ((hx + 1) / 2) * b.w, b.y + ((hy + 1) / 2) * b.h);
        g.fillStyle = "#fff";
        g.fillRect(p.x - 4, p.y - 4, 8, 8);
        g.strokeRect(p.x - 4, p.y - 4, 8, 8);
      }
      const top = P(b.x + b.w / 2, b.y);
      const knob = rotateKnob(st.transform);
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(knob.x, knob.y);
      g.stroke();
      g.beginPath();
      g.arc(knob.x, knob.y, 5, 0, Math.PI * 2);
      g.fillStyle = "#fff";
      g.fill();
      g.stroke();
      g.restore();
    }

    // Vector editing: the selected path's outline, points and handles; the pen's path in progress.
    const toS = (p: Pt) => ({ x: sx(p.x), y: sy(p.y) });
    const drawHandles = (nodes: VNode[], selected: number | null) => {
      g.lineWidth = 1;
      nodes.forEach((n, k) => {
        const p = toS(n);
        for (const h of [n.i, n.o]) {
          if (!h) continue;
          const q = toS(h);
          g.strokeStyle = T.accent;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(q.x, q.y);
          g.stroke();
          g.beginPath();
          g.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
          g.fillStyle = "#fff";
          g.fill();
          g.stroke();
        }
        g.fillStyle = k === selected ? T.accent : "#fff";
        g.strokeStyle = T.accent;
        g.fillRect(p.x - 4, p.y - 4, 8, 8);
        g.strokeRect(p.x - 4, p.y - 4, 8, 8);
      });
    };
    if (st.tool === "node" || st.tool === "pen") {
      // Every vector path gets a faint outline, so there's something to click on.
      g.save();
      for (const l of d.layers) {
        if (!l.visible || !l.vector) continue;
        const paths = editedPaths(d, l.id);
        paths.forEach((p, pi) => {
          const sel = st.nodeSel?.layerId === l.id && st.nodeSel.path === pi;
          g.strokeStyle = sel ? T.accent : "rgba(235,74,16,0.35)";
          g.lineWidth = sel ? 1.5 : 1;
          g.stroke(path2d(p, toS));
        });
      }
      g.restore();
      const ns = st.nodeSel;
      if (ns && st.tool === "node") {
        const p = editedPaths(d, ns.layerId)[ns.path];
        if (p) {
          g.save();
          p.subs.forEach((s, si) => drawHandles(s.nodes, ns.sub === si ? ns.node : null));
          g.restore();
        }
      }
    }
    if (st.pen && st.pen.length) {
      const pts = st.pen;
      g.save();
      g.strokeStyle = T.accent;
      g.lineWidth = 1.5;
      const sub = { nodes: pts, closed: false };
      const path = new Path2D();
      const f = toS;
      const p0 = f(pts[0]);
      path.moveTo(p0.x, p0.y);
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        const c1 = f(a.o ?? a);
        const c2 = f(b.i ?? b);
        const q = f(b);
        path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y);
      }
      // Rubber band from the last point to the pointer.
      if (hover.current && dr?.type !== "pen") {
        const a = pts[pts.length - 1];
        const c1 = f(a.o ?? a);
        const q = f(hover.current);
        path.bezierCurveTo(c1.x, c1.y, q.x, q.y, q.x, q.y);
      }
      g.stroke(path);
      drawHandles(sub.nodes, pts.length - 1);
      // The first point grows when the pointer is close enough to close the path.
      if (pts.length > 2 && hover.current) {
        const a = f(pts[0]);
        const b = f(hover.current);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 12) {
          g.beginPath();
          g.arc(a.x, a.y, 7, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.restore();
    }

    // Clone source and the brush outline.
    if (st.cloneSrc && (st.tool === "clone" || st.tool === "heal")) {
      const p = { x: sx(st.cloneSrc.x), y: sy(st.cloneSrc.y) };
      g.save();
      g.strokeStyle = T.accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(p.x - 7, p.y);
      g.lineTo(p.x + 7, p.y);
      g.moveTo(p.x, p.y - 7);
      g.lineTo(p.x, p.y + 7);
      g.stroke();
      g.restore();
    }
    const brushy = BUFFER_TOOLS.includes(st.tool) || PIXEL_TOOLS.includes(st.tool) || st.tool === "red-eye";
    if ((st.tool === "brush" || st.tool === "pencil" || st.tool === "eraser") && st.brush.symmetry !== "off") {
      g.save();
      g.strokeStyle = T.accent;
      g.lineWidth = 1;
      g.setLineDash([5, 5]);
      g.beginPath();
      const sym = st.brush.symmetry;
      const cx = sx(d.w / 2);
      const cy = sy(d.h / 2);
      if (sym === "vertical" || sym === "quad") {
        g.moveTo(cx, sy(0));
        g.lineTo(cx, sy(d.h));
      }
      if (sym === "horizontal" || sym === "quad") {
        g.moveTo(sx(0), cy);
        g.lineTo(sx(d.w), cy);
      }
      if (sym === "radial6" || sym === "radial8") {
        const rays = sym === "radial6" ? 6 : 8;
        const rad = Math.hypot(d.w, d.h) * 0.65 * v.z;
        for (let i = 0; i < rays; i++) {
          const a = (i * Math.PI * 2) / rays;
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        }
      }
      g.stroke();
      g.restore();
    }
    if (brushy && hover.current && !space.current) {
      const r = Math.max(1.5, (st.brush.size * v.z) / 2);
      const p = { x: sx(hover.current.x), y: sy(hover.current.y) };
      g.save();
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = 1.5;
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 0.75;
      g.stroke();
      g.restore();
    }
    if (st.tool === "eyedropper" && hover.current && !space.current && hover.current.x >= 0 && hover.current.y >= 0 && hover.current.x < d.w && hover.current.y < d.h) {
      const hx = hover.current.x;
      const hy = hover.current.y;
      const px = sx(hx);
      const py = sy(hy);
      const rad = 46;
      const cy = py > rad * 2.2 ? py - rad - 22 : py + rad + 22;
      const lc = lastComp.current;
      let liveHex = st.fg;
      const cells = 11;
      const half = Math.floor(cells / 2);
      const cellPx = (rad * 2) / cells;
      const lcx = lc ? Math.floor((hx - lc.rx) * lc.s) : -1;
      const lcy = lc ? Math.floor((hy - lc.ry) * lc.s) : -1;
      if (lc && lcx >= 0 && lcy >= 0 && lcx < lc.canvas.width && lcy < lc.canvas.height) {
        const pdata = ctx2d(lc.canvas, true).getImageData(lcx, lcy, 1, 1).data;
        if (pdata[3] >= 8) liveHex = rgbToHex(pdata[0], pdata[1], pdata[2]);
      }

      g.save();
      // Magnified pixel grid inside circular loupe
      g.beginPath();
      g.arc(px, cy, rad - 5, 0, Math.PI * 2);
      g.save();
      g.clip();
      g.fillStyle = "#181713";
      g.fillRect(px - rad, cy - rad, rad * 2, rad * 2);
      if (lc && lcx >= 0 && lcy >= 0 && lcx < lc.canvas.width && lcy < lc.canvas.height) {
        g.imageSmoothingEnabled = false;
        const sx0 = lcx - half;
        const sy0 = lcy - half;
        const cl = Math.max(0, sx0);
        const ct = Math.max(0, sy0);
        const cr = Math.min(lc.canvas.width, sx0 + cells);
        const cb = Math.min(lc.canvas.height, sy0 + cells);
        if (cr > cl && cb > ct) {
          g.drawImage(
            lc.canvas,
            cl,
            ct,
            cr - cl,
            cb - ct,
            px - rad + (cl - sx0) * cellPx,
            cy - rad + (ct - sy0) * cellPx,
            (cr - cl) * cellPx,
            (cb - ct) * cellPx,
          );
        }
      }
      // Subtle pixel grid + center sample reticle
      g.strokeStyle = "rgba(255,255,255,0.16)";
      g.lineWidth = 0.75;
      g.beginPath();
      for (let i = 1; i < cells; i++) {
        const off = -rad + i * cellPx;
        g.moveTo(px + off, cy - rad);
        g.lineTo(px + off, cy + rad);
        g.moveTo(px - rad, cy + off);
        g.lineTo(px + rad, cy + off);
      }
      g.stroke();
      const sRad = Math.floor(st.eyedropperSize / 2);
      const bx = px - (sRad + 0.5) * cellPx;
      const by = cy - (sRad + 0.5) * cellPx;
      const bw = st.eyedropperSize * cellPx;
      g.strokeStyle = "#000000";
      g.lineWidth = 2;
      g.strokeRect(bx, by, bw, bw);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1;
      g.strokeRect(bx + 1, by + 1, Math.max(1, bw - 2), Math.max(1, bw - 2));
      g.restore();

      // Dual-tone Photoshop comparison ring: top = sampled live colour, bottom = current FG
      g.lineWidth = 6;
      g.beginPath();
      g.arc(px, cy, rad - 2, Math.PI, 0);
      g.strokeStyle = liveHex;
      g.stroke();
      g.beginPath();
      g.arc(px, cy, rad - 2, 0, Math.PI);
      g.strokeStyle = st.fg;
      g.stroke();
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px, cy, rad + 1, 0, Math.PI * 2);
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.stroke();
      g.beginPath();
      g.arc(px, cy, rad - 5, 0, Math.PI * 2);
      g.strokeStyle = "rgba(255,255,255,0.75)";
      g.stroke();

      // Hex badge under the loupe
      const label = liveHex.toUpperCase();
      g.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      const tw = g.measureText(label).width;
      const pillY = cy + rad + 6;
      g.fillStyle = "rgba(21,20,15,0.9)";
      g.beginPath();
      g.roundRect(px - tw / 2 - 6, pillY, tw + 12, 18, 4);
      g.fill();
      g.fillStyle = "#faf9f5";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, px, pillY + 9);
      g.restore();
    }
    if (splitHandleRef.current && splitCompareRef.current && histRef.current && histRef.current.index > 0) {
      splitHandleRef.current.style.left = `${v.x + d.w * splitXRef.current * v.z}px`;
    }
  }

  useEffect(() => {
    if (!doc) return;
    let raf = 0;
    let phase = 0;
    let checker: CanvasPattern | null = null;
    const ro = new ResizeObserver(() => (dirty.current = true));
    if (wrapRef.current) ro.observe(wrapRef.current);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // Before/after: while comparing, draw the document as it was opened, with nothing live.
      const comparing = compareRef.current && !!histRef.current;
      const d = comparing ? histRef.current!.entries[0].doc : docRef.current;
      const c = mainRef.current;
      const o = overRef.current;
      const w = wrapRef.current;
      if (!d || !c || !o || !w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = w.clientWidth;
      const H = w.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = o.width = Math.round(W * dpr);
        c.height = o.height = Math.round(H * dpr);
        dirty.current = true;
      }
      const v = view.current;
      if (dirty.current) {
        dirty.current = false;
        const g = ctx2d(c);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, c.width, c.height);
        if (!checker) {
          const t = makeCanvas(16, 16);
          const tg = ctx2d(t);
          tg.fillStyle = tokens.current.checkB;
          tg.fillRect(0, 0, 16, 16);
          tg.fillStyle = tokens.current.checkA;
          tg.fillRect(0, 0, 8, 8);
          tg.fillRect(8, 8, 8, 8);
          checker = g.createPattern(t, "repeat");
        }
        const dx = v.x * dpr;
        const dy = v.y * dpr;
        const dw = d.w * v.z * dpr;
        const dh = d.h * v.z * dpr;
        g.save();
        g.beginPath();
        g.rect(dx, dy, dw, dh);
        g.clip();
        g.fillStyle = checker!;
        g.fillRect(dx, dy, dw, dh);
        g.restore();
        const rx = clamp(Math.floor(-v.x / v.z), 0, d.w);
        const ry = clamp(Math.floor(-v.y / v.z), 0, d.h);
        const rx1 = clamp(Math.ceil((W - v.x) / v.z), 0, d.w);
        const ry1 = clamp(Math.ceil((H - v.y) / v.z), 0, d.h);
        const splitComparing = !comparing && splitCompareRef.current && !!histRef.current && histRef.current.index > 0;
        if (rx1 > rx && ry1 > ry) {
          const s = Math.min(1, v.z * dpr);
          const comp = compose(d, { rect: { x: rx, y: ry, w: rx1 - rx, h: ry1 - ry }, scale: s, live: comparing || peekRef.current ? undefined : live.current });
          g.imageSmoothingEnabled = v.z * dpr < 2;
          g.imageSmoothingQuality = "high";
          const dstX = (v.x + rx * v.z) * dpr;
          const dstY = (v.y + ry * v.z) * dpr;
          const dstW = (rx1 - rx) * v.z * dpr;
          const dstH = (ry1 - ry) * v.z * dpr;
          if (splitComparing) {
            const origDoc = histRef.current!.entries[0].doc;
            const origComp = compose(origDoc, { rect: { x: rx, y: ry, w: rx1 - rx, h: ry1 - ry }, scale: s });
            const splitScreenPx = clamp(Math.round((v.x + d.w * splitXRef.current * v.z) * dpr), 0, c.width);
            g.save();
            g.beginPath();
            g.rect(0, 0, splitScreenPx, c.height);
            g.clip();
            g.drawImage(origComp, dstX, dstY, dstW, dstH);
            g.restore();
            g.save();
            g.beginPath();
            g.rect(splitScreenPx, 0, c.width - splitScreenPx, c.height);
            g.clip();
            g.drawImage(comp, dstX, dstY, dstW, dstH);
            g.restore();
          } else {
            g.drawImage(comp, dstX, dstY, dstW, dstH);
          }
          lastComp.current = { canvas: comp, rx, ry, s };
        }
      }
      if (comparing) {
        const og = ctx2d(o);
        og.setTransform(1, 0, 0, 1, 0, 0);
        og.clearRect(0, 0, o.width, o.height);
      } else drawOverlay(o, d, dpr, phase++);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // The loop reads everything through refs; it only restarts when a document opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!doc]);

  /* ----- Tools and settings ----- */

  const setBrush = (p: Partial<BrushSettings>) => setBrushState((b) => ({ ...b, ...p }));
  const setOpts = (p: Partial<ToolOpts>) => setOptsState((o) => ({ ...o, ...p }));

  /* ----- Free transform ----- */

  const beginTransform = () => {
    const d = docRef.current;
    if (!d) return;
    const l = activeLayer(d);
    if (l.kind === "adjustment") return say("Adjustment layers have nothing to transform. Pick a pixel, text or shape layer.");
    if (l.locked) return say("That layer is locked.");
    const box = layerBounds(l, true);
    setToolState("move");
    setTransform({ layerId: l.id, box, tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 });
  };
  const applyTransform = () => {
    const d = docRef.current;
    if (!d || !transform) return;
    const t = transform;
    setTransform(null);
    live.current = undefined;
    if (t.tx || t.ty || t.sx !== 1 || t.sy !== 1 || t.rot) commit(commitTransform(d, t), "Free Transform");
    else bump();
  };
  const cancelTransform = () => {
    setTransform(null);
    live.current = undefined;
    bump();
  };
  useEffect(() => {
    if (transform) live.current = { transform: { layerId: transform.layerId, matrix: transformMatrix(transform) } };
    else if (live.current?.transform) live.current = undefined;
    dirty.current = true;
  }, [transform]);

  const finishModes = (next: ToolId) => {
    if (transform && next !== "move") applyTransform();
    if (crop && next !== "crop") setCrop(null);
    if (poly) setPoly(null);
    if (pen && next !== "pen") finishPen();
  };
  const setTool = (t: ToolId) => {
    finishModes(t);
    setToolState(t);
    setCropAngle(0);
    const d = docRef.current;
    if (t === "crop" && d) setCrop({ x: 0, y: 0, w: d.w, h: d.h });
    if (t === "text") setPanel("properties");
    if (t === "node" && d) {
      // Start on the active vector layer's last path, so its points show straight away.
      const l = activeLayer(d);
      if (l.vector && nodeSel?.layerId !== l.id) setNodeSel({ layerId: l.id, path: Math.max(0, l.vector.paths.length - 1), sub: null, node: null });
    }
  };

  /* ----- Adjustments and filters ----- */

  const [previewTick, setPreviewTick] = useState(0);
  // A blank stand-in, the document's size, for the stamped layer a "whole image" preview inserts.
  const stampStandIn = useRef<HTMLCanvasElement | null>(null);
  const standIn = (d: Doc) => {
    const c = stampStandIn.current;
    if (c && c.width === d.w && c.height === d.h) return c;
    return (stampStandIn.current = makeCanvas(d.w, d.h));
  };

  const openOp = (op: Op) => {
    const d = docRef.current;
    if (!d) return;
    // Effects land where they'll show: the photo layer when it's active, otherwise the whole image
    // (never silently on a text, sticker, shape or empty layer).
    const target = defaultTarget(d);
    if (op.instant) {
      rememberEffect(op.id);
      setBusy(`${op.label}…`);
      nextFrame().then(() => {
        try {
          if (target === "image") {
            commit(applyOpToImage(d, op, defaults(op), { fg, bg }), op.label);
            say(op.layerable ? `${op.label} added as an adjustment layer on top: the whole image changes, nothing is lost.` : `${op.label} applied to the whole image, as a new layer on top.`);
          } else commit(applyOp(d, op, defaults(op), { fg, bg }), op.label);
        } finally {
          setBusy(null);
        }
      });
      return;
    }
    rememberEffect(op.id);
    setStyleEdit(false);
    setOpEdit({ op, params: defaults(op), asLayer: false, target, from: panel === "looks" ? "looks" : "adjust" });
    setPanel("properties");
    setSheetOpen(true);
  };

  // Live preview while settings change: a reduced copy with the operation applied.
  useEffect(() => {
    if (!opEdit || !doc) {
      peekRef.current = false;
      if (live.current?.replace || live.current?.insert) {
        live.current = undefined;
        dirty.current = true;
      }
      return;
    }
    const l = activeLayer(doc);
    const top = doc.layers[doc.layers.length - 1];
    const adjustmentPreview = (above: string) => {
      // A selection limits the adjustment, as it will once applied.
      const al = newLayer({ name: opEdit.op.label, kind: "adjustment", canvas: makeCanvas(1, 1), adjust: { id: opEdit.op.id, params: opEdit.params }, mask: doc.selection?.mask ?? null });
      return { insert: { layer: al, above } };
    };
    const t = setTimeout(() => {
      if (opEdit.target === "image") {
        if (opEdit.op.layerable) live.current = adjustmentPreview(top.id);
        else {
          const p = previewOpImage(doc, opEdit.op, opEdit.params, { fg, bg });
          const stamp = newLayer({ name: "preview", canvas: standIn(doc) });
          live.current = { insert: { layer: stamp, above: top.id }, replace: { layerId: stamp.id, canvas: p.canvas, scale: p.scale } };
        }
      } else if (opEdit.asLayer) live.current = adjustmentPreview(l.id);
      else if (l.kind === "smart" && l.smart && !doc.selection) {
        const p = previewSmartLayer(l, { op: opEdit.op, params: opEdit.params, filterId: opEdit.filterId, ctx: { fg, bg } });
        live.current = { replace: { layerId: l.id, canvas: p.canvas, scale: p.scale } };
      } else if (l.kind !== "adjustment") {
        const p = previewOp(doc, opEdit.op, opEdit.params, { fg, bg });
        live.current = { replace: { layerId: l.id, canvas: p.canvas, scale: p.scale } };
      } else live.current = undefined;
      dirty.current = true;
    }, 30);
    return () => clearTimeout(t);
    // previewTick: redraw the preview after a pinch or stroke replaced it.
  }, [opEdit, doc, fg, bg, previewTick]);

  // Curves and Levels draw the histogram of what they adjust.
  const opEditId = opEdit?.op.id;
  const opHist = useMemo(() => {
    if (!doc) return null;
    const l = activeLayer(doc);
    const op = opEditId ? (adjustmentById(opEditId) ?? null) : null;
    const needs = (op && op.params.some((p) => p.type === "curve" || p.type === "levels")) || (l.kind === "adjustment" && (l.adjust?.id === "curves" || l.adjust?.id === "levels"));
    if (!needs) return null;
    const src = l.kind === "adjustment" ? flatten(doc) : l.canvas;
    const k = Math.min(1, 400 / Math.max(src.width, src.height));
    const small = makeCanvas(src.width * k, src.height * k);
    ctx2d(small, true).drawImage(src, 0, 0, small.width, small.height);
    return histogram(ctx2d(small, true).getImageData(0, 0, small.width, small.height));
  }, [opEditId, doc]);

  const applyOpEdit = async () => {
    const d = docRef.current;
    if (!d || !opEdit) return;
    const { op, params, asLayer, target, filterId, layerId } = opEdit;
    setOpEdit(null);
    if (target === "layer" && asLayer) return commit(addAdjustmentLayer(d, op, params), `${op.label} layer`);
    setBusy(`Applying ${op.label}…`);
    await nextFrame();
    try {
      if (filterId && layerId) {
        commit(updateSmartFilter(d, layerId, filterId, { params }, { fg, bg }), `Edit Smart Filter: ${op.label}`);
      } else if (target === "image") {
        commit(applyOpToImage(d, op, params, { fg, bg }), op.label);
      } else {
        const activeL = activeLayer(d);
        if (activeL.kind === "smart" && !d.selection) {
          commit(applyOp(d, op, params, { fg, bg }), `Smart Filter: ${op.label}`);
          say("Added as a non-destructive Smart Filter. Toggle or edit it anytime in Layers or Properties.");
        } else {
          commit(applyOp(d, op, params, { fg, bg }), op.label);
        }
      }
    } catch (e) {
      say(`${op.label} couldn't be applied: ${(e as Error).message}`);
    } finally {
      live.current = undefined;
      setBusy(null);
    }
  };

  // Info: histogram of the whole picture, a moment after it changes.
  useEffect(() => {
    if (!doc || panel !== "info") return;
    const t = setTimeout(() => {
      const k = Math.min(1, 300 / Math.max(doc.w, doc.h));
      const c = compose(doc, { rect: { x: 0, y: 0, w: doc.w, h: doc.h }, scale: k });
      setDocHist(histogram(ctx2d(c, true).getImageData(0, 0, c.width, c.height)));
    }, 300);
    return () => clearTimeout(t);
  }, [doc, panel]);

  /* ----- Looks: live thumbnails of the active layer through each look ----- */

  // Thumbnails show the whole picture as you see it (a look applies to the whole image unless the
  // photo layer itself is picked), redrawn a moment after it changes.
  const lookDoc = doc && panel === "looks" ? doc : null;
  useEffect(() => {
    if (!lookDoc) return;
    let cancelled = false;
    const urls: Record<string, string> = {};
    let i = 0;
    let small: HTMLCanvasElement | null = null;
    let base: ImageData | null = null;
    let k = 1;
    // A few per frame, so the panel stays responsive while they fill in.
    const step = () => {
      if (cancelled) return;
      if (!small || !base) {
        k = Math.min(1, 120 / Math.max(lookDoc.w, lookDoc.h));
        small = compose(lookDoc, { rect: { x: 0, y: 0, w: lookDoc.w, h: lookDoc.h }, scale: k });
        base = ctx2d(small, true).getImageData(0, 0, small.width, small.height);
      }
      const sg = ctx2d(small, true);
      for (let n = 0; n < 4 && i < LOOK_OPS.length; n++, i++) {
        const op = LOOK_OPS[i];
        const img = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
        const res = op.apply(img, { amount: 100 }, { scale: k, fg, bg }) ?? img;
        sg.putImageData(res, 0, 0);
        urls[op.id] = small.toDataURL("image/jpeg", 0.8);
      }
      setLookThumbs((prev) => ({ src: null, urls: { ...prev.urls, ...urls } }));
      if (i < LOOK_OPS.length) requestAnimationFrame(() => setTimeout(step, 0));
    };
    const t = setTimeout(step, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // fg/bg only colour the Duotone look; thumbnails needn't redraw for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookDoc]);

  /* ----- AI: cut-outs from the existing background-removal service ----- */

  const cutout = async (src: HTMLCanvasElement): Promise<HTMLCanvasElement> => {
    // A reduced copy goes up (kind to the free server), the alpha comes back and is scaled up again.
    const k = Math.min(1, 2048 / Math.max(src.width, src.height));
    const small = makeCanvas(src.width * k, src.height * k);
    const sg = ctx2d(small);
    sg.fillStyle = "#fff";
    sg.fillRect(0, 0, small.width, small.height);
    sg.drawImage(src, 0, 0, small.width, small.height);
    const blob = await new Promise<Blob>((r, j) => small.toBlob((b) => (b ? r(b) : j(new Error("Couldn't prepare the picture."))), "image/jpeg", 0.92));
    const form = new FormData();
    form.append("files", blob, "picture.jpg");
    form.append("background", "transparent");
    form.append("color", "#ffffff");
    const res = await uploadForm(IMAGE_API("remove-background"), form, { fallbackName: "cutout.png" });
    if (res.type.includes("zip")) throw new Error("The service sent several files back.");
    const cut = await decodeImage(res.blob);
    const mask = makeCanvas(src.width, src.height);
    const mg = ctx2d(mask);
    mg.imageSmoothingQuality = "high";
    mg.drawImage(cut, 0, 0, mask.width, mask.height);
    mg.globalCompositeOperation = "source-in";
    mg.fillStyle = "#fff";
    mg.fillRect(0, 0, mask.width, mask.height);
    return mask;
  };
  const selectSubject = async () => {
    const d = docRef.current;
    if (!d) return;
    setBusy("Finding the subject…");
    try {
      const mask = await cutout(flatten(d));
      const sel = fromMask(mask);
      if (!sel) say("No clear subject found.");
      else commit({ ...d, selection: sel }, "Select Subject");
    } catch (e) {
      say(`Select subject needs our server: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const removeBackground = async () => {
    const d = docRef.current;
    if (!d) return;
    const l = activeLayer(d);
    if (l.kind === "adjustment") return say("Pick the photo's layer first.");
    setBusy("Removing the background…");
    try {
      const mask = await cutout(l.canvas);
      // As a layer mask, so nothing is lost: paint on the mask to fix edges.
      commit({ ...replaceLayer(d, l.id, { mask, maskOn: true }), editMask: false }, "Remove Background");
      say("Background hidden with a layer mask. Paint the mask white to bring parts back.");
    } catch (e) {
      say(`Remove background needs our server: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  /* ----- Selection-based edits ----- */

  const contentAwareFill = async () => {
    const d = docRef.current;
    if (!d?.selection) return say("Select the area to fill first.");
    const l = activeLayer(d);
    if (l.kind === "smart") return setSmartPrompt(l.id);
    if (l.kind === "adjustment") return say("Pick a pixel layer.");
    setBusy("Filling from the surroundings…");
    try {
      const grown = coverDoc(l, d);
      const out = await inpaint(grown.canvas, selectionInLayer(d.selection, grown));
      commit(replaceLayer(d, l.id, { ...grown, canvas: out, text: undefined, shape: undefined, vector: undefined, kind: "pixel" }), "Content-Aware Fill");
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doFill = (what: FillChoice, color: string, opacity: number) => {
    setDialog(null);
    const d = docRef.current;
    if (!d) return;
    if (what === "content") return void contentAwareFill();
    const l = activeLayer(d);
    if (l.kind === "smart" && !d.editMask) return setSmartPrompt(l.id);
    const c = what === "fg" ? fg : what === "bg" ? bg : what === "black" ? "#000000" : what === "white" ? "#ffffff" : what === "gray" ? "#808080" : color;
    commit(fillSelection(d, c, opacity), "Fill");
  };

  const copy = async (merged: boolean, cut = false) => {
    const d = docRef.current;
    if (!d) return;
    const l = activeLayer(d);
    const area = d.selection?.bounds ?? { x: 0, y: 0, w: d.w, h: d.h };
    const src = merged ? flatten(d) : makeCanvas(d.w, d.h);
    if (!merged) ctx2d(src).drawImage(l.canvas, l.x, l.y);
    const c = makeCanvas(area.w, area.h);
    const g = ctx2d(c);
    g.drawImage(src, -area.x, -area.y);
    if (d.selection) {
      g.globalCompositeOperation = "destination-in";
      g.drawImage(d.selection.mask, -area.x, -area.y);
    }
    clipboard.current = { canvas: c, x: area.x, y: area.y };
    setHasClip(true);
    if (cut && !merged && d.selection) commit(clearSelection(d), "Cut");
    try {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      // The system clipboard can refuse; the copy still works inside the editor.
    }
    say(cut ? "Cut." : merged ? "Copied what you see." : "Copied.");
  };

  /* ----- Pointer input ----- */

  const selectModeFor = (e: { shiftKey: boolean; altKey: boolean }): SelectMode => (e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : opts.selectMode);

  const canPaint = (l: Layer, d: Doc, t: ToolId) => {
    if (l.locked) return (say("That layer is locked. Unlock it in the Layers panel."), false);
    if (l.kind === "adjustment" && !(d.editMask && l.mask)) return (say("Adjustment layers have no pixels. Paint on its mask, or pick a pixel layer."), false);
    if (d.editMask && l.mask && (PIXEL_TOOLS.includes(t) || t === "spot-heal" || t === "red-eye")) return (say("That tool works on pixels: click the layer's picture thumbnail to leave the mask."), false);
    if (l.kind === "smart" && !(d.editMask && l.mask)) return (setSmartPrompt(l.id), false);
    if (!l.visible) say("That layer is hidden: you're painting on it anyway.");
    if (l.kind === "text" || l.kind === "shape" || l.kind === "vector") say(`“${l.name}” became pixels so it can be painted.`);
    return true;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = docRef.current;
    if (!d || busy) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Two fingers: pinch to zoom and pan, whatever the tool (an unfinished stroke is dropped).
    if (pointers.current.size === 2) {
      // Whatever the first finger started is dropped: a stroke, a layer or path being dragged, a
      // shape being drawn, a pen point. Only a free transform in progress keeps its preview.
      const was = drag.current?.type;
      stroke.current = null;
      if (was === "pen") setPen((pts) => (pts ? pts.slice(0, -1) : pts));
      if (was && ["stroke", "move", "shape", "vnode", "vpath", "gradient", "marquee", "lasso"].includes(was)) {
        live.current = transform ? { transform: { layerId: transform.layerId, matrix: transformMatrix(transform) } } : undefined;
        if (opEdit) setPreviewTick((t) => t + 1);
      }
      const [a, b] = [...pointers.current.values()];
      const r = el.getBoundingClientRect();
      drag.current = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: view.current.z, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, vx: view.current.x, vy: view.current.y };
      bump();
      return;
    }
    const p = toDoc(e);
    const l = activeLayer(d);
    if (e.button === 1 || space.current || tool === "hand") {
      drag.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y };
      return;
    }
    if (e.button === 2) return;

    // An active free transform takes the pointer whatever the tool.
    if (transform) {
      const handle = transformHit(e);
      if (handle) {
        drag.current = { type: "transform", handle, start: p, orig: transform };
        return;
      }
    }

    switch (tool) {
      case "zoom": {
        const r = el.getBoundingClientRect();
        zoomAt(e.altKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top);
        return;
      }
      case "move": {
        let target = l;
        if (opts.autoSelect || e.ctrlKey || e.metaKey) {
          const hit = [...d.layers].reverse().find((x) => {
            if (!x.visible || x.kind === "adjustment") return false;
            const lx = Math.floor(p.x - x.x);
            const ly = Math.floor(p.y - x.y);
            if (lx < 0 || ly < 0 || lx >= x.canvas.width || ly >= x.canvas.height) return false;
            return ctx2d(x.canvas, true).getImageData(lx, ly, 1, 1).data[3] > 10;
          });
          if (hit && hit.id !== d.active) {
            commit({ ...d, active: hit.id, editMask: false }, "Select Layer", "select");
            target = hit;
          }
        }
        // The background (the bottom layer filling the canvas) stays put, as in Photoshop: dragging
        // it moves the view instead, so a one-finger drag on a photo never shoves the whole picture.
        const backdrop = target === d.layers[0] && target.kind === "pixel" && target.x <= 0 && target.y <= 0 && target.x + target.canvas.width >= d.w && target.y + target.canvas.height >= d.h;
        if (backdrop || target.locked || target.kind === "adjustment") {
          drag.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y };
          if (!pannedHint.current) {
            pannedHint.current = true;
            say(target.locked ? "That layer is locked, so dragging moves the view." : target.kind === "adjustment" ? "Adjustment layers have nothing to move, so dragging moves the view." : "The background stays in place, so dragging moves the view. To move it anyway, use Free transform (Shift+T).");
          }
          return;
        }
        drag.current = { type: "move", start: p, layerId: target.id, dx: 0, dy: 0 };
        return;
      }
      case "pen": {
        const pts = pen ?? [];
        if (pts.length >= 2) {
          const first = toScreen(pts[0]);
          const s = screenOf(e);
          if (Math.hypot(first.x - s.x, first.y - s.y) < (e.pointerType === "touch" ? 22 : 12)) return finishPen(true);
        }
        setPen([...pts, { x: p.x, y: p.y, i: null, o: null }]);
        drag.current = { type: "pen", idx: pts.length, start: p };
        return;
      }
      case "node": {
        const tol = (e.pointerType === "touch" ? 22 : 10) / view.current.z;
        // 1. A point or handle of the path being edited (points win over handles sitting on them).
        const ns = nodeSel;
        const nl = ns && d.layers.find((x) => x.id === ns.layerId);
        if (ns && nl?.vector && nl.visible) {
          const paths = layerPaths(nl);
          const path = paths[ns.path];
          let hit: { sub: number; node: number; part: "node" | "i" | "o" } | null = null;
          if (path)
            outer: for (const part of ["node", "i", "o"] as const)
              for (let si = 0; si < path.subs.length; si++)
                for (let k = 0; k < path.subs[si].nodes.length; k++) {
                  const n = path.subs[si].nodes[k];
                  const q = part === "node" ? n : n[part];
                  if (q && Math.hypot(q.x - p.x, q.y - p.y) < tol) {
                    hit = { sub: si, node: k, part };
                    break outer;
                  }
                }
          const h = hit as { sub: number; node: number; part: "node" | "i" | "o" } | null;
          if (h && path) {
            if (nl.locked) return say("That layer is locked.");
            if (e.altKey && h.part === "node") {
              const next = paths.map((q, pi) => (pi !== ns.path ? q : { ...q, subs: q.subs.map((s, si) => (si === h.sub ? toggleSmooth(s, h.node) : s)) }));
              commit(replaceLayer(d, nl.id, withPaths(nl, next)), "Convert Point");
              setNodeSel({ ...ns, sub: h.sub, node: h.node });
              return;
            }
            setNodeSel({ ...ns, sub: h.sub, node: h.node });
            drag.current = { type: "vnode", layerId: nl.id, path: ns.path, sub: h.sub, node: h.node, part: h.part, start: p, base: paths, alt: e.altKey, next: null };
            return;
          }
        }
        // 2. Any path on a visible vector layer, top first: select it and drag to move it.
        for (const vl of [...d.layers].reverse()) {
          if (!vl.visible || !vl.vector) continue;
          const paths = layerPaths(vl);
          const pi = hitPath(paths, p, tol);
          if (pi < 0) continue;
          if (vl.id !== d.active) commit({ ...d, active: vl.id, editMask: false }, "Select Layer", "select");
          setNodeSel({ layerId: vl.id, path: pi, sub: null, node: null });
          setPanel("properties");
          if (vl.locked) return say("That layer is locked.");
          drag.current = { type: "vpath", layerId: vl.id, path: pi, start: p, base: paths, next: null };
          return;
        }
        if (!d.layers.some((x) => x.vector)) say("No paths yet: draw one with the Pen (P), or turn a shape into a path from its properties.");
        setNodeSel(null);
        return;
      }
      case "marquee-rect":
      case "marquee-ellipse":
      case "lasso": {
        const mode = selectModeFor(e);
        if (mode === "new" && d.selection && insideSelection(d, p) && !e.shiftKey && !e.altKey) {
          drag.current = { type: "selmove", start: p, dx: 0, dy: 0 };
          return;
        }
        if (tool === "lasso") drag.current = { type: "lasso", pts: [p], mode };
        else drag.current = { type: "marquee", a: p, b: p, mode, ellipse: tool === "marquee-ellipse" };
        return;
      }
      case "lasso-poly": {
        const pts = poly?.pts ?? [];
        if (pts.length >= 3) {
          const first = toScreen(pts[0]);
          const r = el.getBoundingClientRect();
          if (Math.hypot(first.x - (e.clientX - r.left), first.y - (e.clientY - r.top)) < (e.pointerType === "touch" ? 22 : 10)) return closePoly();
        }
        setPoly({ pts: [...pts, p], mode: poly?.mode ?? selectModeFor(e) });
        return;
      }
      case "wand": {
        const src = opts.sampleAll ? flatten(d) : compose(d, { rect: { x: 0, y: 0, w: d.w, h: d.h }, scale: 1, only: (x) => x.id === l.id });
        const img = ctx2d(src, true).getImageData(0, 0, d.w, d.h);
        const mask = wandMask(img, Math.floor(p.x), Math.floor(p.y), opts.wandTol, opts.contiguous);
        commit({ ...d, selection: combine(d.selection, mask, selectModeFor(e)) }, "Magic Wand");
        return;
      }
      case "crop": {
        const r = crop ?? { x: 0, y: 0, w: d.w, h: d.h };
        drag.current = { type: "crop", handle: cropHit(e, r) ?? "new", start: p, orig: r };
        return;
      }
      case "eyedropper": {
        drag.current = { type: "pick", bg: e.altKey };
        const c = sampleAt(p);
        if (c) (e.altKey ? setBg : setFg)(c);
        return;
      }
      case "red-eye": {
        if (!canPaint(l, d, tool)) return;
        commit(replaceLayer(d, l.id, redEye(coverDoc(l, d), p, brush.size)), "Red Eye");
        return;
      }
      case "bucket": {
        if (!canPaint(l, d, tool)) return;
        if (d.editMask) return say("The bucket fills pixels; leave the mask first.");
        commit(replaceLayer(d, l.id, bucketFill(l, d, p, fg, opts.bucketTol, opts.contiguous, wandMask, brush.opacity / 100)), "Paint Bucket");
        return;
      }
      case "gradient": {
        if (!canPaint(l, d, tool)) return;
        drag.current = { type: "gradient", a: p, b: p };
        return;
      }
      case "text": {
        const hit = [...d.layers].reverse().find((x) => x.kind === "text" && x.visible && p.x >= x.x && p.y >= x.y && p.x <= x.x + x.canvas.width && p.y <= x.y + x.canvas.height);
        if (hit) {
          commit({ ...d, active: hit.id, editMask: false }, "Select Layer", "select");
          setPanel("properties");
          requestAnimationFrame(() => textRef.current?.focus());
          return;
        }
        const meta: TextMeta = { ...opts.text, color: opts.text.color, text: "Your text" };
        const layer = newLayer({ name: "Your text", kind: "text", text: meta, canvas: renderText(meta), x: Math.round(p.x), y: Math.round(p.y - meta.size * 0.6) });
        commit(insertAbove(d, layer), "New Text", `text:${layer.id}`);
        setPanel("properties");
        requestAnimationFrame(() => {
          textRef.current?.focus();
          textRef.current?.select();
        });
        // Draw again once the font has arrived (the first draw may use a fallback).
        ensureFont(meta).then(() => {
          const cur = docRef.current;
          const now = cur?.layers.find((x) => x.id === layer.id);
          if (cur && now?.text) commit(replaceLayer(cur, layer.id, { canvas: renderText(now.text) }), "New Text", `text:${layer.id}`);
        });
        return;
      }
      case "shape": {
        drag.current = { type: "shape", a: p, b: p };
        return;
      }
    }

    // Brushes.
    if (BUFFER_TOOLS.includes(tool) || PIXEL_TOOLS.includes(tool)) {
      if (e.altKey && (tool === "clone" || tool === "heal")) {
        setCloneSrc(p);
        say("Source set. Now paint where it should go.");
        return;
      }
      if (e.altKey && (tool === "brush" || tool === "pencil")) {
        const c = sampleAt(p);
        if (c) setFg(c);
        return;
      }
      if (!canPaint(l, d, tool)) return;
      if ((tool === "clone" || tool === "heal") && !cloneSrc) return say("Alt-click (Option-click) a spot to copy from first.");
      const s = beginStroke(d, l, tool, brush, fg, bg, { cloneSource: cloneSrc, flat: (tool === "clone" || tool === "heal") && brush.sampleAll ? flatten(d) : null, at: p });
      stroke.current = s;
      drag.current = { type: "stroke" };
      if (e.shiftKey && lastPaint.current) strokeTo(s, lastPaint.current);
      strokeTo(s, p, e.pointerType === "pen" ? e.pressure : 1);
      live.current = liveFor(s);
      bump();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = docRef.current;
    if (!d) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toDoc(e);
    hover.current = p;
    const dr = drag.current;
    if (!dr) {
      // Info readout, throttled by React batching.
      if (panel === "info") setCursor({ x: Math.floor(p.x), y: Math.floor(p.y), hex: peekAt(p) });
      return;
    }
    switch (dr.type) {
      case "pinch": {
        const pts = [...pointers.current.values()];
        if (pts.length < 2) return;
        const r = e.currentTarget.getBoundingClientRect();
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
        const z = clamp((dr.z0 * dist) / Math.max(1, dr.d0), 0.02, 64);
        // Keep the point under the fingers where it was, then follow the fingers' movement.
        const docX = (dr.mid.x - dr.vx) / dr.z0;
        const docY = (dr.mid.y - dr.vy) / dr.z0;
        setView({ z, x: mid.x - docX * z, y: mid.y - docY * z });
        setZoom(view.current.z);
        return;
      }
      case "pan":
        setView({ ...view.current, x: dr.vx + e.clientX - dr.sx, y: dr.vy + e.clientY - dr.sy });
        return;
      case "stroke": {
        const s = stroke.current;
        if (!s) return;
        const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[];
        for (const ev of evs.length ? evs : [e.nativeEvent]) strokeTo(s, toDoc(ev), ev.pointerType === "pen" ? ev.pressure : 1);
        bump();
        return;
      }
      case "move": {
        let dx = p.x - dr.start.x;
        let dy = p.y - dr.start.y;
        if (e.shiftKey) {
          // Shift keeps the move straight: along whichever axis moved more.
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        dr.dx = Math.round(dx);
        dr.dy = Math.round(dy);
        live.current = { transform: { layerId: dr.layerId, matrix: new DOMMatrix().translate(dr.dx, dr.dy) } };
        bump();
        return;
      }
      case "selmove":
        dr.dx = Math.round(p.x - dr.start.x);
        dr.dy = Math.round(p.y - dr.start.y);
        return;
      case "marquee": {
        let b = p;
        if (e.shiftKey && dr.mode !== "add") {
          const s = Math.max(Math.abs(p.x - dr.a.x), Math.abs(p.y - dr.a.y));
          b = { x: dr.a.x + s * Math.sign(p.x - dr.a.x || 1), y: dr.a.y + s * Math.sign(p.y - dr.a.y || 1) };
        }
        dr.b = b;
        return;
      }
      case "lasso": {
        const last = dr.pts[dr.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * view.current.z > 2) dr.pts.push(p);
        return;
      }
      case "gradient": {
        dr.b = p;
        return;
      }
      case "shape": {
        let b = p;
        if (e.shiftKey) {
          const s = Math.max(Math.abs(p.x - dr.a.x), Math.abs(p.y - dr.a.y));
          b = { x: dr.a.x + s * Math.sign(p.x - dr.a.x || 1), y: dr.a.y + s * Math.sign(p.y - dr.a.y || 1) };
        }
        dr.b = b;
        const meta = shapeFor(dr.a, b);
        if (meta) {
          const r = normRect(dr.a, b);
          const pad = shapePad(meta);
          const pl = newLayer({ name: "shape", kind: "shape", shape: meta, canvas: renderShape(meta), x: Math.round(r.x - pad), y: Math.round(r.y - pad) });
          live.current = { insert: { layer: pl, above: d.active } };
          bump();
        }
        return;
      }
      case "crop": {
        setCrop(cropDrag(dr, p, d, e.shiftKey));
        return;
      }
      case "transform": {
        setTransform(transformDrag(dr, p, e.shiftKey));
        return;
      }
      case "pick": {
        const c = sampleAt(p);
        if (c) (dr.bg ? setBg : setFg)(c);
        return;
      }
      case "pen": {
        // Dragging from a new point pulls out symmetric handles: a smooth curve through it.
        if (Math.hypot(p.x - dr.start.x, p.y - dr.start.y) * view.current.z < 3) return;
        setPen((pts) => pts && pts.map((n, k) => (k === dr.idx ? { ...n, o: { x: p.x, y: p.y }, i: { x: 2 * n.x - p.x, y: 2 * n.y - p.y } } : n)));
        return;
      }
      case "vnode":
      case "vpath": {
        let dx = p.x - dr.start.x;
        let dy = p.y - dr.start.y;
        if (!dr.next && Math.hypot(dx, dy) * view.current.z < 2) return;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const l = d.layers.find((x) => x.id === dr.layerId);
        if (!l) return;
        const shift = (q: Pt) => ({ x: q.x + dx, y: q.y + dy });
        let next: VPath[];
        if (dr.type === "vpath") {
          next = dr.base.map((q, pi) => (pi !== dr.path ? q : { ...q, subs: q.subs.map((s) => ({ ...s, nodes: s.nodes.map((n) => ({ ...shift(n), i: n.i && shift(n.i), o: n.o && shift(n.o) })) })) }));
        } else {
          const move = (n: VNode): VNode => {
            if (dr.part === "node") return { ...shift(n), i: n.i && shift(n.i), o: n.o && shift(n.o) };
            const own = dr.part === "i" ? n.i! : n.o!;
            const moved = shift(own);
            const other = dr.part === "i" ? n.o : n.i;
            // A smooth point keeps its handles in line (Alt breaks them apart).
            let mirrored = other;
            if (other && !dr.alt) {
              const len = Math.hypot(other.x - n.x, other.y - n.y);
              const vx = n.x - moved.x;
              const vy = n.y - moved.y;
              const vl = Math.hypot(vx, vy) || 1;
              mirrored = { x: n.x + (vx / vl) * len, y: n.y + (vy / vl) * len };
            }
            return dr.part === "i" ? { ...n, i: moved, o: mirrored } : { ...n, o: moved, i: mirrored };
          };
          next = dr.base.map((q, pi) => (pi !== dr.path ? q : { ...q, subs: q.subs.map((s, si) => (si !== dr.sub ? s : { ...s, nodes: s.nodes.map((n, k) => (k === dr.node ? move(n) : n)) })) }));
        }
        dr.next = next;
        live.current = { swap: withPaths(l, next) };
        bump();
        return;
      }
    }
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    const d = docRef.current;
    const dr = drag.current;
    drag.current = null;
    if (!d || !dr) return;
    switch (dr.type) {
      case "pinch":
      case "pan":
        setZoom(view.current.z);
        return;
      case "stroke": {
        const s = stroke.current;
        stroke.current = null;
        if (!s) return;
        lastPaint.current = s.last ? { x: s.last.x + s.layer.x, y: s.last.y + s.layer.y } : null;
        if (s.tool === "spot-heal") {
          setBusy("Healing…");
          try {
            let mask = s.buffer!;
            if (s.clip) {
              mask = makeCanvas(mask.width, mask.height);
              const mg = ctx2d(mask);
              mg.drawImage(s.buffer!, 0, 0);
              mg.globalCompositeOperation = "destination-in";
              mg.drawImage(s.clip, 0, 0);
            }
            const out = await inpaint(s.layer.canvas, mask);
            live.current = undefined;
            commit(replaceLayer(d, s.layer.id, { ...s.layer, canvas: out, text: undefined, shape: undefined, vector: undefined, kind: "pixel" }), "Spot Healing Brush");
          } catch (err) {
            live.current = undefined;
            say((err as Error).message);
          } finally {
            setBusy(null);
          }
          return;
        }
        const layer = endStroke(s);
        live.current = undefined;
        commit(replaceLayer(d, layer.id, layer), TOOLS[s.tool].label);
        return;
      }
      case "move":
        live.current = undefined;
        if (dr.dx || dr.dy) {
          const l = d.layers.find((x) => x.id === dr.layerId)!;
          commit(replaceLayer(d, l.id, moveSmartLayer(l, dr.dx, dr.dy)), "Move");
        } else bump();
        return;
      case "selmove": {
        if (!d.selection || (!dr.dx && !dr.dy)) return;
        const c = makeCanvas(d.w, d.h);
        ctx2d(c).drawImage(d.selection.mask, dr.dx, dr.dy);
        commit({ ...d, selection: fromMask(c) }, "Move Selection");
        return;
      }
      case "marquee": {
        const r = normRect(dr.a, dr.b);
        if (r.w * view.current.z < 3 && r.h * view.current.z < 3) {
          if (dr.mode === "new" && d.selection) commit({ ...d, selection: null }, "Deselect");
          return;
        }
        const mask = shapeMask(d, dr.ellipse ? ellipsePath(r) : rectPath(r), opts.feather);
        commit({ ...d, selection: combine(d.selection, mask, dr.mode) }, dr.ellipse ? "Elliptical Marquee" : "Rectangular Marquee");
        return;
      }
      case "lasso": {
        if (dr.pts.length < 3) {
          if (dr.mode === "new" && d.selection) commit({ ...d, selection: null }, "Deselect");
          return;
        }
        const mask = shapeMask(d, polyPath(dr.pts), opts.feather);
        commit({ ...d, selection: combine(d.selection, mask, dr.mode) }, "Lasso");
        return;
      }
      case "gradient": {
        if (Math.hypot(dr.b.x - dr.a.x, dr.b.y - dr.a.y) * view.current.z < 3) return;
        const l = activeLayer(d);
        setBusy("Drawing the gradient…");
        await nextFrame();
        commit(replaceLayer(d, l.id, gradientFill(l, d, dr.a, dr.b, opts.gradKind, gradStops(opts.gradPreset, fg, bg), brush.opacity / 100, opts.gradReverse)), "Gradient");
        setBusy(null);
        return;
      }
      case "vnode":
      case "vpath": {
        live.current = undefined;
        const l = d.layers.find((x) => x.id === dr.layerId);
        if (!dr.next || !l) return bump();
        commit(replaceLayer(d, l.id, withPaths(l, dr.next)), dr.type === "vpath" ? "Move Path" : dr.part === "node" ? "Move Point" : "Edit Curve");
        return;
      }
      case "shape": {
        live.current = undefined;
        const meta = shapeFor(dr.a, dr.b);
        if (!meta) return bump();
        const r = normRect(dr.a, dr.b);
        const pad = shapePad(meta);
        const layer = newLayer({ name: freshName(d, ({ rect: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow", polygon: "Polygon", star: "Star" } as const)[meta.kind]), kind: "shape", shape: meta, canvas: renderShape(meta), x: Math.round(r.x - pad), y: Math.round(r.y - pad) });
        commit(insertAbove(d, layer), "New Shape");
        setPanel("properties");
        return;
      }
    }
  };

  const insideSelection = (d: Doc, p: Pt) => {
    const s = d.selection;
    if (!s || p.x < 0 || p.y < 0 || p.x >= d.w || p.y >= d.h) return false;
    return ctx2d(s.mask, true).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 127;
  };

  function shapeFor(a: Pt, b: Pt): ShapeMeta | null {
    const w = b.x - a.x;
    const h = b.y - a.y;
    if (Math.abs(w) < 2 && Math.abs(h) < 2) return null;
    const line = opts.shape === "line" || opts.shape === "arrow";
    return {
      kind: opts.shape,
      w: line ? w : Math.abs(w),
      h: line ? h : Math.abs(h),
      fill: line ? null : opts.shapeFill,
      stroke: line ? (opts.shapeStroke ?? opts.shapeFill ?? fg) : opts.shapeStroke,
      strokeWidth: opts.shapeStrokeW,
      radius: opts.shapeRadius,
      sides: opts.shapeSides,
    };
  }

  const closePoly = () => {
    const d = docRef.current;
    if (!d || !poly || poly.pts.length < 3) return setPoly(null);
    const mask = shapeMask(d, polyPath(poly.pts), opts.feather);
    commit({ ...d, selection: combine(d.selection, mask, poly.mode) }, "Polygonal Lasso");
    setPoly(null);
  };

  /* ----- Vector paths ----- */

  /** Ends the pen's path: added to the active vector layer, or as a new vector layer. */
  function finishPen(close = false) {
    const d = docRef.current;
    const raw = pen;
    setPen(null);
    if (!d || !raw) return;
    // A double-click lands two extra clicks on the same spot: drop the repeats.
    const pts = raw.filter((n, k) => k === 0 || Math.hypot(n.x - raw[k - 1].x, n.y - raw[k - 1].y) * view.current.z > 2 || n.o);
    if (pts.length < 2) return bump();
    const path = newPath([{ nodes: pts, closed: close }], { fill: opts.vecFill, stroke: opts.vecStroke, width: opts.vecStroke ? opts.vecWidth : 0 });
    if (!path.fill && !path.stroke) {
      path.stroke = fg;
      path.width = opts.vecWidth;
    }
    const a = activeLayer(d);
    if (a.vector && !a.locked && a.visible) {
      const paths = [...layerPaths(a), path];
      commit(replaceLayer(d, a.id, withPaths(a, paths)), close ? "Pen: Closed Path" : "Pen: Path");
      setNodeSel({ layerId: a.id, path: paths.length - 1, sub: null, node: null });
    } else {
      const vl = withPaths(newLayer({ name: freshName(d, "Vector"), kind: "vector", canvas: makeCanvas(1, 1) }), [path]);
      commit(insertAbove(d, vl), close ? "Pen: Closed Path" : "Pen: Path");
      setNodeSel({ layerId: vl.id, path: 0, sub: null, node: null });
    }
    setPanel("properties");
  }

  /** Direct selection: a double-click on the selected path's line adds a point there. */
  const addPointAt = (e: { clientX: number; clientY: number }) => {
    const d = docRef.current;
    const ns = nodeSel;
    const l = ns && d?.layers.find((x) => x.id === ns.layerId);
    if (!d || !ns || !l?.vector || l.locked) return;
    const paths = layerPaths(l);
    const path = paths[ns.path];
    if (!path) return;
    const near = nearestOnPath(path, toDoc(e));
    if (!near || near.d * view.current.z > 12) return;
    const next = paths.map((q, pi) => (pi !== ns.path ? q : { ...q, subs: q.subs.map((s, si) => (si === near.sub ? splitSegment(s, near.seg, near.t) : s)) }));
    commit(replaceLayer(d, l.id, withPaths(l, next)), "Add Point");
    setNodeSel({ ...ns, sub: near.sub, node: near.seg + 1 });
  };

  /** Delete with the Direct selection tool: the picked point, or the whole path. */
  const deleteVector = () => {
    const d = docRef.current;
    const ns = nodeSel;
    const l = ns && d?.layers.find((x) => x.id === ns.layerId);
    if (!d || !ns || !l?.vector) return false;
    if (l.locked) return (say("That layer is locked."), true);
    const paths = layerPaths(l);
    if (!paths[ns.path]) return false;
    let next: VPath[];
    if (ns.sub !== null && ns.node !== null) {
      const p = deleteNode(paths[ns.path], ns.sub, ns.node);
      next = p ? paths.map((q, i) => (i === ns.path ? p : q)) : paths.filter((_, i) => i !== ns.path);
      setNodeSel(p ? { ...ns, node: null } : null);
    } else {
      next = paths.filter((_, i) => i !== ns.path);
      setNodeSel(null);
    }
    if (!next.length) commit({ ...d, layers: d.layers.filter((x) => x.id !== l.id), active: d.layers.find((x) => x.id !== l.id)?.id ?? d.active }, "Delete Path");
    else commit(replaceLayer(d, l.id, withPaths(l, next)), ns.node !== null ? "Delete Point" : "Delete Path");
    return true;
  };

  /** Shape layer → vector layer with the same geometry, ready for point editing. */
  const shapeToVector = () => {
    const d = docRef.current;
    const l = d && activeLayer(d);
    if (!d || !l?.shape) return;
    const paths = shapeToPaths(l);
    commit(replaceLayer(d, l.id, withPaths({ ...l, shape: undefined }, paths)), "Convert to Path");
    setToolState("node");
    setNodeSel({ layerId: l.id, path: 0, sub: null, node: null });
    say("It's a path now: drag its points, or Alt-click one to switch between smooth and corner.");
  };

  const isSvg = (f: File) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name);

  /** An SVG becomes editable paths: a new document, or (`place`) a vector layer fitted into this one. */
  const openSvg = async (f: File, place: boolean) => {
    const res = await importSvg(await f.text());
    if (!res.paths.length) throw new Error("No shapes in that SVG could be turned into paths.");
    const name = f.name.replace(/\.[^.]+$/, "") || "Vector";
    const d = docRef.current;
    if (place && d) {
      const k = Math.min(1, (d.w * 0.8) / res.w, (d.h * 0.8) / res.h);
      const m = new DOMMatrix().translate((d.w - res.w * k) / 2, (d.h - res.h * k) / 2).scale(k);
      const vl = withPaths(newLayer({ name: freshName(d, name), kind: "vector", canvas: makeCanvas(1, 1) }), transformPathsFor(res.paths, m));
      commit(insertAbove(d, vl), "Place SVG");
      say(`Placed as ${res.paths.length} editable path${res.paths.length === 1 ? "" : "s"}. Use Direct selection (A) to reshape them.${res.notes.length ? " " + res.notes.join(" ") : ""}`);
      return;
    }
    const vl = withPaths(newLayer({ name, kind: "vector", canvas: makeCanvas(1, 1) }), res.paths);
    const layers: Layer[] = [vl];
    if (res.notes.length) {
      // Keep the original drawing too (hidden), so nothing the paths couldn't carry is lost.
      try {
        const pic = await decodeImage(f);
        const c = makeCanvas(res.w, res.h);
        ctx2d(c).drawImage(pic, 0, 0, res.w, res.h);
        layers.unshift(newLayer({ name: "Original SVG (picture)", canvas: c, visible: false }));
      } catch {
        // The browser couldn't draw it as a picture either; the paths are what there is.
      }
    }
    start({ w: res.w, h: res.h, layers, active: vl.id, selection: null, editMask: false, name });
    setToolState("node");
    setNodeSel({ layerId: vl.id, path: 0, sub: null, node: null });
    setTimeout(() => say(`Opened as ${res.paths.length} editable path${res.paths.length === 1 ? "" : "s"}.${res.notes.length ? " " + res.notes.join(" ") + " The original picture is kept as a hidden layer." : " Pick one with Direct selection (A)."}`), 50);
  };

  const fontName = (family: string) => {
    const f = fontsList.find((x) => x.family === family) ?? FONTS.find((x) => x.family === family);
    if (!f) return family;
    const label = f.label.replace(/\s*\(.*\)$/, "");
    const generic = /mono|courier/i.test(label) ? "monospace" : /serif|georgia|times/i.test(label) && !/sans/i.test(label) ? "serif" : "sans-serif";
    return `'${label}', ${generic}`;
  };
  const saveSvg = () => {
    const d = docRef.current;
    if (!d) return;
    try {
      const { svg, notes } = docToSvg(d, fontName);
      download(new Blob([svg], { type: "image/svg+xml" }), `${d.name || "image"}.svg`);
      say(notes.length ? `Saved as SVG. ${notes.join(" ")}` : "Saved as SVG: paths, shapes and text stay editable.");
    } catch (e) {
      say(`Couldn't write the SVG: ${(e as Error).message}`);
    }
  };

  /* ----- Crop and transform maths ----- */

  const screenOf = (e: { clientX: number; clientY: number }) => {
    const r = overRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function cropHit(e: { clientX: number; clientY: number; pointerType?: string }, r: Rect): string | null {
    const s = screenOf(e);
    const tol = e.pointerType === "touch" ? 22 : 10;
    for (const h of HANDLES) {
      const [hx, hy] = HANDLE_POS[h];
      const p = toScreen({ x: r.x + ((hx + 1) / 2) * r.w, y: r.y + ((hy + 1) / 2) * r.h });
      if (Math.abs(p.x - s.x) < tol && Math.abs(p.y - s.y) < tol) return h;
    }
    const a = toScreen({ x: r.x, y: r.y });
    const b = toScreen({ x: r.x + r.w, y: r.y + r.h });
    return s.x > a.x && s.x < b.x && s.y > a.y && s.y < b.y ? "move" : null;
  }
  function cropDrag(dr: Extract<Drag, { type: "crop" }>, p: Pt, d: Doc, shift: boolean): Rect {
    const o = dr.orig;
    const ratio = opts.cropRatio === -1 ? d.w / d.h : opts.cropRatio || (shift ? o.w / o.h : 0);
    if (dr.handle === "move") {
      return { ...o, x: clamp(o.x + p.x - dr.start.x, 0, d.w - o.w), y: clamp(o.y + p.y - dr.start.y, 0, d.h - o.h) };
    }
    let x0 = o.x;
    let y0 = o.y;
    let x1 = o.x + o.w;
    let y1 = o.y + o.h;
    if (dr.handle === "new") {
      x0 = dr.start.x;
      y0 = dr.start.y;
      x1 = p.x;
      y1 = p.y;
    } else {
      const [hx, hy] = HANDLE_POS[dr.handle];
      if (hx < 0) x0 = p.x;
      if (hx > 0) x1 = p.x;
      if (hy < 0) y0 = p.y;
      if (hy > 0) y1 = p.y;
    }
    let r = normRect({ x: clamp(x0, 0, d.w), y: clamp(y0, 0, d.h) }, { x: clamp(x1, 0, d.w), y: clamp(y1, 0, d.h) });
    if (ratio) {
      const h = r.w / ratio;
      if (h <= d.h - r.y) r = { ...r, h };
      else r = { ...r, h: d.h - r.y, w: (d.h - r.y) * ratio };
    }
    return { x: r.x, y: r.y, w: Math.max(1, r.w), h: Math.max(1, r.h) };
  }
  function transformHit(e: { clientX: number; clientY: number; pointerType?: string }): string | null {
    if (!transform) return null;
    const s = screenOf(e);
    const tol = e.pointerType === "touch" ? 22 : 10;
    const m = transformMatrix(transform);
    const b = transform.box;
    const knob = rotateKnob(transform);
    if (Math.hypot(knob.x - s.x, knob.y - s.y) < tol) return "rotate";
    for (const h of HANDLES) {
      const [hx, hy] = HANDLE_POS[h];
      const q = new DOMPoint(b.x + ((hx + 1) / 2) * b.w, b.y + ((hy + 1) / 2) * b.h).matrixTransform(m);
      const p = toScreen(q);
      if (Math.abs(p.x - s.x) < tol && Math.abs(p.y - s.y) < tol) return h;
    }
    // Inside the box moves it; just outside rotates (as in Photoshop).
    const inv = m.inverse();
    const dp = new DOMPoint((s.x - view.current.x) / view.current.z, (s.y - view.current.y) / view.current.z).matrixTransform(inv);
    if (dp.x >= b.x && dp.x <= b.x + b.w && dp.y >= b.y && dp.y <= b.y + b.h) return "move";
    return "rotate";
  }
  function transformDrag(dr: Extract<Drag, { type: "transform" }>, p: Pt, shift: boolean): TransformState {
    const t0 = dr.orig;
    const { box } = t0;
    const c0 = { x: box.x + box.w / 2 + t0.tx, y: box.y + box.h / 2 + t0.ty };
    if (dr.handle === "move") return { ...t0, tx: t0.tx + p.x - dr.start.x, ty: t0.ty + p.y - dr.start.y };
    if (dr.handle === "rotate") {
      const a0 = Math.atan2(dr.start.y - c0.y, dr.start.x - c0.x);
      const a1 = Math.atan2(p.y - c0.y, p.x - c0.x);
      let rot = t0.rot + ((a1 - a0) * 180) / Math.PI;
      if (shift) rot = Math.round(rot / 15) * 15;
      return { ...t0, rot };
    }
    const [hx, hy] = HANDLE_POS[dr.handle];
    const rad = (t0.rot * Math.PI) / 180;
    const dx = p.x - c0.x;
    const dy = p.y - c0.y;
    const L = { x: dx * Math.cos(-rad) - dy * Math.sin(-rad), y: dx * Math.sin(-rad) + dy * Math.cos(-rad) };
    const hw = (box.w * t0.sx) / 2;
    const hh = (box.h * t0.sy) / 2;
    const A = { x: -hx * hw, y: -hy * hh };
    let rx = hx ? (L.x - A.x) / (2 * hx * hw || 1) : 1;
    let ry = hy ? (L.y - A.y) / (2 * hy * hh || 1) : 1;
    // Corners keep the proportions unless Shift is held (Photoshop's current behaviour).
    if (hx && hy && !shift) rx = ry = (rx + ry) / 2;
    const sx = t0.sx * rx;
    const sy = t0.sy * ry;
    const C = { x: hx ? A.x + (hx * box.w * sx) / 2 : 0, y: hy ? A.y + (hy * box.h * sy) / 2 : 0 };
    const cx = c0.x + C.x * Math.cos(rad) - C.y * Math.sin(rad);
    const cy = c0.y + C.x * Math.sin(rad) + C.y * Math.cos(rad);
    return { ...t0, sx, sy, tx: cx - (box.x + box.w / 2), ty: cy - (box.y + box.h / 2) };
  }

  /* ----- Wheel (zoom and pan) and drops ----- */

  useEffect(() => {
    const w = wrapRef.current;
    if (!w || !doc) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = w.getBoundingClientRect();
      // A mouse wheel moves in whole notches (no sideways part); a trackpad sends small, smooth
      // deltas, often with some sideways movement. Wheels zoom at the pointer (what people expect
      // from a picture), trackpads pan with two fingers, and pinch (Ctrl+wheel) always zooms.
      const lines = e.deltaMode === 1;
      const trackpad = !lines && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
      if (e.ctrlKey || e.metaKey || (!trackpad && !e.shiftKey)) {
        const dy = lines ? e.deltaY * 33 : e.deltaY;
        zoomAt(Math.exp(-dy * (e.ctrlKey && Math.abs(dy) < 30 ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setView({ ...view.current, x: view.current.x - dx, y: view.current.y - dy });
      }
    };
    w.addEventListener("wheel", onWheel, { passive: false });
    return () => w.removeEventListener("wheel", onWheel);
    // Re-attached when the canvas remounts (opening a document, entering full screen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!doc, fullscreen]);

  /* ----- Clipboard paste ----- */

  const pasteInternal = () => {
    const d = docRef.current;
    const c = clipboard.current;
    if (d && c) commit(insertAbove(d, newLayer({ name: freshName(d, "Pasted"), canvas: c.canvas, x: c.x, y: c.y })), "Paste");
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void placeFile(file);
        return;
      }
      const d = docRef.current;
      const c = clipboard.current;
      if (d && c) {
        e.preventDefault();
        commit(insertAbove(d, newLayer({ name: freshName(d, "Pasted"), canvas: c.canvas, x: c.x, y: c.y })), "Paste");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  /* ----- Full screen ----- */

  useEffect(() => {
    if (!fullscreen) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    getLenis()?.stop();
    requestAnimationFrame(() => fit(docRef.current, false));
    return () => {
      html.style.overflow = prev;
      getLenis()?.start();
      requestAnimationFrame(() => fit(docRef.current, true));
    };
  }, [fullscreen, fit]);

  /* ----- Layer actions (shared by the panel and the menus) ----- */

  const enterSmartEdit = (layerId?: string) => {
    const d = docRef.current;
    const h = histRef.current;
    if (!d || !h) return;
    const l = d.layers.find((x) => x.id === (layerId ?? d.active));
    if (!l || l.kind !== "smart" || !l.smart) return say("Pick a Smart Object layer first.");
    finishModes("move");
    setOpEdit(null);
    setStyleEdit(false);
    setSmartPrompt(null);
    const frame: SmartFrame = {
      parentHist: h,
      layerId: l.id,
      sourceId: l.smart.sourceId,
      parentName: d.name,
      layerName: l.name,
      view: { ...view.current },
    };
    const cloned = cloneDocDeep(l.smart.sourceDoc);
    setSmartStack((prev) => [...prev, frame]);
    setHist({ entries: [{ doc: cloned, label: `Open ${l.name}`, at: Date.now() }], index: 0 });
    setSelectedIds([cloned.active]);
    requestAnimationFrame(() => fit(cloned, true));
    say(`Editing “${l.name}” contents. Press Ctrl+S or click Save & Return to update.`);
  };

  const exitSmartEdit = (save: boolean) => {
    const stack = smartStack;
    if (!stack.length) return;
    const frame = stack[stack.length - 1];
    const editedDoc = docRef.current;
    finishModes("move");
    setOpEdit(null);
    setStyleEdit(false);
    setSmartPrompt(null);
    setSmartStack((prev) => prev.slice(0, -1));
    setHist(frame.parentHist);
    view.current = frame.view;
    setZoom(frame.view.z);
    setSelectedIds([frame.layerId]);
    if (save && editedDoc) {
      const parentDoc = frame.parentHist.entries[frame.parentHist.index].doc;
      const updated = updateLinkedSmartObjects(parentDoc, frame.sourceId, cloneDocDeep(editedDoc), { fg, bg });
      commit(updated, `Update Smart Object (${frame.layerName})`);
      say(`Updated “${frame.layerName}”${updated.layers.filter((x) => x.smart?.sourceId === frame.sourceId).length > 1 ? " and linked copies" : ""}.`);
    } else {
      dirty.current = true;
      say("Cancelled Smart Object edits.");
    }
  };

  const replaceSmartFromFile = async (f: File) => {
    const d = docRef.current;
    if (!d) return;
    const targetId = replaceTargetRef.current ?? d.active;
    replaceTargetRef.current = null;
    try {
      const name = f.name.replace(/\.[^.]+$/, "") || "Smart Object";
      const srcDoc = isPsd(f) || isProject(f) ? await openFile(f) : docFromCanvas(await decodeImage(f), name);
      commit(replaceSmartContents(d, targetId, srcDoc, name, { fg, bg }), "Replace Contents");
      say("Smart Object contents replaced while keeping transforms and Smart Filters.");
    } catch {
      say("Couldn't read that file to replace Smart Object contents.");
    }
  };

  const exportSmartContents = async (layerId?: string) => {
    const d = docRef.current;
    if (!d) return;
    const l = d.layers.find((x) => x.id === (layerId ?? d.active));
    if (!l || l.kind !== "smart" || !l.smart) return;
    const baseName = l.name || "smart-object";
    if (l.smart.sourceDoc.layers.length === 1 && l.smart.sourceDoc.layers[0].kind === "pixel" && !l.smart.filters.length) {
      const flat = renderSmartSource(l.smart, { fg, bg });
      const blob = await new Promise<Blob | null>((res) => flat.toBlob(res, "image/png"));
      if (blob) saveBlob(blob, `${baseName}.png`);
      say(`Exported embedded contents as ${baseName}.png.`);
      return;
    }
    const blob = await writeProject(l.smart.sourceDoc);
    saveBlob(blob, `${baseName}${PROJECT_EXT}`);
    say(`Exported embedded contents as ${baseName}${PROJECT_EXT}.`);
  };

  const pickScreenColor = async () => {
    try {
      const ED = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      if (!ED) return;
      const res = await new ED().open();
      if (res.sRGBHex) {
        setFg(res.sRGBHex.toLowerCase());
        say(`Foreground set to ${res.sRGBHex.toUpperCase()}.`);
      }
    } catch {
      /* user cancelled */
    }
  };

  const layerApi: LayerApi = {
    selectedIds: effectiveSelectedIds,
    select: (id, mask, mod) => {
      const d = docRef.current!;
      const l = d.layers.find((x) => x.id === id)!;
      if (transform) applyTransform();
      if (mod?.shift) {
        const order = d.layers.map((x) => x.id);
        const a = order.indexOf(d.active);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          setSelectedIds(order.slice(lo, hi + 1));
          return;
        }
      }
      if (mod?.ctrl) {
        const cur = new Set(effectiveSelectedIds);
        if (cur.has(id) && cur.size > 1) cur.delete(id);
        else cur.add(id);
        setSelectedIds([...cur]);
        return;
      }
      setSelectedIds([id]);
      commit({ ...d, active: id, editMask: mask ?? (id === d.active ? d.editMask && !!l.mask : false) }, "Select Layer", "select");
      setStyleEdit(false);
    },
    toggleVisible: (id) => {
      const d = docRef.current!;
      const l = d.layers.find((x) => x.id === id)!;
      commit(replaceLayer(d, id, { visible: !l.visible }), l.visible ? "Hide Layer" : "Show Layer");
    },
    rename: (id, name) => commit(replaceLayer(docRef.current!, id, { name }), "Rename Layer"),
    move: (id, to) => {
      const d = docRef.current!;
      const from = d.layers.findIndex((l) => l.id === id);
      if (from < 0 || from === to) return;
      const layers = [...d.layers];
      const [l] = layers.splice(from, 1);
      layers.splice(clamp(to, 0, layers.length), 0, l);
      commit({ ...d, layers }, "Reorder Layers");
    },
    setOpacity: (v) => {
      const d = docRef.current!;
      commit(replaceLayer(d, d.active, { opacity: v }), "Opacity", `opacity:${d.active}`);
    },
    setBlend: (v) => {
      const d = docRef.current!;
      commit(replaceLayer(d, d.active, { blend: v }), "Blend Mode");
    },
    toggleLock: () => {
      const d = docRef.current!;
      commit(replaceLayer(d, d.active, { locked: !activeLayer(d).locked }), "Lock Layer");
    },
    toggleLockAlpha: () => {
      const d = docRef.current!;
      commit(replaceLayer(d, d.active, { lockAlpha: !activeLayer(d).lockAlpha }), "Lock Transparency");
    },
    add: () => {
      const d = docRef.current!;
      commit(insertAbove(d, newLayer({ name: freshName(d, "Layer"), canvas: makeCanvas(d.w, d.h) })), "New Layer");
    },
    addAdjustment: (id) => {
      const op = adjustmentById(id);
      if (!op) return;
      setOpEdit({ op, params: defaults(op), asLayer: true, target: "layer" });
      setPanel("properties");
    },
    addMask: () => {
      const d = docRef.current!;
      commit(addMask(d, d.selection ? "selection" : "reveal"), "Add Layer Mask");
      say("Mask added: black hides, white shows. Paint on it with the brush.");
    },
    duplicate: () => commit(duplicateLayer(docRef.current!), "Duplicate Layer"),
    remove: () => {
      const d = docRef.current!;
      if (d.layers.length < 2) return;
      const i = d.layers.findIndex((l) => l.id === d.active);
      const layers = d.layers.filter((l) => l.id !== d.active);
      commit({ ...d, layers, active: layers[Math.max(0, i - 1)].id, editMask: false }, "Delete Layer");
      setSelectedIds([]);
    },
    mergeDown: () => {
      const n = mergeDown(docRef.current!);
      if (n) commit(n, "Merge Down");
    },
    toggleClip: () => {
      const d = docRef.current!;
      const l = activeLayer(d);
      if (d.layers.indexOf(l) === 0) return say("The bottom layer has nothing below it to clip to.");
      commit(replaceLayer(d, l.id, { clip: !l.clip }), l.clip ? "Release Clipping Mask" : "Create Clipping Mask");
    },
    openStyle: () => {
      const d = docRef.current!;
      const l = activeLayer(d);
      if (l.kind === "adjustment") return;
      if (!l.effects) commit(replaceLayer(d, l.id, { effects: { ...NO_EFFECTS, shadow: { ...NO_EFFECTS.shadow, on: true } } }), "Layer Style");
      setOpEdit(null);
      setStyleEdit(true);
      setPanel("properties");
    },
    selectPixels: (id) => commit(selectLayerPixels(docRef.current!, id), "Load Selection"),
    convertToSmart: (ids) => {
      const d = docRef.current!;
      const list = ids?.length ? ids : effectiveSelectedIds;
      const single = list.length === 1 ? d.layers.find((x) => x.id === list[0]) : null;
      if (single?.kind === "adjustment") return say("Adjustment layers alone can't be a Smart Object—select them with other layers.");
      commit(convertToSmartObject(d, list, { fg, bg }), "Convert to Smart Object");
      setSelectedIds([]);
      say("Converted to Smart Object. Double-click its thumbnail to edit inside, or apply non-destructive filters.");
    },
    editSmart: (id) => enterSmartEdit(id),
    replaceSmart: (id) => {
      replaceTargetRef.current = id ?? docRef.current?.active ?? null;
      replaceSmartRef.current?.click();
    },
    duplicateSmartCopy: (id) => commit(duplicateSmartIndependent(docRef.current!, id, { fg, bg }), "New Smart Object via Copy"),
    exportSmart: (id) => void exportSmartContents(id),
    resetSmartTransform: (id) => commit(resetSmartTransform(docRef.current!, id, { fg, bg }), "Reset Smart Transform"),
    rasterize: (id) => {
      const d = docRef.current!;
      commit(rasterize(d, id), "Rasterize Layer");
      setSmartPrompt(null);
    },
    rasterizeStyle: (id) => commit(rasterizeLayerStyle(docRef.current!, id), "Rasterize Layer Style"),
    rasterizeAll: () => commit(rasterizeAll(docRef.current!), "Rasterize All Layers"),
    applyMask: (id) => commit(applyMask(docRef.current!, id), "Apply Layer Mask"),
    stampVisible: () => commit(stampVisible(docRef.current!), "Stamp Visible"),
    mergeSelected: () => {
      commit(mergeSelected(docRef.current!, effectiveSelectedIds), "Merge Selected");
      setSelectedIds([]);
    },
    deleteSelected: () => {
      const d = docRef.current!;
      if (d.layers.length < 2) return;
      commit(deleteLayers(d, effectiveSelectedIds), "Delete Layers");
      setSelectedIds([]);
    },
    toggleSmartFilters: (layerId) => commit(toggleAllSmartFilters(docRef.current!, layerId, { fg, bg }), "Toggle Smart Filters"),
    toggleSmartFilter: (layerId, filterId) => {
      const d = docRef.current!;
      const l = d.layers.find((x) => x.id === layerId);
      const f = l?.smart?.filters.find((x) => x.id === filterId);
      if (f) commit(updateSmartFilter(d, layerId, filterId, { enabled: !f.enabled }, { fg, bg }), f.enabled ? "Hide Smart Filter" : "Show Smart Filter");
    },
    editSmartFilter: (layerId, filterId) => {
      const d = docRef.current!;
      const l = d.layers.find((x) => x.id === layerId);
      const f = l?.smart?.filters.find((x) => x.id === filterId);
      const op = f ? resolveSmartOp(f.opId) : undefined;
      if (!l || !f || !op) return;
      if (d.active !== layerId) commit({ ...d, active: layerId, editMask: false }, "Select Layer", "select");
      setStyleEdit(false);
      setOpEdit({ op, params: structuredClone(f.params), asLayer: false, target: "layer", filterId: f.id, layerId: l.id, from: "properties" });
      setPanel("properties");
      setSheetOpen(true);
    },
    removeSmartFilter: (layerId, filterId) => commit(removeSmartFilter(docRef.current!, layerId, filterId, { fg, bg }), "Remove Smart Filter"),
    reorderSmartFilter: (layerId, filterId, dir) => commit(reorderSmartFilter(docRef.current!, layerId, filterId, dir, { fg, bg }), "Reorder Smart Filter"),
    clearSmartFilters: (layerId) => commit(clearSmartFilters(docRef.current!, layerId, { fg, bg }), "Clear Smart Filters"),
  };

  const arrange = (dir: "front" | "forward" | "backward" | "back") => {
    const d = docRef.current!;
    const i = d.layers.findIndex((l) => l.id === d.active);
    const to = dir === "front" ? d.layers.length - 1 : dir === "back" ? 0 : dir === "forward" ? i + 1 : i - 1;
    layerApi.move(d.active, to);
  };

  /* ----- Before / after ----- */

  const setComparing = (on: boolean) => {
    compareRef.current = on;
    setCompare(on);
    dirty.current = true;
  };
  const toggleSplitCompare = () => {
    const next = !splitCompareRef.current;
    splitCompareRef.current = next;
    setSplitCompare(next);
    dirty.current = true;
  };
  const updateSplitX = (v: number) => {
    const clamped = clamp(v, 0.02, 0.98);
    splitXRef.current = clamped;
    setSplitX(clamped);
    dirty.current = true;
  };
  useEffect(() => {
    if (!splitCompare || !splitHandleRef.current || !docRef.current) return;
    const v = view.current;
    splitHandleRef.current.style.left = `${v.x + docRef.current.w * splitX * v.z}px`;
  }, [splitCompare, splitX, doc]);

  /* ----- Upscale (the existing AI service) ----- */

  const upscale = async (factor: 2 | 4) => {
    const d = docRef.current;
    if (!d) return;
    setBusy(`Upscaling ${factor}× with AI… this can take a minute`);
    try {
      const flat = flatten(d);
      const blob = await new Promise<Blob>((r, j) => flat.toBlob((b) => (b ? r(b) : j(new Error("Couldn't prepare the picture."))), "image/png"));
      const form = new FormData();
      form.append("file", blob, `${d.name || "image"}.png`);
      form.append("factor", String(factor));
      const res = await uploadForm(IMAGE_API("upscale"), form, { fallbackName: "upscaled.png" });
      const big = await decodeImage(res.blob);
      if (big.width * big.height > pixelLimit()) throw new Error("The result is too big for this device to edit.");
      // Layers are merged: the AI redraws the whole picture.
      const bg = newLayer({ name: `Upscaled ${factor}×`, canvas: big });
      commit({ ...d, w: big.width, h: big.height, layers: [bg], active: bg.id, selection: null, editMask: false }, `Upscale ${factor}×`);
      requestAnimationFrame(() => fit(undefined, true));
      say(`Upscaled to ${big.width} × ${big.height}. Layers were merged into one.`);
    } catch (e) {
      say(`Upscale needs our server: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  /* ----- Portrait: background blur and replace (subject from the AI cut-out) ----- */

  const subjectOf = async (l: Layer) => {
    const hit = subjectCache.current;
    if (hit && hit.canvas === l.canvas) return hit.mask;
    const mask = await cutout(l.canvas);
    subjectCache.current = { canvas: l.canvas, mask };
    return mask;
  };
  const background = async (how: "blur" | "color" | "transparent") => {
    const d = docRef.current;
    if (!d) return;
    const l = activeLayer(d);
    if (l.kind === "adjustment") return say("Pick the photo's layer first.");
    setBusy(how === "blur" ? "Blurring the background…" : "Finding the subject…");
    try {
      const mask = await subjectOf(l);
      const out = makeCanvas(l.canvas.width, l.canvas.height);
      const g = ctx2d(out);
      if (how === "blur") {
        // A soft copy behind, the sharp subject on top: a portrait-lens look.
        const r = Math.max(4, Math.round(Math.min(l.canvas.width, l.canvas.height) * 0.012));
        const soft = makeCanvas(l.canvas.width, l.canvas.height);
        const sg = ctx2d(soft, true);
        sg.drawImage(l.canvas, 0, 0);
        const img = sg.getImageData(0, 0, soft.width, soft.height);
        blurImage(img, r);
        sg.putImageData(img, 0, 0);
        g.drawImage(soft, 0, 0);
      } else if (how === "color") {
        g.fillStyle = bg;
        g.fillRect(0, 0, out.width, out.height);
      }
      const subject = makeCanvas(l.canvas.width, l.canvas.height);
      const sub = ctx2d(subject);
      sub.drawImage(l.canvas, 0, 0);
      sub.globalCompositeOperation = "destination-in";
      sub.drawImage(mask, 0, 0);
      g.drawImage(subject, 0, 0);
      commit(replaceLayer(d, l.id, { canvas: out, text: undefined, shape: undefined, vector: undefined, kind: "pixel" }), how === "blur" ? "Blur Background" : how === "color" ? "Replace Background" : "Remove Background");
    } catch (e) {
      say(`This needs our server: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  /* ----- Collage ----- */

  const collageFrom = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/")).slice(0, 9);
    if (pics.length < 2) return say("Pick 2 to 9 photos for a collage.");
    setBusy("Making the collage…");
    try {
      const canvases = await Promise.all(pics.map((f) => decodeImage(f)));
      start(makeCollage(canvases, 2048, 24, "#ffffff", 0), "New Collage");
      say("Each photo is its own layer: move, scale or swap them, and change the background layer's colour.");
    } catch {
      say("One of those files couldn't be opened.");
    } finally {
      setBusy(null);
    }
  };

  /* ----- Saving ----- */

  const download = (blob: Blob, name: string) => {
    saveBlob(blob, name);
    setExported(true);
  };
  const savePsd = async () => {
    const d = docRef.current;
    if (!d) return;
    setBusy("Writing the PSD…");
    await nextFrame();
    try {
      const { blob, notes } = await writePsdFile(d);
      download(blob, `${d.name || "image"}.psd`);
      say(notes[0] ?? "Saved as PSD, with layers.");
    } catch (e) {
      say(`Couldn't write the PSD: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const saveProject = async () => {
    const d = docRef.current;
    if (!d) return;
    setBusy("Saving the project…");
    try {
      download(await writeProject(d), `${d.name || "image"}${PROJECT_EXT}`);
      say("Project saved. Open it here any time to keep editing.");
    } finally {
      setBusy(null);
    }
  };
  const quickPng = async () => {
    const d = docRef.current;
    if (!d) return;
    const { exportBlob } = await import("./io");
    download(await exportBlob(d, "png", 1, 1, "#fff"), `${d.name || "image"}.png`);
  };

  const applyStraighten = () => {
    const d = docRef.current;
    if (!d || !cropAngle) return;
    const rot = transformCanvas(d, { angle: cropAngle });
    const next = cropDoc(rot, inscribedCropRect(d.w, d.h, cropAngle));
    commit(next, "Straighten");
    setCropAngle(0);
    setCrop({ x: 0, y: 0, w: next.w, h: next.h });
    requestAnimationFrame(() => fit(next, true));
  };

  const applyCrop = () => {
    const d = docRef.current;
    if (!d || !crop) return;
    const untrimmed = crop.x === 0 && crop.y === 0 && Math.round(crop.w) === d.w && Math.round(crop.h) === d.h;
    if (untrimmed && cropAngle === 0) return say("Drag the crop's edges or dial Straighten first.");
    let next = untrimmed ? d : cropDoc(d, crop);
    if (cropAngle !== 0) {
      const rot = transformCanvas(next, { angle: cropAngle });
      next = cropDoc(rot, inscribedCropRect(next.w, next.h, cropAngle));
    }
    commit(next, untrimmed && cropAngle !== 0 ? "Straighten" : "Crop");
    setCropAngle(0);
    setCrop({ x: 0, y: 0, w: next.w, h: next.h });
    requestAnimationFrame(() => fit(next, true));
  };

  /* ----- Keyboard ----- */

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKey = (e: KeyboardEvent) => {
    const d = docRef.current;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (dialog || document.querySelector("[role=dialog]")) return;
    if (busyRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!d) {
      if (mod && k === "o") {
        e.preventDefault();
        fileRef.current?.click();
      }
      return;
    }
    const go = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (e.key === "\\" && !e.repeat) {
      if (histRef.current && histRef.current.index > 0) setComparing(true);
      return e.preventDefault();
    }
    if (e.key === " " && !space.current) {
      space.current = true;
      if (overRef.current) overRef.current.style.cursor = "grab";
      return e.preventDefault();
    }
    if (mod) {
      const shift = e.shiftKey;
      const alt = e.altKey;
      if (k === "z") return go(shift ? redo : undo);
      if (k === "y") return go(redo);
      if (k === "a") return go(() => commit({ ...d, selection: selectAll(d) }, "Select All"));
      if (k === "d") return go(() => d.selection && commit({ ...d, selection: null }, "Deselect"));
      if (k === "i" && shift) return go(() => commit(inverseSelection(d), "Inverse"));
      if (k === "i") return go(() => openOp(adjustmentById("invert")!));
      if (k === "j") return go(() => commit(layerVia(d, shift), shift ? "Layer via Cut" : "Layer via Copy"));
      if (k === "e" && shift && alt) return go(() => commit(stampVisible(d), "Stamp Visible"));
      if (k === "e" && shift) return go(() => commit(mergeVisible(d), "Merge Visible"));
      if (k === "e") return go(layerApi.mergeDown);
      if (k === "g" && alt) return go(layerApi.toggleClip);
      if (k === "n" && shift) return go(layerApi.add);
      if (k === "c") return go(() => void copy(shift));
      if (k === "x" && shift) return go(() => setTool("liquify"));
      if (k === "x") return go(() => void copy(false, true));
      if (k === "s") return go(() => (shift ? void savePsd() : smartStack.length ? exitSmartEdit(true) : void saveProject()));
      if (k === "w" && alt && shift) return go(() => setDialog("export"));
      if (k === "o") return go(() => fileRef.current?.click());
      if (k === "0") return go(() => fit());
      if (k === "1") return go(actual);
      if (k === "=" || k === "+") return go(() => zoomAt(1.25));
      if (k === "-") return go(() => zoomAt(0.8));
      if (k === "'") return go(() => setShowGrid((g) => !g));
      if (k === "l" && shift) return go(() => openOp(adjustmentById("auto-tone")!));
      if (k === "l") return go(() => openOp(adjustmentById("levels")!));
      if (k === "m") return go(() => openOp(adjustmentById("curves")!));
      if (k === "u" && shift) return go(() => openOp(adjustmentById("desaturate")!));
      if (k === "u") return go(() => openOp(adjustmentById("hue-saturation")!));
      if (k === "b") return go(() => openOp(adjustmentById("color-balance")!));
      if (e.key === "]") return go(() => arrange(shift ? "front" : "forward"));
      if (e.key === "[") return go(() => arrange(shift ? "back" : "backward"));
      return;
    }
    if (e.key === "F5" && e.shiftKey) return go(() => setDialog("fill"));
    if (e.key === "F6" && e.shiftKey) return go(() => d.selection && setDialog("feather"));
    if (e.key === "Enter") {
      if (pen) return go(() => finishPen());
      if (transform) return go(applyTransform);
      if (crop && tool === "crop") return go(applyCrop);
      if (poly) return go(closePoly);
      if (opEdit) return go(() => void applyOpEdit());
      return;
    }
    if (e.key === "Escape") {
      if (pen) return go(() => finishPen());
      if (tool === "node" && nodeSel) return go(() => setNodeSel(nodeSel.node !== null ? { ...nodeSel, node: null, sub: null } : null));
      if (transform) return go(cancelTransform);
      if (poly) return go(() => setPoly(null));
      if (crop && tool === "crop") return go(() => setCrop({ x: 0, y: 0, w: d.w, h: d.h }));
      if (opEdit) return go(() => setOpEdit(null));
      if (fullscreen) return go(() => setFullscreen(false));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (pen) return go(() => setPen(pen.length > 1 ? pen.slice(0, -1) : null));
      if (tool === "node" && nodeSel) return go(() => void deleteVector());
      if (poly && e.key === "Backspace") return go(() => setPoly({ ...poly, pts: poly.pts.slice(0, -1) }));
      if (d.selection) {
        if (activeLayer(d).kind === "smart" && !d.editMask) return go(() => setSmartPrompt(activeLayer(d).id));
        return go(() => commit(clearSelection(d), "Clear"));
      }
      return;
    }
    if (e.key.startsWith("Arrow") && tool === "node" && nodeSel) {
      // Nudge the picked point, or the whole path.
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const l = d.layers.find((x) => x.id === nodeSel.layerId);
      const paths = l?.vector ? layerPaths(l) : [];
      if (!l || l.locked || !paths[nodeSel.path]) return;
      const sh = (q: Pt) => ({ x: q.x + dx, y: q.y + dy });
      const mv = (n: VNode) => ({ ...sh(n), i: n.i && sh(n.i), o: n.o && sh(n.o) });
      const next = paths.map((q, pi) =>
        pi !== nodeSel.path ? q : { ...q, subs: q.subs.map((s, si) => ({ ...s, nodes: s.nodes.map((n, k) => (nodeSel.node === null || (si === nodeSel.sub && k === nodeSel.node) ? mv(n) : n)) })) },
      );
      return go(() => commit(replaceLayer(d, l.id, withPaths(l, next)), "Nudge", `vnudge:${l.id}`));
    }
    if (e.key.startsWith("Arrow") && tool === "move") {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const l = activeLayer(d);
      if (transform) return go(() => setTransform({ ...transform, tx: transform.tx + dx, ty: transform.ty + dy }));
      if (!l.locked) return go(() => commit(replaceLayer(d, l.id, moveSmartLayer(l, dx, dy)), "Nudge", `nudge:${l.id}`));
      return;
    }
    if (e.altKey) return;
    const cycle = (list: ToolId[]) => go(() => setTool(e.shiftKey && list.includes(tool) ? list[(list.indexOf(tool) + 1) % list.length] : list.includes(tool) ? tool : list[0]));
    switch (k) {
      case "v":
        return go(() => setTool("move"));
      case "m":
        return cycle(["marquee-rect", "marquee-ellipse"]);
      case "l":
        return cycle(["lasso", "lasso-poly"]);
      case "w":
        return go(() => setTool("wand"));
      case "c":
        return go(() => setTool("crop"));
      case "i":
        return go(() => setTool("eyedropper"));
      case "j":
        return cycle(["spot-heal", "heal", "red-eye"]);
      case "b":
        return cycle(["brush", "pencil"]);
      case "s":
        return go(() => setTool("clone"));
      case "e":
        return go(() => setTool("eraser"));
      case "g":
        return cycle(["gradient", "bucket"]);
      case "r":
        return cycle(["blur-brush", "sharpen-brush", "smudge"]);
      case "o":
        return cycle(["dodge", "burn", "sponge"]);
      case "t":
        return go(() => (e.shiftKey ? beginTransform() : setTool("text")));
      case "u":
        return go(() => setTool("shape"));
      case "p":
        return go(() => setTool("pen"));
      case "a":
        return go(() => setTool("node"));
      case "h":
        return go(() => setTool("hand"));
      case "z":
        return go(() => setTool("zoom"));
      case "x":
        return go(() => (setFg(bg), setBg(fg)));
      case "d":
        return go(() => (setFg("#000000"), setBg("#ffffff")));
      case "f":
        return go(() => setFullscreen((f) => !f));
      case "[":
        return go(() => (e.shiftKey ? setBrush({ hardness: Math.max(0, brush.hardness - 25) }) : setBrush({ size: Math.max(1, Math.round(brush.size * 0.85 - 1)) })));
      case "]":
        return go(() => (e.shiftKey ? setBrush({ hardness: Math.min(100, brush.hardness + 25) }) : setBrush({ size: Math.min(2000, Math.round(brush.size * 1.15 + 1)) })));
      case "?":
        return go(() => setDialog("shortcuts"));
    }
    if (/^[0-9]$/.test(e.key)) return go(() => setBrush({ opacity: e.key === "0" ? 100 : Number(e.key) * 10 }));
  };
  useLayoutEffect(() => {
    keyRef.current = onKey;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === "\\" && compareRef.current) {
        compareRef.current = false;
        setCompare(false);
        dirty.current = true;
      }
      if (e.key === " ") {
        space.current = false;
        if (overRef.current) overRef.current.style.cursor = "";
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ----- Text and shape properties ----- */

  const active = doc ? activeLayer(doc) : null;
  const setText = (p: Partial<TextMeta>) => {
    const d = docRef.current;
    const l = d && activeLayer(d);
    if (!d || !l?.text) {
      // No text layer selected: these become the settings for the next one.
      const { text: _t, ...rest } = p;
      void _t;
      setOpts({ text: { ...opts.text, ...rest } });
      return;
    }
    const text = { ...l.text, ...p };
    commit(replaceLayer(d, l.id, { text, canvas: renderText(text), name: textName(text) }), "Edit Text", `text:${l.id}`);
    setOpts({ text: { ...opts.text, ...(({ text: _x, ...r }) => (void _x, r))(p as TextMeta) } });
    ensureFont(text).then(() => {
      const cur = docRef.current;
      const now = cur?.layers.find((x) => x.id === l.id);
      if (cur && now?.text === text) commit(replaceLayer(cur, l.id, { canvas: renderText(text) }), "Edit Text", `text:${l.id}`);
    });
  };
  const setShape = (p: Partial<ShapeMeta>) => {
    const d = docRef.current;
    const l = d && activeLayer(d);
    if (!d || !l?.shape) return;
    const pad0 = shapePad(l.shape);
    const shape = { ...l.shape, ...p };
    const pad = shapePad(shape);
    commit(replaceLayer(d, l.id, { shape, canvas: renderShape(shape), x: l.x + pad0 - pad, y: l.y + pad0 - pad }), "Edit Shape", `shape:${l.id}`);
  };
  const uploadFont = async (f: File) => {
    try {
      const label = f.name.replace(/\.[^.]+$/, "").trim() || "Custom font";
      const fam = `Upload ${label}`;
      const face = new FontFace(fam, await f.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      const entry = { label, family: `"${fam}"` };
      if (!FONTS.some((x) => x.family === entry.family)) FONTS.push(entry);
      setFontsList((prev) => (prev.some((x) => x.family === entry.family) ? prev : [...prev, entry]));
      setText({ font: entry.family });
      say(`Font “${label}” added for this session.`);
    } catch {
      say("That font file couldn't be read. Try a TTF, OTF or WOFF.");
    }
  };
  const loadGoogleFont = async (raw: string) => {
    const name = raw.trim().replace(/[^a-zA-Z0-9\s-]/g, "");
    if (!name) return;
    try {
      const slug = name.replace(/\s+/g, "+");
      const id = `dw-pro-gf-${slug.toLowerCase()}`;
      if (!document.getElementById(id)) {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?family=${slug}:wght@400;700&display=swap`;
        document.head.appendChild(link);
      }
      await Promise.race([
        document.fonts.load(`700 32px "${name}"`),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
      const entry = { label: name, family: `"${name}", sans-serif` };
      if (!FONTS.some((x) => x.family === entry.family)) FONTS.push(entry);
      setFontsList((prev) => (prev.some((x) => x.family === entry.family) ? prev : [...prev, entry]));
      setText({ font: entry.family });
      setGFontInput("");
      say(`Loaded Google Font “${name}”.`);
    } catch {
      say(`Couldn't load Google Font “${name}”. Check the exact font name.`);
    }
  };

  /* ----- Menus ----- */

  const sel = !!doc?.selection;
  const adjItems = (asLayer: boolean): MenuItem[] =>
    ADJUSTMENTS.filter((a) => !asLayer || a.layerable).map((a) => ({
      label: a.label + (a.instant || asLayer ? "" : "…"),
      icon: opIcon(a),
      onSelect: () => (asLayer ? layerApi.addAdjustment(a.id) : openOp(a)),
    }));
  const filterGroups = [...new Set(FILTERS.map((f) => f.group))];
  const filterItems = (g: string): MenuItem[] => FILTERS.filter((f) => f.group === g).map((f) => ({ label: f.label + (f.instant ? "" : "…"), icon: opIcon(f), onSelect: () => openOp(f) }));
  const menus: { label: string; items: MenuItem[] }[] = doc
    ? [
        {
          label: "File",
          items: [
            { label: "New…", onSelect: () => setDialog("new") },
            { label: "Open… (replaces this)", shortcut: "Ctrl+O", onSelect: () => fileRef.current?.click() },
            { label: "Place embedded (Smart Object)…", onSelect: () => placeRef.current?.click() },
            { label: "New collage from photos…", onSelect: () => collageRef.current?.click() },
            { type: "sep" },
            { label: "Save project (.dwlp)", shortcut: "Ctrl+S", onSelect: () => void saveProject() },
            { label: "Save as PSD", shortcut: "Shift+Ctrl+S", icon: FileImage, onSelect: () => void savePsd() },
            { label: "Save as SVG (vector)", icon: PenTool, onSelect: saveSvg },
            { label: "Export as…", shortcut: "Alt+Shift+Ctrl+W", onSelect: () => setDialog("export") },
            { label: "Quick export as PNG", onSelect: () => void quickPng() },
            { label: "Copy image to clipboard", onSelect: () => copyToClipboard(doc).then(() => say("Copied to the clipboard."), () => say("This browser won't let us use the clipboard.")) },
            { type: "sep" },
            { label: "Close", onSelect: () => (setHist(null), setFullscreen(false), setSmartStack([]), setSelectedIds([]), setSmartPrompt(null)) },
          ],
        },
        {
          label: "Edit",
          items: [
            { label: `Undo ${hist!.entries[hist!.index].label}`, shortcut: "Ctrl+Z", disabled: hist!.index === 0, onSelect: undo },
            { label: "Redo", shortcut: "Shift+Ctrl+Z", disabled: hist!.index >= hist!.entries.length - 1, onSelect: redo },
            { type: "sep" },
            { label: "Cut", shortcut: "Ctrl+X", disabled: !sel, onSelect: () => void copy(false, true) },
            { label: "Copy", shortcut: "Ctrl+C", onSelect: () => void copy(false) },
            { label: "Copy merged", shortcut: "Shift+Ctrl+C", onSelect: () => void copy(true) },
            { label: "Paste", shortcut: "Ctrl+V", disabled: !hasClip, onSelect: pasteInternal },
            {
              label: "Clear",
              shortcut: "Delete",
              disabled: !sel,
              onSelect: () => {
                if (active?.kind === "smart" && !doc.editMask) return setSmartPrompt(active.id);
                commit(clearSelection(doc), "Clear");
              },
            },
            { type: "sep" },
            { label: "Fill…", shortcut: "Shift+F5", onSelect: () => setDialog("fill") },
            { label: "Stroke…", disabled: !sel, onSelect: () => setDialog("stroke") },
            { label: "Content-aware fill", disabled: !sel, onSelect: () => void contentAwareFill() },
            { type: "sep" },
            { label: "Free transform", shortcut: "Shift+T", onSelect: beginTransform },
            {
              type: "sub",
              label: "Transform layer",
              items: [
                { label: "Flip horizontal", onSelect: () => commit(commitTransform(doc, { layerId: doc.active, box: layerBounds(activeLayer(doc), true), tx: 0, ty: 0, sx: -1, sy: 1, rot: 0 }), "Flip Horizontal") },
                { label: "Flip vertical", onSelect: () => commit(commitTransform(doc, { layerId: doc.active, box: layerBounds(activeLayer(doc), true), tx: 0, ty: 0, sx: 1, sy: -1, rot: 0 }), "Flip Vertical") },
                { label: "Rotate 90° clockwise", onSelect: () => commit(commitTransform(doc, { layerId: doc.active, box: layerBounds(activeLayer(doc), true), tx: 0, ty: 0, sx: 1, sy: 1, rot: 90 }), "Rotate 90°") },
                { label: "Rotate 90° counter-clockwise", onSelect: () => commit(commitTransform(doc, { layerId: doc.active, box: layerBounds(activeLayer(doc), true), tx: 0, ty: 0, sx: 1, sy: 1, rot: -90 }), "Rotate 90°") },
                { label: "Rotate 180°", onSelect: () => commit(commitTransform(doc, { layerId: doc.active, box: layerBounds(activeLayer(doc), true), tx: 0, ty: 0, sx: 1, sy: 1, rot: 180 }), "Rotate 180°") },
              ],
            },
            { type: "sep" },
            { label: "Keyboard shortcuts", shortcut: "?", onSelect: () => setDialog("shortcuts") },
          ],
        },
        {
          label: "Image",
          items: [
            { type: "sub", label: "Adjustments", items: adjItems(false) },
            { label: "Auto Tone", shortcut: "Shift+Ctrl+L", onSelect: () => openOp(adjustmentById("auto-tone")!) },
            { label: "Auto Contrast", onSelect: () => openOp(adjustmentById("auto-contrast")!) },
            { label: "Auto Color", onSelect: () => openOp(adjustmentById("auto-color")!) },
            { type: "sep" },
            { label: "Image size…", onSelect: () => setDialog("image-size") },
            { label: "Canvas size…", onSelect: () => setDialog("canvas-size") },
            {
              type: "sub",
              label: "Image rotation",
              items: [
                { label: "180°", onSelect: () => commit(transformCanvas(doc, "180"), "Rotate Canvas") },
                { label: "90° clockwise", onSelect: () => (commit(transformCanvas(doc, "cw"), "Rotate Canvas"), requestAnimationFrame(() => fit(undefined, true))) },
                { label: "90° counter-clockwise", onSelect: () => (commit(transformCanvas(doc, "ccw"), "Rotate Canvas"), requestAnimationFrame(() => fit(undefined, true))) },
                { label: "Arbitrary…", onSelect: () => setDialog("rotate") },
                { type: "sep" },
                { label: "Flip canvas horizontal", onSelect: () => commit(transformCanvas(doc, "flipH"), "Flip Canvas") },
                { label: "Flip canvas vertical", onSelect: () => commit(transformCanvas(doc, "flipV"), "Flip Canvas") },
              ],
            },
            { label: "Crop to selection", disabled: !sel, onSelect: () => (commit(cropDoc(doc, doc.selection!.bounds), "Crop"), requestAnimationFrame(() => fit(undefined, true))) },
            {
              label: "Trim transparent pixels",
              onSelect: () => {
                const n = trimDoc(doc);
                if (!n) return;
                commit(n, "Trim");
                requestAnimationFrame(() => fit(undefined, true));
              },
            },
            { type: "sep" },
            { label: "Remove background (AI)", onSelect: () => void removeBackground() },
            { label: "Blur background (portrait)", onSelect: () => void background("blur") },
            { label: "Replace background with background colour", onSelect: () => void background("color") },
            {
              type: "sub",
              label: "Upscale (AI)",
              items: [
                { label: "2× larger", onSelect: () => void upscale(2) },
                { label: "4× larger", onSelect: () => void upscale(4) },
              ],
            },
          ],
        },
        {
          label: "Layer",
          items: [
            { label: "New layer", shortcut: "Shift+Ctrl+N", onSelect: layerApi.add },
            { label: "New fill layer (foreground colour)", onSelect: () => commit(insertAbove(doc, newLayer({ name: freshName(doc, "Color Fill"), canvas: (() => { const c = makeCanvas(doc.w, doc.h); const g = ctx2d(c); g.fillStyle = fg; g.fillRect(0, 0, c.width, c.height); return c; })() })), "New Fill Layer") },
            { type: "sub", label: "New adjustment layer", icon: SlidersHorizontal, items: adjItems(true) },
            { label: "New vector path (Pen)", shortcut: "P", icon: PenTool, onSelect: () => setTool("pen") },
            { label: "Convert shape to editable path", disabled: active?.kind !== "shape", onSelect: shapeToVector },
            { label: "Duplicate layer", onSelect: layerApi.duplicate },
            { label: "Delete layer", disabled: doc.layers.length < 2, onSelect: layerApi.remove },
            { type: "sep" },
            { label: "Layer via copy", shortcut: "Ctrl+J", onSelect: () => commit(layerVia(doc, false), "Layer via Copy") },
            { label: "Layer via cut", shortcut: "Shift+Ctrl+J", disabled: !sel, onSelect: () => commit(layerVia(doc, true), "Layer via Cut") },
            { type: "sep" },
            {
              type: "sub",
              label: "Layer mask",
              items: [
                { label: "Reveal all", disabled: !!active?.mask, onSelect: () => commit(addMask(doc, "reveal"), "Add Layer Mask") },
                { label: "Hide all", disabled: !!active?.mask, onSelect: () => commit(addMask(doc, "hide"), "Add Layer Mask") },
                { label: "From selection", disabled: !!active?.mask || !sel, onSelect: () => commit(addMask(doc, "selection"), "Add Layer Mask") },
                { type: "sep" },
                { label: active?.maskOn === false ? "Enable mask" : "Disable mask", disabled: !active?.mask, onSelect: () => commit(replaceLayer(doc, doc.active, { maskOn: !active!.maskOn }), "Toggle Mask") },
                { label: "Apply mask", disabled: !active?.mask || active.kind === "adjustment", onSelect: () => commit(applyMask(doc), "Apply Mask") },
                { label: "Delete mask", disabled: !active?.mask, onSelect: () => commit({ ...replaceLayer(doc, doc.active, { mask: null }), editMask: false }, "Delete Mask") },
              ],
            },
            { label: active?.clip ? "Release clipping mask" : "Create clipping mask", shortcut: "Alt+Ctrl+G", onSelect: layerApi.toggleClip },
            { label: "Layer style…", disabled: active?.kind === "adjustment", onSelect: layerApi.openStyle },
            { label: "Clear layer style", disabled: !active?.effects, onSelect: () => commit(replaceLayer(doc, doc.active, { effects: null }), "Clear Layer Style") },
            {
              type: "sub",
              label: "Smart Objects",
              icon: Box,
              items: [
                {
                  label: effectiveSelectedIds.length > 1 ? `Convert ${effectiveSelectedIds.length} Layers to Smart Object` : "Convert to Smart Object",
                  disabled: active?.kind === "adjustment" && effectiveSelectedIds.length === 1,
                  onSelect: () => layerApi.convertToSmart(),
                },
                { label: "Edit Contents", disabled: active?.kind !== "smart", onSelect: () => layerApi.editSmart() },
                { label: "Replace Contents…", disabled: active?.kind !== "smart", onSelect: () => layerApi.replaceSmart() },
                { label: "New Smart Object via Copy", disabled: active?.kind !== "smart", onSelect: () => layerApi.duplicateSmartCopy() },
                { label: "Export Contents…", disabled: active?.kind !== "smart", onSelect: () => layerApi.exportSmart() },
                { label: "Reset Transform", disabled: active?.kind !== "smart", onSelect: () => layerApi.resetSmartTransform() },
                { type: "sep" },
                { label: "Rasterize Smart Object", disabled: active?.kind !== "smart", onSelect: () => layerApi.rasterize() },
              ],
            },
            {
              type: "sub",
              label: "Rasterize",
              items: [
                { label: "Rasterize Layer", disabled: active?.kind === "pixel" || active?.kind === "adjustment", onSelect: () => layerApi.rasterize() },
                { label: "Rasterize Layer Style", disabled: !active?.effects, onSelect: () => layerApi.rasterizeStyle() },
                { label: "Rasterize All Layers", onSelect: layerApi.rasterizeAll },
              ],
            },
            { type: "sep" },
            {
              type: "sub",
              label: "Arrange",
              items: [
                { label: "Bring to front", shortcut: "Shift+Ctrl+]", onSelect: () => arrange("front") },
                { label: "Bring forward", shortcut: "Ctrl+]", onSelect: () => arrange("forward") },
                { label: "Send backward", shortcut: "Ctrl+[", onSelect: () => arrange("backward") },
                { label: "Send to back", shortcut: "Shift+Ctrl+[", onSelect: () => arrange("back") },
              ],
            },
            { label: "Merge down", shortcut: "Ctrl+E", onSelect: layerApi.mergeDown },
            { label: "Merge visible", shortcut: "Shift+Ctrl+E", onSelect: () => commit(mergeVisible(doc), "Merge Visible") },
            { label: "Stamp visible (merge copy on top)", shortcut: "Alt+Shift+Ctrl+E", icon: Stamp, onSelect: layerApi.stampVisible },
            { label: "Flatten image", onSelect: () => commit(flattenDoc(doc), "Flatten Image") },
          ],
        },
        {
          label: "Select",
          items: [
            { label: "All", shortcut: "Ctrl+A", onSelect: () => commit({ ...doc, selection: selectAll(doc) }, "Select All") },
            { label: "Deselect", shortcut: "Ctrl+D", disabled: !sel, onSelect: () => commit({ ...doc, selection: null }, "Deselect") },
            { label: "Inverse", shortcut: "Shift+Ctrl+I", onSelect: () => commit(inverseSelection(doc), "Inverse") },
            { type: "sep" },
            { label: "Subject (AI)", onSelect: () => void selectSubject() },
            { label: "Color range (foreground colour)…", onSelect: () => setDialog("color-range") },
            { label: "Load layer transparency", onSelect: () => commit(selectLayerPixels(doc, doc.active), "Load Selection") },
            { type: "sep" },
            {
              type: "sub",
              label: "Modify",
              disabled: !sel,
              items: [
                { label: "Feather…", shortcut: "Shift+F6", onSelect: () => setDialog("feather") },
                { label: "Expand…", onSelect: () => setDialog("expand") },
                { label: "Contract…", onSelect: () => setDialog("contract") },
              ],
            },
          ],
        },
        {
          label: "Filter",
          items: [
            ...filterGroups.map((g) => ({
              type: "sub" as const,
              label: groupLabel(g),
              icon: groupIcon(g),
              items: filterItems(g),
            })),
            { type: "sep" },
            { label: "Camera Raw filter…", onSelect: () => openOp(adjustmentById("camera-raw")!) },
            { label: "Liquify (brush)", shortcut: "Shift+Ctrl+X", onSelect: () => setTool("liquify") },
          ],
        },
        {
          label: "View",
          items: [
            { label: "Zoom in", shortcut: "Ctrl+=", onSelect: () => zoomAt(1.25) },
            { label: "Zoom out", shortcut: "Ctrl+−", onSelect: () => zoomAt(0.8) },
            { label: "Fit on screen", shortcut: "Ctrl+0", onSelect: () => fit() },
            { label: "100%", shortcut: "Ctrl+1", onSelect: actual },
            { type: "sep" },
            { label: "Grid and thirds", shortcut: "Ctrl+'", checked: showGrid, onSelect: () => setShowGrid((g) => !g) },
            { label: fullscreen ? "Exit full screen" : "Full screen", shortcut: "F", onSelect: () => setFullscreen((f) => !f) },
          ],
        },
      ]
    : [];

  /* ----- Render ----- */

  const step = !doc ? 0 : exported ? 3 : 1;
  const z = zoom;

  const cursorFor = () => {
    if (tool === "hand") return "grab";
    if (tool === "zoom") return "zoom-in";
    if (tool === "move") return "move";
    if (tool === "text") return "text";
    if (tool === "node") return "default";
    if (BUFFER_TOOLS.includes(tool) || PIXEL_TOOLS.includes(tool) || tool === "red-eye") return "none";
    return "crosshair";
  };

  const propertiesPanel = () => {
    if (!doc || !active) return null;
    if (opEdit) {
      const { op, target } = opEdit;
      const Icon = opIcon(op);
      const layerOk = active.kind !== "adjustment";
      const pixelsOnly = target === "layer" && !opEdit.asLayer;
      const base = defaults(op);
      const changes = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(opEdit.params[k])).length;
      const back = () => {
        const from = opEdit.from ?? "adjust";
        setOpEdit(null);
        setPanel(from);
      };
      const peek = (on: boolean) => {
        peekRef.current = on;
        setPeeking(on);
        dirty.current = true;
      };
      return (
        <motion.div key={op.id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }} className="space-y-3 p-3">
          <button type="button" onClick={back} className="group -ml-1 inline-flex h-7 items-center gap-1 rounded-sm px-1 text-[12px] text-ink-2 transition-colors hover:text-ink">
            <ChevronDown aria-hidden className="size-3.5 rotate-90 transition-transform group-hover:-translate-x-0.5" />
            {opEdit.from === "looks" ? "All looks" : "All effects"}
          </button>
          <div className="flex items-start gap-2.5">
            <motion.span initial={{ scale: 0.7, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", bounce: 0.45, duration: 0.5 }} className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ink text-paper shadow-card">
              <Icon aria-hidden className="size-5" strokeWidth={1.75} />
            </motion.span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[14px] font-medium leading-tight text-ink">
                <span className="truncate">{op.label}</span>
                <AnimatePresence>
                  {changes > 0 && (
                    <motion.span initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent/10 px-1.5 font-mono text-[12px] font-normal text-accent">
                      {changes} {changes === 1 ? "change" : "changes"}
                    </motion.span>
                  )}
                </AnimatePresence>
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{op.hint ?? opBlurb(op)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              aria-pressed={peeking}
              onPointerDown={() => peek(true)}
              onPointerUp={() => peek(false)}
              onPointerLeave={() => peekRef.current && peek(false)}
              onPointerCancel={() => peek(false)}
              onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && peek(true)}
              onKeyUp={() => peek(false)}
              onContextMenu={(e) => e.preventDefault()}
              className={cn("inline-flex h-8 select-none items-center justify-center gap-1.5 rounded-sm border text-[12px] transition-colors", peeking ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-ink-3 hover:text-ink")}
            >
              <Eye aria-hidden className="size-3.5" /> {peeking ? "Showing before" : "Hold to compare"}
            </button>
            <button type="button" disabled={!changes} onClick={() => setOpEdit({ ...opEdit, params: base })} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-line text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-40">
              <RotateCcw aria-hidden className="size-3.5" /> Reset all
            </button>
          </div>
          <div>
            <p className="mb-1 text-[12px] text-ink-2">Applies to</p>
            <div role="radiogroup" aria-label="Applies to" className="grid grid-cols-2 overflow-hidden rounded-sm border border-line">
              {(
                [
                  ["image", "Whole image", true],
                  ["layer", "This layer", layerOk],
                ] as const
              ).map(([v, label, ok]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={target === v}
                  disabled={!ok}
                  onClick={() => setOpEdit({ ...opEdit, target: v, asLayer: false })}
                  className={cn("h-8 text-[12px] transition-colors disabled:opacity-40", target === v ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
              {target === "image"
                ? op.layerable
                  ? "Added as an adjustment layer on top: everything below changes, and you can edit or delete it later."
                  : "Applied to a merged copy on a new layer on top: your layers stay as they are."
                : `Only “${active.name}” changes.`}
            </p>
          </div>
          <ParamsEditor op={op} value={opEdit.params} onChange={(params) => setOpEdit({ ...opEdit, params })} hist={opHist} />
          {op.layerable && target === "layer" && (
            <div className="rounded-sm border border-line bg-paper px-2.5 py-2">
              <Check2 checked={opEdit.asLayer} onChange={(asLayer) => setOpEdit({ ...opEdit, asLayer })} label="As an adjustment layer (editable later)" />
            </div>
          )}
          {pixelsOnly && active.kind === "smart" && !doc.selection && (
            <p className="text-[12px] text-accent">Applied non-destructively as a Smart Filter (toggle or re-edit anytime).</p>
          )}
          {pixelsOnly && (active.kind === "text" || active.kind === "shape" || active.kind === "vector") && <p className="text-[12px] text-warning">Applying turns “{active.name}” into pixels.</p>}
          {doc.selection && <p className="text-[12px] text-ink-3">Only the selected area changes.</p>}
          {/* Stays in reach at the bottom of the panel, however long the settings are. */}
          <div className="sticky bottom-0 -mx-3 -mb-3 flex gap-2 border-t border-line bg-surface/95 px-3 py-2.5 backdrop-blur">
            <Btn onClick={() => setOpEdit(null)} className="flex-1">
              Cancel
            </Btn>
            <Btn primary onClick={() => void applyOpEdit()} className="flex-1" disabled={target === "layer" && !opEdit.asLayer && !layerOk}>
              <Check aria-hidden className="size-4" /> {opEdit.filterId ? "Update filter" : "Apply"}
            </Btn>
          </div>
        </motion.div>
      );
    }
    if (styleEdit && active.kind !== "adjustment") {
      return (
        <div className="p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[14px] font-medium text-ink">Layer style</p>
            <button type="button" onClick={() => setStyleEdit(false)} className="text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">
              Done
            </button>
          </div>
          <EffectsEditor value={active.effects ?? NO_EFFECTS} onChange={(effects) => commit(replaceLayer(doc, active.id, { effects }), "Layer Style", `fx:${active.id}`)} />
        </div>
      );
    }
    if (active.kind === "adjustment" && active.adjust) {
      const op = adjustmentById(active.adjust.id);
      if (!op) return null;
      return (
        <div className="space-y-3 p-3">
          <p className="text-[14px] font-medium text-ink">{op.label} <span className="font-mono text-[12px] font-normal text-ink-3">adjustment layer</span></p>
          <ParamsEditor op={op} value={active.adjust.params} onChange={(params) => commit(replaceLayer(doc, active.id, { adjust: { id: op.id, params } }), `Edit ${op.label}`, `adj:${active.id}`)} hist={opHist} />
          <p className="text-[12px] leading-relaxed text-ink-3">Affects every layer below it. Add a mask to limit where, or clip it (Alt+Ctrl+G) to change one layer only.</p>
        </div>
      );
    }
    if (active.kind === "text" && active.text) {
      const t = active.text;
      return (
        <div className="space-y-2.5 p-3">
          <p className="text-[14px] font-medium text-ink">Text</p>
          <textarea
            ref={textRef}
            value={t.text}
            onChange={(e) => setText({ text: e.target.value.slice(0, 2000) })}
            rows={3}
            aria-label="Text"
            className="w-full resize-y rounded-sm border border-line bg-surface px-2 py-1.5 text-[14px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-accent/20"
          />
          <div className="flex items-center gap-1.5">
            <Select label="Font" value={t.font} onChange={(font) => setText({ font })} options={fontsList.map((f) => ({ value: f.family, label: f.label }))} className="min-w-0 flex-1" />
            <label className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-sm border border-line px-2 text-[12px] text-ink-2 hover:text-ink">
              Upload…
              <input
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadFont(file);
                }}
              />
            </label>
          </div>
          <div className="space-y-1.5 rounded-sm border border-line bg-paper/40 p-2">
            <p className="label-mono text-ink-3">Google Fonts</p>
            <div className="flex gap-1">
              <input
                type="text"
                value={gFontInput}
                onChange={(e) => setGFontInput(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void loadGoogleFont(gFontInput);
                  }
                }}
                placeholder="e.g. Bebas Neue"
                aria-label="Google Font name"
                className="h-7 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 text-[12px] text-ink outline-none focus:border-ink"
              />
              <button
                type="button"
                onClick={() => void loadGoogleFont(gFontInput)}
                className="h-7 shrink-0 rounded-sm border border-line bg-surface px-2 text-[12px] text-ink-2 hover:text-ink"
              >
                Load
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {POPULAR_GOOGLE_FONTS.map((gf) => (
                <button
                  key={gf}
                  type="button"
                  onClick={() => void loadGoogleFont(gf)}
                  className="h-6 rounded-sm border border-line bg-surface px-1.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  {gf}
                </button>
              ))}
            </div>
          </div>
          <RangeRow label="Size" value={Math.round(t.size)} min={6} max={600} unit=" px" onChange={(size) => setText({ size })} />
          <RangeRow label="Line height" value={t.lineHeight} min={0.7} max={3} step={0.05} onChange={(lineHeight) => setText({ lineHeight })} />
          <RangeRow label="Letter spacing" value={t.letterSpacing} min={-20} max={100} unit=" px" onChange={(letterSpacing) => setText({ letterSpacing })} />
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-2">Colour</span>
            <ColorWell value={t.color} onChange={(color) => setText({ color })} label="Text colour" hex />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Check2 checked={!!t.stroke} onChange={(v) => setText({ stroke: v ? { color: "#ffffff", width: Math.max(2, Math.round(t.size / 16)) } : null })} label="Outline" />
            {t.stroke && (
              <span className="flex items-center gap-2">
                <ColorWell value={t.stroke.color} onChange={(color) => setText({ stroke: { ...t.stroke!, color } })} label="Outline colour" />
                <input type="number" aria-label="Outline width" min={1} max={100} value={t.stroke.width} onChange={(e) => setText({ stroke: { ...t.stroke!, width: Number(e.target.value) } })} className="h-7 w-14 rounded-sm border border-line bg-surface px-1.5 font-mono text-[12px]" />
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Check2 checked={!!t.background} onChange={(v) => setText({ background: v ? "#15140f" : null })} label="Label background" />
            {t.background && <ColorWell value={t.background} onChange={(background) => setText({ background })} label="Label colour" />}
          </div>
          <p className="text-[12px] text-ink-3">Style the whole layer with Layer → Layer style (shadow, glow, stroke).</p>
        </div>
      );
    }
    if (active.kind === "vector" && active.vector) {
      const paths = layerPaths(active);
      const picked = nodeSel?.layerId === active.id ? nodeSel.path : paths.length - 1;
      return (
        <div className="space-y-3 p-3">
          <div>
            <p className="text-[14px] font-medium text-ink">{active.name}</p>
            <p className="font-mono text-[12px] text-ink-3">vector layer · stays sharp at any size</p>
          </div>
          <VectorPanel
            paths={paths}
            selected={picked}
            onSelect={(i) => setNodeSel({ layerId: active.id, path: i, sub: null, node: null })}
            onChange={(next, label, key) => commit(replaceLayer(doc, active.id, withPaths(active, next)), label, key)}
            onEditPoints={() => {
              setTool("node");
              setNodeSel({ layerId: active.id, path: Math.max(0, picked), sub: null, node: null });
            }}
            onPen={() => setTool("pen")}
          />
        </div>
      );
    }
    if (active.kind === "shape" && active.shape) {
      const s = active.shape;
      return (
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[14px] font-medium text-ink">Shape</p>
            <button type="button" onClick={shapeToVector} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line px-2 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink">
              <PenTool aria-hidden className="size-3.5" /> Edit as path
            </button>
          </div>
          <RangeRow label="Width" value={Math.round(Math.abs(s.w))} min={2} max={Math.max(doc.w, Math.abs(s.w))} unit=" px" onChange={(w) => setShape({ w: Math.sign(s.w || 1) * w })} />
          <RangeRow label="Height" value={Math.round(Math.abs(s.h))} min={2} max={Math.max(doc.h, Math.abs(s.h))} unit=" px" onChange={(h) => setShape({ h: Math.sign(s.h || 1) * h })} />
          {s.kind !== "line" && s.kind !== "arrow" && (
            <div className="flex items-center justify-between">
              <Check2 checked={!!s.fill} onChange={(v) => setShape({ fill: v ? fg : null })} label="Fill" />
              {s.fill && <ColorWell value={s.fill} onChange={(fill) => setShape({ fill })} label="Fill colour" hex />}
            </div>
          )}
          <div className="flex items-center justify-between">
            <Check2 checked={!!s.stroke} onChange={(v) => setShape({ stroke: v ? "#15140f" : null })} label="Stroke" />
            {s.stroke && <ColorWell value={s.stroke} onChange={(stroke) => setShape({ stroke })} label="Stroke colour" hex />}
          </div>
          <RangeRow label="Stroke width" value={s.strokeWidth} min={1} max={200} unit=" px" onChange={(strokeWidth) => setShape({ strokeWidth })} />
          {s.kind === "rect" && <RangeRow label="Corner radius" value={s.radius} min={0} max={Math.round(Math.min(Math.abs(s.w), Math.abs(s.h)) / 2)} unit=" px" onChange={(radius) => setShape({ radius })} />}
          {(s.kind === "polygon" || s.kind === "star") && <RangeRow label={s.kind === "star" ? "Points" : "Sides"} value={s.sides} min={3} max={40} onChange={(sides) => setShape({ sides })} />}
        </div>
      );
    }
    if (active.kind === "smart" && active.smart) {
      const sm = active.smart;
      const metrics = smartMetrics(sm.matrix);
      const linkedCount = doc.layers.filter((x) => x.kind === "smart" && x.smart?.sourceId === sm.sourceId).length;
      return (
        <div className="space-y-3 p-3">
          <div className="flex items-start gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ink text-paper shadow-card">
              <Box aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-ink">{active.name}</p>
              <p className="font-mono text-[11px] text-ink-3">
                Smart Object · {sm.sourceDoc.w} × {sm.sourceDoc.h} px ({sm.sourceDoc.layers.length} {sm.sourceDoc.layers.length === 1 ? "layer" : "layers"})
              </p>
              <p className="font-mono text-[11px] text-ink-2">
                Scale {Math.round(metrics.scaleX * 100)}% × {Math.round(metrics.scaleY * 100)}% · {metrics.rotationDeg}°
                {linkedCount > 1 && ` · Linked ×${linkedCount}`}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Btn primary onClick={() => enterSmartEdit(active.id)}>
              <Box aria-hidden className="size-3.5" /> Edit Contents
            </Btn>
            <Btn onClick={() => layerApi.replaceSmart(active.id)}>
              <RefreshCw aria-hidden className="size-3.5" /> Replace…
            </Btn>
            <Btn onClick={beginTransform}>Free transform</Btn>
            <Btn onClick={() => layerApi.resetSmartTransform(active.id)}>
              <RotateCcw aria-hidden className="size-3.5" /> Reset transform
            </Btn>
            <Btn onClick={() => layerApi.duplicateSmartCopy(active.id)}>New via Copy</Btn>
            <Btn onClick={() => layerApi.exportSmart(active.id)}>
              <FileOutput aria-hidden className="size-3.5" /> Export…
            </Btn>
            <Btn onClick={layerApi.openStyle}>Layer style</Btn>
            <Btn onClick={() => layerApi.rasterize(active.id)}>
              <LayersIcon aria-hidden className="size-3.5" /> Rasterize
            </Btn>
          </div>
          <div className="space-y-2 rounded-sm border border-line bg-paper/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => layerApi.toggleSmartFilters(active.id)} className="label-mono flex items-center gap-1.5 text-ink-2 hover:text-ink">
                <Eye aria-hidden className={cn("size-3.5", !sm.filtersOn && "opacity-35")} />
                Smart Filters ({sm.filters.length})
              </button>
              <button type="button" onClick={() => setPanel("adjust")} className="text-[12px] text-accent hover:underline">
                + Add filter
              </button>
            </div>
            {sm.filters.length === 0 ? (
              <p className="text-[12px] text-ink-3">Apply any adjustment or filter from Adjust/Filter to attach it non-destructively.</p>
            ) : (
              <ul className="space-y-2">
                {sm.filters.map((f) => (
                  <li key={f.id} className="rounded-sm border border-line bg-surface p-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={f.enabled ? `Hide ${f.label}` : `Show ${f.label}`}
                        onClick={() => layerApi.toggleSmartFilter(active.id, f.id)}
                        className={cn("text-ink-2 hover:text-ink", (!sm.filtersOn || !f.enabled) && "opacity-35")}
                      >
                        <Eye aria-hidden className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => layerApi.editSmartFilter(active.id, f.id)}
                        className={cn("min-w-0 flex-1 truncate text-left text-[12px] font-medium text-ink hover:underline", !f.enabled && "line-through opacity-50")}
                      >
                        {f.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => layerApi.removeSmartFilter(active.id, f.id)}
                        aria-label={`Delete ${f.label}`}
                        className="text-ink-3 hover:text-danger"
                      >
                        <Trash2 aria-hidden className="size-3.5" />
                      </button>
                    </div>
                    <RangeRow
                      label="Filter opacity"
                      value={Math.round(f.opacity * 100)}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => commit(updateSmartFilter(doc, active.id, f.id, { opacity: v / 100 }, { fg, bg }), "Smart Filter Opacity", `sf-op:${f.id}`)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {doc.editMask && active.mask && (
            <div className="space-y-1.5 rounded-sm border border-line bg-paper p-2.5 text-[12px] text-ink-2">
              <p>Painting on the <strong className="font-medium text-ink">mask</strong>: black hides, white shows.</p>
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => commit(applyMask(doc), "Apply Mask")}>Apply</Btn>
                <Btn onClick={() => commit(replaceLayer(doc, active.id, { maskOn: !active.maskOn }), "Toggle Mask")}>{active.maskOn ? "Disable" : "Enable"}</Btn>
                <Btn onClick={() => commit({ ...replaceLayer(doc, active.id, { mask: null }), editMask: false }, "Delete Mask")}>Delete</Btn>
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-3 p-3">
        <div>
          <p className="text-[14px] font-medium text-ink">{active.name}</p>
          <p className="font-mono text-[12px] text-ink-3">
            {active.canvas.width} × {active.canvas.height} px {doc.editMask && active.mask ? "· editing the mask" : ""}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Btn onClick={beginTransform}>Free transform</Btn>
          <Btn onClick={layerApi.openStyle}>Layer style</Btn>
          <Btn onClick={layerApi.addMask} disabled={!!active.mask}>
            Add mask
          </Btn>
          <Btn onClick={() => void removeBackground()}>Remove BG</Btn>
        </div>
        {doc.editMask && active.mask && (
          <div className="space-y-1.5 rounded-sm border border-line bg-paper p-2.5 text-[12px] text-ink-2">
            <p>
              Painting on the <strong className="font-medium text-ink">mask</strong>: black hides, white shows. The eraser does the opposite.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={() => commit(applyMask(doc), "Apply Mask")}>Apply</Btn>
              <Btn onClick={() => commit(replaceLayer(doc, active.id, { maskOn: !active.maskOn }), "Toggle Mask")}>{active.maskOn ? "Disable" : "Enable"}</Btn>
              <Btn onClick={() => commit({ ...replaceLayer(doc, active.id, { mask: null }), editMask: false }, "Delete Mask")}>Delete</Btn>
            </div>
          </div>
        )}
        <div className="rounded-sm border border-dashed border-line p-2.5">
          <p className="label-mono mb-1 text-ink-3">{TOOLS[tool].label}</p>
          <p className="text-[12px] leading-relaxed text-ink-2">{TOOLS[tool].hint}</p>
        </div>
      </div>
    );
  };

  const quickFix = (run: string) => {
    if (run === "remove-bg") return void removeBackground();
    if (run === "subject") return void selectSubject();
    const op = adjustmentById(run) ?? FILTERS.find((f) => f.id === run);
    if (op) openOp(op);
  };

  const effectSections = [
    ...ADJUST_ORDER.map((g) => ({ group: g, ops: ADJUSTMENTS.filter((a) => a.group === g) })),
    ...filterGroups.map((g) => ({ group: g, ops: FILTERS.filter((f) => f.group === g) })),
  ];
  const adjustPanel = () => (
    <div className="space-y-4 p-3">
      <div>
        <p className="label-mono mb-2 text-ink-3">Quick fixes</p>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_FIXES.map((q) => (
            <button key={q.label} type="button" onClick={() => quickFix(q.run)} className="flex h-9 items-center gap-2 rounded-sm border border-line bg-surface px-2.5 text-left text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
              <q.icon aria-hidden className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
              <span className="truncate">{q.label}</span>
            </button>
          ))}
        </div>
      </div>
      <EffectsBrowser sections={effectSections} active={opEdit?.op.id ?? null} onPick={openOp} previews={effectPreviews} />
    </div>
  );

  const looksPanel = () => {
    if (!doc || !active) return null;
    const thumbs = lookThumbs.urls;
    return (
      <div className="space-y-3 p-3">
        <div className="flex items-baseline justify-between">
          <p className="label-mono text-ink-3">Looks</p>
          <p className="text-[12px] text-ink-3">Tap one, then set the amount</p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
            {LOOK_OPS.map((op, i) => (
              <motion.button
                key={op.id}
                type="button"
                onClick={() => openOp(op)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.015, 0.3), duration: 0.25 }}
                className={cn("group overflow-hidden rounded-sm border text-left transition-colors", opEdit?.op.id === op.id ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink-3")}
              >
                <span className={cn("relative block aspect-square overflow-hidden", CHECKER_BG)}>
                  {thumbs[op.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[op.id]} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <span className="block size-full animate-pulse bg-paper-2" />
                  )}
                </span>
                <span className="block truncate px-1.5 py-1 text-[12px] text-ink-2">{op.label.replace(/ look$/, "")}</span>
              </motion.button>
            ))}
          </div>
      </div>
    );
  };

  const fontMap = { sans: familyFor("sans", ""), serif: familyFor("serif", ""), mono: familyFor("mono", ""), impact: familyFor("impact", ""), hand: familyFor("hand", "") };

  const createPanel = () => {
    if (!doc) return null;
    const set = STICKER_SETS[stickerSet];
    return (
      <div className="space-y-5 p-3">
        <section>
          <p className="label-mono mb-2 text-ink-3">Text styles</p>
          <div className="grid grid-cols-4 gap-1.5">
            {TEXT_STYLES.map((st) => (
              <button
                key={st.id}
                type="button"
                title={st.label}
                onClick={() => {
                  const { doc: next, layer } = addStyledText(doc, st, opts.text, fontMap);
                  commit(next, `Add ${st.label} text`, `text:${layer.id}`);
                  ensureFont(layer.text!).then(() => {
                    const cur = docRef.current;
                    if (cur?.layers.some((x) => x.id === layer.id)) commit(replaceLayer(cur, layer.id, { canvas: renderText(layer.text!) }), `Add ${st.label} text`, `text:${layer.id}`);
                  });
                  setPanel("properties");
                  requestAnimationFrame(() => {
                    textRef.current?.focus();
                    textRef.current?.select();
                  });
                }}
                className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-sm border border-line bg-ink text-paper transition-transform hover:-translate-y-0.5 hover:border-ink-3"
              >
                <span
                  className="text-[20px] leading-none"
                  style={{
                    fontFamily: st.text.fontKey ? fontMap[st.text.fontKey as keyof typeof fontMap] : undefined,
                    fontWeight: st.text.weight ?? 700,
                    fontStyle: st.text.italic ? "italic" : undefined,
                    color: st.text.color === "#15140f" ? "#fff" : st.text.color,
                    WebkitTextStroke: st.text.stroke ? "1px #15140f" : undefined,
                    textShadow: st.effects?.glow ? "0 0 8px #e879f9" : undefined,
                    background: st.text.background ? st.text.background : undefined,
                    padding: st.text.background ? "0 4px" : undefined,
                  }}
                >
                  {st.sample}
                </span>
                <span className="text-[12px] text-paper/70">{st.label}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="label-mono text-ink-3">Stickers</p>
            <div className="flex gap-0.5 overflow-x-auto">
              {STICKER_SETS.map((g, i) => (
                <button key={g.label} type="button" onClick={() => setStickerSet(i)} className={cn("h-6 shrink-0 rounded-sm px-1.5 text-[12px]", i === stickerSet ? "bg-ink text-paper" : "text-ink-3 hover:text-ink")}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {set.items.map((e) => (
              <button key={e} type="button" aria-label={`Add sticker ${e}`} onClick={() => commit(addSticker(doc, e), "Add Sticker")} className="flex aspect-square items-center justify-center rounded-sm text-[20px] transition-transform hover:scale-125 hover:bg-paper-2">
                {e}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-3">Stickers are layers: drag with Move, resize with Free transform (Shift+T).</p>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="label-mono text-ink-3">Frames</p>
            <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
              in <ColorWell value={fg} onChange={setFg} label="Frame colour (foreground)" size="size-5" />
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {FRAMES.map((f) => (
              <button key={f.id} type="button" onClick={() => commit(addFrame(doc, f.id as FrameId, fg), `Add ${f.label} Frame`)} className="h-9 rounded-sm border border-line px-1 text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
                {f.label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className="label-mono mb-2 text-ink-3">Background (AI)</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Btn onClick={() => void background("blur")}>Portrait blur</Btn>
            <Btn onClick={() => void removeBackground()}>Remove</Btn>
            <Btn onClick={() => void background("color")}>
              <span className="size-3 rounded-[2px] border border-line" style={{ background: bg }} /> Replace
            </Btn>
            <Btn onClick={() => void selectSubject()}>Select subject</Btn>
          </div>
          <p className="mt-1.5 text-[12px] text-ink-3">Replace uses the background colour (the lower swatch in the toolbar).</p>
        </section>
        <section>
          <p className="label-mono mb-2 text-ink-3">Watermark</p>
          <div className="space-y-2 rounded-sm border border-line bg-paper/40 p-2.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={wmText}
                onChange={(e) => setWmText(e.target.value.slice(0, 60))}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Watermark text"
                placeholder="© Studio"
                className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink"
              />
              <ColorWell value={wmColor} onChange={setWmColor} label="Watermark colour" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ["tile", "Tiled pattern"],
                  ["corner", "Bottom-right"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWmMode(m)}
                  className={cn("h-7 rounded-sm text-[12px]", wmMode === m ? "bg-ink text-paper" : "border border-line bg-surface text-ink-2 hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
            <RangeRow label="Opacity" value={wmOpacity} min={5} max={100} unit="%" onChange={setWmOpacity} />
            <RangeRow label="Text size" value={wmSize} min={2} max={18} unit="%" onChange={setWmSize} />
            {wmMode === "tile" && <RangeRow label="Angle" value={wmAngle} min={-45} max={45} unit="°" signed onChange={setWmAngle} />}
            <Btn
              primary
              className="w-full"
              onClick={() => commit(addWatermark(doc, { text: wmText, color: wmColor, opacity: wmOpacity, mode: wmMode, angle: wmAngle, size: wmSize }), "Add Watermark")}
            >
              Add watermark layer
            </Btn>
          </div>
        </section>
        <section>
          <p className="label-mono mb-2 text-ink-3">More</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Btn onClick={() => collageRef.current?.click()}>Collage from photos</Btn>
            <Btn onClick={() => void upscale(2)}>
              <ImageUpscale aria-hidden className="size-4" /> Upscale 2× (AI)
            </Btn>
          </div>
        </section>
      </div>
    );
  };

  const infoPanel = () =>
    doc && (
      <div className="space-y-3 p-3">
        <div className="rounded-sm border border-line bg-paper p-1">
          <HistogramChart hist={docHist} channel="rgb" height={90} />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[12px]">
          <dt className="text-ink-3">X, Y</dt>
          <dd className="text-ink">{cursor ? `${cursor.x}, ${cursor.y}` : "—"}</dd>
          <dt className="text-ink-3">Colour</dt>
          <dd className="flex items-center gap-1.5 text-ink">
            {cursor?.hex && <span className="size-3 rounded-[2px] border border-line" style={{ background: cursor.hex }} />}
            {cursor?.hex ?? "—"}
          </dd>
          <dt className="text-ink-3">RGB</dt>
          <dd className="text-ink">{cursor?.hex ? hexToRgb(cursor.hex).join(", ") : "—"}</dd>
          <dt className="text-ink-3">Canvas</dt>
          <dd className="text-ink">
            {doc.w} × {doc.h}
          </dd>
          <dt className="text-ink-3">Layers</dt>
          <dd className="text-ink">{doc.layers.length}</dd>
          {doc.selection && (
            <>
              <dt className="text-ink-3">Selection</dt>
              <dd className="text-ink">
                {doc.selection.bounds.w} × {doc.selection.bounds.h}
              </dd>
            </>
          )}
        </dl>
      </div>
    );

  const tabs: { id: Panel; label: string; icon: typeof Info }[] = [
    { id: "properties", label: "Properties", icon: SlidersHorizontal },
    { id: "color", label: "Color", icon: Pipette },
    { id: "looks", label: "Looks", icon: Palette },
    { id: "adjust", label: "Adjust", icon: Sparkles },
    { id: "create", label: "Create", icon: Sticker },
    { id: "history", label: "History", icon: HistoryIcon },
    { id: "info", label: "Info", icon: Info },
  ];

  const filePickers = (
    <>
      <input ref={fileRef} type="file" accept="image/*,.psd,.psb,.dwlp,.svg,.avif,.heic" className="sr-only" tabIndex={-1} onChange={(e) => (e.target.files?.[0] && void openAny(e.target.files[0]), (e.target.value = ""))} />
      <input ref={collageRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(e) => (void collageFrom(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      <input ref={placeRef} type="file" accept="image/*,.psd,.psb,.dwlp,.svg" multiple className="sr-only" tabIndex={-1} onChange={(e) => (Array.from(e.target.files ?? []).forEach((f) => void placeFile(f, undefined, true)), (e.target.value = ""))} />
      <input ref={replaceSmartRef} type="file" accept="image/*,.psd,.psb,.dwlp" className="sr-only" tabIndex={-1} onChange={(e) => (e.target.files?.[0] && void replaceSmartFromFile(e.target.files[0]), (e.target.value = ""))} />
    </>
  );

  const dialogs = (
    <>
      <NewDocDialog open={dialog === "new"} onClose={() => setDialog(null)} onCreate={(w, h, b, name) => (setDialog(null), start(newDoc(w, h, b, name), "New"))} />
      <SizeDialog
        open={dialog === "image-size" || dialog === "canvas-size"}
        mode={dialog === "canvas-size" ? "canvas" : "image"}
        doc={doc}
        onClose={() => setDialog(null)}
        onApply={(w, h, anchor, fill) => {
          const d = docRef.current!;
          const mode = dialog;
          setDialog(null);
          if (mode === "image-size") {
            setBusy("Resizing…");
            nextFrame().then(() => {
              commit(resizeImage(d, w, h), "Image Size");
              setBusy(null);
              requestAnimationFrame(() => fit(undefined, true));
            });
          } else {
            commit(resizeCanvas(d, w, h, anchor, fill), "Canvas Size");
            requestAnimationFrame(() => fit(undefined, true));
          }
        }}
      />
      <NumberDialog open={dialog === "rotate"} title="Rotate canvas" label="Angle" unit="°" initial={15} min={-180} max={180} onClose={() => setDialog(null)} onApply={(a) => (setDialog(null), commit(transformCanvas(docRef.current!, { angle: a }), "Rotate Canvas"), requestAnimationFrame(() => fit(undefined, true)))} />
      <NumberDialog open={dialog === "feather"} title="Feather selection" label="Radius" unit=" px" initial={10} min={1} max={250} onClose={() => setDialog(null)} onApply={(r) => { setDialog(null); const d = docRef.current!; if (d.selection) commit({ ...d, selection: featherSelection(d.selection, d, r) }, "Feather"); }} />
      <NumberDialog open={dialog === "expand"} title="Expand selection" label="By" unit=" px" initial={8} min={1} max={250} onClose={() => setDialog(null)} onApply={(r) => { setDialog(null); const d = docRef.current!; if (d.selection) commit({ ...d, selection: growMask(d.selection, d, r) }, "Expand"); }} />
      <NumberDialog open={dialog === "contract"} title="Contract selection" label="By" unit=" px" initial={8} min={1} max={250} onClose={() => setDialog(null)} onApply={(r) => { setDialog(null); const d = docRef.current!; if (d.selection) commit({ ...d, selection: growMask(d.selection, d, -r) }, "Contract"); }} />
      <NumberDialog
        open={dialog === "color-range"}
        title={`Select colour range (${fg})`}
        label="Fuzziness"
        unit=""
        initial={25}
        min={1}
        max={100}
        onClose={() => setDialog(null)}
        onApply={(tol) => {
          setDialog(null);
          const d = docRef.current!;
          const img = ctx2d(flatten(d), true).getImageData(0, 0, d.w, d.h);
          const sel = fromMask(colorMask(img, hexToRgb(fg), tol));
          if (!sel) say("Nothing matches that colour. Pick it with the eyedropper (I) first.");
          commit({ ...d, selection: sel }, "Color Range");
        }}
      />
      <FillDialog open={dialog === "fill"} onClose={() => setDialog(null)} onApply={doFill} hasSelection={sel} />
      <StrokeDialog
        open={dialog === "stroke"}
        fg={fg}
        onClose={() => setDialog(null)}
        onApply={(c, w, where) => {
          setDialog(null);
          const d = docRef.current!;
          if (activeLayer(d).kind === "smart" && !d.editMask) return setSmartPrompt(activeLayer(d).id);
          commit(strokeSelection(d, c, w, where), "Stroke");
        }}
      />
      <ExportDialog
        open={dialog === "export"}
        doc={doc}
        onClose={() => setDialog(null)}
        onSaved={(b, n) => (download(b, n), setDialog(null))}
        onPsd={() => (setDialog(null), void savePsd())}
        onProject={() => (setDialog(null), void saveProject())}
        onCopy={() => doc && copyToClipboard(doc).then(() => say("Copied to the clipboard."), () => say("This browser won't let us use the clipboard."))}
        onSvg={() => (setDialog(null), saveSvg())}
      />
      <ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
    </>
  );

  /* ----- Start screen ----- */

  if (!doc) {
    return (
      <div className={FONT_CLASSES}>
        {filePickers}
        {dialogs}
        <Workbench steps={stepsFor(tool0)} current={0} footer={<>Everything happens in your browser: your pictures never leave your device (only Select subject and Remove background use our server). Your last edit is kept on this device so you can pick it up again.</>}>
          <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <FileDrop accept="image/*,.psd,.psb,.dwlp" title="Drop a photo, PSD or project here" formats="JPG · PNG · WebP · GIF · AVIF · SVG · PSD · .dwlp" error={rejected} onFile={(f) => void openAny(f)} />
              {busy && (
                <p className="flex items-center gap-2 text-[13px] text-ink-2">
                  <Loader2 aria-hidden className="size-4 animate-spin" /> {busy}
                </p>
              )}
            </div>
            <div className="space-y-3">
              <button type="button" onClick={() => setDialog("new")} className="flex w-full items-center gap-3 rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-ink-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-ink text-paper">
                  <FilePlus2 aria-hidden className="size-5" />
                </span>
                <span>
                  <span className="block text-[14px] font-medium text-ink">New blank canvas</span>
                  <span className="text-[12px] text-ink-3">Instagram, story, thumbnail, A4, 4K or any size</span>
                </span>
              </button>
              {session && (
                <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
                  {session.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.url} alt="" className={cn("size-14 shrink-0 rounded-sm border border-line object-contain", "bg-paper")} />
                  ) : (
                    <span className="size-14 shrink-0 rounded-sm border border-line bg-paper" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{session.json.name}</p>
                    <p className="font-mono text-[12px] text-ink-3">
                      {session.json.w} × {session.json.h} · {session.json.layers.length} layers · {new Date(session.savedAt).toLocaleString()}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Btn
                        primary
                        onClick={async () => {
                          setBusy("Restoring…");
                          try {
                            start(await deserialize(session.json, session.files), "Restore");
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        Continue editing
                      </Btn>
                      <Btn onClick={() => (clearSession(), setSession(null))}>Forget</Btn>
                    </div>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  // A sample to explore with: gradient sky, sun and hills, as separate layers.
                  const d = newDoc(1600, 1000, null, "Sample");
                  const sky = makeCanvas(1600, 1000);
                  const sg = ctx2d(sky);
                  const gr = sg.createLinearGradient(0, 0, 0, 1000);
                  gr.addColorStop(0, "#2b1055");
                  gr.addColorStop(0.55, "#d53369");
                  gr.addColorStop(1, "#ffcc70");
                  sg.fillStyle = gr;
                  sg.fillRect(0, 0, 1600, 1000);
                  const sun = makeCanvas(1600, 1000);
                  const ug = ctx2d(sun);
                  ug.fillStyle = "#ffe29a";
                  ug.beginPath();
                  ug.arc(1050, 560, 170, 0, Math.PI * 2);
                  ug.fill();
                  const hills = makeCanvas(1600, 1000);
                  const hg = ctx2d(hills);
                  hg.fillStyle = "#15140f";
                  hg.beginPath();
                  hg.moveTo(0, 1000);
                  for (let x = 0; x <= 1600; x += 20) hg.lineTo(x, 760 + Math.sin(x / 140) * 60 + Math.sin(x / 47) * 18);
                  hg.lineTo(1600, 1000);
                  hg.fill();
                  const layers = [newLayer({ name: "Sky", canvas: sky }), newLayer({ name: "Sun", canvas: sun, effects: { ...NO_EFFECTS, glow: { ...NO_EFFECTS.glow, on: true, size: 60 } } }), newLayer({ name: "Hills", canvas: hills })];
                  start({ ...d, layers, active: layers[2].id }, "Sample");
                }}
                className="flex w-full items-center gap-3 rounded-md border border-dashed border-line p-3 text-left text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                <Sparkles aria-hidden className="size-4 shrink-0" />
                Try it on a sample picture with layers
              </button>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[12px] text-ink-3">
                {["Layers, masks, blend modes", "Adjustment layers", "Selections and magic wand", "Healing, clone, content-aware", "Brushes, dodge and burn", "30+ adjustments and filters", "Text and shapes", "Opens and saves PSD"].map((f) => (
                  <li key={f} className="flex items-center gap-1.5">
                    <Check aria-hidden className="size-3 shrink-0 text-ink" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Workbench>
      </div>
    );
  }

  /* ----- The workspace ----- */

  // Full screen is portalled to <body>: the page's animated wrappers would otherwise trap it under the navbar.
  const workspace = (
    <div className={FONT_CLASSES}>
      {filePickers}
      {dialogs}
      <Workbench
        steps={stepsFor(tool0)}
        current={step}
        className={cn(fullscreen && "fixed inset-0 z-[100] flex flex-col rounded-none border-0")}
        footer={
          fullscreen ? undefined : (
            <>Edited in your browser: your picture never leaves this device, except when you use Select subject or Remove background. Your work is kept on this device until you start something new.</>
          )
        }
      >
        <div ref={rootRef} className={cn("flex flex-col", fullscreen ? "min-h-0 flex-1" : "h-[calc(100dvh-76px)] min-h-[520px] lg:h-[min(86vh,980px)] lg:min-h-[620px] 2xl:h-[min(90dvh,1340px)]")}>
          {/* Menu bar (one "Menu" button on narrow screens, so nothing hides off the edge) */}
          <div className="flex items-center gap-1 border-b border-line bg-paper/60 px-1.5 py-1" data-lenis-prevent>
            <div className="min-w-0 flex-1 md:hidden">
              <CompactMenu menus={menus} />
            </div>
            <div className="hidden min-w-0 flex-1 overflow-x-auto md:block">
              <MenuBar menus={menus} />
            </div>
            <span className="hidden max-w-40 truncate font-mono text-[12px] text-ink-3 md:inline" title={doc.name}>
              {doc.name} · {Math.round(z * 100)}%
            </span>
            <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={hist!.index === 0 || !!busy} onClick={undo} className="inline-flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-35">
              <Undo2 aria-hidden className="size-4" />
            </button>
            <button type="button" aria-label="Redo" title="Redo (Shift+Ctrl+Z)" disabled={hist!.index >= hist!.entries.length - 1 || !!busy} onClick={redo} className="inline-flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-35">
              <Redo2 aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Hold to compare with the original"
              aria-pressed={compare}
              title="Hold to see the original (or hold the backslash key)"
              disabled={hist!.index === 0}
              onPointerDown={() => setComparing(true)}
              onPointerUp={() => setComparing(false)}
              onPointerLeave={() => compareRef.current && setComparing(false)}
              onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setComparing(true)}
              onKeyUp={() => setComparing(false)}
              className={cn("inline-flex size-8 items-center justify-center rounded-sm transition-colors disabled:opacity-35", compare ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
            >
              <Eye aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Before / After split wipe"
              aria-pressed={splitCompare}
              title="Toggle interactive Before / After split wipe"
              disabled={hist!.index === 0}
              onClick={toggleSplitCompare}
              className={cn("inline-flex size-8 items-center justify-center rounded-sm transition-colors disabled:opacity-35", splitCompare ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
            >
              <SquareSplitHorizontal aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label={panelOpen ? "Hide side panels" : "Show side panels"}
              aria-pressed={panelOpen}
              title="Toggle panels"
              onClick={() => setPanelOpen((o) => !o)}
              className={cn("hidden size-8 items-center justify-center rounded-sm transition-colors md:inline-flex lg:hidden", panelOpen ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
            >
              <PanelRight aria-hidden className="size-4" />
            </button>
            <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setDialog("shortcuts")} className="hidden size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink sm:inline-flex">
              <Keyboard aria-hidden className="size-4" />
            </button>
            <button type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"} onClick={() => setFullscreen((f) => !f)} className="inline-flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink">
              {fullscreen ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
            </button>
            <button type="button" onClick={() => setDialog("export")} className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[13px] font-medium text-paper hover:bg-ink/85">
              <Download aria-hidden className="size-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>

          {smartStack.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 py-1.5 text-[12px]">
              <Box aria-hidden className="size-3.5 shrink-0 text-accent" />
              <span className="font-medium text-ink">
                {smartStack.map((f) => f.parentName).join(" → ")} →{" "}
                <strong className="font-semibold">{smartStack[smartStack.length - 1].layerName}</strong>
              </span>
              <span className="text-ink-3">(Editing Smart Object contents)</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => exitSmartEdit(false)}
                  className="inline-flex h-6 items-center rounded-sm border border-line bg-surface px-2 text-ink-2 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => exitSmartEdit(true)}
                  className="inline-flex h-6 items-center gap-1 rounded-sm bg-ink px-2.5 font-medium text-paper hover:bg-ink/85"
                >
                  <Check aria-hidden className="size-3" /> Save &amp; Return (Ctrl+S)
                </button>
              </div>
            </div>
          )}

          {/* Tool options */}
          <div className="border-b border-line">
            <OptionsBar
              tool={tool}
              brush={brush}
              setBrush={setBrush}
              opts={opts}
              setOpts={setOpts}
              textTarget={active?.text ?? null}
              fonts={fontsList}
              actions={{
                selectSubject: () => void selectSubject(),
                applyCrop,
                cancelCrop: () => {
                  setCropAngle(0);
                  setCrop({ x: 0, y: 0, w: doc.w, h: doc.h });
                },
                cropping: !!crop && (crop.x !== 0 || crop.y !== 0 || Math.round(crop.w) !== doc.w || Math.round(crop.h) !== doc.h || cropAngle !== 0),
                cropAngle,
                setCropAngle,
                applyStraighten,
                transform: beginTransform,
                align: (how) => commit(alignLayer(doc, how), "Align"),
                fit: () => fit(),
                actual,
                setText,
                cloneSet: !!cloneSrc,
                penOpen: !!pen && pen.length > 0,
                finishPen: () => finishPen(),
                cancelPen: () => setPen(null),
                nodeHint: nodeSel ? (nodeSel.node !== null ? "Point picked: drag it, Delete removes it, arrows nudge." : "Path picked: drag to move, drag a point to reshape.") : "Click a path to edit its points.",
                nodeActions: nodeSel ? (
                  <button type="button" onClick={() => void deleteVector()} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink">
                    <Trash2 aria-hidden className="size-3.5" /> {nodeSel.node !== null ? "Delete point" : "Delete path"}
                  </button>
                ) : null,
                openColorPicker: () => {
                  setPanel("color");
                  setSheetOpen(true);
                },
                pickScreenColor: () => void pickScreenColor(),
                hasScreenEyeDropper,
              }}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Tools: a column on tablet/desktop, a scrolling bottom row on phones */}
            <div className="hidden shrink-0 overflow-y-auto border-r border-line bg-paper/40 md:block" data-lenis-prevent>
              <Toolbar tool={tool} onTool={setTool} fg={fg} bg={bg} onFg={setFg} onBg={setBg} onSwap={() => (setFg(bg), setBg(fg))} onReset={() => (setFg("#000000"), setBg("#ffffff"))} />
            </div>

            {/* Canvas */}
            <div
              ref={wrapRef}
              className="relative min-h-[200px] min-w-0 flex-1 overflow-hidden bg-paper-2"
              data-lenis-prevent
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                // Pictures dropped on the canvas become layers; a PSD or project opens instead.
                e.preventDefault();
                Array.from(e.dataTransfer.files).forEach((f) => void placeFile(f));
              }}
            >
              <canvas ref={mainRef} className="absolute inset-0 size-full" aria-hidden />
              <canvas
                ref={overRef}
                className="absolute inset-0 size-full touch-none select-none"
                style={{ cursor: cursorFor() }}
                aria-label={`Canvas, ${doc.w} by ${doc.h} pixels. Tool: ${TOOLS[tool].label}.`}
                role="img"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => void onPointerUp(e)}
                onPointerCancel={(e) => void onPointerUp(e)}
                onPointerLeave={() => {
                  hover.current = null;
                }}
                onDoubleClick={(e) => {
                  if (tool === "lasso-poly") closePoly();
                  else if (tool === "pen") finishPen();
                  else if (tool === "node") addPointAt(e);
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
              {splitCompare && hist!.index > 0 && (
                <div
                  ref={splitHandleRef}
                  role="slider"
                  aria-label="Before and after split divider"
                  aria-valuemin={2}
                  aria-valuemax={98}
                  aria-valuenow={Math.round(splitX * 100)}
                  tabIndex={0}
                  style={{ left: "50%" }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      updateSplitX(splitX - 0.03);
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      updateSplitX(splitX + 0.03);
                    }
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!(e.buttons & 1) || !wrapRef.current) return;
                    const r = wrapRef.current.getBoundingClientRect();
                    const v = view.current;
                    updateSplitX((e.clientX - r.left - v.x) / Math.max(1, doc.w * v.z));
                  }}
                  className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none select-none"
                >
                  <span aria-hidden className="mx-auto block h-full w-0.5 bg-paper shadow-[0_0_0_1px_rgba(21,20,15,0.7)]" />
                  <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-ink px-2 py-0.5 font-mono text-[12px] text-paper shadow-card">
                    Before · After
                  </span>
                </div>
              )}
              {smartPrompt && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[1px]">
                  <div className="w-full max-w-sm space-y-3 rounded-lg border border-line bg-surface p-4 shadow-float">
                    <div className="flex items-start gap-2.5">
                      <Box aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                      <div>
                        <p className="text-[14px] font-medium text-ink">Smart Object cannot be painted directly</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                          Rasterize it to paint directly as pixels, or double-click / Edit Contents to paint inside the original Smart Object non-destructively.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Btn onClick={() => setSmartPrompt(null)}>Cancel</Btn>
                      <Btn onClick={() => enterSmartEdit(smartPrompt)}>Edit Contents</Btn>
                      <Btn
                        primary
                        onClick={() => {
                          layerApi.rasterize(smartPrompt);
                          setSmartPrompt(null);
                        }}
                      >
                        Rasterize Layer
                      </Btn>
                    </div>
                  </div>
                </div>
              )}
              {transform && (
                <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md border border-line bg-surface/95 p-1 text-[12px] shadow-card backdrop-blur">
                  <span className="px-1.5 font-mono text-ink-2">
                    W {Math.round(transform.sx * 100)}% · H {Math.round(transform.sy * 100)}% · {Math.round(transform.rot)}°
                  </span>
                  <button type="button" onClick={() => setTransform({ ...transform, sx: -transform.sx })} className="h-7 rounded-sm px-2 text-ink-2 hover:bg-paper-2 hover:text-ink">
                    Flip H
                  </button>
                  <button type="button" onClick={() => setTransform({ ...transform, sy: -transform.sy })} className="h-7 rounded-sm px-2 text-ink-2 hover:bg-paper-2 hover:text-ink">
                    Flip V
                  </button>
                  <button type="button" onClick={cancelTransform} aria-label="Cancel transform" className="inline-flex size-7 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2">
                    <X aria-hidden className="size-4" />
                  </button>
                  <button type="button" onClick={applyTransform} aria-label="Apply transform" className="inline-flex size-7 items-center justify-center rounded-sm bg-ink text-paper">
                    <Check aria-hidden className="size-4" />
                  </button>
                </div>
              )}
              <AnimatePresence>
                {compare && (
                  <motion.span
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="label-mono pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-paper shadow-card"
                  >
                    Original
                  </motion.span>
                )}
              </AnimatePresence>
              {poly && poly.pts.length > 0 && (
                <div className="absolute left-2 top-2 rounded-md border border-line bg-surface/95 px-2 py-1 text-[12px] text-ink-2 shadow-card">Click the first point, double-click or press Enter to close · Esc cancels</div>
              )}
              <AnimatePresence>
                {busy && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center bg-paper/40 backdrop-blur-[1px]">
                    <span role="status" className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink shadow-card">
                      <Loader2 aria-hidden className="size-4 animate-spin" /> {busy}
                    </span>
                  </motion.div>
                )}
                {toast && (
                  <motion.p
                    key={toast}
                    role="status"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute bottom-2 left-2 right-2 mx-auto w-fit max-w-[min(520px,100%)] rounded-md bg-ink px-3 py-2 text-[13px] text-paper shadow-card"
                  >
                    {toast}
                  </motion.p>
                )}
              </AnimatePresence>
              {/* Zoom controls on the canvas: out, the zoom (tap for 100%), in, and fit. */}
              <div className="absolute bottom-2 right-2 flex items-center rounded-md border border-line bg-surface/90 text-ink-2 shadow-card backdrop-blur">
                <button type="button" aria-label="Zoom out" title="Zoom out (Ctrl −)" onClick={() => zoomAt(0.8)} className="inline-flex size-9 items-center justify-center hover:text-ink">
                  <Minus aria-hidden className="size-4" />
                </button>
                <button type="button" title="Actual pixels (Ctrl 1)" aria-label={`Zoom ${Math.round(z * 100)}%, show actual pixels`} onClick={actual} className="h-9 min-w-12 px-1 font-mono text-[12px] tabular-nums text-ink">
                  {Math.round(z * 100)}%
                </button>
                <button type="button" aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => zoomAt(1.25)} className="inline-flex size-9 items-center justify-center hover:text-ink">
                  <Plus aria-hidden className="size-4" />
                </button>
                <span aria-hidden className="h-5 w-px bg-line" />
                <button type="button" aria-label="Fit on screen" title="Fit on screen (Ctrl 0)" onClick={() => fit()} className="inline-flex size-9 items-center justify-center hover:text-ink">
                  <Maximize aria-hidden className="size-4" />
                </button>
              </div>
            </div>

            <div className="border-t border-line bg-paper/40 md:hidden" data-lenis-prevent>
              <Toolbar horizontal tool={tool} onTool={setTool} fg={fg} bg={bg} onFg={setFg} onBg={setBg} onSwap={() => (setFg(bg), setBg(fg))} onReset={() => (setFg("#000000"), setBg("#ffffff"))} />
            </div>

            {/* Panels */}
            <aside
              style={{ "--pro-panel-w": `${panelW}px` } as React.CSSProperties}
              className={cn(
                "relative flex min-h-0 shrink-0 flex-col border-t border-line md:w-[300px] md:border-l md:border-t-0 lg:w-[var(--pro-panel-w)]",
                !panelOpen && "md:max-lg:hidden",
              )}
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize side panel"
                onPointerDown={(e) => {
                  e.preventDefault();
                  const sx = e.clientX;
                  const sw = panelW;
                  let latest = sw;
                  const move = (ev: PointerEvent) => {
                    latest = clamp(sw + (sx - ev.clientX), 260, 460);
                    setPanelW(latest);
                  };
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    try {
                      localStorage.setItem("dw-pro-panel-w", String(Math.round(latest)));
                    } catch {
                      // Ignore storage failures.
                    }
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                className="absolute inset-y-0 left-0 z-20 hidden w-1.5 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-accent/50 lg:block"
              />
              <div role="tablist" aria-label="Panels" className="flex border-b border-line bg-paper/60">
                {[...tabs, { id: "layers" as Panel, label: "Layers", icon: LayersIcon }].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={panel === t.id}
                    aria-label={t.label}
                    title={t.label}
                    onClick={() => {
                      // Phones: tapping the open tab folds the sheet away (and back).
                      if (panel === t.id) setSheetOpen((o) => !o);
                      else {
                        setPanel(t.id);
                        setSheetOpen(true);
                      }
                    }}
                    className={cn("relative flex h-10 min-w-0 basis-0 items-center justify-center gap-1 text-[12px] transition-[flex-grow,color] duration-300 md:h-9", t.id === "layers" && "lg:hidden", panel === t.id ? "grow-[3] text-ink" : "grow text-ink-3 hover:text-ink")}
                  >
                    <t.icon aria-hidden className="size-4 md:size-3.5" />
                    {/* Only the open tab shows its name: seven tabs never fit with labels. */}
                    <span className={panel === t.id ? "inline" : "sr-only"}>{t.label}</span>
                    {panel === t.id && <motion.span layoutId="pro-panel-tab" aria-hidden className="absolute inset-x-1 -bottom-px h-0.5 bg-ink" />}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={sheetOpen ? "Hide the panel" : "Show the panel"}
                  aria-expanded={sheetOpen}
                  onClick={() => setSheetOpen((o) => !o)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center border-l border-line text-ink-2 hover:text-ink md:hidden"
                >
                  <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-300", !sheetOpen && "rotate-180")} />
                </button>
              </div>
              <div className={cn("min-h-0 overflow-y-auto overscroll-contain max-md:h-[min(36dvh,340px)] md:flex-1", !sheetOpen && "max-md:hidden")} data-lenis-prevent>
                {/* Tabs cross-fade; the panel's own scroll position starts at the top. */}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={panel} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
                    {panel === "properties" && <Slot>{propertiesPanel}</Slot>}
                    {panel === "color" && (
                      <ColorPanel
                        fg={fg}
                        bg={bg}
                        onFg={setFg}
                        onBg={setBg}
                        onSwap={() => (setFg(bg), setBg(fg))}
                        onReset={() => (setFg("#000000"), setBg("#ffffff"))}
                        onEyedropper={() => setTool("eyedropper")}
                        eyedropperActive={tool === "eyedropper"}
                      />
                    )}
                    {panel === "adjust" && <Slot>{adjustPanel}</Slot>}
                    {panel === "looks" && <Slot>{looksPanel}</Slot>}
                    {panel === "create" && <Slot>{createPanel}</Slot>}
                    {panel === "history" && <HistoryPanel entries={hist!.entries} index={hist!.index} onJump={jump} />}
                    {panel === "info" && <Slot>{infoPanel}</Slot>}
                    {panel === "layers" && (
                      <div className="lg:hidden">
                        <LayersPanel doc={doc} api={layerApi} />
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
              <motion.div
                initial={false}
                animate={{ height: layersOpen ? "44%" : 36 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className={cn("hidden shrink-0 flex-col overflow-hidden border-t border-line lg:flex", layersOpen && "min-h-[220px]")}
              >
                <button
                  type="button"
                  aria-expanded={layersOpen}
                  onClick={() => setLayersOpen((o) => !o)}
                  className="label-mono flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-paper/60 px-3 text-ink-3 transition-colors hover:text-ink"
                >
                  <LayersIcon aria-hidden className="size-3.5" /> Layers
                  <span className="ml-1 tabular-nums">{doc.layers.length}</span>
                  {!layersOpen && <span className="ml-2 min-w-0 truncate normal-case tracking-normal text-ink-2">{active?.name}</span>}
                  <ChevronDown aria-hidden className={cn("ml-auto size-3.5 transition-transform duration-300", !layersOpen && "rotate-180")} />
                </button>
                <LayersPanel doc={doc} api={layerApi} />
              </motion.div>
            </aside>
          </div>

          {/* Status bar */}
          <div className="hidden h-7 items-center gap-3 overflow-hidden border-t border-line bg-paper/60 px-3 font-mono text-[12px] text-ink-3 md:flex">
            <span className="shrink-0">
              {doc.w} × {doc.h} px
            </span>
            <span className="shrink-0">{Math.round(z * 100)}%</span>
            {doc.editMask && active?.mask && <span className="shrink-0 text-accent">Editing mask</span>}
            {doc.selection && (
              <span className="shrink-0">
                Selection {doc.selection.bounds.w} × {doc.selection.bounds.h}
              </span>
            )}
            <span className="hidden min-w-0 truncate md:inline">{TOOLS[tool].hint}</span>
            <span className="ml-auto shrink-0">{savedAt ? `Kept on this device · ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
            <button type="button" onClick={() => fileRef.current?.click()} className="hidden shrink-0 items-center gap-1 hover:text-ink sm:inline-flex" title="Open (Ctrl+O)">
              <FolderOpen aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      </Workbench>
    </div>
  );
  return fullscreen ? createPortal(workspace, document.body) : workspace;
}

/** Renders a panel's content from a function, inside its own component. */
function Slot({ children }: { children: () => React.ReactNode }) {
  return <>{children()}</>;
}

function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
