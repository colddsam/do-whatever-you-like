"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Circle, Download, FolderOpen, Keyboard, Maximize2, Minimize2, Pause, Play, Redo2, Repeat, SkipBack, Square, Timer, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCALE_IDS } from "../constants";
import { formatBars, formatTime, transport } from "../engine/transport";
import { NOTE_NAMES, SCALES } from "../lib/theory";
import { getStudio, useStudio } from "../store";
import type { ScaleId } from "../types";
import { IconButton, Meter, Select } from "./controls";

export function TopBar({ fullscreen, onFullscreen, onExport, onProjects, onHelp, phone }: { fullscreen: boolean; onFullscreen: () => void; onExport: () => void; onProjects: () => void; onHelp: () => void; phone: boolean }) {
  const { name, canUndo, canRedo, saveState, busy } = useStudio(
    useShallow((s) => ({ name: s.project.name, canUndo: s.past.length > 0, canRedo: s.future.length > 0, saveState: s.saveState, busy: Object.keys(s.jobs).length > 0 })),
  );
  const st = getStudio();
  const readL = useCallback(() => transport.masterLevels()[0], []);
  const readR = useCallback(() => transport.masterLevels()[1], []);
  return (
    <div className="shrink-0 border-b border-line-dark bg-ink-raised">
      <div className="flex h-12 items-center gap-0.5 px-2 sm:h-11 sm:gap-1">
        <IconButton label="Projects: new, open, import, share" onClick={onProjects}>
          <FolderOpen aria-hidden className="size-4" />
        </IconButton>
        <span aria-hidden className="mx-1 hidden size-2 shrink-0 rounded-full bg-accent sm:block" />
        <input
          aria-label="Project name"
          value={name}
          onFocus={() => st.checkpoint()}
          onChange={(e) => st.live((p) => ({ ...p, name: e.target.value.slice(0, 80) }))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-9 min-w-[70px] max-w-[200px] flex-1 rounded-sm border border-transparent bg-transparent px-1 text-[13px] font-medium text-paper outline-none hover:border-line-dark focus-visible:border-accent sm:h-8 sm:text-[14px]"
        />
        <span className={cn("label-mono hidden shrink-0 xl:inline", saveState === "error" ? "text-danger" : "text-paper-dim")} aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved here"}
        </span>
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo || busy} onClick={() => st.undo()}>
          <Undo2 aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo || busy} onClick={() => st.redo()}>
          <Redo2 aria-hidden className="size-4" />
        </IconButton>
        {!phone && <Transport />}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          {!phone && <SongSettings />}
          <div className="hidden h-6 flex-col justify-center gap-[3px] lg:flex" title="Master level">
            <Meter read={readL} className="w-16" />
            <Meter read={readR} className="w-16" />
          </div>
          <IconButton label="Keyboard shortcuts (?)" onClick={onHelp} className="max-md:hidden">
            <Keyboard aria-hidden className="size-4" />
          </IconButton>
          <IconButton label={fullscreen ? "Exit full screen (F)" : "Full screen (F)"} onClick={onFullscreen}>
            {fullscreen ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
          </IconButton>
          <button type="button" onClick={onExport} className="ml-0.5 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-paper px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-paper/85 sm:h-8 sm:px-3">
            <Download aria-hidden className="size-4" />
            <span>Export</span>
          </button>
        </div>
      </div>
      {phone && (
        <div className="flex h-11 items-center gap-0.5 overflow-x-auto border-t border-line-dark px-2 [scrollbar-width:none]">
          <Transport />
          <SongSettings />
        </div>
      )}
    </div>
  );
}

function Transport() {
  const { playing, recording, loop, metronome } = useStudio(useShallow((s) => ({ playing: s.playing, recording: s.recording, loop: s.project.loop.on, metronome: s.metronome })));
  const st = getStudio();
  return (
    <div className="ml-1 flex shrink-0 items-center gap-0.5 sm:ml-2">
      <IconButton label="To the start (Home)" onClick={() => void transport.seek(st.project.loop.on ? st.project.loop.start : 0)}>
        <SkipBack aria-hidden className="size-4" />
      </IconButton>
      <button
        type="button"
        aria-label={playing ? "Pause (Space)" : "Play (Space)"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={() => void transport.toggle()}
        className={cn("inline-flex size-9 items-center justify-center rounded-full transition-colors sm:size-8", playing ? "bg-paper text-ink" : "bg-paper/10 text-paper hover:bg-paper/20")}
      >
        {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4 translate-x-[1px]" />}
      </button>
      <IconButton label="Stop (press twice to return to the start)" onClick={() => void transport.stop()}>
        <Square aria-hidden className="size-3.5" />
      </IconButton>
      <IconButton
        label={recording ? "Stop recording (R)" : "Record (R)"}
        onClick={() => void transport.record().catch((e) => st.notify(e instanceof Error ? e.message : "Recording failed.", "danger"))}
        className={cn(recording && "bg-danger/25")}
      >
        <Circle aria-hidden className={cn("size-3.5", recording ? "animate-pulse fill-danger text-danger" : "fill-accent text-accent")} />
      </IconButton>
      <IconButton
        label="Loop (L)"
        active={loop}
        onClick={() =>
          st.commit((p) => {
            const end = p.loop.end > p.loop.start ? p.loop.end : p.loop.start + p.sig * 4;
            return { ...p, loop: { ...p.loop, end, on: !p.loop.on } };
          })
        }
      >
        <Repeat aria-hidden className="size-4" />
      </IconButton>
      <IconButton label="Metronome (M)" active={metronome} onClick={() => st.set({ metronome: !metronome })}>
        <Timer aria-hidden className="size-4" />
      </IconButton>
      <Clock />
    </div>
  );
}

function Clock() {
  const ref = useRef<HTMLSpanElement>(null);
  const ref2 = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const p = getStudio().project;
      const pos = transport.position();
      const bars = formatBars(p, pos);
      if (bars !== last) {
        last = bars;
        if (ref.current) ref.current.textContent = bars;
        if (ref2.current) ref2.current.textContent = formatTime(p, pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="ml-1 flex h-8 shrink-0 flex-col justify-center rounded-sm border border-line-dark bg-ink px-2 font-mono leading-none tabular-nums" title="Bar.beat.sixteenth · minutes:seconds">
      <span ref={ref} className="text-[13px] text-paper">
        1.1.1
      </span>
      <span ref={ref2} className="text-[12px] text-paper-dim">
        0:00.0
      </span>
    </div>
  );
}

function SongSettings() {
  const { bpm, sig, keyRoot, scale } = useStudio(useShallow((s) => ({ bpm: s.project.bpm, sig: s.project.sig, keyRoot: s.project.keyRoot, scale: s.project.scale })));
  const st = getStudio();
  const [draft, setDraft] = useState<string | null>(null);
  const commitBpm = (v: string) => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 30 && n <= 300 && n !== bpm) st.commit((p) => ({ ...p, bpm: n }));
    setDraft(null);
  };
  // Tap tempo: the average of the last few taps.
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now].slice(-6);
    if (taps.current.length >= 3) {
      const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const n = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
      if (n >= 30 && n <= 300) st.live((p) => ({ ...p, bpm: n }));
    }
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <label className="flex h-8 items-center gap-1 rounded-sm border border-line-dark bg-ink pl-2 sm:h-7" title="Tempo (beats per minute)">
        <input
          aria-label="Tempo in BPM"
          inputMode="numeric"
          value={draft ?? String(bpm)}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
          onBlur={(e) => commitBpm(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              st.commit((p) => ({ ...p, bpm: Math.max(30, Math.min(300, p.bpm + (e.key === "ArrowUp" ? 1 : -1))) }));
            }
          }}
          className="w-9 bg-transparent font-mono text-[13px] text-paper outline-none"
        />
        <span className="font-mono text-[12px] text-paper-dim">bpm</span>
        <button type="button" onClick={tap} className="h-full rounded-r-sm border-l border-line-dark px-1.5 font-mono text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper" title="Tap tempo: tap in time">
          tap
        </button>
      </label>
      <Select label="Time signature" value={String(sig)} onChange={(v) => st.commit((p) => ({ ...p, sig: Number(v) }))} options={[3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n}/4` }))} className="h-8 w-[52px] flex-none sm:h-7" />
      <Select label="Key" value={String(keyRoot)} onChange={(v) => st.commit((p) => ({ ...p, keyRoot: Number(v) }))} options={NOTE_NAMES.map((n, i) => ({ value: String(i), label: n }))} className="h-8 w-[50px] flex-none sm:h-7" />
      <Select<ScaleId> label="Scale" value={scale} onChange={(v) => st.commit((p) => ({ ...p, scale: v }))} options={SCALE_IDS.map((s) => ({ value: s, label: SCALES[s].label }))} className="h-8 w-[96px] flex-none sm:h-7" />
    </div>
  );
}
