"use client";

import { useRef } from "react";
import { motion } from "motion/react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { formatBytes, formatSize } from "@/lib/media";
import { FileToolError, type Converted } from "@/lib/files";
import { describePart, type ZipEntry } from "@/lib/pdf";
import { cn } from "@/lib/utils";

/*
 * Pieces every PDF workspace shares (the toolkit and each single-purpose PDF tool), so a PDF
 * looks, uploads and reports the same way everywhere.
 */

export const EASE = [0.22, 1, 0.36, 1] as const;
export const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

/** Each PDF is uploaded once, when it's added. Everything after that refers to it by token. */
export type Upload =
  | { state: "uploading"; progress: number }
  | { state: "ready"; token: string; pages: number; sizes?: [number, number][] }
  | { state: "failed"; message: string };
export type Doc = { id: string; file: File; upload: Upload };
export type Ready = Doc & { upload: Extract<Upload, { state: "ready" }> };
export const isReady = (d: Doc | null | undefined): d is Ready => d?.upload.state === "ready";

export const messageOf = (e: unknown) =>
  e instanceof FileToolError ? e.message : "Something went wrong. Check your connection and try again.";
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
/** The server forgets uploads after a while (410); the workspace then uploads again. */
export const expired = (e: unknown) => e instanceof FileToolError && e.status === 410;
export const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "document";
export const isZip = (r: Converted) => r.type.includes("zip") || r.name.toLowerCase().endsWith(".zip");
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
let uid = 0;
export const nextId = () => `f${++uid}`;

/** A small paper sheet with a folded corner: how a PDF (or any file, labelled) looks on the worksheet. */
export function Sheet({ index, className, label = "PDF" }: { index?: number; className?: string; label?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex h-10 w-8 shrink-0 flex-col justify-end rounded-[3px] border border-line bg-surface pb-1",
        className,
      )}
      style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)" }}
    >
      <span className="absolute right-0 top-0 size-2 rounded-bl-[2px] border-b border-l border-line bg-paper-2" />
      {index !== undefined ? (
        <span className="absolute inset-x-0 top-2.5 text-center font-mono text-[12px] font-medium text-ink">
          {String(index).padStart(2, "0")}
        </span>
      ) : (
        <span className="mx-1.5 mb-auto mt-2.5 space-y-[3px]">
          <span className="block h-px bg-line" />
          <span className="block h-px bg-line" />
          <span className="block h-px w-2/3 bg-line" />
        </span>
      )}
      <span className="text-center font-mono text-[8px] font-medium tracking-[0.08em] text-ink-3">{label}</span>
    </span>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-[8px] text-ink-3 sm:size-9 transition-colors hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Pages and size once uploaded; progress while uploading; the reason if it failed. */
export function UploadMeta({ doc, onRetry }: { doc: Doc; onRetry: () => void }) {
  const u = doc.upload;
  if (u.state === "ready") {
    return (
      <p className="mt-0.5 truncate text-sm text-ink-2">
        {plural(u.pages, "page")} · {formatBytes(doc.file.size)}
      </p>
    );
  }
  if (u.state === "uploading") {
    return (
      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-3">
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
        {u.progress >= 1 ? "Reading pages" : `Uploading ${Math.round(u.progress * 100)}%`} · {formatBytes(doc.file.size)}
      </p>
    );
  }
  return (
    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-danger">
      <span className="line-clamp-2 min-w-0" title={u.message}>
        {u.message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline"
      >
        <RotateCcw aria-hidden className="size-3" /> Retry
      </button>
    </p>
  );
}

/** A hairline along the bottom edge of a row that fills as the file uploads. */
export function UploadLine({ doc }: { doc: Doc }) {
  if (doc.upload.state !== "uploading") return null;
  return (
    <span aria-hidden className="absolute inset-x-2 bottom-0 h-px overflow-hidden bg-line">
      <motion.span
        className="block h-full bg-ink"
        initial={{ width: 0 }}
        animate={{ width: `${doc.upload.progress * 100}%` }}
        transition={{ ease: "linear", duration: 0.2 }}
      />
    </span>
  );
}

/** Split / compress: the one PDF being worked on. */
export function DocRow({
  doc,
  locked,
  accept,
  onReplace,
  onClear,
  onRetry,
}: {
  doc: Doc;
  locked: boolean;
  accept: string;
  onReplace: (f: File) => void;
  onClear: () => void;
  onRetry: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-md border bg-paper p-2 sm:gap-4",
        doc.upload.state === "failed" ? "border-danger/40" : "border-line",
      )}
    >
      <span className="flex h-14 w-12 shrink-0 items-center justify-center rounded-sm border border-line bg-paper-2">
        <Sheet />
      </span>
      <div className="min-w-0 flex-1">
        <p className="label-mono text-ink-3">Your PDF</p>
        <p className="mt-1 truncate text-[15px] font-medium text-ink" title={doc.file.name}>
          {doc.file.name}
        </p>
        <UploadMeta doc={doc} onRetry={onRetry} />
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
          <IconButton label="Remove PDF" onClick={onClear}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      )}
      <UploadLine doc={doc} />
    </div>
  );
}

export function Chip({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center rounded-sm border px-3 text-sm transition-colors duration-150 disabled:cursor-not-allowed",
        selected ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function RetryLink({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="ml-2 inline-flex items-center gap-1 text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline"
    >
      <RotateCcw aria-hidden className="size-3" /> Retry
    </button>
  );
}

/** Shown while the server works out a size. */
export function Measuring({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs text-ink-3", className)}>
      <Loader2 aria-hidden className="size-3 animate-spin" />
      measuring
    </span>
  );
}

/** Before and after as two hairline bars, with the saving. Used for the prediction and the result. */
export function SizeBars({
  before,
  after,
  exact,
  status,
  afterLabel,
}: {
  before: number;
  after: number | null;
  exact: boolean;
  status?: React.ReactNode;
  afterLabel: string;
}) {
  const pct = after !== null && before > 0 ? Math.round((1 - after / before) * 100) : null;
  const rows: [string, number | null, number][] = [
    ["Before", before, 1],
    [afterLabel, after, after !== null && before ? Math.min(after / before, 1) : 0],
  ];
  return (
    <div className="mt-3 border-b border-line pb-3">
      <div className="flex items-baseline justify-between gap-4 pt-0.5">
        <p className="label-mono text-ink-3">Size</p>
        <p className="flex items-center gap-2 font-mono text-sm text-ink">
          {status}
          {pct !== null && <span>{pct > 0 ? `${exact ? "" : "≈ "}−${pct}%` : "No smaller"}</span>}
        </p>
      </div>
      <div className="mt-2.5 space-y-2">
        {rows.map(([label, size, ratio], i) => (
          <div key={label} className="grid grid-cols-[3.5rem_1fr_5rem] items-center gap-3">
            <span className="label-mono text-ink-3">{label}</span>
            <span className="h-2 overflow-hidden rounded-[2px] bg-paper-2">
              <motion.span
                className={cn("block h-full", i === 0 ? "bg-ink-3/50" : "bg-ink")}
                initial={false}
                animate={{ width: `${ratio * 100}%` }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </span>
            <span className="text-right font-mono text-xs text-ink-2">
              {size === null ? "—" : i === 0 ? formatBytes(size) : formatSize(size, exact)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Split: what's inside the ZIP, read from the archive itself. */
export function PartsList({ parts }: { parts: ZipEntry[] }) {
  const scroll = parts.length > 6;
  return (
    <div className="mt-4">
      <p className="label-mono text-ink-3">Inside · {plural(parts.length, zipNoun(parts))}</p>
      <div className={cn("relative mt-2", scroll && "max-h-[248px] overflow-y-auto overscroll-contain")} data-lenis-prevent>
        <ol className="divide-y divide-line border-y border-line">
          {parts.map((p, i) => (
            <li key={p.name} className="flex items-center gap-3 py-2">
              <span className="w-6 shrink-0 font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="w-24 shrink-0 text-sm font-medium text-ink">{describePart(p.name)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">{p.name}</span>
              <span className="shrink-0 font-mono text-xs text-ink-2">{formatBytes(p.size)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** What a ZIP holds, in a word: "PDF", "image" or "file". */
function zipNoun(parts: ZipEntry[]) {
  if (parts.every((p) => /\.pdf$/i.test(p.name))) return "PDF";
  if (parts.every((p) => /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(p.name))) return "image";
  return "file";
}
