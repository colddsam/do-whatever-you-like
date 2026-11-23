"use client";

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Copy, Dices, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import { DRUM_ROWS, GENRES } from "../constants";
import { makeLoop } from "../engine/composer";
import { KITS } from "../engine/drums";
import { transport } from "../engine/transport";
import * as P from "../lib/project";
import { getStudio, useStudio } from "../store";
import type { Clip, Note, Track } from "../types";
import { IconButton, Select, Slider, TextButton, uncapture } from "./controls";

/**
 * The drum step sequencer (FL Studio / GarageBand Beat Sequencer): 12 drums × 16 steps per bar.
 * Click or drag to paint steps; Shift-click (or long-press) for an accent; the row name plays
 * the drum. Notes stay ordinary MIDI notes, so the piano roll and MIDI export see them too.
 */

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

export function StepSequencer({ clip, track }: { clip: Clip; track: Track }) {
  const sig = useStudio((s) => s.project.sig);
  const bars = Math.max(1, Math.round(clip.length / sig));
  const steps = bars * sig * 4;
  const [pageState, setPage] = useState(0);
  const perPage = Math.min(steps, typeof window !== "undefined" && window.innerWidth < 700 ? 16 : 32);
  const pages = Math.ceil(steps / perPage);
  const page = Math.min(pageState, pages - 1);
  const paint = useRef<{ on: boolean } | null>(null);
  const lit = useRef<HTMLDivElement>(null);
  const [genre, setGenre] = useState("pop");
  const { swing } = useStudio(useShallow((s) => ({ swing: s.project.clips[clip.id]?.swing ?? 0 })));

  // The step being played lights its column.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pos = transport.position() - clip.start;
      const el = lit.current;
      if (el) {
        const step = Math.floor(pos * 4);
        const col = step - page * perPage;
        if (pos >= 0 && pos < clip.length && col >= 0 && col < perPage) {
          el.style.display = "block";
          el.style.left = `calc(${(col / perPage) * 100}%)`;
          el.style.width = `${100 / perPage}%`;
        } else el.style.display = "none";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clip.start, clip.length, page, perPage]);

  const notes = clip.notes ?? [];
  const at = (pitch: number, step: number) => notes.find((n) => n.pitch === pitch && near(n.start, step / 4));

  const update = (fn: (n: Note[]) => Note[], live = false) => {
    const st = getStudio();
    const f = (p: typeof st.project) => P.updateClip(p, clip.id, (c) => ({ ...c, notes: fn(c.notes ?? []) }));
    if (live) st.live(f);
    else st.commit(f);
  };

  const setStep = (pitch: number, step: number, on: boolean, accent = false, live = false) => {
    update((ns) => {
      const rest = ns.filter((n) => !(n.pitch === pitch && near(n.start, step / 4)));
      return on ? [...rest, P.newNote({ pitch, start: step / 4, length: 0.25, velocity: accent ? 1 : 0.72 })] : rest;
    }, live);
  };

  const onCellDown = (e: React.PointerEvent, pitch: number, step: number) => {
    uncapture(e, e.currentTarget as Element);
    const cur = at(pitch, step);
    if (e.shiftKey && cur) {
      update((ns) => ns.map((n) => (n.id === cur.id ? { ...n, velocity: n.velocity > 0.9 ? 0.72 : 1 } : n)));
      return;
    }
    getStudio().checkpoint();
    paint.current = { on: !cur };
    setStep(pitch, step, !cur, e.shiftKey, true);
    if (!cur) void transport.noteOn(track.id, pitch, 0.8);
  };
  const onCellEnter = (pitch: number, step: number) => {
    const p = paint.current;
    if (!p) return;
    if (Boolean(at(pitch, step)) !== p.on) setStep(pitch, step, p.on, false, true);
  };
  useEffect(() => {
    const up = () => (paint.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const setBars = (n: number) => {
    getStudio().commit((p) => P.updateClip(p, clip.id, (c) => ({ ...c, length: n * sig, notes: (c.notes ?? []).filter((x) => x.start < n * sig) })));
  };
  const loadGroove = () => {
    const l = makeLoop("drums", genre, 0, "minor", Math.floor(Math.random() * 1e6));
    const reps = Math.max(1, Math.round(bars / l.bars));
    const out: Note[] = [];
    for (let r = 0; r < reps; r++) for (const n of l.notes) if (n.start + r * l.bars * 4 < clip.length) out.push(P.newNote({ ...n, start: n.start + r * l.bars * 4 }));
    update(() => out);
    getStudio().updateTrack(track.id, { instrument: l.instrument });
  };
  const copyFirstBar = () => {
    const first = notes.filter((n) => n.start < sig);
    const out: Note[] = [...first];
    for (let b = 1; b < bars; b++) for (const n of first) out.push(P.newNote({ ...n, start: n.start + b * sig }));
    update(() => out);
  };
  const randomFill = () => {
    // A tasteful random pattern: kick on 1, backbeat on 2 & 4, hats steady, extras sprinkled.
    const out: Note[] = [];
    for (let b = 0; b < bars; b++) {
      for (let s = 0; s < 16; s++) {
        const t = b * 4 + s / 4;
        if (s === 0 || (Math.random() < 0.18 && s % 2 === 0)) out.push(P.newNote({ pitch: 36, start: t, length: 0.25, velocity: s === 0 ? 1 : 0.8 }));
        if (s === 4 || s === 12) out.push(P.newNote({ pitch: 38, start: t, length: 0.25, velocity: 0.9 }));
        if (s % 2 === 0 || Math.random() < 0.25) out.push(P.newNote({ pitch: 42, start: t, length: 0.25, velocity: s % 4 === 0 ? 0.8 : 0.55 }));
        if (Math.random() < 0.06) out.push(P.newNote({ pitch: 39, start: t, length: 0.25, velocity: 0.7 }));
      }
    }
    update(() => out);
  };

  const first = page * perPage;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line-dark bg-ink-raised px-1.5 [scrollbar-width:none]">
        <span className="label-mono shrink-0 pl-1 text-paper-dim">Kit</span>
        <Select label="Drum kit" value={track.instrument || "kit-808"} onChange={(v) => getStudio().updateTrack(track.id, { instrument: v })} options={KITS.map((k) => ({ value: k.id, label: k.label }))} className="h-8 w-[104px] flex-none sm:h-7" />
        <span className="label-mono shrink-0 pl-1 text-paper-dim">Bars</span>
        <Select label="Pattern length" value={String(bars)} onChange={(v) => setBars(Number(v))} options={[1, 2, 4, 8].map((b) => ({ value: String(b), label: String(b) }))} className="h-8 w-[48px] flex-none sm:h-7" />
        <div className="flex w-28 shrink-0 items-center gap-1.5 px-1" title="Swing: delays every second 16th">
          <span className="label-mono text-paper-dim">Swing</span>
          <Slider label="Swing" value={swing} min={0} max={0.5} step={0.01} onStart={() => getStudio().checkpoint()} onChange={(v) => getStudio().live((p) => P.updateClip(p, clip.id, { swing: v }))} />
        </div>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
        <Select label="Groove style" value={genre} onChange={setGenre} options={GENRES.filter((g) => g.id !== "piano").map((g) => ({ value: g.id, label: g.label }))} className="h-8 w-[92px] flex-none sm:h-7" />
        <TextButton onClick={loadGroove} className="h-8 px-2 sm:h-7">
          Load groove
        </TextButton>
        <IconButton label="Random pattern" onClick={randomFill}>
          <Dices aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Copy bar 1 to every bar" disabled={bars < 2} onClick={copyFirstBar}>
          <Copy aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Clear the pattern" onClick={() => update(() => [])}>
          <Eraser aria-hidden className="size-4" />
        </IconButton>
        {pages > 1 && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {Array.from({ length: pages }, (_, i) => (
              <button key={i} type="button" aria-pressed={page === i} onClick={() => setPage(i)} className={cn("h-7 min-w-8 rounded-sm px-2 font-mono text-[12px]", page === i ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}>
                {Math.floor((i * perPage) / 16) + 1}
                {perPage < 32 ? "" : `–${Math.floor(((i + 1) * perPage) / 16)}`}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2" data-lenis-prevent>
        <div className="grid select-none gap-[3px]" style={{ gridTemplateColumns: `86px 1fr` }}>
          {DRUM_ROWS.map((row) => (
            <Row key={row.pitch} label={row.label} onPreview={() => void transport.noteOn(track.id, row.pitch, 0.9)}>
              {Array.from({ length: perPage }, (_, k) => {
                const step = first + k;
                if (step >= steps) return <span key={k} />;
                const n = at(row.pitch, step);
                const beatStart = step % 4 === 0;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-label={`${row.label} step ${step + 1}`}
                    aria-pressed={Boolean(n)}
                    onPointerDown={(e) => onCellDown(e, row.pitch, step)}
                    onPointerEnter={() => onCellEnter(row.pitch, step)}
                    className={cn(
                      "h-7 min-w-0 touch-none rounded-[3px] border transition-colors sm:h-6",
                      n ? (n.velocity > 0.9 ? "border-accent bg-accent" : "border-paper bg-paper") : beatStart ? "border-line-dark bg-paper/[0.08] hover:bg-paper/20" : "border-line-dark bg-ink-raised hover:bg-paper/20",
                    )}
                  />
                );
              })}
            </Row>
          ))}
        </div>
        <div className="relative mt-1 h-1.5" style={{ marginLeft: 89 }}>
          <div ref={lit} aria-hidden className="absolute inset-y-0 hidden rounded-full bg-accent" />
        </div>
        <p className="mt-2 text-[12px] text-paper-dim">Click or drag to paint steps. Shift-click a step for an accent. Tap a drum&apos;s name to hear it.</p>
      </div>
    </div>
  );
}

function Row({ label, onPreview, children }: { label: string; onPreview: () => void; children: React.ReactNode }) {
  return (
    <>
      <button type="button" onPointerDown={onPreview} className="h-7 truncate rounded-[3px] px-1.5 text-left text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper sm:h-6">
        {label}
      </button>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Array.isArray(children) ? children.length : 16}, minmax(0, 1fr))` }}>
        {children}
      </div>
    </>
  );
}
