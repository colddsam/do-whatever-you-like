import { renderSfx, SFX, type SfxId } from "@/features/video-studio/engine/sfx";
import { SINGER_VOICES } from "../constants";
import { addTrack, makeClip, makeTrack, putClips, spb } from "../lib/project";
import type { AssetMeta, Project, SongPlan } from "../types";
import { addAssetFile, addAssetPcm } from "./assets";
import { localPlan, realize, vocalFx } from "./composer";
import { sing, singerCenter } from "./vocals";

/**
 * The AI side of the studio:
 * - the song planner and lyricist (Groq, falling back to Gemini) through /api/tools/music/*;
 *   without them, or when their free quota is used up, the built-in planner takes over;
 * - the full "describe a song → get a produced song" pipeline;
 * - MusicGen (Meta, via Transformers.js) running on this device for text-to-music/sound;
 * - text-to-sound-effect matching over the synthesised effects library.
 */

export type Capabilities = { ai: string | null; tts: boolean };

let capsPromise: Promise<Capabilities> | null = null;
export function capabilities(): Promise<Capabilities> {
  capsPromise ??= fetch("/api/tools/music/capabilities", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Capabilities>) : { ai: null, tts: false }))
    .catch(() => ({ ai: null, tts: false }));
  return capsPromise;
}

async function post<T>(action: string, body: unknown, timeoutMs = 58_000): Promise<T> {
  const res = await fetch(`/api/tools/music/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(j?.detail || "The AI didn't answer. Try again in a moment.");
  }
  return res.json() as Promise<T>;
}

export type SongRequest = {
  prompt: string;
  genre: string | null;
  mood: string | null;
  seconds: number;
  vocals: boolean;
  vocalStyle: "sung" | "rap";
  voice: string;
  language: string;
  lyrics: string;
  harmony: boolean;
  seed: number;
  useAi: boolean;
};

/** Parses "[Verse]\nline\nline\n\n[Chorus]…" into sections (plain lines become verses and choruses). */
export function parseLyrics(text: string): { name: string; lines: string[] }[] {
  const out: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[?\(?\s*(intro|verse|pre-?chorus|chorus|hook|bridge|outro)[^\]\)]*[\]\)]?:?$/i.exec(line);
    if (head) {
      const n = head[1].toLowerCase().replace("-", "");
      cur = { name: n === "hook" ? "chorus" : n, lines: [] };
      out.push(cur);
      continue;
    }
    if (!line) {
      if (cur?.lines.length && !/^(verse|chorus|bridge|prechorus)$/.test(cur.name)) cur = null;
      continue;
    }
    if (!cur) {
      cur = { name: out.filter((s) => s.name === "verse").length > out.filter((s) => s.name === "chorus").length ? "chorus" : "verse", lines: [] };
      out.push(cur);
    }
    cur.lines.push(line);
  }
  return out.filter((s) => s.lines.length);
}

export async function writeLyrics(topic: string, genre: string | null, mood: string | null, language: string): Promise<string> {
  const r = await post<{ title: string; sections: { name: string; lines: string[] }[] }>("lyrics", {
    topic,
    genre,
    mood,
    language,
    structure: "verse,chorus,verse,chorus,bridge,chorus",
  });
  return r.sections.map((s) => `[${s.name.charAt(0).toUpperCase()}${s.name.slice(1)}]\n${s.lines.join("\n")}`).join("\n\n");
}

/** Every step of making a song from a description. */
export async function generateSong(req: SongRequest, progress: (f: number, label: string) => void): Promise<{ project: Project; plan: SongPlan; engine: string; warnings: string[] }> {
  const warnings: string[] = [];
  progress(0.02, "Planning the song");
  const userLyrics = req.lyrics.trim() ? parseLyrics(req.lyrics) : undefined;
  let plan: SongPlan | null = null;
  let engine = "built-in";
  if (req.useAi && (await capabilities()).ai) {
    try {
      plan = await post<SongPlan>("compose", {
        prompt: req.prompt || `A ${req.mood ?? ""} ${req.genre ?? ""} song`,
        genre: req.genre,
        mood: req.mood,
        language: req.language,
        seconds: req.seconds,
        vocals: req.vocals,
        lyrics: req.lyrics.trim() || null,
      });
      engine = plan.engine ?? "ai";
      if (plan.vocal !== "none" && req.vocals) plan = { ...plan, vocal: req.vocalStyle };
    } catch (e) {
      warnings.push(`${e instanceof Error ? e.message : "The AI composer didn't answer"}: the built-in composer wrote this one.`);
    }
  }
  if (!plan) {
    plan = localPlan({
      genre: req.genre ?? "pop",
      mood: req.mood ?? undefined,
      seconds: req.seconds,
      vocal: req.vocals ? req.vocalStyle : "none",
      lyrics: userLyrics,
      seed: req.seed,
      title: req.prompt ? titleFrom(req.prompt) : undefined,
    });
    if (req.vocals && !userLyrics && !req.useAi) warnings.push("Built-in lyrics were used. Turn on AI, or paste your own lyrics, for words about your idea.");
  }

  progress(0.12, "Writing the parts");
  const voice = SINGER_VOICES.find((v) => v.id === req.voice) ?? SINGER_VOICES[0];
  const real = realize(plan, req.seed, { singerCenter: singerCenter(voice.label), name: plan.title });
  let p = real.project;
  const songSec = p.tracks.length ? Object.values(p.clips).reduce((a, c) => Math.max(a, c.start + c.length), 0) * spb(p) : req.seconds;

  // Vocals
  if (plan.vocal !== "none" && real.vocalLines.length) {
    try {
      const chorusSections = new Set(plan.sections.map((s, i) => (s.name === "chorus" ? i : -1)).filter((i) => i >= 0));
      const lines = real.vocalLines.map((l) => ({ text: l.text, notes: l.notes, start: l.start, chorus: chorusSections.has(l.section) }));
      const { lead, harmony } = await sing(lines, {
        voice: voice.id,
        style: plan.vocal === "rap" ? "rap" : "sung",
        bpm: plan.bpm,
        keyRoot: p.keyRoot,
        scale: p.scale,
        harmony: req.harmony,
        seconds: songSec,
        onProgress: (f, label) => progress(0.15 + f * 0.65, label),
      });
      const addVocal = async (data: Float32Array, name: string, opts: { volume: number; pan: number }) => {
        const { meta } = await addAssetPcm({ sampleRate: 48_000, channels: [data, data.slice()] }, name);
        const t = makeTrack(p, "audio", { name, volume: opts.volume, pan: opts.pan, fx: vocalFx() });
        p = addTrack(p, t);
        p = { ...p, assets: { ...p.assets, [meta.id]: meta } };
        p = putClips(p, [makeClip(t.id, { name, start: 0, length: meta.duration / spb(p), assetId: meta.id, offset: 0 })]);
      };
      await addVocal(lead, plan.vocal === "rap" ? "Rap vocal" : "Lead vocal", { volume: 0.95, pan: 0 });
      if (harmony) await addVocal(harmony, "Harmony", { volume: 0.45, pan: -0.3 });
      // The guide melody steps aside where the singer sings.
      const sung = new Set(real.vocalLines.map((l) => l.section));
      p = {
        ...p,
        clips: Object.fromEntries(
          Object.entries(p.clips).map(([id, c]) => {
            const secIdx = p.markers.findIndex((m) => Math.abs(m.beat - c.start) < 1e-6);
            return [id, c.trackId === real.melodyTrack && sung.has(secIdx) ? { ...c, muted: true } : c];
          }),
        ),
      };
    } catch (e) {
      warnings.push(`${e instanceof Error ? e.message : "The vocals couldn't be made"} The song was made without vocals; the melody plays the tune instead.`);
    }
  }

  // Risers into big sections and impacts on their first beat.
  progress(0.85, "Adding transitions");
  if (real.hits.length) {
    try {
      const assets: Partial<Record<"riser" | "impact", AssetMeta>> = {};
      for (const kind of ["riser", "impact"] as const) {
        if (!real.hits.some((h) => h.kind === kind)) continue;
        const { meta } = await addAssetFile(await renderSfx(kind), kind === "riser" ? "Riser" : "Impact");
        assets[kind] = meta;
      }
      const fx = makeTrack(p, "audio", { name: "FX", volume: 0.45 });
      p = addTrack(p, fx);
      for (const m of Object.values(assets)) if (m) p = { ...p, assets: { ...p.assets, [m.id]: m } };
      const clips = real.hits
        .map((h) => {
          const m = assets[h.kind];
          if (!m) return null;
          const len = m.duration / spb(p);
          const start = h.kind === "riser" ? h.beat + 8 - len : h.beat;
          return start >= 0 ? makeClip(fx.id, { name: h.kind === "riser" ? "Riser" : "Impact", start, length: len, assetId: m.id, offset: 0 }) : null;
        })
        .filter((c): c is NonNullable<typeof c> => !!c);
      p = putClips(p, clips);
    } catch {
      /* transitions are a nicety */
    }
  }
  progress(1, "Done");
  return { project: p, plan, engine, warnings };
}

const titleFrom = (prompt: string) => {
  const words = prompt.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|song|about|with|for|that|this|make|create|write|want)$/i.test(w));
  return words.slice(0, 4).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") || "New song";
};

// ---------------------------------------------------------------------------------------------
// Text → sound effect (matching the synthesised library)

const SFX_WORDS: Record<SfxId, string[]> = {
  whoosh: ["whoosh", "wind", "fly", "swish", "air", "pass", "transition"],
  swoosh: ["swoosh", "swipe", "slide", "quick"],
  riser: ["riser", "rise", "build", "tension", "uplifter", "sweep up"],
  impact: ["impact", "hit", "punch", "slam", "cinematic", "trailer"],
  boom: ["boom", "sub", "bass hit", "thunder", "explosion", "explode"],
  pop: ["pop", "bubble", "appear", "cork"],
  click: ["click", "tap", "button", "ui", "tick"],
  ding: ["ding", "bell", "correct", "right", "ring"],
  notify: ["notification", "alert", "message", "ping"],
  shutter: ["camera", "shutter", "photo", "snap"],
  typing: ["typing", "keyboard", "type", "keys"],
  bleep: ["bleep", "censor", "beep", "swear"],
  laser: ["laser", "zap", "sci-fi", "shoot", "blaster", "space"],
  heartbeat: ["heart", "heartbeat", "pulse", "beat"],
  kick: ["kick", "drum", "thump"],
  glitch: ["glitch", "digital", "error", "stutter", "robot"],
  drop: ["drop", "fall", "down", "bass drop"],
  chime: ["chime", "magic", "sparkle", "fairy", "win", "success", "coin"],
};

export function matchSfx(prompt: string): SfxId[] {
  const q = prompt.toLowerCase();
  const scored = SFX.map((s) => ({ id: s.id, score: SFX_WORDS[s.id].reduce((a, w) => a + (q.includes(w) ? w.length : 0), 0) + (q.includes(s.label.toLowerCase()) ? 10 : 0) }));
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.id);
}

// ---------------------------------------------------------------------------------------------
// MusicGen on the device

export type GenProgress = { stage: "download" | "generate"; fraction?: number; label: string };

class MusicGenWorker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void; onProgress?: (p: GenProgress) => void }>();
  private files = new Map<string, { loaded: number; total: number }>();

  private get w() {
    if (this.worker) return this.worker;
    const w = new Worker("/music/ai-worker.js", { type: "module", name: "music-ai" });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { id: number; type: string; info?: { status: string; file?: string; loaded?: number; total?: number }; step?: number; steps?: number; audio?: Float32Array; message?: string };
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "progress" && m.info) {
        if (m.info.status === "progress" && m.info.file && m.info.total) this.files.set(m.info.file, { loaded: m.info.loaded ?? 0, total: m.info.total });
        let loaded = 0;
        let total = 0;
        for (const f of this.files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        p.onProgress?.({ stage: "download", fraction: total ? loaded / total : undefined, label: total ? `Downloading the music model once · ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB` : "Loading the music model" });
      } else if (m.type === "step") p.onProgress?.({ stage: "generate", fraction: (m.step ?? 0) / (m.steps || 1), label: "Composing on your device" });
      else if (m.type === "result" && m.audio) {
        this.pending.delete(m.id);
        p.resolve(m.audio);
      } else if (m.type === "error") {
        this.pending.delete(m.id);
        p.reject(new Error(m.message || "The music model failed."));
      }
    };
    w.onerror = (e) => {
      const err = new Error(e.message || "The music model couldn't start in this browser.");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      w.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  /** 32 kHz mono audio for a text prompt. */
  generate(prompt: string, seconds: number, onProgress?: (p: GenProgress) => void): Promise<Float32Array> {
    const id = ++this.seq;
    this.files.clear();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.w.postMessage({ id, type: "generate", payload: { prompt, seconds, guidance: 3 } });
    });
  }

  cancel() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("Stopped."));
    this.pending.clear();
  }
}

export const musicGen = new MusicGenWorker();
export const MUSICGEN_RATE = 32_000;
