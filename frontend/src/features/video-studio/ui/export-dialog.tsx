"use client";

import { useEffect, useRef, useState } from "react";
import { Captions, Download, FileArchive, FileAudio, FileVideo, ImageDown, LoaderCircle, X } from "lucide-react";
import { AUDIO_BITRATE, EXPORT_QUALITY, EXPORT_SIZES, videoBitrate, type ExportQualityId, type ExportSizeId } from "../constants";
import { formatBytes, shortTime } from "../lib/time";
import { projectDuration } from "../lib/timeline";
import { getStudio, useStudio } from "../store/studio-store";
import { ExportCanceled, exportDimensions, WebCodecsExporter, type ExportFormat, type ExportProgress, type ExportResult } from "../engine/exporter";
import { exportEdl, exportPremiereXml } from "../engine/interop";
import { exportPackage } from "../engine/package";
import { getEngine } from "../engine/playback";
import { download as save, exportSubtitles } from "../engine/subtitles";
import { Progress, Row, Segmented, TextButton } from "./controls";

type Phase = "setup" | "running" | "done" | "error";

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "mp4", label: "MP4", hint: "H.264 + AAC: plays everywhere" },
  { id: "webm", label: "WebM", hint: "VP9 + Opus: smaller, for the web" },
  { id: "gif", label: "GIF", hint: "Animated, no sound, up to 60 s" },
  { id: "m4a", label: "M4A", hint: "Just the sound (AAC)" },
  { id: "wav", label: "WAV", hint: "Just the sound, lossless" },
];

export function ExportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const project = useStudio((s) => s.project);
  const inPoint = useStudio((s) => s.inPoint);
  const outPoint = useStudio((s) => s.outPoint);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [size, setSize] = useState<ExportSizeId>("1080p");
  const [fps, setFps] = useState(project.settings.fps);
  const [quality, setQuality] = useState<ExportQualityId>("high");
  const [name, setName] = useState(project.name);
  const [range, setRange] = useState<"all" | "inout">(inPoint !== null || outPoint !== null ? "inout" : "all");
  const [phase, setPhase] = useState<Phase>("setup");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const exporter = useRef<WebCodecsExporter | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, [phase]);
  useEffect(() => () => {
    exporter.current?.cancel();
  }, []);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const full = projectDuration(project);
  const span: [number, number] = range === "inout" ? [inPoint ?? 0, outPoint ?? full] : [0, full];
  const duration = Math.max(0, span[1] - span[0]);
  const dims = exportDimensions(project, size);
  const audioOnly = format === "wav" || format === "m4a";
  const estimate = audioOnly
    ? format === "wav"
      ? duration * 48_000 * 4
      : (AUDIO_BITRATE * duration) / 8
    : format === "gif"
      ? duration * Math.min(20, fps) * Math.min(dims.width, 720) * 120
      : ((videoBitrate(dims.width, dims.height, fps, quality) * (format === "webm" ? 0.8 : 1) + AUDIO_BITRATE) * duration) / 8;
  const fpsChoices = [...new Set([24, 25, 30, 50, 60, project.settings.fps])].sort((a, b) => a - b);

  const start = async () => {
    getStudio().set({ playing: false });
    setPhase("running");
    setError(null);
    setProgress(null);
    const ex = new WebCodecsExporter();
    exporter.current = ex;
    try {
      const r = await ex.run(getStudio().project, { size, fps, quality, name, format, range: range === "inout" ? span : undefined }, setProgress);
      setResult(r);
      setUrl(URL.createObjectURL(r.blob));
      setPhase("done");
      onDone();
    } catch (e) {
      if (e instanceof ExportCanceled) setPhase("setup");
      else {
        console.error("[studio] export failed", e);
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    } finally {
      exporter.current = null;
    }
  };

  const extra = async (kind: "srt" | "vtt" | "png" | "pkg" | "pkg-light" | "xml" | "edl") => {
    setBusy(kind);
    try {
      if (kind === "srt" || kind === "vtt") {
        const n = exportSubtitles(kind);
        getStudio().notify(`Saved ${n} caption${n === 1 ? "" : "s"} as .${kind}.`, "success");
      } else if (kind === "png") {
        const blob = await getEngine()?.snapshot();
        if (!blob) throw new Error("The preview isn't ready yet.");
        save(blob, `${name || "frame"} ${getStudio().playhead.toFixed(2)}s.png`);
      } else if (kind === "xml") {
        save(new Blob([exportPremiereXml(getStudio().project)], { type: "application/xml" }), `${name || "sequence"}.xml`);
        getStudio().notify("Exported Premiere / Final Cut Pro XMEML.", "success");
      } else if (kind === "edl") {
        save(new Blob([exportEdl(getStudio().project)], { type: "text/plain" }), `${name || "sequence"}.edl`);
        getStudio().notify("Exported CMX 3600 EDL.", "success");
      } else {
        const blob = await exportPackage(kind === "pkg");
        save(blob, `${name || "project"}.dwylvideo`);
        getStudio().notify(kind === "pkg" ? "Project saved with its media. Open it on any computer with “Open project file”." : "Project saved without media (you'll relink files when you open it elsewhere).", "success");
      }
    } catch (e) {
      getStudio().notify(e instanceof Error ? e.message : "That didn't work.", "danger");
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    if (!url || !result) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    a.click();
  };

  const close = () => {
    exporter.current?.cancel();
    onClose();
  };

  const isAudio = result ? result.mime.startsWith("audio/") : false;
  const isGif = result?.mime === "image/gif";

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-ink/80 p-3 backdrop-blur-sm"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && phase !== "running") close();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="studio-export-title" className="safe-bottom max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-line-dark bg-ink-raised shadow-float" data-lenis-prevent>
        <div className="flex items-center justify-between border-b border-line-dark px-4 py-3">
          <h2 id="studio-export-title" className="text-[15px] font-semibold text-paper">
            Export <span className="serif-em">video</span>
          </h2>
          {phase !== "running" && (
            <button type="button" aria-label="Close" onClick={close} className="inline-flex size-8 items-center justify-center rounded-sm text-paper-dim hover:bg-paper/10 hover:text-paper">
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>

        {phase === "setup" && (
          <div className="px-4 py-3">
            <Row label="Format" className="max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-1.5">
              <Segmented label="Format" value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.id, label: f.label, title: f.hint }))} />
            </Row>
            {!audioOnly && (
              <Row label="Size" className="max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-1.5">
                <Segmented
                  label="Resolution"
                  value={size}
                  onChange={setSize}
                  options={EXPORT_SIZES.map((s) => {
                    const d = exportDimensions(project, s.id);
                    return { value: s.id, label: s.label, title: `${d.width}×${d.height}` };
                  })}
                />
              </Row>
            )}
            {!audioOnly && (
              <Row label="Frame rate" className="max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-1.5">
                <Segmented label="Frame rate" value={String(fps)} onChange={(v) => setFps(Number(v))} options={fpsChoices.map((f) => ({ value: String(f), label: `${f}` }))} />
              </Row>
            )}
            {(format === "mp4" || format === "webm") && (
              <Row label="Quality" className="max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-1.5">
                <Segmented label="Quality" value={quality} onChange={setQuality} options={EXPORT_QUALITY.map((q) => ({ value: q.id, label: q.label, title: q.hint }))} />
              </Row>
            )}
            <Row label="Range" className="max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-1.5">
              <Segmented
                label="Range"
                value={range}
                onChange={setRange}
                options={[
                  { value: "all", label: "Whole video" },
                  { value: "inout", label: inPoint !== null || outPoint !== null ? `In–Out (${shortTime(duration)})` : "In–Out", title: "Set In (I) and Out (O) on the timeline" },
                ]}
              />
            </Row>
            <Row label="File name" className="max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-1.5">
              <input
                aria-label="File name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-2 text-[12px] text-paper outline-none focus-visible:border-accent sm:h-7"
              />
            </Row>
            <p className="mt-3 font-mono text-[12px] leading-relaxed text-paper-dim">
              {audioOnly ? "48 kHz stereo" : `${format === "gif" ? `≤720 px · ${Math.min(20, fps)} fps` : `${dims.width}×${dims.height} · ${fps} fps`}`} · {shortTime(duration)} · ≈ {formatBytes(estimate)}
              <br />
              {FORMATS.find((f) => f.id === format)?.hint}. Made on this device{format === "mp4" || format === "webm" ? " with your GPU's encoder" : ""}.
            </p>
            {size === "4k" && !audioOnly && format !== "gif" && <p className="mt-2 text-[12px] leading-relaxed text-warning">4K needs a recent GPU; if your browser can&apos;t encode it, pick 1080p.</p>}
            <div className="mt-4 flex justify-end gap-2">
              <TextButton onClick={close}>Cancel</TextButton>
              <TextButton ref={first} tone="primary" disabled={duration <= 0} onClick={() => void start()}>
                <Download aria-hidden className="size-4" />
                Export {FORMATS.find((f) => f.id === format)?.label}
              </TextButton>
            </div>
            <div className="mt-4 border-t border-line-dark pt-3">
              <p className="label-mono mb-2 text-paper-dim">Also export</p>
              <div className="grid grid-cols-2 gap-1.5">
                <TextButton disabled={!!busy} onClick={() => void extra("srt")}>
                  <Captions aria-hidden className="size-3.5" />
                  Captions .srt
                </TextButton>
                <TextButton disabled={!!busy} onClick={() => void extra("vtt")}>
                  <Captions aria-hidden className="size-3.5" />
                  Captions .vtt
                </TextButton>
                <TextButton disabled={!!busy} onClick={() => void extra("png")}>
                  <ImageDown aria-hidden className="size-3.5" />
                  This frame .png
                </TextButton>
                <TextButton disabled={!!busy} onClick={() => void extra("pkg")} title="The project with all of its media, to open on another computer or keep as a backup">
                  {busy === "pkg" ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <FileArchive aria-hidden className="size-3.5" />}
                  Project + media
                </TextButton>
                <TextButton disabled={!!busy} onClick={() => void extra("xml")} title="Round-trip timeline for Premiere Pro or DaVinci Resolve">
                  Premiere XML
                </TextButton>
                <TextButton disabled={!!busy} onClick={() => void extra("edl")} title="Standard CMX 3600 Edit Decision List">
                  CMX 3600 EDL
                </TextButton>
              </div>
            </div>
          </div>
        )}

        {phase === "running" && (
          <div className="px-4 py-4">
            <p className="flex items-center gap-2 text-[13px] text-paper">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {!progress || progress.phase === "preparing" ? "Preparing…" : progress.phase === "finishing" ? "Finishing the file…" : audioOnly ? "Mixing the sound" : "Rendering and encoding"}
            </p>
            <Progress value={progress && progress.phase !== "preparing" ? progress.frame / progress.total : undefined} />
            {progress && progress.phase === "rendering" && !audioOnly && (
              <p className="mt-2 font-mono text-[12px] tabular-nums text-paper-dim">
                Frame {progress.frame} / {progress.total} · {progress.fps.toFixed(1)} fps · {Math.ceil(progress.eta)} s left
              </p>
            )}
            <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Keep this tab open. Everything happens on this device.</p>
            <div className="mt-4 flex justify-end">
              <TextButton ref={first} tone="danger" onClick={() => exporter.current?.cancel()}>
                Cancel export
              </TextButton>
            </div>
          </div>
        )}

        {phase === "done" && result && url && (
          <div className="px-4 py-3">
            {isAudio ? (
              <div className="flex items-center gap-3 rounded-md border border-line-dark p-3">
                <FileAudio aria-hidden className="size-6 shrink-0 text-paper-dim" />
                <audio src={url} controls className="w-full" />
              </div>
            ) : isGif ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="The exported GIF" className="max-h-[50vh] w-full rounded-md bg-black object-contain" />
            ) : (
              <video src={url} controls playsInline className="aspect-video w-full rounded-md bg-black" />
            )}
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[12px] leading-relaxed text-paper-dim">
              {!isAudio && <FileVideo aria-hidden className="size-3.5 shrink-0" />}
              {isAudio ? result.audioCodec : `${result.width}×${result.height} · ${result.videoCodec}${result.audioCodec ? ` + ${result.audioCodec}` : " · no sound"}`} · made in {shortTime(result.seconds)}
            </p>
            {result.warnings.map((w) => (
              <p key={w} className="mt-1.5 text-[12px] leading-relaxed text-warning">
                {w}
              </p>
            ))}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <TextButton onClick={() => setPhase("setup")}>Export again</TextButton>
              <TextButton ref={first} tone="primary" onClick={download}>
                <Download aria-hidden className="size-4" />
                Download {result.filename.split(".").pop()?.toUpperCase()} · {formatBytes(result.bytes)}
              </TextButton>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="px-4 py-4">
            <p role="alert" className="text-[13px] leading-relaxed text-paper">
              {error}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <TextButton ref={first} onClick={() => setPhase("setup")}>
                Back
              </TextButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
