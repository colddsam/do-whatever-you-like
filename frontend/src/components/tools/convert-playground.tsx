"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download, FileVideo, X } from "lucide-react";
import { getTool, stepsFor } from "@/lib/tools";
import { formatBytes, formatDuration, formatSize } from "@/lib/media";
import { checkFile, convertFile, FileToolError, saveBlob, type Converted } from "@/lib/files";
import { FileDrop } from "./file-drop";
import { AudioPreview } from "./audio-preview";
import { Workbench } from "./workbench";
import { ProgressButton, isBusy, type Job } from "./progress-button";

const EASE = [0.22, 1, 0.36, 1] as const;
const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

type Result = Converted & { url: string; saved: boolean };

const messageOf = (e: unknown) =>
  e instanceof FileToolError ? e.message : "Something went wrong. Check your connection and try again.";

/**
 * Workspace for single-file converters (one file in, one file out), e.g. video → MP3.
 * Everything tool-specific comes from `tool.converter`, so the next converter is data, not code.
 *
 * Steps: add a file → convert it → save the result. The result is previewed in place
 * (audio gets a player) and only saved when the person asks.
 */
export function ConvertPlayground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const cfg = tool.converter!;
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<Result | null>(null);
  // Read from the file in the browser; with a constant bitrate it predicts the result's size.
  const [length, setLength] = useState<number | null>(null);
  const estimate = length && cfg.bytesPerSecond ? Math.round(length * cfg.bytesPerSecond) : null;
  const abortRef = useRef<AbortController | null>(null);

  // Stop the upload and free the result's memory when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const pick = (f: File) => {
    const problem = checkFile(f, cfg.extensions, cfg.maxMB);
    setRejected(problem);
    if (problem) return;
    abortRef.current?.abort();
    setFile(f);
    setLength(null);
    setResult(null);
    setJob({ kind: "ready" });
  };

  const start = async () => {
    if (!file) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await convertFile(cfg.endpoint, file, {
        signal: ctrl.signal,
        fallbackName: `${file.name.replace(/\.[^.]+$/, "") || "converted"}.${cfg.output.toLowerCase()}`,
        onUpload: (progress) => setJob({ kind: "uploading", progress }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const cancel = () => abortRef.current?.abort();

  const clear = () => {
    abortRef.current?.abort();
    setFile(null);
    setLength(null);
    setResult(null);
    setRejected(null);
    setJob({ kind: "ready" });
  };

  const save = () => {
    if (!result) return;
    saveBlob(result.blob, result.name);
    setResult({ ...result, saved: true });
  };

  const busy = isBusy(job);
  // add → convert → save
  const step = !file ? 0 : !result ? 1 : result.saved ? 3 : 2;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Your {cfg.input} is only used to make the {cfg.output}, then deleted from our server. Convert things you have the right to use.</>}
    >
      <div aria-live="polite" className="p-3 sm:p-4">
        <AnimatePresence mode="wait" initial={false}>
          {!file ? (
            <motion.div key="drop" {...swap}>
              <FileDrop
                accept={tool.accept?.types ?? ""}
                title={`Drop a ${cfg.input} here`}
                formats={`${cfg.extensions.map((e) => e.slice(1).toUpperCase()).join(" · ")} — up to ${cfg.maxMB} MB`}
                error={rejected}
                onFile={pick}
              />
            </motion.div>
          ) : (
            <motion.div key="file" {...swap} className="space-y-3">
              <SourceFile
                file={file}
                noun={cfg.input}
                locked={busy}
                onClear={clear}
                onReplace={pick}
                onLength={setLength}
                accept={tool.accept?.types ?? ""}
              />
              {rejected && (
                <p role="alert" className="px-1 text-sm text-danger">
                  {rejected}
                </p>
              )}

              <AnimatePresence mode="wait" initial={false}>
                {result ? (
                  <motion.div key="result" {...swap}>
                    <ResultPanel result={result} output={cfg.output} quality={cfg.quality} onSave={save} onAnother={clear} />
                  </motion.div>
                ) : (
                  <motion.div key="convert" {...swap}>
                    <ConvertAction
                      job={job}
                      estimate={estimate}
                      output={cfg.output}
                      options={tool.options}
                      onStart={start}
                      onCancel={cancel}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Workbench>
  );
}

/* ---------- Pieces ---------- */

/** The chosen file: a still from the video, its name, size and length. */
function SourceFile({
  file,
  noun,
  locked,
  accept,
  onClear,
  onReplace,
  onLength,
}: {
  file: File;
  noun: string;
  locked: boolean;
  accept: string;
  onClear: () => void;
  onReplace: (f: File) => void;
  onLength?: (seconds: number | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [length, setLength] = useState<number | null>(null);
  const [still, setStill] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    const t = setTimeout(() => {
      setUrl(u);
      setLength(null);
      setStill(true);
    }, 0);
    return () => {
      clearTimeout(t);
      URL.revokeObjectURL(u);
    };
  }, [file]);

  const meta = [formatBytes(file.size), length ? formatDuration(length) : null].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-2 pr-2 sm:gap-4">
      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-sm border border-line bg-paper-2 sm:w-32">
        {url && still && (
          <video
            src={`${url}#t=0.5`}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null;
              setLength(d);
              onLength?.(d);
            }}
            onError={() => setStill(false)}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {!still && (
          <span className="absolute inset-0 flex items-center justify-center text-ink-3">
            <FileVideo aria-hidden className="size-5" />
          </span>
        )}
        {length ? (
          <span className="absolute bottom-1 right-1 rounded-[4px] bg-ink/85 px-1 py-px font-mono text-[10px] text-paper">
            {formatDuration(length)}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="label-mono text-ink-3">Your {noun}</p>
        <p className="mt-1 truncate text-[15px] font-medium text-ink" title={file.name}>
          {file.name}
        </p>
        <p className="mt-0.5 truncate text-sm text-ink-2">{meta}</p>
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplace(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="hidden h-9 items-center rounded-[8px] px-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink sm:inline-flex"
          >
            Change
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${noun}`}
            className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Step two: what comes out, and the button that makes it. */
function ConvertAction({
  job,
  estimate,
  output,
  options,
  onStart,
  onCancel,
}: {
  job: Job;
  /** Predicted size of the result in bytes, when it can be worked out. */
  estimate: number | null;
  output: string;
  options?: string[];
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-line px-3 py-3 sm:px-4 sm:py-4">
      {options?.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="label-mono text-ink-3">You&apos;ll get</p>
          {options.map((o) => (
            <span key={o} className="inline-flex h-8 items-center rounded-sm border border-ink bg-ink px-2.5 text-sm text-paper">
              {o}
            </span>
          ))}
          {estimate ? <span className="font-mono text-sm text-ink-2">{formatSize(estimate, false)}</span> : null}
        </div>
      ) : null}
      <ProgressButton
        job={job}
        label={`Convert to ${output}`}
        working={`Making your ${output}…`}
        hint={`You can check the ${output} here before you save it.`}
        onStart={onStart}
        onCancel={onCancel}
      />
    </div>
  );
}

/** Step three: listen, then save. */
function ResultPanel({
  result,
  output,
  quality,
  onSave,
  onAnother,
}: {
  result: Result;
  output: string;
  quality: string;
  onSave: () => void;
  onAnother: () => void;
}) {
  const isAudio = result.type.startsWith("audio/");
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-3 sm:px-4 sm:py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Check aria-hidden className="size-3.5 text-success" /> {output} ready
        </p>
        <p className="label-mono shrink-0 text-ink-3">{formatBytes(result.size)}</p>
      </div>
      <p className="mt-2 truncate text-lg font-semibold tracking-[-0.015em] text-ink" title={result.name}>
        {result.name}
      </p>

      {isAudio && (
        <div className="mt-3">
          <AudioPreview src={result.url} blob={result.blob} />
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px sm:w-auto sm:flex-1"
        >
          {result.saved ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
          {result.saved ? "Saved. Download again" : `Download ${output}`}
          <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(result.size)}</span>
        </button>
        <button
          type="button"
          onClick={onAnother}
          className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
        >
          Convert another
        </button>
      </div>
      <p className="mt-2.5 text-xs text-ink-3">{quality}</p>
    </div>
  );
}
