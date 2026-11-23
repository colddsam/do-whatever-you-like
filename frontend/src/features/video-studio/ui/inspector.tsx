"use client";

import { createElement, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AudioLines,
  Bookmark,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Crosshair,
  Download,
  FileArchive,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Gauge,
  Grid2x2,
  Image as ImageIcon,
  Link2,
  Link2Off,
  LoaderCircle,
  Pipette,
  Plus,
  Rewind,
  RotateCcw,
  Scissors,
  Snowflake,
  Sparkles,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ASPECTS,
  CAPTION_STYLES,
  CHROMA_PRESETS,
  CLIP_MOTION_PRESETS,
  DEFAULT_TRANSITION_DURATION,
  EFFECT_CATEGORIES,
  EFFECT_CHOICES,
  EFFECT_ORDER,
  EFFECTS,
  FONTS,
  FPS_CHOICES,
  nearestWeight,
  PROJECT_ACCEPT,
  SPEED_PRESETS,
  TEXT_ANIMATIONS,
  TRANSITIONS,
  VOICE_EFFECTS,
} from "../constants";
import { evalAnim, isAnimated, keyAt, KEY_EPS } from "../lib/keyframes";
import { formatValue, getAnim, propSpec, type PropPath } from "../lib/props";
import { rateAt } from "../lib/speed";
import { clamp, dbToGain, formatBytes, gainToDb, rt, shortTime } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import type { AspectId, AudioFx, CaptionStyleId, Clip, ClipMotionPresetId, Effect, EffectType, ShapeType, TextAnimation, TrackMatteMode, TransitionType, VoiceEffect } from "../types";
import { applyTrackToClip } from "../engine/ai/tracker";
import { audioFxOf } from "../engine/audio-fx";
import { freezeFrame, rasterizeClip, reverseClip } from "../engine/clip-tools";
import { getEngine } from "../engine/playback";
import { exportGradeAsCube } from "../engine/color";
import { addGoogleFont, getCustomFonts, importCustomFont, removeCustomFont, subscribeFonts, weightsForFont, type CustomFontInfo } from "../engine/fonts";
import { openExternalProjectFile } from "../engine/interop";
import { BUILTIN_LUTS, importCube, userLuts, type LutInfo } from "../engine/luts";
import { exportPackage } from "../engine/package";
import { listProjects, newProject, openProject } from "../engine/persistence";
import { storageEstimate } from "../engine/storage";
import { download } from "../engine/subtitles";
import { JobLine, runJob } from "./ai-panel";
import { ANIMATION_ICON, CATEGORY_ICON, LAYOUT_ICON, MOTION_ICON, SHAPE_ICON, SPEED_ICON, TRANSITION_ICON, VOICE_ICON } from "./catalog";
import { ColorWheelsControl, CurvesControl, HslMixerControl } from "./color-grading";
import { ColorField, Empty, IconButton, KeyButton, Row, Scrub, Section, Segmented, Select, Slider, TextButton, Toggle } from "./controls";
import { canTake, EffectGlyph, EffectTile, LooksGrid } from "./effects-panel";
import { KeyframeEditor } from "./keyframes";

const EMPTY_FONTS: CustomFontInfo[] = [];

/* ---------- Animatable rows ---------- */

function useLocal(c: Clip) {
  const playhead = useStudio((s) => s.playhead);
  return clamp(playhead - c.start, 0, c.duration);
}

/** The keyframe diamond for a property (`also`: a second property keyed in step, like Scale Y with X). */
export function KeyControls({ c, path, label, also }: { c: Clip; path: PropPath; label: string; also?: PropPath }) {
  const local = useLocal(c);
  const a = getAnim(c, path);
  if (!a) return null;
  const st = getStudio();
  const state = !isAnimated(a) ? "off" : keyAt(a, local) ? "key" : "animated";
  const keys = a.k ?? [];
  const prev = [...keys].reverse().find((k) => k.t < local - KEY_EPS);
  const next = keys.find((k) => k.t > local + KEY_EPS);
  const toggle = (p: PropPath) => (state === "off" ? st.toggleAnimated(c.id, p) : st.toggleKey(c.id, p));
  return (
    <KeyButton
      label={label}
      state={state}
      onClick={() => {
        st.begin();
        toggle(path);
        if (also) toggle(also);
        st.end();
      }}
      onPrev={prev ? () => st.set({ playing: false, playhead: rt(c.start + prev.t), activeProp: path }) : undefined}
      onNext={next ? () => st.set({ playing: false, playhead: rt(c.start + next.t), activeProp: path }) : undefined}
    />
  );
}

function PropRow({ c, path }: { c: Clip; path: PropPath }) {
  const frame = useStudio(useShallow((s) => ({ width: s.project.settings.width, height: s.project.settings.height })));
  const local = useLocal(c);
  const a = getAnim(c, path);
  if (!a) return null;
  const spec = propSpec(c, path, frame);
  const st = getStudio();
  return (
    <Row
      label={
        <button type="button" className="truncate text-left hover:text-paper" title="Show in the graph editor" onClick={() => st.set({ activeProp: path, rightTab: "animate" })}>
          {spec.label.replace(/^.* · /, "")}
        </button>
      }
    >
      <Scrub
        label={spec.label}
        value={evalAnim(a, local)}
        step={spec.step}
        min={spec.min}
        max={spec.max}
        format={(v) => formatValue(spec, v)}
        parse={(s) => (spec.display ? Number(s) / 100 : Number(s))}
        onChange={(v) => st.setProp(c.id, path, v)}
        onStart={st.begin}
        onEnd={st.end}
        className="flex-1"
      />
      <KeyControls c={c} path={path} label={spec.label} />
    </Row>
  );
}

function SliderRow({ c, path, neutral }: { c: Clip; path: PropPath; neutral?: number }) {
  const frame = useStudio(useShallow((s) => ({ width: s.project.settings.width, height: s.project.settings.height })));
  const local = useLocal(c);
  const a = getAnim(c, path);
  if (!a) return null;
  const spec = propSpec(c, path, frame);
  const v = evalAnim(a, local);
  const st = getStudio();
  return (
    <Row label={spec.label.replace(/^.* · /, "")}>
      <Slider label={spec.label} value={v} min={spec.min} max={spec.max} step={spec.step} neutral={neutral} onChange={(x) => st.setProp(c.id, path, x)} onStart={st.begin} onEnd={st.end} />
      <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{formatValue(spec, v)}</span>
      <KeyControls c={c} path={path} label={spec.label} />
    </Row>
  );
}

/** A grid of small icon tiles to pick one option from (animations, voices, transitions…). */
function IconGrid<T extends string>({ value, options, onPick, cols = 3 }: { value: T | null; options: { id: T; label: string; icon: LucideIcon; hint?: string }[]; onPick: (id: T) => void; cols?: 3 | 4 }) {
  return (
    <div className={cn("grid gap-1", cols === 4 ? "grid-cols-4" : "grid-cols-3")}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.hint ? `${o.label}: ${o.hint}` : o.label}
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={cn("flex min-w-0 flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[12px] leading-tight", value === o.id ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:border-paper/40 hover:text-paper")}
        >
          {createElement(o.icon, { "aria-hidden": true, className: "size-4 shrink-0" })}
          <span className="w-full truncate text-center">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Speed ---------- */

/** The speed curve, drawn on a log scale (0.1× to 10×); drag points up/down (and sideways), double-click to add or remove. */
function SpeedCurve({ c }: { c: Clip }) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(260);
  const drag = useRef<number | null>(null);
  const st = getStudio();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 96;
  const pad = 8;
  const r = c.speedRamp;
  if (!r) return null;
  const D = Math.max(1e-6, c.duration);
  const toY = (v: number) => pad + (1 - (Math.log10(clamp(v, 0.1, 10)) + 1) / 2) * (H - 2 * pad);
  const fromY = (y: number) => Math.pow(10, (1 - (y - pad) / (H - 2 * pad)) * 2 - 1);
  const toX = (t: number) => pad + (t / D) * (w - 2 * pad);
  const shape = (pts: { t: number; v: number }[]) => pts.map((p) => [clamp(p.t / D, 0, 1), clamp(p.v, 0.1, 10)] as [number, number]);
  const path = r.map((p, i) => `${i ? "L" : "M"}${toX(p.t).toFixed(1)},${toY(p.v).toFixed(1)}`).join(" ");
  const local = clamp(st.playhead - c.start, 0, D);
  const pos = (e: React.PointerEvent | React.MouseEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - b.left - pad) / (w - 2 * pad), 0, 1), y: e.clientY - b.top };
  };
  return (
    <svg
      ref={ref}
      role="img"
      aria-label="Speed curve"
      className="mt-1 h-24 w-full touch-none rounded-sm border border-line-dark bg-ink"
      onDoubleClick={(e) => {
        const { x, y } = pos(e);
        const pts = [...shape(r), [x, fromY(y)] as [number, number]].sort((a, b) => a[0] - b[0]);
        st.setRampShape(c.id, pts);
      }}
      onPointerMove={(e) => {
        const i = drag.current;
        if (i === null) return;
        const { x, y } = pos(e);
        const pts = shape(r);
        const first = i === 0;
        const last = i === pts.length - 1;
        pts[i] = [first ? 0 : last ? 1 : clamp(x, pts[i - 1][0] + 0.01, pts[i + 1][0] - 0.01), clamp(Math.round(fromY(y) * 100) / 100, 0.1, 10)];
        st.setRampShape(c.id, pts);
      }}
      onPointerUp={() => {
        if (drag.current !== null) st.end();
        drag.current = null;
      }}
    >
      {[0.25, 0.5, 1, 2, 4].map((v) => (
        <g key={v}>
          <line x1={pad} x2={w - pad} y1={toY(v)} y2={toY(v)} stroke="currentColor" className={v === 1 ? "text-paper/30" : "text-paper/10"} strokeDasharray={v === 1 ? undefined : "2 3"} />
          <text x={w - pad - 2} y={toY(v) - 2} textAnchor="end" className="fill-paper-dim font-mono text-[12px]">
            {v}×
          </text>
        </g>
      ))}
      <line x1={toX(local)} x2={toX(local)} y1={0} y2={H} className="text-accent/70" stroke="currentColor" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-paper" />
      {r.map((p, i) => (
        <circle
          key={i}
          cx={toX(p.t)}
          cy={toY(p.v)}
          r={5}
          className="cursor-grab fill-accent stroke-ink"
          strokeWidth={1.5}
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
            drag.current = i;
            st.begin();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (i === 0 || i === r.length - 1) return;
            st.setRampShape(
              c.id,
              shape(r).filter((_, k) => k !== i),
            );
          }}
        >
          <title>{`${p.v.toFixed(2)}× at ${p.t.toFixed(2)} s`}</title>
        </circle>
      ))}
    </svg>
  );
}

function TimingSection({ c }: { c: Clip }) {
  const fps = useStudio((s) => s.project.settings.fps);
  const st = getStudio();
  const media = c.kind === "video" || c.kind === "audio";
  const local = useLocal(c);
  const moveTo = (t: number) =>
    st.commit((p) => {
      const ids = TL.withLinked(p, [c.id]);
      const dt = Math.max(0, t) - c.start;
      return TL.moveClips(p, ids.map((id) => ({ id, start: p.clips[id].start + dt, trackId: p.clips[id].trackId })));
    });
  const presetIds = Object.keys(SPEED_PRESETS);
  return (
    <Section title="Timing and speed">
      <Row label="Start">
        <Scrub label="Start" value={c.start} step={1 / fps} min={0} format={(v) => `${v.toFixed(2)} s`} onChange={moveTo} onStart={st.begin} onEnd={st.end} className="flex-1" />
      </Row>
      <Row label="Duration">
        <Scrub label="Duration" value={c.duration} step={1 / fps} min={1 / fps} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => st.commit((p) => TL.trimClip(p, c.id, "end", c.start + v))} onStart={st.begin} onEnd={st.end} className="flex-1" />
      </Row>
      {media && (
        <>
          <Row label="Speed">
            <Segmented
              label="Speed"
              value={c.speedRamp ? "" : String(c.speed)}
              onChange={(v) => st.setSpeed(c.id, Number(v))}
              options={["0.25", "0.5", "1", "2", "4"].map((v) => ({ value: v, label: `${v}×` }))}
            />
          </Row>
          {!c.speedRamp && (
            <Row label="">
              <Scrub label="Exact speed" value={c.speed} step={0.05} min={0.1} max={16} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => st.setSpeed(c.id, v)} className="flex-1" />
            </Row>
          )}
          <p className="label-mono mb-1 mt-2 flex items-center gap-1.5 text-paper-dim">
            <Gauge aria-hidden className="size-3.5" />
            Speed curve
          </p>
          <IconGrid
            cols={3}
            value={null}
            onPick={(id: string) => st.applySpeedRamp(c.id, id === "none" ? null : id)}
            options={[
              ...presetIds.map((id) => ({ id, label: SPEED_PRESETS[id].label, hint: SPEED_PRESETS[id].hint, icon: SPEED_ICON[id] ?? Gauge })),
              { id: "none", label: "Normal", hint: "Back to a constant 1×", icon: RotateCcw },
            ]}
          />
          {c.speedRamp && (
            <>
              <SpeedCurve c={c} />
              <p className="mt-1 font-mono text-[12px] text-paper-dim">
                Now {rateAt(c, local).toFixed(2)}× · average {c.speed.toFixed(2)}× · double-click to add or remove points
              </p>
            </>
          )}
          <Row label="Source in">
            <span className="font-mono text-[12px] text-paper-dim">
              {shortTime(c.in)}
              {c.reversed ? " · reversed" : ""}
            </span>
          </Row>
        </>
      )}
    </Section>
  );
}

/* ---------- Transform ---------- */

const LAYOUTS: { id: TL.Layout; label: string; hint: string }[] = [
  { id: "full", label: "Fill", hint: "Fill the frame (crop the edges)" },
  { id: "fit", label: "Fit", hint: "Whole picture, centred" },
  { id: "pip-tl", label: "PiP ↖", hint: "Small, top left" },
  { id: "pip-tr", label: "PiP ↗", hint: "Small, top right" },
  { id: "pip-bl", label: "PiP ↙", hint: "Small, bottom left" },
  { id: "pip-br", label: "PiP ↘", hint: "Small, bottom right" },
  { id: "pip-framed", label: "PiP framed", hint: "Bottom-right PiP with rounded border & shadow" },
  { id: "split-h", label: "Side by side", hint: "Select two clips on different tracks" },
  { id: "split-v", label: "Stacked", hint: "Select two clips on different tracks" },
  { id: "split-3h", label: "3 columns", hint: "Select three clips on different tracks" },
  { id: "split-3v", label: "3 rows", hint: "Select three clips on different tracks" },
  { id: "grid", label: "2×2 grid", hint: "Select up to four clips" },
];

const BLENDS = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "softLight",
  "hardLight",
  "add",
  "darken",
  "lighten",
  "difference",
  "exclusion",
  "colorBurn",
  "colorDodge",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
const BLEND_LABEL: Record<(typeof BLENDS)[number], string> = {
  normal: "Normal",
  multiply: "Multiply",
  screen: "Screen",
  overlay: "Overlay",
  softLight: "Soft light",
  hardLight: "Hard light",
  add: "Add",
  darken: "Darken",
  lighten: "Lighten",
  difference: "Difference",
  exclusion: "Exclusion",
  colorBurn: "Colour burn",
  colorDodge: "Colour dodge",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

function TransformSection({ c }: { c: Clip }) {
  const [linked, setLinked] = useState(true);
  const local = useLocal(c);
  const selection = useStudio((s) => s.selection);
  const trackingPick = useStudio((s) => s.trackingPick);
  const trackedSources = useStudio(useShallow((s) => Object.values(s.project.clips).filter((x) => x.trackData && x.id !== c.id)));
  const st = getStudio();
  const sx = evalAnim(c.transform.scaleX, local);
  const sy = evalAnim(c.transform.scaleY, local);
  const media = c.kind === "video" || c.kind === "image";
  return (
    <Section
      title="Transform"
      actions={
        <IconButton
          label="Reset transform"
          onClick={() => st.resetTransform(c.id)}
          className="size-7"
        >
          <RotateCcw aria-hidden className="size-3.5" />
        </IconButton>
      }
    >
      <PropRow c={c} path="x" />
      <PropRow c={c} path="y" />
      {linked ? (
        <Row label="Scale">
          <Scrub
            label="Scale"
            value={sx}
            step={0.01}
            min={-10}
            max={10}
            format={(v) => `${Math.round(v * 100)}%`}
            parse={(s) => Number(s) / 100}
            onChange={(v) => {
              st.setProp(c.id, "scaleX", v, "scale");
              st.setProp(c.id, "scaleY", sx ? (sy * v) / sx : v, "scale");
            }}
            onStart={st.begin}
            onEnd={st.end}
            className="flex-1"
          />
          <IconButton label="Scale X and Y separately" onClick={() => setLinked(false)} className="size-6">
            <Link2 aria-hidden className="size-3.5" />
          </IconButton>
          <KeyControls c={c} path="scaleX" also="scaleY" label="Scale" />
        </Row>
      ) : (
        <>
          <Row label="">
            <IconButton label="Link scale" onClick={() => setLinked(true)} className="size-6">
              <Link2Off aria-hidden className="size-3.5" />
            </IconButton>
          </Row>
          <PropRow c={c} path="scaleX" />
          <PropRow c={c} path="scaleY" />
        </>
      )}
      <PropRow c={c} path="rotation" />
      <SliderRow c={c} path="opacity" />
      <Row label="Flip">
        <IconButton label="Flip horizontally (mirror)" active={!!c.flipH} onClick={() => st.flip([c.id], "h")} className="size-7">
          <FlipHorizontal2 aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Flip vertically" active={!!c.flipV} onClick={() => st.flip([c.id], "v")} className="size-7">
          <FlipVertical2 aria-hidden className="size-4" />
        </IconButton>
      </Row>
      {media && (
        <Row label="Fit">
          <Segmented
            label="Fit in frame"
            value={c.fit}
            onChange={(v) => st.updateClip(c.id, { fit: v })}
            options={[
              { value: "contain", label: "Fit", title: "Whole picture visible" },
              { value: "cover", label: "Fill", title: "Fill the frame, crop the edges" },
              { value: "fill", label: "Stretch", title: "Stretch to the frame" },
            ]}
          />
        </Row>
      )}
      <Row label="Blend">
        <Select label="Blend mode" value={c.blend} onChange={(v) => st.updateClip(c.id, { blend: v })} options={BLENDS.map((b) => ({ value: b, label: BLEND_LABEL[b] }))} />
      </Row>
      <Row label="Track matte">
        <Select<TrackMatteMode>
          label="Track matte"
          value={c.matte ?? "none"}
          onChange={(v) => st.updateClip(c.id, { matte: v === "none" ? undefined : v })}
          options={[
            { value: "none", label: "None" },
            { value: "alpha", label: "Alpha matte (track above)" },
            { value: "alphaInv", label: "Alpha inverted (track above)" },
            { value: "luma", label: "Luma matte (track above)" },
            { value: "lumaInv", label: "Luma inverted (track above)" },
          ]}
        />
      </Row>
      <Row label="Fade in / out">
        <Scrub label="Fade in" value={c.fadeIn} step={0.05} min={0} max={10} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => st.updateClip(c.id, { fadeIn: v }, `fadein:${c.id}`)} className="flex-1" />
        <Scrub label="Fade out" value={c.fadeOut} step={0.05} min={0} max={10} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => st.updateClip(c.id, { fadeOut: v }, `fadeout:${c.id}`)} className="flex-1" />
      </Row>
      {c.kind === "video" && (
        <div className="mt-2 rounded-md border border-line-dark p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="label-mono text-paper-dim">2D Motion Tracker</span>
            {c.trackData && (
              <button type="button" onClick={() => st.updateClip(c.id, { trackData: undefined })} className="text-[12px] text-paper-dim hover:text-paper">
                Clear
              </button>
            )}
          </div>
          <TextButton
            tone={trackingPick === c.id ? "primary" : undefined}
            className="mt-1.5 w-full"
            onClick={() => {
              const next = trackingPick === c.id ? null : c.id;
              st.set({ trackingPick: next });
              if (next) st.notify("Click the point on the preview video you want to track.", "info");
            }}
          >
            <Crosshair aria-hidden className="size-3.5" />
            {trackingPick === c.id ? "Click a point on the preview…" : c.trackData ? "Re-pick & track point" : "Pick & track 2D point"}
          </TextButton>
          {c.trackData && (
            <p className="mt-1 font-mono text-[12px] text-paper-dim">
              Tracked {c.trackData.dx.length} frames from ({Math.round(c.trackData.x * 100)}%, {Math.round(c.trackData.y * 100)}%)
            </p>
          )}
          <JobLine id="track" />
        </div>
      )}
      {c.kind !== "video" && trackedSources.length > 0 && (
        <div className="mt-2 space-y-1">
          {trackedSources.map((src) => (
            <TextButton
              key={src.id}
              className="w-full"
              onClick={() => {
                try {
                  applyTrackToClip(src.id, c.id);
                  st.notify(`Pinned "${c.name}" to tracked motion from "${src.name}".`, "success");
                } catch (err) {
                  st.notify(err instanceof Error ? err.message : "Couldn't attach track.", "warning");
                }
              }}
            >
              <Crosshair aria-hidden className="size-3.5" />
              Attach to track: {src.name}
            </TextButton>
          ))}
        </div>
      )}
      {media && (
        <>
          <Row label="Canvas blur">
            <Slider label="Blurred background behind the clip" value={c.backdrop ?? 0} min={0} max={80} step={1} onChange={(v) => st.updateClip(c.id, { backdrop: v || undefined }, `backdrop:${c.id}`)} />
            <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{c.backdrop ? `${c.backdrop}px` : "Off"}</span>
          </Row>
          <p className="label-mono mb-1 mt-2 text-paper-dim">Layout</p>
          <IconGrid
            cols={3}
            value={null}
            onPick={(id: TL.Layout) => st.applyLayout(selection.length ? selection : [c.id], id)}
            options={LAYOUTS.map((l) => ({ id: l.id, label: l.label, hint: l.hint, icon: LAYOUT_ICON[l.id] }))}
          />
        </>
      )}
      <p className="label-mono mb-1 mt-3 text-paper-dim">1-Click motion presets</p>
      <IconGrid
        cols={3}
        value={null}
        onPick={(id: ClipMotionPresetId) => {
          st.applyMotionPreset(c.id, id);
          st.notify(id === "none" ? "Cleared motion keyframes." : `Applied ${CLIP_MOTION_PRESETS.find((x) => x.id === id)?.label ?? id} animation.`, "success");
        }}
        options={CLIP_MOTION_PRESETS.map((m) => ({ id: m.id, label: m.label, hint: m.hint, icon: MOTION_ICON[m.id] }))}
      />
    </Section>
  );
}

function StabilizeSection({ c }: { c: Clip }) {
  const st = getStudio();
  if (!c.stabilize) return null;
  return (
    <Section title="Stabilise">
      <Row label="Smoothing">
        <Slider label="Stabilisation strength" value={c.stabilize.strength} min={0} max={1} step={0.05} onChange={(v) => st.updateClip(c.id, (x) => (x.stabilize ? { ...x, stabilize: { ...x.stabilize, strength: v } } : x), `stab:${c.id}`)} />
        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{Math.round(c.stabilize.strength * 100)}%</span>
      </Row>
      <TextButton className="mt-1 w-full" onClick={() => st.updateClip(c.id, { stabilize: undefined })}>
        <X aria-hidden className="size-3.5" />
        Remove stabilisation
      </TextButton>
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">The picture is moved against the measured shake and zoomed in just enough to hide the edges.</p>
    </Section>
  );
}

/* ---------- Text, shapes, colour ---------- */

function TextSection({ c }: { c: Clip }) {
  const st = getStudio();
  const customFonts = useSyncExternalStore(subscribeFonts, getCustomFonts, () => EMPTY_FONTS);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const [gInput, setGInput] = useState("");
  const [fontBusy, setFontBusy] = useState(false);
  const t = c.text!;
  const s = t.style;
  const font = FONTS.find((f) => f.family === s.font);
  const availableWeights = weightsForFont(s.font);
  const canItalic = font?.italic || customFonts.some((f) => f.family === s.font && f.italic);
  const set = (patch: Partial<typeof s>, merge?: string) => st.updateText(c.id, patch, merge ?? `text:${c.id}:${Object.keys(patch).join()}`);

  const fontOptions = [
    ...customFonts
      .filter((cf, idx, arr) => arr.findIndex((x) => x.family === cf.family) === idx)
      .map((cf) => ({ value: cf.family, label: `${cf.family} · Custom (${cf.format.toUpperCase()})` })),
    ...FONTS.map((f) => ({ value: f.family, label: `${f.family} · ${f.category}` })),
  ];

  return (
    <Section title={t.words?.length ? "Caption" : "Text"}>
      <textarea
        aria-label="Text"
        value={t.text}
        rows={3}
        onChange={(e) => st.updateText(c.id, { text: e.target.value }, `text:${c.id}:content`)}
        onKeyDown={(e) => e.stopPropagation()}
        className="mb-2 w-full resize-y rounded-sm border border-line-dark bg-ink px-2 py-1.5 text-[13px] leading-snug text-paper outline-none focus-visible:border-accent"
      />
      <Row label="Font">
        <Select label="Font" value={s.font} onChange={(v) => set({ font: v, weight: nearestWeight(v, s.weight), italic: s.italic && !!FONTS.find((f) => f.family === v)?.italic })} options={fontOptions} />
        <IconButton label="Upload custom font (.ttf, .otf, .woff, .woff2)" onClick={() => fontFileRef.current?.click()} className="size-9 shrink-0 sm:size-7">
          <Upload aria-hidden className="size-3.5" />
        </IconButton>
        <input
          ref={fontFileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const info = await importCustomFont(f);
              set({ font: info.family, weight: info.weights[0] ?? 400, italic: Boolean(info.italic) });
              st.notify(`Loaded custom font "${info.family}".`, "success");
            } catch (err) {
              st.notify(err instanceof Error ? err.message : "Couldn't read that font file.", "danger");
            }
          }}
        />
      </Row>
      <div className="mb-1.5 flex items-center gap-1">
        <input
          aria-label="Add any Google Font by exact name"
          value={gInput}
          onChange={(e) => setGInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              if (!gInput.trim() || fontBusy) return;
              setFontBusy(true);
              void addGoogleFont(gInput)
                .then((info) => {
                  set({ font: info.family, weight: 400 });
                  setGInput("");
                  st.notify(`Added Google Font "${info.family}".`, "success");
                })
                .catch((err: unknown) => st.notify(err instanceof Error ? err.message : "Google Font not found.", "warning"))
                .finally(() => setFontBusy(false));
            }
          }}
          placeholder="Add Google Font (e.g. Syne, Unbounded)…"
          className="h-7 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-2 text-[12px] text-paper outline-none placeholder:text-paper-dim/60 focus-visible:border-accent"
        />
        <TextButton
          disabled={!gInput.trim() || fontBusy}
          onClick={() => {
            setFontBusy(true);
            void addGoogleFont(gInput)
              .then((info) => {
                set({ font: info.family, weight: 400 });
                setGInput("");
                st.notify(`Added Google Font "${info.family}".`, "success");
              })
              .catch((err: unknown) => st.notify(err instanceof Error ? err.message : "Google Font not found.", "warning"))
              .finally(() => setFontBusy(false));
          }}
        >
          {fontBusy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <Plus aria-hidden className="size-3.5" />}
          Font
        </TextButton>
      </div>
      {customFonts.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {customFonts.map((cf) => (
            <span key={cf.id} className="inline-flex items-center gap-1 rounded-sm border border-line-dark bg-ink px-1.5 py-0.5 text-[12px] text-paper-dim">
              <button type="button" onClick={() => set({ font: cf.family, weight: cf.weights[0] ?? 400 })} className="hover:text-paper">
                {cf.family}
              </button>
              <button type="button" aria-label={`Remove ${cf.family}`} onClick={() => void removeCustomFont(cf.id)} className="hover:text-danger">
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Row label="Weight">
        <Select label="Weight" value={String(s.weight)} onChange={(v) => set({ weight: Number(v) })} options={availableWeights.map((w) => ({ value: String(w), label: String(w) }))} />
        {canItalic && (
          <button type="button" aria-pressed={s.italic} onClick={() => set({ italic: !s.italic })} className={cn("h-9 shrink-0 rounded-sm px-2.5 text-[13px] italic sm:h-7 sm:px-2", s.italic ? "bg-paper text-ink" : "text-paper-dim hover:bg-paper/10")}>
            I
          </button>
        )}
        <button type="button" aria-pressed={s.uppercase} title="Uppercase" onClick={() => set({ uppercase: !s.uppercase })} className={cn("h-9 shrink-0 rounded-sm px-2.5 text-[12px] sm:h-7 sm:px-2", s.uppercase ? "bg-paper text-ink" : "text-paper-dim hover:bg-paper/10")}>
          AA
        </button>
      </Row>
      <Row label="Size">
        <Scrub label="Size" value={s.size} step={1} min={8} max={600} format={(v) => `${Math.round(v)} px`} onChange={(v) => set({ size: v })} className="flex-1" />
        <Segmented
          label="Align"
          value={s.align}
          onChange={(v) => set({ align: v })}
          options={[
            { value: "left", label: "L" },
            { value: "center", label: "C" },
            { value: "right", label: "R" },
          ]}
          className="max-w-[96px]"
        />
      </Row>
      <Row label="Colour">
        <ColorField label="Text colour" value={s.color} onChange={(v) => set({ color: v })} />
        <label className="ml-2 flex items-center gap-1.5 text-[12px] text-paper-dim">
          <Toggle label="Gradient fill" checked={!!s.gradientColor} onChange={(on) => set({ gradientColor: on ? "#eb4a10" : "" })} />
          Grad
        </label>
      </Row>
      {!!s.gradientColor && (
        <Row label="Grad end">
          <ColorField label="Gradient second colour" value={s.gradientColor} onChange={(v) => set({ gradientColor: v })} />
          <Scrub label="Gradient angle" value={s.gradientAngle ?? 90} step={5} min={0} max={360} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ gradientAngle: v })} className="w-14 flex-none" />
        </Row>
      )}
      <Row label="Spacing">
        <Scrub label="Line height" value={s.lineHeight} step={0.05} min={0.6} max={3} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ lineHeight: v })} className="flex-1" />
        <Scrub label="Letter spacing" value={s.letterSpacing} step={0.5} min={-20} max={60} format={(v) => `${v} px`} onChange={(v) => set({ letterSpacing: v })} className="flex-1" />
      </Row>
      <Row label="Wrap width">
        <Slider label="Wrap width" value={s.maxWidth} min={0.15} max={1} step={0.01} onChange={(v) => set({ maxWidth: v })} />
      </Row>
      <Row label="Arch curve">
        <Slider label="Text arc curve" value={s.curve ?? 0} min={-1} max={1} step={0.02} neutral={0} onChange={(v) => set({ curve: v })} />
        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{Math.round((s.curve ?? 0) * 100)}%</span>
      </Row>
      <Row label="3D Extrude">
        <Scrub label="3D depth" value={s.extrude ?? 0} step={1} min={0} max={32} format={(v) => `${Math.round(v)}px`} onChange={(v) => set({ extrude: v })} className="w-16 flex-none" />
        {(s.extrude ?? 0) > 0 && <ColorField label="Extrude colour" value={s.extrudeColor ?? "#14130e"} onChange={(v) => set({ extrudeColor: v })} />}
      </Row>
      <Row label="Outline">
        <ColorField label="Outline colour" value={s.strokeColor} onChange={(v) => set({ strokeColor: v })} />
        <Scrub label="Outline width" value={s.strokeWidth} step={1} min={0} max={40} format={(v) => `${v}px`} onChange={(v) => set({ strokeWidth: v })} className="w-14 flex-none" />
      </Row>
      <Row label="Shadow">
        <ColorField label="Shadow colour" value={s.shadowColor} onChange={(v) => set({ shadowColor: v })} />
        <Scrub label="Shadow blur" value={s.shadowBlur} step={1} min={0} max={80} format={(v) => `${v}px`} onChange={(v) => set({ shadowBlur: v })} className="w-14 flex-none" />
      </Row>
      <Row label="Box">
        <ColorField label="Box colour" value={s.boxColor} onChange={(v) => set({ boxColor: v })} />
        <Scrub label="Box opacity" value={s.boxOpacity} step={0.05} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ boxOpacity: v })} className="w-14 flex-none" />
      </Row>
      {s.boxOpacity > 0 && (
        <Row label="Box layout">
          <Segmented<"line" | "block" | "wordPill">
            label="Box style"
            value={s.boxStyle ?? "line"}
            onChange={(v) => set({ boxStyle: v })}
            options={[
              { value: "line", label: "Lines" },
              { value: "block", label: "Block" },
              { value: "wordPill", label: "Pills" },
            ]}
          />
        </Row>
      )}
      <p className="label-mono mb-1 mt-2 text-paper-dim">Animation in ({Object.keys(TEXT_ANIMATIONS).length})</p>
      <IconGrid
        cols={3}
        value={s.animation}
        onPick={(v: TextAnimation) => set({ animation: v })}
        options={(Object.keys(TEXT_ANIMATIONS) as TextAnimation[]).map((id) => ({ id, label: TEXT_ANIMATIONS[id].replace(/ \(.*\)$/, ""), hint: TEXT_ANIMATIONS[id], icon: ANIMATION_ICON[id] }))}
      />
      <Row label="Exit anim" className="mt-2">
        <Select<TextAnimation>
          label="Exit animation"
          value={s.animOut ?? "none"}
          onChange={(v) => set({ animOut: v })}
          options={(Object.keys(TEXT_ANIMATIONS) as TextAnimation[]).map((id) => ({ value: id, label: TEXT_ANIMATIONS[id] }))}
        />
      </Row>
      <Row label="Timings">
        <Scrub label="In duration" value={s.animInDuration ?? 0.45} step={0.05} min={0.05} max={3} format={(v) => `In ${v.toFixed(2)}s`} onChange={(v) => set({ animInDuration: v })} className="flex-1" />
        <Scrub label="Out duration" value={s.animOutDuration ?? 0.35} step={0.05} min={0.05} max={3} format={(v) => `Out ${v.toFixed(2)}s`} onChange={(v) => set({ animOutDuration: v })} className="flex-1" />
        <Scrub label="Stagger" value={s.animStagger ?? 0.04} step={0.005} min={0.005} max={0.3} format={(v) => `${Math.round(v * 1000)}ms`} onChange={(v) => set({ animStagger: v })} className="flex-1" />
      </Row>
      {(s.animation === "karaoke" || s.animation === "wordPop" || s.boxStyle === "wordPill") && (
        <Row label="Highlight" className="mt-1">
          <ColorField label="Highlight colour" value={s.highlightColor} onChange={(v) => set({ highlightColor: v })} />
        </Row>
      )}
      {!!t.words?.length && (
        <div className="mt-2">
          <p className="label-mono mb-1.5 text-paper-dim">All captions</p>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(CAPTION_STYLES) as CaptionStyleId[]).map((id) => (
              <button key={id} type="button" onClick={() => st.applyCaptionStyle(id)} className="h-7 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper">
                {CAPTION_STYLES[id].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

const SHAPES: ShapeType[] = ["rectangle", "ellipse", "triangle", "star", "polygon", "heart", "arrow", "line"];

function ShapeSection({ c }: { c: Clip }) {
  const st = getStudio();
  const s = c.shape!;
  const set = (patch: Partial<typeof s>, key: string) => st.updateClip(c.id, (x) => (x.shape ? { ...x, shape: { ...x.shape, ...patch } } : x), `shape:${c.id}:${key}`);
  return (
    <Section title="Shape">
      <IconGrid cols={4} value={s.type} onPick={(t: ShapeType) => set({ type: t }, "type")} options={SHAPES.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1), icon: SHAPE_ICON[t] }))} />
      <Row label="Size" className="mt-1">
        <Scrub label="Width" value={s.width} step={1} min={2} max={8000} format={(v) => `${Math.round(v)} w`} onChange={(v) => set({ width: v }, "w")} className="flex-1" />
        <Scrub label="Height" value={s.height} step={1} min={2} max={8000} format={(v) => `${Math.round(v)} h`} onChange={(v) => set({ height: v }, "h")} className="flex-1" />
      </Row>
      <Row label="Fill">
        <ColorField label="Fill colour" value={s.fill} onChange={(v) => set({ fill: v }, "fill")} />
        <Scrub label="Fill opacity" value={s.fillOpacity} step={0.05} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ fillOpacity: v }, "fo")} className="w-14 flex-none" />
      </Row>
      {s.type !== "line" && (
        <Row label="Outline">
          <ColorField label="Outline colour" value={s.stroke} onChange={(v) => set({ stroke: v }, "stroke")} />
          <Scrub label="Outline width" value={s.strokeWidth} step={1} min={0} max={120} format={(v) => `${v}px`} onChange={(v) => set({ strokeWidth: v }, "sw")} className="w-14 flex-none" />
        </Row>
      )}
      {s.type === "rectangle" && (
        <Row label="Corners">
          <Slider label="Corner radius" value={s.radius} min={0} max={Math.min(s.width, s.height) / 2} step={1} onChange={(v) => set({ radius: v }, "r")} />
        </Row>
      )}
      {(s.type === "star" || s.type === "polygon") && (
        <Row label={s.type === "star" ? "Points" : "Corners"}>
          <Slider label="Points" value={s.points} min={3} max={16} step={1} onChange={(v) => set({ points: v }, "pts")} />
          <span className="w-6 text-right font-mono text-[12px] text-paper-dim">{s.points}</span>
        </Row>
      )}
      {s.type === "star" && (
        <Row label="Inner">
          <Slider label="Inner radius" value={s.radius || 0.45} min={0.1} max={0.95} step={0.01} onChange={(v) => set({ radius: v }, "ir")} />
        </Row>
      )}
    </Section>
  );
}

function SolidSection({ c }: { c: Clip }) {
  const st = getStudio();
  return (
    <Section title="Colour">
      <Row label="Fill">
        <ColorField label="Fill colour" value={c.color ?? "#000000"} onChange={(v) => st.updateClip(c.id, { color: v }, `color:${c.id}`)} />
      </Row>
      <Row label="Gradient">
        <Toggle label="Gradient" checked={!!c.gradient} onChange={(on) => st.updateClip(c.id, { gradient: on ? { color: "#eb4a10", angle: 135 } : undefined })} />
      </Row>
      {c.gradient && (
        <>
          <Row label="To">
            <ColorField label="Gradient end colour" value={c.gradient.color} onChange={(v) => st.updateClip(c.id, (x) => ({ ...x, gradient: { ...x.gradient!, color: v } }), `grad:${c.id}`)} />
          </Row>
          <Row label="Angle">
            <Slider label="Gradient angle" value={c.gradient.angle} min={0} max={360} step={5} onChange={(v) => st.updateClip(c.id, (x) => ({ ...x, gradient: { ...x.gradient!, angle: v } }), `grada:${c.id}`)} />
            <span className="w-10 text-right font-mono text-[12px] text-paper-dim">{c.gradient.angle}°</span>
          </Row>
        </>
      )}
    </Section>
  );
}

/* ---------- Effects ---------- */

function LutPicker({ c, e }: { c: Clip; e: Effect }) {
  const st = getStudio();
  const [mine, setMine] = useState<LutInfo[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void userLuts().then(setMine);
  }, []);
  const all = [...BUILTIN_LUTS, ...mine];
  const current = e.options?.lut ?? BUILTIN_LUTS[0].id;
  return (
    <Row label="LUT">
      <Select
        label="LUT"
        value={all.some((l) => l.id === current) ? current : ""}
        onChange={(id) => {
          const l = all.find((x) => x.id === id);
          if (l) st.updateEffect(c.id, e.id, { options: { ...e.options, lut: l.id, name: l.name } });
        }}
        options={[...(all.some((l) => l.id === current) ? [] : [{ value: "", label: e.options?.name ?? "Missing LUT" }]), ...all.map((l) => ({ value: l.id, label: l.id.startsWith("builtin:") ? l.name : `${l.name} (yours)` }))]}
      />
      <IconButton label="Import a .cube LUT" onClick={() => fileRef.current?.click()} className="size-7">
        <Upload aria-hidden className="size-3.5" />
      </IconButton>
      <input
        ref={fileRef}
        type="file"
        accept=".cube"
        className="hidden"
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (!f) return;
          try {
            const l = await importCube(f);
            setMine(await userLuts());
            st.updateEffect(c.id, e.id, { options: { ...e.options, lut: l.id, name: l.name } });
            st.notify(`LUT “${l.name}” imported and applied.`, "success");
          } catch (err) {
            st.notify(err instanceof Error ? err.message : "That LUT couldn't be read.", "danger");
          }
        }}
      />
    </Row>
  );
}

function EffectCard({ c, e }: { c: Clip; e: Effect }) {
  const st = getStudio();
  const spec = EFFECTS[e.type];
  const pickingOpt = useStudio((s) => (s.picking?.kind === "effect" && s.picking.effectId === e.id ? (s.picking.optionKey ?? "color") : null));
  const checkerboard = useStudio((s) => s.checkerboard);
  const choice = EFFECT_CHOICES[e.type];
  const opt = (key: string, value: string) => st.updateEffect(c.id, e.id, { options: { ...e.options, [key]: value } });
  return (
    <div className={cn("mb-2 rounded-md border border-line-dark", !e.enabled && "opacity-60")}>
      <div className="flex items-center gap-2 border-b border-line-dark px-2 py-1">
        <Toggle label={`${spec.label} on`} checked={e.enabled} onChange={(v) => st.updateEffect(c.id, e.id, { enabled: v })} />
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-paper/10 text-paper">
          <EffectGlyph type={e.type} className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-paper" title={spec.hint}>
          {spec.label}
          {e.type === "bgRemoval" && <span className="text-paper-dim"> · {e.options?.model === "subject" ? "any subject" : "people"}</span>}
          {e.type === "lut" && <span className="text-paper-dim"> · {e.options?.name}</span>}
        </span>
        {e.type === "colorGrade" && (
          <IconButton
            label="Export colour grade as .cube 3D LUT"
            onClick={() => {
              const cube = exportGradeAsCube(c.effects, `${c.name} Grade`);
              download(new Blob([cube], { type: "text/plain" }), `${c.name || "grade"}.cube`);
            }}
            className="size-7"
          >
            <Download aria-hidden className="size-3.5" />
          </IconButton>
        )}
        <IconButton label={`Remove ${spec.label}`} onClick={() => st.removeEffect(c.id, e.id)} className="size-7">
          <X aria-hidden className="size-3.5" />
        </IconButton>
      </div>
      <div className="px-2 py-1">
        {e.type === "chromaKey" && (
          <>
            <Row label="Key colour">
              <ColorField
                label="Key colour"
                value={e.options?.color ?? "#00ff00"}
                onChange={(v) => opt("color", v)}
                onEyedropper={() =>
                  st.set({
                    picking: pickingOpt === "color" ? null : { kind: "effect", clipId: c.id, effectId: e.id, optionKey: "color" },
                  })
                }
                eyedropperActive={pickingOpt === "color"}
              />
            </Row>
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              {CHROMA_PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => opt("color", pr.color)}
                  className="inline-flex h-6 items-center gap-1 rounded-sm border border-line-dark px-1.5 text-[12px] text-paper-dim hover:border-paper/40 hover:text-paper"
                >
                  <span aria-hidden className="size-2.5 rounded-full border border-paper/30" style={{ background: pr.color }} />
                  {pr.label}
                </button>
              ))}
            </div>
            <div className="mb-1.5 grid grid-cols-2 gap-1">
              <TextButton
                className="h-7 px-2 text-[12px]"
                onClick={() => {
                  const det = getEngine()?.autoDetectChromaKey(c.id);
                  if (det) {
                    opt("color", det);
                    st.addRecentColor(det);
                    st.notify(`Auto-sampled screen colour ${det.toUpperCase()}.`, "success");
                  } else {
                    st.notify("Seek preview to a frame of this clip first.", "info");
                  }
                }}
              >
                <Pipette aria-hidden className="size-3.5" /> Auto-sample
              </TextButton>
              <TextButton
                tone={checkerboard ? "primary" : "plain"}
                className="h-7 px-2 text-[12px]"
                onClick={() => st.set({ checkerboard: !checkerboard })}
              >
                <Grid2x2 aria-hidden className="size-3.5" /> {checkerboard ? "Grid: On" : "Alpha grid"}
              </TextButton>
            </div>
            <Row label="View matte">
              <Segmented
                label="Chroma key view mode"
                value={e.options?.viewMode ?? "composite"}
                onChange={(v) => opt("viewMode", v)}
                options={[
                  { value: "composite", label: "Composite" },
                  { value: "alpha", label: "Alpha Matte" },
                  { value: "status", label: "Status" },
                ]}
              />
            </Row>
            <TextButton className="mb-1.5 w-full" onClick={() => st.addVirtualBackdrop(c.id, "#15140f", { color: "#1d3557", angle: 160 })}>
              Add virtual studio backdrop beneath clip
            </TextButton>
          </>
        )}
        {e.type === "colorWheels" && <ColorWheelsControl c={c} e={e} />}
        {e.type === "curves" && <CurvesControl c={c} e={e} />}
        {e.type === "hsl" && <HslMixerControl c={c} e={e} />}
        {e.type === "colorKey" && (
          <>
            <Row label="Key colour">
              <ColorField
                label="Target hue colour"
                value={e.options?.color ?? "#eb4a10"}
                onChange={(v) => opt("color", v)}
                onEyedropper={() =>
                  st.set({
                    picking: pickingOpt === "color" ? null : { kind: "effect", clipId: c.id, effectId: e.id, optionKey: "color" },
                  })
                }
                eyedropperActive={pickingOpt === "color"}
              />
            </Row>
            {e.options?.mode === "replace" && (
              <Row label="Swap to">
                <ColorField
                  label="Replacement hue"
                  value={e.options?.targetColor ?? "#39ff88"}
                  onChange={(v) => opt("targetColor", v)}
                  onEyedropper={() =>
                    st.set({
                      picking: pickingOpt === "targetColor" ? null : { kind: "effect", clipId: c.id, effectId: e.id, optionKey: "targetColor" },
                    })
                  }
                  eyedropperActive={pickingOpt === "targetColor"}
                />
              </Row>
            )}
          </>
        )}
        {e.type === "lut" && <LutPicker c={c} e={e} />}
        {e.type === "duotone" && (
          <>
            <Row label="Shadows">
              <ColorField label="Shadow colour" value={e.options?.dark ?? "#1d1a4f"} onChange={(v) => opt("dark", v)} />
            </Row>
            <Row label="Highlights">
              <ColorField label="Highlight colour" value={e.options?.light ?? "#ff9a62"} onChange={(v) => opt("light", v)} />
            </Row>
          </>
        )}
        {(e.type === "lightLeak" || e.type === "frame" || e.type === "lensFlare" || e.type === "godRays" || e.type === "edgeGlow" || e.type === "particles" || e.type === "strobe") && (
          <Row label={e.type === "frame" ? "Border" : "Colour"}>
            <ColorField label="Colour" value={e.options?.color ?? (e.type === "frame" || e.type === "strobe" ? "#ffffff" : "#ff7a2e")} onChange={(v) => opt("color", v)} />
          </Row>
        )}
        {choice && (
          <Row label={choice.label}>
            <Select label={choice.label} value={e.options?.[choice.key] ?? choice.options[0].value} onChange={(v) => opt(choice.key, v)} options={choice.options} />
          </Row>
        )}
        {e.type === "mask" && (
          <Row label="Invert">
            <Toggle label="Invert the mask" checked={e.options?.invert === "1"} onChange={(v) => opt("invert", v ? "1" : "0")} />
            <span className="text-[12px] text-paper-dim">{e.options?.invert === "1" ? "Hide inside" : "Show inside"}</span>
          </Row>
        )}
        {e.type !== "colorWheels" &&
          spec.params.map((p) => (
            <SliderRow key={p.key} c={c} path={`fx:${e.id}:${p.key}`} neutral={p.min < 0 && p.max > 0 ? 0 : undefined} />
          ))}
      </div>
    </div>
  );
}

function EffectsSection({ c }: { c: Clip }) {
  const st = getStudio();
  const [adding, setAdding] = useState(false);
  const available = EFFECT_ORDER.filter((t) => canTake(c, t) && t !== "bgRemoval" && !c.effects.some((e) => e.type === t));
  return (
    <Section title="Effects">
      {c.kind !== "text" && c.kind !== "shape" && (
        <>
          <p className="label-mono mb-1.5 text-paper-dim">Looks and film LUTs</p>
          <div className="mb-3">
            <LooksGrid cols={4} />
          </div>
        </>
      )}
      {c.effects.map((e) => (
        <EffectCard key={e.id} c={c} e={e} />
      ))}
      <TextButton className="w-full" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
        {adding ? <X aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
        {adding ? "Close" : `Add effect (${available.length})`}
      </TextButton>
      {adding && (
        <div className="mt-2 space-y-2">
          {EFFECT_CATEGORIES.map((cat) => {
            const types = available.filter((t) => EFFECTS[t].category === cat.id);
            if (!types.length) return null;
            return (
              <div key={cat.id}>
                <p className="label-mono mb-1 flex items-center gap-1.5 text-paper-dim">
                  {createElement(CATEGORY_ICON[cat.id], { "aria-hidden": true, className: "size-3.5" })}
                  {cat.label}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {types.map((t) => (
                    <EffectTile
                      key={t}
                      type={t}
                      compact
                      onPick={(type: EffectType) => {
                        const id = st.addEffect(c.id, type);
                        const first = EFFECTS[type].params[0];
                        if (id && first) st.set({ activeProp: `fx:${id}:${first.key}` });
                        setAdding(false);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ---------- Transition ---------- */

function TransitionSection({ c }: { c: Clip }) {
  const st = getStudio();
  const tr = c.transitionIn;
  const types = Object.keys(TRANSITIONS) as TransitionType[];
  return (
    <Section title="Transition in" defaultOpen={!!tr}>
      <IconGrid
        cols={3}
        value={tr?.type ?? "none"}
        onPick={(v: TransitionType | "none") => st.setTransition(c.id, v === "none" ? undefined : { type: v, duration: tr?.duration ?? DEFAULT_TRANSITION_DURATION, direction: tr?.direction ?? "left" })}
        options={[{ id: "none" as const, label: "Cut", hint: "No transition", icon: Scissors }, ...types.map((t) => ({ id: t, label: TRANSITIONS[t].label, hint: TRANSITIONS[t].hint, icon: TRANSITION_ICON[t] }))]}
      />
      {tr && (
        <>
          <Row label="Duration" className="mt-1">
            <Slider label="Transition duration" value={tr.duration} min={0.1} max={3} step={0.05} onChange={(v) => st.setTransition(c.id, { ...tr, duration: v })} />
            <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{tr.duration.toFixed(2)}s</span>
          </Row>
          {TRANSITIONS[tr.type]?.directional && (
            <Row label="Direction">
              <Segmented
                label="Direction"
                value={tr.direction ?? "left"}
                onChange={(v) => st.setTransition(c.id, { ...tr, direction: v })}
                options={[
                  { value: "left", label: "←" },
                  { value: "right", label: "→" },
                  { value: "up", label: "↑" },
                  { value: "down", label: "↓" },
                ]}
              />
            </Row>
          )}
          <p className="mt-1 text-[12px] leading-relaxed text-paper-dim">Centred on the cut; it uses spare footage either side when there is some, and holds the end frame when not.</p>
        </>
      )}
    </Section>
  );
}

/* ---------- Sound ---------- */

function FxSlider({ label, value, min, max, step, unit, neutral, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; neutral?: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <Slider label={label} value={value} min={min} max={max} step={step} neutral={neutral} onChange={onChange} />
      <span className="w-14 shrink-0 text-right font-mono text-[12px] text-paper-dim">
        {value === 0 && unit !== "dB" ? "Off" : `${unit === "%" ? Math.round(value * 100) : value > 0 && unit === "dB" ? `+${value}` : value}${unit === "%" ? "%" : ` ${unit}`}`}
      </span>
    </Row>
  );
}

function AudioSection({ c }: { c: Clip }) {
  const st = getStudio();
  const local = useLocal(c);
  const v = evalAnim(c.volume, local);
  const fx = audioFxOf(c);
  const set = (patch: Partial<AudioFx>) => st.setAudioFx(c.id, patch);
  return (
    <Section title={c.kind === "audio" ? "Sound" : "Sound (linked)"}>
      <Row label="Volume">
        <Slider label="Volume" value={gainToDb(v)} min={-60} max={12} step={0.5} neutral={0} onChange={(db) => st.setProp(c.id, "volume", dbToGain(db))} onStart={st.begin} onEnd={st.end} />
        <span className="w-12 shrink-0 text-right font-mono text-[12px] text-paper-dim">{v <= 0.001 ? "−∞" : `${gainToDb(v) > 0 ? "+" : ""}${gainToDb(v).toFixed(1)}`} dB</span>
        <KeyControls c={c} path="volume" label="Volume" />
      </Row>
      <Row label="Fade in / out">
        <Scrub label="Sound fade in" value={c.fadeIn} step={0.05} min={0} max={10} format={(x) => `${x.toFixed(2)} s`} onChange={(x) => st.updateClip(c.id, { fadeIn: x }, `afi:${c.id}`)} className="flex-1" />
        <Scrub label="Sound fade out" value={c.fadeOut} step={0.05} min={0} max={10} format={(x) => `${x.toFixed(2)} s`} onChange={(x) => st.updateClip(c.id, { fadeOut: x }, `afo:${c.id}`)} className="flex-1" />
      </Row>
      <Row label="Mute">
        <Toggle label="Mute this clip" checked={c.muted} onChange={(m) => st.updateClip(c.id, { muted: m })} />
      </Row>
      <FxSlider label="Pan" value={fx.pan} min={-1} max={1} step={0.05} unit="" neutral={0} onChange={(x) => set({ pan: x })} />
      <p className="label-mono mb-1 mt-3 text-paper-dim">Voice changer</p>
      <IconGrid
        cols={4}
        value={fx.voice}
        onPick={(id: VoiceEffect) => set({ voice: id })}
        options={(Object.keys(VOICE_EFFECTS) as VoiceEffect[]).map((id) => ({ id, label: VOICE_EFFECTS[id].label, hint: VOICE_EFFECTS[id].hint, icon: VOICE_ICON[id] }))}
      />
      <Row label="Clean voice" className="mt-2">
        <Toggle label="Clean up speech" checked={fx.denoise} onChange={(on) => set({ denoise: on })} />
        <span className="text-[12px] text-paper-dim">Cuts rumble and hiss, adds clarity</span>
      </Row>
      <p className="label-mono mb-1 mt-3 text-paper-dim">Equaliser</p>
      <FxSlider label="Bass" value={fx.low} min={-12} max={12} step={0.5} unit="dB" neutral={0} onChange={(x) => set({ low: x })} />
      <FxSlider label="Mids" value={fx.mid} min={-12} max={12} step={0.5} unit="dB" neutral={0} onChange={(x) => set({ mid: x })} />
      <FxSlider label="Treble" value={fx.high} min={-12} max={12} step={0.5} unit="dB" neutral={0} onChange={(x) => set({ high: x })} />
      <FxSlider label="Low cut" value={fx.highpass} min={0} max={800} step={10} unit="Hz" onChange={(x) => set({ highpass: x })} />
      <FxSlider label="High cut" value={fx.lowpass} min={0} max={12000} step={100} unit="Hz" onChange={(x) => set({ lowpass: x })} />
      <p className="label-mono mb-1 mt-3 text-paper-dim">Dynamics and space</p>
      <FxSlider label="Compressor" value={fx.compressor} min={0} max={1} step={0.05} unit="%" onChange={(x) => set({ compressor: x })} />
      <FxSlider label="Reverb" value={fx.reverb} min={0} max={1} step={0.05} unit="%" onChange={(x) => set({ reverb: x })} />
      <FxSlider label="Echo" value={fx.echo} min={0} max={1} step={0.05} unit="%" onChange={(x) => set({ echo: x })} />
      {c.audioFx && (
        <TextButton className="mt-2 w-full" onClick={() => st.setAudioFx(c.id, null)}>
          <RotateCcw aria-hidden className="size-3.5" />
          Reset sound effects
        </TextButton>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Heard live and exported exactly the same. Loudness levelling and ducking are in the Audio tab.</p>
    </Section>
  );
}

/* ---------- The clip tab ---------- */

const LABELS = ["", "#eb4a10", "#e0b100", "#2fa86b", "#2f80ed", "#9b51e0", "#e8478b"];

function ClipTab() {
  const c = usePrimaryClip();
  const linkedAudio = useStudio((s) => (c?.linkId ? Object.values(s.project.clips).find((x) => x.linkId === c.linkId && x.kind === "audio" && x.id !== c.id) : undefined));
  const hasAudioStream = useStudio((s) => (c?.kind === "video" && c.mediaId ? Boolean(s.project.media[c.mediaId]?.hasAudio) : false));
  const hasAttrClip = useStudio((s) => !!s.attrClipboard);
  const busy = useStudio((s) => !!s.jobs.cliptool);
  const st = getStudio();
  if (!c) return <Empty>Select a clip on the timeline or in the preview to edit it. Shift-click to select more than one.</Empty>;
  const visual = c.kind !== "audio";
  return (
    <div>
      <div className="flex items-center gap-1.5 border-b border-line-dark px-3 py-2">
        <input
          aria-label="Clip name"
          value={c.name}
          onChange={(e) => st.updateClip(c.id, { name: e.target.value.slice(0, 80) }, `name:${c.id}`)}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-8 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 text-[14px] font-medium text-paper outline-none hover:border-line-dark focus-visible:border-accent"
        />
        {c.linkId && (
          <IconButton label="Unlink picture and sound" onClick={() => st.unlink(c.id)} className="size-9 sm:size-7">
            <Link2Off aria-hidden className="size-3.5" />
          </IconButton>
        )}
        <IconButton label="Delete clip" onClick={() => st.deleteSelection(false)} className="size-9 sm:size-7">
          <Trash2 aria-hidden className="size-3.5" />
        </IconButton>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-dark px-3 py-2">
        <button type="button" title="Split at the playhead (S)" onClick={() => st.splitAtPlayhead()} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper sm:h-7">
          <Scissors aria-hidden className="size-3.5 shrink-0" />
          Split
        </button>
        <button type="button" title="Duplicate (Ctrl+D)" onClick={() => st.duplicateSelection()} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper sm:h-7">
          <Copy aria-hidden className="size-3.5 shrink-0" />
          Duplicate
        </button>
        <button type="button" title="Copy attributes & effects (Ctrl+Alt+C)" onClick={() => st.copyAttributes(c.id)} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper sm:h-7">
          <ClipboardCopy aria-hidden className="size-3.5 shrink-0" />
          Copy FX
        </button>
        <button type="button" title="Paste attributes & effects (Ctrl+Alt+V)" disabled={!hasAttrClip} onClick={() => st.pasteAttributes()} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper disabled:pointer-events-none disabled:opacity-30 sm:h-7">
          <ClipboardPaste aria-hidden className="size-3.5 shrink-0" />
          Paste FX
        </button>
        {(c.kind === "video" || c.kind === "image") && (
          <button type="button" title="Sync colour grade to all clips on timeline" onClick={() => st.applyGradeToAllClips(c.id)} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper sm:h-7">
            <Sparkles aria-hidden className="size-3.5 shrink-0" />
            Sync grade
          </button>
        )}
        {c.kind === "video" && (linkedAudio || hasAudioStream) && (
          <button type="button" title="Detach / extract audio track" onClick={() => st.detachAudio(c.id)} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper sm:h-7">
            <AudioLines aria-hidden className="size-3.5 shrink-0" />
            Detach audio
          </button>
        )}
        {c.kind === "video" && (
          <button
            type="button"
            title="Freeze frame: hold this frame for 2 s (Shift+F)"
            disabled={busy}
            onClick={() => void runJob("cliptool", "Capturing the frame", () => freezeFrame(c.id))}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper disabled:pointer-events-none disabled:opacity-30 sm:h-7"
          >
            <Snowflake aria-hidden className="size-3.5 shrink-0" />
            Freeze 2s
          </button>
        )}
        {(c.kind === "video" || c.kind === "audio") && (
          <button
            type="button"
            title="Reverse: play backwards"
            disabled={busy}
            onClick={() =>
              void runJob("cliptool", "Reversing", async (p) => {
                await reverseClip(c.id, (f, l) => p(l ?? "Reversing", f));
                getStudio().notify("Reversed. The new copy is in your media.", "success");
              })
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper disabled:pointer-events-none disabled:opacity-30 sm:h-7"
          >
            <Rewind aria-hidden className="size-3.5 shrink-0" />
            Reverse
          </button>
        )}
        {visual && (
          <>
            <button
              type="button"
              aria-pressed={!!c.flipH}
              title="Flip horizontally"
              onClick={() => st.flip([c.id], "h")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-sm border px-2 text-[12px] transition-colors sm:h-7",
                c.flipH ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper",
              )}
            >
              <FlipHorizontal2 aria-hidden className="size-3.5 shrink-0" />
              Flip H
            </button>
            <button
              type="button"
              aria-pressed={!!c.flipV}
              title="Flip vertically"
              onClick={() => st.flip([c.id], "v")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-sm border px-2 text-[12px] transition-colors sm:h-7",
                c.flipV ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper",
              )}
            >
              <FlipVertical2 aria-hidden className="size-3.5 shrink-0" />
              Flip V
            </button>
            {canTake(c, "chromaKey") && !c.effects.some((x) => x.type === "chromaKey") && (
              <button
                type="button"
                title="Add green/blue screen chroma key"
                onClick={() => st.addEffect(c.id, "chromaKey")}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper sm:h-7"
              >
                <Grid2x2 aria-hidden className="size-3.5 shrink-0" />
                Chroma Key
              </button>
            )}
            {c.kind !== "adjustment" && (
              <button
                type="button"
                title="Bake clip & effects to a transparent PNG image"
                disabled={busy}
                onClick={() => void runJob("cliptool", "Rasterizing clip", () => rasterizeClip(c.id))}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-line-dark-2 hover:bg-paper/10 hover:text-paper disabled:pointer-events-none disabled:opacity-30 sm:h-7"
              >
                <ImageIcon aria-hidden className="size-3.5 shrink-0" />
                Rasterize
              </button>
            )}
          </>
        )}
        <div className="flex w-full items-center justify-between pt-0.5 sm:ml-auto sm:w-auto sm:justify-start sm:pt-0">
          <span className="text-[12px] text-paper-dim sm:hidden">Label</span>
          <span className="flex items-center gap-0.5" role="radiogroup" aria-label="Colour label">
            {LABELS.map((l) => (
              <button
                key={l || "none"}
                type="button"
                role="radio"
                aria-checked={(c.label ?? "") === l}
                aria-label={l ? `Label ${l}` : "No label"}
                onClick={() => st.updateClip(c.id, { label: l || undefined })}
                className="inline-flex size-7 items-center justify-center rounded-full sm:size-6"
              >
                <span
                  className={cn("size-4 rounded-full border transition-transform", (c.label ?? "") === l ? "scale-110 border-paper ring-1 ring-paper/40" : "border-line-dark", !l && "bg-transparent")}
                  style={l ? { background: l } : undefined}
                />
              </button>
            ))}
          </span>
        </div>
      </div>
      <div className="px-3">
        <JobLine id="cliptool" />
      </div>
      <TimingSection c={c} />
      {visual && <TransformSection c={c} />}
      {c.kind === "video" && <StabilizeSection c={c} />}
      {c.kind === "text" && c.text && <TextSection c={c} />}
      {c.kind === "shape" && c.shape && <ShapeSection c={c} />}
      {c.kind === "solid" && <SolidSection c={c} />}
      {visual && <EffectsSection c={c} />}
      {visual && <TransitionSection c={c} />}
      {c.kind === "audio" ? <AudioSection c={c} /> : linkedAudio ? <AudioSection c={linkedAudio} /> : null}
    </div>
  );
}

/* ---------- The project tab ---------- */

function MarkersSection() {
  const markers = useStudio((s) => s.project.markers);
  const st = getStudio();
  return (
    <Section title={`Markers (${markers.length})`} defaultOpen={markers.length > 0}>
      {!markers.length ? (
        <p className="text-[12px] leading-relaxed text-paper-dim">Press M (or the Marker button) to mark a moment. Beat sync in the Audio tab adds them on the beat; clips snap to markers.</p>
      ) : (
        <ul className="max-h-60 space-y-1 overflow-y-auto" data-lenis-prevent>
          {markers.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5">
              <input type="color" aria-label="Marker colour" value={m.color ?? "#e0b100"} onChange={(e) => st.updateMarker(m.id, { color: e.target.value })} className="h-6 w-6 shrink-0 cursor-pointer rounded-sm border border-line-dark bg-ink p-0" />
              <button type="button" onClick={() => st.set({ playing: false, playhead: m.t })} className="w-14 shrink-0 text-left font-mono text-[12px] text-accent hover:underline">
                {shortTime(m.t)}
              </button>
              <input
                aria-label="Marker name"
                value={m.label}
                onChange={(e) => st.updateMarker(m.id, { label: e.target.value.slice(0, 60) })}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-7 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-1.5 text-[12px] text-paper outline-none focus-visible:border-accent"
              />
              <IconButton label="Delete marker" onClick={() => st.removeMarker(m.id)} className="size-7">
                <X aria-hidden className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <TextButton className="mt-2 w-full" onClick={() => st.addMarker()}>
        <Bookmark aria-hidden className="size-3.5" />
        Add a marker at the playhead
      </TextButton>
    </Section>
  );
}

function ProjectFileSection() {
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const st = getStudio();
  const save = async (withMedia: boolean) => {
    setBusy(withMedia ? "full" : "light");
    try {
      const blob = await exportPackage(withMedia);
      download(blob, `${st.project.name || "project"}${withMedia ? "" : " (no media)"}.dwylvideo`);
    } catch (e) {
      st.notify(e instanceof Error ? e.message : "The project couldn't be saved.", "danger");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Project file" defaultOpen={false}>
      <div className="grid grid-cols-1 gap-1.5">
        <TextButton disabled={!!busy} onClick={() => void save(true)}>
          {busy === "full" ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <FileArchive aria-hidden className="size-3.5" />}
          Save project + media (.dwylvideo)
        </TextButton>
        <TextButton disabled={!!busy} onClick={() => void save(false)}>
          <FileArchive aria-hidden className="size-3.5" />
          Save project only (small)
        </TextButton>
        <TextButton disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === "open" ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <FolderOpen aria-hidden className="size-3.5" />}
          Open project (.prproj, .capcut, .aep, .dwylvideo…)
        </TextButton>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={PROJECT_ACCEPT}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy("open");
          try {
            const out = await openExternalProjectFile(f);
            if (out.nativeImported) {
              const r = out.nativeImported;
              getStudio().notify(`Opened “${r.name}”${r.offline ? ` (${r.offline} file${r.offline === 1 ? "" : "s"} to relink)` : ""}.`, "success");
            } else if (out.result) {
              const r = out.result;
              const off = r.offlineAssets.length - (r.embeddedFiles?.length ?? 0);
              getStudio().notify(
                `Opened ${r.sourceLabel}: “${r.project.name}”${off > 0 ? `. Relink ${off} offline file(s) in Media tab.` : "."}`,
                off > 0 ? "warning" : "success",
              );
            }
          } catch (err) {
            getStudio().notify(err instanceof Error ? err.message : "That project file couldn't be opened.", "danger");
          } finally {
            setBusy(null);
          }
        }}
      />
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Move a project to another browser or computer, or keep a backup. Files stay on your devices.</p>
    </Section>
  );
}

function ProjectTab() {
  const { name, settings, clips, media } = useStudio(useShallow((s) => ({ name: s.project.name, settings: s.project.settings, clips: Object.keys(s.project.clips).length, media: Object.keys(s.project.media).length })));
  const duration = useStudio((s) => TL.projectDuration(s.project));
  const projectId = useStudio((s) => s.project.id);
  const st = getStudio();
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void listProjects().then(setProjects);
    void storageEstimate().then(setUsage);
  }, [projectId]);
  const caps = {
    isolated: typeof window !== "undefined" && window.crossOriginIsolated,
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    encode: typeof VideoEncoder !== "undefined",
  };
  return (
    <div>
      <Section title="Project">
        <Row label="Name">
          <input
            aria-label="Project name"
            value={name}
            onChange={(e) => st.rename(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-1.5 text-[12px] text-paper outline-none focus-visible:border-accent"
          />
        </Row>
        <Row label="Frame">
          <Select<AspectId> label="Aspect ratio" value={settings.aspect} onChange={(v) => st.setAspect(v)} options={(Object.keys(ASPECTS) as AspectId[]).map((a) => ({ value: a, label: `${a} · ${ASPECTS[a].hint}` }))} />
        </Row>
        <Row label="Frame rate">
          <Select label="Frame rate" value={String(settings.fps)} onChange={(v) => st.commit((p) => ({ ...p, settings: { ...p.settings, fps: Number(v) } }))} options={FPS_CHOICES.map((f) => ({ value: String(f), label: `${f} fps` }))} />
        </Row>
        <Row label="Background">
          <ColorField label="Background colour" value={settings.background} onChange={(v) => st.commit((p) => ({ ...p, settings: { ...p.settings, background: v } }), { merge: "bg" })} />
        </Row>
        <p className="mt-2 font-mono text-[12px] leading-relaxed text-paper-dim">
          {settings.width}×{settings.height} base · {shortTime(duration)} · {clips} clips · {media} files
        </p>
      </Section>
      <MarkersSection />
      <Section title="Projects on this device">
        <div className="mb-2 flex flex-wrap gap-1.5">
          <TextButton onClick={() => void newProject("16:9")}>
            <Plus aria-hidden className="size-3.5" />
            New 16:9
          </TextButton>
          <TextButton onClick={() => void newProject("9:16")}>
            <Plus aria-hidden className="size-3.5" />
            New 9:16
          </TextButton>
          <TextButton onClick={() => void newProject("1:1")}>
            <Plus aria-hidden className="size-3.5" />
            New 1:1
          </TextButton>
        </div>
        <ul className="divide-y divide-line-dark border-y border-line-dark">
          {projects.slice(0, 10).map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1.5">
              <span className={cn("min-w-0 flex-1 truncate text-[12px]", p.id === projectId ? "text-paper" : "text-paper-dim")}>{p.name}</span>
              <span className="shrink-0 font-mono text-[12px] text-paper-dim">{new Date(p.updatedAt).toLocaleDateString()}</span>
              {p.id !== projectId && (
                <button type="button" onClick={() => void openProject(p.id)} className="shrink-0 rounded-sm px-1.5 text-[12px] text-accent hover:bg-paper/10">
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
        {usage && (
          <p className="mt-2 font-mono text-[12px] text-paper-dim">
            Stored here: {formatBytes(usage.usage)} of {formatBytes(usage.quota)}
          </p>
        )}
      </Section>
      <ProjectFileSection />
      <Section title="This browser" defaultOpen={false}>
        <ul className="space-y-1 text-[12px] text-paper-dim">
          <li>{caps.encode ? "✓ Hardware video export (WebCodecs)" : "✗ No WebCodecs: export needs a recent Chrome, Edge, Firefox or Safari"}</li>
          <li>{caps.webgpu ? "✓ WebGPU for the AI models" : "· No WebGPU: AI runs on the CPU (slower)"}</li>
          <li>{caps.isolated ? "✓ Cross-origin isolated: multi-threaded AI" : "· Not cross-origin isolated: AI uses one CPU thread"}</li>
        </ul>
      </Section>
    </div>
  );
}

export function Inspector() {
  const tab = useStudio((s) => s.rightTab);
  const st = getStudio();
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-raised">
      <div role="tablist" aria-label="Inspector" className="flex shrink-0 border-b border-line-dark px-1.5 pt-1.5">
        {(
          [
            ["clip", "Clip"],
            ["animate", "Animate"],
            ["project", "Project"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => st.set({ rightTab: id })}
            className={cn("relative h-9 flex-1 text-[13px] transition-colors", tab === id ? "text-paper" : "text-paper-dim hover:text-paper")}
          >
            {label}
            {tab === id && <span className="absolute inset-x-3 -bottom-px h-0.5 bg-accent" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-lenis-prevent>
        {tab === "clip" ? <ClipTab /> : tab === "animate" ? <KeyframeEditor /> : <ProjectTab />}
      </div>
    </div>
  );
}
