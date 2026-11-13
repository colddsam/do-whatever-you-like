"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Download } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { decodeFrames, encodeGif, MIN_DELAY_MS, playedMs, readGif, retime, type GifInfo } from "@/lib/gif";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { ProgressButton, type Job } from "../progress-button";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CHECKER } from "./task";

type Loop = "keep" | "forever" | "once" | "times";
const MAX_MB = 60;
/** Re-drawing holds every frame in memory; beyond this many pixels in total it's refused. */
const MAX_REDRAW_PIXELS = 160_000_000;

export function GifSpeedTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<{ bytes: Uint8Array; info: GifInfo; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"speed" | "fixed">("speed");
  const [speed, setSpeed] = useState(2);
  const [fixed, setFixed] = useState("100");
  const [loop, setLoop] = useState<Loop>("keep");
  const [times, setTimes] = useState("3");
  const [reverse, setReverse] = useState(false);
  const [boomerang, setBoomerang] = useState(false);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<{ blob: Blob; url: string; frames: number; ms: number; lossless: boolean } | null>(null);

  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src.url);
  }, [src]);
  useEffect(() => () => {
    if (out) URL.revokeObjectURL(out.url);
  }, [out]);

  const take = async (f: File) => {
    setError(null);
    setOut(null);
    if (f.size > MAX_MB * 1024 * 1024) return setError(`That GIF is over ${MAX_MB} MB.`);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const info = readGif(bytes);
      if (info.frames < 2) return setError("That GIF has only one frame, so it has no speed to change.");
      setFile(f);
      setSrc({ bytes, info, url: URL.createObjectURL(f) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That GIF couldn't be read.");
    }
  };

  const fixedMs = Math.max(MIN_DELAY_MS, Number(fixed) || 100);
  // What each original frame should last now, in ms. Frames that played as "default" (under 20 ms,
  // which browsers show for 100 ms) start from 100 ms.
  const target = useMemo(() => (src ? src.info.delays.map((d) => (mode === "fixed" ? fixedMs : (d < MIN_DELAY_MS ? 100 : d) / speed)) : []), [src, mode, fixedMs, speed]);
  const loopValue = loop === "keep" ? (src?.info.loop ?? null) : loop === "forever" ? 0 : loop === "once" ? null : Math.max(1, Math.min(100, Number(times) || 3));
  const tooFast = target.some((d) => d < MIN_DELAY_MS);
  const redraw = reverse || boomerang || tooFast;
  const before = src ? playedMs(src.info.delays) : 0;
  const after = useMemo(() => {
    const kept = target.reduce((s, d) => s + Math.max(MIN_DELAY_MS, d), 0);
    return boomerang ? kept * 2 - (target[0] ?? 0) - (target.at(-1) ?? 0) : kept;
  }, [target, boomerang]);
  const tooBig = src ? src.info.width * src.info.height * src.info.frames * (boomerang ? 2 : 1) > MAX_REDRAW_PIXELS : false;

  const run = async () => {
    if (!src) return;
    setJob({ kind: "processing" });
    setProgress(0);
    if (out) URL.revokeObjectURL(out.url);
    setOut(null);
    try {
      if (!redraw) {
        const bytes = retime(src.bytes, src.info, target, loopValue);
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/gif" });
        setOut({ blob, url: URL.createObjectURL(blob), frames: src.info.frames, ms: after, lossless: true });
      } else {
        const dec = await decodeFrames(src.bytes);
        let seq = dec.frames.map((f, i) => ({ rgba: f.rgba, delay: target[i] }));
        if (reverse) seq = seq.reverse();
        if (boomerang) seq = [...seq, ...seq.slice(1, -1).reverse()];
        // Faster than a GIF can play: merge runs of short frames into one that lasts as long as they did.
        const merged: typeof seq = [];
        let acc = 0;
        for (const f of seq) {
          acc += f.delay;
          if (acc >= MIN_DELAY_MS) {
            merged.push({ rgba: f.rgba, delay: acc });
            acc = 0;
          }
        }
        if (acc && merged.length) merged[merged.length - 1].delay += acc;
        const blob = await encodeGif(dec.width, dec.height, merged, { loop: loopValue, onProgress: setProgress });
        setOut({ blob, url: URL.createObjectURL(blob), frames: merged.length, ms: merged.reduce((s, f) => s + f.delay, 0), lossless: false });
      }
      setJob({ kind: "ready" });
    } catch (e) {
      setJob({ kind: "failed", message: e instanceof Error ? e.message : "The GIF couldn't be changed." });
    }
  };

  return (
    <Workbench steps={stepsFor(tool)} current={!src ? 0 : out ? 2 : 1} footer="Your GIF is changed in the browser and never uploaded.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!src ? (
          <FileDrop accept=".gif,image/gif" title="Drop an animated GIF here" formats={`GIF · up to ${MAX_MB} MB`} error={error} onFile={take} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2">
              <p className="min-w-0 truncate text-sm text-ink">
                {file?.name}{" "}
                <span className="font-mono text-[12px] text-ink-3">
                  · {src.info.width}×{src.info.height} · {src.info.frames} frames · {(before / 1000).toFixed(2)} s · {formatBytes(file?.size ?? 0)}
                </span>
              </p>
              <button type="button" onClick={() => (setSrc(null), setFile(null), setOut(null))} className="inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
                Change GIF
              </button>
            </div>
            <Panel>
              <Row label="Timing">
                <Chips value={mode} options={[{ value: "speed", label: "Change the speed" }, { value: "fixed", label: "Same time for every frame" }]} onChange={setMode} label="Timing" />
                <div className="mt-3">
                  {mode === "speed" ? (
                    <div className="grid gap-3">
                      <Slider label="Speed" value={speed} min={0.1} max={8} step={0.05} onChange={setSpeed} format={(v) => `${v.toFixed(2).replace(/\.?0+$/, "")}×`} />
                      <div className="flex flex-wrap gap-1.5">
                        {[0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4].map((v) => (
                          <button key={v} type="button" onClick={() => setSpeed(v)} className={cn("rounded-[6px] px-2 py-1 font-mono text-[12px]", speed === v ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink")}>
                            {v}×
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-28">
                        <TextField label="Milliseconds per frame" value={fixed} onChange={(v) => setFixed(v.replace(/\D/g, "").slice(0, 5))} mono inputMode="numeric" />
                      </div>
                      <span className="text-sm text-ink-2">ms per frame (20 or more)</span>
                    </div>
                  )}
                </div>
              </Row>
              <Row label="Direction">
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  <Toggle checked={reverse} onChange={setReverse} label="Play backwards" />
                  <Toggle checked={boomerang} onChange={setBoomerang} label="Boomerang" description="Forward, then back." />
                </div>
              </Row>
              <Row label="Looping">
                <div className="flex flex-wrap items-center gap-3">
                  <Chips value={loop} options={[{ value: "keep", label: `Keep (${src.info.loop === null ? "plays once" : src.info.loop === 0 ? "forever" : `${src.info.loop} times`})` }, { value: "forever", label: "Forever" }, { value: "times", label: "A number of times" }, { value: "once", label: "Play once" }]} onChange={setLoop} label="Looping" />
                  {loop === "times" && (
                    <div className="w-20">
                      <TextField label="Times" value={times} onChange={(v) => setTimes(v.replace(/\D/g, "").slice(0, 3))} mono inputMode="numeric" />
                    </div>
                  )}
                </div>
              </Row>
            </Panel>
            {tooFast && !boomerang && !reverse && <Notice>That&apos;s faster than a GIF can play (20 ms a frame), so neighbouring frames are merged: it plays at the speed you asked, with fewer frames.</Notice>}
            {redraw && tooBig && <Notice tone="warning">This GIF is too big to re-draw in the browser. Try without Backwards or Boomerang, or a speed of 4× or less.</Notice>}
            <ProgressButton
              job={job}
              label={redraw ? "Re-make the GIF" : "Change the speed"}
              working={redraw ? "Re-drawing frames…" : "Saving…"}
              progress={redraw ? progress : undefined}
              hint={`${(before / 1000).toFixed(2)} s → ${(after / 1000).toFixed(2)} s. ${redraw ? "Frames are re-drawn (a palette per frame)." : "Lossless: only the timing changes, every pixel stays."}`}
              disabled={redraw && tooBig}
              onStart={run}
              onCancel={() => setJob({ kind: "ready" })}
            />
            <div className="grid gap-3 @2xl:grid-cols-2">
              {[
                { label: "Before", url: src.url, info: `${(before / 1000).toFixed(2)} s · ${formatBytes(file?.size ?? 0)}` },
                ...(out ? [{ label: "After", url: out.url, info: `${(out.ms / 1000).toFixed(2)} s · ${out.frames} frames · ${formatBytes(out.blob.size)}${out.lossless ? " · lossless" : ""}` }] : []),
              ].map((p) => (
                <motion.figure key={p.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-md border border-line">
                  <div className="flex min-h-40 items-center justify-center p-3" style={{ backgroundImage: CHECKER }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`${p.label}: the GIF`} className="max-h-[320px] max-w-full" />
                  </div>
                  <figcaption className="flex justify-between gap-2 border-t border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink-3">
                    <span className="label-mono text-ink">{p.label}</span>
                    <span>{p.info}</span>
                  </figcaption>
                </motion.figure>
              ))}
            </div>
            {out && (
              <button type="button" onClick={() => saveBlob(out.blob, `${(file?.name ?? "animation").replace(/\.gif$/i, "")}-${mode === "speed" ? `${speed}x` : `${fixedMs}ms`}.gif`)} className="inline-flex h-11 w-fit items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
                <Download aria-hidden className="size-4" /> Download GIF <span className="font-mono text-[12px] font-normal text-paper/60">{formatBytes(out.blob.size)}</span>
              </button>
            )}
          </>
        )}
      </div>
    </Workbench>
  );
}
