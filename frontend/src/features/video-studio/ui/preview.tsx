"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Camera, ChevronFirst, ChevronLast, Grid2x2, Pause, Pipette, Play, Repeat, SlidersHorizontal, SquareSplitHorizontal, StepBack, StepForward, Type, Upload } from "lucide-react";
import { hex as hexOf, inkOn } from "@/lib/color";
import { cn } from "@/lib/utils";
import { IMPORT_ACCEPT, TEXT_PRESETS } from "../constants";
import { evalAnim } from "../lib/keyframes";
import { clamp, frameRound, shortTime, timecode } from "../lib/time";
import { projectDuration } from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import type { Clip, GuideMode, Project } from "../types";
import { importFiles } from "../engine/importer";
import { trackPoint } from "../engine/ai/tracker";
import { getEngine, PlaybackEngine } from "../engine/playback";
import { clipUvFromProject } from "../engine/render/chroma-math";
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
  const loupeWrapRef = useRef<HTMLDivElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeHexRef = useRef<HTMLSpanElement>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const guideMode = useStudio((s) => s.guides);
  const compare = useStudio((s) => s.compare);
  const compareX = useStudio((s) => s.compareX);
  const pickingState = useStudio((s) => s.picking);
  const picking = useStudio((s) => !!s.picking || !!s.trackingPick);
  const clip = usePrimaryClip();
  const k = w / project.settings.width;
  const W = project.settings.width;
  const H = project.settings.height;

  useEffect(() => {
    if (!pickingState && loupeWrapRef.current) {
      loupeWrapRef.current.style.display = "none";
    }
  }, [pickingState]);

  const toProject = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k] as const;
  };

  const updatePickingLoupe = (e: React.PointerEvent) => {
    const wrap = loupeWrapRef.current;
    const lc = loupeCanvasRef.current;
    const host = ref.current;
    const st = getStudio();
    if (!wrap || !lc || !host || !st.picking) {
      if (wrap) wrap.style.display = "none";
      return;
    }
    const rect = host.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;
    if (wx < 0 || wy < 0 || wx > rect.width || wy > rect.height) {
      wrap.style.display = "none";
      return;
    }
    const [px, py] = toProject(e);
    const engine = getEngine();
    let patch: { data: Uint8ClampedArray | Uint8Array; size: number } | null = null;
    if (st.picking.kind === "effect") {
      const c = st.project.clips[st.picking.clipId];
      if (c) {
        const g1 = geometry(st.project, c, st.playhead);
        const uv = clipUvFromProject(px, py, g1, c.flipH, c.flipV);
        if (uv) patch = engine?.sampleClipPatch(c.id, uv.u, uv.v, 5) ?? engine?.sampleFramePatch(px / W, py / H, 5) ?? null;
      }
    } else {
      patch = engine?.sampleFramePatch(px / W, py / H, 5) ?? null;
    }
    if (!patch) {
      wrap.style.display = "none";
      return;
    }

    const lx = Math.min(Math.max(wx - 52, 4), Math.max(4, rect.width - 108));
    const ly = wy > 144 ? wy - 138 : Math.min(wy + 18, Math.max(4, rect.height - 138));
    wrap.style.display = "flex";
    wrap.style.transform = `translate3d(${Math.round(lx)}px, ${Math.round(ly)}px, 0)`;

    const lg = lc.getContext("2d");
    const cells = patch.size;
    if (lg) {
      const dim = lc.width;
      const cellPx = dim / cells;
      const tmp = document.createElement("canvas");
      tmp.width = cells;
      tmp.height = cells;
      const tg = tmp.getContext("2d")!;
      const imgData = tg.createImageData(cells, cells);
      imgData.data.set(patch.data);
      tg.putImageData(imgData, 0, 0);
      lg.fillStyle = "#12110d";
      lg.fillRect(0, 0, dim, dim);
      lg.imageSmoothingEnabled = false;
      lg.drawImage(tmp, 0, 0, dim, dim);
      lg.strokeStyle = "rgba(255,255,255,0.16)";
      lg.lineWidth = 1;
      lg.beginPath();
      for (let i = 1; i < cells; i++) {
        const p = Math.round(i * cellPx) + 0.5;
        lg.moveTo(p, 0);
        lg.lineTo(p, dim);
        lg.moveTo(0, p);
        lg.lineTo(dim, p);
      }
      lg.stroke();
      const half = Math.floor(cells / 2);
      const rad = Math.floor(st.sampleSize / 2);
      const bx = (half - rad) * cellPx;
      const bw = st.sampleSize * cellPx;
      lg.strokeStyle = "#000000";
      lg.lineWidth = 2;
      lg.strokeRect(bx, bx, bw, bw);
      lg.strokeStyle = "#ffffff";
      lg.lineWidth = 1;
      lg.strokeRect(bx + 1, bx + 1, Math.max(1, bw - 2), Math.max(1, bw - 2));
    }

    const mid = Math.floor(cells / 2);
    const mo = (mid * cells + mid) * 4;
    const rgb: [number, number, number] = [patch.data[mo], patch.data[mo + 1], patch.data[mo + 2]];
    const code = hexOf(rgb);
    if (loupeHexRef.current) {
      loupeHexRef.current.textContent = code.toUpperCase();
      loupeHexRef.current.style.background = code;
      loupeHexRef.current.style.color = inkOn(rgb);
    }
  };

  const active = !!clip && clip.kind !== "audio" && playhead >= clip.start && playhead < clip.start + clip.duration;
  const g = active ? geometry(project, clip!, playhead) : null;
  const locked = active && !!project.tracks.find((t) => t.id === clip!.trackId)?.locked;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("[data-compare-wipe]")) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const r = ref.current!.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left) / Math.max(1, r.width), 0.04, 0.96);
      getStudio().set({ compareX: nx });
      drag.current = { mode: "compare", id: "", px0: 0, py0: 0, g0: { x: 0, y: 0, sx: 1, sy: 1, bw: 1, bh: 1, rotDeg: 0 } };
      return;
    }
    const [px, py] = toProject(e);
    const st = getStudio();
    if (st.picking) {
      e.stopPropagation();
      if (st.playing) st.set({ playing: false });
      const activePick = st.picking;
      st.set({ picking: null });
      if (loupeWrapRef.current) loupeWrapRef.current.style.display = "none";

      let sampled: string | null = null;
      if (activePick.kind === "effect") {
        const c = st.project.clips[activePick.clipId];
        if (!c) return;
        const g1 = geometry(st.project, c, st.playhead);
        const uv = clipUvFromProject(px, py, g1, c.flipH, c.flipV);
        if (!uv) {
          st.notify("Click inside the clip's picture to pick a colour.", "warning");
          return;
        }
        sampled = getEngine()?.sampleColor(activePick.clipId, uv.u, uv.v, st.sampleSize) ?? null;
        if (!sampled) {
          const patch = getEngine()?.sampleFramePatch(px / W, py / H, 0);
          if (patch) sampled = hexOf([patch.data[0], patch.data[1], patch.data[2]]);
        }
        const fx = c.effects.find((x) => x.id === activePick.effectId);
        if (sampled && fx) {
          const key = activePick.optionKey ?? "color";
          st.updateEffect(activePick.clipId, activePick.effectId, { options: { ...fx.options, [key]: sampled } });
          st.addRecentColor(sampled);
        } else {
          st.notify("Couldn't sample that frame pixel yet.", "warning");
        }
        return;
      }

      const patch = getEngine()?.sampleFramePatch(px / W, py / H, 0);
      if (patch) {
        sampled = hexOf([patch.data[0], patch.data[1], patch.data[2]]);
        st.addRecentColor(sampled);
        activePick.onPick?.(sampled);
      } else {
        st.notify("Seek preview to a frame to sample a colour.", "info");
      }
      return;
    }
    if (playing) return;
    const handle = (e.target as Element).closest("[data-handle]")?.getAttribute("data-handle");
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
    if (!d) {
      if (getStudio().picking) updatePickingLoupe(e);
      return;
    }
    if (d.mode === "compare") {
      const r = ref.current!.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left) / Math.max(1, r.width), 0.04, 0.96);
      getStudio().set({ compareX: Math.round(nx * 1000) / 1000 });
      return;
    }
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
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.mode === "compare") return;
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
            <circle data-handle="rot" cx={rot[0]} cy={rot[1]} r={16} className="pointer-events-auto cursor-grab fill-transparent" />
            <circle cx={rot[0]} cy={rot[1]} r={6} className="pointer-events-none fill-ink stroke-accent" strokeWidth={1.5} />
            {HANDLES.map(([id, u, v]) => {
              const [x, y] = pt(u * hw, v * hh);
              return (
                <g key={id}>
                  <rect data-handle={id} x={x - 12} y={y - 12} width={24} height={24} className="pointer-events-auto fill-transparent" style={{ cursor: id.length === 2 ? "nwse-resize" : u ? "ew-resize" : "ns-resize" }} />
                  <rect x={x - 5} y={y - 5} width={10} height={10} className="pointer-events-none fill-paper stroke-accent" strokeWidth={1.5} />
                </g>
              );
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
      onPointerLeave={() => {
        if (loupeWrapRef.current) loupeWrapRef.current.style.display = "none";
      }}
    >
      <div
        ref={loupeWrapRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 z-40 flex flex-col items-center"
        style={{ display: "none", willChange: "transform" }}
      >
        <canvas ref={loupeCanvasRef} width={110} height={110} className="size-[110px] rounded-full border-2 border-paper shadow-float" style={{ imageRendering: "pixelated" }} />
        <span ref={loupeHexRef} className="mt-1 rounded-sm px-1.5 py-0.5 font-mono text-[11px] shadow-card" />
      </div>
      {guideMode === "broadcast" && (
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
      {guideMode === "golden" && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {[0.382, 0.618].map((f) => (
            <g key={f}>
              <line x1={w * f} y1={0} x2={w * f} y2={h} className="stroke-warning/50" strokeDasharray="4 3" />
              <line x1={0} y1={h * f} x2={w} y2={h * f} className="stroke-warning/50" strokeDasharray="4 3" />
            </g>
          ))}
          <line x1={w / 2} y1={0} x2={w / 2} y2={h} className="stroke-paper/20" strokeDasharray="2 4" />
          <line x1={0} y1={h / 2} x2={w} y2={h / 2} className="stroke-paper/20" strokeDasharray="2 4" />
        </svg>
      )}
      {(guideMode === "reels" || guideMode === "tiktok" || guideMode === "shorts") && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {(() => {
            const topF = guideMode === "reels" ? 0.14 : 0.12;
            const botF = guideMode === "tiktok" ? 0.26 : guideMode === "shorts" ? 0.24 : 0.22;
            const rightF = guideMode === "tiktok" ? 0.17 : 0.16;
            return (
              <>
                <rect x={0} y={0} width={w} height={h * topF} className="fill-danger/20" />
                <rect x={0} y={h * (1 - botF)} width={w} height={h * botF} className="fill-danger/20" />
                <rect x={w * (1 - rightF)} y={h * topF} width={w * rightF} height={h * (1 - topF - botF)} className="fill-danger/20" />
                <rect x={w * 0.04} y={h * topF} width={w * (1 - rightF - 0.04)} height={h * (1 - topF - botF)} className="fill-none stroke-success/80" strokeDasharray="5 4" strokeWidth={1.25} />
              </>
            );
          })()}
        </svg>
      )}
      {(guides.x || guides.y) && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {guides.x && <line x1={w / 2} y1={0} x2={w / 2} y2={h} className="stroke-accent" strokeDasharray="5 4" />}
          {guides.y && <line x1={0} y1={h / 2} x2={w} y2={h / 2} className="stroke-accent" strokeDasharray="5 4" />}
        </svg>
      )}
      {box}
      {compare && (
        <div
          data-compare-wipe
          role="slider"
          aria-label="Before and after split wipe"
          aria-valuemin={4}
          aria-valuemax={96}
          aria-valuenow={Math.round(compareX * 100)}
          className="absolute inset-y-0 z-30 -ml-4 w-8 cursor-ew-resize touch-none"
          style={{ left: `${compareX * 100}%` }}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-paper shadow-[0_0_6px_rgba(0,0,0,0.75)]" />
          <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-paper/80 bg-ink/90 px-2 font-mono text-[12px] font-medium uppercase tracking-wider text-paper shadow-float">
            ↔
          </span>
        </div>
      )}
      {compare && (
        <>
          <span className="pointer-events-none absolute left-2 top-2 z-20 rounded-sm bg-ink/80 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-wider text-paper">Before</span>
          <span className="pointer-events-none absolute right-2 top-2 z-20 rounded-sm bg-ink/80 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-wider text-accent">After</span>
        </>
      )}
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

const GUIDE_OPTIONS: { value: GuideMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "broadcast", label: "Safe / 3rds" },
  { value: "golden", label: "Golden Phi" },
  { value: "reels", label: "IG Reels" },
  { value: "tiktok", label: "TikTok UI" },
  { value: "shorts", label: "YT Shorts" },
];

function Transport({ compact = false }: { compact?: boolean }) {
  const { playing, playhead, fps, loop, quality, guides, compare, scopes, checkerboard, colorPickerOpen } = useStudio(
    useShallow((s) => ({
      playing: s.playing,
      playhead: s.playhead,
      fps: s.project.settings.fps,
      loop: s.loop,
      quality: s.quality,
      guides: s.guides,
      compare: s.compare,
      scopes: s.scopes,
      checkerboard: s.checkerboard,
      colorPickerOpen: s.colorPickerOpen,
    })),
  );
  const duration = useStudio((s) => projectDuration(s.project));
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const st = getStudio();

  useEffect(() => {
    if (!viewOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!viewRef.current?.contains(e.target as Node)) setViewOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [viewOpen]);

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

  if (compact) {
    const activeView = guides !== "off" || scopes || loop || quality !== "full";
    return (
      <div ref={viewRef} className="relative flex h-12 shrink-0 items-center justify-between gap-1 border-t border-line-dark bg-ink-raised px-2">
        <p className="min-w-0 shrink-0 whitespace-nowrap font-mono text-[12px] tabular-nums tracking-tight text-paper">
          {shortTime(playhead)}
          <span className="text-paper-dim"> / {shortTime(duration)}</span>
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Previous frame" onClick={() => st.stepFrames(-1)} className="max-sm:size-8">
            <StepBack aria-hidden className="size-4" />
          </IconButton>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => st.togglePlay()}
            className="mx-0.5 inline-flex size-10 items-center justify-center rounded-full bg-paper text-ink transition-transform active:scale-95"
          >
            {playing ? <Pause aria-hidden className="size-4 fill-current" /> : <Play aria-hidden className="ml-0.5 size-4 fill-current" />}
          </button>
          <IconButton label="Next frame" onClick={() => st.stepFrames(1)} className="max-sm:size-8">
            <StepForward aria-hidden className="size-4" />
          </IconButton>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1">
          <IconButton label="Before / After split grade wipe" active={compare} onClick={() => st.set({ compare: !compare })} className="max-sm:size-8">
            <SquareSplitHorizontal aria-hidden className="size-4" />
          </IconButton>
          <button
            type="button"
            aria-expanded={viewOpen}
            aria-label="Monitor display and playback options"
            onClick={() => setViewOpen((v) => !v)}
            className={cn(
              "relative inline-flex h-9 items-center gap-1 rounded-sm border px-2 text-[12px] font-medium transition-colors",
              viewOpen ? "border-paper bg-paper text-ink" : "border-line-dark text-paper hover:bg-paper/10",
            )}
          >
            <SlidersHorizontal aria-hidden className="size-3.5" />
            <span>View</span>
            {activeView && !viewOpen && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
          </button>
        </div>
        {viewOpen && (
          <div
            role="dialog"
            aria-label="Monitor options"
            className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-[min(344px,calc(100vw-16px))] -translate-x-1/2 rounded-lg border border-line-dark bg-ink-raised p-3 shadow-float"
          >
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  st.set({ playhead: 0, playing: false });
                  setViewOpen(false);
                }}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-sm border border-line-dark text-[12px] text-paper hover:bg-paper/10"
              >
                <ChevronFirst aria-hidden className="size-3.5" />
                Start
              </button>
              <button
                type="button"
                onClick={() => {
                  st.set({ playhead: frameRound(duration, fps), playing: false });
                  setViewOpen(false);
                }}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-sm border border-line-dark text-[12px] text-paper hover:bg-paper/10"
              >
                End
                <ChevronLast aria-hidden className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void snapshot();
                  setViewOpen(false);
                }}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-sm border border-line-dark text-[12px] text-paper hover:bg-paper/10"
              >
                <Camera aria-hidden className="size-3.5" />
                Still
              </button>
            </div>
            <p className="label-mono mb-1.5 mt-3 text-paper-dim">Safe-zone guides</p>
            <div className="grid grid-cols-3 gap-1">
              {GUIDE_OPTIONS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  aria-pressed={guides === g.value}
                  onClick={() => st.set({ guides: g.value })}
                  className={cn(
                    "h-8 rounded-sm border px-1 text-[12px] transition-colors",
                    guides === g.value ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:text-paper",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                aria-pressed={scopes}
                onClick={() => st.set({ scopes: !scopes })}
                className={cn(
                  "h-9 rounded-sm border text-[12px] transition-colors",
                  scopes ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:text-paper",
                )}
              >
                Scopes: {scopes ? "On" : "Off"}
              </button>
              <button
                type="button"
                aria-pressed={loop}
                onClick={() => st.set({ loop: !loop })}
                className={cn(
                  "h-9 rounded-sm border text-[12px] transition-colors",
                  loop ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:text-paper",
                )}
              >
                Loop: {loop ? "On" : "Off"}
              </button>
              <button
                type="button"
                aria-pressed={checkerboard}
                onClick={() => st.set({ checkerboard: !checkerboard })}
                className={cn(
                  "col-span-2 h-8 rounded-sm border text-[12px] transition-colors",
                  checkerboard ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:text-paper",
                )}
              >
                Transparency Grid: {checkerboard ? "On" : "Off"}
              </button>
            </div>
            <p className="label-mono mb-1.5 mt-3 text-paper-dim">Playback quality</p>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { value: "full", label: "Full" },
                  { value: "half", label: "1/2 Res" },
                  { value: "quarter", label: "1/4 Res" },
                ] as const
              ).map((q) => (
                <button
                  key={q.value}
                  type="button"
                  aria-pressed={quality === q.value}
                  onClick={() => st.set({ quality: q.value })}
                  className={cn(
                    "h-8 rounded-sm border text-[12px] transition-colors",
                    quality === q.value ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:text-paper",
                  )}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    // A size container with horizontal scroll on desktop/tablet viewports so nothing clips.
    <div className="@container flex items-center gap-0.5 overflow-x-auto no-scrollbar border-t border-line-dark bg-ink-raised px-1.5 py-1 @min-[36rem]:gap-1 @min-[36rem]:px-2" data-lenis-prevent>
      <div className="flex shrink-0 items-center">
        <IconButton label="Go to start (Home)" onClick={() => st.set({ playhead: 0, playing: false })} className="@max-[38rem]:hidden">
          <ChevronFirst aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Previous frame (←)" onClick={() => st.stepFrames(-1)} className="@max-[34rem]:size-7">
          <StepBack aria-hidden className="size-4" />
        </IconButton>
        <button
          type="button"
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={() => st.togglePlay()}
          className="mx-0.5 inline-flex size-10 items-center justify-center rounded-full bg-paper text-ink transition-transform hover:scale-105 sm:size-9"
        >
          {playing ? <Pause aria-hidden className="size-4 fill-current" /> : <Play aria-hidden className="ml-0.5 size-4 fill-current" />}
        </button>
        <IconButton label="Next frame (→)" onClick={() => st.stepFrames(1)} className="@max-[34rem]:size-7">
          <StepForward aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Go to end (End)" onClick={() => st.set({ playhead: frameRound(duration, fps), playing: false })} className="@max-[38rem]:hidden">
          <ChevronLast aria-hidden className="size-4" />
        </IconButton>
      </div>
      <p className="ml-0.5 shrink-0 font-mono text-[12px] tabular-nums text-paper @min-[36rem]:ml-1">
        {timecode(playhead, fps)}
        <span className="text-paper-dim @max-[36rem]:hidden"> / {timecode(duration, fps)}</span>
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 @min-[36rem]:gap-1">
        <div className="@max-[38rem]:hidden">
          <Meter />
        </div>
        <IconButton label="Loop playback" active={loop} onClick={() => st.set({ loop: !loop })} className="@max-[34rem]:size-7">
          <Repeat aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Transparency checkerboard" active={checkerboard} onClick={() => st.set({ checkerboard: !checkerboard })} className="@max-[34rem]:size-7">
          <Grid2x2 aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Color picker & eyedropper (Shift+I)" active={colorPickerOpen} onClick={() => st.set({ colorPickerOpen: !colorPickerOpen })} className="@max-[34rem]:size-7">
          <Pipette aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Before / After split grade wipe (Shift+C)" active={compare} onClick={() => st.set({ compare: !compare })} className="@max-[34rem]:size-7">
          <SquareSplitHorizontal aria-hidden className="size-4" />
        </IconButton>
        <Select<GuideMode>
          label="Safe zones and guides"
          value={guides}
          onChange={(v) => st.set({ guides: v })}
          className="w-[100px] flex-none @min-[36rem]:w-[106px]"
          options={GUIDE_OPTIONS.map((o) => ({ value: o.value, label: o.value === "off" ? "Guides: Off" : o.label }))}
        />
        <IconButton label="Save this frame as PNG" onClick={() => void snapshot()} className="@max-[34rem]:size-7">
          <Camera aria-hidden className="size-4" />
        </IconButton>
        <Select
          label="Preview quality"
          value={quality}
          onChange={(v) => st.set({ quality: v })}
          className="w-[58px] flex-none @min-[36rem]:w-[66px]"
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

export function Preview({ compact = false }: { compact?: boolean }) {
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
        </div>
        {empty && !error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-4 text-center">
            <p className="text-[14px] font-medium text-paper sm:text-[15px]">Start your video</p>
            <p className="max-w-xs text-[12px] leading-relaxed text-paper-dim">Private &amp; on-device. Drop footage or add a title to begin.</p>
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-paper px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-paper/85"
              >
                <Upload aria-hidden className="size-4" />
                Import media
              </button>
              <button
                type="button"
                onClick={() => getStudio().addText(TEXT_PRESETS[0].id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-dark bg-ink-raised/90 px-3 text-[13px] font-medium text-paper transition-colors hover:border-paper/40 hover:bg-ink-raised"
              >
                <Type aria-hidden className="size-4" />
                Add title
              </button>
            </div>
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
        {scopes && <VideoScopes />}
      </div>
      <Transport compact={compact} />
    </div>
  );
}
