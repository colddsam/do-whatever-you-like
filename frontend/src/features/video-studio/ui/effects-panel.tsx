"use client";

import { createElement, useMemo, useState } from "react";
import { LayoutGrid, Palette, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFECT_CATEGORIES, EFFECT_ORDER, EFFECTS, LOOKS, MEDIA_ONLY_EFFECTS } from "../constants";
import { anim } from "../lib/keyframes";
import { uid } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import type { Clip, EffectCategory, EffectType, LookId } from "../types";
import { BUILTIN_LUTS } from "../engine/luts";
import { CATEGORY_ICON, EFFECT_ICON, LOOK_SWATCH, LUT_SWATCH } from "./catalog";

export const EFFECT_MIME = "application/x-studio-effect";

/** Visual clips an effect applies to: the selection, or the clip under the playhead on the top-most track. */
function targets(): Clip[] {
  const s = getStudio();
  const sel = s.selection.map((id) => s.project.clips[id]).filter((c): c is Clip => !!c && c.kind !== "audio");
  if (sel.length) return sel;
  const t = s.playhead;
  for (const tr of s.project.tracks) {
    if (tr.kind === "audio" || tr.hidden) continue;
    const hit = Object.values(s.project.clips).find((c) => c.trackId === tr.id && c.kind !== "audio" && t >= c.start && t < c.start + c.duration);
    if (hit) return [hit];
  }
  return [];
}

export function canTake(c: Clip, type: EffectType) {
  if (c.kind === "audio") return false;
  if (MEDIA_ONLY_EFFECTS.includes(type) && c.kind !== "video" && c.kind !== "image") return false;
  return true;
}

/** Adds an effect to every selected visual clip that can take it. */
export function applyEffect(type: EffectType) {
  const st = getStudio();
  const list = targets().filter((c) => canTake(c, type));
  if (!list.length) {
    st.notify("Select a clip first (or drag the effect onto one).", "info");
    return;
  }
  st.set({ selection: list.map((c) => c.id) });
  st.addEffectToSelection(type);
  st.notify(`${EFFECTS[type].label} added${list.length > 1 ? ` to ${list.length} clips` : ""}.`, "success");
}

/** A built-in or imported LUT as a "LUT film look" effect on the selected clips. */
export function applyLut(lutId: string, name: string) {
  const st = getStudio();
  const list = targets().filter((c) => c.kind !== "text");
  if (!list.length) {
    st.notify("Select a clip first.", "info");
    return;
  }
  st.commit((p) => {
    let next = p;
    for (const c of list) {
      next = TL.updateClip(next, c.id, (x) => ({
        ...x,
        effects: [...x.effects.filter((e) => e.type !== "lut"), { id: uid("fx"), type: "lut", enabled: true, params: { intensity: anim(1) }, options: { lut: lutId, name } }],
      }));
    }
    return next;
  });
  st.notify(`${name} applied.`, "success");
}

export function EffectGlyph({ type, className }: { type: EffectType; className?: string }) {
  return createElement(EFFECT_ICON[type], { "aria-hidden": true, className });
}

export function EffectTile({ type, on, compact, onPick }: { type: EffectType; on?: boolean; compact?: boolean; onPick: (t: EffectType) => void }) {
  const spec = EFFECTS[type];
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(EFFECT_MIME, type);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onPick(type)}
      title={`${spec.label}: ${spec.hint}`}
      aria-pressed={on}
      className={cn(
        "group flex w-full min-w-0 items-center gap-2.5 rounded-md border text-left transition-colors",
        compact ? "px-1.5 py-1.5" : "px-2 py-1.5",
        on ? "border-paper/60 bg-paper/10" : "border-line-dark hover:border-paper/40 hover:bg-paper/5",
      )}
    >
      <span className={cn("flex shrink-0 items-center justify-center rounded-full transition-colors", compact ? "size-7" : "size-8", on ? "bg-accent text-paper" : "bg-paper/10 text-paper group-hover:bg-paper group-hover:text-ink")}>
        <EffectGlyph type={type} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-tight text-paper">{spec.label}</span>
        {!compact && <span className="mt-0.5 block truncate text-[12px] leading-snug text-paper-dim">{spec.hint}</span>}
      </span>
    </button>
  );
}

function LookTile({ label, swatch, onPick, title }: { label: string; swatch: string; onPick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onPick} title={title ?? label} className="group flex min-w-0 flex-col overflow-hidden rounded-md border border-line-dark text-left hover:border-paper/40">
      <span aria-hidden className="block h-9 transition-transform duration-300 group-hover:scale-[1.04]" style={{ background: swatch }} />
      <span className="truncate px-1.5 py-1 text-[12px] text-paper-dim group-hover:text-paper">{label}</span>
    </button>
  );
}

/** Looks (grade recipes) and LUT film looks as swatches. */
export function LooksGrid({ cols = 3 }: { cols?: number }) {
  const st = getStudio();
  return (
    <div className={cn("grid gap-1.5", cols === 4 ? "grid-cols-4" : "grid-cols-3")}>
      {(Object.keys(LOOKS) as LookId[]).map((id) => (
        <LookTile
          key={id}
          label={LOOKS[id].label}
          swatch={LOOK_SWATCH[id]}
          onPick={() => {
            const ids = st.selection.length ? st.selection : [];
            if (!ids.length) return st.notify("Select a clip first.", "info");
            st.applyLook(ids, id);
          }}
        />
      ))}
      {BUILTIN_LUTS.map((l) => (
        <LookTile key={l.id} label={l.name} title={`${l.name}: ${l.hint} (LUT)`} swatch={LUT_SWATCH[l.id] ?? "#333"} onPick={() => applyLut(l.id, l.name)} />
      ))}
    </div>
  );
}

type Chip = "all" | "looks" | EffectCategory;

export function EffectsPanel() {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const primary = usePrimaryClip();
  const hasSel = useStudio((s) => s.selection.length > 0);
  const active = useMemo(() => new Set(primary?.effects.map((e) => e.type) ?? []), [primary]);
  const query = q.trim().toLowerCase();
  const sections = EFFECT_CATEGORIES.map((c) => ({
    ...c,
    types: EFFECT_ORDER.filter((t) => EFFECTS[t].category === c.id && t !== "lut").filter((t) => !query || `${EFFECTS[t].label} ${EFFECTS[t].hint} ${c.label}`.toLowerCase().includes(query)),
  })).filter((s) => s.types.length && (chip === "all" || chip === s.id));
  const chips: { id: Chip; label: string; icon: typeof Palette }[] = [
    { id: "all", label: "All", icon: LayoutGrid },
    { id: "looks", label: "Looks", icon: Palette },
    ...EFFECT_CATEGORIES.map((c) => ({ id: c.id as Chip, label: c.label, icon: CATEGORY_ICON[c.id] })),
  ];
  const showLooks = !query && (chip === "all" || chip === "looks");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line-dark p-2">
        <label className="flex h-8 items-center gap-1.5 rounded-sm border border-line-dark bg-ink px-2 focus-within:border-accent">
          <Search aria-hidden className="size-3.5 shrink-0 text-paper-dim" />
          <input
            aria-label="Search effects"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={`Search ${EFFECT_ORDER.length} effects`}
            className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-paper outline-none placeholder:text-paper-dim/70"
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="text-paper-dim hover:text-paper">
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </label>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5" data-lenis-prevent>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChip(c.id)}
              aria-pressed={chip === c.id}
              className={cn("inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[12px]", chip === c.id ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:text-paper")}
            >
              <c.icon aria-hidden className="size-3.5" />
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" data-lenis-prevent>
        {!hasSel && <p className="mb-2 rounded-md border border-line-dark px-2 py-1.5 text-[12px] leading-snug text-paper-dim">Select clips, then click an effect, or drag an effect onto a clip on the timeline.</p>}
        {showLooks && (
          <section className="mb-3">
            <h3 className="label-mono mb-1.5 flex items-center gap-1.5 text-paper-dim">
              <Palette aria-hidden className="size-3.5" />
              Looks and film LUTs
            </h3>
            <LooksGrid />
          </section>
        )}
        {chip !== "looks" &&
          sections.map((s) => (
            <section key={s.id} className="mb-3">
              <h3 className="label-mono mb-1.5 flex items-center gap-1.5 text-paper-dim">
                {createElement(CATEGORY_ICON[s.id], { "aria-hidden": true, className: "size-3.5" })}
                {s.label}
              </h3>
              <ul className="grid grid-cols-1 gap-1.5">
                {s.types.map((t) => (
                  <li key={t} className="min-w-0">
                    <EffectTile type={t} on={active.has(t)} onPick={applyEffect} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {query && !sections.length && <p className="px-1 py-6 text-center text-[12px] text-paper-dim">No effect matches “{q}”.</p>}
      </div>
    </div>
  );
}
