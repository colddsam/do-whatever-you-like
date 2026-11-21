import { CAPTION_LANGUAGES, CAPTION_STYLES, DEFAULT_TRANSITION_DURATION, EFFECTS, LOOKS, SHAPE_PRESETS, SPEED_PRESETS, TEXT_PRESETS, TRANSITIONS, VOICE_EFFECTS } from "../../constants";
import { anim, setKey } from "../../lib/keyframes";
import { frameRound, rt, uid } from "../../lib/time";
import * as TL from "../../lib/timeline";
import { useStudio } from "../../store/studio-store";
import type { AspectId, CaptionStyleId, Clip, Direction, DirectorOp, Effect, EffectType, LayoutId, LookId, Project, TransitionType, VoiceEffect } from "../../types";
import { addGeneratedFile, freezeFrame, reverseClip } from "../clip-tools";
import { renderSfx, SFX, type SfxId } from "../sfx";
import { analyzeShake, autoDuck, autoReframe, detectBeats, detectScenes, normalizeLoudness } from "./analysis";
import { autoCaptions, type Progress } from "./captions";
import { removeBackground } from "./cutout";
import { applySilenceCut, planSilenceCut } from "./silence";

/**
 * AI Director: plain-language requests ("cut the pauses and add bold captions") become a short list
 * of timeline operations. With a free Gemini or Groq key on the backend an LLM writes the list;
 * without one (or with the backend asleep) a built-in parser covers the common requests. Either way
 * the list is validated here, shown to the user, and applied as a single undo step.
 */

export type Plan = { ops: DirectorOp[]; engine: string; note?: string };

const ASPECT_IDS: AspectId[] = ["16:9", "9:16", "1:1", "4:5", "21:9"];
const LAYOUT_IDS: LayoutId[] = ["full", "fit", "pip-tl", "pip-tr", "pip-bl", "pip-br", "pip-framed", "split-h", "split-v", "split-3h", "split-3v", "grid"];
const DIRECTIONS: Direction[] = ["left", "right", "up", "down"];
/** Effects the Director may add (background removal has its own op; LUTs need a file choice). */
const DIRECTOR_EFFECTS: EffectType[] = (Object.keys(EFFECTS) as EffectType[]).filter((t) => t !== "bgRemoval" && t !== "lut");
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** What the model sees: the shape of the timeline, never the media itself. */
export function timelineSummary(p: Project, playhead: number, selection: string[]) {
  const clips = Object.values(p.clips)
    .sort((a, b) => a.start - b.start)
    .slice(0, 150)
    .map((c) => ({
      id: c.id,
      track: p.tracks.find((t) => t.id === c.trackId)?.name,
      kind: c.kind,
      name: c.name.slice(0, 40),
      start: rt(c.start),
      end: rt(c.start + c.duration),
      ...(c.text ? { text: c.text.text.slice(0, 80) } : {}),
      ...(c.speed !== 1 ? { speed: c.speed } : {}),
      ...(c.effects.length ? { effects: c.effects.map((e) => e.type) } : {}),
    }));
  return {
    duration: TL.projectDuration(p),
    fps: p.settings.fps,
    aspect: p.settings.aspect,
    playhead: rt(playhead),
    selected: selection,
    tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name })),
    clips,
  };
}

/** Keeps only well-formed operations on clips that exist, with numbers in range. */
export function validateOps(raw: unknown, p: Project): DirectorOp[] {
  if (!Array.isArray(raw)) return [];
  const clip = (v: unknown) => (typeof v === "string" && p.clips[v] ? v : undefined);
  const dur = Math.max(1, TL.projectDuration(p)) + 60;
  const out: DirectorOp[] = [];
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    switch (o.op) {
      case "split": {
        const at = num(o.at, 0, dur);
        if (at !== undefined) out.push({ op: "split", at, clipId: clip(o.clipId) });
        break;
      }
      case "delete": {
        const id = clip(o.clipId);
        if (id) out.push({ op: "delete", clipId: id, ripple: o.ripple !== false });
        break;
      }
      case "trim": {
        const id = clip(o.clipId);
        if (id) out.push({ op: "trim", clipId: id, start: num(o.start, 0, dur), end: num(o.end, 0, dur) });
        break;
      }
      case "move": {
        const id = clip(o.clipId);
        const start = num(o.start, 0, dur);
        if (id && start !== undefined) out.push({ op: "move", clipId: id, start });
        break;
      }
      case "addText": {
        const text = str(o.text, 300);
        if (text) out.push({ op: "addText", text, start: num(o.start, 0, dur) ?? 0, duration: num(o.duration, 0.3, 60) ?? 3, preset: TEXT_PRESETS.some((t) => t.id === o.preset) ? (o.preset as string) : "title" });
        break;
      }
      case "captions":
        out.push({
          op: "captions",
          style: (Object.keys(CAPTION_STYLES) as CaptionStyleId[]).includes(o.style as CaptionStyleId) ? (o.style as CaptionStyleId) : "bold",
          language: CAPTION_LANGUAGES.some((l) => l.code === o.language) ? (o.language as string) : undefined,
        });
        break;
      case "removeSilence":
        out.push({ op: "removeSilence", thresholdDb: num(o.thresholdDb, -70, -15), minSilence: num(o.minSilence, 0.15, 5), padding: num(o.padding, 0, 1) });
        break;
      case "look":
        if ((Object.keys(LOOKS) as LookId[]).includes(o.look as LookId)) out.push({ op: "look", look: o.look as LookId, clipId: clip(o.clipId) });
        break;
      case "effect":
        if (DIRECTOR_EFFECTS.includes(o.effect as EffectType)) {
          const params: Record<string, number> = {};
          if (o.params && typeof o.params === "object") {
            for (const spec of EFFECTS[o.effect as EffectType].params) {
              const v = num((o.params as Record<string, unknown>)[spec.key], spec.min, spec.max);
              if (v !== undefined) params[spec.key] = v;
            }
          }
          const color = typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : undefined;
          out.push({ op: "effect", effect: o.effect as Exclude<EffectType, "bgRemoval">, clipId: clip(o.clipId), params, color });
        }
        break;
      case "transition":
        if ((Object.keys(TRANSITIONS) as TransitionType[]).includes(o.type as TransitionType)) {
          out.push({ op: "transition", type: o.type as TransitionType, duration: num(o.duration, 0.1, 3), clipId: clip(o.clipId), direction: DIRECTIONS.includes(o.direction as Direction) ? (o.direction as Direction) : undefined });
        }
        break;
      case "speedRamp":
        if (o.preset === "none" || (typeof o.preset === "string" && SPEED_PRESETS[o.preset])) out.push({ op: "speedRamp", preset: o.preset as string, clipId: clip(o.clipId) });
        break;
      case "reverse":
        out.push({ op: "reverse", clipId: clip(o.clipId) });
        break;
      case "freeze":
        out.push({ op: "freeze", at: num(o.at, 0, dur), duration: num(o.duration, 0.2, 10), clipId: clip(o.clipId) });
        break;
      case "flip":
        out.push({ op: "flip", axis: o.axis === "v" ? "v" : "h", clipId: clip(o.clipId) });
        break;
      case "layout":
        if (LAYOUT_IDS.includes(o.layout as LayoutId)) out.push({ op: "layout", layout: o.layout as LayoutId });
        break;
      case "backdrop":
        out.push({ op: "backdrop", amount: num(o.amount, 0, 80), clipId: clip(o.clipId) });
        break;
      case "voice":
        if ((Object.keys(VOICE_EFFECTS) as VoiceEffect[]).includes(o.voice as VoiceEffect)) out.push({ op: "voice", voice: o.voice as VoiceEffect, clipId: clip(o.clipId) });
        break;
      case "normalize":
        out.push({ op: "normalize", target: num(o.target, -30, -6) });
        break;
      case "duck":
        out.push({ op: "duck", amount: num(o.amount, -30, -3) });
        break;
      case "beats":
        out.push({ op: "beats", cut: o.cut === true });
        break;
      case "scenes":
        out.push({ op: "scenes", clipId: clip(o.clipId) });
        break;
      case "stabilize":
        out.push({ op: "stabilize", clipId: clip(o.clipId), strength: num(o.strength, 0, 1) });
        break;
      case "reframe":
        out.push({ op: "reframe", clipId: clip(o.clipId) });
        break;
      case "closeGaps":
        out.push({ op: "closeGaps" });
        break;
      case "addShape":
        if (SHAPE_PRESETS.some((x) => x.id === o.shape)) out.push({ op: "addShape", shape: o.shape as string, start: num(o.start, 0, dur), duration: num(o.duration, 0.2, 600) });
        break;
      case "addAdjustment": {
        const effects: { effect: Exclude<EffectType, "bgRemoval">; params?: Record<string, number>; color?: string }[] = [];
        if (Array.isArray(o.effects)) {
          for (const item of o.effects.slice(0, 6)) {
            if (item && typeof item === "object" && DIRECTOR_EFFECTS.includes((item as Record<string, unknown>).effect as EffectType)) {
              const eff = item as Record<string, unknown>;
              effects.push({
                effect: eff.effect as Exclude<EffectType, "bgRemoval">,
                ...(typeof eff.color === "string" && /^#[0-9a-f]{6}$/i.test(eff.color) ? { color: eff.color } : {}),
              });
            }
          }
        }
        out.push({ op: "addAdjustment", start: num(o.start, 0, dur), duration: num(o.duration, 0.2, 600), ...(effects.length ? { effects } : {}) });
        break;
      }
      case "sticker": {
        const emoji = str(o.emoji, 8);
        if (emoji) out.push({ op: "sticker", emoji, start: num(o.start, 0, dur), duration: num(o.duration, 0.2, 60) });
        break;
      }
      case "sfx":
        if (SFX.some((x) => x.id === o.sound)) out.push({ op: "sfx", sound: o.sound as string, at: num(o.at, 0, dur) });
        break;
      case "speed": {
        const speed = num(o.speed, 0.1, 16);
        if (speed !== undefined) out.push({ op: "speed", speed, clipId: clip(o.clipId) });
        break;
      }
      case "volume": {
        const volume = num(o.volume, 0, 2);
        if (volume !== undefined) out.push({ op: "volume", volume, clipId: clip(o.clipId) });
        break;
      }
      case "fade":
        out.push({ op: "fade", fadeIn: num(o.fadeIn, 0, 10), fadeOut: num(o.fadeOut, 0, 10), clipId: clip(o.clipId) });
        break;
      case "removeBackground":
        out.push({ op: "removeBackground", clipId: clip(o.clipId) });
        break;
      case "aspect":
        if (ASPECT_IDS.includes(o.aspect as AspectId)) out.push({ op: "aspect", aspect: o.aspect as AspectId });
        break;
      case "kenBurns":
        out.push({ op: "kenBurns", clipId: clip(o.clipId), from: num(o.from, 0.2, 5) ?? 1, to: num(o.to, 0.2, 5) ?? 1.15 });
        break;
    }
  }
  return out;
}

/* ---------- The built-in parser (no API key needed) ---------- */

function quoted(s: string) {
  return /["“”'‘’](.+?)["“”'‘’]/.exec(s)?.[1];
}

export function localPlan(prompt: string, p: Project, playhead: number): DirectorOp[] {
  const s = prompt.toLowerCase();
  const ops: DirectorOp[] = [];
  const has = (re: RegExp) => re.test(s);
  if (has(/\b(9:16|vertical|portrait|reels?|shorts|tiktok)\b/)) ops.push({ op: "aspect", aspect: "9:16" });
  else if (has(/\b(1:1|square)\b/)) ops.push({ op: "aspect", aspect: "1:1" });
  else if (has(/\b(16:9|landscape|widescreen|youtube)\b/)) ops.push({ op: "aspect", aspect: "16:9" });
  if (has(/(silen|pause|dead air|gaps|ums?\b|jump ?cut)/)) ops.push({ op: "removeSilence" });
  if (has(/(caption|subtitle|transcri)/)) {
    const style: CaptionStyleId = has(/karaoke/) ? "karaoke" : has(/box/) ? "boxed" : has(/(clean|simple|plain)/) ? "clean" : has(/minimal/) ? "minimal" : "bold";
    ops.push({ op: "captions", style });
  }
  const look: LookId | null = has(/(black and white|b&w|b\/w|grayscale|greyscale|monochrome)/)
    ? "bw"
    : has(/(cinematic|film look|teal)/)
      ? "cinematic"
      : has(/(vintage|retro|old film)/)
        ? "vintage"
        : has(/\bwarm/)
          ? "warm"
          : has(/\b(cool|cold)\b/)
            ? "cool"
            : has(/(vivid|punchy|saturat|pop the colou?r)/)
              ? "vivid"
              : has(/(faded|matte look)/)
                ? "fade"
                : null;
  if (look) ops.push({ op: "look", look });
  if (has(/whip/)) ops.push({ op: "transition", type: "whipPan" });
  else if (has(/zoom (blur|transition)/)) ops.push({ op: "transition", type: "zoomBlur" });
  else if (has(/clock wipe/)) ops.push({ op: "transition", type: "clockWipe" });
  else if (has(/\bwipe/)) ops.push({ op: "transition", type: "wipe" });
  else if (has(/dip to black/)) ops.push({ op: "transition", type: "dipToBlack" });
  else if (has(/(flash|dip to white) transition|white flash/)) ops.push({ op: "transition", type: "dipToWhite" });
  else if (has(/slide transition|slide (in|between)/)) ops.push({ op: "transition", type: "slide" });
  else if (has(/push transition/)) ops.push({ op: "transition", type: "push" });
  else if (has(/\biris\b|circle transition/)) ops.push({ op: "transition", type: "iris" });
  else if (has(/spin transition/)) ops.push({ op: "transition", type: "spin" });
  else if (has(/film burn|burn transition/)) ops.push({ op: "transition", type: "filmBurn" });
  else if (has(/glitch transition/)) ops.push({ op: "transition", type: "glitch" });
  else if (has(/pixel(ate)? transition/)) ops.push({ op: "transition", type: "pixelate" });
  else if (has(/barn ?door/)) ops.push({ op: "transition", type: "barnDoor" });
  else if (has(/luma (fade|dissolve)/)) ops.push({ op: "transition", type: "lumaDissolve" });
  else if (has(/blur (dissolve|transition)/)) ops.push({ op: "transition", type: "blurDissolve" });
  else if (has(/(cross ?(dissolve|fade)|transitions?)/)) ops.push({ op: "transition", type: "crossDissolve" });
  if (has(/fade (in|out)|fade from black|fade to black/)) ops.push({ op: "fade", fadeIn: has(/fade (in|from)/) ? 0.8 : undefined, fadeOut: has(/fade (out|to)/) ? 1 : undefined });
  const x = /(\d+(?:\.\d+)?)\s*x\b/.exec(s);
  if (x && has(/(speed|faster|slower|x\b)/)) ops.push({ op: "speed", speed: Number(x[1]) });
  else if (has(/(slow[- ]?mo|slow (it )?down|slower)/)) ops.push({ op: "speed", speed: 0.5 });
  else if (has(/(speed (it )?up|faster|timelapse)/)) ops.push({ op: "speed", speed: 2 });
  if (has(/\bmute\b/)) ops.push({ op: "volume", volume: 0 });
  else if (has(/(louder|boost|turn up)/)) ops.push({ op: "volume", volume: 1.5 });
  else if (has(/(quieter|softer|turn down|lower the (volume|music))/)) ops.push({ op: "volume", volume: 0.5 });
  if (has(/green ?screen|chroma/)) ops.push({ op: "effect", effect: "chromaKey", color: has(/blue ?screen/) ? "#0047bb" : "#00ff00" });
  else if (has(/(remove|cut out|erase|delete) (the )?background|background remov/)) ops.push({ op: "removeBackground" });
  if (has(/glitch/) && !has(/glitch transition/)) ops.push({ op: "effect", effect: "glitch" });
  if (has(/(rgb split|chromatic)/)) ops.push({ op: "effect", effect: "rgbSplit" });
  if (has(/\bblur\b/) && !has(/(zoom blur|blur (dissolve|transition)|blur(red)? background|canvas)/)) ops.push({ op: "effect", effect: "blur" });
  const fx: [RegExp, Exclude<EffectType, "bgRemoval">][] = [
    [/\bvhs\b|retro tape|old tape/, "vhs"],
    [/film grain|\bgrain\b/, "filmGrain"],
    [/light leaks?/, "lightLeak"],
    [/(letterbox|cinematic bars|black bars)/, "letterbox"],
    [/sharpen|crisper/, "sharpen"],
    [/\bglow\b|dreamy/, "glow"],
    [/(camera )?shake/, "shake"],
    [/pixelat/, "pixelate"],
    [/kaleidoscope/, "kaleidoscope"],
    [/mirror effect|mirror it/, "mirror"],
    [/\binvert\b|negative/, "invert"],
    [/posteri[sz]e/, "posterize"],
    [/duotone/, "duotone"],
    [/halftone|comic/, "halftone"],
    [/motion blur|directional blur/, "motionBlur"],
    [/fish ?eye|bulge/, "fisheye"],
    [/\bwave\b|ripple effect/, "wave"],
    [/rounded corners|border|drop shadow/, "frame"],
    [/lens flare|sun flare/, "lensFlare"],
    [/god ?rays|volumetric light/, "godRays"],
    [/halation|35mm halo/, "halation"],
    [/tilt ?shift|miniature/, "tiltShift"],
    [/prism/, "prism"],
    [/heat (haze|distort)|underwater/, "heatDistort"],
    [/shockwave/, "shockwave"],
    [/\bcrt\b|tv monitor/, "crt"],
    [/neon edge|edge glow/, "edgeGlow"],
    [/(snow|embers|sparks|rain|bokeh|particles)/, "particles"],
    [/strobe/, "strobe"],
    [/(3d tilt|perspective)/, "perspective"],
    [/unmult|remove black/, "unmult"],
    [/color wheels|lift gamma gain/, "colorWheels"],
    [/\bcurves\b/, "curves"],
    [/hsl mixer/, "hsl"],
  ];
  for (const [re, effect] of fx) if (has(re) && !has(/transition/)) ops.push({ op: "effect", effect });
  if (has(/adjustment layer/)) ops.push({ op: "addAdjustment", start: rt(playhead), duration: 5 });
  if (has(/(ken burns|slow zoom|zoom in slowly|push in)/)) ops.push({ op: "kenBurns", from: 1, to: 1.15 });
  const ramp = /\b(montage|hero|bullet|jump ?cut|flash ?in|flash ?out)\b/.exec(s)?.[1]?.replace(/\s/g, "");
  if (ramp && has(/(speed|ramp|velocity|curve|time)/)) ops.push({ op: "speedRamp", preset: ramp === "jumpcut" ? "jumpCut" : ramp === "flashin" ? "flashIn" : ramp === "flashout" ? "flashOut" : ramp });
  else if (has(/(speed ramp|velocity edit|speed curve)/)) ops.push({ op: "speedRamp", preset: "montage" });
  if (has(/(reverse|backwards|rewind effect)/)) ops.push({ op: "reverse" });
  if (has(/freeze( frame)?/)) ops.push({ op: "freeze", at: rt(playhead) });
  if (has(/\bflip\b|mirror (the )?(video|image|clip)/)) ops.push({ op: "flip", axis: has(/(upside down|vertical(ly)? flip|flip vertical)/) ? "v" : "h" });
  if (has(/(picture in picture|\bpip\b)/)) ops.push({ op: "layout", layout: "pip-br" });
  else if (has(/3 column/)) ops.push({ op: "layout", layout: "split-3h" });
  else if (has(/(side by side|split screen)/)) ops.push({ op: "layout", layout: "split-h" });
  if (has(/(blur(red)? background|canvas blur|blurred bars)/)) ops.push({ op: "backdrop", amount: 40 });
  const voice = (Object.keys(VOICE_EFFECTS) as VoiceEffect[]).find((v) => v !== "none" && new RegExp(`\\b${v === "hall" ? "(hall|reverb)" : v}\\b`).test(s));
  if (voice && has(/(voice|sound|audio|effect)/)) ops.push({ op: "voice", voice });
  if (has(/(normali[sz]e|loudness|even out the (volume|sound|audio))/)) ops.push({ op: "normalize", target: -14 });
  if (has(/\bduck/)) ops.push({ op: "duck", amount: -12 });
  if (has(/(beat|rhythm|bpm)/)) ops.push({ op: "beats", cut: has(/(cut|edit|sync)/) });
  if (has(/(scene (change|detect|cut)|split (it )?(by|into) scenes|detect (the )?scenes)/)) ops.push({ op: "scenes" });
  if (has(/(stabili[sz]e|shaky|steady)/)) ops.push({ op: "stabilize", strength: 0.6 });
  if (has(/(reframe|keep (me|them|the person|him|her) in (the )?frame|follow the (person|subject))/)) ops.push({ op: "reframe" });
  if (has(/(close|remove) (the )?gaps/)) ops.push({ op: "closeGaps" });
  if (has(/progress bar/)) ops.push({ op: "addShape", shape: "progress" });
  const sfx = SFX.find((x) => new RegExp(`\\b${x.label.toLowerCase().split(" ")[0]}\\b`).test(s));
  if (sfx && (has(/(sound|sfx)/) || ["whoosh", "swoosh", "riser", "ding", "bleep", "shutter", "heartbeat", "laser", "chime"].includes(sfx.id))) ops.push({ op: "sfx", sound: sfx.id, at: rt(playhead) });
  const q = quoted(prompt);
  if (q && has(/(title|text|heading|caption that says|write|add)/)) ops.push({ op: "addText", text: q, start: rt(playhead), duration: 3, preset: has(/lower third/) ? "lower-third" : "title" });
  if (has(/\b(split|cut) (it |the clip )?(here|at the playhead)\b/)) ops.push({ op: "split", at: rt(playhead) });
  void p;
  return ops;
}

export async function planEdits(prompt: string): Promise<Plan> {
  const s = useStudio.getState();
  try {
    const res = await fetch("/api/tools/studio/director", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 1000), timeline: timelineSummary(s.project, s.playhead, s.selection) }),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.ok) {
      const j = (await res.json()) as { ops?: unknown; engine?: string; note?: string };
      if (j.engine && j.engine !== "none" && Array.isArray(j.ops)) {
        const ops = validateOps(j.ops, useStudio.getState().project);
        if (ops.length) return { ops, engine: j.engine, note: j.note };
      }
    }
  } catch {
    /* backend asleep or unreachable: the built-in parser takes over */
  }
  const st = useStudio.getState();
  return { ops: localPlan(prompt, st.project, st.playhead), engine: "rules" };
}

/* ---------- Showing and applying ---------- */

export function describeOp(op: DirectorOp, p: Project): string {
  const name = (id?: string) => (id && p.clips[id] ? `“${p.clips[id].name}”` : "the selected clips (or all)");
  switch (op.op) {
    case "split":
      return `Split ${op.clipId ? name(op.clipId) : "clips"} at ${op.at.toFixed(2)} s`;
    case "delete":
      return `${op.ripple ? "Ripple delete" : "Delete"} ${name(op.clipId)}`;
    case "trim":
      return `Trim ${name(op.clipId)}${op.start !== undefined ? ` to start at ${op.start.toFixed(2)} s` : ""}${op.end !== undefined ? ` and end at ${op.end.toFixed(2)} s` : ""}`;
    case "move":
      return `Move ${name(op.clipId)} to ${op.start.toFixed(2)} s`;
    case "addText":
      return `Add text “${op.text}” at ${op.start.toFixed(1)} s for ${op.duration.toFixed(1)} s`;
    case "captions":
      return `Generate ${CAPTION_STYLES[op.style ?? "bold"].label} captions (on this device)`;
    case "removeSilence":
      return `Cut silent pauses${op.thresholdDb ? ` below ${op.thresholdDb} dB` : ""}`;
    case "look":
      return `Apply the ${LOOKS[op.look].label} look to ${name(op.clipId)}`;
    case "effect":
      return `Add ${EFFECTS[op.effect].label} to ${name(op.clipId)}`;
    case "transition":
      return `Add ${TRANSITIONS[op.type].label} ${op.clipId ? `into ${name(op.clipId)}` : "on every cut"}`;
    case "speed":
      return `Set speed to ${op.speed}× on ${name(op.clipId)}`;
    case "volume":
      return `Set volume to ${Math.round(op.volume * 100)}% on ${op.clipId ? name(op.clipId) : "all sound"}`;
    case "fade":
      return `Fade ${[op.fadeIn ? `in ${op.fadeIn}s` : "", op.fadeOut ? `out ${op.fadeOut}s` : ""].filter(Boolean).join(" and ") || "in and out"}`;
    case "removeBackground":
      return `Remove the background of ${name(op.clipId)} (AI, on this device)`;
    case "aspect":
      return `Change the frame to ${op.aspect}`;
    case "kenBurns":
      return `Slow zoom (${Math.round((op.from ?? 1) * 100)}% → ${Math.round((op.to ?? 1.15) * 100)}%) on ${name(op.clipId)}`;
    case "speedRamp":
      return op.preset === "none" ? `Remove the speed curve from ${name(op.clipId)}` : `${SPEED_PRESETS[op.preset]?.label ?? op.preset} speed curve on ${name(op.clipId)}`;
    case "reverse":
      return `Play ${name(op.clipId)} backwards`;
    case "freeze":
      return `Freeze frame${op.at !== undefined ? ` at ${op.at.toFixed(2)} s` : " at the playhead"} for ${(op.duration ?? 2).toFixed(1)} s`;
    case "flip":
      return `Flip ${name(op.clipId)} ${op.axis === "v" ? "vertically" : "horizontally"}`;
    case "layout":
      return `Lay out the selected clips: ${op.layout.startsWith("pip") ? "picture-in-picture" : op.layout === "split-h" ? "side by side" : op.layout === "split-v" ? "stacked" : op.layout === "grid" ? "2×2 grid" : op.layout}`;
    case "backdrop":
      return op.amount === 0 ? `Remove the blurred background from ${name(op.clipId)}` : `Blurred background behind ${name(op.clipId)}`;
    case "voice":
      return `${VOICE_EFFECTS[op.voice].label} voice on ${op.clipId ? name(op.clipId) : "the selected sound (or all)"}`;
    case "normalize":
      return `Even out loudness to ${op.target ?? -14} LUFS`;
    case "duck":
      return `Lower the music by ${Math.abs(op.amount ?? -12)} dB under speech`;
    case "beats":
      return `Mark the beats${op.cut ? " and cut the video on them" : ""}`;
    case "scenes":
      return `Split ${name(op.clipId)} at its scene changes`;
    case "stabilize":
      return `Stabilise ${name(op.clipId)}`;
    case "reframe":
      return `Reframe ${name(op.clipId)} to follow the person`;
    case "closeGaps":
      return "Close every gap on the timeline";
    case "addShape":
      return `Add a ${SHAPE_PRESETS.find((x) => x.id === op.shape)?.label.toLowerCase() ?? "shape"}`;
    case "addAdjustment":
      return `Add an adjustment layer${op.start !== undefined ? ` at ${op.start.toFixed(1)} s` : ""}`;
    case "sticker":
      return `Add the sticker ${op.emoji}`;
    case "sfx":
      return `Add the “${SFX.find((x) => x.id === op.sound)?.label ?? op.sound}” sound${op.at !== undefined ? ` at ${op.at.toFixed(1)} s` : ""}`;
  }
}

const ORDER: DirectorOp["op"][] = [
  "aspect",
  "closeGaps",
  "removeSilence",
  "scenes",
  "split",
  "trim",
  "delete",
  "move",
  "freeze",
  "reverse",
  "speed",
  "speedRamp",
  "transition",
  "layout",
  "flip",
  "backdrop",
  "reframe",
  "stabilize",
  "look",
  "effect",
  "volume",
  "voice",
  "normalize",
  "duck",
  "fade",
  "kenBurns",
  "addText",
  "addShape",
  "addAdjustment",
  "sticker",
  "sfx",
  "beats",
  "removeBackground",
  "captions",
];

function targets(p: Project, selection: string[], clipId: string | undefined, want: (c: Clip) => boolean) {
  if (clipId) return p.clips[clipId] && want(p.clips[clipId]) ? [clipId] : [];
  const sel = selection.filter((id) => p.clips[id] && want(p.clips[id]));
  return sel.length ? sel : Object.values(p.clips).filter(want).map((c) => c.id);
}
const visual = (c: Clip) => c.kind === "video" || c.kind === "image" || c.kind === "solid";

export async function applyPlan(ops: DirectorOp[], onProgress: Progress) {
  const sorted = [...ops].sort((a, b) => ORDER.indexOf(a.op) - ORDER.indexOf(b.op));
  for (const op of sorted) {
    const st = useStudio.getState();
    const sel = st.selection;
    switch (op.op) {
      case "removeSilence": {
        const plan = await planSilenceCut({ thresholdDb: op.thresholdDb ?? -42, minSilence: op.minSilence ?? 0.5, padding: op.padding ?? 0.12 }, onProgress);
        if (plan.ranges.length) applySilenceCut(plan);
        break;
      }
      case "captions":
        await autoCaptions({ style: op.style ?? "bold", maxWords: 4, language: op.language }, onProgress);
        break;
      case "removeBackground": {
        const ids = targets(st.project, sel, op.clipId, (c) => c.kind === "video" || c.kind === "image");
        for (const id of ids.slice(0, 4)) await removeBackground(id, onProgress, st.project.clips[id].kind === "image" ? "subject" : "people");
        break;
      }
      case "reverse": {
        for (const id of targets(st.project, sel, op.clipId, (c) => c.kind === "video").slice(0, 3)) await reverseClip(id, (f, l) => onProgress(l ?? "Reversing", f));
        break;
      }
      case "freeze": {
        const id = targets(st.project, sel, op.clipId, (c) => c.kind === "video" && (op.at === undefined || (op.at >= c.start && op.at < c.start + c.duration)))[0];
        if (id) {
          if (op.at !== undefined) st.set({ playhead: op.at });
          await freezeFrame(id, op.duration ?? 2);
        }
        break;
      }
      case "normalize": {
        const ids = sel.length ? TL.withLinked(st.project, sel) : Object.values(st.project.clips).filter((c) => c.kind === "audio").map((c) => c.id);
        await normalizeLoudness(ids, op.target ?? -14, onProgress);
        break;
      }
      case "duck": {
        const audio = st.project.tracks.filter((t) => t.kind === "audio" && TL.clipsOnTrack(st.project, t.id).length);
        if (audio.length >= 2) await autoDuck(audio[0].id, audio[audio.length - 1].id, op.amount ?? -12, onProgress);
        break;
      }
      case "beats": {
        const music = Object.values(st.project.clips)
          .filter((c) => c.kind === "audio" && c.mediaId)
          .sort((a, b) => b.duration - a.duration)[0];
        if (!music) break;
        const { beats } = await detectBeats(music, onProgress);
        useStudio.getState().commit((p) => {
          let next: Project = { ...p, markers: [...p.markers.filter((m) => m.label !== "Beat"), ...beats.map((t) => ({ id: uid("mk"), t, label: "Beat", color: "#39ff88" }))].sort((a, b) => a.t - b.t) };
          if (op.cut) {
            const ids = Object.values(next.clips)
              .filter((c) => c.kind === "video" || c.kind === "image")
              .map((c) => c.id);
            for (const t of beats) next = TL.splitAt(next, t, ids.filter((id) => next.clips[id]));
          }
          return next;
        });
        break;
      }
      case "scenes": {
        for (const id of targets(st.project, sel, op.clipId, (c) => c.kind === "video").slice(0, 3)) {
          const c = useStudio.getState().project.clips[id];
          if (!c) continue;
          const cuts = await detectScenes(id, onProgress);
          useStudio.getState().commit((p) => {
            let next = p;
            for (const t of cuts) {
              const piece = Object.values(next.clips).find((x) => x.trackId === c.trackId && t > x.start + 0.05 && t < x.start + x.duration - 0.05);
              if (piece) [next] = TL.splitClip(next, piece.id, t);
            }
            return next;
          });
        }
        break;
      }
      case "stabilize": {
        for (const id of targets(st.project, sel, op.clipId, (c) => c.kind === "video").slice(0, 3)) {
          const data = await analyzeShake(id, onProgress, op.strength ?? 0.6);
          useStudio.getState().commit((p) => TL.updateClip(p, id, { stabilize: data }));
        }
        break;
      }
      case "reframe": {
        for (const id of targets(st.project, sel, op.clipId, (c) => c.kind === "video").slice(0, 3)) await autoReframe(id, onProgress);
        break;
      }
      case "sfx": {
        const asset = await addGeneratedFile(await renderSfx(op.sound as SfxId));
        useStudio.getState().placeMedia(asset.id, op.at ?? st.playhead);
        break;
      }
      default:
        st.commit((p) => applyOne(p, op, sel));
    }
  }
}

function applyOne(p: Project, op: DirectorOp, sel: string[]): Project {
  switch (op.op) {
    case "aspect":
      return TL.setAspect(p, op.aspect);
    case "split":
      return op.clipId ? TL.splitClip(p, op.clipId, op.at)[0] : TL.splitAt(p, op.at, sel);
    case "delete":
      return TL.deleteClips(p, [op.clipId], op.ripple ?? true);
    case "trim": {
      let next = p;
      if (op.start !== undefined) next = TL.trimClip(next, op.clipId, "start", op.start);
      if (op.end !== undefined) next = TL.trimClip(next, op.clipId, "end", op.end);
      return next;
    }
    case "move": {
      const c = p.clips[op.clipId];
      if (!c) return p;
      const ids = TL.withLinked(p, [c.id]);
      const dt = op.start - c.start;
      return TL.moveClips(p, ids.map((id) => ({ id, start: p.clips[id].start + dt, trackId: p.clips[id].trackId })));
    }
    case "speed": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, (c) => c.kind === "video" || c.kind === "audio")) next = TL.setSpeed(next, id, op.speed);
      return next;
    }
    case "transition": {
      const d = op.duration ?? DEFAULT_TRANSITION_DURATION;
      const direction = op.direction ?? "left";
      if (op.clipId) return TL.updateClip(p, op.clipId, { transitionIn: { type: op.type, duration: d, direction } });
      let next = p;
      for (const track of p.tracks) {
        if (track.kind === "audio") continue;
        const clips = TL.clipsOnTrack(p, track.id);
        for (let i = 1; i < clips.length; i++) {
          if (Math.abs(clips[i - 1].start + clips[i - 1].duration - clips[i].start) < 1e-3) next = TL.updateClip(next, clips[i].id, { transitionIn: { type: op.type, duration: d, direction } });
        }
      }
      return next;
    }
    case "look": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, visual)) {
        next = TL.updateClip(next, id, (c) => {
          const rest = c.effects.filter((e) => e.type !== "colorGrade");
          if (op.look === "none") return { ...c, effects: rest };
          const params = Object.fromEntries(EFFECTS.colorGrade.params.map((x) => [x.key, anim(LOOKS[op.look].grade[x.key] ?? x.def)]));
          return { ...c, effects: [{ id: uid("fx"), type: "colorGrade", enabled: true, params }, ...rest] };
        });
      }
      return next;
    }
    case "effect": {
      let next = p;
      const spec = EFFECTS[op.effect];
      for (const id of targets(p, sel, op.clipId, (c) => c.kind !== "audio")) {
        const effect: Effect = {
          id: uid("fx"),
          type: op.effect,
          enabled: true,
          params: Object.fromEntries(spec.params.map((x) => [x.key, anim(op.params?.[x.key] ?? x.def)])),
          ...(spec.options ? { options: { ...spec.options, ...(op.color ? { color: op.color } : {}) } } : {}),
        };
        next = TL.updateClip(next, id, (c) => ({ ...c, effects: [...c.effects.filter((e) => e.type !== op.effect), effect] }));
      }
      return next;
    }
    case "volume": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, (c) => c.kind === "audio")) next = TL.updateClip(next, id, { volume: anim(op.volume) });
      return next;
    }
    case "fade": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, (c) => c.kind !== "text")) {
        next = TL.updateClip(next, id, (c) => ({ ...c, fadeIn: op.fadeIn ?? c.fadeIn ?? 0, fadeOut: op.fadeOut ?? c.fadeOut ?? 0 }));
      }
      return next;
    }
    case "kenBurns": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, (c) => c.kind === "image" || c.kind === "video")) {
        next = TL.updateClip(next, id, (c) => {
          const from = op.from ?? 1;
          const to = op.to ?? 1.15;
          const ramp = () => setKey(setKey({ v: from }, 0, from, "easeInOut"), c.duration, to);
          return { ...c, transform: { ...c.transform, scaleX: ramp(), scaleY: ramp() } };
        });
      }
      return next;
    }
    case "addText": {
      const preset = TEXT_PRESETS.find((t) => t.id === op.preset) ?? TEXT_PRESETS[0];
      const [withTrack, trackId] = TL.freeTrack(p, "overlay", op.start, op.start + op.duration);
      const c = TL.textClip(withTrack, { ...preset, text: op.text, duration: op.duration }, op.start, trackId);
      return TL.placeClips(withTrack, [c]);
    }
    case "speedRamp": {
      let next = p;
      const shape = op.preset === "none" ? null : (SPEED_PRESETS[op.preset]?.points ?? null);
      const done = new Set<string>();
      for (const id of targets(p, sel, op.clipId, (c) => c.kind === "video" || c.kind === "audio")) {
        if (done.has(id) || !next.clips[id]) continue;
        for (const x of TL.withLinked(next, [id])) done.add(x);
        next = TL.applySpeedRamp(next, id, shape);
      }
      return next;
    }
    case "flip": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, (c) => c.kind !== "audio")) next = TL.updateClip(next, id, (c) => (op.axis === "v" ? { ...c, flipV: !c.flipV } : { ...c, flipH: !c.flipH }));
      return next;
    }
    case "layout":
      return TL.applyLayout(p, sel.length ? sel : Object.values(p.clips).filter((c) => c.kind === "video" || c.kind === "image").map((c) => c.id), op.layout);
    case "backdrop": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, (c) => c.kind === "video" || c.kind === "image")) next = TL.updateClip(next, id, { backdrop: op.amount === 0 ? undefined : (op.amount ?? 40) });
      return next;
    }
    case "voice": {
      let next = p;
      for (const id of targets(p, sel, op.clipId, (c) => c.kind === "audio")) next = TL.updateClip(next, id, (c) => ({ ...c, audioFx: { ...c.audioFx, voice: op.voice } }));
      return next;
    }
    case "closeGaps":
      return TL.closeGaps(p);
    case "addShape": {
      const preset = SHAPE_PRESETS.find((x) => x.id === op.shape);
      if (!preset) return p;
      const start = op.start ?? 0;
      const [withTrack, trackId] = TL.freeTrack(p, "overlay", start, start + (op.shape === "progress" ? Math.max(1, TL.projectDuration(p) - start) : (op.duration ?? 5)));
      const c = TL.newClip(withTrack, { trackId, kind: "shape", name: preset.label, start, duration: op.duration ?? 5, shape: { type: preset.shape.type, width: preset.shape.width ?? 640, height: preset.shape.height ?? 360, fill: preset.shape.fill ?? "#eb4a10", fillOpacity: preset.shape.fillOpacity ?? 1, stroke: preset.shape.stroke ?? "#ffffff", strokeWidth: preset.shape.strokeWidth ?? 0, radius: preset.shape.radius ?? 0, points: preset.shape.points ?? 5 } });
      if (op.shape === "progress") {
        const total = Math.max(1, TL.projectDuration(p) - start);
        c.duration = total;
        c.shape = { ...c.shape!, width: p.settings.width };
        c.transform = {
          ...c.transform,
          y: anim(p.settings.height - c.shape.height / 2),
          x: { v: 0, k: [{ id: uid("k"), t: 0, v: 0, ease: "linear" }, { id: uid("k"), t: total, v: p.settings.width / 2, ease: "linear" }] },
          scaleX: { v: 0, k: [{ id: uid("k"), t: 0, v: 0, ease: "linear" }, { id: uid("k"), t: total, v: 1, ease: "linear" }] },
        };
      }
      return TL.placeClips(withTrack, [c]);
    }
    case "addAdjustment": {
      const start = op.start ?? 0;
      const duration = op.duration ?? Math.max(4, TL.projectDuration(p) - start);
      const [withTrack, trackId] = TL.freeTrack(p, "overlay", start, start + duration);
      const effects: Effect[] = (op.effects ?? []).map((item) => {
        const spec = EFFECTS[item.effect];
        return {
          id: uid("fx"),
          type: item.effect,
          enabled: true,
          params: Object.fromEntries(spec.params.map((x) => [x.key, anim(item.params?.[x.key] ?? x.def)])),
          ...(spec.options ? { options: { ...spec.options, ...(item.color ? { color: item.color } : {}) } } : {}),
        };
      });
      const c = TL.newClip(withTrack, { trackId, kind: "adjustment", name: "Adjustment layer", start, duration, effects });
      return TL.placeClips(withTrack, [c]);
    }
    case "sticker": {
      const [withTrack, trackId] = TL.freeTrack(p, "overlay", op.start ?? 0, (op.start ?? 0) + (op.duration ?? 3));
      const c = TL.textClip(withTrack, { id: "sticker", label: "Sticker", text: op.emoji, duration: op.duration ?? 3, style: { size: 220, shadowBlur: 0, strokeWidth: 0, animation: "pop" } }, frameRound(op.start ?? 0, p.settings.fps), trackId);
      c.name = `Sticker ${op.emoji}`;
      return TL.placeClips(withTrack, [c]);
    }
    default:
      return p;
  }
}
