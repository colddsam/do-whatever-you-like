"use client";

import { capture } from "./controls";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileAudio, Keyboard as KeysIcon, Music4, SlidersHorizontal, SlidersVertical, Sparkles, Wrench, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Workbench } from "@/components/tools/workbench";
import { lastProject, openProject, saveProject, startAutosave } from "../engine/persistence";
import { transport } from "../engine/transport";
import { fromTemplate } from "../lib/templates";
import * as P from "../lib/project";
import { getStudio, useStudio, type LeftTab } from "../store";
import { Arrange } from "./arrange";
import { CreatePanel } from "./create-panel";
import { ExportDialog, ProjectsDialog, ShortcutsDialog } from "./dialogs";
import { BottomDock, ClipEditor } from "./dock";
import { Inspector } from "./inspector";
import { Keys, useMusicalTyping } from "./keys";
import { Mixer } from "./mixer";
import { SoundsPanel } from "./sounds-panel";
import { TopBar } from "./topbar";
import { ToolsPanel } from "./tools-panel";
import { LyricsPanel } from "./lyrics";

type Tier = "phone" | "tablet" | "desktop";
const tierOf = (): Tier => (typeof window === "undefined" ? "desktop" : window.innerWidth >= 1200 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "phone");
function useTier(): Tier {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("resize", fn);
      return () => window.removeEventListener("resize", fn);
    },
    tierOf,
    () => "desktop",
  );
}

const LEFT_TABS: { id: LeftTab; label: string; icon: LucideIcon }[] = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "sounds", label: "Sounds", icon: Music4 },
  { id: "tools", label: "Tools", icon: Wrench },
];

function LeftPanel() {
  const tab = useStudio((s) => s.leftTab);
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-raised">
      <div role="tablist" aria-label="Library" className="grid shrink-0 grid-cols-3 gap-0.5 border-b border-line-dark p-1">
        {LEFT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => getStudio().set({ leftTab: t.id })}
            className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-sm text-[12px] font-medium transition-colors", tab === t.id ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}
          >
            <t.icon aria-hidden className="size-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-lenis-prevent>
        <LeftBody tab={tab} />
      </div>
    </div>
  );
}

function LeftBody({ tab }: { tab: LeftTab }) {
  if (tab === "create") return <CreatePanel />;
  if (tab === "sounds") return <SoundsPanel />;
  return <ToolsPanel />;
}

type PhoneTab = "create" | "sounds" | "edit" | "mix" | "keys" | "tools" | "track";
const PHONE_DOCK: { id: PhoneTab; label: string; icon: LucideIcon }[] = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "sounds", label: "Sounds", icon: Music4 },
  { id: "edit", label: "Edit", icon: FileAudio },
  { id: "mix", label: "Mix", icon: SlidersVertical },
  { id: "keys", label: "Keys", icon: KeysIcon },
  { id: "track", label: "Track", icon: SlidersHorizontal },
  { id: "tools", label: "Tools", icon: Wrench },
];

function readNumber(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function Editor({ fullscreen, setFullscreen }: { fullscreen: boolean; setFullscreen: (f: boolean | ((x: boolean) => boolean)) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const tier = useTier();
  const ready = useStudio((s) => s.ready);
  const hasClips = useStudio((s) => Object.keys(s.project.clips).length > 0);
  const editorClip = useStudio((s) => s.editorClip);
  const [dialog, setDialog] = useState<"export" | "projects" | "help" | null>(null);
  const [exported, setExported] = useState(false);
  const [bottomH, setBottomH] = useState(() => readNumber("music:bottom-h", 300));
  const [tabletSide, setTabletSide] = useState<"library" | "inspector" | null>("library");
  const [phoneTab, setPhoneTab] = useState<PhoneTab | null>(null);
  const resize = useRef<{ start: number; val: number } | null>(null);
  useMusicalTyping();

  useEffect(() => {
    try {
      localStorage.setItem("music:bottom-h", String(Math.round(bottomH)));
    } catch {
      /* private mode */
    }
  }, [bottomH]);

  // Opening a clip on a phone shows its editor (adjusting state while rendering, React's pattern).
  const [seenClip, setSeenClip] = useState(editorClip);
  if (editorClip !== seenClip) {
    setSeenClip(editorClip);
    if (tier === "phone" && editorClip) setPhoneTab("edit");
  }

  type Keyish = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "target" | "preventDefault" | "stopPropagation">;
  const onKeyDown = (e: Keyish) => {
    if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable='true']")) return;
    const st = getStudio();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const take = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod) {
      const map: Record<string, () => void> = {
        z: () => (e.shiftKey ? st.redo() : st.undo()),
        y: () => st.redo(),
        d: () => st.duplicateSelection(),
        a: () => st.set({ selectedClips: Object.keys(st.project.clips) }),
        s: () => void saveProject(st.project).then(() => st.notify("Saved in this browser.", "success")),
      };
      if (map[k]) {
        take();
        map[k]();
      }
      return;
    }
    const map: Record<string, () => void> = {
      " ": () => void transport.toggle(),
      r: () => void transport.record().catch((err) => st.notify(err instanceof Error ? err.message : "Recording failed.", "danger")),
      l: () => st.commit((p) => ({ ...p, loop: { ...p.loop, end: p.loop.end > p.loop.start ? p.loop.end : p.loop.start + p.sig * 4, on: !p.loop.on } })),
      m: () => st.set({ metronome: !st.metronome }),
      s: () => st.splitAtPlayhead(),
      delete: () => st.deleteSelection(),
      backspace: () => st.deleteSelection(),
      home: () => void transport.seek(0),
      arrowleft: () => void transport.seek(Math.max(0, st.playhead - 1)),
      arrowright: () => void transport.seek(st.playhead + 1),
      "+": () => st.set({ zoom: Math.min(400, st.zoom * 1.4) }),
      "=": () => st.set({ zoom: Math.min(400, st.zoom * 1.4) }),
      "-": () => st.set({ zoom: Math.max(4, st.zoom / 1.4) }),
      f: () => setFullscreen((f) => !f),
      k: () => st.set({ typing: !st.typing }),
      "?": () => setDialog("help"),
      escape: () => (st.selectedClips.length ? st.set({ selectedClips: [] }) : fullscreen && setFullscreen(false)),
    };
    if (map[k]) {
      take();
      map[k]();
    }
  };

  // When a clicked control disappears (a dialog button, Apply), focus drops to <body>: keep the
  // shortcuts working while the studio is on screen, without stealing keys from the rest of the page.
  const keyRef = useRef(onKeyDown);
  useEffect(() => {
    keyRef.current = onKeyDown;
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const r = root.current?.getBoundingClientRect();
      if (!r || r.bottom < 80 || r.top > window.innerHeight - 80) return;
      root.current?.focus({ preventScroll: true });
      keyRef.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const steps = ["Create or record", "Arrange & mix", "Export"];
  const step = exported ? 3 : hasClips ? 1 : 0;

  return (
    <Workbench
      steps={steps}
      current={step}
      className={cn(fullscreen && "fixed inset-0 z-[100] flex flex-col rounded-none border-0 [&>ol]:hidden")}
      footer={
        fullscreen ? undefined : (
          <>Made in your browser: recordings, imports and mixes stay in this device&apos;s private storage and are never uploaded. Only AI song and lyric requests (your description) and voice text are sent to our server, which asks free AI services.</>
        )
      }
    >
      <div
        ref={root}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDownCapture={(e) => {
          // Start the sound engine on the first touch anywhere: a device's audio takes a moment
          // to wake (and iOS only allows it inside a gesture), so the first key or pad is instant.
          if (!transport.ctx || transport.ctx.state !== "running") void transport.ensure().catch(() => undefined);
          if (!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) root.current?.focus({ preventScroll: true });
        }}
        className={cn(
          "relative flex flex-col bg-ink text-paper outline-none",
          fullscreen ? "min-h-0 flex-1 safe-bottom" : "h-[calc(100dvh-116px)] min-h-[520px] sm:h-[calc(100dvh-96px)] md:h-[min(86dvh,1040px)] lg:h-[min(88dvh,1180px)]",
        )}
      >
        <TopBar fullscreen={fullscreen} onFullscreen={() => setFullscreen((f) => !f)} onExport={() => setDialog("export")} onProjects={() => setDialog("projects")} onHelp={() => setDialog("help")} phone={tier === "phone"} />

        {tier === "desktop" && (
          <div className="flex min-h-0 flex-1">
            <div className="w-[300px] shrink-0 border-r border-line-dark">
              <LeftPanel />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <Arrange />
              </div>
              <Splitter
                onDown={(y) => (resize.current = { start: y, val: bottomH })}
                onMove={(y) => resize.current && setBottomH(Math.max(140, Math.min((root.current?.clientHeight ?? 800) * 0.7, resize.current.val - (y - resize.current.start))))}
                onUp={() => (resize.current = null)}
              />
              <div className="shrink-0" style={{ height: bottomH }}>
                <BottomDock />
              </div>
            </div>
            <div className="w-[300px] shrink-0 border-l border-line-dark">
              <Inspector />
            </div>
          </div>
        )}

        {tier === "tablet" && (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <Arrange />
              </div>
              <Splitter
                onDown={(y) => (resize.current = { start: y, val: bottomH })}
                onMove={(y) => resize.current && setBottomH(Math.max(140, Math.min((root.current?.clientHeight ?? 800) * 0.65, resize.current.val - (y - resize.current.start))))}
                onUp={() => (resize.current = null)}
              />
              <div className="shrink-0" style={{ height: bottomH }}>
                <BottomDock />
              </div>
            </div>
            {tabletSide && (
              <div className="flex w-[320px] shrink-0 flex-col border-l border-line-dark bg-ink-raised">
                <div className="flex shrink-0 gap-0.5 border-b border-line-dark p-1">
                  {(["library", "inspector"] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setTabletSide(t)} className={cn("h-8 flex-1 rounded-sm text-[12px] font-medium", tabletSide === t ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}>
                      {t === "library" ? "Create & sounds" : "Track & effects"}
                    </button>
                  ))}
                  <button type="button" aria-label="Hide the side panel" onClick={() => setTabletSide(null)} className="inline-flex size-8 items-center justify-center rounded-sm text-paper-dim hover:text-paper">
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1">{tabletSide === "library" ? <LeftPanel /> : <Inspector />}</div>
              </div>
            )}
            {!tabletSide && (
              <button type="button" onClick={() => setTabletSide("library")} className="absolute right-2 top-[60px] z-30 inline-flex h-8 items-center gap-1.5 rounded-md bg-paper px-3 text-[12px] font-medium text-ink shadow-float">
                <Sparkles aria-hidden className="size-3.5" />
                Panels
              </button>
            )}
          </div>
        )}

        {tier === "phone" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={cn("min-h-0", phoneTab ? "h-[34%] min-h-[150px] shrink-0" : "flex-1")}>
              <Arrange compact />
            </div>
            {phoneTab && (
              <div className="flex min-h-0 flex-1 flex-col border-t border-line-dark bg-ink-raised">
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-dark px-3">
                  <span className="text-[13px] font-medium text-paper">{PHONE_DOCK.find((d) => d.id === phoneTab)?.label}</span>
                  <button type="button" onClick={() => setPhoneTab(null)} className="ml-auto h-8 rounded-sm px-2.5 text-[12px] font-medium text-accent hover:bg-paper/10">
                    Done
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-lenis-prevent>
                  {phoneTab === "create" && <CreatePanel />}
                  {phoneTab === "sounds" && <SoundsPanel />}
                  {phoneTab === "tools" && (
                    <>
                      <ToolsPanel />
                      <div className="h-[420px] border-t border-line-dark">
                        <LyricsPanel />
                      </div>
                    </>
                  )}
                  {phoneTab === "track" && <Inspector />}
                  {phoneTab === "edit" && (
                    <div className="h-full min-h-[300px]">
                      <ClipEditor />
                    </div>
                  )}
                  {phoneTab === "mix" && (
                    <div className="h-full min-h-[300px]">
                      <Mixer />
                    </div>
                  )}
                  {phoneTab === "keys" && (
                    <div className="h-full min-h-[240px]">
                      <Keys />
                    </div>
                  )}
                </div>
              </div>
            )}
            <nav aria-label="Studio panels" className="grid shrink-0 grid-cols-7 border-t border-line-dark bg-ink-raised safe-bottom">
              {PHONE_DOCK.map((t) => {
                const active = phoneTab === t.id;
                return (
                  <button key={t.id} type="button" aria-pressed={active} onClick={() => setPhoneTab((c) => (c === t.id ? null : t.id))} className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[12px] transition-colors", active ? "text-paper" : "text-paper-dim hover:text-paper")}>
                    {active && <span className="absolute inset-x-2 top-0 h-0.5 bg-accent" />}
                    <t.icon aria-hidden className="size-4" />
                    <span className="leading-none">{t.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        <Toasts />
        <JobsPill />
        {dialog === "export" && (
          <ExportDialog
            onClose={() => {
              setDialog(null);
              if (getStudio().toast?.tone === "success") setExported(true);
            }}
          />
        )}
        {dialog === "projects" && <ProjectsDialog onClose={() => setDialog(null)} />}
        {dialog === "help" && <ShortcutsDialog onClose={() => setDialog(null)} />}
        {!ready && (
          <div className="absolute inset-0 z-[80] flex items-center justify-center bg-ink">
            <p className="label-mono animate-pulse text-paper-dim">Opening your studio…</p>
          </div>
        )}
      </div>
    </Workbench>
  );
}

function Splitter({ onDown, onMove, onUp }: { onDown: (y: number) => void; onMove: (y: number) => void; onUp: () => void }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the bottom panel"
      className="h-1.5 shrink-0 cursor-row-resize touch-none bg-line-dark transition-colors hover:bg-accent/60"
      onPointerDown={(e) => {
        capture(e);
        onDown(e.clientY);
      }}
      onPointerMove={(e) => onMove(e.clientY)}
      onPointerUp={onUp}
    />
  );
}

function Toasts() {
  const toast = useStudio((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => getStudio().toast?.id === toast.id && getStudio().set({ toast: null }), toast.tone === "danger" || toast.tone === "warning" ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute bottom-16 left-1/2 z-[75] w-[min(92%,440px)] -translate-x-1/2 sm:bottom-4">
      <div className={cn("pointer-events-auto flex items-start gap-2 rounded-md border bg-ink-raised px-3 py-2 text-[13px] leading-snug text-paper shadow-float", toast.tone === "danger" ? "border-danger" : toast.tone === "warning" ? "border-warning" : toast.tone === "success" ? "border-success" : "border-line-dark")}>
        <span className="min-w-0 flex-1">{toast.text}</span>
        <button type="button" aria-label="Dismiss" onClick={() => getStudio().set({ toast: null })} className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-paper-dim hover:text-paper">
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Long jobs stay visible wherever you are in the studio. */
function JobsPill() {
  const jobs = useStudio((s) => s.jobs);
  const list = Object.entries(jobs);
  if (!list.length) return null;
  const [, job] = list[0];
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute left-3 top-[58px] z-[60] max-w-[min(80%,360px)] rounded-full border border-line-dark bg-ink-raised/95 px-3 py-1.5 shadow-float">
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="truncate text-[12px] text-paper">{job.label}</span>
        {job.progress !== undefined && <span className="font-mono text-[12px] text-paper-dim">{Math.round(job.progress * 100)}%</span>}
      </div>
    </div>
  );
}

/**
 * The music studio. Like the video editor, it renders into a host element that moves between
 * the page and <body> for full screen, so going full screen never restarts the audio engine.
 */
export function MusicStudio() {
  const [fullscreen, setFullscreen] = useState(false);
  const [host] = useState(() => document.createElement("div"));
  const slot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    (fullscreen ? document.body : slot.current)?.appendChild(host);
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
    // Development only: a handle for end-to-end tests (dropped from production builds).
    if (process.env.NODE_ENV !== "production") void Promise.all([import("../engine/dsp"), import("../engine/assets"), import("../engine/render"), import("../lib/templates"), import("../engine/composer"), import("../engine/instruments"), import("../engine/drums")]).then(([dsp, assets, render, templates, composer, instruments, drums]) => ((window as unknown as { __music?: unknown }).__music = { getStudio, transport, dsp, assets, render, templates, composer, instruments, drums }));
    // Render's free instance sleeps: wake it now so AI and voices answer quickly later.
    void fetch("/api/tools/wake", { cache: "no-store" }).catch(() => undefined);
    void (async () => {
      try {
        const p = (await lastProject()) ?? fromTemplate("demo");
        if (!alive) return;
        await openProject(p);
        await saveProject(p);
      } catch (e) {
        console.error("[music] couldn't open the last project", e);
        getStudio().load(P.emptyProject());
      } finally {
        getStudio().set({ ready: true });
        if (alive) stop = startAutosave();
      }
    })();
    return () => {
      alive = false;
      stop();
      void transport.stop(true);
    };
  }, []);

  return (
    <>
      <div ref={slot} />
      {createPortal(<Editor fullscreen={fullscreen} setFullscreen={setFullscreen} />, host)}
    </>
  );
}
