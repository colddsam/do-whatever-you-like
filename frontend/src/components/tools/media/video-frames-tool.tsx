"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download, LayoutGrid, X } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { drawFrame, loadVideo, seek, stamp, toBlob, VideoError, zipFiles, type LoadedVideo } from "@/lib/video";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { ProgressButton, type Job } from "../progress-button";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { Trim } from "./trim";

type Mode = "count" | "interval" | "fps";
type Format = "jpg" | "png" | "webp";
type Frame = { i: number; t: number; blob: Blob; url: string; name: string };

const MAX_FRAMES = 500;
const MIME: Record<Format, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const VIDEO_ACCEPT = "video/*,.mp4,.mov,.webm,.m4v,.ogv,.mkv";

/** The moments to grab, in seconds, for each way of choosing frames. */
function moments(mode: Mode, start: number, end: number, count: number, every: number, fps: number): number[] {
  const len = end - start;
  if (len <= 0) return [];
  let out: number[] = [];
  if (mode === "count") {
    if (count <= 1) out = [start + len / 2];
    else out = Array.from({ length: count }, (_, i) => start + (i * len) / (count - 1));
  } else {
    const gap = mode === "interval" ? every : 1 / fps;
    if (gap <= 0) return [];
    for (let t = start; t <= end + 1e-6 && out.length <= MAX_FRAMES; t += gap) out.push(t);
  }
  // The very last instant of a file often has no picture; stay a hair inside.
  return out.map((t) => Math.min(t, end - 0.02 > start ? end - 0.02 : end)).slice(0, MAX_FRAMES + 1);
}

export function VideoFramesTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [vid, setVid] = useState<LoadedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [mode, setMode] = useState<Mode>("count");
  const [count, setCount] = useState(12);
  const [every, setEvery] = useState("1");
  const [fps, setFps] = useState(2);
  const [width, setWidth] = useState(0);
  const [format, setFormat] = useState<Format>("jpg");
  const [quality, setQuality] = useState(90);
  const [sheet, setSheet] = useState(false);
  const [cols, setCols] = useState(4);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [sheetBlob, setSheetBlob] = useState<{ blob: Blob; url: string } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Frame | null>(null);
  const cancel = useRef(false);

  useEffect(() => () => frames.forEach((f) => URL.revokeObjectURL(f.url)), [frames]);
  useEffect(() => () => {
    if (vid) URL.revokeObjectURL(vid.url);
  }, [vid]);

  const take = async (f: File) => {
    setError(null);
    setFrames([]);
    setSheetBlob(null);
    setJob({ kind: "ready" });
    try {
      const v = await loadVideo(f);
      setFile(f);
      setVid(v);
      setRange([0, v.duration]);
      setWidth(0);
    } catch (e) {
      setError(e instanceof VideoError ? e.message : "That video couldn't be opened.");
    }
  };

  const everySec = Math.max(0.04, Number(every) || 1);
  const times = useMemo(() => (vid ? moments(mode, range[0], range[1], count, everySec, fps) : []), [vid, mode, range, count, everySec, fps]);
  const tooMany = times.length > MAX_FRAMES;
  const outW = vid ? (width && width < vid.width ? width : vid.width) : 0;
  const outH = vid ? Math.round((outW * vid.height) / vid.width) : 0;
  const sizes = vid ? [0, 1920, 1280, 854, 640, 320].filter((w) => w === 0 || w < vid.width) : [];

  const run = async () => {
    if (!vid || !file) return;
    cancel.current = false;
    setJob({ kind: "processing" });
    setProgress(0);
    frames.forEach((f) => URL.revokeObjectURL(f.url));
    setFrames([]);
    setSheetBlob(null);
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || "video";
    const canvas = document.createElement("canvas");
    const out: Frame[] = [];
    try {
      const list = times.slice(0, MAX_FRAMES);
      for (let i = 0; i < list.length; i++) {
        if (cancel.current) throw new DOMException("Aborted", "AbortError");
        await seek(vid.video, list[i]);
        drawFrame(vid.video, outW, canvas);
        const blob = await toBlob(canvas, MIME[format], format === "png" ? undefined : quality / 100);
        const name = `${base}_${String(i + 1).padStart(4, "0")}_${stamp(list[i]).replace(/:/g, "-")}.${format}`;
        out.push({ i, t: list[i], blob, url: URL.createObjectURL(blob), name });
        setProgress((i + 1) / list.length);
        if (i % 6 === 5) setFrames([...out]);
      }
      setFrames(out);
      setPicked(new Set(out.map((f) => f.i)));
      if (sheet) setSheetBlob(await contactSheet(out, cols, vid, file.name));
      setJob({ kind: "ready" });
    } catch (e) {
      setFrames(out);
      setPicked(new Set(out.map((f) => f.i)));
      if (e instanceof DOMException && e.name === "AbortError") setJob({ kind: "ready" });
      else setJob({ kind: "failed", message: e instanceof Error ? e.message : "The frames couldn't be read." });
    }
  };

  const chosen = frames.filter((f) => picked.has(f.i));
  const total = chosen.reduce((n, f) => n + f.blob.size, 0);
  const [zipping, setZipping] = useState(false);
  const downloadZip = async () => {
    setZipping(true);
    try {
      const base = (file?.name ?? "video").replace(/\.[^.]+$/, "");
      saveBlob(await zipFiles(chosen.map((f) => ({ name: f.name, blob: f.blob }))), `${base}-frames.zip`);
    } finally {
      setZipping(false);
    }
  };

  const step = !vid ? 0 : frames.length ? 2 : 1;
  return (
    <Workbench steps={stepsFor(tool)} current={step} footer="The video is read by your browser and never uploaded. Frames are made on your device.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!vid ? (
          <FileDrop accept={VIDEO_ACCEPT} title="Drop a video here" formats="MP4 · MOV · WebM · M4V · OGV" error={error} onFile={take} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2">
              <p className="min-w-0 truncate text-sm text-ink">
                {file?.name} <span className="font-mono text-[12px] text-ink-3">· {vid.width}×{vid.height} · {stamp(vid.duration, false)} · {formatBytes(file?.size ?? 0)}</span>
              </p>
              <button type="button" onClick={() => (setVid(null), setFile(null), setFrames([]))} className="inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                Change video
              </button>
            </div>
            <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <Trim url={vid.url} duration={vid.duration} start={range[0]} end={range[1]} onChange={(s, e) => setRange([s, e])} />
              <Panel>
                <Row label="Which frames">
                  <Chips value={mode} options={[{ value: "count", label: "A number of frames" }, { value: "interval", label: "Every few seconds" }, { value: "fps", label: "Frames per second" }]} onChange={setMode} label="Which frames" />
                  <div className="mt-3">
                    {mode === "count" && <Slider label="Number of frames" value={count} min={1} max={200} onChange={setCount} format={(v) => String(v)} />}
                    {mode === "interval" && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-2">One frame every</span>
                        <div className="w-24">
                          <TextField label="Seconds between frames" value={every} onChange={(v) => setEvery(v.replace(/[^\d.]/g, "").slice(0, 6))} mono inputMode="decimal" />
                        </div>
                        <span className="text-sm text-ink-2">seconds</span>
                      </div>
                    )}
                    {mode === "fps" && <Chips value={fps} options={[1, 2, 5, 10, 15, 24, 30].map((v) => ({ value: v, label: `${v} fps` }))} onChange={setFps} label="Frames per second" />}
                  </div>
                  <p className={cn("mt-2 font-mono text-[12px]", tooMany ? "text-warning" : "text-ink-3")}>
                    {tooMany ? `That's over ${MAX_FRAMES} frames; the first ${MAX_FRAMES} will be made. Pick a shorter part or fewer frames.` : `${times.length} frame${times.length === 1 ? "" : "s"} from ${(range[1] - range[0]).toFixed(1)} s`}
                  </p>
                </Row>
                <Row label="Size">
                  <Chips value={width} options={sizes.map((w) => ({ value: w, label: w === 0 ? `Original ${vid.width}×${vid.height}` : `${w} wide` }))} onChange={setWidth} label="Size" />
                </Row>
                <Row label="Format">
                  <Chips value={format} options={[{ value: "jpg", label: "JPG" }, { value: "png", label: "PNG (lossless)" }, { value: "webp", label: "WebP" }]} onChange={setFormat} label="Format" />
                  {format !== "png" && (
                    <div className="mt-3">
                      <Slider label="Quality" value={quality} min={40} max={100} onChange={setQuality} format={(v) => `${v}%`} />
                    </div>
                  )}
                </Row>
                <Row label="Extras">
                  <Toggle checked={sheet} onChange={setSheet} label="Also make a contact sheet" description="All the frames on one image, with their times." />
                  {sheet && (
                    <div className="mt-3">
                      <Slider label="Columns" value={cols} min={2} max={10} onChange={setCols} format={(v) => String(v)} />
                    </div>
                  )}
                </Row>
              </Panel>
            </div>
            <ProgressButton
              job={job}
              label={`Extract ${Math.min(times.length, MAX_FRAMES)} frame${times.length === 1 ? "" : "s"}`}
              working="Reading frames…"
              progress={progress}
              workingHint={`${Math.round(progress * Math.min(times.length, MAX_FRAMES))} of ${Math.min(times.length, MAX_FRAMES)} frames`}
              hint={`${outW}×${outH} ${format.toUpperCase()} each, made on your device.`}
              disabled={!times.length}
              onStart={run}
              onCancel={() => (cancel.current = true)}
            />
          </>
        )}

        {frames.length > 0 && (
          <section aria-label="Frames" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="label-mono text-ink-3">
                {chosen.length} of {frames.length} frames picked · {formatBytes(total)}
              </p>
              <div className="flex gap-1">
                <button type="button" onClick={() => setPicked(new Set(frames.map((f) => f.i)))} className="h-8 rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                  Pick all
                </button>
                <button type="button" onClick={() => setPicked(new Set())} className="h-8 rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                  Pick none
                </button>
              </div>
            </div>
            <ul className="grid max-h-[560px] grid-cols-2 gap-px overflow-auto rounded-md border border-line bg-line @md:grid-cols-3 @3xl:grid-cols-5" data-lenis-prevent>
              {frames.map((f) => {
                const on = picked.has(f.i);
                return (
                  <motion.li key={f.i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative bg-paper">
                    <button type="button" onClick={() => setOpen(f)} className="block w-full" title={`Frame ${f.i + 1} at ${stamp(f.t)}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt={`Frame at ${stamp(f.t)}`} className={cn("aspect-video w-full object-contain transition-opacity", !on && "opacity-40")} />
                    </button>
                    <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                      <span className="font-mono text-[12px] text-ink-2">
                        {String(f.i + 1).padStart(2, "0")} · {stamp(f.t)}
                      </span>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`Pick frame ${f.i + 1}`}
                        onClick={() => setPicked((s) => (s.has(f.i) ? (s.delete(f.i), new Set(s)) : new Set(s.add(f.i))))}
                        className={cn("flex size-6 items-center justify-center rounded-sm border", on ? "border-ink bg-ink text-paper" : "border-line bg-surface")}
                      >
                        {on && <Check aria-hidden className="size-3.5" />}
                      </button>
                    </div>
                  </motion.li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!chosen.length || zipping} onClick={downloadZip} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-40">
                <Download aria-hidden className="size-4" />
                {zipping ? "Packing…" : `Download ${chosen.length} as ZIP`}
                <span className="font-mono text-[12px] font-normal text-paper/60">{formatBytes(total)}</span>
              </button>
              {sheetBlob && (
                <button type="button" onClick={() => saveBlob(sheetBlob.blob, `${(file?.name ?? "video").replace(/\.[^.]+$/, "")}-contact-sheet.jpg`)} className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
                  <LayoutGrid aria-hidden className="size-4" /> Contact sheet <span className="font-mono text-[12px] text-ink-3">{formatBytes(sheetBlob.blob.size)}</span>
                </button>
              )}
            </div>
            {sheetBlob && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sheetBlob.url} alt="Contact sheet of the frames" className="w-full rounded-md border border-line" />
            )}
          </section>
        )}
        {vid && vid.duration > 0 && frames.length === 0 && job.kind === "ready" && <Notice>Pick the part of the video with the handles, choose how many frames you want, then extract. Click a frame afterwards to see it full size.</Notice>}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/80 p-4" onClick={() => setOpen(null)} role="dialog" aria-label={`Frame ${open.i + 1}`}>
            <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.url} alt={`Frame at ${stamp(open.t)}`} className="max-h-[80vh] w-auto rounded-md" />
              <div className="mt-3 flex items-center justify-between gap-3 text-paper">
                <span className="font-mono text-sm">
                  Frame {open.i + 1} · {stamp(open.t)} · {formatBytes(open.blob.size)}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => saveBlob(open.blob, open.name)} className="inline-flex h-10 items-center gap-2 rounded-md bg-paper px-4 text-sm font-medium text-ink">
                    <Download aria-hidden className="size-4" /> Download
                  </button>
                  <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="inline-flex size-10 items-center justify-center rounded-md border border-paper/30 text-paper">
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Workbench>
  );
}

/** Every frame on one sheet, in a grid, with its time underneath. */
async function contactSheet(frames: Frame[], cols: number, vid: LoadedVideo, name: string) {
  const cellW = 320;
  const cellH = Math.round((cellW * vid.height) / vid.width);
  const label = 22;
  const pad = 8;
  const head = 44;
  const rows = Math.ceil(frames.length / cols);
  const c = document.createElement("canvas");
  c.width = cols * (cellW + pad) + pad;
  c.height = head + rows * (cellH + label + pad) + pad;
  const g = c.getContext("2d")!;
  g.fillStyle = "#15140f";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#f3f0e8";
  g.font = "600 18px system-ui, sans-serif";
  g.fillText(name.slice(0, 80), pad, 28);
  g.font = "13px ui-monospace, monospace";
  g.fillStyle = "#a9a496";
  const info = `${vid.width}×${vid.height} · ${stamp(vid.duration, false)} · ${frames.length} frames`;
  g.fillText(info, c.width - pad - g.measureText(info).width, 28);
  for (let i = 0; i < frames.length; i++) {
    const img = await createImageBitmap(frames[i].blob);
    const x = pad + (i % cols) * (cellW + pad);
    const y = head + Math.floor(i / cols) * (cellH + label + pad);
    g.drawImage(img, x, y, cellW, cellH);
    img.close();
    g.fillStyle = "#f3f0e8";
    g.font = "12px ui-monospace, monospace";
    g.fillText(`${String(i + 1).padStart(2, "0")}  ${stamp(frames[i].t)}`, x + 2, y + cellH + 16);
  }
  const blob = await toBlob(c, "image/jpeg", 0.88);
  return { blob, url: URL.createObjectURL(blob) };
}
