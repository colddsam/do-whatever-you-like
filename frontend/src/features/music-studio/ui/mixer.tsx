"use client";

import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { applyMasterPreset } from "../actions";
import { MASTER_PRESETS } from "../constants";
import { transport } from "../engine/transport";
import { getStudio, useStudio } from "../store";
import type { Track } from "../types";
import { capture, Meter, Select, Slider } from "./controls";

/** BandLab/GarageBand-style mixer: one strip per track plus the master. */

const toDb = (g: number) => (g <= 0.0001 ? "−∞" : `${(20 * Math.log10(g)).toFixed(1)}`);

function Fader({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // 0..1.5 linear gain, drawn on a dB-ish curve so the top of the throw is fine-grained.
  const toPos = (g: number) => Math.pow(g / 1.5, 0.5);
  const fromPos = (p: number) => 1.5 * p * p;
  const set = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    onChange(Math.round(fromPos(p) * 1000) / 1000);
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1.5}
      aria-valuenow={value}
      aria-valuetext={`${toDb(value)} dB`}
      className="relative h-full w-7 cursor-ns-resize touch-none rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent"
      onPointerDown={(e) => {
        capture(e);
        getStudio().checkpoint();
        set(e.clientY);
      }}
      onPointerMove={(e) => e.buttons && set(e.clientY)}
      onDoubleClick={() => onChange(1)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.max(0, Math.min(1.5, fromPos(Math.max(0, Math.min(1, toPos(value) + (e.key === "ArrowUp" ? 0.03 : -0.03)))))));
        }
      }}
    >
      <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-line-dark" />
      <div className="absolute left-1/2 h-px w-4 -translate-x-1/2 bg-paper-dim" style={{ bottom: `${toPos(1) * 100}%` }} />
      <div className="absolute left-1/2 h-3 w-6 -translate-x-1/2 translate-y-1/2 rounded-[3px] border border-paper bg-ink" style={{ bottom: `${toPos(value) * 100}%` }} />
    </div>
  );
}

function Strip({ track }: { track: Track }) {
  const st = getStudio();
  const selected = useStudio((s) => s.selectedTrack === track.id);
  const read = useCallback(() => transport.trackLevel(track.id), [track.id]);
  return (
    <div className={cn("flex w-[92px] shrink-0 flex-col items-center gap-1.5 border-r border-line-dark px-1.5 py-2", selected && "bg-paper/[0.05]")} onPointerDown={() => st.selectTrack(track.id)}>
      <span aria-hidden className="h-1 w-full rounded-full" style={{ background: track.color }} />
      <span className="w-full truncate text-center text-[12px] text-paper" title={track.name}>
        {track.name}
      </span>
      <button
        type="button"
        onClick={() => st.set({ selectedTrack: track.id })}
        className="h-6 w-full rounded-[4px] border border-line-dark font-mono text-[12px] text-paper-dim hover:text-paper"
        title="Effects are in the side panel"
      >
        {track.fx.filter((f) => f.on).length} FX
      </button>
      <div className="flex w-full items-center gap-1" title="Pan">
        <Slider label={`${track.name} pan`} value={track.pan} min={-1} max={1} step={0.01} onStart={() => st.checkpoint()} onChange={(v) => st.live((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, pan: v } : t)) }))} />
      </div>
      <span className="font-mono text-[12px] text-paper-dim">{track.pan === 0 ? "C" : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}</span>
      <div className="flex min-h-[110px] flex-1 items-stretch gap-1.5">
        <Fader label={`${track.name} volume`} value={track.volume} onChange={(v) => st.live((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, volume: v } : t)) }))} />
        <Meter read={read} vertical className="h-full" />
      </div>
      <span className="font-mono text-[12px] text-paper">{toDb(track.volume)} dB</span>
      <div className="flex gap-1">
        {(["mute", "solo"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={track[k]}
            onClick={() => st.updateTrack(track.id, { [k]: !track[k] })}
            className={cn("h-6 w-7 rounded-[4px] border font-mono text-[12px]", track[k] ? (k === "mute" ? "border-warning bg-warning text-ink" : "border-success bg-success text-paper") : "border-line-dark text-paper-dim hover:text-paper")}
          >
            {k === "mute" ? "M" : "S"}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Mixer() {
  const tracks = useStudio((s) => s.project.tracks);
  const { volume, lufs, fxCount } = useStudio(useShallow((s) => ({ volume: s.project.master.volume, lufs: s.project.master.lufs ?? null, fxCount: s.project.master.fx.length })));
  const st = getStudio();
  const readL = useCallback(() => transport.masterLevels()[0], []);
  const readR = useCallback(() => transport.masterLevels()[1], []);
  return (
    <div className="flex h-full min-h-0 overflow-x-auto overflow-y-hidden" data-lenis-prevent>
      {tracks.map((t) => (
        <Strip key={t.id} track={t} />
      ))}
      <div className="sticky right-0 ml-auto flex w-[150px] shrink-0 flex-col gap-1.5 border-l border-line-dark bg-ink-raised px-2 py-2">
        <span className="label-mono text-center text-paper">Master</span>
        <Select
          label="Mastering preset"
          value=""
          onChange={(v) => v && applyMasterPreset(v)}
          options={[{ value: "", label: fxCount ? `${fxCount} FX · master…` : "Master with…" }, ...MASTER_PRESETS.map((m) => ({ value: m.id, label: m.label }))]}
          className="h-8 w-full flex-none sm:h-7"
        />
        <Select
          label="Export loudness"
          value={lufs === null ? "off" : String(lufs)}
          onChange={(v) => st.commit((p) => ({ ...p, master: { ...p.master, lufs: v === "off" ? null : Number(v) } }))}
          options={[
            { value: "off", label: "Loudness: as mixed" },
            { value: "-9", label: "−9 LUFS (club)" },
            { value: "-14", label: "−14 LUFS (streaming)" },
            { value: "-16", label: "−16 LUFS (podcast)" },
            { value: "-23", label: "−23 LUFS (broadcast)" },
          ]}
          className="h-8 w-full flex-none sm:h-7"
        />
        <div className="flex min-h-[110px] flex-1 items-stretch justify-center gap-1.5">
          <Fader label="Master volume" value={volume} onChange={(v) => st.live((p) => ({ ...p, master: { ...p.master, volume: v } }))} />
          <Meter read={readL} vertical className="h-full" />
          <Meter read={readR} vertical className="h-full" />
        </div>
        <span className="text-center font-mono text-[12px] text-paper">{toDb(volume)} dB</span>
      </div>
    </div>
  );
}
