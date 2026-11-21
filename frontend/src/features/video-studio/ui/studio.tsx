"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Workbench } from "@/components/tools/workbench";
import { clamp } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, useStudio, type LeftTab } from "../store/studio-store";
import { freezeFrame } from "../engine/clip-tools";
import { openProject, startAutosave } from "../engine/persistence";
import { runJob } from "./ai-panel";
import { TopBar, Shortcuts, Toasts } from "./chrome";
import { ExportDialog } from "./export-dialog";
import { Inspector } from "./inspector";
import { LEFT_TABS, LeftPanel, LeftPanelBody } from "./left-panel";
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

type MobileTab = LeftTab | "inspector";

function Editor({ fullscreen, setFullscreen }: { fullscreen: boolean; setFullscreen: (f: boolean | ((x: boolean) => boolean)) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tier = useDeviceTier();
  const ready = useStudio((s) => s.ready);
  const hasClips = useStudio((s) => Object.keys(s.project.clips).length > 0);
  const [exportOpen, setExportOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [exported, setExported] = useState(false);
  const [timelineH, setTimelineH] = useState(() => readNumber("studio:timeline-h", 260));
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [leftW, setLeftW] = useState(() => readNumber("studio:left-w", 288));
  const [rightW, setRightW] = useState(() => readNumber("studio:right-w", 320));
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [tabletTab, setTabletTab] = useState<"library" | "inspector" | null>("library");
  const [mobileTab, setMobileTab] = useState<MobileTab | null>(null);
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
        if (st.selection.length || st.picking || st.tool !== "select") st.set({ selection: [], picking: null, tool: "select" });
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
            : "h-[calc(100dvh-68px)] min-h-[520px] md:h-[min(86dvh,1040px)] lg:h-[min(88dvh,1180px)] 2xl:h-[min(90dvh,1340px)]",
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
            <div className="flex min-h-[168px] flex-1 flex-col">
              <Preview />
            </div>
            <div role="tablist" aria-label="Panels" className="flex shrink-0 items-center overflow-x-auto no-scrollbar border-y border-line-dark bg-ink-raised" data-lenis-prevent>
              {[...LEFT_TABS, { id: "inspector" as const, label: "Edit" }].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === t.id}
                  onClick={() => {
                    setMobileTab((cur) => (cur === t.id ? null : t.id));
                    if (t.id !== "inspector") getStudio().set({ leftTab: t.id });
                  }}
                  className={cn("relative h-10 flex-auto shrink-0 whitespace-nowrap px-3 text-[13px]", mobileTab === t.id ? "text-paper" : "text-paper-dim")}
                >
                  {t.label}
                  {mobileTab === t.id && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />}
                </button>
              ))}
              <button
                type="button"
                aria-label={timelineCollapsed ? "Expand timeline" : "Collapse timeline"}
                onClick={() => setTimelineCollapsed((c) => !c)}
                className="inline-flex h-10 shrink-0 items-center gap-1 border-l border-line-dark px-2.5 text-[12px] text-paper-dim hover:text-paper"
              >
                {timelineCollapsed ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
                TL
              </button>
            </div>
            {mobileTab && <div className="h-[min(42dvh,300px)] min-h-[170px] shrink-0 bg-ink-raised">{mobileTab === "inspector" ? <Inspector /> : <LeftPanelBody tab={mobileTab} />}</div>}
          </div>
        )}

        {!(tier === "phone" && timelineCollapsed) && (
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
            <div className="shrink-0" style={{ height: tier === "phone" ? Math.min(timelineH, mobileTab ? 160 : 220) : timelineH }}>
              <Timeline />
            </div>
          </>
        )}
        <Toasts />
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
