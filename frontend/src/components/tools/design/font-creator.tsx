"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Brush, Download, Eraser, Grid3x3, Printer, RotateCcw, ScanText, Trash2, Undo2 } from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import {
  AREA_W_UNITS,
  ASC,
  buildFont,
  CAP,
  PER_PAGE,
  previewPath,
  PX,
  PX_COLS,
  PX_ROWS,
  SETS,
  sheetLayout,
  templatePage,
  toUnits,
  UPM,
  XH,
  type GlyphData,
  type Stroke,
} from "@/lib/font-maker";
import { loadFace } from "@/lib/fonts";
import { decode, pixels, vision } from "@/lib/scan";
import { getTool, stepsFor, toolHref } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { messageOf } from "../pdf/parts";

const STORE = "dw-font-creator-v1";
type Mode = "draw" | "pixel" | "scan";
type Settings = { family: string; style: string; sets: string[]; sideBearing: number; space: number; capsForLower: boolean; brush: number };
const START: Settings = { family: "My Handwriting", style: "Regular", sets: ["upper", "lower", "digits", "punct"], sideBearing: 60, space: 280, capsForLower: true, brush: 70 };
const DRAW_PX = 500; // the drawing raster: 2 units per pixel
const PIX_CELL = 16;

/**
 * Make a font in the browser: draw each letter, build a pixel font, or write on a printed template and
 * photograph it. Every change rebuilds a real OpenType font that the preview uses, and it downloads as
 * OTF, TTF, WOFF or WOFF2.
 */
export function FontCreator({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(START);
  const [glyphs, setGlyphs] = useState<Record<string, GlyphData>>({});
  const [mode, setMode] = useState<Mode>("draw");
  const [current, setCurrent] = useState("A");
  const [restored, setRestored] = useState(false);
  const [font, setFont] = useState<{ family: string; bytes: ArrayBuffer; count: number } | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const chars = useMemo(() => SETS.filter((s) => settings.sets.includes(s.id)).flatMap((s) => [...s.chars]), [settings.sets]);
  const set = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));
  const setGlyph = (ch: string, g: GlyphData | null) =>
    setGlyphs((all) => {
      const next = { ...all };
      if (g && g.contours.length) next[ch] = g;
      else delete next[ch];
      return next;
    });

  // Pick up where you left off (this browser only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as { settings: Settings; glyphs: Record<string, GlyphData> };
        setTimeout(() => {
          setSettings({ ...START, ...saved.settings });
          setGlyphs(saved.glyphs ?? {});
          setRestored(true);
        }, 0);
      } else setTimeout(() => setRestored(true), 0);
    } catch {
      setTimeout(() => setRestored(true), 0);
    }
  }, []);
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({ settings, glyphs }));
      } catch {
        /* storage full or off: fine, nothing is lost this session */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [settings, glyphs, restored]);

  // Rebuild the real font a moment after every change, and load it for the preview.
  useEffect(() => {
    if (!Object.keys(glyphs).length) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const built = await buildFont(glyphs, settings);
        const family = await loadFace(built.bytes.slice(0));
        if (live) {
          setFont({ family, bytes: built.bytes, count: built.count });
          setBuildError(null);
        }
      } catch (e) {
        if (live) setBuildError(messageOf(e));
      }
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [glyphs, settings]);

  const made = chars.filter((c) => glyphs[c]).length;
  const step = !made ? 0 : made < chars.length / 2 ? 0 : 1;

  return (
    <Workbench steps={stepsFor(tool)} current={font ? Math.max(step, 1) : step} footer={<>Your font is made in your browser and saved there as you go. Only converting to TTF/WOFF2 sends the finished font to our server, and it&apos;s deleted straight after. Free, and the font is yours.</>}>
      <div className="space-y-3 p-3 sm:p-4">
        <div role="tablist" aria-label="How to make letters" className="grid grid-cols-3 gap-1 rounded-md border border-line bg-paper p-1">
          {(
            [
              ["draw", "Draw", Brush],
              ["pixel", "Pixel", Grid3x3],
              ["scan", "Handwriting", ScanText],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cn("relative inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] text-sm transition-colors", mode === id ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}>
              {mode === id && <motion.span layoutId="font-mode" aria-hidden className="absolute inset-0 rounded-[8px] bg-ink" transition={{ type: "spring", bounce: 0.22, duration: 0.45 }} />}
              <Icon aria-hidden className="relative size-4" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>

        <CharGrid chars={chars} glyphs={glyphs} current={current} onPick={(c) => {
            setCurrent(c);
            if (mode === "scan") setMode("draw");
          }} made={made} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={mode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.25 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            {mode === "draw" && <DrawPad key={`d-${current}`} ch={current} brush={settings.brush} glyph={glyphs[current]} onChange={(g) => setGlyph(current, g)} onNext={() => setCurrent(chars[(chars.indexOf(current) + 1) % chars.length])} onBrush={(brush) => set({ brush })} />}
            {mode === "pixel" && <PixelPad key={`p-${current}`} ch={current} glyph={glyphs[current]} onChange={(g) => setGlyph(current, g)} onNext={() => setCurrent(chars[(chars.indexOf(current) + 1) % chars.length])} />}
            {mode === "scan" && <Template chars={chars} family={settings.family} onGlyphs={(found) => setGlyphs((all) => ({ ...all, ...found }))} />}
          </motion.div>
        </AnimatePresence>

        <Preview font={font} made={made} error={buildError} />

        <Panel>
          <Row label="Font name">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <TextField label="Font name" value={settings.family} onChange={(family) => set({ family })} maxLength={40} />
              <TextField label="Style" value={settings.style} onChange={(style) => set({ style })} maxLength={24} />
            </div>
          </Row>
          <Row label="Characters">
            <div className="flex flex-wrap gap-1.5">
              {SETS.map((s) => {
                const on = settings.sets.includes(s.id);
                return (
                  <button key={s.id} type="button" aria-pressed={on} onClick={() => set({ sets: on ? settings.sets.filter((x) => x !== s.id) : [...settings.sets, s.id] })} className={cn("inline-flex h-8 items-center rounded-sm border px-2.5 text-[13px] transition-colors", on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3")}>
                    {s.label} <span className={cn("ml-1.5 font-mono text-[11px]", on ? "text-paper-dim" : "text-ink-3")}>{s.chars.length}</span>
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label="Letter spacing">
            <Slider value={settings.sideBearing} min={0} max={200} step={5} onChange={(sideBearing) => set({ sideBearing })} format={(v) => String(v)} label="Letter spacing" />
          </Row>
          <Row label="Word spacing">
            <Slider value={settings.space} min={100} max={600} step={10} onChange={(space) => set({ space })} format={(v) => String(v)} label="Word spacing" />
          </Row>
          <Row label="Fill gaps">
            <Toggle checked={settings.capsForLower} onChange={(capsForLower) => set({ capsForLower })} label="Use capitals for small letters you haven't made (and the reverse)" />
          </Row>
        </Panel>

        <Export font={font} family={settings.family} style={settings.style} onCheck={() => {
          if (!font) return;
          let bin = "";
          const b = new Uint8Array(font.bytes);
          for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
          sessionStorage.setItem("dw-font-handoff", JSON.stringify({ name: `${settings.family}.otf`, data: btoa(bin) }));
          router.push(toolHref("font-checker"));
        }} onReset={() => {
          setGlyphs({});
          setFont(null);
        }} />
      </div>
    </Workbench>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function GlyphThumb({ glyph, className }: { glyph: GlyphData; className?: string }) {
  const d = useMemo(() => previewPath(glyph.contours), [glyph]);
  return (
    <svg viewBox={`-50 ${-ASC} ${UPM + 100} ${UPM}`} className={className} aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

function CharGrid({ chars, glyphs, current, onPick, made }: { chars: string[]; glyphs: Record<string, GlyphData>; current: string; onPick: (c: string) => void; made: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="label-mono text-ink-3">Characters · {made} of {chars.length} made</p>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-2" aria-hidden>
          <motion.span className="block h-full bg-ink" animate={{ width: `${(made / Math.max(1, chars.length)) * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
        </span>
      </div>
      <ul className="grid max-h-[220px] grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-px overflow-y-auto overscroll-contain bg-line" data-lenis-prevent>
        {chars.map((c) => {
          const g = glyphs[c];
          const on = c === current;
          return (
            <li key={c} className="bg-surface">
              <button type="button" onClick={() => onPick(c)} aria-pressed={on} aria-label={`${c}${g ? ", made" : ""}`} className={cn("relative flex aspect-square w-full items-center justify-center transition-colors", on ? "bg-ink text-paper" : g ? "text-ink hover:bg-paper-2" : "text-ink-3 hover:bg-paper-2")}>
                {g ? <GlyphThumb glyph={g} className="size-8" /> : <span className="text-lg">{c}</span>}
                <span className={cn("absolute left-1 top-0.5 font-mono text-[9px]", on ? "text-paper-dim" : "text-ink-3")}>{c}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Guide lines drawn over the editing canvases, in em units mapped to the box. */
function Guides() {
  const y = (u: number) => `${((ASC - u) / UPM) * 100}%`;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {[
        ["cap", CAP, "dashed"],
        ["x-height", XH, "dashed"],
        ["baseline", 0, "solid"],
      ].map(([label, u, style]) => (
        <div key={label as string} className="absolute inset-x-0 border-t border-accent/40" style={{ top: y(u as number), borderTopStyle: style as "solid" | "dashed" }}>
          <span className="absolute left-1 -translate-y-full font-mono text-[10px] text-accent/70">{label}</span>
        </div>
      ))}
    </div>
  );
}

function DrawPad({ ch, brush, glyph, onChange, onNext, onBrush }: { ch: string; brush: number; glyph?: GlyphData; onChange: (g: GlyphData | null) => void; onNext: () => void; onBrush: (v: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(glyph?.mode === "draw" ? (glyph.strokes ?? []) : []);
  const drawing = useRef<Stroke | null>(null);
  const [tracing, setTracing] = useState(false);

  const paint = (list: Stroke[], g: CanvasRenderingContext2D, size: number, ink: string) => {
    const k = size / UPM;
    g.clearRect(0, 0, size, size);
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const s of list) {
      g.lineWidth = s.width * k;
      g.beginPath();
      if (s.pts.length === 2) {
        g.arc(s.pts[0] * k, (ASC - s.pts[1]) * k, (s.width * k) / 2, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      for (let i = 0; i < s.pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, s.pts[i] * k, (ASC - s.pts[i + 1]) * k);
      g.stroke();
    }
  };

  useEffect(() => {
    const c = canvas.current!;
    paint(strokes, c.getContext("2d")!, c.width, "#15140f");
  }, [strokes]);

  /** Strokes → a picture → traced outlines → the glyph. */
  const commit = async (list: Stroke[]) => {
    if (!list.length) return onChange(null);
    setTracing(true);
    try {
      const off = document.createElement("canvas");
      off.width = off.height = DRAW_PX;
      const g = off.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, DRAW_PX, DRAW_PX);
      paint(list, g, DRAW_PX, "#000");
      const traced = await vision.trace(g.getImageData(0, 0, DRAW_PX, DRAW_PX), 1.2);
      const k = UPM / DRAW_PX;
      onChange({ mode: "draw", strokes: list, contours: toUnits(traced, (x, y) => [x * k, ASC - y * k], true) });
    } finally {
      setTracing(false);
    }
  };

  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * UPM), Math.round(ASC - ((e.clientY - r.top) / r.height) * UPM)];
  };

  return (
    <div className="grid gap-3 @container md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="relative mx-auto aspect-square w-full max-w-[460px] touch-none select-none overflow-hidden rounded-md border border-line bg-surface">
        <Guides />
        <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[300px] leading-none text-ink/5">{ch}</span>
        <canvas
          ref={canvas}
          width={920}
          height={920}
          aria-label={`Draw ${ch}`}
          className="relative block size-full cursor-crosshair"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const pressure = e.pointerType === "pen" && e.pressure ? 0.6 + e.pressure * 0.8 : 1;
            drawing.current = { pts: at(e), width: Math.round(brush * pressure) };
            setStrokes((s) => [...s, drawing.current!]);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const [x, y] = at(e);
            const p = drawing.current.pts;
            if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 6) return;
            drawing.current = { ...drawing.current, pts: [...p, x, y] };
            setStrokes((s) => [...s.slice(0, -1), drawing.current!]);
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = null;
            void commit(strokes);
          }}
        />
        {tracing && <span className="absolute right-2 top-2 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-[10px] text-paper">tracing…</span>}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <ToolButton onClick={() => { const s = strokes.slice(0, -1); setStrokes(s); void commit(s); }} disabled={!strokes.length} icon={Undo2} label="Undo" />
          <ToolButton onClick={() => { setStrokes([]); onChange(null); }} disabled={!strokes.length} icon={Trash2} label="Clear" />
        </div>
        <Panel>
          <Row label="Pen thickness">
            <Slider value={brush} min={20} max={160} step={5} onChange={onBrush} format={(v) => String(v)} label="Pen thickness" />
          </Row>
        </Panel>
        <p className="text-xs leading-relaxed text-ink-3">Draw “{ch}” sitting on the baseline. Capitals reach the cap line, small letters the x-height. Pen pressure changes the stroke on tablets.</p>
        <button type="button" onClick={onNext} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-ink text-sm font-medium text-paper">
          Next character →
        </button>
      </div>
    </div>
  );
}

function PixelPad({ ch, glyph, onChange, onNext }: { ch: string; glyph?: GlyphData; onChange: (g: GlyphData | null) => void; onNext: () => void }) {
  const [on, setOn] = useState<Set<number>>(() => new Set(glyph?.mode === "pixel" ? glyph.pixels : []));
  const painting = useRef<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (cells: Set<number>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!cells.size) return onChange(null);
      const c = document.createElement("canvas");
      c.width = PX_COLS * PIX_CELL + 4;
      c.height = PX_ROWS * PIX_CELL + 4;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#000";
      cells.forEach((i) => g.fillRect(2 + (i % PX_COLS) * PIX_CELL, 2 + Math.floor(i / PX_COLS) * PIX_CELL, PIX_CELL, PIX_CELL));
      const traced = await vision.trace(g.getImageData(0, 0, c.width, c.height), 0);
      // Contours run through the edge pixels' centres: widen by half a pixel so squares stay square.
      const k = PX / PIX_CELL;
      onChange({ mode: "pixel", pixels: [...cells], contours: toUnits(traced, (x, y) => [(x - 2 + 0.5) * k, ASC - (y - 2 + 0.5) * k], false) });
    }, 150);
  };

  const flip = (i: number, value: boolean) =>
    setOn((s) => {
      if (s.has(i) === value) return s;
      const n = new Set(s);
      if (value) n.add(i);
      else n.delete(i);
      commit(n);
      return n;
    });

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="relative mx-auto w-full max-w-[400px] touch-none select-none" style={{ aspectRatio: `${PX_COLS} / ${PX_ROWS}` }} onPointerUp={() => (painting.current = null)} onPointerLeave={() => (painting.current = null)}>
        <div className="grid size-full gap-px overflow-hidden rounded-md border border-line bg-line" style={{ gridTemplateColumns: `repeat(${PX_COLS}, 1fr)` }}>
          {Array.from({ length: PX_COLS * PX_ROWS }, (_, i) => {
            const row = Math.floor(i / PX_COLS);
            return (
              <button
                key={i}
                type="button"
                aria-label={`Pixel ${(i % PX_COLS) + 1}, ${row + 1}`}
                aria-pressed={on.has(i)}
                onPointerDown={(e) => {
                  e.currentTarget.releasePointerCapture?.(e.pointerId);
                  painting.current = !on.has(i);
                  flip(i, painting.current);
                }}
                onPointerEnter={() => painting.current !== null && flip(i, painting.current)}
                className={cn("transition-colors duration-75", on.has(i) ? "bg-ink" : row === 11 ? "bg-accent/10 hover:bg-paper-2" : row > 11 ? "bg-paper-2/60 hover:bg-paper-2" : "bg-surface hover:bg-paper-2")}
              />
            );
          })}
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <ToolButton onClick={() => { setOn(new Set()); onChange(null); }} disabled={!on.size} icon={Eraser} label="Clear" />
        </div>
        <p className="text-xs leading-relaxed text-ink-3">Tap or drag to fill pixels for “{ch}”. The tinted row is the baseline; the shaded rows below are for descenders (g, p, y).</p>
        <button type="button" onClick={onNext} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-ink text-sm font-medium text-paper">
          Next character →
        </button>
      </div>
    </div>
  );
}

function ToolButton({ onClick, disabled, icon: Icon, label }: { onClick: () => void; disabled?: boolean; icon: typeof Undo2; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-40">
      <Icon aria-hidden className="size-4" /> {label}
    </button>
  );
}

/* ---------- handwriting template ---------- */

function Template({ chars, family, onGlyphs }: { chars: string[]; family: string; onGlyphs: (g: Record<string, GlyphData>) => void }) {
  const pages = Math.max(1, Math.ceil(chars.length / PER_PAGE));
  const [log, setLog] = useState<{ name: string; text: string; ok: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  const print = () => {
    const svgs = Array.from({ length: pages }, (_, p) => templatePage(chars.slice(p * PER_PAGE, (p + 1) * PER_PAGE), p + 1, pages, family));
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><title>${family} template</title><style>@page{size:A4;margin:0}body{margin:0}svg{display:block;page-break-after:always}</style>${svgs.join("")}<script>onload=()=>setTimeout(()=>print(),300)</script>`);
    w.document.close();
  };

  const read = async (files: File[]) => {
    setBusy(true);
    const found: Record<string, GlyphData> = {};
    const entries: typeof log = [];
    for (const f of files) {
      try {
        const bmp = await decode(f);
        const img = pixels(bmp, bmp.width, bmp.height, 3000);
        bmp.close();
        const res = await vision.sheet(img, sheetLayout(5));
        if (!res.ok) {
          entries.push({ name: f.name, text: res.reason ?? "Couldn't read this page.", ok: false });
          continue;
        }
        if (res.page < 1 || res.page > pages) {
          entries.push({ name: f.name, text: `This looks like page ${res.page}, but the template has ${pages}.`, ok: false });
          continue;
        }
        const slice = chars.slice((res.page - 1) * PER_PAGE, res.page * PER_PAGE);
        let n = 0;
        res.cells.forEach((cell, i) => {
          const ch = slice[i];
          if (!ch || !cell.contours.length) return;
          found[ch] = { mode: "scan", contours: toUnits(cell.contours, (x, y) => [x * AREA_W_UNITS, ASC - y * UPM], true) };
          n++;
        });
        entries.push({ name: f.name, text: `Page ${res.page}: ${n} of ${slice.length} characters found.`, ok: n > 0 });
      } catch (e) {
        entries.push({ name: f.name, text: messageOf(e), ok: false });
      }
    }
    onGlyphs(found);
    setLog(entries);
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <ol className="grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3">
        <li className="bg-surface p-3">
          <p className="label-mono text-ink-3">1 · Print</p>
          <p className="mt-1 text-sm text-ink">{pages} page{pages > 1 ? "s" : ""} for {chars.length} characters, A4, at 100%.</p>
          <button type="button" onClick={print} className="mt-2.5 inline-flex h-10 items-center gap-1.5 rounded-md bg-ink px-3.5 text-sm font-medium text-paper">
            <Printer aria-hidden className="size-4" /> Print the template
          </button>
        </li>
        <li className="bg-surface p-3">
          <p className="label-mono text-ink-3">2 · Write</p>
          <p className="mt-1 text-sm text-ink">One character per box, in dark pen, sitting on the solid line. Keep the black corner squares clear.</p>
        </li>
        <li className="bg-surface p-3">
          <p className="label-mono text-ink-3">3 · Photograph</p>
          <p className="mt-1 text-sm text-ink">Each whole page, flat and well lit, or scan it. Any order.</p>
          <label className={cn("mt-2.5 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-ink px-3.5 text-sm font-medium text-ink hover:bg-paper-2 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15", busy && "pointer-events-none opacity-50")}>
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => (void read(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
            <ScanText aria-hidden className="size-4" /> {busy ? "Reading…" : "Add the photos"}
          </label>
        </li>
      </ol>
      {log.map((l, i) => (
        <Notice key={i} tone={l.ok ? "info" : "warning"}>
          <span className="font-medium">{l.name}:</span> {l.text}
        </Notice>
      ))}
    </div>
  );
}

/* ---------- preview and export ---------- */

function Preview({ font, made, error }: { font: { family: string; count: number } | null; made: number; error: string | null }) {
  const [text, setText] = useState("The quick brown fox jumps over the lazy dog. 0123456789");
  const [size, setSize] = useState(48);
  if (!made) return <p className="rounded-md border border-dashed border-line px-3 py-5 text-center text-sm text-ink-3">Make a few characters and your font appears here, ready to type with.</p>;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <p className="label-mono text-ink-3">Your font, live · {font?.count ?? 0} characters</p>
        <div className="w-36">
          <Slider value={size} min={16} max={120} onChange={setSize} format={(v) => `${v}px`} label="Preview size" />
        </div>
      </div>
      {error ? (
        <p className="px-3 py-3 text-sm text-danger">{error}</p>
      ) : (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Type with your font" spellCheck={false} className="block w-full resize-y bg-transparent px-3 py-3 leading-tight text-ink outline-none" style={{ fontFamily: font ? `"${font.family}", var(--font-sans)` : undefined, fontSize: size }} />
      )}
    </div>
  );
}

function Export({ font, family, style, onCheck, onReset }: { font: { bytes: ArrayBuffer; count: number } | null; family: string; style: string; onCheck: () => void; onReset: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = `${(family || "My Font").replace(/[^\w\- ]+/g, "").trim() || "font"}-${(style || "Regular").replace(/\s+/g, "")}`;
  const convert = async (target: string) => {
    if (!font) return;
    setBusy(target);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", new File([font.bytes], `${name}.otf`, { type: "font/otf" }));
      form.append("target", target);
      const out = await uploadForm("/api/tools/universal/convert", form, { fallbackName: `${name}.${target}` });
      saveBlob(out.blob, `${name}.${target}`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!font} onClick={() => font && saveBlob(new Blob([font.bytes], { type: "font/otf" }), `${name}.otf`)} className="inline-flex h-11 items-center gap-1.5 rounded-md bg-ink px-4 text-sm font-medium text-paper disabled:opacity-40">
          <Download aria-hidden className="size-4" /> Download OTF
        </button>
        {["ttf", "woff2", "woff"].map((t) => (
          <button key={t} type="button" disabled={!font || Boolean(busy)} onClick={() => void convert(t)} className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line px-3 font-mono text-[13px] text-ink hover:border-ink-3 disabled:opacity-40">
            <Download aria-hidden className={cn("size-4", busy === t && "animate-bounce")} /> {t.toUpperCase()}
          </button>
        ))}
        <button type="button" disabled={!font} onClick={onCheck} className="inline-flex h-11 items-center rounded-md border border-line px-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-40">
          Check it in the Font checker
        </button>
        <button type="button" onClick={onReset} className="ml-auto inline-flex h-11 items-center gap-1.5 px-2 text-sm text-ink-3 hover:text-ink">
          <RotateCcw aria-hidden className="size-4" /> Start over
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-2 text-xs text-ink-3">OTF works everywhere: Windows, Mac, Office, Canva, Figma. WOFF2 is for websites.</p>
    </div>
  );
}

