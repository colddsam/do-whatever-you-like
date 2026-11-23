"use client";

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowUp,
  Box,
  Copy,
  CornerLeftDown,
  Eye,
  EyeOff,
  FileOutput,
  FolderDown,
  Layers as LayersIcon,
  Lock,
  PenTool,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  Stamp,
  Trash2,
  Unlock,
} from "lucide-react";
import { RichColorPicker } from "@/components/tools/design/rich-color-picker";
import { cn } from "@/lib/utils";
import { CHECKER } from "../task";
import { ADJUSTMENTS } from "./adjustments";
import { ctx2d } from "./doc";
import { getPhotoLuts, importPhotoCubeFile, subscribePhotoLuts } from "./luts";
import { curveLut, type Op, type Param } from "./ops";
import type { BlendMode, Doc, Effects, VPath } from "./types";
import { Btn, Check2, ColorWell, Floating, IconBtn, insideFloat, MenuButton, NumField, RangeRow, Select, type MenuItem } from "./ui";

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "color-burn", label: "Color Burn" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "lighter", label: "Linear Dodge (Add)" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft Light" },
  { value: "hard-light", label: "Hard Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

/* ---------- Thumbnails ---------- */

export const Thumb = memo(function Thumb({
  canvas,
  size = 36,
  mask,
  smart,
  active,
  onClick,
  onDoubleClick,
  label,
}: {
  canvas: HTMLCanvasElement | null;
  size?: number;
  mask?: boolean;
  smart?: boolean;
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !canvas) return;
    const k = Math.min(size / canvas.width, size / canvas.height);
    c.width = Math.max(1, Math.round(canvas.width * k * 2));
    c.height = Math.max(1, Math.round(canvas.height * k * 2));
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    if (mask) {
      // Show the mask as Photoshop does: white shows, black hides.
      g.fillStyle = "#000";
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(canvas, 0, 0, c.width, c.height);
  }, [canvas, size, mask]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] border", CHECKER, active ? "border-ink ring-1 ring-ink" : "border-line")}
      style={{ width: size, height: size }}
    >
      <canvas ref={ref} className="max-h-full max-w-full" />
      {smart && (
        <span
          aria-hidden
          title="Smart Object — double-click to edit contents"
          className="absolute bottom-0 right-0 flex size-3.5 items-center justify-center rounded-tl-[2px] border-l border-t border-line bg-surface/95 text-ink"
        >
          <Box className="size-2.5" strokeWidth={2.2} />
        </span>
      )}
    </button>
  );
});

/* ---------- Layers panel ---------- */

export type LayerApi = {
  select: (id: string, mask?: boolean, mod?: { ctrl?: boolean; shift?: boolean }) => void;
  selectedIds: string[];
  toggleVisible: (id: string) => void;
  rename: (id: string, name: string) => void;
  move: (id: string, toIndex: number) => void;
  setOpacity: (v: number) => void;
  setBlend: (v: BlendMode) => void;
  toggleLock: () => void;
  toggleLockAlpha: () => void;
  add: () => void;
  addAdjustment: (opId: string) => void;
  addMask: () => void;
  duplicate: () => void;
  remove: () => void;
  mergeDown: () => void;
  toggleClip: () => void;
  openStyle: () => void;
  selectPixels: (id: string) => void;
  convertToSmart: (ids?: string[]) => void;
  editSmart: (id?: string) => void;
  replaceSmart: (id?: string) => void;
  duplicateSmartCopy: (id?: string) => void;
  exportSmart: (id?: string) => void;
  resetSmartTransform: (id?: string) => void;
  rasterize: (id?: string) => void;
  rasterizeStyle: (id?: string) => void;
  rasterizeAll: () => void;
  applyMask: (id?: string) => void;
  stampVisible: () => void;
  mergeSelected: () => void;
  deleteSelected: () => void;
  toggleSmartFilters: (layerId: string) => void;
  toggleSmartFilter: (layerId: string, filterId: string) => void;
  editSmartFilter: (layerId: string, filterId: string) => void;
  removeSmartFilter: (layerId: string, filterId: string) => void;
  reorderSmartFilter: (layerId: string, filterId: string, dir: -1 | 1) => void;
  clearSmartFilters: (layerId: string) => void;
};

export function LayersPanel({ doc, api }: { doc: Doc; api: LayerApi }) {
  const active = doc.layers.find((l) => l.id === doc.active);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ layerId: string; el: HTMLElement } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shown = [...doc.layers].reverse();
  const adjItems: MenuItem[] = ADJUSTMENTS.filter((a) => a.layerable).map((a) => ({ label: a.label, onSelect: () => api.addAdjustment(a.id) }));
  const selSet = useMemo(() => new Set(api.selectedIds.length ? api.selectedIds : [doc.active]), [api.selectedIds, doc.active]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: PointerEvent) => !insideFloat(e.target) && setCtxMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setCtxMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [ctxMenu]);

  const ctxLayer = ctxMenu ? doc.layers.find((x) => x.id === ctxMenu.layerId) : null;

  return (
    <div ref={panelRef} className="flex min-h-0 flex-col">
      {/* One row, so short screens still show plenty of layers: blend, opacity (drag the label to scrub), locks. */}
      {active && (
        <div className="border-b border-line px-2 py-1.5">
          <div className="flex items-center gap-1">
            <Select label="Blend mode" value={active.blend} onChange={api.setBlend} options={BLEND_MODES} className="min-w-0 flex-1" />
            <NumField label="Opacity" value={Math.round(active.opacity * 100)} min={0} max={100} onChange={(v) => api.setOpacity(v / 100)} width="w-11" />
            <IconBtn label={active.locked ? "Unlock layer" : "Lock layer"} active={active.locked} onClick={api.toggleLock} className="size-7">
              {active.locked ? <Lock aria-hidden className="size-3.5" /> : <Unlock aria-hidden className="size-3.5" />}
            </IconBtn>
            <IconBtn label="Lock transparent pixels" active={active.lockAlpha} onClick={api.toggleLockAlpha} className="size-7">
              <SquareDashed aria-hidden className="size-3.5" />
            </IconBtn>
            <IconBtn label="Clip to layer below" active={active.clip} onClick={api.toggleClip} className="size-7" shortcut="Alt+Ctrl+G">
              <CornerLeftDown aria-hidden className="size-3.5" />
            </IconBtn>
          </div>
        </div>
      )}
      <ul role="listbox" aria-label="Layers" className="min-h-0 flex-1 overflow-y-auto py-1" data-lenis-prevent>
        {shown.map((l, vi) => {
          const index = doc.layers.length - 1 - vi;
          const isActive = l.id === doc.active;
          const isSelected = selSet.has(l.id);
          return (
            <li key={l.id}>
              <div
                role="option"
                aria-selected={isSelected}
                draggable={renaming !== l.id}
                onDragStart={(e) => {
                  setDragId(l.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOver(index);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) api.move(dragId, index);
                  setDragId(null);
                  setOver(null);
                }}
                onClick={(e) => api.select(l.id, false, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selSet.has(l.id)) api.select(l.id, false);
                  setCtxMenu({ layerId: l.id, el: e.currentTarget });
                }}
                className={cn(
                  "group relative flex cursor-pointer items-center gap-2 border-l-2 py-1.5 pl-1.5 pr-2",
                  isActive ? "border-accent bg-paper-2" : isSelected ? "border-ink bg-paper-2/60" : "border-transparent hover:bg-paper",
                  over === index && dragId !== l.id && "shadow-[inset_0_2px_0_var(--color-ink)]",
                  dragId === l.id && "opacity-50",
                )}
              >
                <button
                  type="button"
                  aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    api.toggleVisible(l.id);
                  }}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-surface hover:text-ink"
                >
                  {l.visible ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5 text-ink-3" />}
                </button>
                {l.clip && <CornerLeftDown aria-label="Clipped to the layer below" className="size-3.5 shrink-0 text-ink-3" />}
                {l.kind === "adjustment" ? (
                  <span title="Adjustment layer" className="flex size-9 shrink-0 items-center justify-center rounded-[3px] border border-line bg-surface">
                    <SlidersHorizontal aria-hidden className="size-4 text-ink-2" />
                  </span>
                ) : (
                  <Thumb
                    canvas={l.canvas}
                    smart={l.kind === "smart"}
                    label={
                      l.kind === "smart"
                        ? `${l.name} Smart Object (double-click thumbnail to edit contents)`
                        : `${l.name} pixels${isActive && !doc.editMask ? " (editing)" : ""}`
                    }
                    active={isActive && !doc.editMask && !!l.mask}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.ctrlKey || e.metaKey) api.selectPixels(l.id);
                      else api.select(l.id, false);
                    }}
                    onDoubleClick={(e) => {
                      if (l.kind === "smart") {
                        e.stopPropagation();
                        api.editSmart(l.id);
                      }
                    }}
                  />
                )}
                {l.mask && (
                  <Thumb
                    canvas={l.mask}
                    mask
                    label={`${l.name} mask${isActive && doc.editMask ? " (editing)" : ""}`}
                    active={isActive && doc.editMask}
                    onClick={(e) => {
                      e.stopPropagation();
                      api.select(l.id, true);
                    }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  {renaming === l.id ? (
                    <input
                      autoFocus
                      defaultValue={l.name}
                      aria-label="Layer name"
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        api.rename(l.id, e.target.value.trim() || l.name);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                        e.stopPropagation();
                      }}
                      className="h-6 w-full rounded-sm border border-ink bg-surface px-1 text-[13px] text-ink outline-none"
                    />
                  ) : (
                    <p onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename (right-click for options)" className={cn("truncate text-[13px]", l.visible ? "text-ink" : "text-ink-3", isActive && "font-medium")}>
                      {l.name}
                    </p>
                  )}
                  <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase text-ink-3">
                    {l.kind !== "pixel" && (
                      <span className={cn(l.kind === "smart" && "text-ink-2 font-semibold")}>
                        {l.kind === "adjustment" ? "adj" : l.kind === "vector" ? "vec" : l.kind}
                      </span>
                    )}
                    {l.smart && l.smart.filters.length > 0 && <span>· {l.smart.filters.length}fx</span>}
                    {l.blend !== "normal" && <span>{BLEND_MODES.find((b) => b.value === l.blend)?.label}</span>}
                    {l.opacity < 1 && <span>{Math.round(l.opacity * 100)}%</span>}
                    {l.effects && <span className="text-accent">fx</span>}
                  </p>
                </div>
                {l.locked && <Lock aria-label="Locked" className="size-3.5 shrink-0 text-ink-3" />}
                <span className="hidden shrink-0 flex-col group-hover:flex group-focus-within:flex max-lg:flex">
                  <button type="button" aria-label={`Move ${l.name} up`} disabled={index === doc.layers.length - 1} onClick={(e) => (e.stopPropagation(), api.move(l.id, index + 1))} className="text-ink-3 hover:text-ink disabled:opacity-30">
                    <ArrowUp aria-hidden className="size-3" />
                  </button>
                  <button type="button" aria-label={`Move ${l.name} down`} disabled={index === 0} onClick={(e) => (e.stopPropagation(), api.move(l.id, index - 1))} className="text-ink-3 hover:text-ink disabled:opacity-30">
                    <ArrowDown aria-hidden className="size-3" />
                  </button>
                </span>
              </div>
              {l.kind === "smart" && l.smart && l.smart.filters.length > 0 && (
                <div className="ml-8 border-l border-line bg-paper/35 py-1 pl-2 pr-2">
                  <div className="flex items-center gap-1.5 py-0.5 text-[11px] text-ink-3">
                    <button
                      type="button"
                      aria-label={l.smart.filtersOn ? "Disable all Smart Filters" : "Enable all Smart Filters"}
                      onClick={() => api.toggleSmartFilters(l.id)}
                      className="inline-flex size-5 items-center justify-center rounded-sm hover:bg-surface hover:text-ink"
                    >
                      {l.smart.filtersOn ? <Eye aria-hidden className="size-3" /> : <EyeOff aria-hidden className="size-3" />}
                    </button>
                    <span className="font-mono uppercase tracking-wider">Smart Filters</span>
                    <button type="button" onClick={() => api.clearSmartFilters(l.id)} className="ml-auto text-[11px] hover:text-ink">
                      Clear
                    </button>
                  </div>
                  {l.smart.filters.map((f, fi) => (
                    <div key={f.id} className="flex items-center gap-1 py-0.5 text-[12px]">
                      <button
                        type="button"
                        aria-label={f.enabled ? `Hide ${f.label}` : `Show ${f.label}`}
                        onClick={() => api.toggleSmartFilter(l.id, f.id)}
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-surface hover:text-ink"
                      >
                        {f.enabled ? <Eye aria-hidden className="size-3" /> : <EyeOff aria-hidden className="size-3 opacity-50" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => api.editSmartFilter(l.id, f.id)}
                        title="Click to edit Smart Filter settings"
                        className={cn("min-w-0 flex-1 truncate text-left hover:text-ink hover:underline", f.enabled && l.smart!.filtersOn ? "text-ink-2" : "text-ink-3 line-through")}
                      >
                        {f.label}
                      </button>
                      {l.smart!.filters.length > 1 && (
                        <>
                          <button type="button" aria-label="Move filter up" disabled={fi === 0} onClick={() => api.reorderSmartFilter(l.id, f.id, -1)} className="text-ink-3 hover:text-ink disabled:opacity-25">
                            <ArrowUp aria-hidden className="size-3" />
                          </button>
                          <button type="button" aria-label="Move filter down" disabled={fi === l.smart!.filters.length - 1} onClick={() => api.reorderSmartFilter(l.id, f.id, 1)} className="text-ink-3 hover:text-ink disabled:opacity-25">
                            <ArrowDown aria-hidden className="size-3" />
                          </button>
                        </>
                      )}
                      <button type="button" aria-label={`Remove ${f.label}`} onClick={() => api.removeSmartFilter(l.id, f.id)} className="text-ink-3 hover:text-danger">
                        <Trash2 aria-hidden className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {ctxMenu && ctxLayer && (
        <Floating anchor={ctxMenu.el} side="right" role="menu" className="w-56 rounded-md border border-line bg-surface p-1 shadow-float">
          {selSet.size > 1 ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setCtxMenu(null);
                  api.convertToSmart([...selSet]);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink"
              >
                <Box aria-hidden className="size-3.5" /> Convert {selSet.size} Layers to Smart Object
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setCtxMenu(null);
                  api.mergeSelected();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink"
              >
                <FolderDown aria-hidden className="size-3.5" /> Merge {selSet.size} Selected Layers
              </button>
            </>
          ) : ctxLayer.kind === "smart" ? (
            <>
              <button type="button" role="menuitem" onClick={() => { setCtxMenu(null); api.editSmart(ctxLayer.id); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] font-medium text-ink hover:bg-paper-2">
                <Box aria-hidden className="size-3.5" /> Edit Contents
              </button>
              <button type="button" role="menuitem" onClick={() => { setCtxMenu(null); api.replaceSmart(ctxLayer.id); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                <RefreshCw aria-hidden className="size-3.5" /> Replace Contents…
              </button>
              <button type="button" role="menuitem" onClick={() => { setCtxMenu(null); api.duplicateSmartCopy(ctxLayer.id); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                <Copy aria-hidden className="size-3.5" /> New Smart Object via Copy
              </button>
              <button type="button" role="menuitem" onClick={() => { setCtxMenu(null); api.exportSmart(ctxLayer.id); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                <FileOutput aria-hidden className="size-3.5" /> Export Contents…
              </button>
              <button type="button" role="menuitem" onClick={() => { setCtxMenu(null); api.resetSmartTransform(ctxLayer.id); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                <RotateCcw aria-hidden className="size-3.5" /> Reset Transform
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={ctxLayer.kind === "adjustment"}
              onClick={() => {
                setCtxMenu(null);
                api.convertToSmart([ctxLayer.id]);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40"
            >
              <Box aria-hidden className="size-3.5" /> Convert to Smart Object
            </button>
          )}
          <div role="separator" className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            disabled={ctxLayer.kind === "pixel" || ctxLayer.kind === "adjustment"}
            onClick={() => {
              setCtxMenu(null);
              api.rasterize(ctxLayer.id);
            }}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40"
          >
            <LayersIcon aria-hidden className="size-3.5" /> Rasterize Layer
          </button>
          {ctxLayer.effects && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCtxMenu(null);
                api.rasterizeStyle(ctxLayer.id);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              <Sparkles aria-hidden className="size-3.5" /> Rasterize Layer Style
            </button>
          )}
          {ctxLayer.mask && ctxLayer.kind !== "adjustment" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCtxMenu(null);
                api.applyMask(ctxLayer.id);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              <SquareDashed aria-hidden className="size-3.5" /> Apply Layer Mask
            </button>
          )}
          <div role="separator" className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" disabled={ctxLayer.kind === "adjustment"} onClick={() => { setCtxMenu(null); api.openStyle(); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40">
            <Sparkles aria-hidden className="size-3.5" /> Layer Style (fx)…
          </button>
          <button type="button" role="menuitem" onClick={() => { setCtxMenu(null); api.duplicate(); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink">
            <Copy aria-hidden className="size-3.5" /> Duplicate Layer
          </button>
          <button type="button" role="menuitem" onClick={() => { setCtxMenu(null); api.stampVisible(); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink">
            <Stamp aria-hidden className="size-3.5" /> Stamp Visible (New Layer)
          </button>
          <button type="button" role="menuitem" disabled={doc.layers.length < 2} onClick={() => { setCtxMenu(null); api.deleteSelected(); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-danger hover:bg-danger/10 disabled:opacity-40">
            <Trash2 aria-hidden className="size-3.5" /> Delete
          </button>
        </Floating>
      )}
      <div className="flex items-center justify-between gap-0.5 border-t border-line px-1.5 py-1">
        <IconBtn label={selSet.size > 1 ? "Convert selected to Smart Object" : active?.kind === "smart" ? "Edit Smart Object contents" : "Convert to Smart Object"} onClick={() => (active?.kind === "smart" && selSet.size === 1 ? api.editSmart(active.id) : api.convertToSmart([...selSet]))} disabled={!active || (active.kind === "adjustment" && selSet.size === 1)}>
          <Box aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Layer style (fx)" onClick={api.openStyle} disabled={!active || active.kind === "adjustment"}>
          <Sparkles aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Add layer mask" onClick={api.addMask} disabled={!active || !!active.mask}>
          <span aria-hidden className="relative inline-flex size-4 items-center justify-center rounded-[3px] border-[1.5px] border-current">
            <span className="size-1.5 rounded-full bg-current" />
          </span>
        </IconBtn>
        <MenuButton label="New adjustment layer" items={adjItems} className="inline-flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink">
          <SlidersHorizontal aria-hidden className="size-4" />
        </MenuButton>
        <IconBtn label={selSet.size > 1 ? "Merge selected layers" : "Merge down"} onClick={() => (selSet.size > 1 ? api.mergeSelected() : api.mergeDown())} disabled={!active || (selSet.size < 2 && doc.layers.indexOf(active) === 0)} shortcut="Ctrl+E">
          <FolderDown aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Duplicate layer" onClick={api.duplicate} shortcut="Ctrl+J">
          <Copy aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="New layer" onClick={api.add} shortcut="Shift+Ctrl+N">
          <Plus aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Delete layer" onClick={() => (selSet.size > 1 ? api.deleteSelected() : api.remove())} disabled={doc.layers.length < 2}>
          <Trash2 aria-hidden className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
}

/* ---------- Dedicated Color Panel ---------- */

export function ColorPanel({
  fg,
  bg,
  onFg,
  onBg,
  onSwap,
  onReset,
  onEyedropper,
  eyedropperActive,
}: {
  fg: string;
  bg: string;
  onFg: (c: string) => void;
  onBg: (c: string) => void;
  onSwap: () => void;
  onReset: () => void;
  onEyedropper: () => void;
  eyedropperActive: boolean;
}) {
  const [slot, setSlot] = useState<"fg" | "bg">("fg");
  const cur = slot === "fg" ? fg : bg;
  const setCur = slot === "fg" ? onFg : onBg;
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-1.5">
        <div role="tablist" aria-label="Active colour swatch" className="grid flex-1 grid-cols-2 gap-1 rounded-sm border border-line bg-paper p-0.5">
          {(
            [
              ["fg", "Foreground", fg],
              ["bg", "Background", bg],
            ] as const
          ).map(([id, label, color]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={slot === id}
              onClick={() => setSlot(id)}
              className={cn(
                "flex h-7 items-center justify-center gap-1.5 rounded-[3px] text-[12px] transition-colors",
                slot === id ? "bg-surface font-medium text-ink shadow-xs" : "text-ink-3 hover:text-ink",
              )}
            >
              <span aria-hidden className="size-3 rounded-[2px] border border-line" style={{ background: color }} />
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onSwap} title="Swap FG / BG (X)" className="inline-flex h-8 items-center rounded-sm border border-line px-2 font-mono text-[11px] text-ink-2 hover:border-ink-3 hover:text-ink">
          X
        </button>
        <button type="button" onClick={onReset} title="Default B/W (D)" className="inline-flex h-8 items-center rounded-sm border border-line px-2 font-mono text-[11px] text-ink-2 hover:border-ink-3 hover:text-ink">
          D
        </button>
      </div>
      <RichColorPicker
        value={cur}
        onChange={setCur}
        onEyedropper={onEyedropper}
        eyedropperActive={eyedropperActive}
        eyedropperLabel="Eyedropper tool on canvas (I)"
      />
      <p className="text-[11px] leading-relaxed text-ink-3">Tip: With Eyedropper (I), click for Foreground or Alt-click for Background. Alt-click while painting samples a colour instantly.</p>
    </div>
  );
}

/* ---------- History ---------- */

export function HistoryPanel({ entries, index, onJump }: { entries: { label: string }[]; index: number; onJump: (i: number) => void }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return (
    <ol ref={ref} className="space-y-px py-1" data-lenis-prevent>
      {entries.map((e, i) => (
        <li key={i} data-i={i}>
          <button
            type="button"
            onClick={() => onJump(i)}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "flex h-8 w-full items-center gap-2 px-3 text-left text-[13px]",
              i === index ? "bg-ink text-paper" : i > index ? "text-ink-3 hover:bg-paper" : "text-ink-2 hover:bg-paper",
            )}
          >
            <span className="w-5 font-mono text-[12px] opacity-60">{String(i + 1).padStart(2, "0")}</span>
            <span className="truncate">{e.label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Histogram ---------- */

type Hist = { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array };

export function HistogramChart({ hist, channel = "l", height = 80, className }: { hist: Hist | null; channel?: "l" | "r" | "g" | "b" | "rgb"; height?: number; className?: string }) {
  const paths = useMemo(() => {
    if (!hist) return [];
    const list: { key: string; color: string; data: Uint32Array }[] =
      channel === "rgb"
        ? [
            { key: "r", color: "rgba(220,38,38,0.45)", data: hist.r },
            { key: "g", color: "rgba(22,163,74,0.45)", data: hist.g },
            { key: "b", color: "rgba(37,99,235,0.45)", data: hist.b },
          ]
        : [{ key: channel, color: channel === "l" ? "var(--color-ink-3)" : channel === "r" ? "rgba(220,38,38,0.6)" : channel === "g" ? "rgba(22,163,74,0.6)" : "rgba(37,99,235,0.6)", data: hist[channel] }];
    // Scale to the 99th-percentile bar so one spike (pure white) doesn't flatten everything.
    const all = list.flatMap((x) => Array.from(x.data)).sort((a, b) => a - b);
    const top = Math.max(1, all[Math.floor(all.length * 0.99)] ?? 1);
    return list.map((x) => {
      let d = `M0 ${height}`;
      for (let i = 0; i < 256; i++) d += ` L${i} ${height - Math.min(1, x.data[i] / top) * height}`;
      return { ...x, d: `${d} L255 ${height} Z` };
    });
  }, [hist, channel, height]);
  return (
    <svg viewBox={`0 0 256 ${height}`} preserveAspectRatio="none" className={cn("block w-full", className)} style={{ height }} aria-hidden>
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill={p.color} style={{ mixBlendMode: "multiply" }} />
      ))}
    </svg>
  );
}

/* ---------- Curves ---------- */

type Curves = Record<"rgb" | "r" | "g" | "b", [number, number][]>;

function CurvesEditor({ value, onChange, hist }: { value: Curves; onChange: (v: Curves) => void; hist: Hist | null }) {
  const [ch, setCh] = useState<keyof Curves>("rgb");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = value[ch];
  const table = useMemo(() => curveLut(pts), [pts]);
  const path = useMemo(() => Array.from(table, (v, i) => `${i ? "L" : "M"}${i} ${255 - v}`).join(" "), [table]);
  const toPt = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))), Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255)))];
  };
  const set = (next: [number, number][]) => onChange({ ...value, [ch]: next });
  const stroke = ch === "rgb" ? "var(--color-ink)" : ch === "r" ? "#dc2626" : ch === "g" ? "#16a34a" : "#2563eb";
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(["rgb", "r", "g", "b"] as const).map((c) => (
          <button key={c} type="button" onClick={() => setCh(c)} className={cn("h-7 rounded-sm px-2.5 font-mono text-[12px] uppercase", ch === c ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
            {c}
          </button>
        ))}
        <button type="button" onClick={() => set([[0, 0], [255, 255]])} className="ml-auto h-7 px-2 text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          Reset
        </button>
      </div>
      <div className="relative aspect-square w-full rounded-sm border border-line bg-paper">
        <HistogramChart hist={hist} channel={ch === "rgb" ? "l" : ch} height={256} className="absolute inset-0 !h-full opacity-60" />
        <svg
          ref={svg}
          viewBox="0 0 255 255"
          className="absolute inset-0 size-full touch-none"
          onPointerDown={(e) => {
            const [x, y] = toPt(e);
            const near = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 12);
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            if (near >= 0) drag.current = near;
            else {
              const next = [...pts, [x, table[x] ?? y] as [number, number]].sort((a, b) => a[0] - b[0]);
              drag.current = next.findIndex((p) => p[0] === x);
              set(next);
            }
          }}
          onPointerMove={(e) => {
            if (drag.current === null) return;
            const [x, y] = toPt(e);
            const i = drag.current;
            const next = pts.map((p) => [...p] as [number, number]);
            const lo = i === 0 ? 0 : next[i - 1][0] + 1;
            const hi = i === next.length - 1 ? 255 : next[i + 1][0] - 1;
            next[i] = [i === 0 || i === next.length - 1 ? next[i][0] : Math.min(hi, Math.max(lo, x)), y];
            set(next);
          }}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={(e) => {
            const [x, y] = toPt(e as unknown as React.PointerEvent);
            const near = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 12);
            if (near > 0 && near < pts.length - 1) set(pts.filter((_, i) => i !== near));
          }}
        >
          {[64, 128, 192].map((v) => (
            <g key={v} stroke="var(--color-line)" strokeWidth={0.6}>
              <line x1={v} y1={0} x2={v} y2={255} />
              <line x1={0} y1={v} x2={255} y2={v} />
            </g>
          ))}
          <line x1={0} y1={255} x2={255} y2={0} stroke="var(--color-ink-3)" strokeWidth={0.6} strokeDasharray="3 3" />
          <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} />
          {pts.map((p, i) => (
            <rect key={i} x={p[0] - 3.5} y={255 - p[1] - 3.5} width={7} height={7} fill="var(--color-surface)" stroke={stroke} strokeWidth={1.4} />
          ))}
        </svg>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">Click the line to add a point, drag it to bend, double-click a point to remove it.</p>
    </div>
  );
}

/* ---------- Levels ---------- */

type Levels = { channel: "rgb" | "r" | "g" | "b"; inLo: number; inHi: number; gamma: number; outLo: number; outHi: number };

function LevelsEditor({ value, onChange, hist }: { value: Levels; onChange: (v: Levels) => void; hist: Hist | null }) {
  const set = (p: Partial<Levels>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-1">
      <div className="flex gap-1 pb-1">
        {(["rgb", "r", "g", "b"] as const).map((c) => (
          <button key={c} type="button" onClick={() => set({ channel: c })} className={cn("h-7 rounded-sm px-2.5 font-mono text-[12px] uppercase", value.channel === c ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
            {c}
          </button>
        ))}
      </div>
      <div className="relative rounded-sm border border-line bg-paper">
        <HistogramChart hist={hist} channel={value.channel === "rgb" ? "l" : value.channel} height={90} />
        {/* Where the black, grey and white points sit. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-full">
          {[value.inLo, value.inLo + (value.inHi - value.inLo) * Math.pow(0.5, value.gamma), value.inHi].map((v, i) => (
            <span key={i} className={cn("absolute bottom-0 h-full w-px", i === 1 ? "bg-ink-3" : "bg-ink")} style={{ left: `${(v / 255) * 100}%` }} />
          ))}
        </div>
      </div>
      <RangeRow label="Black point" value={value.inLo} min={0} max={Math.min(253, value.inHi - 2)} onChange={(v) => set({ inLo: v })} />
      <RangeRow label="Midtones (gamma)" value={value.gamma} min={0.1} max={4} step={0.01} onChange={(v) => set({ gamma: v })} />
      <RangeRow label="White point" value={value.inHi} min={Math.max(2, value.inLo + 2)} max={255} onChange={(v) => set({ inHi: v })} />
      <RangeRow label="Output black" value={value.outLo} min={0} max={255} onChange={(v) => set({ outLo: v })} />
      <RangeRow label="Output white" value={value.outHi} min={0} max={255} onChange={(v) => set({ outHi: v })} />
    </div>
  );
}

/* ---------- Any operation's settings ---------- */

function LutPickerRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const luts = useSyncExternalStore(subscribePhotoLuts, getPhotoLuts, getPhotoLuts);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-end gap-1.5">
        <Select
          label={label}
          value={luts.some((l) => l.id === value) ? value : luts[0]?.id ?? "kodak-2383"}
          onChange={onChange}
          options={luts.map((l) => ({ value: l.id, label: l.custom ? `${l.label} (.cube)` : l.label }))}
          className="min-w-0 flex-1"
        />
        <label className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-sm border border-line px-2.5 text-[12px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink">
          Load .cube
          <input
            type="file"
            accept=".cube,text/plain"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void file.text().then((txt) => {
                try {
                  const imported = importPhotoCubeFile(file.name, txt);
                  setErr(null);
                  onChange(imported.id);
                } catch (ex) {
                  setErr(ex instanceof Error ? ex.message : "Could not read .cube file.");
                }
              });
            }}
          />
        </label>
      </div>
      {err && <p className="text-[12px] text-accent">{err}</p>}
    </div>
  );
}

export function ParamsEditor({ op, value, onChange, hist }: { op: Op; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; hist: Hist | null }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  if (!op.params.length) return <p className="text-[13px] text-ink-3">No settings: it applies as it is.</p>;
  return (
    <div className="space-y-1.5">
      {op.params.map((p: Param) => {
        if (p.when && value[p.when[0]] !== p.when[1]) return null;
        switch (p.type) {
          case "range": {
            // A hue slider does nothing while its strength is 0, so moving it turns the strength up a little.
            const bump = p.bump && !Number(value[p.bump[0]]) ? { [p.bump[0]]: p.bump[1] } : {};
            return <RangeRow key={p.key} label={p.label} value={Number(value[p.key])} min={p.min} max={p.max} step={p.step} unit={p.unit} signed={p.min < 0} def={p.def} onChange={(v) => onChange({ ...value, [p.key]: v, ...bump })} />;
          }
          case "color":
            return (
              <div key={p.key} className="flex items-center justify-between py-1">
                <span className="text-[12px] text-ink-2">{p.label}</span>
                <ColorWell value={String(value[p.key])} onChange={(v) => set(p.key, v)} label={p.label} hex />
              </div>
            );
          case "toggle":
            return (
              <div key={p.key} className="py-1">
                <Check2 checked={Boolean(value[p.key])} onChange={(v) => set(p.key, v)} label={p.label} />
              </div>
            );
          case "choice":
            return (
              <div key={p.key} className="py-1">
                <p className="mb-1 text-[12px] text-ink-2">{p.label}</p>
                <div className="flex flex-wrap gap-1">
                  {p.options.map((o) => (
                    <button key={o.value} type="button" onClick={() => set(p.key, o.value)} className={cn("h-7 rounded-sm px-2.5 text-[12px]", value[p.key] === o.value ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          case "curve":
            return <CurvesEditor key={p.key} value={value[p.key] as Curves} onChange={(v) => set(p.key, v)} hist={hist} />;
          case "levels":
            return <LevelsEditor key={p.key} value={value[p.key] as Levels} onChange={(v) => set(p.key, v)} hist={hist} />;
          case "lut":
            return <LutPickerRow key={p.key} label={p.label} value={String(value[p.key] || p.def)} onChange={(v) => set(p.key, v)} />;
        }
      })}
    </div>
  );
}

/* ---------- Layer style ---------- */

export function EffectsEditor({ value, onChange }: { value: Effects; onChange: (v: Effects) => void }) {
  const set = <K extends keyof Effects>(k: K, p: Partial<Effects[K]>) => onChange({ ...value, [k]: { ...value[k], ...p } });
  const Section = ({ k, title, children }: { k: keyof Effects; title: string; children: React.ReactNode }) => (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-center justify-between">
        <Check2 checked={value[k].on} onChange={(on) => set(k, { on })} label={title} />
        <ColorWell value={value[k].color} onChange={(color) => set(k, { color })} label={`${title} colour`} size="size-6" />
      </div>
      {value[k].on && <div className="mt-1.5 pl-5">{children}</div>}
    </div>
  );
  return (
    <div>
      {Section({
        k: "shadow",
        title: "Drop shadow",
        children: (
          <>
            <RangeRow label="Opacity" value={value.shadow.opacity} min={0} max={100} unit="%" onChange={(opacity) => set("shadow", { opacity })} />
            <RangeRow label="Angle" value={value.shadow.angle} min={-180} max={180} unit="°" onChange={(angle) => set("shadow", { angle })} />
            <RangeRow label="Distance" value={value.shadow.distance} min={0} max={200} unit=" px" onChange={(distance) => set("shadow", { distance })} />
            <RangeRow label="Size" value={value.shadow.size} min={0} max={150} unit=" px" onChange={(size) => set("shadow", { size })} />
          </>
        ),
      })}
      {Section({
        k: "glow",
        title: "Outer glow",
        children: (
          <>
            <RangeRow label="Opacity" value={value.glow.opacity} min={0} max={100} unit="%" onChange={(opacity) => set("glow", { opacity })} />
            <RangeRow label="Size" value={value.glow.size} min={1} max={150} unit=" px" onChange={(size) => set("glow", { size })} />
          </>
        ),
      })}
      {Section({
        k: "stroke",
        title: "Stroke",
        children: <RangeRow label="Size" value={value.stroke.size} min={1} max={60} unit=" px" onChange={(size) => set("stroke", { size })} />,
      })}
      {Section({
        k: "overlay",
        title: "Color overlay",
        children: <RangeRow label="Opacity" value={value.overlay.opacity} min={0} max={100} unit="%" onChange={(opacity) => set("overlay", { opacity })} />,
      })}
    </div>
  );
}

/* ---------- Vector layer properties ---------- */

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 overflow-hidden rounded-sm border border-line">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn("h-7 px-2 text-[12px]", value === o.value ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The Properties tab for a vector layer: its paths (pick one to style it), and the selected
 * path's fill, stroke and line style. Changes go through `onChange` with the full path list.
 */
export function VectorPanel({
  paths,
  selected,
  onSelect,
  onChange,
  onEditPoints,
  onPen,
}: {
  paths: VPath[];
  selected: number;
  onSelect: (i: number) => void;
  onChange: (paths: VPath[], label: string, key?: string) => void;
  onEditPoints: () => void;
  onPen: () => void;
}) {
  const i = Math.min(Math.max(0, selected), paths.length - 1);
  const p = paths[i];
  if (!p) return <p className="text-[13px] text-ink-3">This vector layer is empty. Draw with the Pen (P).</p>;
  const set = (patch: Partial<VPath>, label = "Path Style", key = `vstyle:${p.id}`) => onChange(paths.map((q, j) => (j === i ? { ...q, ...patch } : q)), label, key);
  const nodes = p.subs.reduce((n, s) => n + s.nodes.length, 0);
  const closed = p.subs.every((s) => s.closed);
  return (
    <div className="space-y-3">
      <div className="rounded-sm border border-line">
        <p className="label-mono flex items-center gap-1.5 border-b border-line bg-paper px-2.5 py-1.5 text-ink-3">
          <PenTool aria-hidden className="size-3.5" /> Paths <span className="ml-auto tabular-nums">{paths.length}</span>
        </p>
        <ul className="max-h-36 overflow-y-auto py-0.5" data-lenis-prevent>
          {[...paths].reverse().map((q) => {
            const j = paths.indexOf(q);
            return (
              <li key={q.id}>
                <button type="button" onClick={() => onSelect(j)} aria-current={j === i} className={cn("flex h-8 w-full items-center gap-2 px-2.5 text-left text-[13px]", j === i ? "bg-paper-2 text-ink" : "text-ink-2 hover:bg-paper")}>
                  <span aria-hidden className="size-3.5 shrink-0 rounded-[3px] border" style={{ background: q.fill ?? "transparent", borderColor: q.stroke ?? "var(--color-line)", borderWidth: q.stroke ? 2 : 1 }} />
                  <span className="min-w-0 flex-1 truncate">{q.name || `Path ${j + 1}`}</span>
                  <span className="font-mono text-[12px] text-ink-3">{q.subs.reduce((n, s) => n + s.nodes.length, 0)} pt</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Btn onClick={onEditPoints}>Edit points</Btn>
        <Btn onClick={onPen}>
          <PenTool aria-hidden className="size-4" /> Pen
        </Btn>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Check2 checked={!!p.fill} onChange={(v) => set({ fill: v ? "#eb4a10" : null })} label="Fill" />
          {p.fill && <ColorWell value={p.fill} onChange={(fill) => set({ fill })} label="Fill colour" hex />}
        </div>
        <div className="flex items-center justify-between">
          <Check2 checked={!!p.stroke} onChange={(v) => set({ stroke: v ? "#15140f" : null, width: v && !p.width ? 2 : p.width })} label="Stroke" />
          {p.stroke && <ColorWell value={p.stroke} onChange={(stroke) => set({ stroke })} label="Stroke colour" hex />}
        </div>
        {p.stroke && <RangeRow label="Stroke width" value={Math.round(p.width * 10) / 10} min={0.5} max={100} step={0.5} unit=" px" onChange={(width) => set({ width })} />}
        <RangeRow label="Opacity" value={Math.round(p.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
      </div>

      {p.stroke && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-ink-2">Ends</span>
            <Segmented label="Line ends" value={p.cap} onChange={(cap) => set({ cap })} options={[{ value: "butt", label: "Flat" }, { value: "round", label: "Round" }, { value: "square", label: "Square" }]} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-ink-2">Corners</span>
            <Segmented label="Line corners" value={p.join} onChange={(join) => set({ join })} options={[{ value: "miter", label: "Sharp" }, { value: "round", label: "Round" }, { value: "bevel", label: "Bevel" }]} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Check2 checked={!!p.dash} onChange={(v) => set({ dash: v ? Math.max(2, Math.round(p.width * 3)) : null })} label="Dashed" />
          </div>
          {p.dash && <RangeRow label="Dash length" value={Math.round(p.dash)} min={1} max={200} unit=" px" onChange={(dash) => set({ dash })} />}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Check2 checked={closed} onChange={(v) => set({ subs: p.subs.map((s) => ({ ...s, closed: v })) }, v ? "Close Path" : "Open Path", undefined)} label="Closed path" />
        {p.fill && <Check2 checked={p.rule === "evenodd"} onChange={(v) => set({ rule: v ? "evenodd" : "nonzero" })} label="Holes (even-odd)" />}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <IconBtn label="Bring path forward" disabled={i === paths.length - 1} onClick={() => onChange(swap(paths, i, i + 1), "Arrange Path")}>
          <ArrowUp aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Send path backward" disabled={i === 0} onClick={() => onChange(swap(paths, i, i - 1), "Arrange Path")}>
          <ArrowDown aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Duplicate path" onClick={() => onChange([...paths.slice(0, i + 1), { ...p, id: `${p.id}c${Date.now().toString(36)}`, name: p.name ? `${p.name} copy` : undefined }, ...paths.slice(i + 1)], "Duplicate Path")}>
          <Copy aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Apply this style to every path" onClick={() => onChange(paths.map((q) => ({ ...q, fill: p.fill, stroke: p.stroke, width: p.width, opacity: p.opacity, cap: p.cap, join: p.join, dash: p.dash })), "Path Style")}>
          <Sparkles aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Delete path" disabled={paths.length < 2} onClick={() => onChange(paths.filter((_, j) => j !== i), "Delete Path")}>
          <Trash2 aria-hidden className="size-4" />
        </IconBtn>
        <span className="ml-auto self-center font-mono text-[12px] text-ink-3">{nodes} points</span>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">Edit points (A): drag points and handles, Alt-click a point to switch smooth/corner, double-click a line to add a point, Delete removes one.</p>
    </div>
  );
}

const swap = <T,>(a: T[], i: number, j: number) => {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};

export const PanelTitle = ({ children, icon: Icon = LayersIcon }: { children: React.ReactNode; icon?: typeof LayersIcon }) => (
  <p className="label-mono flex items-center gap-1.5 text-ink-3">
    <Icon aria-hidden className="size-3.5" />
    {children}
  </p>
);
