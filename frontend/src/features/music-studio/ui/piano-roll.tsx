"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ArrowDown, ArrowUp, Eraser, Minus, MousePointer2, Pencil, Plus, Shuffle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SNAPS } from "../constants";
import { transport } from "../engine/transport";
import * as P from "../lib/project";
import { inScale, noteName } from "../lib/theory";
import { getStudio, useStudio } from "../store";
import type { Clip, Note, Track } from "../types";
import { capture, IconButton, Select, Slider, TextButton } from "./controls";

const LO = 21;
const HI = 108;
const KEYS_W = 46;
const VEL_H = 54;

type Drag =
  | { kind: "move"; ids: string[]; x0: number; y0: number; origin: Map<string, Note>; moved: boolean }
  | { kind: "resize"; ids: string[]; x0: number; origin: Map<string, Note>; moved: boolean }
  | { kind: "draw"; id: string; start: number }
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "velocity" }
  | { kind: "erase" };

export function PianoRoll({ clip, track }: { clip: Clip; track: Track }) {
  const [rowH, setRowH] = useState(14);
  const [pxBeat, setPxBeat] = useState(64);
  const [tool, setTool] = useState<"draw" | "select" | "erase">("draw");
  const [sel, setSel] = useState<string[]>([]);
  const [lastLen, setLastLen] = useState(0.5);
  const [grid, setGrid] = useState(0.25);
  const { keyRoot, scale, sig } = useStudio(useShallow((s) => ({ keyRoot: s.project.keyRoot, scale: s.project.scale, sig: s.project.sig })));
  const scroller = useRef<HTMLDivElement>(null);
  const grid$ = useRef<HTMLCanvasElement>(null);
  const vel$ = useRef<HTMLCanvasElement>(null);
  const head$ = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const notes = clip.notes ?? [];
  const beats = Math.max(clip.length, sig) + sig * 2;
  const W = Math.ceil(beats * pxBeat);
  const H = (HI - LO + 1) * rowH;

  // Start scrolled to the notes (or middle C).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mid = notes.length ? notes.reduce((a, n) => a + n.pitch, 0) / notes.length : 60;
    el.scrollTop = (HI - mid) * rowH - el.clientHeight / 2;
    // Only when a different clip opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  const yOf = (pitch: number) => (HI - pitch) * rowH;
  const pitchAt = (y: number) => Math.max(LO, Math.min(HI, HI - Math.floor(y / rowH)));
  const snapB = (b: number) => (grid > 0 ? Math.round(b / grid) * grid : b);
  const floorB = (b: number) => (grid > 0 ? Math.floor(b / grid) * grid : b);

  // Draw the grid and notes.
  useEffect(() => {
    const cv = grid$.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.min(16384, W * dpr);
    cv.height = Math.min(16384, H * dpr);
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#15140f";
    g.fillRect(0, 0, W, H);
    for (let p = LO; p <= HI; p++) {
      const y = yOf(p);
      const black = [1, 3, 6, 8, 10].includes(p % 12);
      g.fillStyle = black ? "#1a1914" : "#1f1e19";
      if (scale !== "chromatic" && !inScale(p, keyRoot, scale)) g.fillStyle = "#17160f";
      g.fillRect(0, y, W, rowH);
      if (p % 12 === 0) {
        g.fillStyle = "#33312a";
        g.fillRect(0, y + rowH - 1, W, 1);
      }
    }
    for (let b = 0; b <= beats; b += grid > 0 ? grid : 0.25) {
      const x = Math.round(b * pxBeat) + 0.5;
      g.fillStyle = b % sig === 0 ? "#4a473d" : b % 1 === 0 ? "#33312a" : "#24231d";
      g.fillRect(x, 0, 1, H);
    }
    // Past the clip's end.
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(clip.length * pxBeat, 0, W, H);
    for (const n of notes) {
      const x = n.start * pxBeat;
      const w = Math.max(3, n.length * pxBeat - 1);
      const y = yOf(n.pitch) + 1;
      const on = sel.includes(n.id);
      g.globalAlpha = 0.55 + n.velocity * 0.45;
      g.fillStyle = on ? "#f3f0e8" : track.color;
      g.fillRect(x, y, w, rowH - 2);
      g.globalAlpha = 1;
      g.strokeStyle = on ? "#eb4a10" : "rgba(0,0,0,0.5)";
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, rowH - 3);
      if (rowH >= 13 && w > 26) {
        g.fillStyle = on ? "#15140f" : "rgba(243,240,232,0.85)";
        g.font = "10px ui-monospace, monospace";
        g.fillText(noteName(n.pitch), x + 3, y + rowH - 5);
      }
    }
    // Velocity lane
    const vc = vel$.current;
    if (vc) {
      vc.width = Math.min(16384, W * dpr);
      vc.height = VEL_H * dpr;
      const v = vc.getContext("2d")!;
      v.setTransform(dpr, 0, 0, dpr, 0, 0);
      v.fillStyle = "#1f1e19";
      v.fillRect(0, 0, W, VEL_H);
      for (const n of notes) {
        const h = n.velocity * (VEL_H - 6);
        v.fillStyle = sel.includes(n.id) ? "#eb4a10" : track.color;
        v.fillRect(n.start * pxBeat, VEL_H - h, 3, h);
        v.fillRect(n.start * pxBeat, VEL_H - h, 8, 2);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, sel, W, H, rowH, pxBeat, keyRoot, scale, grid, clip.length, track.color, beats, sig]);

  // Playhead inside the clip.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pos = transport.position() - clip.start;
      if (head$.current) {
        head$.current.style.display = pos >= 0 && pos <= clip.length ? "block" : "none";
        head$.current.style.transform = `translateX(${pos * pxBeat}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clip.start, clip.length, pxBeat]);

  const commitNotes = useCallback(
    (fn: (n: Note[]) => Note[], live = false) => {
      const st = getStudio();
      const apply = (p: typeof st.project) =>
        P.updateClip(p, clip.id, (c) => {
          const next = fn(c.notes ?? []);
          // Grow the clip to whole bars when notes run past its end.
          const end = next.reduce((a, n) => Math.max(a, n.start + n.length), 0);
          const length = end > c.length ? Math.ceil(end / p.sig) * p.sig : c.length;
          return { ...c, notes: next, length };
        });
      if (live) st.live(apply);
      else st.commit(apply);
    },
    [clip.id],
  );

  const audition = (pitch: number) => {
    void transport.noteOn(track.id, pitch, 0.75);
    setTimeout(() => transport.noteOff(track.id, pitch), 180);
  };

  const hit = (bx: number, by: number) => {
    const pitch = pitchAt(by);
    const beat = bx / pxBeat;
    const n = [...notes].reverse().find((x) => x.pitch === pitch && beat >= x.start && beat <= x.start + x.length);
    if (!n) return null;
    const edge = (n.start + n.length) * pxBeat - bx < Math.max(5, Math.min(10, (n.length * pxBeat) / 3));
    return { note: n, edge };
  };

  const local = (e: React.PointerEvent) => {
    const r = grid$.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    capture(e);
    const { x, y } = local(e);
    const h = hit(x, y);
    const st = getStudio();
    if (tool === "erase" || e.button === 2 || (e.altKey && h)) {
      if (h) commitNotes((ns) => ns.filter((n) => n.id !== h.note.id));
      drag.current = { kind: "erase" };
      return;
    }
    if (h) {
      let ids = sel;
      if (e.shiftKey) ids = sel.includes(h.note.id) ? sel.filter((i) => i !== h.note.id) : [...sel, h.note.id];
      else if (!sel.includes(h.note.id)) ids = [h.note.id];
      setSel(ids);
      const origin = new Map(notes.filter((n) => ids.includes(n.id)).map((n) => [n.id, n]));
      st.checkpoint();
      drag.current = h.edge ? { kind: "resize", ids, x0: x, origin, moved: false } : { kind: "move", ids, x0: x, y0: y, origin, moved: false };
      if (!h.edge) audition(h.note.pitch);
      return;
    }
    if (tool === "select" || e.shiftKey) {
      drag.current = { kind: "box", x0: x, y0: y, x1: x, y1: y };
      setBox({ x0: x, y0: y, x1: x, y1: y });
      if (!e.shiftKey) setSel([]);
      return;
    }
    // Draw a new note.
    const pitch = pitchAt(y);
    const start = floorB(x / pxBeat);
    const n = P.newNote({ pitch, start, length: lastLen, velocity: 0.8 });
    commitNotes((ns) => [...ns, n]);
    setSel([n.id]);
    drag.current = { kind: "draw", id: n.id, start };
    audition(pitch);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = local(e);
    if (d.kind === "erase") {
      const h = hit(x, y);
      if (h) commitNotes((ns) => ns.filter((n) => n.id !== h.note.id), true);
    } else if (d.kind === "draw") {
      const len = Math.max(grid || 0.0625, snapB(x / pxBeat) - d.start);
      commitNotes((ns) => ns.map((n) => (n.id === d.id ? { ...n, length: len } : n)), true);
      setLastLen(len);
    } else if (d.kind === "box") {
      d.x1 = x;
      d.y1 = y;
      setBox({ ...d });
    } else if (d.kind === "move") {
      const db = snapB((x - d.x0) / pxBeat);
      const dp = Math.round((d.y0 - y) / rowH);
      if (!d.moved && db === 0 && dp === 0) return;
      d.moved = true;
      const first = d.origin.values().next().value as Note | undefined;
      commitNotes(
        (ns) =>
          ns.map((n) => {
            const o = d.origin.get(n.id);
            return o ? { ...n, start: Math.max(0, o.start + db), pitch: Math.max(LO, Math.min(HI, o.pitch + dp)) } : n;
          }),
        true,
      );
      if (first && dp !== 0 && Math.abs(dp) <= 24 && d.ids.length === 1) {
        const target = first.pitch + dp;
        if ((d as { lastPitch?: number }).lastPitch !== target) {
          (d as { lastPitch?: number }).lastPitch = target;
          audition(target);
        }
      }
    } else if (d.kind === "resize") {
      const db = (x - d.x0) / pxBeat;
      d.moved = true;
      commitNotes(
        (ns) =>
          ns.map((n) => {
            const o = d.origin.get(n.id);
            return o ? { ...n, length: Math.max(grid || 0.0625, snapB(o.length + db)) } : n;
          }),
        true,
      );
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "box") {
      const [x0, x1] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)];
      const [y0, y1] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
      const ids = notes.filter((n) => n.start * pxBeat < x1 && (n.start + n.length) * pxBeat > x0 && yOf(n.pitch) + rowH > y0 && yOf(n.pitch) < y1).map((n) => n.id);
      setSel((s) => [...new Set([...s, ...ids])]);
      setBox(null);
    }
    if (d?.kind === "resize") {
      const one = notes.find((n) => n.id === d.ids[0]);
      if (one) setLastLen(one.length);
    }
  };

  const onVelDown = (e: React.PointerEvent) => {
    capture(e);
    getStudio().checkpoint();
    drag.current = { kind: "velocity" };
    setVel(e);
  };
  const setVel = (e: React.PointerEvent) => {
    if (drag.current?.kind !== "velocity") return;
    const r = vel$.current!.getBoundingClientRect();
    const beat = (e.clientX - r.left) / pxBeat;
    const v = Math.max(0.05, Math.min(1, 1 - (e.clientY - r.top) / VEL_H));
    // Selected notes move together; otherwise the note under the pointer.
    const target = sel.length ? sel : notes.filter((n) => Math.abs(n.start - beat) < 6 / pxBeat).map((n) => n.id);
    commitNotes((ns) => ns.map((n) => (target.includes(n.id) && (sel.length || Math.abs(n.start - beat) < 6 / pxBeat) ? { ...n, velocity: v } : n)), true);
  };

  const selected = () => (sel.length ? sel : notes.map((n) => n.id));
  const transpose = (d: number) => commitNotes((ns) => ns.map((n) => (selected().includes(n.id) ? { ...n, pitch: Math.max(LO, Math.min(HI, n.pitch + d)) } : n)));
  const quantizeSel = () => {
    const ids = selected();
    commitNotes((ns) => [...ns.filter((n) => !ids.includes(n.id)), ...P.quantize(ns.filter((n) => ids.includes(n.id)), grid || 0.25, 1)]);
    getStudio().notify(`Quantised to ${SNAPS.find((s) => s.beats === grid)?.label ?? "the grid"}.`, "success");
  };
  const humanize = () => {
    const ids = selected();
    commitNotes((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, start: Math.max(0, n.start + (Math.random() - 0.5) * 0.04), velocity: Math.max(0.1, Math.min(1, n.velocity + (Math.random() - 0.5) * 0.18)) } : n)));
  };
  const legato = () => {
    const ids = selected();
    commitNotes((ns) => {
      const sorted = ns.filter((n) => ids.includes(n.id)).sort((a, b) => a.start - b.start);
      const next = new Map<string, number>();
      sorted.forEach((n) => {
        const after = sorted.find((m) => m.start > n.start + 1e-6);
        if (after) next.set(n.id, after.start - n.start);
      });
      return ns.map((n) => (next.has(n.id) ? { ...n, length: next.get(n.id)! } : n));
    });
  };
  const velAll = (v: number) => commitNotes((ns) => ns.map((n) => (selected().includes(n.id) ? { ...n, velocity: v } : n)), true);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, select, textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!sel.length) return;
      e.preventDefault();
      e.stopPropagation();
      commitNotes((ns) => ns.filter((n) => !sel.includes(n.id)));
      setSel([]);
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      e.stopPropagation();
      setSel(notes.map((n) => n.id));
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && sel.length) {
      e.preventDefault();
      e.stopPropagation();
      transpose((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1));
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && sel.length) {
      e.preventDefault();
      e.stopPropagation();
      const d = (e.key === "ArrowRight" ? 1 : -1) * (grid || 0.25);
      commitNotes((ns) => ns.map((n) => (sel.includes(n.id) ? { ...n, start: Math.max(0, n.start + d) } : n)));
    } else if (mod && e.key.toLowerCase() === "d" && sel.length) {
      e.preventDefault();
      e.stopPropagation();
      const chosen = notes.filter((n) => sel.includes(n.id));
      const span = Math.max(...chosen.map((n) => n.start + n.length)) - Math.min(...chosen.map((n) => n.start));
      const copies = chosen.map((n) => P.newNote({ pitch: n.pitch, start: n.start + span, length: n.length, velocity: n.velocity }));
      commitNotes((ns) => [...ns, ...copies]);
      setSel(copies.map((n) => n.id));
    }
  };

  const avgVel = sel.length ? notes.filter((n) => sel.includes(n.id)).reduce((a, n) => a + n.velocity, 0) / Math.max(1, sel.length) : 0.8;

  return (
    <div className="flex h-full min-h-0 flex-col outline-none" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line-dark bg-ink-raised px-1.5 [scrollbar-width:none]">
        <IconButton label="Draw notes" active={tool === "draw"} onClick={() => setTool("draw")}>
          <Pencil aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Select notes (or hold Shift)" active={tool === "select"} onClick={() => setTool("select")}>
          <MousePointer2 aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Erase notes (or Alt-click)" active={tool === "erase"} onClick={() => setTool("erase")}>
          <Eraser aria-hidden className="size-4" />
        </IconButton>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
        <Select label="Note grid" value={String(grid)} onChange={(v) => setGrid(Number(v))} options={SNAPS.filter((s) => s.beats >= 0).map((s) => ({ value: String(s.beats), label: s.label }))} className="h-8 w-[60px] flex-none sm:h-7" />
        <TextButton onClick={quantizeSel} className="h-8 px-2 sm:h-7" title="Snap note starts to the grid">
          Quantise
        </TextButton>
        <IconButton label="Up a semitone (↑)" onClick={() => transpose(1)}>
          <ArrowUp aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Down a semitone (↓)" onClick={() => transpose(-1)}>
          <ArrowDown aria-hidden className="size-4" />
        </IconButton>
        <TextButton onClick={() => transpose(12)} className="h-8 px-2 sm:h-7" title="Up an octave (Shift ↑)">
          +12
        </TextButton>
        <TextButton onClick={() => transpose(-12)} className="h-8 px-2 sm:h-7" title="Down an octave (Shift ↓)">
          −12
        </TextButton>
        <IconButton label="Humanise timing and velocity" onClick={humanize}>
          <Shuffle aria-hidden className="size-4" />
        </IconButton>
        <TextButton onClick={legato} className="h-8 px-2 sm:h-7" title="Stretch each note to the next">
          Legato
        </TextButton>
        <div className="flex w-28 shrink-0 items-center gap-1.5 px-1" title="Velocity of the selected notes">
          <span className="label-mono text-paper-dim">Vel</span>
          <Slider label="Velocity" value={avgVel} min={0.05} max={1} step={0.01} onStart={() => getStudio().checkpoint()} onChange={velAll} />
        </div>
        <IconButton label="Delete selected notes (Del)" disabled={!sel.length} onClick={() => (commitNotes((ns) => ns.filter((n) => !sel.includes(n.id))), setSel([]))}>
          <Trash2 aria-hidden className="size-4" />
        </IconButton>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="Shorter rows" onClick={() => setRowH((h) => Math.max(8, h - 2))}>
            <Minus aria-hidden className="size-4" />
          </IconButton>
          <IconButton label="Taller rows" onClick={() => setRowH((h) => Math.min(26, h + 2))}>
            <Plus aria-hidden className="size-4" />
          </IconButton>
          <Select label="Horizontal zoom" value={String(pxBeat)} onChange={(v) => setPxBeat(Number(v))} options={[24, 40, 64, 96, 140, 200].map((z) => ({ value: String(z), label: `${Math.round((z / 64) * 100)}%` }))} className="h-8 w-[66px] flex-none sm:h-7" />
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-contain" data-lenis-prevent>
        <div className="relative flex" style={{ width: KEYS_W + W, height: H }}>
          <div className="sticky left-0 z-10 shrink-0 border-r border-line-dark bg-ink" style={{ width: KEYS_W }}>
            {Array.from({ length: HI - LO + 1 }, (_, i) => {
              const p = HI - i;
              const black = [1, 3, 6, 8, 10].includes(p % 12);
              return (
                <button
                  key={p}
                  type="button"
                  tabIndex={-1}
                  aria-label={noteName(p)}
                  onPointerDown={() => void transport.noteOn(track.id, p, 0.8)}
                  onPointerUp={() => transport.noteOff(track.id, p)}
                  onPointerLeave={() => transport.noteOff(track.id, p)}
                  className={cn("block w-full border-b border-black/30 pr-1 text-right font-mono text-[12px] leading-none", black ? "bg-[#0e0d0a] text-paper-dim" : "bg-paper/90 text-ink")}
                  style={{ height: rowH }}
                >
                  {p % 12 === 0 && rowH >= 12 ? noteName(p) : ""}
                </button>
              );
            })}
          </div>
          <div className="relative" style={{ width: W, height: H }}>
            <canvas
              ref={grid$}
              className={cn("absolute inset-0 touch-none", tool === "erase" ? "cursor-cell" : tool === "select" ? "cursor-default" : "cursor-crosshair")}
              style={{ width: W, height: H }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onContextMenu={(e) => e.preventDefault()}
            />
            {box && <div className="pointer-events-none absolute border border-accent bg-accent/10" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
            <div ref={head$} aria-hidden className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent" />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 overflow-hidden border-t border-line-dark" style={{ height: VEL_H }}>
        <div className="flex shrink-0 items-center justify-center border-r border-line-dark bg-ink-raised" style={{ width: KEYS_W }}>
          <span className="label-mono text-paper-dim">Vel</span>
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <VelocityLane canvasRef={vel$} width={W} scroller={scroller} onDown={onVelDown} onMove={setVel} onUp={() => (drag.current = null)} />
        </div>
      </div>
    </div>
  );
}

/** The velocity lane scrolls sideways with the note grid. */
function VelocityLane({ canvasRef, width, scroller, onDown, onMove, onUp }: { canvasRef: React.RefObject<HTMLCanvasElement | null>; width: number; scroller: React.RefObject<HTMLDivElement | null>; onDown: (e: React.PointerEvent) => void; onMove: (e: React.PointerEvent) => void; onUp: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => {
      if (wrap.current) wrap.current.style.transform = `translateX(${-el.scrollLeft}px)`;
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [scroller]);
  return (
    <div ref={wrap} className="absolute inset-y-0 left-0" style={{ width }}>
      <canvas ref={canvasRef} className="h-full touch-none cursor-ns-resize" style={{ width, height: VEL_H }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
}
