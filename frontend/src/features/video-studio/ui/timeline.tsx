"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AudioLines,
  BetweenHorizontalStart,
  Bookmark,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Ellipsis,
  Eye,
  EyeOff,
  Film,
  FlipHorizontal2,
  Gauge,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  Link2,
  Link2Off,
  Lock,
  LockOpen,
  Magnet,
  Plus,
  Rewind,
  Scissors,
  Shapes,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  SquareSplitHorizontal,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFECTS, SNAP_PX, ZOOM_MAX, ZOOM_MIN } from "../constants";
import { evalAnim } from "../lib/keyframes";
import { animatedPaths, getAnim } from "../lib/props";
import { srcOffset } from "../lib/speed";
import { frameRound, timecode } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, useStudio, type Tool } from "../store/studio-store";
import type { Clip, EffectType, Project, Track, TrackKind } from "../types";
import { freezeFrame, rasterizeClip, reverseClip } from "../engine/clip-tools";
import { importFiles } from "../engine/importer";
import { mediaRuntime } from "../engine/media";
import { runJob } from "./ai-panel";
import { TOOL_ICON } from "./catalog";
import { IconButton } from "./controls";
import { canTake, EFFECT_MIME } from "./effects-panel";

const RULER_H = 28;
const TRACK_H: Record<TrackKind, number> = { video: 60, overlay: 46, audio: 54 };
const MEDIA_MIME = "application/x-studio-media";

function readHeaderW() {
  if (typeof window === "undefined") return 156;
  return window.innerWidth < 640 ? 64 : window.innerWidth < 1024 ? 120 : 156;
}
function useHeaderW() {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("resize", fn);
      return () => window.removeEventListener("resize", fn);
    },
    readHeaderW,
    () => 156,
  );
}

type View = { left: number; width: number };
type MoveDrag = { kind: "move"; grabbed: string; ids: string[]; x0: number; y0: number; starts: Record<string, number>; tracks: Record<string, string>; moved: boolean };
type TrimDrag = { kind: "trim"; id: string; edge: TL.TrimEdge };
/** Pro-tool gestures: each move recomputes from the project as it was when the drag began. */
type ToolDrag =
  | { kind: "ripple"; id: string; edge: TL.TrimEdge }
  | { kind: "rate"; id: string; edge: TL.TrimEdge }
  | { kind: "roll"; left: string; right: string }
  | { kind: "slip"; id: string; x0: number }
  | { kind: "slide"; id: string; x0: number };
type Marquee = { x0: number; y0: number; x1: number; y1: number; additive: boolean; base: string[] };
/** A move in progress, as state (render reads this, never the drag ref). */
type Ghost = { dt: number; target: string; snapAt: number | null; grabbed: string; ids: string[]; starts: Record<string, number>; tracks: Record<string, string> };
type Menu = { x: number; y: number; clipId: string };

const useMediaVersion = () => useSyncExternalStore(mediaRuntime.subscribe, mediaRuntime.version, () => 0);

function trackLabels(tracks: Track[]) {
  const out: Record<string, string> = {};
  const count: Record<TrackKind, number> = { video: 0, overlay: 0, audio: 0 };
  // Visual tracks are numbered bottom-up (V1 is the lowest), audio top-down, as in Premiere.
  for (let i = tracks.length - 1; i >= 0; i--) {
    const t = tracks[i];
    if (t.kind !== "audio") out[t.id] = `${t.kind === "video" ? "V" : "T"}${++count[t.kind]}`;
  }
  for (const t of tracks) if (t.kind === "audio") out[t.id] = `A${++count.audio}`;
  return out;
}

/* ---------- Ruler ---------- */

const STEPS = [1, 2, 5, 10, 15];
function rulerStep(zoom: number, fps: number) {
  for (const f of STEPS) if ((f / fps) * zoom >= 80) return f / fps;
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]) if (s * zoom >= 80) return s;
  return 7200;
}

/** Ruler labels: mm:ss for whole seconds (hh:mm:ss past an hour), ss:ff when ticks fall between seconds. */
function rulerLabel(t: number, step: number, fps: number) {
  const [hh, mm, ss, ff] = timecode(t, fps).split(":");
  if (step < 1) return `${ss}:${ff}`;
  return hh === "00" ? `${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

const Ruler = memo(function Ruler({
  zoom,
  fps,
  width,
  view,
  markers,
  inPoint,
  outPoint,
  onScrub,
}: {
  zoom: number;
  fps: number;
  width: number;
  view: View;
  markers: Project["markers"];
  inPoint: number | null;
  outPoint: number | null;
  onScrub: (e: React.PointerEvent) => void;
}) {
  const step = rulerStep(zoom, fps);
  const minor = step / (step < 1 ? Math.max(1, Math.round(step * fps)) : 5);
  const from = Math.max(0, Math.floor((view.left - 80) / zoom / step) * step);
  const to = (view.left + view.width + 80) / zoom;
  const labels: number[] = [];
  for (let t = from; t <= to && labels.length < 400; t += step) labels.push(Math.round(t * 1e6) / 1e6);
  const io = inPoint !== null || outPoint !== null;
  const a = inPoint ?? 0;
  const b = outPoint ?? width / zoom;
  return (
    <div
      className="relative h-full cursor-text touch-none select-none border-b border-line-dark bg-ink-raised"
      style={{ width, backgroundImage: `repeating-linear-gradient(90deg, var(--color-line-dark) 0 1px, transparent 1px ${minor * zoom}px)`, backgroundSize: `100% 6px`, backgroundPosition: "0 100%", backgroundRepeat: "repeat-x" }}
      onPointerDown={onScrub}
      onPointerMove={(e) => e.buttons === 1 && onScrub(e)}
    >
      {io && <span title="In to Out (I / O)" className="pointer-events-none absolute inset-y-0 bg-accent/15" style={{ left: a * zoom, width: Math.max(1, (b - a) * zoom) }} />}
      {inPoint !== null && <span title="In (I)" className="pointer-events-none absolute bottom-0 top-0 w-1 border-l-2 border-t-2 border-accent" style={{ left: inPoint * zoom }} />}
      {outPoint !== null && <span title="Out (O)" className="pointer-events-none absolute bottom-0 top-0 w-1 -translate-x-full border-r-2 border-t-2 border-accent" style={{ left: outPoint * zoom }} />}
      {labels.map((t) => (
        <span key={t} className="absolute top-0 h-full border-l border-paper-dim/50 pl-1 font-mono text-[12px] leading-[18px] text-paper-dim" style={{ left: t * zoom }}>
          {rulerLabel(t, step, fps)}
        </span>
      ))}
      {markers.map((m) => (
        <span key={m.id} title={m.label} className="absolute bottom-0 size-2.5 -translate-x-1/2 rotate-45" style={{ left: m.t * zoom, background: m.color ?? "var(--color-warning)" }} />
      ))}
    </div>
  );
});

/* ---------- Clip contents ---------- */

function Filmstrip({ clip, zoom, vis0, vis1, height }: { clip: Clip; zoom: number; vis0: number; vis1: number; height: number }) {
  useMediaVersion();
  const th = clip.mediaId ? mediaRuntime.thumbs.get(clip.mediaId) : undefined;
  if (!th?.urls.length) return null;
  const slotW = Math.max(16, (height * th.w) / th.h);
  const first = Math.max(0, Math.floor(vis0 / slotW));
  const last = Math.ceil(vis1 / slotW);
  const out: React.ReactNode[] = [];
  for (let i = first; i < last && out.length < 80; i++) {
    const src = clip.kind === "image" ? 0 : clip.in + srcOffset(clip, ((i + 0.5) * slotW) / zoom);
    let best = 0;
    for (let k = 1; k < th.times.length; k++) if (Math.abs(th.times[k] - src) < Math.abs(th.times[best] - src)) best = k;
    out.push(
      // Thumbnails are local object URLs; next/image adds nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={i} src={th.urls[best]} alt="" draggable={false} className={cn("absolute top-0 object-cover opacity-70", clip.flipH && "-scale-x-100")} style={{ left: i * slotW, width: slotW, height }} />,
    );
  }
  return <>{out}</>;
}

function Waveform({ clip, zoom, vis0, vis1, height, tone }: { clip: Clip; zoom: number; vis0: number; vis1: number; height: number; tone: string }) {
  useMediaVersion();
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = clip.mediaId ? mediaRuntime.peaks.get(clip.mediaId) : undefined;
  const w = Math.max(1, Math.min(4096, Math.ceil(vis1 - vis0)));
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = tone;
    const mid = height / 2;
    const n = peaks.data.length / 2;
    for (let x = 0; x < w; x++) {
      const t0 = (vis0 + x) / zoom;
      const t1 = (vis0 + x + 1) / zoom;
      const b0 = Math.floor((clip.in + srcOffset(clip, t0)) * peaks.rate);
      const b1 = Math.max(b0 + 1, Math.floor((clip.in + srcOffset(clip, t1)) * peaks.rate));
      let mn = 0;
      let mx = 0;
      for (let b = Math.max(0, b0); b < Math.min(n, b1); b++) {
        mn = Math.min(mn, peaks.data[2 * b]);
        mx = Math.max(mx, peaks.data[2 * b + 1]);
      }
      const g = Math.min(2, evalAnim(clip.volume, t0)) * (clip.muted ? 0.15 : 1);
      const top = mid - (mx / 127) * mid * g;
      const bot = mid - (mn / 127) * mid * g;
      ctx.fillRect(x, Math.max(0, top), 1, Math.max(1, Math.min(height, bot) - Math.max(0, top)));
    }
  }, [peaks, w, height, vis0, zoom, clip, tone]);
  if (!peaks) return null;
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute top-0" style={{ left: vis0, width: w, height }} />;
}

const KIND_STYLE: Record<Clip["kind"], string> = {
  video: "bg-paper/[0.08] border-paper/25",
  image: "bg-paper/[0.08] border-paper/25",
  audio: "bg-success/25 border-success/60",
  text: "bg-warning/25 border-warning/60",
  solid: "bg-paper/[0.08] border-paper/25",
  shape: "bg-accent/20 border-accent/50",
  adjustment: "bg-accent/15 border-accent/45",
};

function KindIcon({ kind }: { kind: Clip["kind"] }) {
  const cls = "size-3 shrink-0 text-paper-dim";
  if (kind === "video") return <Film aria-hidden className={cls} />;
  if (kind === "audio") return <AudioLines aria-hidden className={cls} />;
  if (kind === "text") return <Type aria-hidden className={cls} />;
  if (kind === "shape") return <Shapes aria-hidden className={cls} />;
  if (kind === "adjustment") return <Layers aria-hidden className={cls} />;
  return <ImageIcon aria-hidden className={cls} />;
}

function ClipView({
  clip,
  zoom,
  view,
  height,
  selected,
  dimmed,
  dropTarget,
  onPointerDown,
  onContextMenu,
}: {
  clip: Clip;
  zoom: number;
  view: View;
  height: number;
  selected: boolean;
  dimmed: boolean;
  dropTarget: boolean;
  onPointerDown: (e: React.PointerEvent, c: Clip) => void;
  onContextMenu: (e: React.MouseEvent, c: Clip) => void;
}) {
  const left = clip.start * zoom;
  const width = Math.max(2, clip.duration * zoom);
  const vis0 = Math.max(0, view.left - left);
  const vis1 = Math.min(width, view.left + view.width - left);
  if (vis1 < -200 || vis0 > width + 200) return null;
  const bodyH = height - 18;
  const keys = selected
    ? animatedPaths(clip)
        .flatMap((p) => getAnim(clip, p)?.k?.map((k) => k.t) ?? [])
        .filter((t, i, a) => a.indexOf(t) === i)
    : [];
  const tr = clip.transitionIn;
  return (
    <div
      data-clip={clip.id}
      onPointerDown={(e) => onPointerDown(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
      className={cn(
        "group absolute top-1 bottom-1 cursor-grab overflow-visible rounded-[5px] border text-left active:cursor-grabbing",
        KIND_STYLE[clip.kind],
        selected && "z-[2] border-accent ring-1 ring-accent",
        dropTarget && "z-[3] ring-2 ring-paper",
        dimmed && "opacity-40",
      )}
      style={{ left, width }}
      title={`${clip.name} · ${clip.duration.toFixed(2)} s${clip.speedRamp ? " · speed curve" : clip.speed !== 1 ? ` · ${clip.speed}×` : ""}${clip.reversed ? " · reversed" : ""}`}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[4px]">
        {clip.kind === "solid" && <div className="absolute inset-x-0 bottom-0 top-[18px]" style={{ background: clip.gradient ? `linear-gradient(${clip.gradient.angle}deg, ${clip.color}, ${clip.gradient.color})` : clip.color }} />}
        {clip.kind === "shape" && clip.shape && <div className="absolute inset-x-0 bottom-0 top-[18px] opacity-60" style={{ background: clip.shape.fill }} />}
        {(clip.kind === "video" || clip.kind === "image") && (
          <div className="absolute inset-x-0 bottom-0" style={{ top: 18, height: bodyH }}>
            <Filmstrip clip={clip} zoom={zoom} vis0={Math.max(0, vis0)} vis1={Math.max(0, vis1)} height={bodyH} />
          </div>
        )}
        {clip.kind === "audio" && (
          <div className="absolute inset-x-0 bottom-0" style={{ top: 18, height: bodyH }}>
            <Waveform clip={clip} zoom={zoom} vis0={Math.max(0, vis0)} vis1={Math.max(0, vis1)} height={bodyH} tone={selected ? "#f3f0e8" : "#a9a496"} />
          </div>
        )}
        {clip.kind === "text" && <p className="absolute inset-x-1.5 top-[18px] truncate text-[12px] leading-[18px] text-paper">{clip.text?.text}</p>}
        <div className="absolute inset-x-0 top-0 flex h-[18px] items-center gap-1 bg-ink/55 px-1.5" style={{ paddingLeft: Math.max(6, Math.min(vis0 + 6, width - 60)) }}>
          {clip.label && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: clip.label }} />}
          <KindIcon kind={clip.kind} />
          {clip.linkId && <Link2 aria-hidden className="size-3 shrink-0 text-paper-dim" />}
          <span className="truncate text-[12px] leading-none text-paper">{clip.name}</span>
          {clip.speedRamp ? (
            <Gauge aria-label="Speed curve" className="size-3 shrink-0 text-accent" />
          ) : (
            clip.speed !== 1 && <span className="shrink-0 rounded-sm bg-paper/15 px-1 font-mono text-[12px] leading-4 text-paper">{clip.speed}×</span>
          )}
          {clip.reversed && <Rewind aria-label="Reversed" className="size-3 shrink-0 text-paper" />}
          {clip.effects.some((e) => e.enabled) && <span className="shrink-0 rounded-sm bg-paper/15 px-1 font-mono text-[12px] leading-4 text-paper">fx</span>}
        </div>
        {clip.label && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: clip.label }} />}
        {keys.map((t) => (
          <span key={t} className="absolute bottom-0.5 size-2 -translate-x-1/2 rotate-45 bg-accent" style={{ left: t * zoom }} />
        ))}
      </div>
      {tr && (
        <span
          title={`Transition: ${tr.type} (${tr.duration.toFixed(2)} s)`}
          className="pointer-events-none absolute top-[18px] z-[3] h-2 rounded-full bg-accent/70"
          style={{ left: -(tr.duration * zoom) / 2, width: tr.duration * zoom }}
        />
      )}
      <span data-edge="start" title="Drag to trim the start" className="absolute inset-y-0 -left-1 z-[4] w-3.5 cursor-ew-resize rounded-l-[4px] after:absolute after:inset-y-0 after:left-1 after:w-1.5 after:bg-accent/60 after:opacity-0 group-hover:after:opacity-60 hover:after:opacity-100 max-lg:w-4" />
      <span data-edge="end" title="Drag to trim the end" className="absolute inset-y-0 -right-1 z-[4] w-3.5 cursor-ew-resize rounded-r-[4px] after:absolute after:inset-y-0 after:right-1 after:w-1.5 after:bg-accent/60 after:opacity-0 group-hover:after:opacity-60 hover:after:opacity-100 max-lg:w-4" />
    </div>
  );
}

/* ---------- Right-click menu ---------- */

function ClipMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const c = useStudio((s) => s.project.clips[menu.clipId]);
  const hasAttr = useStudio((s) => !!s.attrClipboard);
  const st = getStudio();
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-clip-menu]")) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  if (!c) return null;
  const item = (label: string, icon: React.ReactNode, run: () => void, hint?: string, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onClose();
        run();
      }}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-paper hover:bg-paper/10 disabled:opacity-40"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-paper-dim">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-[12px] text-paper-dim">{hint}</span>}
    </button>
  );
  const visual = c.kind !== "audio";
  const body = (
    <>
      {item("Split at the playhead", <Scissors className="size-4 sm:size-3.5" />, () => st.splitAtPlayhead(), "S")}
      {item("Duplicate", <Copy className="size-4 sm:size-3.5" />, () => st.duplicateSelection(), "Ctrl+D")}
      {item("Copy", <Copy className="size-4 sm:size-3.5" />, () => st.copySelection(), "Ctrl+C")}
      {item("Copy attributes", <ClipboardCopy className="size-4 sm:size-3.5" />, () => st.copyAttributes(c.id), "Ctrl+Alt+C")}
      {item("Paste attributes", <ClipboardPaste className="size-4 sm:size-3.5" />, () => st.pasteAttributes(), "Ctrl+Alt+V", !hasAttr)}
      {item("Paste effects & grade", <Sparkles className="size-4 sm:size-3.5" />, () => st.pasteAttributes({ effects: true, transform: false, audio: false }), undefined, !hasAttr)}
      {(c.kind === "video" || c.kind === "image") && item("Sync grade to all clips", <Sparkles className="size-4 sm:size-3.5" />, () => st.applyGradeToAllClips(c.id))}
      <div className="my-1 border-t border-line-dark" />
      {c.kind === "video" && item("Freeze frame (2 s)", <Snowflake className="size-4 sm:size-3.5" />, () => void runJob("cliptool", "Capturing the frame", () => freezeFrame(c.id)), "Shift+F")}
      {(c.kind === "video" || c.kind === "audio") &&
        item("Reverse", <Rewind className="size-4 sm:size-3.5" />, () =>
          void runJob("cliptool", "Reversing", async (p) => {
            await reverseClip(c.id, (f, l) => p(l ?? "Reversing", f));
            getStudio().notify("Reversed. The new copy is in your media.", "success");
          }),
        )}
      {visual && item(c.flipH ? "Unflip" : "Flip horizontally", <FlipHorizontal2 className="size-4 sm:size-3.5" />, () => st.flip(st.selection.length ? st.selection : [c.id], "h"))}
      {(c.kind === "video" || c.kind === "image") && !c.effects.some((x) => x.type === "chromaKey") && item("Chroma Key Pro", <Grid2x2 className="size-4 sm:size-3.5" />, () => st.addEffect(c.id, "chromaKey"))}
      {visual && c.kind !== "adjustment" && item("Rasterize to image", <ImageIcon className="size-4 sm:size-3.5" />, () => void runJob("cliptool", "Rasterizing clip", () => rasterizeClip(c.id)))}
      {c.kind === "video" && item(c.linkId ? "Detach audio" : "Extract audio", <AudioLines className="size-4 sm:size-3.5" />, () => st.detachAudio(c.id))}
      {c.linkId && item("Unlink picture and sound", <Link2Off className="size-4 sm:size-3.5" />, () => st.unlink(c.id))}
      {item("Add a marker here", <Bookmark className="size-4 sm:size-3.5" />, () => st.addMarker(), "M")}
      <div className="my-1 border-t border-line-dark" />
      {item("Delete", <Trash2 className="size-4 sm:size-3.5" />, () => st.deleteSelection(false), "Del")}
      {item("Ripple delete", <BetweenHorizontalStart className="size-4 sm:size-3.5" />, () => st.deleteSelection(true), "Shift+Del")}
    </>
  );
  if (typeof window !== "undefined" && window.innerWidth < 640) {
    return (
      <div data-clip-menu className="fixed inset-0 z-[95] flex flex-col justify-end bg-ink/60 backdrop-blur-[1px]" onClick={onClose}>
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-xl border-t border-line-dark bg-ink-raised pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-float"
          data-lenis-prevent
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-line-dark bg-ink-raised px-3 py-2.5">
            <span className="min-w-0 truncate text-[13px] font-medium text-paper">{c.name}</span>
            <button type="button" aria-label="Close menu" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-sm text-paper-dim hover:text-paper">
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <div className="py-1 [&>button]:py-2.5 [&>button]:text-[13px]">{body}</div>
        </div>
      </div>
    );
  }
  return (
    <div
      data-clip-menu
      role="menu"
      className="fixed z-[90] max-h-[80vh] w-64 overflow-y-auto rounded-md border border-line-dark bg-ink-raised py-1 shadow-float"
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 264)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 420)) }}
    >
      {body}
    </div>
  );
}

/* ---------- The timeline ---------- */

export function Timeline({ compact = false, onEditSelected }: { compact?: boolean; onEditSelected?: () => void } = {}) {
  const headerW = useHeaderW();
  const rulerH = compact ? 32 : RULER_H;
  const { project, zoom, selection, playhead, silence, playing, inPoint, outPoint } = useStudio(
    useShallow((s) => ({ project: s.project, zoom: s.zoom, selection: s.selection, playhead: s.playhead, silence: s.silence, playing: s.playing, inPoint: s.inPoint, outPoint: s.outPoint })),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ left: 0, width: 1000 });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ t: number; trackId: string } | null>(null);
  const [fxTarget, setFxTarget] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const drag = useRef<MoveDrag | TrimDrag | ToolDrag | null>(null);
  const touchPts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; tMid: number } | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const fps = project.settings.fps;
  const duration = TL.projectDuration(project);
  const hasClips = Object.keys(project.clips).length > 0;
  const lanesW = Math.max(view.width, (Math.max(duration, 10) + 30) * zoom);
  const labels = useMemo(() => trackLabels(project.tracks), [project.tracks]);
  const tracksY = useMemo(() => {
    const ys: Record<string, number> = {};
    let y = rulerH;
    for (const t of project.tracks) {
      ys[t.id] = y;
      y += TRACK_H[t.kind];
    }
    return { ys, bottom: y };
  }, [project.tracks, rulerH]);

  // Visible window, for drawing only what's on screen.
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setView({ left: el.scrollLeft, width: Math.max(100, el.clientWidth - headerW) }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [headerW]);

  // Ctrl/⌘ + wheel zooms around the pointer (the time under it stays put).
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const st = getStudio();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left - headerW;
      const t = (el.scrollLeft + px) / st.zoom;
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, st.zoom * Math.exp(-e.deltaY * 0.0018)));
      pendingScroll.current = Math.max(0, t * z - px);
      st.setZoom(z);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [headerW]);
  useLayoutEffect(() => {
    if (pendingScroll.current === null) return;
    scrollRef.current!.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [zoom]);

  // While playing, page the view along with the playhead.
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current!;
    const x = playhead * zoom;
    const w = el.clientWidth - headerW;
    if (x > el.scrollLeft + w - 24 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - w * 0.1);
  }, [playhead, playing, zoom, headerW]);

  const timeAt = useCallback(
    (clientX: number) => {
      const r = contentRef.current!.getBoundingClientRect();
      return Math.max(0, (clientX - r.left - headerW) / getStudio().zoom);
    },
    [headerW],
  );

  const trackAt = useCallback(
    (clientY: number) => {
      const r = contentRef.current!.getBoundingClientRect();
      const y = clientY - r.top;
      return project.tracks.find((t) => y >= tracksY.ys[t.id] && y < tracksY.ys[t.id] + TRACK_H[t.kind]) ?? null;
    },
    [project.tracks, tracksY],
  );

  const clipAtPoint = (clientX: number, clientY: number) => {
    const track = trackAt(clientY);
    if (!track) return null;
    return TL.clipAt(getStudio().project, track.id, timeAt(clientX)) ?? null;
  };

  const snapTime = (t: number, exclude: Set<string>) => {
    const st = getStudio();
    if (!st.snapping) return { t: frameRound(t, fps), at: null as number | null };
    const s = TL.snapOffset([t], TL.snapPoints(st.project, exclude, st.playhead), SNAP_PX / st.zoom);
    return s ? { t: s.at, at: s.at } : { t: frameRound(t, fps), at: null };
  };

  const onScrub = (e: React.PointerEvent) => {
    if (e.type === "pointerdown") (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const st = getStudio();
    st.set({ playing: false, playhead: frameRound(timeAt(e.clientX), fps) });
  };

  const onClipPointerDown = (e: React.PointerEvent, c: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const st = getStudio();
    const track = st.project.tracks.find((t) => t.id === c.trackId);
    const tool: Tool = st.tool;
    if (tool === "blade") {
      if (!track?.locked) st.splitClipAt(c.id, snapTime(timeAt(e.clientX), new Set()).t);
      return;
    }
    const edge = (e.target as Element).closest("[data-edge]")?.getAttribute("data-edge") as TL.TrimEdge | null;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      st.selectClip(c.id, { additive: true, solo: e.altKey });
      return;
    }
    if (!st.selection.includes(c.id) || e.altKey) st.selectClip(c.id, { solo: e.altKey });
    if (track?.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    // The pro tools: every move is recomputed from the project as it was at pointer-down.
    if ((tool === "ripple" || tool === "rate") && edge) {
      st.begin();
      drag.current = { kind: tool, id: c.id, edge };
      return;
    }
    if (tool === "roll" && edge) {
      const left = edge === "end" ? c : TL.clipEndingAt(st.project, c.trackId, c.start, c.id);
      const right = edge === "end" ? TL.clipStartingAt(st.project, c.trackId, c.start + c.duration, c.id) : c;
      st.begin();
      drag.current = left && right ? { kind: "roll", left: left.id, right: right.id } : { kind: "trim", id: c.id, edge };
      return;
    }
    if ((tool === "slip" || tool === "slide") && !edge) {
      st.begin();
      drag.current = { kind: tool, id: c.id, x0: e.clientX };
      return;
    }
    if (edge) {
      st.begin();
      drag.current = { kind: "trim", id: c.id, edge };
      return;
    }
    const sel = getStudio().selection;
    const ids = e.altKey ? [c.id] : TL.withLinked(st.project, sel.includes(c.id) ? sel : [c.id]);
    const starts: Record<string, number> = {};
    const tracks: Record<string, string> = {};
    for (const id of ids) {
      starts[id] = st.project.clips[id].start;
      tracks[id] = st.project.clips[id].trackId;
    }
    drag.current = { kind: "move", grabbed: c.id, ids, x0: e.clientX, y0: e.clientY, starts, tracks, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && touchPts.current.has(e.pointerId)) {
      touchPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPts.current.size === 2 && pinch.current && scrollRef.current) {
        const [a, b] = [...touchPts.current.values()];
        const dist = Math.max(8, Math.hypot(b.x - a.x, b.y - a.y));
        const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.current.zoom * (dist / pinch.current.dist)));
        const r = scrollRef.current.getBoundingClientRect();
        const pxMid = (a.x + b.x) / 2 - r.left - headerW;
        pendingScroll.current = Math.max(0, pinch.current.tMid * nextZoom - pxMid);
        getStudio().setZoom(nextZoom);
        return;
      }
    }
    if (marquee) {
      const r = contentRef.current!.getBoundingClientRect();
      const next = { ...marquee, x1: e.clientX - r.left, y1: e.clientY - r.top };
      setMarquee(next);
      const t0 = Math.max(0, (Math.min(next.x0, next.x1) - headerW) / zoom);
      const t1 = Math.max(0, (Math.max(next.x0, next.x1) - headerW) / zoom);
      const y0 = Math.min(next.y0, next.y1);
      const y1 = Math.max(next.y0, next.y1);
      const hit = Object.values(project.clips)
        .filter((c) => {
          const ty = tracksY.ys[c.trackId];
          const tr = project.tracks.find((t) => t.id === c.trackId);
          return tr && ty + TRACK_H[tr.kind] > y0 && ty < y1 && c.start < t1 && c.start + c.duration > t0;
        })
        .map((c) => c.id);
      getStudio().set({ selection: [...new Set([...(next.additive ? next.base : []), ...hit])] });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const st = getStudio();
    const base = st.txBase ?? st.project;
    if (d.kind === "ripple" || d.kind === "rate") {
      const s = snapTime(timeAt(e.clientX), new Set(TL.withLinked(base, [d.id])));
      setSnapLine(s.at);
      st.commit(() => (d.kind === "ripple" ? TL.rippleTrim(base, d.id, d.edge, s.t) : TL.rateStretch(base, d.id, d.edge, s.t)));
      return;
    }
    if (d.kind === "roll") {
      const s = snapTime(timeAt(e.clientX), new Set(TL.withLinked(base, [d.left, d.right])));
      setSnapLine(s.at);
      st.commit(() => TL.rollEdit(base, d.left, d.right, s.t));
      return;
    }
    if (d.kind === "slip" || d.kind === "slide") {
      const dt = (e.clientX - d.x0) / st.zoom;
      const c = base.clips[d.id];
      if (!c) return;
      st.commit(() => (d.kind === "slip" ? TL.slipClip(base, d.id, -dt * c.speed) : TL.slideClip(base, d.id, frameRound(dt, fps))));
      return;
    }
    if (d.kind === "trim") {
      const group = new Set(TL.withLinked(st.project, [d.id]));
      const s = snapTime(timeAt(e.clientX), group);
      setSnapLine(s.at);
      st.commit((p) => TL.trimClip(p, d.id, d.edge, s.t));
      return;
    }
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - d.y0) < 4) return;
    d.moved = true;
    let dt = dx / st.zoom;
    dt = Math.max(dt, -Math.min(...d.ids.map((id) => d.starts[id])));
    let snapAt: number | null = null;
    if (st.snapping) {
      const edges = d.ids.flatMap((id) => [d.starts[id] + dt, d.starts[id] + st.project.clips[id].duration + dt]);
      const s = TL.snapOffset(edges, TL.snapPoints(st.project, new Set(d.ids), st.playhead), SNAP_PX / st.zoom);
      if (s) {
        dt += s.delta;
        snapAt = s.at;
      }
    }
    const grabbed = st.project.clips[d.grabbed];
    let target = d.tracks[d.grabbed];
    const over = trackAt(e.clientY);
    // Only a lone clip (or one linked pair) changes track; a linked partner stays on its own track.
    const group = new Set(TL.withLinked(st.project, [d.grabbed]));
    if (over && !over.locked && TL.canHold(over, grabbed.kind) && d.ids.every((id) => group.has(id))) target = over.id;
    setGhost({ dt, target, snapAt, grabbed: d.grabbed, ids: d.ids, starts: d.starts, tracks: d.tracks });
  };

  const onPointerUp = (e?: React.PointerEvent) => {
    if (e) {
      touchPts.current.delete(e.pointerId);
      if (touchPts.current.size < 2) pinch.current = null;
    } else {
      touchPts.current.clear();
      pinch.current = null;
    }
    if (marquee) {
      setMarquee(null);
      return;
    }
    const d = drag.current;
    drag.current = null;
    setSnapLine(null);
    if (!d) return;
    const st = getStudio();
    if (d.kind !== "move") {
      st.end();
      return;
    }
    const g = ghost;
    setGhost(null);
    if (!d.moved || !g) return;
    st.commit((p) =>
      TL.moveClips(
        p,
        d.ids.filter((id) => p.clips[id]).map((id) => ({ id, start: frameRound(d.starts[id] + g.dt, fps), trackId: id === d.grabbed ? g.target : d.tracks[id] })),
      ),
    );
  };

  /* Drag and drop: media from the bin, files from the computer, or an effect onto a clip. */
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes(EFFECT_MIME)) {
      const c = clipAtPoint(e.clientX, e.clientY);
      if (c && c.kind !== "audio") {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
      setFxTarget(c && c.kind !== "audio" ? c.id : null);
      return;
    }
    if (!types.includes(MEDIA_MIME) && !types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const track = trackAt(e.clientY);
    setDrop({ t: frameRound(timeAt(e.clientX), fps), trackId: track?.id ?? "" });
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const st = getStudio();
    setFxTarget(null);
    const fx = e.dataTransfer.getData(EFFECT_MIME) as EffectType | "";
    if (fx) {
      const c = clipAtPoint(e.clientX, e.clientY);
      if (c && EFFECTS[fx] && canTake(c, fx)) {
        const id = st.addEffect(c.id, fx);
        st.set({ selection: [c.id], rightTab: "clip" });
        const first = EFFECTS[fx].params[0];
        if (id && first) st.set({ activeProp: `fx:${id}:${first.key}` });
        st.notify(`${EFFECTS[fx].label} added to “${c.name}”.`, "success");
      }
      return;
    }
    const t = frameRound(timeAt(e.clientX), fps);
    const track = trackAt(e.clientY);
    setDrop(null);
    const prefer = track ? (track.kind === "audio" ? { audio: track.id } : { visual: track.id }) : undefined;
    const mediaId = e.dataTransfer.getData(MEDIA_MIME);
    if (mediaId) st.addMedia(mediaId, t, prefer);
    else if (e.dataTransfer.files.length) void importFiles([...e.dataTransfer.files], { toTimeline: true, at: t, prefer });
  };

  const onContextMenu = (e: React.MouseEvent, c: Clip) => {
    e.preventDefault();
    const st = getStudio();
    if (!st.selection.includes(c.id)) st.selectClip(c.id);
    setMenu({ x: e.clientX, y: e.clientY, clipId: c.id });
  };

  const st = getStudio();
  const moving = ghost ? new Set(ghost.ids) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <TimelineToolbar
        headerW={headerW}
        compact={compact}
        onEditSelected={onEditSelected}
        onOpenMore={(el) => {
          const cid = selection[0];
          if (!cid) return;
          const r = el.getBoundingClientRect();
          setMenu({ x: r.left, y: r.top, clipId: cid });
        }}
      />
      <div
        ref={scrollRef}
        data-lenis-prevent
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
        onPointerDown={(e) => {
          if (addTrackOpen && !(e.target as HTMLElement).closest("[data-add-track-menu]")) setAddTrackOpen(false);
          if (e.pointerType !== "touch") return;
          touchPts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touchPts.current.size === 2 && scrollRef.current) {
            drag.current = null;
            setGhost(null);
            setMarquee(null);
            const [a, b] = [...touchPts.current.values()];
            const r = scrollRef.current.getBoundingClientRect();
            const pxMid = (a.x + b.x) / 2 - r.left - headerW;
            const st = getStudio();
            pinch.current = {
              dist: Math.max(8, Math.hypot(b.x - a.x, b.y - a.y)),
              zoom: st.zoom,
              tMid: Math.max(0, (scrollRef.current.scrollLeft + pxMid) / st.zoom),
            };
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDrop(null);
            setFxTarget(null);
          }
        }}
        onDrop={onDrop}
      >
        <div ref={contentRef} className="relative" style={{ width: headerW + lanesW, minHeight: "100%" }}>
          {/* Ruler */}
          <div className="sticky top-0 z-30 flex" style={{ height: rulerH }}>
            <div className="sticky left-0 z-40 flex shrink-0 items-center border-b border-r border-line-dark bg-ink-raised" style={{ width: headerW }}>
              {headerW < 100 ? (
                <div data-add-track-menu className="relative flex size-full items-center justify-center">
                  <button
                    type="button"
                    aria-expanded={addTrackOpen}
                    onClick={() => setAddTrackOpen((o) => !o)}
                    className="inline-flex size-full items-center justify-center gap-0.5 text-[12px] font-medium text-paper hover:bg-paper/10"
                  >
                    <Plus aria-hidden className="size-3.5 text-accent" />
                    Track
                  </button>
                  {addTrackOpen && (
                    <div className="absolute left-1 top-[calc(100%+2px)] z-50 w-44 rounded-md border border-line-dark bg-ink-raised p-1 shadow-float">
                      <button type="button" onClick={() => { st.addTrack("video"); setAddTrackOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-paper hover:bg-paper/10">
                        <Film aria-hidden className="size-3.5 text-paper-dim" /> Add video track
                      </button>
                      <button type="button" onClick={() => { st.addTrack("overlay"); setAddTrackOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-paper hover:bg-paper/10">
                        <Type aria-hidden className="size-3.5 text-warning" /> Add text / overlay
                      </button>
                      <button type="button" onClick={() => { st.addTrack("audio"); setAddTrackOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-paper hover:bg-paper/10">
                        <AudioLines aria-hidden className="size-3.5 text-success" /> Add audio track
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <span className="truncate px-2 font-mono text-[12px] tabular-nums text-paper">{timecode(playhead, fps)}</span>
              )}
            </div>
            <Ruler zoom={zoom} fps={fps} width={lanesW} view={view} markers={project.markers} inPoint={inPoint} outPoint={outPoint} onScrub={onScrub} />
          </div>

          {!hasClips && (
            <div className="pointer-events-none sticky left-0 flex w-full items-center justify-center px-4 py-3 text-center" style={{ paddingLeft: headerW + 12 }}>
              <span className="rounded-sm bg-ink-raised/90 px-2.5 py-1 text-[12px] text-paper-dim">
                No clips on timeline yet — tap <span className="text-paper">Import media</span> above or <span className="text-paper">Text</span> / <span className="text-paper">Media</span> below
              </span>
            </div>
          )}

          {/* Tracks */}
          {project.tracks.map((track, i) => (
            <div key={track.id} className="flex" style={{ height: TRACK_H[track.kind] }}>
              <TrackHeader headerW={headerW} track={track} label={labels[track.id]} canUp={i > 0 && (project.tracks[i - 1].kind === "audio") === (track.kind === "audio")} canDown={i < project.tracks.length - 1 && (project.tracks[i + 1].kind === "audio") === (track.kind === "audio")} />
              <div
                className={cn("relative shrink-0 border-b border-line-dark", track.kind === "audio" ? "bg-paper/[0.02]" : "bg-transparent", track.locked && "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(243_240_232/0.03)_6px_12px)]")}
                style={{ width: lanesW }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  setMenu(null);
                  const s = getStudio();
                  if (s.tool !== "select") return;
                  // Rubber-band selection from empty space (Shift adds to the selection).
                  const r = contentRef.current!.getBoundingClientRect();
                  const x = e.clientX - r.left;
                  const y = e.clientY - r.top;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setMarquee({ x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey, base: s.selection });
                  if (!e.shiftKey) s.selectClip(null);
                }}
              >
                {TL.clipsOnTrack(project, track.id).map((c) => (
                  <ClipView
                    key={c.id}
                    clip={c}
                    zoom={zoom}
                    view={view}
                    height={TRACK_H[track.kind] - 8}
                    selected={selection.includes(c.id)}
                    dimmed={!!moving?.has(c.id) || (track.kind === "audio" ? track.muted : track.hidden)}
                    dropTarget={fxTarget === c.id}
                    onPointerDown={onClipPointerDown}
                    onContextMenu={onContextMenu}
                  />
                ))}
                {silence?.trackIds.includes(track.id) &&
                  silence.ranges.map(([a, b], k) => (
                    <span key={k} className="pointer-events-none absolute inset-y-0 z-[5] border-x border-danger/70 bg-danger/30" style={{ left: a * zoom, width: Math.max(1, (b - a) * zoom) }} />
                  ))}
                {drop?.trackId === track.id && <span className="pointer-events-none absolute inset-y-1 z-[6] w-0.5 bg-accent" style={{ left: drop.t * zoom }} />}
              </div>
            </div>
          ))}

          {/* Add-track row (desktop/tablet; phones use the +Track menu in header corner) */}
          {headerW >= 100 && (
            <div className="flex h-12">
              <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-line-dark bg-ink-raised px-2" style={{ width: headerW }}>
                <span className="label-mono text-paper-dim">Add</span>
                <IconButton label="Add a video track" onClick={() => st.addTrack("video")}>
                  <Film aria-hidden className="size-4" />
                </IconButton>
                <IconButton label="Add a text and overlay track" onClick={() => st.addTrack("overlay")}>
                  <Type aria-hidden className="size-4" />
                </IconButton>
                <IconButton label="Add an audio track" onClick={() => st.addTrack("audio")}>
                  <AudioLines aria-hidden className="size-4" />
                </IconButton>
              </div>
              <div className="flex-1" />
            </div>
          )}

          {/* Markers across the lanes */}
          {project.markers.map((m) => (
            <div key={m.id} className="pointer-events-none absolute z-[1] w-px opacity-50" style={{ left: headerW + m.t * zoom, top: rulerH, height: tracksY.bottom - rulerH, background: m.color ?? "var(--color-warning)" }} />
          ))}

          {/* Ghosts of clips being moved */}
          {ghost &&
            ghost.ids.map((id) => {
              const c = project.clips[id];
              if (!c) return null;
              const trackId = id === ghost.grabbed ? ghost.target : ghost.tracks[id];
              const tr = project.tracks.find((t) => t.id === trackId);
              if (!tr) return null;
              return (
                <div
                  key={id}
                  className="pointer-events-none absolute z-[18] rounded-[5px] border-2 border-accent bg-accent/15"
                  style={{ left: headerW + (ghost.starts[id] + ghost.dt) * zoom, top: tracksY.ys[trackId] + 4, width: Math.max(2, c.duration * zoom), height: TRACK_H[tr.kind] - 8 }}
                >
                  <span className="block truncate px-1.5 text-[12px] leading-[18px] text-paper">{c.name}</span>
                </div>
              );
            })}

          {/* Rubber band */}
          {marquee && (
            <div
              className="pointer-events-none absolute z-[20] border border-accent bg-accent/10"
              style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
            />
          )}

          {/* Snap line */}
          {(snapLine ?? ghost?.snapAt) != null && (
            <div className="pointer-events-none absolute top-0 z-[19] w-px bg-warning" style={{ left: headerW + (snapLine ?? ghost!.snapAt!) * zoom, height: tracksY.bottom }} />
          )}

          {/* Playhead */}
          <div className="pointer-events-none absolute top-0 z-[25]" style={{ left: headerW + playhead * zoom, height: tracksY.bottom }}>
            <span className="absolute -left-[5px] top-0 h-3 w-[11px] bg-accent [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)]" />
            <span className="absolute left-0 top-0 h-full w-px bg-accent" />
          </div>
        </div>
      </div>
      {menu && <ClipMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TrackHeader({ headerW, track, label, canUp, canDown }: { headerW: number; track: Track; label: string; canUp: boolean; canDown: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const st = getStudio();
  const visual = track.kind !== "audio";
  const compact = headerW < 100;
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(`[data-track-menu="${track.id}"]`)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen, track.id]);

  if (compact) {
    return (
      <div data-track-menu={track.id} className="relative sticky left-0 z-20 flex shrink-0 items-center justify-between gap-0.5 border-b border-r border-line-dark bg-ink-raised px-1" style={{ width: headerW }}>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label={`Track ${label} options`}
          onClick={() => setMenuOpen((o) => !o)}
          className={cn(
            "relative inline-flex h-8 min-w-[26px] items-center justify-center rounded-sm font-mono text-[12px] font-medium hover:bg-paper/10",
            track.kind === "audio" ? "text-success" : track.kind === "overlay" ? "text-warning" : "text-paper",
          )}
        >
          {label}
          {track.locked && <Lock aria-hidden className="ml-0.5 size-2.5 text-accent" />}
        </button>
        {visual ? (
          <IconButton label={track.hidden ? "Show track" : "Hide track"} active={track.hidden} onClick={() => st.toggleTrack(track.id, "hidden")} className="size-7">
            {track.hidden ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
          </IconButton>
        ) : (
          <IconButton label={track.muted ? "Unmute track" : "Mute track"} active={track.muted} onClick={() => st.toggleTrack(track.id, "muted")} className="size-7">
            {track.muted ? <VolumeX aria-hidden className="size-3.5" /> : <Volume2 aria-hidden className="size-3.5" />}
          </IconButton>
        )}
        {menuOpen && (
          <div className="fixed left-16 z-50 w-44 rounded-md border border-line-dark bg-ink-raised p-1 shadow-float">
            <p className="truncate px-2 py-1 text-[12px] font-medium text-paper-dim">{label} · {track.name}</p>
            <button type="button" onClick={() => { st.toggleTrack(track.id, "locked"); setMenuOpen(false); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-paper hover:bg-paper/10">
              {track.locked ? <LockOpen aria-hidden className="size-3.5" /> : <Lock aria-hidden className="size-3.5" />}
              {track.locked ? "Unlock track" : "Lock track"}
            </button>
            {canUp && (
              <button type="button" onClick={() => { st.moveTrack(track.id, -1); setMenuOpen(false); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-paper hover:bg-paper/10">
                <ChevronUp aria-hidden className="size-3.5" /> Move up
              </button>
            )}
            {canDown && (
              <button type="button" onClick={() => { st.moveTrack(track.id, 1); setMenuOpen(false); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-paper hover:bg-paper/10">
                <ChevronDown aria-hidden className="size-3.5" /> Move down
              </button>
            )}
            <button type="button" onClick={() => { st.removeTrack(track.id); setMenuOpen(false); }} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[12px] text-danger hover:bg-danger/15">
              <Trash2 aria-hidden className="size-3.5" /> Delete track
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group sticky left-0 z-20 flex shrink-0 items-center gap-0.5 border-b border-r border-line-dark bg-ink-raised pl-2 pr-1" style={{ width: headerW }}>
      {/* Reorder and delete float over the name on hover, so they never take the name's room. */}
      <span className="absolute right-[60px] top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-sm bg-ink-raised opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {canUp && (
          <IconButton label="Move track up" onClick={() => st.moveTrack(track.id, -1)} className="size-6 sm:size-6">
            <ChevronUp aria-hidden className="size-3.5" />
          </IconButton>
        )}
        {canDown && (
          <IconButton label="Move track down" onClick={() => st.moveTrack(track.id, 1)} className="size-6 sm:size-6">
            <ChevronDown aria-hidden className="size-3.5" />
          </IconButton>
        )}
        <IconButton label="Delete track" onClick={() => st.removeTrack(track.id)} className="size-6 sm:size-6">
          <Trash2 aria-hidden className="size-3.5" />
        </IconButton>
      </span>
      <span className={cn("label-mono w-7 shrink-0 text-[12px]", track.kind === "audio" ? "text-success" : track.kind === "overlay" ? "text-warning" : "text-paper")}>{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-paper-dim" title={track.name}>
        {track.name}
      </span>
      {visual ? (
        <IconButton label={track.hidden ? "Show track" : "Hide track"} active={track.hidden} onClick={() => st.toggleTrack(track.id, "hidden")} className="size-7 sm:size-7">
          {track.hidden ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
        </IconButton>
      ) : (
        <IconButton label={track.muted ? "Unmute track" : "Mute track"} active={track.muted} onClick={() => st.toggleTrack(track.id, "muted")} className="size-7 sm:size-7">
          {track.muted ? <VolumeX aria-hidden className="size-3.5" /> : <Volume2 aria-hidden className="size-3.5" />}
        </IconButton>
      )}
      <IconButton label={track.locked ? "Unlock track" : "Lock track"} active={track.locked} onClick={() => st.toggleTrack(track.id, "locked")} className="size-7 sm:size-7">
        {track.locked ? <Lock aria-hidden className="size-3.5" /> : <LockOpen aria-hidden className="size-3.5" />}
      </IconButton>
    </div>
  );
}

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Selection", key: "V", hint: "move, trim and select" },
  { id: "blade", label: "Razor", key: "C", hint: "click a clip to cut it" },
  { id: "ripple", label: "Ripple edit", key: "B", hint: "trim an edge and close the gap" },
  { id: "roll", label: "Roll edit", key: "N", hint: "move a cut between two clips" },
  { id: "slip", label: "Slip", key: "Y", hint: "show a different part of the source" },
  { id: "slide", label: "Slide", key: "U", hint: "move a clip between its neighbours" },
  { id: "rate", label: "Rate stretch", key: "R", hint: "change speed by dragging an edge" },
];

function TimelineToolbar({
  headerW,
  compact,
  onEditSelected,
  onOpenMore,
}: {
  headerW: number;
  compact: boolean;
  onEditSelected?: () => void;
  onOpenMore: (el: HTMLElement) => void;
}) {
  const { tool, snapping, zoom, hasSel, inPoint, outPoint } = useStudio(useShallow((s) => ({ tool: s.tool, snapping: s.snapping, zoom: s.zoom, hasSel: s.selection.length > 0, inPoint: s.inPoint, outPoint: s.outPoint })));
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const st = getStudio();

  useEffect(() => {
    if (!toolsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!toolsRef.current?.contains(e.target as Node)) setToolsOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [toolsOpen]);

  const fit = () => {
    const el = document.querySelector<HTMLElement>("[data-studio-timeline-width]");
    const w = (el?.clientWidth ?? 900) - headerW - 40;
    st.setZoom(w / Math.max(5, TL.projectDuration(st.project)));
  };

  if (compact) {
    const activeTool = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
    const ActiveIcon = TOOL_ICON[activeTool.id];
    return (
      <div ref={toolsRef} data-studio-timeline-width className="relative flex h-11 shrink-0 items-center gap-1 border-b border-line-dark bg-ink-raised px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar" data-lenis-prevent>
          {hasSel ? (
            <>
              {onEditSelected && (
                <button
                  type="button"
                  onClick={onEditSelected}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm bg-paper px-2 text-[12px] font-medium text-ink"
                >
                  <SlidersHorizontal aria-hidden className="size-3.5" />
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={() => st.splitAtPlayhead()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-line-dark px-1.5 text-[12px] text-paper hover:bg-paper/10"
              >
                <Scissors aria-hidden className="size-3.5" />
                Split
              </button>
              <IconButton label="Duplicate clip" onClick={() => st.duplicateSelection()} className="size-8">
                <Copy aria-hidden className="size-3.5" />
              </IconButton>
              <IconButton label="Delete selected clip" onClick={() => st.deleteSelection(false)} className="size-8">
                <Trash2 aria-hidden className="size-3.5" />
              </IconButton>
              <IconButton label="More clip actions" onClick={(e) => onOpenMore(e.currentTarget)} className="size-8">
                <Ellipsis aria-hidden className="size-4" />
              </IconButton>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => st.splitAtPlayhead()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-line-dark px-1.5 text-[12px] text-paper hover:bg-paper/10"
              >
                <Scissors aria-hidden className="size-3.5" />
                Split
              </button>
              <button
                type="button"
                aria-pressed={snapping}
                onClick={() => st.set({ snapping: !snapping })}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[12px]",
                  snapping ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:text-paper",
                )}
              >
                <Magnet aria-hidden className="size-3.5" />
                Snap
              </button>
              <button
                type="button"
                onClick={() => st.addMarker()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-line-dark px-1.5 text-[12px] text-paper-dim hover:text-paper"
              >
                <Plus aria-hidden className="size-3.5" />
                Mark
              </button>
              <button
                type="button"
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen((o) => !o)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[12px]",
                  tool !== "select" ? "border-accent bg-accent text-paper" : "border-line-dark text-paper-dim hover:text-paper",
                )}
              >
                {tool === "select" ? <Wrench aria-hidden className="size-3.5" /> : <ActiveIcon aria-hidden className="size-3.5" />}
                <span>{tool === "select" ? "Tools" : activeTool.label.split(" ")[0]}</span>
              </button>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 border-l border-line-dark pl-1">
          <IconButton label="Zoom out" onClick={() => st.setZoom(zoom / 1.4)} className="h-8 w-7">
            <ZoomOut aria-hidden className="size-3.5" />
          </IconButton>
          <IconButton label="Zoom in" onClick={() => st.setZoom(zoom * 1.4)} className="h-8 w-7">
            <ZoomIn aria-hidden className="size-3.5" />
          </IconButton>
          <button type="button" onClick={fit} className="inline-flex h-8 items-center rounded-sm px-1 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper">
            Fit
          </button>
        </div>
        {toolsOpen && (
          <div
            role="menu"
            aria-label="Timeline tools"
            className="absolute bottom-[calc(100%+4px)] left-2 z-50 w-[min(280px,calc(100vw-16px))] rounded-lg border border-line-dark bg-ink-raised p-1.5 shadow-float"
          >
            {TOOLS.map((t) => {
              const Icon = TOOL_ICON[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    st.set({ tool: t.id });
                    setToolsOpen(false);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[12px]",
                    tool === t.id ? "bg-paper text-ink" : "text-paper hover:bg-paper/10",
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  <span className="font-medium">{t.label}</span>
                  <span className={cn("ml-auto truncate text-[12px]", tool === t.id ? "text-ink-2" : "text-paper-dim")}>{t.hint}</span>
                </button>
              );
            })}
            <div className="my-1 border-t border-line-dark" />
            <button
              type="button"
              onClick={() => {
                st.closeGaps();
                setToolsOpen(false);
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[12px] text-paper hover:bg-paper/10"
            >
              <BetweenHorizontalStart aria-hidden className="size-4 shrink-0" />
              <span>Close all gaps</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-studio-timeline-width className="flex items-center gap-0.5 overflow-x-auto no-scrollbar border-b border-line-dark bg-ink-raised px-1.5 py-1" data-lenis-prevent>
      {TOOLS.map((t) => {
        const Icon = TOOL_ICON[t.id];
        return (
          <IconButton key={t.id} label={`${t.label} (${t.key}): ${t.hint}`} active={tool === t.id} onClick={() => st.set({ tool: t.id })}>
            <Icon aria-hidden className="size-4" />
          </IconButton>
        );
      })}
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
      <IconButton label="Split at the playhead (S)" onClick={() => st.splitAtPlayhead()}>
        <SquareSplitHorizontal aria-hidden className="size-4" />
      </IconButton>
      <IconButton label="Delete (Delete)" disabled={!hasSel} onClick={() => st.deleteSelection(false)}>
        <Trash2 aria-hidden className="size-4" />
      </IconButton>
      <button
        type="button"
        disabled={!hasSel}
        onClick={() => st.deleteSelection(true)}
        title="Ripple delete (Shift+Delete): remove and close the gap"
        className="inline-flex h-8 shrink-0 items-center rounded-sm px-2 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper disabled:opacity-35"
      >
        Ripple delete
      </button>
      <button type="button" onClick={() => st.closeGaps()} title="Close every gap on the timeline (keeps tracks in sync)" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper">
        <BetweenHorizontalStart aria-hidden className="size-3.5" />
        Close gaps
      </button>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
      <IconButton label={snapping ? "Snapping on (Shift+S)" : "Snapping off (Shift+S)"} active={snapping} onClick={() => st.set({ snapping: !snapping })}>
        <Magnet aria-hidden className="size-4" />
      </IconButton>
      <button type="button" onClick={() => st.addMarker()} title="Add a marker at the playhead (M)" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper">
        <Plus aria-hidden className="size-3.5" />
        Marker
      </button>
      <button type="button" onClick={() => st.setInOut("in", st.playhead)} title="Set In at the playhead (I)" className={cn("inline-flex h-8 shrink-0 items-center rounded-sm px-2 font-mono text-[12px] hover:bg-paper/10", inPoint !== null ? "text-accent" : "text-paper-dim hover:text-paper")}>
        In
      </button>
      <button type="button" onClick={() => st.setInOut("out", st.playhead)} title="Set Out at the playhead (O)" className={cn("inline-flex h-8 shrink-0 items-center rounded-sm px-2 font-mono text-[12px] hover:bg-paper/10", outPoint !== null ? "text-accent" : "text-paper-dim hover:text-paper")}>
        Out
      </button>
      {(inPoint !== null || outPoint !== null) && (
        <button
          type="button"
          onClick={() => {
            st.setInOut("in", null);
            st.setInOut("out", null);
          }}
          title="Clear In and Out (Alt+X)"
          className="inline-flex h-8 shrink-0 items-center rounded-sm px-1.5 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper"
        >
          ✕
        </button>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton label="Zoom out (−)" onClick={() => st.setZoom(zoom / 1.4)}>
          <ZoomOut aria-hidden className="size-4" />
        </IconButton>
        <input
          type="range"
          aria-label="Timeline zoom"
          min={Math.log(ZOOM_MIN)}
          max={Math.log(ZOOM_MAX)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => st.setZoom(Math.exp(Number(e.target.value)))}
          onKeyDown={(e) => e.stopPropagation()}
          className="studio-range hidden w-28 sm:block"
          style={{ ["--a" as string]: "0%", ["--b" as string]: `${((Math.log(zoom) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))) * 100}%`, ["--h" as string]: "0%" }}
        />
        <IconButton label="Zoom in (+)" onClick={() => st.setZoom(zoom * 1.4)}>
          <ZoomIn aria-hidden className="size-4" />
        </IconButton>
        <button type="button" onClick={fit} title="Fit the whole timeline (\)" className="inline-flex h-8 items-center rounded-sm px-2 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper">
          Fit
        </button>
      </div>
    </div>
  );
}
