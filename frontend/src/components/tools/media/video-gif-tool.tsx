"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Download } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { MIN_DELAY_MS } from "@/lib/gif";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { drawFrame, loadVideo, seek, stamp, VideoError, type LoadedVideo } from "@/lib/video";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { ProgressButton, type Job } from "../progress-button";
import { Chips, Notice, Panel, Row, Toggle } from "../pdf/kit";
import { CHECKER } from "../image/task";
import { Trim } from "./trim";
import { VIDEO_ACCEPT } from "./video-frames-tool";

const MAX_SECONDS = 30;
const MAX_FRAMES = 600;

export function VideoGifTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [vid, setVid] = useState<LoadedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<"forever" | "once" | "3">("forever");
  const [boomerang, setBoomerang] = useState(false);
  const [colors, setColors] = useState(256);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [progress, setProgress] = useState(0);
  const [gif, setGif] = useState<{ blob: Blob; url: string; frames: number; ms: number; w: number; h: number } | null>(null);
  const cancel = useRef(false);

  useEffect(() => () => {
    if (gif) URL.revokeObjectURL(gif.url);
  }, [gif]);
  useEffect(() => () => {
    if (vid) URL.revokeObjectURL(vid.url);
  }, [vid]);

  const take = async (f: File) => {
    setError(null);
    setGif(null);
    try {
      const v = await loadVideo(f);
      setFile(f);
      setVid(v);
      setRange([0, Math.min(v.duration, 5)]);
      setWidth(Math.min(480, v.width));
    } catch (e) {
      setError(e instanceof VideoError ? e.message : "That video couldn't be opened.");
    }
  };

  // Frames are sampled from the video at `fps`; each is shown for 1000 / (fps × speed) ms. GIF players
  // won't go below 20 ms a frame, so very fast settings sample fewer frames instead.
  const len = range[1] - range[0];
  const sampleFps = Math.min(fps, 1000 / (MIN_DELAY_MS * speed));
  const delay = 1000 / (sampleFps * speed);
  const plan = useMemo(() => {
    if (!vid || len <= 0) return [];
    const n = Math.max(1, Math.min(MAX_FRAMES, Math.round(len * sampleFps)));
    const fwd = Array.from({ length: n }, (_, i) => range[0] + (i * len) / n);
    return boomerang ? [...fwd, ...fwd.slice(1, -1).reverse()] : fwd;
  }, [vid, len, sampleFps, range, boomerang]);
  const outW = vid ? Math.min(width, vid.width) : 0;
  const outH = vid ? Math.round((outW * vid.height) / vid.width) : 0;
  // A rough guide: GIF frames of this kind come out at ~0.35–0.7 bytes per pixel.
  const estimate = plan.length * outW * outH * (colors >= 256 ? 0.55 : colors >= 128 ? 0.45 : 0.35);
  const sizes = vid ? [240, 320, 480, 640, 800].filter((w) => w <= vid.width).concat(vid.width < 240 ? [vid.width] : []) : [];

  const run = async () => {
    if (!vid) return;
    cancel.current = false;
    setJob({ kind: "processing" });
    setProgress(0);
    if (gif) URL.revokeObjectURL(gif.url);
    setGif(null);
    try {
      const mod = await import("gifenc");
      const { GIFEncoder, quantize, applyPalette } = ("GIFEncoder" in mod ? mod : (mod as unknown as { default: typeof mod }).default) as typeof mod;
      const enc = GIFEncoder();
      const canvas = document.createElement("canvas");
      const d = Math.max(MIN_DELAY_MS, Math.round(delay / 10) * 10);
      for (let i = 0; i < plan.length; i++) {
        if (cancel.current) throw new DOMException("Aborted", "AbortError");
        await seek(vid.video, plan[i]);
        drawFrame(vid.video, outW, canvas);
        const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
        const palette = quantize(data, colors);
        enc.writeFrame(applyPalette(data, palette), canvas.width, canvas.height, { palette, delay: d, repeat: i === 0 ? (loop === "forever" ? 0 : loop === "once" ? -1 : 3) : undefined });
        setProgress((i + 1) / plan.length);
        if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
      }
      enc.finish();
      const blob = new Blob([enc.bytes()], { type: "image/gif" });
      setGif({ blob, url: URL.createObjectURL(blob), frames: plan.length, ms: plan.length * d, w: outW, h: outH });
      setJob({ kind: "ready" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setJob({ kind: "ready" });
      else setJob({ kind: "failed", message: e instanceof Error ? e.message : "The GIF couldn't be made." });
    }
  };

  return (
    <Workbench steps={stepsFor(tool)} current={!vid ? 0 : gif ? 2 : 1} footer="Made in your browser: the video is never uploaded.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!vid ? (
          <FileDrop accept={VIDEO_ACCEPT} title="Drop a video here" formats="MP4 · MOV · WebM · M4V · OGV" error={error} onFile={take} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2">
              <p className="min-w-0 truncate text-sm text-ink">
                {file?.name} <span className="font-mono text-[12px] text-ink-3">· {vid.width}×{vid.height} · {stamp(vid.duration, false)}</span>
              </p>
              <button type="button" onClick={() => (setVid(null), setFile(null), setGif(null))} className="inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                Change video
              </button>
            </div>
            <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <Trim url={vid.url} duration={vid.duration} start={range[0]} end={range[1]} maxLength={MAX_SECONDS} onChange={(s, e) => setRange([s, e])} />
              <Panel>
                <Row label="Smoothness">
                  <Chips value={fps} options={[5, 8, 10, 12, 15, 20, 25].map((v) => ({ value: v, label: `${v} fps` }))} onChange={setFps} label="Frames per second" />
                </Row>
                <Row label="Width">
                  <Chips value={Math.min(width, vid.width)} options={sizes.map((w) => ({ value: w, label: `${w}px` }))} onChange={setWidth} label="Width" />
                </Row>
                <Row label="Speed">
                  <Chips value={speed} options={[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((v) => ({ value: v, label: `${v}×` }))} onChange={setSpeed} label="Speed" />
                </Row>
                <Row label="Playback">
                  <div className="grid gap-3">
                    <Chips value={loop} options={[{ value: "forever", label: "Loop forever" }, { value: "3", label: "Loop 3 times" }, { value: "once", label: "Play once" }]} onChange={setLoop} label="Loop" />
                    <Toggle checked={boomerang} onChange={setBoomerang} label="Boomerang" description="Plays forward, then backward." />
                  </div>
                </Row>
                <Row label="Colours">
                  <Chips value={colors} options={[{ value: 256, label: "256 (best)" }, { value: 128, label: "128" }, { value: 64, label: "64 (smaller)" }]} onChange={setColors} label="Colours" />
                </Row>
              </Panel>
            </div>
            {sampleFps < fps && <Notice>At {speed}× speed GIFs can&apos;t show {fps} frames a second (the fastest a GIF plays is 50 frames a second), so it uses {Math.round(sampleFps)} frames a second of the video instead.</Notice>}
            <ProgressButton
              job={job}
              label={`Make the GIF · ${plan.length} frames`}
              working="Making the GIF…"
              progress={progress}
              workingHint={`${Math.round(progress * plan.length)} of ${plan.length} frames`}
              hint={`${outW}×${outH}, ${((plan.length * delay) / 1000).toFixed(1)} s long, about ${formatBytes(estimate)}. Up to ${MAX_SECONDS} s of video.`}
              disabled={!plan.length}
              onStart={run}
              onCancel={() => (cancel.current = true)}
            />
          </>
        )}

        {gif && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} aria-label="Your GIF" className="grid gap-3">
            <div className="flex justify-center rounded-md border border-line p-3" style={{ backgroundImage: CHECKER }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={gif.url} alt="The GIF" className="max-h-[480px] max-w-full rounded-sm" />
            </div>
            <p className="font-mono text-[12px] text-ink-3">
              {gif.w}×{gif.h} · {gif.frames} frames · {(gif.ms / 1000).toFixed(1)} s · {formatBytes(gif.blob.size)}
            </p>
            <button type="button" onClick={() => saveBlob(gif.blob, `${(file?.name ?? "video").replace(/\.[^.]+$/, "")}.gif`)} className="inline-flex h-11 w-fit items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
              <Download aria-hidden className="size-4" /> Download GIF <span className="font-mono text-[12px] font-normal text-paper/60">{formatBytes(gif.blob.size)}</span>
            </button>
            {gif.blob.size > 15 * 1024 * 1024 && <Notice tone="warning">That&apos;s a big GIF. Many apps cap GIFs at 8–15 MB: try a smaller width, fewer frames a second, or 128 colours.</Notice>}
          </motion.section>
        )}
      </div>
    </Workbench>
  );
}
