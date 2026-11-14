"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Download } from "lucide-react";
import { FileToolError, saveBlob, uploadForm, type Converted } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { stamp } from "@/lib/video";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { ProgressButton, type Job } from "../progress-button";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { Trim } from "./trim";

export const MEDIA_ACCEPT = "audio/*,video/*,.mkv,.avi,.flac,.opus,.m4a,.wma,.amr,.3gp";
const FORMATS = "MP4 · MOV · MKV · WebM · AVI · MP3 · WAV · M4A · FLAC · OGG";
const MAX_MB = 150;

type Source = { file: File; url: string; duration: number | null; video: boolean };

/** Reads the length (and whether there's a picture) with the browser's own player, when it can play the file. */
function readMedia(file: File): Promise<Source> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    const done = (ok: boolean) => {
      const d = ok && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
      resolve({ file, url, duration: d, video: ok ? el.videoWidth > 0 : /^video\//.test(file.type) || /\.(mkv|avi|wmv|flv|3gp)$/i.test(file.name) });
    };
    el.onloadedmetadata = () => done(true);
    el.onerror = () => done(false);
    setTimeout(() => done(false), 8000);
    el.src = url;
  });
}

/** "1:23.5", "83.5" or "01:02:03" → seconds. */
function parseTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function useSource() {
  const [src, setSrc] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src.url);
  }, [src]);
  const take = async (f: File) => {
    setError(null);
    if (f.size > MAX_MB * 1024 * 1024) return setError(`That file is over ${MAX_MB} MB.`);
    setSrc(await readMedia(f));
  };
  return { src, setSrc, error, take };
}

function SourceRow({ src, onChange }: { src: Source; onChange: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2">
      <p className="min-w-0 truncate text-sm text-ink">
        {src.file.name} <span className="font-mono text-[12px] text-ink-3">· {src.video ? "video" : "audio"}{src.duration ? ` · ${stamp(src.duration, false)}` : ""} · {formatBytes(src.file.size)}</span>
      </p>
      <button type="button" onClick={onChange} className="inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
        Change file
      </button>
    </div>
  );
}

/**
 * The result's player. With `before`, the original runs silently alongside it in step, and a
 * Before / After switch swaps what you hear at the same moment, which makes the difference obvious.
 */
function Player({ url, video, before }: { url: string; video: boolean; before?: string }) {
  const [side, setSide] = useState<"after" | "before">("after");
  const main = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const orig = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = main.current;
    const b = orig.current;
    if (!a || !b) return;
    const sync = () => {
      if (Math.abs(b.currentTime - a.currentTime) > 0.15) b.currentTime = a.currentTime;
    };
    const play = () => {
      sync();
      void b.play().catch(() => {});
    };
    const pause = () => b.pause();
    a.addEventListener("play", play);
    a.addEventListener("pause", pause);
    a.addEventListener("seeked", sync);
    a.addEventListener("timeupdate", sync);
    return () => {
      a.removeEventListener("play", play);
      a.removeEventListener("pause", pause);
      a.removeEventListener("seeked", sync);
      a.removeEventListener("timeupdate", sync);
    };
  }, [url, before]);
  useEffect(() => {
    if (main.current) main.current.muted = side === "before";
    if (orig.current) orig.current.muted = side === "after";
  }, [side]);
  return (
    <>
      {video ? <video ref={main} src={url} controls className="max-h-[360px] w-full rounded-sm bg-ink" /> : <audio ref={main} src={url} controls className="w-full" />}
      {before && (
        <div className="flex flex-wrap items-center gap-3">
          <audio ref={orig} src={before} preload="auto" muted className="hidden" />
          <Chips value={side} options={[{ value: "before", label: "Before" }, { value: "after", label: "After" }]} onChange={setSide} label="Hear" />
          <p className="text-xs text-ink-3">Play, then flip between them to hear the difference.</p>
        </div>
      )}
    </>
  );
}

function Result({ out, kind, onBack, before }: { out: Converted; kind: "video" | "audio"; onBack: () => void; before?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(out.blob);
    queueMicrotask(() => setUrl(u));
    return () => URL.revokeObjectURL(u);
  }, [out]);
  const notes: string[] = (() => {
    try {
      return out.info ? (JSON.parse(out.info).notes ?? []) : [];
    } catch {
      return [];
    }
  })();
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} aria-label="Result" className="grid gap-3 rounded-md border border-line bg-paper p-3">
      {url && <Player url={url} video={kind === "video" && /video|mp4|webm|quicktime/.test(out.type)} before={before} />}
      <p className="font-mono text-[12px] text-ink-3">
        {out.name} · {formatBytes(out.size)}
      </p>
      {notes.map((n) => (
        <p key={n} className="text-xs text-ink-2">
          {n}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => saveBlob(out.blob, out.name)} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
          <Download aria-hidden className="size-4" /> Download <span className="font-mono text-[12px] font-normal text-paper/60">{formatBytes(out.size)}</span>
        </button>
        <button type="button" onClick={onBack} className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
          Change settings
        </button>
      </div>
    </motion.section>
  );
}

function useUpload(endpoint: string) {
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [out, setOut] = useState<Converted | null>(null);
  const abort = useRef<AbortController | null>(null);
  const run = async (form: FormData, fallbackName: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setOut(null);
    setJob({ kind: "uploading", progress: 0 });
    try {
      const res = await uploadForm(endpoint, form, {
        signal: ctrl.signal,
        fallbackName,
        onUpload: (p) => setJob({ kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      setOut(res);
      setJob({ kind: "ready" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: e instanceof FileToolError ? e.message : "Something went wrong. Try again." });
    }
  };
  return { job, out, setOut, run, cancel: () => abort.current?.abort() };
}

/* ---------- Trimmer ---------- */

export function TrimMediaTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const { src, setSrc, error, take } = useSource();
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [typed, setTyped] = useState({ start: "0:00", end: "" });
  const [exact, setExact] = useState(false);
  const up = useUpload("/api/tools/media/trim");

  useEffect(() => {
    if (src?.duration) queueMicrotask(() => setRange([0, src.duration!]));
  }, [src]);

  const start = src?.duration ? range[0] : parseTime(typed.start);
  const end = src?.duration ? range[1] : parseTime(typed.end);
  const valid = start !== null && end !== null && end > start;
  const len = valid ? end! - start! : 0;
  const tooLongExact = exact && src?.video && len > 180;

  const go = () => {
    if (!src || !valid) return;
    const form = new FormData();
    form.append("file", src.file);
    form.append("start", String(start));
    form.append("end", String(end));
    form.append("exact", String(exact && src.video));
    void up.run(form, src.file.name.replace(/(\.[^.]+)$/, "-trimmed$1"));
  };

  return (
    <Workbench steps={stepsFor(tool)} current={!src ? 0 : up.out ? 2 : 1} footer="Your file is cut on our server and deleted right after you download it.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!src ? (
          <FileDrop accept={MEDIA_ACCEPT} title="Drop a video or audio file here" formats={`${FORMATS} · up to ${MAX_MB} MB`} error={error} onFile={take} />
        ) : (
          <>
            <SourceRow src={src} onChange={() => (setSrc(null), up.setOut(null))} />
            {src.duration ? (
              <Trim url={src.url} duration={src.duration} start={range[0]} end={range[1]} onChange={(s, e) => setRange([s, e])} />
            ) : (
              <Panel>
                <Row label="Part to keep" hint="This browser can't preview the file, so type the times.">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-32">
                      <TextField label="Start" value={typed.start} onChange={(v) => setTyped((t) => ({ ...t, start: v }))} placeholder="0:00" mono />
                    </div>
                    <span className="text-ink-3">to</span>
                    <div className="w-32">
                      <TextField label="End" value={typed.end} onChange={(v) => setTyped((t) => ({ ...t, end: v }))} placeholder="1:30" mono />
                    </div>
                    <span className="text-xs text-ink-3">minutes:seconds, or seconds</span>
                  </div>
                </Row>
              </Panel>
            )}
            {src.video && (
              <Panel>
                <Row label="Cut">
                  <Chips
                    value={exact ? "exact" : "fast"}
                    options={[{ value: "fast", label: "Fast, no quality loss" }, { value: "exact", label: "Frame-exact" }]}
                    onChange={(v) => setExact(v === "exact")}
                    label="Cut"
                  />
                  <p className="mt-2 text-xs text-ink-3">
                    {exact ? "Re-encodes the part you keep so it starts on the exact frame. Up to 3 minutes; takes a little longer." : "Copies the video as it is: instant and lossless, but it starts at the nearest keyframe (up to a couple of seconds early)."}
                  </p>
                </Row>
              </Panel>
            )}
            {tooLongExact && <Notice tone="warning">Frame-exact cuts are for parts up to 3 minutes. Use a fast cut, or a shorter part.</Notice>}
            <ProgressButton
              job={up.job}
              label={valid ? `Keep ${stamp(len)} (${stamp(start!)} → ${stamp(end!)})` : "Pick the part to keep"}
              working={exact ? "Cutting and re-encoding…" : "Cutting…"}
              hint={src.video ? (exact ? "Frame-exact, re-encoded." : "No re-encoding: same quality as the original.") : "Audio is cut without re-encoding."}
              disabled={!valid || Boolean(tooLongExact)}
              onStart={go}
              onCancel={up.cancel}
            />
            {up.out && <Result out={up.out} kind={src.video ? "video" : "audio"} onBack={() => up.setOut(null)} />}
          </>
        )}
      </div>
    </Workbench>
  );
}

/* ---------- Volume, normalise, mute ---------- */

type Mode = "volume" | "normalize" | "mute";

export function SoundTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const { src, setSrc, error, take } = useSource();
  const [mode, setMode] = useState<Mode>("volume");
  const [gain, setGain] = useState(6);
  const up = useUpload("/api/tools/media/sound");
  const preview = useRef<HTMLMediaElement | null>(null);
  const graph = useRef<{ ctx: AudioContext; node: GainNode } | null>(null);

  // Live preview of a volume change: the browser's own player through a gain node.
  useEffect(() => {
    const g = graph.current;
    if (g) g.node.gain.value = mode === "mute" ? 0 : mode === "volume" ? 10 ** (gain / 20) : 1;
  }, [gain, mode]);
  useEffect(() => () => void graph.current?.ctx.close(), []);
  const hook = (el: HTMLMediaElement | null) => {
    preview.current = el;
    if (!el || graph.current) return;
    const start = () => {
      if (graph.current) return;
      const ctx = new AudioContext();
      const node = ctx.createGain();
      ctx.createMediaElementSource(el).connect(node).connect(ctx.destination);
      node.gain.value = mode === "mute" ? 0 : mode === "volume" ? 10 ** (gain / 20) : 1;
      graph.current = { ctx, node };
    };
    el.addEventListener("play", start, { once: true });
  };

  const go = () => {
    if (!src) return;
    const form = new FormData();
    form.append("file", src.file);
    form.append("mode", mode);
    form.append("gain_db", String(mode === "volume" ? gain : 0));
    void up.run(form, src.file.name);
  };
  const canMute = src?.video ?? false;

  return (
    <Workbench steps={stepsFor(tool)} current={!src ? 0 : up.out ? 2 : 1} footer="Your file is processed on our server and deleted right after you download it.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!src ? (
          <FileDrop accept={MEDIA_ACCEPT} title="Drop a video or audio file here" formats={`${FORMATS} · up to ${MAX_MB} MB`} error={error} onFile={take} />
        ) : (
          <>
            <SourceRow src={src} onChange={() => (setSrc(null), up.setOut(null), (graph.current = null))} />
            {src.duration &&
              (src.video ? (
                <video ref={hook} src={src.url} controls playsInline className="max-h-[300px] w-full rounded-md border border-line bg-ink" />
              ) : (
                <audio ref={hook} src={src.url} controls className="w-full" />
              ))}
            <Panel>
              <Row label="Change">
                <Chips
                  value={mode}
                  options={[
                    { value: "volume", label: "Louder or quieter" },
                    { value: "normalize", label: "Normalise loudness" },
                    { value: "mute", label: "Remove the sound", disabled: !canMute, title: canMute ? undefined : "For videos only" },
                  ]}
                  onChange={setMode}
                  label="Change"
                />
              </Row>
              {mode === "volume" && (
                <Row label="Volume" hint="Play the preview to hear it">
                  <Slider label="Volume change" value={gain} min={-20} max={20} onChange={setGain} format={(v) => `${v > 0 ? "+" : ""}${v} dB`} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[-10, -6, 3, 6, 10, 15].map((v) => (
                      <button key={v} type="button" onClick={() => setGain(v)} className={cn("rounded-[6px] px-2 py-1 font-mono text-[12px]", gain === v ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink")}>
                        {v > 0 ? "+" : ""}
                        {v} dB
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-3">+6 dB is about twice as loud. Boosts go through a limiter so the peaks don&apos;t crackle.</p>
                </Row>
              )}
              {mode === "normalize" && <Row label="Level"><p className="text-sm text-ink-2">Evens out the loudness to −16 LUFS, the level podcasts and streaming apps use: quiet recordings come up, loud ones come down.</p></Row>}
              {mode === "mute" && <Row label="Result"><p className="text-sm text-ink-2">The sound track is removed; the picture is copied as it is, so it&apos;s instant and keeps its quality.</p></Row>}
            </Panel>
            <ProgressButton
              job={up.job}
              label={mode === "volume" ? `Make it ${gain >= 0 ? "louder" : "quieter"} (${gain > 0 ? "+" : ""}${gain} dB)` : mode === "normalize" ? "Normalise the loudness" : "Remove the sound"}
              working={mode === "mute" ? "Removing the sound…" : "Changing the sound…"}
              hint={src.video && mode !== "mute" ? "The picture is copied as it is; only the sound is re-encoded." : "Same format back."}
              disabled={mode === "volume" && gain === 0}
              onStart={go}
              onCancel={up.cancel}
            />
            {up.out && <Result out={up.out} kind={src.video && mode !== "mute" ? "video" : src.video ? "video" : "audio"} onBack={() => up.setOut(null)} />}
          </>
        )}
      </div>
    </Workbench>
  );
}

/* ---------- Noise remover ---------- */

type Strength = "light" | "medium" | "strong";
type Hum = "auto" | "off" | "50" | "60";

export function DenoiseTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const { src, setSrc, error, take } = useSource();
  const [strength, setStrength] = useState<Strength>("medium");
  const [voice, setVoice] = useState(true);
  const [hum, setHum] = useState<Hum>("auto");
  const [clicks, setClicks] = useState(false);
  const [sample, setSample] = useState<"auto" | "pick">("auto");
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const [typed, setTyped] = useState({ start: "", end: "" });
  const up = useUpload("/api/tools/media/denoise");

  const picked: [number | null, number | null] = src?.duration ? range : [parseTime(typed.start), parseTime(typed.end)];
  const pickOk = sample === "auto" || (picked[0] !== null && picked[1] !== null && picked[1] - picked[0] >= 0.2);

  const go = () => {
    if (!src) return;
    const form = new FormData();
    form.append("file", src.file);
    form.append("strength", strength);
    form.append("voice", String(voice));
    form.append("hum", hum);
    form.append("clicks", String(clicks));
    if (sample === "pick" && picked[0] !== null && picked[1] !== null) {
      form.append("noise_start", picked[0].toFixed(3));
      form.append("noise_end", picked[1].toFixed(3));
    }
    void up.run(form, src.file.name);
  };

  return (
    <Workbench steps={stepsFor(tool)} current={!src ? 0 : up.out ? 2 : 1} footer="Your file is cleaned on our server and deleted right after you download it.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!src ? (
          <FileDrop accept={MEDIA_ACCEPT} title="Drop a video or audio file here" formats={`${FORMATS} · up to ${MAX_MB} MB`} error={error} onFile={(f) => void take(f).then(() => setRange([0, 1]))} />
        ) : (
          <>
            <SourceRow src={src} onChange={() => (setSrc(null), up.setOut(null))} />
            <Panel>
              <Row label="Strength" hint="Start with medium; strong can sound a little hollow">
                <Chips
                  value={strength}
                  options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "strong", label: "Strong" }]}
                  onChange={setStrength}
                  label="Strength"
                />
              </Row>
              <Row label="What's in it">
                <Chips value={voice ? "voice" : "other"} options={[{ value: "voice", label: "Speech (talk, podcast, call, lecture)" }, { value: "other", label: "Music or anything else" }]} onChange={(v) => setVoice(v === "voice")} label="Content" />
                <p className="mt-2 text-xs text-ink-3">{voice ? "Also trims rumble below 70 Hz and hiss above 12 kHz, where speech has nothing." : "Keeps the full range of frequencies."}</p>
              </Row>
              <Row label="Mains hum" hint="The low buzz from power lines and cables">
                <Chips value={hum} options={[{ value: "auto", label: "Find it" }, { value: "50", label: "50 Hz" }, { value: "60", label: "60 Hz" }, { value: "off", label: "Off" }]} onChange={setHum} label="Hum" />
              </Row>
              <Row label="Clicks">
                <Toggle checked={clicks} onChange={setClicks} label="Smooth out clicks and pops" description="For vinyl, mouth clicks and crackly mics." />
              </Row>
              <Row label="Learn the noise from" hint="A moment with only the background noise">
                <Chips value={sample} options={[{ value: "auto", label: "The quietest moment (automatic)" }, { value: "pick", label: "A part I pick" }]} onChange={setSample} label="Noise sample" />
                {sample === "pick" &&
                  (src.duration ? (
                    <div className="mt-3">
                      <Trim url={src.url} duration={src.duration} start={range[0]} end={range[1]} onChange={(s, e) => setRange([s, e])} />
                      <p className="mt-1 text-xs text-ink-3">Pick a second or two where nobody speaks and no music plays: just the hiss, fan or traffic.</p>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="w-28">
                        <TextField label="From" value={typed.start} onChange={(v) => setTyped((t) => ({ ...t, start: v }))} placeholder="0:01" mono />
                      </div>
                      <span className="text-ink-3">to</span>
                      <div className="w-28">
                        <TextField label="To" value={typed.end} onChange={(v) => setTyped((t) => ({ ...t, end: v }))} placeholder="0:03" mono />
                      </div>
                    </div>
                  ))}
              </Row>
            </Panel>
            {!pickOk && <Notice tone="warning">Pick a noise-only part at least 0.2 seconds long.</Notice>}
            <ProgressButton
              job={up.job}
              label="Remove the noise"
              working="Learning the noise and cleaning…"
              hint={src.video ? "The picture is copied as it is; only the sound is cleaned." : "Same format back."}
              disabled={!pickOk}
              onStart={go}
              onCancel={up.cancel}
            />
            {up.out && <Result out={up.out} kind={src.video ? "video" : "audio"} onBack={() => up.setOut(null)} before={src.url} />}
          </>
        )}
      </div>
    </Workbench>
  );
}
