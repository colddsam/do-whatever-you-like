"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Film, Music4, Pipette, SlidersHorizontal, Sparkles, Type, Wand2, X, type LucideIcon } from "lucide-react";
import { RichColorPicker } from "@/components/tools/design/rich-color-picker";
import { cn } from "@/lib/utils";
import { Workbench } from "@/components/tools/workbench";
import { clamp } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import { freezeFrame } from "../engine/clip-tools";
import { openProject, startAutosave } from "../engine/persistence";
import { runJob } from "./ai-panel";
import { TopBar, Shortcuts, Toasts } from "./chrome";
import { ExportDialog } from "./export-dialog";
import { Inspector } from "./inspector";
import { LeftPanel, LeftPanelBody, TransitionsPanel } from "./left-panel";
import { Preview } from "./preview";
import { Timeline } from "./timeline";

type DeviceTier = "phone" | "tablet" | "desktop";
function getTier(): DeviceTier {
  if (typeof window === "undefined") return "desktop";
  if (window.innerWidth >= 1200) return "desktop";
  if (window.innerWidth >= 768) return "tablet";
  return "phone";
}
function useDeviceTier(): DeviceTier {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("resize", fn);
      return () => window.removeEventListener("resize", fn);
    },
    getTier,
    () => "desktop",
  );
}

function readNumber(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

type MobileDockId = "media" | "inspector" | "text" | "effects" | "audio" | "ai";

const MOBILE_DOCK: { id: MobileDockId; label: string; title: string; icon: LucideIcon }[] = [
  { id: "media", label: "Media", title: "Media & Stock", icon: Film },
  { id: "inspector", label: "Edit", title: "Edit Clip & Canvas", icon: SlidersHorizontal },
  { id: "text", label: "Text", title: "Text & Shapes", icon: Type },
  { id: "effects", label: "Effects", title: "Effects & Transitions", icon: Wand2 },
  { id: "audio", label: "Audio", title: "Audio & Voices", icon: Music4 },
  { id: "ai", label: "AI", title: "AI Tools", icon: Sparkles },
];

function Editor({ fullscreen, setFullscreen }: { fullscreen: boolean; setFullscreen: (f: boolean | ((x: boolean) => boolean)) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tier = useDeviceTier();
  const ready = useStudio((s) => s.ready);
  const hasClips = useStudio((s) => Object.keys(s.project.clips).length > 0);
  const primaryClip = usePrimaryClip();
  const hasSel = useStudio((s) => s.selection.length > 0);
  const [exportOpen, setExportOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [exported, setExported] = useState(false);
  const [timelineH, setTimelineH] = useState(() => readNumber("studio:timeline-h", 260));
  const [leftW, setLeftW] = useState(() => readNumber("studio:left-w", 288));
  const [rightW, setRightW] = useState(() => readNumber("studio:right-w", 320));
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [tabletTab, setTabletTab] = useState<"library" | "inspector" | null>("library");
  const [mobileTab, setMobileTab] = useState<MobileDockId | null>(null);
  const [mobileFxSub, setMobileFxSub] = useState<"effects" | "transitions">("effects");
  const resize = useRef<{ kind: "tl" | "left" | "right"; start: number; val: number } | null>(null);

  // Going in or out of full screen moves the editor in the DOM, which drops keyboard focus to the
  // page: take it back so shortcuts keep working without a click.
  const wasFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (wasFullscreen.current === fullscreen) return;
    wasFullscreen.current = fullscreen;
    rootRef.current?.focus({ preventScroll: true });
  }, [fullscreen]);

  useEffect(() => {
    try {
      localStorage.setItem("studio:timeline-h", String(Math.round(timelineH)));
      localStorage.setItem("studio:left-w", String(Math.round(leftW)));
      localStorage.setItem("studio:right-w", String(Math.round(rightW)));
    } catch {
      /* private mode: fine */
    }
  }, [timelineH, leftW, rightW]);

  const fitTimeline = () => {
    const st = getStudio();
    const w = (rootRef.current?.clientWidth ?? 900) - 196;
    st.setZoom(w / Math.max(5, TL.projectDuration(st.project)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    const st = getStudio();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.toLowerCase();
    const take = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod) {
      if (e.altKey && lower === "c") {
        take();
        st.copyAttributes();
        return;
      }
      if (e.altKey && lower === "v") {
        take();
        st.pasteAttributes();
        return;
      }
      const actions: Record<string, () => void> = {
        z: () => (e.shiftKey ? st.redo() : st.undo()),
        y: st.redo,
        c: st.copySelection,
        v: st.paste,
        d: st.duplicateSelection,
        k: st.splitAtPlayhead,
        a: () => st.set({ selection: Object.keys(st.project.clips) }),
      };
      if (actions[lower]) {
        take();
        actions[lower]();
      }
      return;
    }
    switch (key) {
      case " ":
        take();
        st.togglePlay();
        return;
      case "ArrowLeft":
      case "ArrowRight": {
        take();
        const dir = key === "ArrowLeft" ? -1 : 1;
        if (e.altKey && st.selection.length) st.nudgeSelection(dir);
        else st.stepFrames(dir * (e.shiftKey ? st.project.settings.fps : 1));
        return;
      }
      case "ArrowUp":
      case "ArrowDown":
        take();
        st.set({ playing: false, playhead: TL.nextEdit(st.project, st.playhead, key === "ArrowUp" ? -1 : 1) });
        return;
      case "Home":
        take();
        st.set({ playing: false, playhead: 0 });
        return;
      case "End":
        take();
        st.set({ playing: false, playhead: TL.projectDuration(st.project) });
        return;
      case "Delete":
      case "Backspace":
        if (st.selection.length) {
          take();
          st.deleteSelection(e.shiftKey);
        }
        return;
      case "Escape":
        if (st.selection.length || st.picking || st.colorPickerOpen || st.tool !== "select") st.set({ selection: [], picking: null, colorPickerOpen: false, tool: "select" });
        else if (fullscreen) setFullscreen(false);
        return;
      case "+":
      case "=":
        take();
        st.setZoom(st.zoom * 1.4);
        return;
      case "-":
      case "_":
        take();
        st.setZoom(st.zoom / 1.4);
        return;
      case "\\":
        take();
        fitTimeline();
        return;
      case "?":
        take();
        setHelp(true);
        return;
    }
    if (e.altKey) {
      const alt: Record<string, () => void> = {
        m: () => st.jumpMarker(-1),
        x: () => {
          st.setInOut("in", null);
          st.setInOut("out", null);
        },
      };
      if (alt[lower]) {
        take();
        alt[lower]();
      }
      return;
    }
    if (e.shiftKey) {
      const shifted: Record<string, () => void> = {
        c: () => st.set({ compare: !st.compare }),
        s: () => {
          st.set({ snapping: !st.snapping });
          st.notify(`Snapping ${st.snapping ? "off" : "on"}.`, "info");
        },
        i: () => st.set({ colorPickerOpen: !st.colorPickerOpen }),
        m: () => st.jumpMarker(1),
        f: () => {
          const c = st.selection.map((id) => st.project.clips[id]).find((x) => x?.kind === "video");
          if (!c) return st.notify("Select a video clip to freeze a frame of it.", "info");
          void runJob("cliptool", "Capturing the frame", () => freezeFrame(c.id));
        },
        h: () => st.selection.length && st.flip(st.selection, "v"),
      };
      if (shifted[lower]) {
        take();
        shifted[lower]();
      }
      return;
    }
    const letters: Record<string, () => void> = {
      v: () => st.set({ tool: "select" }),
      c: () => st.set({ tool: "blade" }),
      b: () => st.set({ tool: "ripple" }),
      n: () => st.set({ tool: "roll" }),
      y: () => st.set({ tool: "slip" }),
      u: () => st.set({ tool: "slide" }),
      r: () => st.set({ tool: "rate" }),
      s: st.splitAtPlayhead,
      m: st.addMarker,
      i: () => st.setInOut("in", st.playhead),
      o: () => st.setInOut("out", st.playhead),
      h: () => st.selection.length && st.flip(st.selection, "h"),
      // J/K/L shuttle: L plays and speeds up, K stops, J slows down (or steps back a second).
      k: () => st.set({ playing: false, rate: 1 }),
      l: () => (st.playing ? st.set({ rate: Math.min(4, st.rate * 2) }) : st.set({ playing: true, rate: 1 })),
      j: () => (st.playing && st.rate > 1 ? st.set({ rate: st.rate / 2 }) : st.set({ playing: false, rate: 1, playhead: Math.max(0, st.playhead - 1) })),
      f: () => setFullscreen((f) => !f),
    };
    if (letters[lower]) {
      take();
      letters[lower]();
    }
  };

  const steps = ["Import media", "Edit on the timeline", "Export the video"];
  const step = exported ? 3 : hasClips ? 1 : 0;

  return (
    <Workbench
      steps={steps}
      current={step}
      className={cn(fullscreen && "fixed inset-0 z-[100] flex flex-col rounded-none border-0 [&>ol]:hidden")}
      footer={
        fullscreen ? undefined : (
          <>
            Made in your browser: your videos, sound and pictures are kept in this device&apos;s private storage and never uploaded, and the AI (captions, cut-outs, silence) runs here too. Only an AI Director request (what you type, plus clip names and times) is sent to our server.
          </>
        )
      }
    >
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDownCapture={(e) => {
          if (!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) rootRef.current?.focus({ preventScroll: true });
        }}
        className={cn(
          "relative flex flex-col bg-ink text-paper outline-none",
          fullscreen
            ? "min-h-0 flex-1 safe-bottom"
            : "h-[calc(100dvh-116px)] min-h-[480px] sm:h-[calc(100dvh-96px)] md:h-[min(86dvh,1040px)] lg:h-[min(88dvh,1180px)] 2xl:h-[min(90dvh,1340px)]",
        )}
      >
        <TopBar
          fullscreen={fullscreen}
          onFullscreen={() => setFullscreen((f) => !f)}
          onExport={() => setExportOpen(true)}
          onHelp={() => setHelp(true)}
          tier={tier}
          leftOpen={leftOpen}
          rightOpen={tier === "desktop" ? rightOpen : tabletTab !== null}
          onToggleLeft={() => setLeftOpen((o) => !o)}
          onToggleRight={() => (tier === "desktop" ? setRightOpen((o) => !o) : setTabletTab((t) => (t ? null : "inspector")))}
        />
        {tier === "desktop" && (
          <div className="flex min-h-0 flex-1">
            {leftOpen && (
              <>
                <div className="shrink-0 border-r border-line-dark" style={{ width: leftW }}>
                  <LeftPanel />
                </div>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize library panel"
                  className="w-1 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-accent/60"
                  onPointerDown={(e) => {
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    resize.current = { kind: "left", start: e.clientX, val: leftW };
                  }}
                  onPointerMove={(e) => {
                    const r = resize.current;
                    if (!r || r.kind !== "left") return;
                    setLeftW(clamp(r.val + (e.clientX - r.start), 236, 440));
                  }}
                  onPointerUp={() => (resize.current = null)}
                />
              </>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <Preview />
            </div>
            {rightOpen && (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize inspector panel"
                  className="w-1 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-accent/60"
                  onPointerDown={(e) => {
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    resize.current = { kind: "right", start: e.clientX, val: rightW };
                  }}
                  onPointerMove={(e) => {
                    const r = resize.current;
                    if (!r || r.kind !== "right") return;
                    setRightW(clamp(r.val - (e.clientX - r.start), 270, 480));
                  }}
                  onPointerUp={() => (resize.current = null)}
                />
                <div className="shrink-0 border-l border-line-dark" style={{ width: rightW }}>
                  <Inspector />
                </div>
              </>
            )}
          </div>
        )}

        {tier === "tablet" && (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <Preview />
            </div>
            {tabletTab !== null && (
              <div className="flex w-[304px] shrink-0 flex-col border-l border-line-dark bg-ink-raised md:w-[328px]">
                <div className="flex shrink-0 border-b border-line-dark p-1">
                  <button
                    type="button"
                    onClick={() => setTabletTab("library")}
                    className={cn("h-8 flex-1 rounded-sm text-[12px] font-medium transition-colors", tabletTab === "library" ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}
                  >
                    Library & FX
                  </button>
                  <button
                    type="button"
                    onClick={() => setTabletTab("inspector")}
                    className={cn("h-8 flex-1 rounded-sm text-[12px] font-medium transition-colors", tabletTab === "inspector" ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}
                  >
                    Inspector
                  </button>
                </div>
                <div className="min-h-0 flex-1">{tabletTab === "inspector" ? <Inspector /> : <LeftPanel />}</div>
              </div>
            )}
          </div>
        )}

        {tier === "phone" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={cn("flex min-h-0 flex-col", mobileTab ? "h-[38%] min-h-[176px] max-h-[260px] shrink-0" : "min-h-[180px] flex-1")}>
              <Preview compact />
            </div>
            {mobileTab ? (
              <div className="flex min-h-0 flex-1 flex-col border-t border-line-dark bg-ink-raised">
                <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-dark px-3">
                  {(() => {
                    const activeDock = MOBILE_DOCK.find((d) => d.id === mobileTab)!;
                    const ActiveDockIcon = activeDock.icon;
                    return (
                      <>
                        <ActiveDockIcon aria-hidden className="size-4 shrink-0 text-accent" />
                        <span className="truncate text-[13px] font-medium text-paper">{activeDock.title}</span>
                      </>
                    );
                  })()}
                  {hasSel && mobileTab !== "inspector" && (
                    <button
                      type="button"
                      onClick={() => setMobileTab("inspector")}
                      className="ml-auto inline-flex h-8 max-w-[140px] items-center gap-1 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper"
                    >
                      <SlidersHorizontal aria-hidden className="size-3 shrink-0 text-accent" />
                      <span className="truncate">{primaryClip ? `Edit ${primaryClip.name}` : "Edit clip"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMobileTab(null)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center rounded-sm px-2.5 text-[12px] font-medium text-accent hover:bg-paper/10",
                      !(hasSel && mobileTab !== "inspector") && "ml-auto",
                    )}
                  >
                    Done
                  </button>
                </div>
                {mobileTab === "effects" && (
                  <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-line-dark bg-ink px-3 py-1.5">
                    <button
                      type="button"
                      aria-pressed={mobileFxSub === "effects"}
                      onClick={() => setMobileFxSub("effects")}
                      className={cn("h-8 rounded-sm text-[12px] transition-colors", mobileFxSub === "effects" ? "bg-paper font-medium text-ink" : "text-paper-dim hover:bg-paper/10 hover:text-paper")}
                    >
                      Effects & LUTs
                    </button>
                    <button
                      type="button"
                      aria-pressed={mobileFxSub === "transitions"}
                      onClick={() => setMobileFxSub("transitions")}
                      className={cn("h-8 rounded-sm text-[12px] transition-colors", mobileFxSub === "transitions" ? "bg-paper font-medium text-ink" : "text-paper-dim hover:bg-paper/10 hover:text-paper")}
                    >
                      Transitions
                    </button>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  {mobileTab === "inspector" ? <Inspector /> : mobileTab === "effects" && mobileFxSub === "transitions" ? <TransitionsPanel /> : <LeftPanelBody tab={mobileTab} />}
                </div>
              </div>
            ) : (
              <div className="h-[clamp(192px,34dvh,268px)] shrink-0 border-t border-line-dark">
                <Timeline compact onEditSelected={() => setMobileTab("inspector")} />
              </div>
            )}
            <nav aria-label="Editor tools" className="grid shrink-0 grid-cols-6 border-t border-line-dark bg-ink-raised safe-bottom">
              {MOBILE_DOCK.map((t) => {
                const active = mobileTab === t.id;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setMobileTab((cur) => (cur === t.id ? null : t.id));
                      if (t.id !== "inspector") getStudio().set({ leftTab: t.id });
                    }}
                    className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[12px] transition-colors", active ? "text-paper" : "text-paper-dim hover:text-paper")}
                  >
                    {active && <span className="absolute inset-x-3 top-0 h-0.5 bg-accent" />}
                    <span className="relative">
                      <Icon aria-hidden className="size-4" />
                      {t.id === "inspector" && hasSel && <span aria-hidden className="absolute -right-1.5 -top-1 size-2 rounded-full bg-accent" />}
                    </span>
                    <span className="leading-none">{t.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {tier !== "phone" && (
          <>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the timeline"
              tabIndex={0}
              className="group relative z-10 h-1.5 shrink-0 cursor-row-resize touch-none bg-line-dark hover:bg-accent/60 focus-visible:bg-accent max-md:h-2"
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                resize.current = { kind: "tl", start: e.clientY, val: timelineH };
              }}
              onPointerMove={(e) => {
                const r = resize.current;
                if (!r || r.kind !== "tl") return;
                const max = (rootRef.current?.clientHeight ?? 800) * 0.7;
                setTimelineH(clamp(r.val - (e.clientY - r.start), 132, max));
              }}
              onPointerUp={() => (resize.current = null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  e.stopPropagation();
                  setTimelineH((h) => clamp(h + (e.key === "ArrowUp" ? 24 : -24), 132, (rootRef.current?.clientHeight ?? 800) * 0.7));
                }
              }}
            />
            <div className="shrink-0" style={{ height: timelineH }}>
              <Timeline />
            </div>
          </>
        )}
        <Toasts />
        <ColorPickerDrawer />
        {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} onDone={() => setExported(true)} />}
        {help && <Shortcuts onClose={() => setHelp(false)} />}
        {!ready && (
          <div className="absolute inset-0 z-[80] flex items-center justify-center bg-ink">
            <p className="label-mono animate-pulse text-paper-dim">Opening your project…</p>
          </div>
        )}
      </div>
    </Workbench>
  );
}

/**
 * The video editor. It renders into a host element that moves between its place on the page and
 * <body> for full screen, so going full screen never remounts the editor (the WebGL canvas, the
 * playback engine and the AI worker all survive it).
 */
export function VideoStudio() {
  const [fullscreen, setFullscreen] = useState(false);
  const [host] = useState(() => document.createElement("div"));
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    (fullscreen ? document.body : slotRef.current)?.appendChild(host);
    if (!fullscreen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [fullscreen, host]);
  useEffect(() => () => host.remove(), [host]);

  useEffect(() => {
    let alive = true;
    let stop = () => {};
    // Render's free instance sleeps; wake it now so the AI Director and the stock proxy answer quickly.
    void fetch("/api/tools/wake", { cache: "no-store" }).catch(() => undefined);
    void openProject()
      .catch((e) => {
        console.error("[studio] couldn't open the project", e);
        getStudio().set({ ready: true });
      })
      .then(() => {
        if (alive) stop = startAutosave();
      });
    return () => {
      alive = false;
      stop();
      getStudio().set({ playing: false });
    };
  }, []);

  return (
    <>
      <div ref={slotRef} />
      {createPortal(<Editor fullscreen={fullscreen} setFullscreen={setFullscreen} />, host)}
    </>
  );
}

function ColorPickerDrawer() {
  const open = useStudio((s) => s.colorPickerOpen);
  const pickedColor = useStudio((s) => s.pickedColor);
  const recentColors = useStudio((s) => s.recentColors);
  const sampleSize = useStudio((s) => s.sampleSize);
  const picking = useStudio((s) => s.picking?.kind === "picker");
  const clip = usePrimaryClip();
  const st = getStudio();

  if (!open) return null;

  const chromaFx = clip?.effects.find((e) => e.type === "chromaKey");
  const canApply = clip && (chromaFx || clip.kind === "text" || clip.kind === "shape" || clip.kind === "solid");
  const applyTargetLabel = chromaFx
    ? "Apply to Chroma Key"
    : clip?.kind === "text"
      ? "Apply to Text"
      : clip?.kind === "shape"
        ? "Apply to Shape"
        : clip?.kind === "solid"
          ? "Apply to Solid"
          : null;

  const applyToClip = () => {
    if (!clip) return;
    st.addRecentColor(pickedColor);
    if (chromaFx) {
      st.updateEffect(clip.id, chromaFx.id, { options: { ...chromaFx.options, color: pickedColor } });
      st.notify(`Chroma Key colour set to ${pickedColor.toUpperCase()}.`, "success");
    } else if (clip.kind === "text") {
      st.updateText(clip.id, { color: pickedColor });
      st.notify(`Text colour set to ${pickedColor.toUpperCase()}.`, "success");
    } else if (clip.kind === "shape" && clip.shape) {
      st.updateClip(clip.id, (x) => ({ ...x, shape: x.shape ? { ...x.shape, fill: pickedColor } : undefined }));
      st.notify(`Shape fill set to ${pickedColor.toUpperCase()}.`, "success");
    } else if (clip.kind === "solid") {
      st.updateClip(clip.id, { color: pickedColor });
      st.notify(`Solid colour set to ${pickedColor.toUpperCase()}.`, "success");
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Color Picker"
      className="fixed bottom-16 right-4 z-[95] w-[280px] rounded-lg border border-line-dark bg-ink-raised p-3 text-paper shadow-float sm:bottom-auto sm:top-16"
      data-lenis-prevent
    >
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-line-dark pb-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-paper">
          <Pipette aria-hidden className="size-3.5 text-accent" />
          Color Picker
        </span>
        <button
          type="button"
          aria-label="Close Color Picker"
          onClick={() => st.set({ colorPickerOpen: false, ...(picking ? { picking: null } : {}) })}
          className="inline-flex size-6 items-center justify-center rounded-sm text-paper-dim hover:bg-paper/10 hover:text-paper"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      <RichColorPicker
        theme="dark"
        compact
        value={pickedColor}
        onChange={(hex) => st.set({ pickedColor: hex })}
        onCommit={(hex) => st.addRecentColor(hex)}
        onEyedropper={() => st.set({ picking: picking ? null : { kind: "picker" } })}
        eyedropperActive={picking}
        eyedropperLabel="Sample colour from preview (click preview frame)"
      />
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line-dark pt-2">
        <span className="font-mono text-[11px] uppercase text-paper-dim">Sample</span>
        <div className="inline-flex overflow-hidden rounded-sm border border-line-dark">
          {([1, 3, 5] as const).map((sz) => (
            <button
              key={sz}
              type="button"
              aria-pressed={sampleSize === sz}
              onClick={() => st.set({ sampleSize: sz })}
              className={cn("h-6 px-2 font-mono text-[11px]", sampleSize === sz ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}
            >
              {sz === 1 ? "1px" : `${sz}×${sz}`}
            </button>
          ))}
        </div>
      </div>
      {recentColors.length > 0 && (
        <div className="mt-2 space-y-1">
          <span className="font-mono text-[11px] uppercase text-paper-dim">Recent</span>
          <div className="flex flex-wrap gap-1">
            {recentColors.map((c) => (
              <button
                key={c}
                type="button"
                title={c.toUpperCase()}
                onClick={() => st.set({ pickedColor: c })}
                className={cn("size-5 rounded-sm border", c === pickedColor ? "border-paper ring-1 ring-paper/50" : "border-line-dark")}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      )}
      {canApply && applyTargetLabel && (
        <button
          type="button"
          onClick={applyToClip}
          className="mt-2.5 inline-flex h-8 w-full items-center justify-center rounded-sm bg-paper px-3 text-[12px] font-medium text-ink hover:bg-paper/90"
        >
          {applyTargetLabel}
        </button>
      )}
    </div>
  );
}
