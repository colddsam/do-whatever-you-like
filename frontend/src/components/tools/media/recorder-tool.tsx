"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { Circle, Download, Mic, Monitor, Pause, Play, Square } from "lucide-react";
import { FileToolError, saveBlob, uploadForm } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { stamp } from "@/lib/video";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Toggle } from "../pdf/kit";

type Source = "screen" | "voice";
type State = "idle" | "recording" | "paused" | "done";

/** The best format this browser can record: MP4 where it can (plays everywhere), WebM otherwise. */
function pickType(video: boolean): string {
  const list = video
    ? ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"];
  return list.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}
const extOf = (type: string) => (type.includes("mp4") ? (type.startsWith("audio") ? "m4a" : "mp4") : type.includes("ogg") ? "ogg" : "webm");

const noop = () => () => {};

export function RecorderTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [picked, setSource] = useState<Source>("screen");
  const [withMic, setWithMic] = useState(true);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; url: string; name: string; type: string } | null>(null);
  const [mp3, setMp3] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const rec = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const live = useRef<HTMLVideoElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef(0);
  // Read after hydration (the server assumes it can); phones can't share a screen, so they get voice.
  const canScreen = useSyncExternalStore(noop, () => Boolean(navigator.mediaDevices?.getDisplayMedia), () => true);
  const source: Source = canScreen ? picked : "voice";

  const stopAll = () => {
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    if (timer.current) clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    void audioCtx.current?.close();
    audioCtx.current = null;
    setLevel(0);
  };
  useEffect(() => () => stopAll(), []);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const start = async () => {
    setError(null);
    setResult(null);
    setMp3({ busy: false });
    try {
      const tracks: MediaStreamTrack[] = [];
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const mix = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      let hasAudio = false;
      if (source === "screen") {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
        streams.current.push(screen);
        tracks.push(...screen.getVideoTracks());
        if (screen.getAudioTracks().length) {
          ctx.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(mix);
          hasAudio = true;
        }
        // The browser's own "Stop sharing" button ends the recording too.
        screen.getVideoTracks()[0].addEventListener("ended", () => rec.current?.state !== "inactive" && rec.current?.stop());
        if (live.current) {
          live.current.srcObject = screen;
          void live.current.play();
        }
      }
      if (source === "voice" || withMic) {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streams.current.push(mic);
        const node = ctx.createMediaStreamSource(mic);
        node.connect(mix);
        node.connect(analyser);
        hasAudio = true;
      }
      if (hasAudio) tracks.push(...mix.stream.getAudioTracks());
      const type = pickType(source === "screen");
      const recorder = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type, videoBitsPerSecond: 4_000_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        const t = recorder.mimeType || type || (source === "screen" ? "video/webm" : "audio/webm");
        const blob = new Blob(chunks, { type: t.split(";")[0] });
        const when = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
        setResult({ blob, url: URL.createObjectURL(blob), name: `${source === "screen" ? "screen" : "voice"}-recording-${when}.${extOf(t)}`, type: t });
        setState("done");
        stopAll();
        if (live.current) live.current.srcObject = null;
      };
      recorder.start(1000);
      rec.current = recorder;
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => rec.current?.state === "recording" && setSeconds((s) => s + 1), 1000);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const meter = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(peak / 128);
        raf.current = requestAnimationFrame(meter);
      };
      if (source === "voice" || withMic) meter();
    } catch (e) {
      stopAll();
      setState("idle");
      const name = (e as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Permission was refused. Allow screen sharing or the microphone when the browser asks."
          : name === "NotFoundError"
            ? "No microphone was found."
            : `Recording couldn't start (${name || (e as Error).message}).`,
      );
    }
  };
  const pause = () => {
    if (rec.current?.state === "recording") {
      rec.current.pause();
      setState("paused");
    } else if (rec.current?.state === "paused") {
      rec.current.resume();
      setState("recording");
    }
  };
  const stop = () => rec.current?.state !== "inactive" && rec.current?.stop();

  const toMp3 = async () => {
    if (!result) return;
    setMp3({ busy: true });
    try {
      const form = new FormData();
      form.append("file", new File([result.blob], result.name, { type: result.type.split(";")[0] }));
      form.append("target", "mp3");
      const out = await uploadForm("/api/tools/universal/convert", form, { fallbackName: result.name.replace(/\.\w+$/, ".mp3") });
      saveBlob(out.blob, out.name);
      setMp3({ busy: false });
    } catch (e) {
      setMp3({ busy: false, error: e instanceof FileToolError ? e.message : "The MP3 couldn't be made." });
    }
  };

  const recording = state === "recording" || state === "paused";
  return (
    <Workbench steps={stepsFor(tool)} current={state === "done" ? 2 : recording ? 1 : 0} footer="Recorded in your browser. Nothing is uploaded unless you ask for an MP3.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        <Panel>
          <Row label="Record">
            <Chips
              value={source}
              options={[
                { value: "screen", label: <span className="inline-flex items-center gap-1.5"><Monitor aria-hidden className="size-3.5" />Screen, window or tab</span>, disabled: !canScreen || recording },
                { value: "voice", label: <span className="inline-flex items-center gap-1.5"><Mic aria-hidden className="size-3.5" />Voice only</span>, disabled: recording },
              ]}
              onChange={setSource}
              label="Record"
            />
            {!canScreen && <p className="mt-2 text-xs text-ink-3">This browser can&apos;t record the screen (phones can&apos;t). Voice recording works.</p>}
          </Row>
          {source === "screen" && (
            <Row label="Sound">
              <Toggle checked={withMic} onChange={setWithMic} disabled={recording} label="Add my microphone" description="Tab and system sound are included when you tick “Share audio” in the browser's picker." />
            </Row>
          )}
        </Panel>
        {error && <Notice tone="danger">{error}</Notice>}

        <div className={cn("relative overflow-hidden rounded-md border border-line bg-ink", source === "voice" && !recording && "hidden")}>
          {source === "screen" ? (
            <video ref={live} muted playsInline className={cn("aspect-video w-full object-contain", !recording && "opacity-0")} />
          ) : (
            <div className="flex h-40 items-end justify-center gap-1 px-6 pb-6" aria-hidden>
              {Array.from({ length: 32 }, (_, i) => (
                <span key={i} className="w-2 rounded-full bg-paper transition-[height] duration-75" style={{ height: `${Math.max(6, level * 130 * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + seconds))))}px` }} />
              ))}
            </div>
          )}
          {!recording && source === "screen" && <p className="absolute inset-0 flex items-center justify-center text-sm text-paper/70">Press Start, then choose what to share.</p>}
          {recording && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-sm bg-ink/80 px-2 py-1 font-mono text-[12px] text-paper">
              <span className={cn("size-2 rounded-full bg-accent", state === "recording" && "animate-pulse")} /> {state === "paused" ? "Paused" : "Rec"} {stamp(seconds, false)}
            </span>
          )}
        </div>

        {(source === "voice" || withMic) && recording && (
          <div className="flex items-center gap-3" aria-label="Microphone level">
            <Mic aria-hidden className="size-4 text-ink-3" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2">
              <div className="h-full rounded-full bg-success transition-[width] duration-75" style={{ width: `${Math.min(100, level * 140)}%` }} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!recording ? (
            <button type="button" onClick={start} disabled={source === "screen" && !canScreen} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-40">
              <Circle aria-hidden className="size-4 fill-accent text-accent" /> {state === "done" ? "Record again" : "Start recording"}
            </button>
          ) : (
            <>
              <button type="button" onClick={stop} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper hover:opacity-90">
                <Square aria-hidden className="size-4" /> Stop
              </button>
              <button type="button" onClick={pause} className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
                {state === "paused" ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />} {state === "paused" ? "Resume" : "Pause"}
              </button>
            </>
          )}
        </div>

        {result && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} aria-label="Your recording" className="grid gap-3 rounded-md border border-line bg-paper p-3">
            {result.type.startsWith("video") ? <video src={result.url} controls className="max-h-[360px] w-full rounded-sm bg-ink" /> : <audio src={result.url} controls className="w-full" />}
            <p className="font-mono text-[12px] text-ink-3">
              {result.name} · {stamp(seconds, false)} · {formatBytes(result.blob.size)}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => saveBlob(result.blob, result.name)} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper hover:opacity-90">
                <Download aria-hidden className="size-4" /> Download {extOf(result.type).toUpperCase()} <span className="font-mono text-[12px] font-normal text-paper/60">{formatBytes(result.blob.size)}</span>
              </button>
              <button type="button" onClick={toMp3} disabled={mp3.busy} className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-50">
                {mp3.busy ? "Making the MP3…" : "Save the sound as MP3"}
              </button>
            </div>
            {mp3.error && <p className="text-xs text-danger">{mp3.error}</p>}
            <p className="text-xs text-ink-3">MP3 is made on our server (the recording is uploaded, converted and deleted).</p>
          </motion.section>
        )}
      </div>
    </Workbench>
  );
}
