"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Download, X } from "lucide-react";
import { getLenis } from "@/lib/smooth-scroll";
import { formatBytes } from "@/lib/media";
import { checkFile, saveBlob, uploadForm, type Converted } from "@/lib/files";
import {
  acceptFor,
  canPreview,
  formatList,
  IMAGE_MAX_MB,
  parseImageInfo,
  readSize,
  useImageCapabilities,
  type ImageCapabilities,
  type ImageInputKind,
  type ImageResultFile,
} from "@/lib/image";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Notice } from "../pdf/kit";
import { EASE, isAbort, messageOf, nextId, plural, swap } from "../pdf/parts";

/*
 * The shell the image tools run in: add images (one or many), set the tool's options, run it once,
 * and check the result before saving. A tool supplies its options, its form fields and, if it needs
 * one, a stage (crop and blur draw on the image itself).
 */

/** The transparency checkerboard (the QR tool's), for previews of images that may be see-through. */
export const CHECKER =
  "bg-[conic-gradient(var(--color-paper-2)_25%,var(--color-surface)_0_50%,var(--color-paper-2)_0_75%,var(--color-surface)_0)] bg-[length:16px_16px]";

export type ImageItem = {
  id: string;
  file: File;
  /** Object URL for the preview (null for formats a browser can't draw: HEIC, TIFF, RAW, PSD). */
  url: string | null;
  /** Pixel size as seen, once read. */
  size: { width: number; height: number } | null;
};

export type ImageCtx = {
  items: ImageItem[];
  locked: boolean;
  caps: ImageCapabilities | null;
};

type Capability = "heic" | "raw" | "svg" | "background" | "upscale" | "faces" | "web";
const CAPABILITY_TEXT: Partial<Record<Capability, string>> = {
  background: "Background removal isn't set up on this server yet (it needs ONNX Runtime).",
  upscale: "Upscaling isn't set up on this server yet (it needs ONNX Runtime and the Real-ESRGAN model).",
  faces: "Face detection isn't set up on this server yet (it needs OpenCV). You can still mark areas by hand.",
  web: "Web page capture isn't set up on this server yet (it needs Playwright's Chromium).",
};

export type ImageResult = Converted & { url: string; saved: boolean; files: ImageResultFile[] };

export function ImageTask({
  toolId,
  input,
  multiple = true,
  maxFiles,
  endpoint,
  label,
  working,
  fields,
  options,
  stage,
  tileNote,
  tileTransform,
  tileActions,
  sortable,
  invalid,
  hint,
  compare,
  resultNote,
  needs,
  band,
  dropTitle,
  footer,
  onItems,
}: {
  toolId: string;
  input: ImageInputKind;
  multiple?: boolean;
  maxFiles?: number;
  /** Our proxy route, e.g. "/api/tools/image/resize". */
  endpoint: string;
  label: string | ((ctx: ImageCtx) => string);
  working: string;
  /** The tool's form fields (the images are added by the shell as `files`, or `file` for one). */
  fields: (ctx: ImageCtx) => [string, string | Blob, string?][];
  options?: (ctx: ImageCtx) => React.ReactNode;
  /** Replaces the thumbnail grid (crop and blur work on the image itself). */
  stage?: (ctx: ImageCtx) => React.ReactNode;
  /** A line under each thumbnail, e.g. the size it will become. */
  tileNote?: (item: ImageItem, ctx: ImageCtx) => React.ReactNode;
  /** A CSS transform for each thumbnail (rotate shows the turn before it happens). */
  tileTransform?: (item: ImageItem) => string | undefined;
  /** Small buttons on each thumbnail. */
  tileActions?: (item: ImageItem, ctx: ImageCtx) => React.ReactNode;
  /** Order matters (animated GIF frames): thumbnails get earlier/later buttons. */
  sortable?: boolean;
  /** Why the action can't run yet, or null. */
  invalid?: (ctx: ImageCtx) => string | null;
  hint?: React.ReactNode;
  /** One image in, one out: show a before/after slider on the result. */
  compare?: boolean;
  resultNote?: React.ReactNode;
  needs?: Capability;
  /** A band under the step tracker (the Image studio's mode switch). */
  band?: React.ReactNode;
  dropTitle?: string;
  footer?: React.ReactNode;
  /** Tells the tool when the images change (to reset per-image settings). */
  onItems?: (items: ImageItem[]) => void;
}) {
  const tool = getTool(toolId)!;
  const caps = useImageCapabilities();
  const [items, setItems] = useState<ImageItem[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<ImageResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  const limit = multiple ? (maxFiles ?? caps?.max_files ?? 30) : 1;

  useEffect(
    () => () => {
      abortRef.current?.abort();
      itemsRef.current.forEach((i) => i.url && URL.revokeObjectURL(i.url));
    },
    [],
  );
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const commit = (next: ImageItem[]) => {
    itemsRef.current = next;
    setItems(next);
    onItems?.(next);
  };

  const add = (files: File[]) => {
    const extensions = [...acceptFor(input).split(",").filter((e) => e.startsWith("."))];
    const room = limit - (multiple ? items.length : 0);
    const problems: string[] = [];
    const fresh: ImageItem[] = [];
    for (const f of files) {
      const problem = checkFile(f, extensions, IMAGE_MAX_MB);
      if (problem) problems.push(problem);
      else if (fresh.length < room) fresh.push({ id: nextId(), file: f, url: canPreview(f.name) ? URL.createObjectURL(f) : null, size: null });
    }
    if (files.length - problems.length > room) problems.push(`Up to ${plural(limit, "image")} at a time.`);
    setRejected(problems[0] ?? null);
    if (!fresh.length) return;
    abortRef.current?.abort();
    if (!multiple) itemsRef.current.forEach((i) => i.url && URL.revokeObjectURL(i.url));
    const next = multiple ? [...itemsRef.current, ...fresh] : fresh;
    commit(next);
    setResult(null);
    setJob({ kind: "ready" });
    for (const item of fresh) {
      if (!item.url) continue;
      readSize(item.url).then((size) => {
        if (!size) return;
        const updated = itemsRef.current.map((i) => (i.id === item.id ? { ...i, size } : i));
        commit(updated);
      });
    }
  };

  const remove = (id: string) => {
    const gone = itemsRef.current.find((i) => i.id === id);
    if (gone?.url) URL.revokeObjectURL(gone.url);
    commit(itemsRef.current.filter((i) => i.id !== id));
    setResult(null);
    setJob({ kind: "ready" });
  };

  const move = (id: string, by: -1 | 1) => {
    const list = [...itemsRef.current];
    const i = list.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit(list);
  };

  const clear = () => {
    abortRef.current?.abort();
    itemsRef.current.forEach((i) => i.url && URL.revokeObjectURL(i.url));
    commit([]);
    setResult(null);
    setRejected(null);
    setJob({ kind: "ready" });
  };

  const busy = isBusy(job);
  // A result on screen locks the options: "Change options" goes back to them, so nothing changes unseen.
  const ctx: ImageCtx = { items, locked: busy || result !== null, caps };
  const problem = items.length ? (invalid?.(ctx) ?? null) : null;
  const unavailable = needs && caps ? !caps[needs] : false;

  const start = async () => {
    if (!items.length || problem) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ kind: "uploading", progress: 0 });
    const form = new FormData();
    for (const it of items) form.append(multiple ? "files" : "file", it.file, it.file.name);
    for (const [k, v, name] of fields(ctx)) {
      if (v instanceof Blob) form.append(k, v, name);
      else form.append(k, v);
    }
    try {
      const first = items[0].file.name.replace(/\.[^.]+$/, "") || "image";
      const out = await uploadForm(endpoint, form, {
        signal: ctrl.signal,
        fallbackName: items.length > 1 ? "images.zip" : first,
        onUpload: (progress) => setJob({ kind: "uploading", progress }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, files: parseImageInfo(out.info) });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted || isAbort(e)) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const save = () => {
    if (!result) return;
    saveBlob(result.blob, result.name);
    setResult({ ...result, saved: true });
  };

  const step = !items.length ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const accept = acceptFor(input);
  const formats = `${formatList(input)} — up to ${IMAGE_MAX_MB} MB`;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={footer ?? <>Your images are only used for this, then deleted from our server. Edit images you have the right to use.</>}
    >
      {band}
      <div aria-live="polite" className="space-y-3 p-3 sm:p-4">
        {unavailable && needs && CAPABILITY_TEXT[needs] && <Notice tone="warning">{CAPABILITY_TEXT[needs]}</Notice>}
        <AnimatePresence mode="wait" initial={false}>
          {!items.length ? (
            <motion.div key="drop" {...swap}>
              <FileDrop
                accept={accept}
                multiple={multiple}
                title={dropTitle ?? (multiple ? "Drop your images here" : "Drop an image here")}
                formats={formats}
                error={rejected}
                onFiles={add}
              />
            </motion.div>
          ) : (
            <motion.div key="work" {...swap} className="space-y-3">
              {stage ? (
                <>
                  <SourceStrip item={items[0]} locked={ctx.locked} accept={accept} onReplace={(f) => add([f])} onClear={clear} />
                  {stage(ctx)}
                </>
              ) : (
                <Tiles
                  items={items}
                  ctx={ctx}
                  locked={ctx.locked}
                  sortable={sortable}
                  note={tileNote}
                  transform={tileTransform}
                  actions={tileActions}
                  onRemove={remove}
                  onMove={move}
                  onClear={clear}
                />
              )}
              {multiple && !busy && !result && items.length < limit && (
                <FileDrop compact multiple accept={accept} title="Add more images" formats={`${items.length} of ${limit} · ${formatList(input)}`} onFiles={add} />
              )}
              {rejected && (
                <p role="alert" className="px-1 text-sm text-danger">
                  {rejected}
                </p>
              )}

              <AnimatePresence mode="wait" initial={false}>
                {result ? (
                  <motion.div key="result" {...swap}>
                    <ResultPanel
                      result={result}
                      before={compare && items.length === 1 ? items[0] : null}
                      note={resultNote}
                      onSave={save}
                      onBack={() => {
                        setResult(null);
                        setJob({ kind: "ready" });
                      }}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="options" {...swap} className="space-y-3">
                    {options?.(ctx)}
                    <ProgressButton
                      job={job}
                      label={typeof label === "function" ? label(ctx) : label}
                      working={working}
                      disabled={Boolean(problem) || unavailable}
                      hint={problem ?? hint ?? "You can check the result here before you save it."}
                      onStart={start}
                      onCancel={() => abortRef.current?.abort()}
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

/* ---------- Thumbnails ---------- */

function Tiles({
  items,
  ctx,
  locked,
  sortable,
  note,
  transform,
  actions,
  onRemove,
  onMove,
  onClear,
}: {
  items: ImageItem[];
  ctx: ImageCtx;
  locked: boolean;
  sortable?: boolean;
  note?: (item: ImageItem, ctx: ImageCtx) => React.ReactNode;
  transform?: (item: ImageItem) => string | undefined;
  actions?: (item: ImageItem, ctx: ImageCtx) => React.ReactNode;
  onRemove: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onClear: () => void;
}) {
  const total = items.reduce((n, i) => n + i.file.size, 0);
  return (
    <div className="rounded-md border border-line bg-paper">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <p className="label-mono text-ink-3">
          {plural(items.length, "image")} · {formatBytes(total)}
        </p>
        {!locked && (
          <button type="button" onClick={onClear} className="text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            Remove all
          </button>
        )}
      </div>
      <ol
        data-lenis-prevent
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2 p-2 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))]",
          items.length > 8 && "max-h-[460px] overflow-y-auto overscroll-contain",
        )}
      >
        <AnimatePresence initial={false}>
          {items.map((item, i) => (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.3, ease: EASE } }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              className="group relative flex flex-col rounded-sm border border-line bg-surface p-1.5"
            >
              <div className={cn("relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[4px] border border-line", CHECKER)}>
                {item.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt=""
                    draggable={false}
                    className="max-h-full max-w-full object-contain transition-transform duration-300 ease-out-soft"
                    style={{ transform: transform?.(item) }}
                  />
                ) : (
                  <span className="label-mono rounded-[3px] border border-line bg-surface px-1.5 py-0.5 text-ink-2">
                    {item.file.name.split(".").pop()?.toUpperCase()}
                  </span>
                )}
                <span className="label-mono absolute left-1 top-1 rounded-[3px] bg-ink/85 px-1 text-[12px] text-paper">{String(i + 1).padStart(2, "0")}</span>
                {!locked && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                    className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-[6px] bg-surface/90 text-ink-2 shadow-sm transition-colors hover:bg-surface hover:text-ink"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                )}
                {actions && !locked && (
                  <div className="absolute inset-x-1 bottom-1 flex justify-center gap-1 transition-opacity duration-150 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">{actions(item, ctx)}</div>
                )}
              </div>
              <p className="mt-1.5 truncate px-0.5 text-[13px] font-medium text-ink" title={item.file.name}>
                {item.file.name}
              </p>
              <p className="truncate px-0.5 font-mono text-[12px] text-ink-3">
                {item.size ? `${item.size.width} × ${item.size.height} · ` : ""}
                {formatBytes(item.file.size)}
              </p>
              {note && <div className="truncate px-0.5 font-mono text-[12px] text-ink">{note(item, ctx)}</div>}
              {sortable && !locked && items.length > 1 && (
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(item.id, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${item.file.name} earlier`}
                    className="inline-flex h-8 flex-1 items-center justify-center rounded-[6px] border border-line text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-30"
                  >
                    <ArrowLeft aria-hidden className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(item.id, 1)}
                    disabled={i === items.length - 1}
                    aria-label={`Move ${item.file.name} later`}
                    className="inline-flex h-8 flex-1 items-center justify-center rounded-[6px] border border-line text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-30"
                  >
                    <ArrowRight aria-hidden className="size-3.5" />
                  </button>
                </div>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

/** One image (crop, blur): its name and size in a row, with Change / Remove. */
function SourceStrip({
  item,
  locked,
  accept,
  onReplace,
  onClear,
}: {
  item: ImageItem;
  locked: boolean;
  accept: string;
  onReplace: (f: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-2">
      <span className={cn("relative size-12 shrink-0 overflow-hidden rounded-sm border border-line", CHECKER)}>
        {item.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt="" className="size-full object-cover" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="label-mono text-ink-3">Your image</p>
        <p className="mt-1 truncate text-[15px] font-medium text-ink" title={item.file.name}>
          {item.file.name}
        </p>
        <p className="truncate font-mono text-xs text-ink-2">
          {item.size ? `${item.size.width} × ${item.size.height} · ` : ""}
          {formatBytes(item.file.size)}
        </p>
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={input}
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
            onClick={() => input.current?.click()}
            className="hidden h-9 items-center rounded-[8px] px-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink sm:inline-flex"
          >
            Change
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove image"
            className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Result ---------- */

const KIND: [RegExp, string][] = [
  [/zip/, "ZIP"],
  [/jpe?g/, "JPG"],
  [/png/, "PNG"],
  [/webp/, "WebP"],
  [/gif/, "GIF"],
  [/svg/, "SVG"],
];

function percentChange(before: number | null, after: number) {
  if (!before) return null;
  const pct = Math.round((1 - after / before) * 100);
  return pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : "same size";
}

export function ResultPanel({
  result,
  before,
  note,
  onSave,
  onBack,
  backLabel = "Change options",
}: {
  result: ImageResult;
  /** The source image, for a before/after slider. */
  before: ImageItem | null;
  note?: React.ReactNode;
  onSave: () => void;
  onBack: () => void;
  backLabel?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const kind = KIND.find(([re]) => re.test(result.type) || re.test(result.name.toLowerCase()))?.[1] ?? "File";
  const isZip = kind === "ZIP";
  const files = result.files;
  const one = !isZip ? files[0] : null;
  const totals = useMemo(() => {
    const known = files.filter((f) => f.before != null);
    return known.length ? { before: known.reduce((n, f) => n + (f.before ?? 0), 0), after: known.reduce((n, f) => n + f.after, 0) } : null;
  }, [files]);

  useEffect(() => {
    const el = panel.current;
    if (!el || el.getBoundingClientRect().top >= 80) return;
    const lenis = getLenis();
    if (lenis) lenis.scrollTo(el, { offset: -96 });
    else el.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div ref={panel} className="scroll-mt-24 rounded-md border border-line bg-surface px-3 py-3 sm:px-4 sm:py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Check aria-hidden className="size-3.5 text-success" /> {isZip ? `${plural(files.length || 1, "image")} ready` : `${kind} ready`}
        </p>
        <p className="label-mono text-ink-3">
          {one?.width ? `${one.width} × ${one.height} · ` : ""}
          {one?.frames ? `${one.frames} frames · ` : ""}
          {totals && totals.before ? `${formatBytes(totals.before)} → ` : ""}
          {formatBytes(result.size)}
          {totals ? ` · ${percentChange(totals.before, totals.after) ?? ""}` : ""}
        </p>
      </div>
      <p className="mt-2 truncate text-lg font-semibold tracking-[-0.015em] text-ink" title={result.name}>
        {result.name}
      </p>
      {one?.truncated && <p className="mt-1 text-sm text-ink-2">The page was very long, so the capture stops at 16,000 pixels.</p>}

      {!isZip &&
        (before?.url ? (
          <CompareSlider before={before.url} after={result.url} />
        ) : (
          <div className={cn("mt-3 flex max-h-[min(60vh,520px)] justify-center overflow-hidden rounded-sm border border-line", CHECKER)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.url} alt={`Preview of ${result.name}`} className="max-h-[min(60vh,520px)] max-w-full object-contain" />
          </div>
        ))}

      {isZip && files.length > 0 && (
        <div className="mt-3" data-lenis-prevent>
          <ol className={cn("divide-y divide-line border-y border-line", files.length > 6 && "max-h-[260px] overflow-y-auto overscroll-contain")}>
            {files.map((f, i) => (
              <li key={f.name} className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-2 py-2 sm:grid-cols-[1.75rem_1fr_auto_auto] sm:gap-3">
                <span className="font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 truncate text-sm text-ink" title={f.name}>
                  {f.name}
                </span>
                <span className="hidden font-mono text-xs text-ink-3 sm:block">{f.width ? `${f.width} × ${f.height}` : ""}</span>
                <span className="text-right font-mono text-xs text-ink-2">
                  {f.before != null ? `${formatBytes(f.before)} → ` : ""}
                  {formatBytes(f.after)}
                  {f.before != null && <span className="ml-1.5 text-ink">{percentChange(f.before, f.after)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px sm:w-auto sm:flex-1"
        >
          {result.saved ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
          {result.saved ? "Saved. Download again" : `Download ${kind}`}
          <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(result.size)}</span>
        </button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
        >
          {backLabel}
        </button>
      </div>
      {note && <p className="mt-2.5 text-xs text-ink-3">{note}</p>}
    </div>
  );
}

/**
 * Before and after, one over the other: drag the handle (or use the arrow keys) to wipe between them.
 * Both are drawn the same size, so the result lines up with the original even when it's larger.
 */
export function CompareSlider({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(0.5);
  const box = useRef<HTMLDivElement>(null);
  const setFrom = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setSplit(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  };
  return (
    <div className="mt-3">
      <div
        ref={box}
        className={cn("relative mx-auto w-fit max-w-full touch-none select-none overflow-hidden rounded-sm border border-line", CHECKER)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFrom(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && setFrom(e.clientX)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt="After" draggable={false} className="block max-h-[min(60vh,520px)] max-w-full object-contain" />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={before} alt="Before" draggable={false} className="size-full object-contain" />
        </div>
        <span className="label-mono pointer-events-none absolute left-2 top-2 rounded-[3px] bg-ink/85 px-1.5 py-0.5 text-[12px] text-paper">Before</span>
        <span className="label-mono pointer-events-none absolute right-2 top-2 rounded-[3px] bg-ink/85 px-1.5 py-0.5 text-[12px] text-paper">After</span>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: `${split * 100}%` }} />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
            if (!d) return;
            e.preventDefault();
            setSplit((s) => Math.min(1, Math.max(0, s + d)));
          }}
          className="absolute top-1/2 inline-flex size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-ink bg-surface text-ink shadow-card outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
          style={{ left: `${split * 100}%` }}
        >
          <ArrowLeft aria-hidden className="size-3" />
          <ArrowRight aria-hidden className="size-3" />
        </div>
      </div>
      <p className="mt-1.5 text-center text-xs text-ink-3">Drag across the image to compare.</p>
    </div>
  );
}

export type { Capability };
