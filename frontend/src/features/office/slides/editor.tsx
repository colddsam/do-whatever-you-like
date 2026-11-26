"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { zipSync } from "fflate";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Bold,
  Copy,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Italic,
  LayoutTemplate,
  List,
  Minus,
  MonitorPlay,
  Palette,
  Plus,
  Presentation,
  Printer,
  Redo2,
  Shapes,
  Sparkles,
  Square,
  Table as TableIcon,
  Trash2,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import { cn } from "@/lib/utils";
import { boxCss, elementInner, elId, LAYOUTS, newDeck, newSlide, SIZE, SLIDE_CSS, slideHtml, textCss, THEMES, themeOf, type Anim, type Deck, type El, type ShapeKind, type Slide, type Transition } from "./model";
import { exportPptx, importPptx } from "./pptx";
import { AudienceView, Slideshow } from "./present";
import { lastOpen, loadDoc, newDocId, rememberOpen, saveDoc } from "../shared/store";
import { ColorButton, EditorFrame, ensureFont, FONT_SIZES, FONTS, inputCls, Menu, Modal, primaryCls, RBtn, RGroup, Ribbon, RSelect, secondaryCls, TitleBar, useAutosave } from "../shared/ui";

type Saved = { name: string; deck: Deck };
const noop = () => () => {};

export function SlidesEditorEntry() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [boot, setBoot] = useState<{ id: string; data: Saved; audience?: string } | null>(null);
  useEffect(() => {
    if (!mounted) return;
    const params = new URLSearchParams(window.location.search);
    const audience = params.get("audience") ?? undefined;
    const id = lastOpen("slides");
    (id ? loadDoc<Saved>(id) : Promise.resolve(null)).then((data) => {
      if (data && id) setBoot({ id, data, audience });
      else setBoot({ id: newDocId(), data: { name: "Presentation1", deck: newDeck("office") }, audience });
    });
  }, [mounted]);
  if (!boot) return <div aria-hidden className="h-[calc(100dvh-140px)] min-h-[560px] animate-pulse rounded-lg border border-line bg-surface lg:h-[min(86dvh,1100px)]" />;
  if (boot.audience) return <AudienceView deck={boot.data.deck} channelName={boot.audience} />;
  return <SlidesApp key={boot.id} docId={boot.id} initial={boot.data} onSwitch={(id, data) => setBoot({ id, data })} />;
}

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "rect", label: "Rectangle" }, { kind: "roundRect", label: "Rounded rectangle" }, { kind: "ellipse", label: "Oval" }, { kind: "triangle", label: "Triangle" },
  { kind: "rightTriangle", label: "Right triangle" }, { kind: "diamond", label: "Diamond" }, { kind: "pentagon", label: "Pentagon" }, { kind: "hexagon", label: "Hexagon" },
  { kind: "octagon", label: "Octagon" }, { kind: "star5", label: "Star" }, { kind: "heart", label: "Heart" }, { kind: "cloud", label: "Cloud" },
  { kind: "speech", label: "Speech bubble" }, { kind: "plus", label: "Plus" }, { kind: "chevron", label: "Chevron" }, { kind: "parallelogram", label: "Parallelogram" },
  { kind: "trapezoid", label: "Trapezoid" }, { kind: "arrowRight", label: "Right arrow" }, { kind: "arrowLeft", label: "Left arrow" }, { kind: "arrowUp", label: "Up arrow" },
  { kind: "arrowDown", label: "Down arrow" }, { kind: "line", label: "Line" }, { kind: "arrowLine", label: "Arrow line" },
];

const BACKGROUNDS = [
  "#ffffff", "#f3f0e8", "#15140f", "#1e293b", "#0f172a", "#fef3c7", "#ecfeff", "#fdf2f8",
  "linear-gradient(135deg,#667eea,#764ba2)", "linear-gradient(135deg,#f093fb,#f5576c)", "linear-gradient(135deg,#4facfe,#00f2fe)", "linear-gradient(135deg,#43e97b,#38f9d7)",
  "linear-gradient(135deg,#fa709a,#fee140)", "linear-gradient(135deg,#30cfd0,#330867)", "linear-gradient(135deg,#0f2027,#2c5364)", "radial-gradient(circle at 30% 30%,#2a2a72,#090921)",
];

type Drag =
  | { kind: "move"; sx: number; sy: number; start: Map<string, { x: number; y: number }> }
  | { kind: "resize"; handle: string; sx: number; sy: number; el: El }
  | { kind: "rotate"; cx: number; cy: number; el: El }
  | { kind: "marquee"; sx: number; sy: number; x: number; y: number };

function SlidesApp({ docId, initial, onSwitch }: { docId: string; initial: Saved; onSwitch: (id: string, data: Saved) => void }) {
  const [deck, setDeckRaw] = useState<Deck>(initial.deck);
  const [name, setName] = useState(initial.name);
  const [cur, setCur] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const editDirty = useRef(false);
  const [tab, setTab] = useState("Home");
  const [fullscreen, setFullscreen] = useState(false);
  // Phones need the height for the slide itself; notes stay one tap away under View.
  const [showNotes, setShowNotes] = useState(() => window.innerWidth >= 640);
  const [panelOpen, setPanelOpen] = useState(true);
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [present, setPresent] = useState<null | { start: number; presenter: boolean }>(null);
  const [dialog, setDialog] = useState<null | "table" | "chart" | "image" | "themes" | "export">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stage, setStage] = useState({ w: 800, h: 450 });
  const [dragOver, setDragOver] = useState<number | null>(null);
  const undo = useRef<Deck[]>([]);
  const redo = useRef<Deck[]>([]);
  const clip = useRef<El[]>([]);
  const drag = useRef<Drag | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const theme = themeOf(deck.theme);
  const { w: SW, h: SH } = SIZE[deck.ratio];
  const slide = deck.slides[Math.min(cur, deck.slides.length - 1)];
  const selected = slide.elements.filter((e) => sel.includes(e.id));
  const one = selected.length === 1 ? selected[0] : null;
  const scale = Math.min((stage.w - 32) / SW, (stage.h - 32) / SH);

  const data = useMemo(() => ({ name, deck }), [name, deck]);
  const saveState = useAutosave(data, (d) => saveDoc({ id: docId, app: "slides", name: d.name }, d));
  useEffect(() => rememberOpen("slides", docId), [docId]);
  useEffect(() => {
    ensureFont(theme.titleFont);
    ensureFont(theme.bodyFont);
    for (const s of deck.slides) for (const e of s.elements) if (e.text?.font) ensureFont(e.text.font);
  }, [deck, theme]);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice((n) => (n === m ? null : n)), 3500);
  };

  // ---------- history
  const commit = useCallback((f: (d: Deck) => Deck) => {
    setDeckRaw((d) => {
      const n = f(d);
      if (n === d) return d;
      undo.current.push(d);
      if (undo.current.length > 150) undo.current.shift();
      redo.current = [];
      return n;
    });
  }, []);
  const live = (f: (d: Deck) => Deck) => setDeckRaw(f); // during drags; one undo step is pushed at the start
  const doUndo = () => {
    const p = undo.current.pop();
    if (p) {
      redo.current.push(deck);
      setDeckRaw(p);
      setSel([]);
    }
  };
  const doRedo = () => {
    const n = redo.current.pop();
    if (n) {
      undo.current.push(deck);
      setDeckRaw(n);
    }
  };

  const updateSlide = (f: (s: Slide) => Slide, idx = cur) => commit((d) => ({ ...d, slides: d.slides.map((s, i) => (i === idx ? f(s) : s)) }));
  const updateEls = (ids: string[], f: (e: El) => El, record = true) => {
    const fn = (d: Deck) => ({ ...d, slides: d.slides.map((s, i) => (i === cur ? { ...s, elements: s.elements.map((e) => (ids.includes(e.id) ? f(e) : e)) } : s)) });
    if (record) commit(fn);
    else live(fn);
  };

  // ---------- layout
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [fullscreen, showNotes, panelOpen]);

  // ---------- slides
  const addSlide = (layout = "content", after = cur) => {
    commit((d) => {
      const slides = [...d.slides];
      slides.splice(after + 1, 0, newSlide(layout, d));
      return { ...d, slides };
    });
    setCur(after + 1);
    setSel([]);
  };
  const dupSlide = (i = cur) => {
    commit((d) => {
      const slides = [...d.slides];
      const copy: Slide = { ...structuredClone(d.slides[i]), id: elId() };
      copy.elements = copy.elements.map((e) => ({ ...e, id: elId() }));
      slides.splice(i + 1, 0, copy);
      return { ...d, slides };
    });
    setCur(i + 1);
  };
  const delSlide = (i = cur) => {
    if (deck.slides.length < 2) return flash("A presentation needs at least one slide.");
    commit((d) => ({ ...d, slides: d.slides.filter((_, j) => j !== i) }));
    setCur((c) => Math.max(0, Math.min(c, deck.slides.length - 2)));
    setSel([]);
  };
  const moveSlide = (from: number, to: number) => {
    if (from === to) return;
    commit((d) => {
      const slides = [...d.slides];
      const [s] = slides.splice(from, 1);
      slides.splice(to, 0, s);
      return { ...d, slides };
    });
    setCur(to);
  };
  const applyLayout = (layout: string) => {
    updateSlide((s) => {
      const fresh = LAYOUTS.find((l) => l.id === layout)!.make(SW, SH);
      // keep text from placeholders in the same role
      const kept = fresh.map((f) => {
        const old = s.elements.find((e) => e.role && e.role === f.role);
        return old ? { ...f, html: old.html } : f;
      });
      const others = s.elements.filter((e) => !e.role);
      return { ...s, layout, elements: [...kept, ...others] };
    });
  };

  // ---------- elements
  const addEl = (el: Omit<El, "id" | "rot"> & Partial<El>) => {
    const full: El = { rot: 0, ...el, id: elId() } as El;
    updateSlide((s) => ({ ...s, elements: [...s.elements, full] }));
    setSel([full.id]);
    return full;
  };
  const addText = () => {
    const e = addEl({ type: "text", x: SW / 2 - 200, y: SH / 2 - 30, w: 400, h: 60, html: "<p>Text</p>", text: { size: 24, align: "left", valign: "top" } });
    setTimeout(() => startEdit(e.id), 30);
  };
  const addShape = (kind: ShapeKind) => {
    const line = kind === "line" || kind === "arrowLine";
    addEl({ type: "shape", x: SW / 2 - 100, y: SH / 2 - (line ? 10 : 70), w: 200, h: line ? 20 : 140, shape: { kind, fill: theme.accent[0], stroke: line ? theme.accent[0] : undefined, strokeW: line ? 3 : undefined }, html: line ? undefined : "", text: line ? undefined : { size: 18, align: "center", valign: "middle", color: "#ffffff" } });
  };
  const addImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return flash("Choose a picture.");
    const src = await toDataUrl(file, 1920);
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => {});
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 4 / 3;
    let w = Math.min(SW * 0.6, 520);
    let h = w / ratio;
    if (h > SH * 0.7) {
      h = SH * 0.7;
      w = h * ratio;
    }
    // drop into an empty picture placeholder if the slide has one
    const ph = slide.elements.find((e) => e.type === "shape" && e.shape?.fill === "#e5e5e5" && /Insert/.test(e.html ?? ""));
    if (ph) {
      updateSlide((s) => ({ ...s, elements: s.elements.map((e) => (e.id === ph.id ? { id: e.id, type: "image", x: e.x, y: e.y, w: e.w, h: e.h, rot: 0, src, fit: "cover" } : e)) }));
      return;
    }
    addEl({ type: "image", x: (SW - w) / 2, y: (SH - h) / 2, w, h, src, fit: "contain" });
  };
  const delSel = () => {
    if (!sel.length) return;
    updateSlide((s) => ({ ...s, elements: s.elements.filter((e) => !sel.includes(e.id)) }));
    setSel([]);
  };
  const dupSel = () => {
    const copies = selected.map((e) => ({ ...structuredClone(e), id: elId(), x: e.x + 20, y: e.y + 20 }));
    updateSlide((s) => ({ ...s, elements: [...s.elements, ...copies] }));
    setSel(copies.map((c) => c.id));
  };
  const order = (dir: "front" | "back" | "forward" | "backward") =>
    updateSlide((s) => {
      const els = [...s.elements];
      for (const id of dir === "front" || dir === "backward" ? sel : [...sel].reverse()) {
        const i = els.findIndex((e) => e.id === id);
        if (i < 0) continue;
        const [e] = els.splice(i, 1);
        const j = dir === "front" ? els.length : dir === "back" ? 0 : dir === "forward" ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
        els.splice(j, 0, e);
      }
      return { ...s, elements: els };
    });
  const align = (how: "left" | "center" | "right" | "top" | "middle" | "bottom" | "hdist" | "vdist") => {
    if (!selected.length) return;
    const multi = selected.length > 1;
    const bx = multi ? { x: Math.min(...selected.map((e) => e.x)), y: Math.min(...selected.map((e) => e.y)), r: Math.max(...selected.map((e) => e.x + e.w)), b: Math.max(...selected.map((e) => e.y + e.h)) } : { x: 0, y: 0, r: SW, b: SH };
    if (how === "hdist" || how === "vdist") {
      if (selected.length < 3) return flash("Select three or more objects to distribute.");
      const sorted = [...selected].sort((a, b) => (how === "hdist" ? a.x - b.x : a.y - b.y));
      const total = how === "hdist" ? bx.r - bx.x - sorted.reduce((s, e) => s + e.w, 0) : bx.b - bx.y - sorted.reduce((s, e) => s + e.h, 0);
      const gap = total / (sorted.length - 1);
      let pos = how === "hdist" ? bx.x : bx.y;
      const map = new Map<string, number>();
      for (const e of sorted) {
        map.set(e.id, pos);
        pos += (how === "hdist" ? e.w : e.h) + gap;
      }
      return updateEls(sel, (e) => (how === "hdist" ? { ...e, x: map.get(e.id)! } : { ...e, y: map.get(e.id)! }));
    }
    updateEls(sel, (e) => {
      switch (how) {
        case "left":
          return { ...e, x: bx.x };
        case "center":
          return { ...e, x: (bx.x + bx.r) / 2 - e.w / 2 };
        case "right":
          return { ...e, x: bx.r - e.w };
        case "top":
          return { ...e, y: bx.y };
        case "middle":
          return { ...e, y: (bx.y + bx.b) / 2 - e.h / 2 };
        default:
          return { ...e, y: bx.b - e.h };
      }
    });
  };

  // ---------- text editing
  const startEdit = (id: string) => {
    const el = deck.slides[cur].elements.find((e) => e.id === id);
    if (!el || el.html === undefined) return;
    editDirty.current = false;
    setSel([id]);
    setEditing(id);
    requestAnimationFrame(() => {
      const node = editRef.current;
      if (!node) return;
      node.innerHTML = el.html || "<p><br></p>";
      node.focus();
      const r = document.createRange();
      r.selectNodeContents(node);
      // a placeholder's prompt text is selected so typing replaces it
      if (!/Click to add|^<p>Text<\/p>$/.test(el.html ?? "")) r.collapse(false);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    });
  };
  /**
   * Copies the text being typed into the deck as it changes, so autosave, thumbnails and a closed
   * tab never lose it. The first change of an edit is one undo step; the rest join it.
   */
  const syncEdit = () => {
    if (!editing) return;
    const node = editRef.current;
    const clean = (node?.innerHTML ?? "").replace(/<p><br><\/p>$/, "");
    // Text boxes grow to fit what's typed (PowerPoint's "resize shape to fit text").
    const need = node ? Math.ceil(node.scrollHeight) : 0;
    updateEls(
      [editing],
      (e) => {
        const h = e.type === "text" && need > e.h ? need : e.h;
        return e.html === clean && h === e.h ? e : { ...e, html: clean, h };
      },
      !editDirty.current,
    );
    editDirty.current = true;
  };
  const stopEdit = () => {
    if (!editing) return;
    syncEdit();
    setEditing(null);
  };
  const fmtText = (cmd: string, value?: string) => {
    if (editing) {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(cmd, false, value);
      return;
    }
    if (!selected.length) return;
    updateEls(sel, (e) => {
      if (!e.text) return e;
      const t = { ...e.text };
      if (cmd === "bold") t.bold = !t.bold;
      if (cmd === "italic") t.italic = !t.italic;
      if (cmd === "underline") t.underline = !t.underline;
      if (cmd === "foreColor") t.color = value;
      return { ...e, text: t, html: cmd === "bold" || cmd === "italic" || cmd === "underline" ? e.html?.replace(/<\/?(b|strong|i|em|u)>/g, "") : e.html };
    });
  };
  const setTextProp = (patch: Partial<NonNullable<El["text"]>>) => updateEls(sel, (e) => (e.text ? { ...e, text: { ...e.text, ...patch } } : e));

  // ---------- pointer on canvas
  const toSlide = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const snapMove = (moving: El[], dx: number, dy: number) => {
    if (!snap) return { dx, dy, v: [] as number[], h: [] as number[] };
    const others = slide.elements.filter((e) => !sel.includes(e.id));
    const vx = [0, SW / 2, SW, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const hy = [0, SH / 2, SH, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    const bx = { x: Math.min(...moving.map((e) => e.x)) + dx, y: Math.min(...moving.map((e) => e.y)) + dy, r: Math.max(...moving.map((e) => e.x + e.w)) + dx, b: Math.max(...moving.map((e) => e.y + e.h)) + dy };
    const cands = (edges: number[], targets: number[]) => {
      let best: { d: number; t: number } | null = null;
      for (const e of edges) for (const t of targets) {
        const d = t - e;
        if (Math.abs(d) <= 6 / scale && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
      }
      return best;
    };
    const sx = cands([bx.x, (bx.x + bx.r) / 2, bx.r], vx);
    const sy = cands([bx.y, (bx.y + bx.b) / 2, bx.b], hy);
    return { dx: dx + (sx?.d ?? 0), dy: dy + (sy?.d ?? 0), v: sx ? [sx.t] : [], h: sy ? [sy.t] : [] };
  };

  const onElDown = (e: React.PointerEvent, el: El) => {
    if (editing === el.id) return;
    e.stopPropagation();
    e.preventDefault(); // no native text selection while dragging
    if (editing) stopEdit();
    let ids = sel;
    if (e.shiftKey || e.ctrlKey || e.metaKey) ids = sel.includes(el.id) ? sel.filter((x) => x !== el.id) : [...sel, el.id];
    else if (!sel.includes(el.id)) ids = [el.id];
    setSel(ids);
    const p = toSlide(e);
    undo.current.push(deck);
    redo.current = [];
    drag.current = { kind: "move", sx: p.x, sy: p.y, start: new Map(slide.elements.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }])) };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onHandleDown = (e: React.PointerEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!one) return;
    undo.current.push(deck);
    redo.current = [];
    const p = toSlide(e);
    if (handle === "rot") drag.current = { kind: "rotate", cx: one.x + one.w / 2, cy: one.y + one.h / 2, el: one };
    else drag.current = { kind: "resize", handle, sx: p.x, sy: p.y, el: one };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onCanvasDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (editing) stopEdit();
    const p = toSlide(e);
    setSel([]);
    drag.current = { kind: "marquee", sx: p.x, sy: p.y, x: p.x, y: p.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSlide(e);
    if (d.kind === "move") {
      const moving = slide.elements.filter((x) => d.start.has(x.id)).map((x) => ({ ...x, ...d.start.get(x.id)! }));
      const s = snapMove(moving, p.x - d.sx, p.y - d.sy);
      setGuides({ v: s.v, h: s.h });
      updateEls([...d.start.keys()], (x) => ({ ...x, x: Math.round(d.start.get(x.id)!.x + s.dx), y: Math.round(d.start.get(x.id)!.y + s.dy) }), false);
    } else if (d.kind === "resize") {
      const el = d.el;
      const dx = p.x - d.sx;
      const dy = p.y - d.sy;
      let { x, y, w, h } = el;
      if (d.handle.includes("e")) w = Math.max(10, el.w + dx);
      if (d.handle.includes("s")) h = Math.max(10, el.h + dy);
      if (d.handle.includes("w")) {
        w = Math.max(10, el.w - dx);
        x = el.x + el.w - w;
      }
      if (d.handle.includes("n")) {
        h = Math.max(10, el.h - dy);
        y = el.y + el.h - h;
      }
      // Shift (or a picture corner) keeps the proportions
      if ((e.shiftKey || (el.type === "image" && d.handle.length === 2)) && d.handle.length === 2) {
        const r = el.w / el.h;
        if (w / h > r) w = h * r;
        else h = w / r;
        if (d.handle.includes("w")) x = el.x + el.w - w;
        if (d.handle.includes("n")) y = el.y + el.h - h;
      }
      updateEls([el.id], (z) => ({ ...z, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }), false);
    } else if (d.kind === "rotate") {
      let a = (Math.atan2(p.y - d.cy, p.x - d.cx) * 180) / Math.PI + 90;
      if (e.shiftKey || snap) {
        const snapped = Math.round(a / 15) * 15;
        if (Math.abs(snapped - a) < 4 || e.shiftKey) a = snapped;
      }
      updateEls([d.el.id], (z) => ({ ...z, rot: Math.round(((a % 360) + 360) % 360) }), false);
    } else if (d.kind === "marquee") {
      d.x = p.x;
      d.y = p.y;
      setMarquee({ x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) });
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setGuides({ v: [], h: [] });
    if (d?.kind === "marquee") {
      const r = { x: Math.min(d.sx, d.x), y: Math.min(d.sy, d.y), w: Math.abs(d.x - d.sx), h: Math.abs(d.y - d.sy) };
      if (r.w > 4 || r.h > 4) setSel(slide.elements.filter((e) => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y).map((e) => e.id));
      setMarquee(null);
    } else if (d && undo.current[undo.current.length - 1] === deck) undo.current.pop(); // nothing changed
  };

  // ---------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (present || dialog) return;
      const t = e.target as HTMLElement;
      if (editing || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
        if (e.key === "Escape" && editing) stopEdit();
        return;
      }
      if (!stageRef.current?.closest("[data-editor]")?.contains(t) && t !== document.body) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if ((k === "delete" || k === "backspace") && sel.length) {
        e.preventDefault();
        delSel();
      } else if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && k === "y") {
        e.preventDefault();
        doRedo();
      } else if (mod && k === "d") {
        e.preventDefault();
        dupSel();
      } else if (mod && k === "c" && sel.length) clip.current = structuredClone(selected);
      else if (mod && k === "x" && sel.length) {
        clip.current = structuredClone(selected);
        delSel();
      } else if (mod && k === "v" && clip.current.length) {
        e.preventDefault();
        const copies = clip.current.map((c) => ({ ...structuredClone(c), id: elId(), x: c.x + 16, y: c.y + 16 }));
        clip.current = copies;
        updateSlide((s) => ({ ...s, elements: [...s.elements, ...copies] }));
        setSel(copies.map((c) => c.id));
      } else if (mod && k === "a") {
        e.preventDefault();
        setSel(slide.elements.map((x) => x.id));
      } else if (mod && k === "m") {
        e.preventDefault();
        addSlide();
      } else if (k === "f5") {
        e.preventDefault();
        setPresent({ start: e.shiftKey ? cur : 0, presenter: false });
      } else if (k.startsWith("arrow") && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        updateEls(sel, (x) => ({ ...x, x: x.x + (k === "arrowleft" ? -step : k === "arrowright" ? step : 0), y: x.y + (k === "arrowup" ? -step : k === "arrowdown" ? step : 0) }));
      } else if ((k === "enter" || k === "f2") && one && one.html !== undefined) {
        e.preventDefault();
        startEdit(one.id);
      } else if (k === "escape") setSel([]);
      else if (!sel.length && (k === "pagedown" || k === "arrowdown")) setCur((c) => Math.min(deck.slides.length - 1, c + 1));
      else if (!sel.length && (k === "pageup" || k === "arrowup")) setCur((c) => Math.max(0, c - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- files
  const switchTo = async (d: Deck, nm: string) => {
    const id = newDocId();
    await saveDoc({ id, app: "slides", name: nm }, { name: nm, deck: d });
    onSwitch(id, { name: nm, deck: d });
  };
  const openFile = async (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const base = f.name.replace(/\.[^.]+$/, "");
    try {
      if (["pptx", "ppsx", "potx", "pptm"].includes(ext)) return switchTo(importPptx(new Uint8Array(await f.arrayBuffer())), base);
      if (["ppt", "odp", "key", "pdf"].includes(ext)) {
        flash("Converting on the server…");
        const form = new FormData();
        form.append("file", f, f.name);
        form.append("target", "pptx");
        const out = await uploadForm("/api/tools/universal/convert", form, { fallbackName: `${base}.pptx` });
        return switchTo(importPptx(new Uint8Array(await out.blob.arrayBuffer())), base);
      }
      if (f.type.startsWith("image/")) return addImage(f);
      flash("Open a PowerPoint (.pptx, .ppt) or OpenDocument (.odp) file.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "That file couldn't be opened.");
    }
  };
  const base = (name || "presentation").replace(/[\\/:*?"<>|]+/g, " ").trim() || "presentation";
  const printDeck = () => {
    const { w, h } = SIZE[deck.ratio];
    const pages = deck.slides.filter((s) => !s.hidden).map((s) => `<div class="pg">${slideHtml(s, deck)}</div>`).join("");
    const fonts = Array.from(new Set([theme.titleFont, theme.bodyFont])).map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700`).join("&");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${base}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap"><style>@page{size:${w}pt ${h}pt;margin:0}html,body{margin:0}.pg{width:${w}pt;height:${h}pt;overflow:hidden;break-after:page}.pg>.sl-slide{transform:scale(1.3333);transform-origin:top left}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}${SLIDE_CSS}</style></head><body>${pages}</body></html>`;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    }, 900);
  };
  const exportImages = async (only?: number) => {
    flash("Rendering slides…");
    const { toPng } = await import("html-to-image");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0";
    document.body.appendChild(host);
    const style = document.createElement("style");
    style.textContent = SLIDE_CSS;
    host.appendChild(style);
    const out: Record<string, Uint8Array> = {};
    try {
      const list = only !== undefined ? [only] : deck.slides.map((_, i) => i);
      for (const i of list) {
        const wrap = document.createElement("div");
        wrap.innerHTML = slideHtml(deck.slides[i], deck);
        host.appendChild(wrap);
        const url = await toPng(wrap.firstElementChild as HTMLElement, { pixelRatio: 2, cacheBust: true });
        wrap.remove();
        const bin = atob(url.split(",")[1]);
        const bytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        out[`${base}-slide-${String(i + 1).padStart(2, "0")}.png`] = bytes;
      }
      const names = Object.keys(out);
      if (names.length === 1) saveBlob(new Blob([out[names[0]] as BlobPart], { type: "image/png" }), names[0]);
      else saveBlob(new Blob([zipSync(out) as BlobPart], { type: "application/zip" }), `${base}-slides.zip`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't render the slides.");
    } finally {
      host.remove();
    }
  };
  const exportHtml = () => {
    const slides = deck.slides.filter((s) => !s.hidden).map((s) => slideHtml(s, deck));
    const { w, h } = SIZE[deck.ratio];
    const fonts = Array.from(new Set([theme.titleFont, theme.bodyFont])).map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700`).join("&");
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${base}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#s{position:absolute;left:50%;top:50%;transform-origin:center}.sl-slide{display:none}.sl-slide.on{display:block;animation:f .5s}@keyframes f{from{opacity:0}}${SLIDE_CSS}</style></head><body><div id="s">${slides.join("")}</div><script>var i=0,s=document.querySelectorAll('.sl-slide');function fit(){var k=Math.min(innerWidth/${w},innerHeight/${h});document.getElementById('s').style.transform='translate(-50%,-50%) scale('+k+')';document.getElementById('s').style.width='${w}px';document.getElementById('s').style.height='${h}px'}function go(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach(function(e,j){e.classList.toggle('on',j===i)})}addEventListener('resize',fit);addEventListener('keydown',function(e){if(['ArrowRight',' ','PageDown','Enter'].indexOf(e.key)>=0)go(i+1);if(['ArrowLeft','PageUp','Backspace'].indexOf(e.key)>=0)go(i-1)});addEventListener('click',function(){go(i+1)});fit();go(0)</script></body></html>`;
    saveBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${base}.html`);
  };
  const exportOutline = () => {
    const txt = deck.slides
      .map((s, i) => {
        const div = document.createElement("div");
        const parts = s.elements.filter((e) => e.html).map((e) => {
          div.innerHTML = e.html ?? "";
          return div.innerText.trim();
        });
        return `Slide ${i + 1}\n${parts.join("\n")}${s.notes ? `\n\nNotes: ${s.notes}` : ""}`;
      })
      .join("\n\n---\n\n");
    saveBlob(new Blob([txt], { type: "text/plain;charset=utf-8" }), `${base}-outline.txt`);
  };

  // ---------- render helpers
  const thumbs = deck.slides.map((s) => slideHtml(s, deck));
  const elInner = (el: El) => elementInner(el, theme);
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const hpos: Record<string, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };

  const ribbon = (
    <Ribbon tabs={["File", "Home", "Insert", "Design", "Transitions", "Animations", "Slide Show", "View"]} active={tab} onTab={setTab} right={<span className="hidden pr-2 text-xs text-ink-3 md:inline">Slide {cur + 1} of {deck.slides.length}</span>}>
      {tab === "File" && (
        <>
          <RGroup label="New">
            <RBtn big icon={Presentation} label="Blank" showLabel onClick={() => switchTo(newDeck(deck.theme), "Presentation1")} />
            <RBtn big icon={Palette} label="From theme" showLabel onClick={() => setDialog("themes")} />
          </RGroup>
          <RGroup label="Download">
            <RBtn big icon={Download} label="PowerPoint .pptx" showLabel onClick={async () => { flash("Building .pptx…"); saveBlob(await exportPptx(deck, name), `${base}.pptx`); }} />
            <RBtn big icon={Printer} label="PDF / print" showLabel onClick={printDeck} />
            <RBtn big icon={ImageIcon} label="Slides as PNG" showLabel onClick={() => exportImages()} />
            <RBtn big icon={MonitorPlay} label="Web slideshow" showLabel onClick={exportHtml} />
            <RBtn big icon={Type} label="Outline .txt" showLabel onClick={exportOutline} />
          </RGroup>
        </>
      )}
      {tab === "Home" && (
        <>
          <RGroup label="Undo">
            <RBtn icon={Undo2} label="Undo" shortcut="Ctrl+Z" onClick={doUndo} />
            <RBtn icon={Redo2} label="Redo" shortcut="Ctrl+Y" onClick={doRedo} />
          </RGroup>
          <RGroup label="Slides">
            <Menu icon={Plus} label="New slide" items={LAYOUTS.map((l) => ({ label: l.name, onClick: () => addSlide(l.id) }))} />
            <Menu icon={LayoutTemplate} label="Layout" items={LAYOUTS.map((l) => ({ label: l.name, checked: slide.layout === l.id, onClick: () => applyLayout(l.id) }))} />
            <RBtn icon={Copy} label="Duplicate slide" onClick={() => dupSlide()} />
            <RBtn icon={Trash2} label="Delete slide" onClick={() => delSlide()} />
          </RGroup>
          <RGroup label="Font">
            <RSelect label="Font" value={one?.text?.font ?? (one?.role === "title" ? theme.titleFont : theme.bodyFont)} width={130} onChange={(v) => { ensureFont(v); if (editing) fmtText("fontName", v); else setTextProp({ font: v }); }} options={FONTS.map((f) => ({ value: f, label: f, style: { fontFamily: f } }))} />
            <RSelect label="Font size" value={String(one?.text?.size ?? 24)} width={64} onChange={(v) => setTextProp({ size: Number(v) })} options={[...FONT_SIZES, 110, 140].map((s) => ({ value: String(s), label: String(s) }))} />
            <RBtn icon={Bold} label="Bold" active={Boolean(one?.text?.bold)} onClick={() => fmtText("bold")} />
            <RBtn icon={Italic} label="Italic" active={Boolean(one?.text?.italic)} onClick={() => fmtText("italic")} />
            <RBtn icon={Underline} label="Underline" active={Boolean(one?.text?.underline)} onClick={() => fmtText("underline")} />
            <ColorButton icon={Type} label="Text colour" value={one?.text?.color} onChange={(c) => (editing ? fmtText("foreColor", c ?? "#000000") : setTextProp({ color: c ?? undefined }))} />
          </RGroup>
          <RGroup label="Paragraph">
            <RBtn icon={AlignLeft} label="Align left" active={one?.text?.align === "left"} onClick={() => setTextProp({ align: "left" })} />
            <RBtn icon={AlignCenter} label="Center" active={one?.text?.align === "center"} onClick={() => setTextProp({ align: "center" })} />
            <RBtn icon={AlignRight} label="Align right" active={one?.text?.align === "right"} onClick={() => setTextProp({ align: "right" })} />
            <Menu label="Vertical" items={(["top", "middle", "bottom"] as const).map((v) => ({ label: v[0].toUpperCase() + v.slice(1), checked: one?.text?.valign === v, onClick: () => setTextProp({ valign: v }) }))} />
            <RBtn icon={List} label="Bullets" onClick={() => (editing ? fmtText("insertUnorderedList") : updateEls(sel, (e) => (e.html !== undefined ? { ...e, html: toggleBullets(e.html) } : e)))} />
            <Menu label="Spacing" items={[1, 1.15, 1.35, 1.5, 2].map((v) => ({ label: `Line spacing ${v}`, checked: one?.text?.lineHeight === v, onClick: () => setTextProp({ lineHeight: v }) }))} />
          </RGroup>
          <RGroup label="Arrange">
            <Menu
              label="Arrange"
              items={[
                { label: "Bring to front", icon: ArrowUpToLine, onClick: () => order("front") },
                { label: "Bring forward", onClick: () => order("forward") },
                { label: "Send backward", onClick: () => order("backward") },
                { label: "Send to back", icon: ArrowDownToLine, onClick: () => order("back") },
                { divider: true },
                { label: "Align left", onClick: () => align("left") },
                { label: "Align centre", onClick: () => align("center") },
                { label: "Align right", onClick: () => align("right") },
                { label: "Align top", onClick: () => align("top") },
                { label: "Align middle", onClick: () => align("middle") },
                { label: "Align bottom", onClick: () => align("bottom") },
                { label: "Distribute horizontally", onClick: () => align("hdist") },
                { label: "Distribute vertically", onClick: () => align("vdist") },
              ]}
            />
            <RBtn icon={Copy} label="Duplicate" shortcut="Ctrl+D" onClick={dupSel} disabled={!sel.length} />
            <RBtn icon={Trash2} label="Delete" onClick={delSel} disabled={!sel.length} />
          </RGroup>
        </>
      )}
      {tab === "Insert" && (
        <>
          <RGroup label="Slides">
            <Menu icon={Plus} label="New slide" big items={LAYOUTS.map((l) => ({ label: l.name, onClick: () => addSlide(l.id) }))} />
          </RGroup>
          <RGroup label="Insert">
            <RBtn big icon={Type} label="Text box" showLabel onClick={addText} />
            <Menu icon={Shapes} label="Shapes" big items={SHAPES.map((s) => ({ label: s.label, onClick: () => addShape(s.kind) }))} />
            <RBtn big icon={ImageIcon} label="Picture" showLabel onClick={() => setDialog("image")} />
            <RBtn big icon={TableIcon} label="Table" showLabel onClick={() => setDialog("table")} />
            <RBtn big icon={BarChart3} label="Chart" showLabel onClick={() => setDialog("chart")} />
          </RGroup>
          <RGroup label="Text">
            <RBtn big label="Slide number" showLabel icon={Square} onClick={() => addEl({ type: "text", x: SW - 90, y: SH - 40, w: 70, h: 28, html: `<p>${cur + 1}</p>`, text: { size: 14, align: "right", valign: "middle" } })} />
            <RBtn big label="Date" showLabel icon={Square} onClick={() => addEl({ type: "text", x: 24, y: SH - 40, w: 220, h: 28, html: `<p>${new Date().toLocaleDateString()}</p>`, text: { size: 14, align: "left", valign: "middle" } })} />
          </RGroup>
        </>
      )}
      {tab === "Design" && (
        <>
          <RGroup label="Themes">
            <div className="flex max-w-[560px] gap-1.5 overflow-x-auto py-1">
              {THEMES.map((t) => (
                <button key={t.id} type="button" title={t.name} onClick={() => commit((d) => ({ ...d, theme: t.id, slides: d.slides.map((s) => ({ ...s, bg: undefined })) }))} className={cn("h-12 w-20 shrink-0 overflow-hidden rounded-[6px] border text-left", deck.theme === t.id ? "border-ink ring-2 ring-accent/40" : "border-line")} style={{ background: t.bg }}>
                  <span className="block px-1.5 pt-1 text-[11px] font-bold" style={{ color: t.title, fontFamily: t.titleFont }}>{t.name}</span>
                  <span className="flex gap-0.5 px-1.5 pt-1">{t.accent.slice(0, 4).map((c) => <span key={c} className="h-1.5 w-3 rounded-sm" style={{ background: c }} />)}</span>
                </button>
              ))}
            </div>
          </RGroup>
          <RGroup label="Customize">
            <Menu label="Slide size" items={[{ label: "Widescreen (16:9)", checked: deck.ratio === "16:9", onClick: () => commit((d) => resizeDeck(d, "16:9")) }, { label: "Standard (4:3)", checked: deck.ratio === "4:3", onClick: () => commit((d) => resizeDeck(d, "4:3")) }]} />
            <Menu
              label="Background"
              items={[
                ...BACKGROUNDS.map((b, i) => ({ label: b.startsWith("#") ? `Colour ${b}` : `Gradient ${i - 7}`, onClick: () => updateSlide((s) => ({ ...s, bg: b })) })),
                { divider: true as const },
                { label: "Picture…", onClick: () => pickBgImage() },
                { label: "Reset to theme", onClick: () => updateSlide((s) => ({ ...s, bg: undefined })) },
                { label: "Apply to all slides", onClick: () => commit((d) => ({ ...d, slides: d.slides.map((s) => ({ ...s, bg: slide.bg })) })) },
              ]}
            />
            <ColorButton icon={Palette} label="Background colour" value={slide.bg?.startsWith("#") ? slide.bg : undefined} onChange={(c) => updateSlide((s) => ({ ...s, bg: c ?? undefined }))} />
          </RGroup>
        </>
      )}
      {tab === "Transitions" && (
        <>
          <RGroup label="Transition to this slide">
            {(["none", "fade", "slide", "push", "zoom", "flip", "cover"] as Transition[]).map((t) => (
              <RBtn key={t} label={t === "none" ? "None" : t[0].toUpperCase() + t.slice(1)} showLabel active={slide.transition === t} onClick={() => updateSlide((s) => ({ ...s, transition: t }))} />
            ))}
          </RGroup>
          <RGroup label="Timing">
            <RBtn label="Apply to all" showLabel onClick={() => commit((d) => ({ ...d, slides: d.slides.map((s) => ({ ...s, transition: slide.transition })) }))} />
            <RBtn icon={MonitorPlay} label="Preview" showLabel onClick={() => setPresent({ start: cur, presenter: false })} />
          </RGroup>
        </>
      )}
      {tab === "Animations" && (
        <>
          <RGroup label={one ? "Entrance animation" : "Select an object"}>
            {(["none", "fade", "fly-left", "fly-right", "fly-up", "zoom", "wipe", "spin"] as Anim["type"][]).map((a) => (
              <RBtn
                key={a}
                label={a === "none" ? "None" : a.replace("-", " ").replace(/^\w/, (c) => c.toUpperCase())}
                showLabel
                disabled={!sel.length}
                active={one?.anim?.type === a || (!one?.anim && a === "none" && Boolean(one))}
                onClick={() => {
                  const maxOrder = Math.max(0, ...slide.elements.map((e) => e.anim?.order ?? 0));
                  updateEls(sel, (e) => ({ ...e, anim: a === "none" ? undefined : { type: a, order: e.anim?.order || maxOrder + 1 } }));
                }}
              />
            ))}
          </RGroup>
          <RGroup label="Order">
            <span className="px-2 text-xs text-ink-2">{one?.anim ? `Plays on click ${one.anim.order}` : "—"}</span>
            <RBtn icon={Minus} label="Earlier" disabled={!one?.anim} onClick={() => updateEls(sel, (e) => (e.anim ? { ...e, anim: { ...e.anim, order: Math.max(1, e.anim.order - 1) } } : e))} />
            <RBtn icon={Plus} label="Later" disabled={!one?.anim} onClick={() => updateEls(sel, (e) => (e.anim ? { ...e, anim: { ...e.anim, order: e.anim.order + 1 } } : e))} />
            <RBtn icon={Sparkles} label="Preview" showLabel onClick={() => setPresent({ start: cur, presenter: false })} />
          </RGroup>
        </>
      )}
      {tab === "Slide Show" && (
        <RGroup label="Start">
          <RBtn big icon={MonitorPlay} label="From beginning" showLabel shortcut="F5" onClick={() => setPresent({ start: 0, presenter: false })} />
          <RBtn big icon={MonitorPlay} label="From current" showLabel shortcut="Shift+F5" onClick={() => setPresent({ start: cur, presenter: false })} />
          <RBtn big icon={Presentation} label="Presenter view" showLabel onClick={() => setPresent({ start: cur, presenter: true })} />
          <RBtn big icon={slide.hidden ? Eye : EyeOff} label={slide.hidden ? "Unhide slide" : "Hide slide"} showLabel onClick={() => updateSlide((s) => ({ ...s, hidden: !s.hidden }))} />
        </RGroup>
      )}
      {tab === "View" && (
        <RGroup label="Show">
          <RBtn label="Notes" showLabel active={showNotes} onClick={() => setShowNotes((v) => !v)} />
          <RBtn label="Format pane" showLabel active={panelOpen} onClick={() => setPanelOpen((v) => !v)} />
          <RBtn label="Snap to guides" showLabel active={snap} onClick={() => setSnap((v) => !v)} />
        </RGroup>
      )}
    </Ribbon>
  );

  function pickBgImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) {
        const src = await toDataUrl(f, 1920);
        updateSlide((s) => ({ ...s, bg: `url(${src}) center/cover` }));
      }
    };
    input.click();
  }

  if (present) {
    return <Slideshow deck={deck} start={present.start} presenter={present.presenter} channelName={`dwyl-slides-${docId}`} onExit={() => setPresent(null)} onIndex={(i) => setCur(i)} />;
  }

  return (
    <EditorFrame fullscreen={fullscreen}>
      <div data-editor className="flex min-h-0 flex-1 flex-col">
        <style>{SLIDE_CSS}</style>
        <TitleBar
          app="slides"
          icon={Presentation}
          name={name}
          onRename={setName}
          saveState={saveState}
          onNew={() => switchTo(newDeck(deck.theme), "Presentation1")}
          onOpenFile={openFile}
          accept=".pptx,.ppsx,.potx,.pptm,.ppt,.odp,.key,.pdf"
          onPickDoc={async (id) => {
            const d = await loadDoc<Saved>(id);
            if (d) onSwitch(id, d);
          }}
          currentId={docId}
          fullscreen={fullscreen}
          onFullscreen={() => setFullscreen((f) => !f)}
          extra={
            <>
              <RBtn icon={MonitorPlay} label="Present" showLabel onClick={() => setPresent({ start: cur, presenter: false })} />
              <RBtn icon={Download} label="Download .pptx" onClick={async () => saveBlob(await exportPptx(deck, name), `${base}.pptx`)} />
            </>
          }
        />
        {ribbon}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* thumbnails */}
          <aside className="order-2 flex shrink-0 gap-2 overflow-x-auto border-t border-line bg-paper/60 p-2 md:order-none md:w-44 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-r md:border-t-0" aria-label="Slides">
            {deck.slides.map((s, i) => (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/slide", String(i))}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(i);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  const from = Number(e.dataTransfer.getData("text/slide"));
                  setDragOver(null);
                  if (!Number.isNaN(from)) moveSlide(from, i);
                }}
                className={cn("group relative shrink-0 cursor-pointer", dragOver === i && "pt-2")}
                onClick={() => {
                  if (editing) stopEdit();
                  setCur(i);
                  setSel([]);
                }}
              >
                <span className="absolute -left-0.5 top-0 text-[10px] text-ink-3">{i + 1}</span>
                <div className={cn("ml-3 overflow-hidden rounded-[4px] border-2 bg-white", i === cur ? "border-[#c43e1c]" : "border-transparent hover:border-line", s.hidden && "opacity-40")} style={{ width: 132, height: (132 * SH) / SW }}>
                  <div style={{ width: SW, height: SH, transform: `scale(${132 / SW})`, transformOrigin: "top left", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: thumbs[i] }} />
                </div>
                <div className="absolute right-0 top-0 hidden gap-0.5 group-hover:flex">
                  <button type="button" aria-label="Duplicate slide" className="rounded bg-white/90 p-0.5 shadow" onClick={(e) => { e.stopPropagation(); dupSlide(i); }}><Copy className="size-3" /></button>
                  <button type="button" aria-label="Delete slide" className="rounded bg-white/90 p-0.5 shadow" onClick={(e) => { e.stopPropagation(); delSlide(i); }}><Trash2 className="size-3" /></button>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => addSlide("content", deck.slides.length - 1)} className="ml-3 flex shrink-0 items-center justify-center rounded-[4px] border-2 border-dashed border-line text-ink-3 hover:border-ink-3 hover:text-ink" style={{ width: 132, height: (132 * SH) / SW }} aria-label="Add slide">
              <Plus className="size-5" />
            </button>
          </aside>

          {/* stage */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#e7e5df]" onPointerMove={onMove} onPointerUp={onUp} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); void addImage(f); } }}>
              <div
                ref={canvasRef}
                className="absolute select-none shadow-[0_2px_12px_rgba(0,0,0,.18)] [touch-action:none]"
                style={{ width: SW * scale, height: SH * scale, left: (stage.w - SW * scale) / 2, top: (stage.h - SH * scale) / 2 }}
                onPointerDown={onCanvasDown}
              >
                <div style={{ width: SW, height: SH, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative", overflow: "hidden", background: slide.bg ?? theme.bg }}>
                  {!slide.bg && theme.deco && <div className="pointer-events-none" dangerouslySetInnerHTML={{ __html: theme.deco }} />}
                  {slide.elements.map((el) => (
                    <div
                      key={el.id}
                      style={cssObj(boxCss(el))}
                      className={cn(el.type === "text" && !el.html?.replace(/<[^>]+>/g, "").trim() && "outline outline-1 outline-dashed outline-[#aaa]")}
                      onPointerDown={(e) => onElDown(e, el)}
                      onDoubleClick={() => el.html !== undefined && startEdit(el.id)}
                    >
                      {editing === el.id ? (
                        <div
                          ref={editRef}
                          contentEditable
                          suppressContentEditableWarning
                          className="sl-text absolute inset-0 cursor-text select-text outline-none"
                          style={{ ...cssObj(textCss(el.text, theme, el.role)), padding: el.type === "shape" ? "8px 12px" : "4px 6px", overflow: "visible" }}
                          onBlur={stopEdit}
                          onInput={syncEdit}
                          onPointerDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") stopEdit();
                            e.stopPropagation();
                          }}
                        />
                      ) : (
                        <>
                          {el.type === "shape" && el.shape && <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: elementInner({ ...el, html: undefined }, theme) }} />}
                          {el.type !== "shape" && <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: elInner(el) }} />}
                          {el.type === "shape" && el.html !== undefined && <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: elementInner({ ...el, shape: undefined, type: "text" }, theme) }} />}
                        </>
                      )}
                    </div>
                  ))}
                  {/* selection frames */}
                  {selected.map((el) => (
                    <div key={`sel-${el.id}`} className="pointer-events-none absolute border border-[#c43e1c]" style={{ left: el.x, top: el.y, width: el.w, height: el.h, transform: `rotate(${el.rot}deg)` }}>
                      {one?.id === el.id && editing !== el.id && (
                        <>
                          {handles.map((hd) => (
                            <div
                              key={hd}
                              onPointerDown={(e) => onHandleDown(e, hd)}
                              className="pointer-events-auto absolute rounded-full border border-[#c43e1c] bg-white"
                              style={{ width: 11 / scale, height: 11 / scale, left: `calc(${hpos[hd][0] * 100}% - ${5.5 / scale}px)`, top: `calc(${hpos[hd][1] * 100}% - ${5.5 / scale}px)`, cursor: `${hd}-resize`, touchAction: "none" }}
                            />
                          ))}
                          <div onPointerDown={(e) => onHandleDown(e, "rot")} className="pointer-events-auto absolute left-1/2 rounded-full border border-[#c43e1c] bg-white" style={{ width: 13 / scale, height: 13 / scale, top: -28 / scale, marginLeft: -6.5 / scale, cursor: "grab", touchAction: "none" }} title="Rotate (hold Shift for 15° steps)" />
                        </>
                      )}
                    </div>
                  ))}
                  {guides.v.map((x, i) => <div key={`v${i}`} className="pointer-events-none absolute top-0 h-full border-l border-dashed border-[#ff2fd2]" style={{ left: x }} />)}
                  {guides.h.map((y, i) => <div key={`h${i}`} className="pointer-events-none absolute left-0 w-full border-t border-dashed border-[#ff2fd2]" style={{ top: y }} />)}
                  {marquee && <div className="pointer-events-none absolute border border-[#2b579a] bg-[#2b579a]/10" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
                </div>
              </div>
            </div>
            {showNotes && (
              <textarea
                aria-label="Speaker notes"
                placeholder="Click to add speaker notes"
                value={slide.notes}
                onChange={(e) => {
                  const v = e.target.value;
                  setDeckRaw((d) => ({ ...d, slides: d.slides.map((s, i) => (i === cur ? { ...s, notes: v } : s)) }));
                }}
                className="h-20 shrink-0 resize-y border-t border-line bg-white px-3 py-2 text-sm text-ink outline-none"
              />
            )}
          </div>

          {/* format pane */}
          {panelOpen && (
            <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-line bg-paper/40 p-3 text-[13px] lg:block" aria-label="Format">
              {one ? <FormatPane el={one} onChange={(patch) => updateEls([one.id], (e) => ({ ...e, ...patch }))} theme={theme.accent} /> : selected.length > 1 ? <p className="text-ink-2">{selected.length} objects selected. Use Arrange to align or distribute them.</p> : (
                <div className="space-y-3">
                  <p className="text-[10px] uppercase tracking-wide text-ink-3">Slide</p>
                  <p className="text-ink-2">Layout: {LAYOUTS.find((l) => l.id === slide.layout)?.name ?? "Custom"}</p>
                  <p className="text-ink-2">Transition: {slide.transition}</p>
                  <div>
                    <p className="mb-1 text-ink-2">Background</p>
                    <div className="grid grid-cols-4 gap-1">
                      {BACKGROUNDS.map((b) => (
                        <button key={b} type="button" aria-label="Set background" onClick={() => updateSlide((s) => ({ ...s, bg: b }))} className="h-8 rounded border border-line" style={{ background: b }} />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-ink-3">Tip: double-click text to edit, drag to move, Shift-drag a corner to keep proportions, arrows nudge, Ctrl+D duplicates, F5 presents.</p>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addImage(f); }} />
      {notice && <div className="fixed bottom-6 left-1/2 z-[95] -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-xs text-paper shadow-float" role="status">{notice}</div>}

      {dialog === "image" && (
        <Modal open onClose={() => setDialog(null)} title="Insert picture">
          <button type="button" className={cn(primaryCls, "w-full")} onClick={() => { setDialog(null); fileRef.current?.click(); }}>
            <ImageIcon className="size-4" /> Choose from this device
          </button>
          <ImageUrlField onUrl={(u) => { setDialog(null); addEl({ type: "image", x: SW / 2 - 200, y: SH / 2 - 150, w: 400, h: 300, src: u, fit: "contain" }); }} />
        </Modal>
      )}
      {dialog === "table" && <TableDialog onClose={() => setDialog(null)} onInsert={(r, c) => { setDialog(null); addEl({ type: "table", x: 60, y: 120, w: SW - 120, h: Math.min(SH - 180, 44 * r), table: { rows: Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => (i === 0 ? `Header ${j + 1}` : ""))), header: true }, text: { size: 16, align: "left", valign: "top" } }); }} />}
      {dialog === "chart" && <ChartDialog onClose={() => setDialog(null)} onInsert={(chart) => { setDialog(null); addEl({ type: "chart", x: 80, y: 110, w: SW - 160, h: SH - 160, chart }); }} />}
      {dialog === "themes" && (
        <Modal open onClose={() => setDialog(null)} title="New presentation from a theme" wide>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {THEMES.map((t) => (
              <button key={t.id} type="button" onClick={() => { setDialog(null); void switchTo(newDeck(t.id), `${t.name} presentation`); }} className="overflow-hidden rounded-md border border-line text-left hover:border-ink-3">
                <div className="flex aspect-video flex-col justify-center px-3" style={{ background: t.bg }}>
                  <span className="text-lg font-bold" style={{ color: t.title, fontFamily: t.titleFont }}>{t.name}</span>
                  <span className="mt-1 flex gap-1">{t.accent.map((c) => <span key={c} className="h-2 w-4 rounded-sm" style={{ background: c }} />)}</span>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </EditorFrame>
  );
}

function toggleBullets(html: string): string {
  if (/<ul|<ol/.test(html)) return html.replace(/<\/?(ul|ol)>/g, "").replace(/<li>/g, "<p>").replace(/<\/li>/g, "</p>");
  const div = document.createElement("div");
  div.innerHTML = html;
  const items = Array.from(div.querySelectorAll("p")).map((p) => `<li>${p.innerHTML}</li>`);
  return items.length ? `<ul>${items.join("")}</ul>` : `<ul><li>${html}</li></ul>`;
}

function resizeDeck(d: Deck, ratio: Deck["ratio"]): Deck {
  if (d.ratio === ratio) return d;
  const fx = SIZE[ratio].w / SIZE[d.ratio].w;
  return { ...d, ratio, slides: d.slides.map((s) => ({ ...s, elements: s.elements.map((e) => ({ ...e, x: e.x * fx, w: e.w * fx })) })) };
}

function cssObj(css: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (!k) continue;
    out[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out as React.CSSProperties;
}

async function toDataUrl(file: File, max: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (s === 1 && file.size < 2_000_000 && /png|jpe?g|gif|svg/.test(file.type)) {
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(file);
      });
    }
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function FormatPane({ el, onChange, theme }: { el: El; onChange: (p: Partial<El>) => void; theme: string[] }) {
  const num = (label: string, key: "x" | "y" | "w" | "h" | "rot") => (
    <label className="flex items-center gap-1 text-ink-2">
      <span className="w-4">{label}</span>
      <input type="number" value={Math.round(el[key])} onChange={(e) => onChange({ [key]: Number(e.target.value) })} className="h-7 w-full rounded border border-line bg-white px-1.5" />
    </label>
  );
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-3">Position & size</p>
        <div className="grid grid-cols-2 gap-1.5">
          {num("X", "x")}
          {num("Y", "y")}
          {num("W", "w")}
          {num("H", "h")}
          {num("°", "rot")}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-3">Opacity {Math.round((el.opacity ?? 1) * 100)}%</p>
        <input type="range" min={0.05} max={1} step={0.05} value={el.opacity ?? 1} onChange={(e) => onChange({ opacity: Number(e.target.value) })} className="w-full accent-[#c43e1c]" />
      </div>
      {el.shape && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-3">Shape</p>
          <select value={el.shape.kind} onChange={(e) => onChange({ shape: { ...el.shape!, kind: e.target.value as ShapeKind } })} className={inputCls}>
            {SHAPES.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
          </select>
          <div className="flex items-center gap-2 text-ink-2">
            Fill <input type="color" value={toHex(el.shape.fill) ?? theme[0]} onChange={(e) => onChange({ shape: { ...el.shape!, fill: e.target.value } })} className="h-7 w-10 rounded border border-line" />
            Line <input type="color" value={toHex(el.shape.stroke) ?? "#000000"} onChange={(e) => onChange({ shape: { ...el.shape!, stroke: e.target.value, strokeW: el.shape!.strokeW ?? 2 } })} className="h-7 w-10 rounded border border-line" />
            <input type="number" min={0} max={20} value={el.shape.strokeW ?? 0} onChange={(e) => onChange({ shape: { ...el.shape!, strokeW: Number(e.target.value), stroke: Number(e.target.value) ? el.shape!.stroke ?? "#000000" : undefined } })} className="h-7 w-12 rounded border border-line px-1" aria-label="Line width" />
          </div>
          <div className="flex flex-wrap gap-1">{theme.map((c) => <button key={c} type="button" aria-label={`Fill ${c}`} className="size-6 rounded border border-line" style={{ background: c }} onClick={() => onChange({ shape: { ...el.shape!, fill: c } })} />)}</div>
          <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" checked={Boolean(el.shape.shadow)} onChange={(e) => onChange({ shape: { ...el.shape!, shadow: e.target.checked } })} /> Shadow</label>
        </div>
      )}
      {el.type === "image" && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-3">Picture</p>
          <div className="flex gap-1">
            {(["cover", "contain"] as const).map((f) => <button key={f} type="button" onClick={() => onChange({ fit: f })} className={cn("rounded border px-2 py-1", el.fit === f ? "border-ink bg-ink text-paper" : "border-line")}>{f === "cover" ? "Fill" : "Fit"}</button>)}
          </div>
          <label className="block text-ink-2">Rounded corners
            <input type="range" min={0} max={200} value={el.radius ?? 0} onChange={(e) => onChange({ radius: Number(e.target.value) })} className="w-full accent-[#c43e1c]" />
          </label>
        </div>
      )}
      {el.type === "table" && el.table && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-3">Table (one row per line, cells separated by |)</p>
          <textarea rows={6} defaultValue={el.table.rows.map((r) => r.join(" | ")).join("\n")} onBlur={(e) => onChange({ table: { ...el.table!, rows: e.target.value.split("\n").filter((l) => l.trim()).map((l) => l.split("|").map((c) => c.trim())) } })} className="w-full rounded border border-line p-1.5 font-mono text-xs" />
          <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" checked={el.table.header} onChange={(e) => onChange({ table: { ...el.table!, header: e.target.checked } })} /> Header row</label>
          <div className="flex items-center gap-2 text-ink-2">Header colour <input type="color" value={toHex(el.table.color) ?? theme[0]} onChange={(e) => onChange({ table: { ...el.table!, color: e.target.value } })} className="h-7 w-10 rounded border border-line" /></div>
        </div>
      )}
      {el.type === "chart" && el.chart && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-3">Chart</p>
          <select value={el.chart.type} onChange={(e) => onChange({ chart: { ...el.chart!, type: e.target.value as NonNullable<El["chart"]>["type"] } })} className={inputCls}>
            {["column", "bar", "line", "pie", "doughnut"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <textarea rows={6} defaultValue={chartToText(el.chart)} onBlur={(e) => { const c = textToChart(e.target.value, el.chart!.type); if (c) onChange({ chart: c }); }} className="w-full rounded border border-line p-1.5 font-mono text-xs" />
          <p className="text-[11px] text-ink-3">First line: labels. Then one line per series: Name, values…</p>
        </div>
      )}
      {el.link !== undefined || el.type !== "chart" ? (
        <label className="block text-ink-2">Link (opens in the slideshow)
          <input value={el.link ?? ""} onChange={(e) => onChange({ link: e.target.value || undefined })} placeholder="https://" className={inputCls} />
        </label>
      ) : null}
    </div>
  );
}

const toHex = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined);

function chartToText(c: NonNullable<El["chart"]>): string {
  return [c.labels.join(", "), ...c.series.map((s) => [s.name, ...s.values].join(", "))].join("\n");
}
function textToChart(t: string, type: NonNullable<El["chart"]>["type"]): El["chart"] | null {
  const lines = t.split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((l) => l.length && l[0] !== "");
  if (lines.length < 2) return null;
  return { type, labels: lines[0], series: lines.slice(1).map((l) => ({ name: l[0], values: l.slice(1).map((v) => Number(v) || 0) })) };
}

function ImageUrlField({ onUrl }: { onUrl: (u: string) => void }) {
  const [u, setU] = useState("");
  return (
    <div className="mt-3 flex gap-2">
      <input value={u} onChange={(e) => setU(e.target.value)} placeholder="https://…/picture.jpg" className={inputCls} />
      <button type="button" className={secondaryCls} disabled={!/^https?:\/\//.test(u)} onClick={() => onUrl(u)}>Insert</button>
    </div>
  );
}

function TableDialog({ onClose, onInsert }: { onClose: () => void; onInsert: (r: number, c: number) => void }) {
  const [r, setR] = useState(4);
  const [c, setC] = useState(3);
  return (
    <Modal open onClose={onClose} title="Insert table" footer={<><button type="button" className={secondaryCls} onClick={onClose}>Cancel</button><button type="button" className={primaryCls} onClick={() => onInsert(r, c)}>Insert</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-ink-2">Rows<input type="number" min={2} max={20} value={r} onChange={(e) => setR(Math.max(2, Math.min(20, Number(e.target.value))))} className={inputCls} /></label>
        <label className="text-sm text-ink-2">Columns<input type="number" min={1} max={10} value={c} onChange={(e) => setC(Math.max(1, Math.min(10, Number(e.target.value))))} className={inputCls} /></label>
      </div>
    </Modal>
  );
}

function ChartDialog({ onClose, onInsert }: { onClose: () => void; onInsert: (c: NonNullable<El["chart"]>) => void }) {
  const [type, setType] = useState<NonNullable<El["chart"]>["type"]>("column");
  const [text, setText] = useState("Q1, Q2, Q3, Q4\nSales, 120, 150, 170, 210\nCosts, 80, 95, 100, 120");
  const parsed = textToChart(text, type);
  return (
    <Modal open onClose={onClose} title="Insert chart" footer={<><button type="button" className={secondaryCls} onClick={onClose}>Cancel</button><button type="button" className={primaryCls} disabled={!parsed} onClick={() => parsed && onInsert(parsed)}>Insert</button></>}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["column", "bar", "line", "pie", "doughnut"] as const).map((t) => <button key={t} type="button" onClick={() => setType(t)} className={cn("rounded-[6px] border px-3 py-1.5 text-sm capitalize", type === t ? "border-ink bg-ink text-paper" : "border-line")}>{t}</button>)}
      </div>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-[6px] border border-line p-2 font-mono text-sm" />
      <p className="mt-1 text-xs text-ink-3">First line: category labels. Then one line per series: name, then its values (comma-separated). Pie charts use the first series.</p>
    </Modal>
  );
}
