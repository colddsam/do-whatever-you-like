"use client";

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Activity, Download, Keyboard, Maximize2, Minimize2, PanelLeft, PanelRight, Pipette, Redo2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASPECTS } from "../constants";
import { getStudio, useStudio } from "../store/studio-store";
import type { AspectId } from "../types";
import { IconButton, Select } from "./controls";

export function TopBar({
  fullscreen,
  onFullscreen,
  onExport,
  onHelp,
  tier = "desktop",
  leftOpen = true,
  rightOpen = true,
  onToggleLeft,
  onToggleRight,
}: {
  fullscreen: boolean;
  onFullscreen: () => void;
  onExport: () => void;
  onHelp: () => void;
  tier?: "phone" | "tablet" | "desktop";
  leftOpen?: boolean;
  rightOpen?: boolean;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}) {
  const { name, canUndo, canRedo, saveState, aspect, busy, scopes, colorPickerOpen } = useStudio(
    useShallow((s) => ({
      name: s.project.name,
      canUndo: s.past.length > 0,
      canRedo: s.future.length > 0,
      saveState: s.saveState,
      aspect: s.project.settings.aspect,
      busy: Object.keys(s.jobs).length > 0,
      scopes: s.scopes,
      colorPickerOpen: s.colorPickerOpen,
    })),
  );
  const st = getStudio();
  const phone = tier === "phone";
  return (
    <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line-dark bg-ink-raised px-2 sm:h-11 sm:gap-1">
      {tier === "desktop" && onToggleLeft && (
        <IconButton label={leftOpen ? "Hide library panel" : "Show library panel"} active={leftOpen} onClick={onToggleLeft}>
          <PanelLeft aria-hidden className="size-4" />
        </IconButton>
      )}
      <span aria-hidden className="mr-1 hidden size-2 shrink-0 rounded-full bg-accent sm:block" />
      <input
        aria-label="Project name"
        value={name}
        onChange={(e) => st.rename(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-9 min-w-[78px] flex-1 max-w-[160px] rounded-sm border border-transparent bg-transparent px-1 text-[13px] font-medium text-paper outline-none hover:border-line-dark focus-visible:border-accent sm:h-8 sm:max-w-[220px] sm:px-1.5 sm:text-[14px]"
      />
      <span className={cn("label-mono hidden shrink-0 lg:inline", saveState === "error" ? "text-danger" : "text-paper-dim")} aria-live="polite">
        {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved here"}
      </span>
      <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo || busy} onClick={() => st.undo()} className="max-sm:size-8 sm:ml-1">
        <Undo2 aria-hidden className="size-4" />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo || busy} onClick={() => st.redo()} className="max-sm:size-8">
        <Redo2 aria-hidden className="size-4" />
      </IconButton>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <Select<AspectId>
          label="Frame aspect ratio"
          value={aspect}
          onChange={(v) => st.setAspect(v)}
          options={(Object.keys(ASPECTS) as AspectId[]).map((a) => ({ value: a, label: a }))}
          className="h-8 w-[62px] flex-none sm:h-7 sm:w-[72px]"
        />
        {!phone && (
          <>
            <IconButton label="Color picker & eyedropper (Shift+I)" active={colorPickerOpen} onClick={() => st.set({ colorPickerOpen: !colorPickerOpen })}>
              <Pipette aria-hidden className="size-4" />
            </IconButton>
            <IconButton label="Video scopes (Waveform, RGB Parade, Histogram, Vectorscope)" active={scopes} onClick={() => st.set({ scopes: !scopes })}>
              <Activity aria-hidden className="size-4" />
            </IconButton>
          </>
        )}
        <IconButton label="Keyboard shortcuts (?)" onClick={onHelp} className="max-sm:hidden">
          <Keyboard aria-hidden className="size-4" />
        </IconButton>
        {(tier === "desktop" || tier === "tablet") && onToggleRight && (
          <IconButton label={rightOpen ? "Hide side panel" : "Show side panel"} active={rightOpen} onClick={onToggleRight}>
            <PanelRight aria-hidden className="size-4" />
          </IconButton>
        )}
        <IconButton label={fullscreen ? "Exit full screen (F)" : "Full screen (F)"} onClick={onFullscreen} className="max-sm:size-8">
          {fullscreen ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
        </IconButton>
        <button type="button" onClick={onExport} className="ml-0.5 inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-paper px-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper/85 sm:ml-1 sm:h-8 sm:gap-1.5 sm:px-3">
          <Download aria-hidden className="size-4" />
          <span>Export</span>
        </button>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Playback",
    [
      ["Space", "Play / pause"],
      ["L", "Play; again for 2× and 4×"],
      ["K", "Pause (and back to 1×)"],
      ["J", "Slower, or back one second"],
      ["← →", "One frame"],
      ["Shift ← →", "One second"],
      ["↑ ↓", "Previous / next cut"],
      ["Shift M · Alt M", "Next / previous marker"],
      ["Home · End", "Start · end"],
      ["I · O", "Set In · Out (loop and export range)"],
      ["Alt X", "Clear In and Out"],
    ],
  ],
  [
    "Tools",
    [
      ["V", "Selection"],
      ["C", "Razor (cut)"],
      ["B", "Ripple edit"],
      ["N", "Roll edit"],
      ["Y", "Slip"],
      ["U", "Slide"],
      ["R", "Rate stretch"],
      ["Shift I", "Color picker / Eyedropper"],
      ["Shift S", "Snapping on/off"],
    ],
  ],
  [
    "Editing",
    [
      ["S · Ctrl K", "Split at the playhead"],
      ["Delete", "Delete"],
      ["Shift Delete", "Ripple delete (close the gap)"],
      ["Alt ← →", "Nudge selected clips a frame"],
      ["Ctrl C · Ctrl V", "Copy · paste at the playhead"],
      ["Ctrl Alt C · V", "Copy · paste clip effects & transforms"],
      ["Shift C", "Before / after split grade wipe"],
      ["Ctrl D", "Duplicate after itself"],
      ["Ctrl A", "Select everything"],
      ["Ctrl Z · Ctrl Shift Z", "Undo · redo"],
      ["Shift F", "Freeze frame (2 s)"],
      ["H · Shift H", "Flip horizontally · vertically"],
      ["Alt + click", "Select one half of a linked pair"],
      ["Right-click", "Clip menu"],
      ["M", "Add a marker"],
    ],
  ],
  [
    "View",
    [
      ["+ −", "Zoom the timeline"],
      ["Ctrl + wheel", "Zoom where the pointer is"],
      ["\\", "Fit the timeline"],
      ["F", "Full screen"],
      ["Esc", "Deselect"],
      ["?", "This list"],
    ],
  ],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-ink/80 p-3 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="max-h-full w-full max-w-4xl overflow-y-auto rounded-lg border border-line-dark bg-ink-raised p-4 shadow-float" onClick={(e) => e.stopPropagation()} data-lenis-prevent>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-paper">
            Keyboard <span className="serif-em">shortcuts</span>
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SHORTCUTS.map(([group, list]) => (
            <div key={group}>
              <p className="label-mono mb-2 text-paper-dim">{group}</p>
              <dl className="space-y-1.5">
                {list.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 rounded-sm border border-line-dark px-1.5 font-mono text-[12px] text-paper">{k}</dt>
                    <dd className="text-right text-[12px] text-paper-dim">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toast = useStudio((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (getStudio().toast?.id === toast.id) getStudio().set({ toast: null });
    }, toast.tone === "danger" ? 8000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute bottom-3 left-1/2 z-[70] w-[min(92%,420px)] -translate-x-1/2">
      <div
        className={cn(
          "pointer-events-auto flex items-start gap-2 rounded-md border bg-ink-raised px-3 py-2 text-[13px] leading-snug text-paper shadow-float",
          toast.tone === "danger" ? "border-danger" : toast.tone === "warning" ? "border-warning" : toast.tone === "success" ? "border-success" : "border-line-dark",
        )}
      >
        <span className="min-w-0 flex-1">{toast.text}</span>
        <button type="button" aria-label="Dismiss" onClick={() => getStudio().set({ toast: null })} className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-paper-dim hover:text-paper">
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
