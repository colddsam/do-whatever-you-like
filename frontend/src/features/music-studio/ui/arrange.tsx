"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AudioLines, Copy, Drum, Maximize, Mic, Minus, MoreHorizontal, Piano, Plus, Scissors, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { importFiles, bounceTrack } from "../actions";
import { SNAPS } from "../constants";
import { overviewPeaks } from "../engine/assets";
import { transport } from "../engine/transport";
import * as P from "../lib/project";
import { getStudio, useStudio } from "../store";
import type { Clip, Track, TrackKind } from "../types";
import { capture, IconButton, Meter, Select } from "./controls";

const RULER = 34;

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 640);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

export function Arrange({ compact = false }: { compact?: boolean }) {
  const narrow = useNarrow();
  const HEAD = narrow ? 104 : 176;
  const TRACK_H = compact || narrow ? 56 : 68;
  const scroller = useRef<HTMLDivElement>(null);
  const playheadEl = useRef<HTMLDivElement>(null);
  const { tracks, zoom, sig, length, loop, markers, snap } = useStudio(
    useShallow((s) => ({ tracks: s.project.tracks, zoom: s.zoom, sig: s.project.sig, length: P.projectLength(s.project), loop: s.project.loop, markers: s.project.markers, snap: s.snap })),
  );
  const [viewW, setViewW] = useState(800);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const beats = Math.max(length + sig * 8, (viewW - HEAD) / zoom + sig);
  const contentW = Math.ceil(beats * zoom);

  // Playhead: moved directly every frame, no React work while playing.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = getStudio();
      const pos = transport.position();
      const x = pos * s.zoom;
      if (playheadEl.current) playheadEl.current.style.transform = `translateX(${x}px)`;
      const el = scroller.current;
      if (el && s.playing && s.follow) {
        const left = el.scrollLeft;
        const w = el.clientWidth - HEAD;
        if (x < left || x > left + w - 40) el.scrollLeft = Math.max(0, x - 40);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [HEAD]);

  // Ctrl/⌘ + wheel zooms around the pointer; pinch on trackpads does the same.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = getStudio();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - HEAD + el.scrollLeft;
      const beat = px / s.zoom;
      const z = Math.max(4, Math.min(400, s.zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
      s.set({ zoom: z });
      requestAnimationFrame(() => (el.scrollLeft = beat * z - (e.clientX - rect.left - HEAD)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [HEAD]);

  const beatAtClient = useCallback(
    (clientX: number) => {
      const el = scroller.current!;
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left - HEAD + el.scrollLeft) / getStudio().zoom);
    },
    [HEAD],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <ArrangeToolbar />
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-contain" data-lenis-prevent data-arrange-scroller>
        <div className="relative" style={{ width: HEAD + contentW, minHeight: RULER + tracks.length * TRACK_H + 80 }}>
          {/* Ruler */}
          <div className="sticky top-0 z-30 flex" style={{ height: RULER }}>
            <div className="sticky left-0 z-10 flex shrink-0 items-end border-b border-r border-line-dark bg-ink-raised px-2 pb-1" style={{ width: HEAD }}>
              <span className="label-mono text-paper-dim">{tracks.length} tracks</span>
            </div>
            <Ruler width={contentW} beats={beats} zoom={zoom} sig={sig} loop={loop} markers={markers} snap={snap} beatAtClient={beatAtClient} />
          </div>
          {tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i} head={HEAD} height={TRACK_H} width={contentW} narrow={narrow} beatAtClient={beatAtClient} />
          ))}
          <AddTrackRow head={HEAD} />
          {/* Loop shading over the lanes */}
          {loop.on && (
            <div aria-hidden className="pointer-events-none absolute bottom-0 z-[5] border-x border-accent/40 bg-accent/[0.05]" style={{ left: HEAD + loop.start * zoom, width: (loop.end - loop.start) * zoom, top: RULER }} />
          )}
          <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-40" style={{ left: HEAD }}>
            <div ref={playheadEl} className="absolute bottom-0 top-0 w-px bg-accent will-change-transform">
              <span className="absolute -left-[5px] top-[22px] size-[11px] rotate-45 bg-accent" />
            </div>
          </div>
          {!tracks.length && (
            <p className="absolute left-0 right-0 text-center text-[13px] text-paper-dim" style={{ top: RULER + 32 }}>
              Add a track, drop audio or MIDI here, or make a song in <span className="text-paper">Create</span>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ArrangeToolbar() {
  const { snap, zoom, follow, hasSel } = useStudio(useShallow((s) => ({ snap: s.snap, zoom: s.zoom, follow: s.follow, hasSel: s.selectedClips.length > 0 })));
  const st = getStudio();
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line-dark bg-ink-raised px-1.5 [scrollbar-width:none]">
      <AddTrackMenu />
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
      <IconButton label="Split at the playhead (S)" onClick={() => st.splitAtPlayhead()}>
        <Scissors aria-hidden className="size-4" />
      </IconButton>
      <IconButton label="Duplicate (Ctrl+D)" disabled={!hasSel} onClick={() => st.duplicateSelection()}>
        <Copy aria-hidden className="size-4" />
      </IconButton>
      <IconButton label="Delete (Del)" disabled={!hasSel} onClick={() => st.deleteSelection()}>
        <Trash2 aria-hidden className="size-4" />
      </IconButton>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
      <span className="label-mono hidden shrink-0 text-paper-dim sm:inline">Snap</span>
      <Select
        label="Snap to grid"
        value={snap < 0 ? "bar" : String(snap)}
        onChange={(v) => st.set({ snap: v === "bar" ? -1 : Number(v) })}
        options={SNAPS.map((s) => ({ value: s.value, label: s.label }))}
        className="h-8 w-[64px] flex-none sm:h-7"
      />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton label="Follow the playhead" active={follow} onClick={() => st.set({ follow: !follow })}>
          <AudioLines aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Zoom out (−)" onClick={() => st.set({ zoom: Math.max(4, zoom / 1.4) })}>
          <Minus aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Zoom in (+)" onClick={() => st.set({ zoom: Math.min(400, zoom * 1.4) })}>
          <Plus aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label="Fit the song"
          onClick={() => {
            const el = document.querySelector<HTMLElement>("[data-arrange-scroller]");
            const w = (el?.clientWidth ?? 900) - 200;
            st.set({ zoom: Math.max(4, Math.min(400, w / (P.projectLength(st.project) + 4))) });
          }}
        >
          <Maximize aria-hidden className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

function AddTrackMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const add = (kind: TrackKind, opts?: Partial<Track>) => {
    getStudio().addTrack(kind, opts);
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-paper px-2.5 text-[12px] font-medium text-ink hover:bg-paper/85 sm:h-7"
      >
        <Plus aria-hidden className="size-3.5" />
        Track
      </button>
      {open && (
        <div role="menu" className="fixed z-[90] mt-1 w-56 rounded-md border border-line-dark bg-ink-raised p-1 shadow-float">
          {[
            { kind: "audio" as const, label: "Audio track", hint: "Record a voice or instrument, import audio", icon: Mic },
            { kind: "instrument" as const, label: "Instrument track", hint: "Piano, synths, bass, strings…", icon: Piano },
            { kind: "drums" as const, label: "Drum track", hint: "Step sequencer with 7 kits", icon: Drum },
          ].map((o) => (
            <button key={o.kind} type="button" role="menuitem" onClick={() => add(o.kind)} className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-paper/10">
              <o.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-paper-dim" />
              <span>
                <span className="block text-[13px] text-paper">{o.label}</span>
                <span className="block text-[12px] text-paper-dim">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Ruler({ width, beats, zoom, sig, loop, markers, snap, beatAtClient }: { width: number; beats: number; zoom: number; sig: number; loop: { on: boolean; start: number; end: number }; markers: { id: string; beat: number; name: string }[]; snap: number; beatAtClient: (x: number) => number }) {
  const barPx = zoom * sig;
  const every = barPx < 18 ? 8 : barPx < 36 ? 4 : barPx < 70 ? 2 : 1;
  const bars = Math.ceil(beats / sig);
  const drag = useRef<{ kind: "scrub" | "loop"; from: number } | null>(null);
  const grid = snap === 0 ? 0.25 : snap;

  const onDown = (e: React.PointerEvent) => {
    capture(e, e.currentTarget as Element);
    const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
    const beat = P.snapBeat(beatAtClient(e.clientX), grid, sig);
    if (y < 14) {
      drag.current = { kind: "loop", from: beat };
      getStudio().live((p) => ({ ...p, loop: { on: true, start: beat, end: beat + sig } }));
    } else {
      drag.current = { kind: "scrub", from: beat };
      void transport.seek(beatAtClient(e.clientX));
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const beat = P.snapBeat(beatAtClient(e.clientX), grid, sig);
    if (d.kind === "loop") {
      const a = Math.min(d.from, beat);
      const b = Math.max(d.from, beat);
      getStudio().live((p) => ({ ...p, loop: { on: true, start: a, end: Math.max(a + grid, b) } }));
    } else getStudio().set({ playhead: beatAtClient(e.clientX) });
  };
  const onUp = () => {
    if (drag.current?.kind === "scrub" && !getStudio().playing) void transport.seek(getStudio().playhead);
    if (drag.current?.kind === "loop") getStudio().checkpoint();
    drag.current = null;
  };
  return (
    <div className="relative shrink-0 cursor-pointer touch-none select-none border-b border-line-dark bg-ink-raised" style={{ width }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} title="Click to move the playhead · drag along the top strip to set a loop">
      <div className="absolute inset-x-0 top-0 h-[14px] border-b border-line-dark/60" />
      {loop.end > loop.start && (
        <div className={cn("absolute top-0 h-[14px] rounded-[2px]", loop.on ? "bg-accent/70" : "bg-paper-dim/30")} style={{ left: loop.start * zoom, width: (loop.end - loop.start) * zoom }} />
      )}
      {markers.map((m) => (
        <span key={m.id} className="absolute top-0 flex h-[14px] items-center whitespace-nowrap border-l border-paper/60 pl-1 font-mono text-[12px] leading-none text-paper" style={{ left: m.beat * zoom }}>
          {m.name}
        </span>
      ))}
      {Array.from({ length: bars }, (_, b) => (
        <div key={b} className="absolute bottom-0 top-[14px] border-l border-line-dark" style={{ left: b * barPx }}>
          {b % every === 0 && <span className="absolute left-1 top-0.5 font-mono text-[12px] text-paper-dim">{b + 1}</span>}
        </div>
      ))}
    </div>
  );
}

const TrackRow = memo(function TrackRow({ track, index, head, height, width, narrow, beatAtClient }: { track: Track; index: number; head: number; height: number; width: number; narrow: boolean; beatAtClient: (x: number) => number }) {
  const selected = useStudio((s) => s.selectedTrack === track.id);
  return (
    <div className="flex border-b border-line-dark" style={{ height }} data-track-row={index}>
      <TrackHeader track={track} selected={selected} width={head} narrow={narrow} />
      <Lane track={track} width={width} beatAtClient={beatAtClient} selected={selected} />
    </div>
  );
});

function TrackHeader({ track, selected, width, narrow }: { track: Track; selected: boolean; width: number; narrow: boolean }) {
  const st = getStudio();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const read = useCallback(() => transport.trackLevel(track.id), [track.id]);
  const toggle = (k: "mute" | "solo" | "armed") => st.updateTrack(track.id, { [k]: !track[k] });
  const Icon = track.kind === "audio" ? Mic : track.kind === "drums" ? Drum : Piano;
  return (
    <div
      className={cn("sticky left-0 z-20 flex shrink-0 cursor-pointer flex-col justify-center gap-1 border-r border-line-dark px-2", "bg-ink-raised", selected && "shadow-[inset_0_0_0_9999px_rgb(243_240_232/0.07)]")}
      style={{ width }}
      onPointerDown={() => st.selectTrack(track.id)}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: track.color }} />
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon aria-hidden className="size-3.5 shrink-0 text-paper-dim" />
        {editing ? (
          <input
            autoFocus
            defaultValue={track.name}
            aria-label="Track name"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== track.name) st.updateTrack(track.id, { name: v.slice(0, 40) });
              setEditing(false);
            }}
            className="h-6 min-w-0 flex-1 rounded-sm border border-accent bg-ink px-1 text-[12px] text-paper outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-paper" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {track.name}
          </span>
        )}
        {!narrow && (
          <div className="relative">
            <button type="button" aria-label={`${track.name} options`} onClick={() => setMenu((m) => !m)} className="inline-flex size-6 items-center justify-center rounded-sm text-paper-dim hover:bg-paper/10 hover:text-paper">
              <MoreHorizontal aria-hidden className="size-3.5" />
            </button>
            {menu && <TrackMenu track={track} onClose={() => setMenu(false)} />}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <HeaderToggle label="Mute" short="M" on={track.mute} onClick={() => toggle("mute")} tone="warning" />
        <HeaderToggle label="Solo" short="S" on={track.solo} onClick={() => toggle("solo")} tone="success" />
        {track.kind !== "drums" && <HeaderToggle label="Arm for recording" short="R" on={track.armed} onClick={() => toggle("armed")} tone="danger" />}
        <Meter read={read} className="ml-1 min-w-0 flex-1" />
      </div>
    </div>
  );
}

function HeaderToggle({ label, short, on, onClick, tone }: { label: string; short: string; on: boolean; onClick: () => void; tone: "warning" | "success" | "danger" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border font-mono text-[12px] transition-colors",
        on ? (tone === "warning" ? "border-warning bg-warning text-ink" : tone === "success" ? "border-success bg-success text-paper" : "border-danger bg-danger text-paper") : "border-line-dark text-paper-dim hover:text-paper",
      )}
    >
      {short}
    </button>
  );
}

function TrackMenu({ track, onClose }: { track: Track; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [onClose]);
  const st = getStudio();
  const items: [string, () => void][] = [
    ["Duplicate track", () => st.duplicateTrack(track.id)],
    ["Move up", () => st.moveTrack(track.id, -1)],
    ["Move down", () => st.moveTrack(track.id, 1)],
    ...(track.kind !== "audio" ? ([["Bounce to audio", () => void bounceTrack(track.id)]] as [string, () => void][]) : []),
    ["Delete track", () => st.removeTrack(track.id)],
  ];
  return (
    <div ref={ref} role="menu" className="absolute right-0 top-7 z-[60] w-44 rounded-md border border-line-dark bg-ink-raised p-1 shadow-float" onPointerDown={(e) => e.stopPropagation()}>
      {items.map(([label, fn]) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          onClick={() => {
            fn();
            onClose();
          }}
          className={cn("block w-full rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-paper/10", label.startsWith("Delete") ? "text-danger" : "text-paper")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type Drag = { mode: "move" | "resize" | "trim"; ids: string[]; startX: number; startY: number; origin: Record<string, Clip>; moved: boolean; trackShift: number };

function Lane({ track, width, beatAtClient, selected }: { track: Track; width: number; beatAtClient: (x: number) => number; selected: boolean }) {
  const clips = useStudio(useShallow((s) => Object.values(s.project.clips).filter((c) => c.trackId === track.id)));
  const selection = useStudio((s) => s.selectedClips);
  const zoom = useStudio((s) => s.zoom);
  const sig = useStudio((s) => s.project.sig);
  const drag = useRef<Drag | null>(null);
  const [dropping, setDropping] = useState(false);

  const grid = () => {
    const s = getStudio();
    return s.snap === 0 ? 0 : s.snap < 0 ? s.project.sig : s.snap;
  };

  const onClipDown = (e: React.PointerEvent, c: Clip) => {
    e.stopPropagation();
    const st = getStudio();
    const target = e.currentTarget as HTMLElement;
    capture(e, target);
    const rect = target.getBoundingClientRect();
    const edge = Math.min(10, rect.width / 4);
    const mode: Drag["mode"] = e.clientX > rect.right - edge ? "resize" : e.clientX < rect.left + edge ? "trim" : "move";
    let ids = st.selectedClips;
    if (e.shiftKey || e.metaKey || e.ctrlKey) ids = ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id];
    else if (!ids.includes(c.id)) ids = [c.id];
    st.set({ selectedClips: ids, selectedTrack: c.trackId });
    const origin: Record<string, Clip> = {};
    for (const id of ids) if (st.project.clips[id]) origin[id] = st.project.clips[id];
    drag.current = { mode, ids: mode === "move" ? ids : [c.id], startX: e.clientX, startY: e.clientY, origin, moved: false, trackShift: 0 };
  };

  const onClipMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(e.clientY - d.startY) < 6) return;
    const st = getStudio();
    if (!d.moved) {
      st.checkpoint();
      d.moved = true;
    }
    const g = grid();
    const delta = dx / st.zoom;
    // Moving between tracks: the row under the pointer, if it takes this kind of clip.
    let toTrack: string | null = null;
    if (d.mode === "move") {
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-track-row]");
      const idx = row ? Number(row.dataset.trackRow) : -1;
      const t = st.project.tracks[idx];
      const first = d.origin[d.ids[0]];
      if (t && first && t.id !== first.trackId && (t.kind === "audio") === Boolean(first.assetId)) toTrack = t.id;
    }
    st.live((p) => {
      let q = p;
      for (const id of d.ids) {
        const o = d.origin[id];
        if (!o) continue;
        if (d.mode === "move") {
          const start = Math.max(0, P.snapBeat(o.start + delta, g, p.sig));
          q = P.updateClip(q, id, { start, ...(toTrack && d.ids.length === 1 ? { trackId: toTrack } : {}) });
        } else if (d.mode === "resize") {
          const end = P.snapBeat(o.start + o.length + delta, g, p.sig);
          const max = P.maxAudioLength(p, o);
          q = P.updateClip(q, id, { length: Math.max(g || 1 / 16, Math.min(max, end - o.start)) });
        } else {
          q = P.updateClip(q, id, P.trimStart(p, o, P.snapBeat(o.start + delta, g, p.sig)));
        }
      }
      return q;
    });
  };

  const onClipUp = () => {
    drag.current = null;
  };

  const onLaneDown = () => getStudio().set({ selectedClips: [], selectedTrack: track.id });
  const onLaneDouble = (e: React.MouseEvent) => {
    const st = getStudio();
    if (track.kind !== "audio") {
      // Double-click: a new empty clip (one bar for drums, four for instruments) to draw into.
      const at = Math.floor(beatAtClient(e.clientX) / st.project.sig) * st.project.sig;
      const len = st.project.sig * (track.kind === "drums" ? 1 : 4);
      const c = P.makeClip(track.id, { name: track.kind === "drums" ? "Beat" : "Notes", start: at, length: len, notes: [] });
      st.addClip(c);
      st.openEditor(c.id);
    }
  };

  return (
    <div
      className={cn("relative shrink-0", selected ? "bg-paper/[0.035]" : "", dropping && "bg-accent/10")}
      style={{ width, backgroundImage: `repeating-linear-gradient(90deg, rgb(51 49 42 / 0.55) 0 1px, transparent 1px ${zoom * sig}px)` }}
      onPointerDown={onLaneDown}
      onDoubleClick={onLaneDouble}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const files = [...e.dataTransfer.files];
        if (files.length) void importFiles(files, P.snapBeat(beatAtClient(e.clientX), 1, 4), track.kind === "audio" ? track.id : null);
      }}
    >
      {clips.map((c) => (
        <ClipView key={c.id} clip={c} color={track.color} zoom={zoom} selected={selection.includes(c.id)} kind={track.kind} onDown={onClipDown} onMove={onClipMove} onUp={onClipUp} />
      ))}
    </div>
  );
}

const ClipView = memo(function ClipView({ clip, color, zoom, selected, kind, onDown, onMove, onUp }: { clip: Clip; color: string; zoom: number; selected: boolean; kind: TrackKind; onDown: (e: React.PointerEvent, c: Clip) => void; onMove: (e: React.PointerEvent) => void; onUp: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const w = Math.max(4, clip.length * zoom);
  const bpm = useStudio((s) => s.project.bpm);
  const assetsReady = useStudio((s) => (clip.assetId ? Boolean(s.project.assets[clip.assetId]) : true));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.min(8192, Math.round(w * dpr));
    const ch = Math.round((cv.clientHeight || 40) * dpr);
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = "rgba(243,240,232,0.85)";
    if (clip.assetId) {
      const ov = overviewPeaks(clip.assetId);
      if (!ov) {
        // Not decoded yet: try again shortly.
        const t = setTimeout(() => setTick((x) => x + 1), 400);
        return () => clearTimeout(t);
      }
      const secs = (clip.length * 60) / bpm;
      const from = (clip.offset ?? 0) * ov.perSec;
      const span = secs * ov.perSec;
      const mid = ch / 2;
      for (let x = 0; x < cw; x++) {
        const i = Math.floor(from + (x / cw) * span);
        if (i * 2 + 1 >= ov.data.length) break;
        const lo = ov.data[i * 2];
        const hi = ov.data[i * 2 + 1];
        g.fillRect(x, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95));
      }
    } else if (clip.notes?.length) {
      const notes = clip.notes.filter((n) => n.start < clip.length);
      if (!notes.length) return;
      const lo = Math.min(...notes.map((n) => n.pitch));
      const hi = Math.max(...notes.map((n) => n.pitch));
      const rows = Math.max(12, hi - lo + 1);
      const rh = Math.max(1.5 * dpr, ch / rows);
      for (const n of notes) {
        const x = (n.start / clip.length) * cw;
        const nw = Math.max(1.5 * dpr, (Math.min(n.length, clip.length - n.start) / clip.length) * cw - 1);
        const y = ch - ((n.pitch - lo + 1) / rows) * ch;
        g.globalAlpha = 0.45 + n.velocity * 0.55;
        g.fillRect(x, y, nw, Math.min(rh, ch / 6) - 0.5);
      }
      g.globalAlpha = 1;
    }
  }, [clip, w, bpm, assetsReady, tick]);

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`${clip.name} clip`}
      aria-pressed={selected}
      className={cn("absolute inset-y-1 cursor-grab touch-none select-none overflow-hidden rounded-[5px] border active:cursor-grabbing", selected ? "border-paper ring-1 ring-paper" : "border-black/20", clip.muted && "opacity-40")}
      style={{ left: clip.start * zoom, width: w, background: `color-mix(in srgb, ${color} ${kind === "audio" ? 42 : 55}%, #15140f)` }}
      onPointerDown={(e) => onDown(e, clip)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        getStudio().openEditor(clip.id);
      }}
    >
      <span className="pointer-events-none absolute left-1.5 top-0.5 z-[1] max-w-[calc(100%-8px)] truncate text-[12px] font-medium leading-4 text-paper [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
        {clip.muted ? "◌ " : ""}
        {clip.name}
      </span>
      <canvas ref={canvas} className="pointer-events-none absolute inset-x-0 bottom-0 top-4 h-[calc(100%-16px)] w-full" />
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-paper/30" />
      <span aria-hidden className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-paper/30" />
    </div>
  );
});

function AddTrackRow({ head }: { head: number }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 px-2 py-3" style={{ width: head + 400 }}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="sticky left-2 inline-flex h-8 items-center gap-1.5 rounded-sm border border-dashed border-line-dark px-3 text-[12px] text-paper-dim hover:border-paper-dim hover:text-paper"
      >
        <Plus aria-hidden className="size-3.5" />
        Import audio, video or MIDI
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="audio/*,video/*,.mid,.midi,.dwylsong"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void importFiles(files);
        }}
      />
    </div>
  );
}
