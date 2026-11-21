"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Camera, ChevronFirst, ChevronLast, Grid3x3, Pause, Play, Repeat, StepBack, StepForward, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { IMPORT_ACCEPT } from "../constants";
import { evalAnim } from "../lib/keyframes";
import { clamp, frameRound, timecode } from "../lib/time";
import { projectDuration } from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import type { Clip, Project } from "../types";
import { importFiles } from "../engine/importer";
import { trackPoint } from "../engine/ai/tracker";
import { getEngine, PlaybackEngine } from "../engine/playback";
import { baseSize, buildScene, layerDraws } from "../engine/render/scene";
import { runJob } from "./ai-panel";
import { IconButton, Select } from "./controls";
import { VideoScopes } from "./scopes";

/* ---------- Geometry ---------- */

function geometry(p: Project, c: Clip, t: number) {
  const le = clamp(t - c.start, 0, c.duration);
  const [bw, bh] = baseSize(p, c);
  const sx = evalAnim(c.transform.scaleX, le);
  const sy = evalAnim(c.transform.scaleY, le);
  return { x: evalAnim(c.transform.x, le), y: evalAnim(c.transform.y, le), sx, sy, bw, bh, rotDeg: evalAnim(c.transform.rotation, le) };
}

/** The top-most visible clip under a point (project pixels). */
function pick(p: Project, t: number, px: number, py: number): Clip | null {
  const draws = layerDraws(buildScene(p, t));
  for (let i = draws.length - 1; i >= 0; i--) {
    const d = draws[i];
    const dx = px - d.x;
    const dy = py - d.y;
    const c = Math.cos(-d.rot);
    const s = Math.sin(-d.rot);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    if (Math.abs(lx) <= Math.abs(d.baseW * d.sx) / 2 && Math.abs(ly) <= Math.abs(d.baseH * d.sy) / 2 && d.opacity > 0.02) return d.clip;
  }
  return null;
}

type Drag = { mode: string; id: string; px0: number; py0: number; g0: ReturnType<typeof geometry> };

const HANDLES: [string, number, number][] = [
  ["nw", -1, -1],
  ["n", 0, -1],
  ["ne", 1, -1],
  ["e", 1, 0],
  ["se", 1, 1],
  ["s", 0, 1],
  ["sw", -1, 1],
  ["w", -1, 0],
];

function TransformOverlay({ w, h }: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const showGuides = useStudio((s) => s.guides);
  const picking = useStudio((s) => !!s.picking || !!s.trackingPick);
  const clip = usePrimaryClip();
  const k = w / project.settings.width;
  const W = project.settings.width;
  const H = project.settings.height;

  const toProject = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k] as const;
  };

  const active = !!clip && clip.kind !== "audio" && playhead >= clip.start && playhead < clip.start + clip.duration;
  const g = active ? geometry(project, clip!, playhead) : null;
  const locked = active && !!project.tracks.find((t) => t.id === clip!.trackId)?.locked;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || playing) return;
    const [px, py] = toProject(e);
    const handle = (e.target as Element).closest("[data-handle]")?.getAttribute("data-handle");
    const st = getStudio();
    if (st.picking) {
      // Eyedropper: map the click into the clip's own picture and sample the source there.
      const { clipId, effectId } = st.picking;
      const c = st.project.clips[clipId];
      st.set({ picking: null });
      if (!c) return;
      const g1 = geometry(st.project, c, st.playhead);
      const r = (-g1.rotDeg * Math.PI) / 180;
      const lx = (px - g1.x) * Math.cos(r) - (py - g1.y) * Math.sin(r);
      const ly = (px - g1.x) * Math.sin(r) + (py - g1.y) * Math.cos(r);
      const color = getEngine()?.sampleColor(clipId, lx / (g1.bw * g1.sx) + 0.5, ly / (g1.bh * g1.sy) + 0.5);
      const fx = c.effects.find((x) => x.id === effectId);
      if (color && fx) st.updateEffect(clipId, effectId, { options: { ...fx.options, color } });
      else st.notify("Click inside the clip's picture to pick its key colour.", "warning");
      return;
    }
    if (st.trackingPick) {
      const clipId = st.trackingPick;
      const c = st.project.clips[clipId];
      st.set({ trackingPick: null });
      if (!c) return;
      const g1 = geometry(st.project, c, st.playhead);
      const r = (-g1.rotDeg * Math.PI) / 180;
      const lx = (px - g1.x) * Math.cos(r) - (py - g1.y) * Math.sin(r);
      const ly = (px - g1.x) * Math.sin(r) + (py - g1.y) * Math.cos(r);
      const u = lx / (g1.bw * g1.sx) + 0.5;
      const v = ly / (g1.bh * g1.sy) + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        st.notify("Click inside the clip's picture to set the 2D tracking point.", "warning");
        return;
      }
      const startLocal = clamp(st.playhead - c.start, 0, c.duration);
      void runJob("track", "Tracking point", (prog) => trackPoint(clipId, u, v, startLocal, prog)).then(() => {
        getStudio().notify("2D point track ready. Attach a title, graphic or overlay in the Inspector.", "success");
      });
      return;
    }
    let target = active ? clip : null;
    if (!handle) {
      const hit = pick(st.project, st.playhead, px, py);
      if (!hit) {
        st.selectClip(null);
        return;
      }
      if (hit.id !== clip?.id) st.selectClip(hit.id);
      target = hit;
    }
    if (!target || st.project.tracks.find((t) => t.id === target!.trackId)?.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    st.begin();
    drag.current = { mode: handle ?? "move", id: target.id, px0: px, py0: py, g0: geometry(st.project, target, st.playhead) };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [px, py] = toProject(e);
    const st = getStudio();
    const g0 = d.g0;
    if (d.mode === "move") {
      let nx = g0.x + (px - d.px0);
      let ny = g0.y + (py - d.py0);
      const snap = 7 / k;
      const sx = !e.altKey && Math.abs(nx - W / 2) < snap;
      const sy = !e.altKey && Math.abs(ny - H / 2) < snap;
      if (sx) nx = W / 2;
      if (sy) ny = H / 2;
      setGuides({ x: sx, y: sy });
      st.setProp(d.id, "x", Math.round(nx * 10) / 10);
      st.setProp(d.id, "y", Math.round(ny * 10) / 10);
      return;
    }
    if (d.mode === "rot") {
      const a0 = Math.atan2(d.py0 - g0.y, d.px0 - g0.x);
      const a1 = Math.atan2(py - g0.y, px - g0.x);
      let deg = g0.rotDeg + ((a1 - a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      st.setProp(d.id, "rotation", Math.round(deg * 10) / 10);
      return;
    }
    // Scale handles: work in the clip's own (rotated) axes, about its centre.
    const r = (-g0.rotDeg * Math.PI) / 180;
    const local = (x: number, y: number) => [(x - g0.x) * Math.cos(r) - (y - g0.y) * Math.sin(r), (x - g0.x) * Math.sin(r) + (y - g0.y) * Math.cos(r)];
    const [lx0, ly0] = local(d.px0, d.py0);
    const [lx, ly] = local(px, py);
    const corner = d.mode.length === 2;
    if (corner && !e.shiftKey) {
      const f = Math.hypot(lx, ly) / Math.max(1, Math.hypot(lx0, ly0));
      st.setProp(d.id, "scaleX", Math.round(g0.sx * f * 1000) / 1000);
      st.setProp(d.id, "scaleY", Math.round(g0.sy * f * 1000) / 1000);
      return;
    }
    if (d.mode.includes("e") || d.mode.includes("w")) st.setProp(d.id, "scaleX", Math.round(((g0.sx * lx) / (Math.abs(lx0) > 1 ? lx0 : 1)) * 1000) / 1000);
    if (d.mode.includes("n") || d.mode.includes("s")) st.setProp(d.id, "scaleY", Math.round(((g0.sy * ly) / (Math.abs(ly0) > 1 ? ly0 : 1)) * 1000) / 1000);
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: false, y: false });
    getStudio().end();
  };

  let box: React.ReactNode = null;
  if (g && !playing) {
    const hw = (g.bw * g.sx * k) / 2;
    const hh = (g.bh * g.sy * k) / 2;
    const cx = g.x * k;
    const cy = g.y * k;
    const rr = (g.rotDeg * Math.PI) / 180;
    const pt = (u: number, v: number) => [cx + u * Math.cos(rr) - v * Math.sin(rr), cy + u * Math.sin(rr) + v * Math.cos(rr)];
    const corners = [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
    const rot = pt(0, -Math.abs(hh) - 26 * Math.sign(hh || 1));
    const top = pt(0, -hh);
    box = (
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        <polygon points={corners.map((c) => c.join(",")).join(" ")} className="fill-none stroke-accent" strokeWidth={1.5} />
        {!locked && (
          <>
            <line x1={top[0]} y1={top[1]} x2={rot[0]} y2={rot[1]} className="stroke-accent" strokeWidth={1} />
            <circle data-handle="rot" cx={rot[0]} cy={rot[1]} r={6} className="pointer-events-auto cursor-grab fill-ink stroke-accent" strokeWidth={1.5} />
            {HANDLES.map(([id, u, v]) => {
              const [x, y] = pt(u * hw, v * hh);
              return <rect key={id} data-handle={id} x={x - 5} y={y - 5} width={10} height={10} className="pointer-events-auto fill-paper stroke-accent" strokeWidth={1.5} style={{ cursor: id.length === 2 ? "nwse-resize" : u ? "ew-resize" : "ns-resize" }} />;
            })}
            <circle cx={cx} cy={cy} r={3} className="fill-accent" />
          </>
        )}
      </svg>
    );
  }

  return (
    <div
      ref={ref}
      className={cn("absolute inset-0 touch-none", picking ? "cursor-crosshair" : !playing && "cursor-default")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {showGuides && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          <rect x={w * 0.05} y={h * 0.05} width={w * 0.9} height={h * 0.9} className="fill-none stroke-paper/35" strokeDasharray="4 4" />
          <rect x={w * 0.1} y={h * 0.1} width={w * 0.8} height={h * 0.8} className="fill-none stroke-paper/25" strokeDasharray="2 4" />
          {[1, 2].map((i) => (
            <g key={i}>
              <line x1={(w * i) / 3} y1={0} x2={(w * i) / 3} y2={h} className="stroke-paper/15" />
              <line x1={0} y1={(h * i) / 3} x2={w} y2={(h * i) / 3} className="stroke-paper/15" />
            </g>
          ))}
        </svg>
      )}
      {(guides.x || guides.y) && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {guides.x && <line x1={w / 2} y1={0} x2={w / 2} y2={h} className="stroke-accent" strokeDasharray="5 4" />}
          {guides.y && <line x1={0} y1={h / 2} x2={w} y2={h / 2} className="stroke-accent" strokeDasharray="5 4" />}
        </svg>
      )}
      {box}
    </div>
  );
}

/* ---------- Transport ---------- */

function Meter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const lv = getEngine()?.levels() ?? [0, 0];
      if (!el) return;
      lv.forEach((v, i) => {
        const bar = el.children[i] as HTMLElement | undefined;
        if (!bar) return;
        const db = v > 0 ? 20 * Math.log10(v) : -60;
        const f = clamp((db + 60) / 60, 0, 1);
        bar.style.transform = `scaleX(${f})`;
        bar.dataset.hot = db > -3 ? "1" : "";
      });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className="flex w-16 flex-col gap-0.5 @max-[40rem]:hidden" aria-hidden title="Output level">
      {[0, 1].map((i) => (
        <span key={i} className="h-1 origin-left scale-x-0 rounded-full bg-success data-[hot=1]:bg-danger" />
      ))}
    </div>
  );
}

function Transport() {
  const { playing, playhead, fps, loop, quality, guides } = useStudio(
    useShallow((s) => ({ playing: s.playing, playhead: s.playhead, fps: s.project.settings.fps, loop: s.loop, quality: s.quality, guides: s.guides })),
  );
  const duration = useStudio((s) => projectDuration(s.project));
  const st = getStudio();
  const snapshot = async () => {
    const e = getEngine();
    if (!e) return;
    try {
      const blob = await e.snapshot();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${st.project.name || "frame"} ${timecode(playhead, fps).replace(/:/g, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      st.notify(err instanceof Error ? err.message : "Couldn't save the frame.", "danger");
    }
  };
  return (
    // A size container: what fits depends on the monitor's width, not the window's.
    <div className="@container flex items-center gap-1 border-t border-line-dark bg-ink-raised px-2 py-1">
      <div className="flex shrink-0 items-center">
        <IconButton label="Go to start (Home)" onClick={() => st.set({ playhead: 0, playing: false })}>
          <ChevronFirst aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Previous frame (←)" onClick={() => st.stepFrames(-1)}>
          <StepBack aria-hidden className="size-4" />
        </IconButton>
        <button
          type="button"
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={() => st.togglePlay()}
          className="mx-0.5 inline-flex size-9 items-center justify-center rounded-full bg-paper text-ink transition-transform hover:scale-105 max-sm:size-11"
        >
          {playing ? <Pause aria-hidden className="size-4 fill-current" /> : <Play aria-hidden className="ml-0.5 size-4 fill-current" />}
        </button>
        <IconButton label="Next frame (→)" onClick={() => st.stepFrames(1)}>
          <StepForward aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Go to end (End)" onClick={() => st.set({ playhead: frameRound(duration, fps), playing: false })}>
          <ChevronLast aria-hidden className="size-4" />
        </IconButton>
      </div>
      <p className="ml-1 shrink-0 font-mono text-[12px] tabular-nums text-paper">
        {timecode(playhead, fps)}
        <span className="text-paper-dim @max-[34rem]:hidden"> / {timecode(duration, fps)}</span>
      </p>
      <div className="ml-auto flex items-center gap-1">
        <Meter />
        <IconButton label="Loop playback" active={loop} onClick={() => st.set({ loop: !loop })}>
          <Repeat aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Safe areas and thirds" active={guides} onClick={() => st.set({ guides: !guides })} className="@max-[30rem]:hidden">
          <Grid3x3 aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Save this frame as PNG" onClick={() => void snapshot()} className="@max-[30rem]:hidden">
          <Camera aria-hidden className="size-4" />
        </IconButton>
        <Select
          label="Preview quality"
          value={quality}
          onChange={(v) => st.set({ quality: v })}
          className="w-[76px] flex-none"
          options={[
            { value: "full", label: "Full" },
            { value: "half", label: "1/2" },
            { value: "quarter", label: "1/4" },
          ]}
        />
      </div>
    </div>
  );
}

/* ---------- The monitor ---------- */

export function Preview() {
  const areaRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const { width, height } = useStudio(useShallow((s) => ({ width: s.project.settings.width, height: s.project.settings.height })));
  const scopes = useStudio((s) => s.scopes);
  const empty = useStudio((s) => Object.keys(s.project.clips).length === 0);

  useLayoutEffect(() => {
    const el = areaRef.current!;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const k = Math.max(0, Math.min((r.width - 24) / width, (r.height - 24) / height));
      setBox({ w: Math.floor(width * k), h: Math.floor(height * k) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  useEffect(() => {
    const host = hostRef.current!;
    // The canvas is made here (not in JSX): transferControlToOffscreen can only happen once per
    // element, and React may run this effect twice in development.
    const make = (offscreen: boolean) => {
      const canvas = document.createElement("canvas");
      canvas.className = "absolute inset-0 block size-full";
      host.appendChild(canvas);
      try {
        const target = offscreen && "transferControlToOffscreen" in canvas ? canvas.transferControlToOffscreen() : canvas;
        return { canvas, engine: new PlaybackEngine(target) };
      } catch (e) {
        canvas.remove();
        throw e;
      }
    };
    let made: ReturnType<typeof make> | null = null;
    try {
      made = make(true);
    } catch {
      try {
        made = make(false);
      } catch (e) {
        queueMicrotask(() => setError(e instanceof Error ? e.message : "The preview couldn't start."));
      }
    }
    return () => {
      made?.engine.dispose();
      made?.canvas.remove();
    };
  }, []);

  useEffect(() => {
    getEngine()?.setDisplaySize(box.w, box.h, window.devicePixelRatio || 1);
  }, [box]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (files.length) void importFiles(files, { toTimeline: true, at: getStudio().playhead });
    const mediaId = e.dataTransfer.getData("application/x-studio-media");
    if (mediaId) getStudio().addMedia(mediaId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={areaRef}
        className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-ink", dropping && "bg-paper/5")}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("application/x-studio-media")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <div className="relative shrink-0 bg-black shadow-[0_0_0_1px_var(--color-line-dark)]" style={{ width: box.w, height: box.h }}>
          <div ref={hostRef} className="absolute inset-0" />
          {box.w > 0 && <TransformOverlay w={box.w} h={box.h} />}
          {empty && !error && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
              <p className="text-[15px] font-medium text-paper">Drop videos, music or pictures here</p>
              <p className="max-w-xs text-[12px] leading-relaxed text-paper-dim">Everything stays on this device. Or start with a title from the Text tab.</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-md bg-paper px-4 text-[13px] font-medium text-ink hover:bg-paper/85"
              >
                <Upload aria-hidden className="size-4" />
                Import media
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={IMPORT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) void importFiles(files, { toTimeline: true, at: 0 });
                }}
              />
            </div>
          )}
          {error && (
            <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] leading-relaxed text-paper">
              {error}
            </div>
          )}
        </div>
        {scopes && <VideoScopes />}
      </div>
      <Transport />
    </div>
  );
}
