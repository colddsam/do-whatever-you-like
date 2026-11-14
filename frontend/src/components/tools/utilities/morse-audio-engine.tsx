"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { AudioLines, Mic, Square } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { decodeMorse, downsample } from "@/lib/utilities/morse-audio";
import { toMorse } from "@/lib/utilities/text";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider } from "../pdf/kit";
import { Output, ValueList, ValueRow } from "../dev/parts";
import { morseWav } from "./text-engines";

type Audio = { x: Float32Array; rate: number; name: string; url?: string; size?: number };

const MAX_MB = 100;
const MAX_SECONDS = 15 * 60;
const LIVE_SECONDS = 120;
const SAMPLE = "CQ CQ DE DO WHATEVER K";

/** Any audio or video file → mono samples, already reduced to about 8 kHz (all a tone needs). */
async function readAudio(file: Blob): Promise<{ x: Float32Array; rate: number; seconds: number }> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const n = Math.min(buf.length, Math.floor(MAX_SECONDS * buf.sampleRate));
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    const ds = downsample(mono, buf.sampleRate);
    return { ...ds, seconds: buf.duration };
  } finally {
    void ctx.close();
  }
}

function Timeline({ env, threshold, frameMs }: { env: Float32Array; threshold: number; frameMs: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr;
    const h = c.clientHeight * dpr;
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    const css = getComputedStyle(c);
    g.clearRect(0, 0, w, h);
    const per = env.length / w;
    for (let px = 0; px < w; px++) {
      let m = 0;
      for (let i = Math.floor(px * per); i < Math.min(env.length, Math.floor((px + 1) * per) + 1); i++) m = Math.max(m, env[i]);
      g.fillStyle = m > threshold ? css.color : css.borderColor;
      const bh = Math.max(1, m * (h - 4));
      g.fillRect(px, h - bh, 1, bh);
    }
    g.strokeStyle = css.outlineColor;
    g.setLineDash([4 * dpr, 4 * dpr]);
    g.beginPath();
    g.moveTo(0, h - threshold * (h - 4));
    g.lineTo(w, h - threshold * (h - 4));
    g.stroke();
  }, [env, threshold]);
  return (
    <figure className="grid gap-1">
      <canvas ref={ref} aria-label="Tone loudness over time; dark bars are beeps" className="h-20 w-full rounded-md border border-line bg-surface text-ink outline-accent [outline-style:none]" />
      <figcaption className="flex justify-between font-mono text-[11px] text-ink-3">
        <span>0 s</span>
        <span>Dashed line: what counts as a beep</span>
        <span>{((env.length * frameMs) / 1000).toFixed(1)} s</span>
      </figcaption>
    </figure>
  );
}

export function MorseAudioEngine() {
  const [audio, setAudio] = useState<Audio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pitchMode, setPitchMode] = useState<"auto" | "manual">("auto");
  const [pitch, setPitch] = useState(700);
  const [sens, setSens] = useState(50);
  const [live, setLive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mic = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; chunks: Float32Array[]; timer: ReturnType<typeof setInterval> } | null>(null);

  const result = useMemo(() => (audio ? decodeMorse(audio.x, audio.rate, { pitch: pitchMode === "manual" ? pitch : undefined, sensitivity: sens / 100 }) : null), [audio, pitchMode, pitch, sens]);
  const ok = result && !("error" in result) ? result : null;

  useEffect(() => () => {
    if (audio?.url) URL.revokeObjectURL(audio.url);
  }, [audio?.url]);

  const stopMic = () => {
    const m = mic.current;
    if (!m) return;
    clearInterval(m.timer);
    m.node.disconnect();
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close();
    mic.current = null;
    setLive(false);
  };
  useEffect(() => () => stopMic(), []);

  const open = async (file: File | Blob, name: string) => {
    stopMic();
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) return setError(`That file is over ${MAX_MB} MB. Trim it to the part with the Morse first.`);
    setBusy(true);
    try {
      const { x, rate, seconds } = await readAudio(file);
      setAudio({ x, rate, name, url: URL.createObjectURL(file), size: file.size });
      if (seconds > MAX_SECONDS) setError(`Only the first ${MAX_SECONDS / 60} minutes were read.`);
    } catch {
      setError("That file couldn't be read as audio. Try MP3, WAV, M4A, OGG, or a video with sound.");
    } finally {
      setBusy(false);
    }
  };

  const listen = async () => {
    setError(null);
    try {
      // Browsers' voice clean-up treats a steady beep as noise and removes it: switch it all off.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      const maxChunks = Math.ceil((LIVE_SECONDS * ctx.sampleRate) / 4096);
      node.onaudioprocess = (e) => {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        if (chunks.length > maxChunks) chunks.shift();
      };
      src.connect(node);
      node.connect(ctx.destination);
      const timer = setInterval(() => {
        const total = chunks.reduce((n, c) => n + c.length, 0);
        if (!total) return;
        const all = new Float32Array(total);
        let o = 0;
        for (const c of chunks) {
          all.set(c, o);
          o += c.length;
        }
        const ds = downsample(all, ctx.sampleRate);
        setAudio({ ...ds, name: "Microphone" });
      }, 600);
      mic.current = { ctx, stream, node, chunks, timer };
      setAudio(null);
      setLive(true);
    } catch (e) {
      const n = (e as DOMException).name;
      setError(n === "NotAllowedError" ? "Microphone access was blocked. Allow it in the address bar and try again." : n === "NotFoundError" ? "No microphone was found." : "The microphone couldn't start.");
    }
  };

  const sample = () => void open(morseWav(toMorse(SAMPLE), 18, 700), "sample.wav");

  return (
    <>
      <div className="grid gap-3 @2xl:grid-cols-2">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void open(f, f.name);
          }}
          disabled={busy}
          className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-ink-3/60 bg-paper px-4 text-center transition-colors hover:border-ink disabled:opacity-60"
        >
          <AudioLines aria-hidden className="size-5 text-ink-2" />
          <span className="text-sm font-medium text-ink">{busy ? "Reading the sound…" : "Choose or drop a recording"}</span>
          <span className="font-mono text-[12px] text-ink-3">MP3 · WAV · M4A · OGG · or a video · up to {MAX_MB} MB</span>
        </button>
        <input ref={fileInput} type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.opus,.flac,.webm,.mp4" className="sr-only" onChange={(e) => (e.target.files?.[0] && void open(e.target.files[0], e.target.files[0].name), (e.target.value = ""))} />
        <div className={cn("flex min-h-36 flex-col items-center justify-center gap-3 rounded-md border px-4 text-center", live ? "border-accent bg-accent/5" : "border-line bg-surface")}>
          {live ? (
            <>
              <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                <span className="size-2 animate-pulse rounded-full bg-accent" /> Listening… hold the phone or speaker near the mic
              </span>
              <button type="button" onClick={stopMic} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90">
                <Square aria-hidden className="size-4" /> Stop listening
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={listen} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90">
                <Mic aria-hidden className="size-4" /> Listen with the microphone
              </button>
              <button type="button" onClick={sample} className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                or try a sample
              </button>
            </>
          )}
        </div>
      </div>

      {error && <Notice tone="warning">{error}</Notice>}

      {audio?.url && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
          <p className="min-w-0 truncate text-sm text-ink">
            {audio.name} {audio.size ? <span className="font-mono text-[12px] text-ink-3">· {formatBytes(audio.size)}</span> : null}
          </p>
          <audio src={audio.url} controls className="h-9 min-w-0 flex-1" aria-label="Play the recording" />
        </div>
      )}

      {audio && result && "error" in result && <Notice tone="warning">{live ? "Waiting for a Morse tone…" : result.error}</Notice>}

      {ok && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid gap-3">
          <Output value={ok.text} name="morse-decoded.txt" lang={`${ok.text.replace(/\s/g, "").length} characters`} download="morse-decoded.txt">
            <p className="max-h-[320px] overflow-auto px-3 py-3 text-2xl font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">{ok.text || "…"}</p>
          </Output>
          <p className="break-all rounded-md bg-paper-2 px-3 py-2 font-mono text-[14px] leading-relaxed tracking-[0.12em] text-ink-2">{ok.morse.replace(/\./g, "·").replace(/-/g, "–")}</p>
          <Timeline env={ok.envelope} threshold={ok.threshold} frameMs={ok.frameMs} />
          <ValueList>
            <ValueRow label="Tone" value={`${ok.pitch} Hz`} note={pitchMode === "auto" ? "Found automatically" : "Set by you"} />
            <ValueRow label="Speed" value={`${Math.round(ok.wpm)} WPM`} note={`One dit ≈ ${ok.unitMs} ms`} />
            <ValueRow label="Length" value={`${ok.seconds.toFixed(1)} s`} />
          </ValueList>
          {ok.text.includes("�") && <Notice>� marks a beep pattern that isn&apos;t a Morse character. Try moving the sensitivity, or set the tone by hand if there are other sounds.</Notice>}
        </motion.div>
      )}

      <Panel>
        <Row label="Tone pitch" hint="Auto finds the beep's pitch">
          <div className="grid gap-3">
            <Chips value={pitchMode} options={[{ value: "auto", label: "Auto" }, { value: "manual", label: "Set it" }]} onChange={setPitchMode} label="Tone pitch" />
            {pitchMode === "manual" && <Slider label="Pitch" value={pitch} min={250} max={2000} step={5} onChange={setPitch} format={(v) => `${v} Hz`} />}
          </div>
        </Row>
        <Row label="Sensitivity" hint="Raise it for faint beeps, lower it for noisy ones">
          <Slider label="Sensitivity" value={sens} min={10} max={90} onChange={setSens} format={(v) => `${v}%`} />
        </Row>
      </Panel>
      <p className="text-sm text-ink-2">
        Have Morse as dots and dashes, or want to make some?{" "}
        <Link href="/tools/morse-code" className="font-medium text-ink underline underline-offset-4">
          Morse code translator →
        </Link>
      </p>
    </>
  );
}
