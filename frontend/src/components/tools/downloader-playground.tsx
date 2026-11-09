"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardPaste,
  Download,
  ExternalLink,
  ImageIcon,
  Link2,
  Loader2,
  RotateCcw,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { getTool, stepsFor } from "@/lib/tools";
import {
  checkLink,
  download,
  extract,
  formatBytes,
  formatCount,
  formatDuration,
  ToolError,
  type MediaPreview,
} from "@/lib/media";
import { Kbd } from "@/components/ui/primitives";
import { Workbench } from "./workbench";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

type Phase =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "ready"; preview: MediaPreview }
  | { kind: "error"; message: string };

type Saving =
  | { kind: "none" }
  | { kind: "preparing" }
  | { kind: "receiving"; progress: number | null }
  | { kind: "saved"; name: string; size: number }
  | { kind: "failed"; message: string };

const messageOf = (e: unknown) =>
  e instanceof ToolError ? e.message : "Something went wrong. Check your connection and try again.";

/** Takes an id, not the tool object: tools carry icon components, which can't cross the server/client boundary. */
export function DownloaderPlayground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const cfg = tool.downloader!;
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [saving, setSaving] = useState<Saving>({ kind: "none" });
  const [canPaste, setCanPaste] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setCanPaste(typeof navigator.clipboard?.readText === "function"), 0);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, []);

  const reset = () => {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
    setSaving({ kind: "none" });
    setUrl("");
    setHint(null);
    inputRef.current?.focus();
  };

  const run = async (value = url) => {
    const problem = checkLink(value, cfg.hosts, cfg.allowShortcode);
    setHint(problem);
    if (problem) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSubmitted(value.trim());
    setSaving({ kind: "none" });
    setPhase({ kind: "fetching" });
    try {
      const preview = await extract(cfg.platform, value, ctrl.signal);
      setPhase({ kind: "ready", preview });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPhase({ kind: "error", message: messageOf(e) });
    }
  };

  const save = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSaving({ kind: "preparing" });
    try {
      const file = await download(cfg.platform, submitted, {
        signal: ctrl.signal,
        onStart: () => setSaving({ kind: "receiving", progress: null }),
        onProgress: (progress) => setSaving({ kind: "receiving", progress }),
      });
      setSaving({ kind: "saved", ...file });
    } catch (e) {
      if (ctrl.signal.aborted) return setSaving({ kind: "none" });
      setSaving({ kind: "failed", message: messageOf(e) });
    }
  };

  const cancelSave = () => {
    abortRef.current?.abort();
    setSaving({ kind: "none" });
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      setUrl(text);
      run(text);
    } catch {
      inputRef.current?.focus();
    }
  };

  const busy = phase.kind === "fetching";
  // Which of the three steps (paste → check → save) the person is on.
  const step =
    phase.kind !== "ready"
      ? 0
      : saving.kind === "saved"
        ? 3
        : saving.kind === "preparing" || saving.kind === "receiving"
          ? 2
          : 1;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={
        <>
          Public content only. Download things you have the right to use, see{" "}
          <Link href="/fair-use" className="text-ink-2 underline decoration-line underline-offset-2 hover:decoration-ink-2">
            fair use
          </Link>
          .
        </>
      }
    >
      {/* Input */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="p-3 sm:p-4"
      >
        <label htmlFor="tool-url" className="sr-only">
          {tool.name.replace(" downloader", "")} link
        </label>
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border bg-paper p-1.5 pl-3.5 transition-[border-color,box-shadow] duration-150 focus-within:border-ink focus-within:ring-4 focus-within:ring-accent/15",
            hint ? "border-danger" : "border-line",
          )}
        >
          <Link2 aria-hidden className="size-4 shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            id="tool-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (hint) setHint(null);
            }}
            placeholder={cfg.placeholder}
            aria-invalid={Boolean(hint)}
            aria-describedby={hint ? "tool-url-hint" : undefined}
            className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          {url && !busy && (
            <button
              type="button"
              onClick={reset}
              aria-label="Clear link"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          )}
          {!url && canPaste && (
            <button
              type="button"
              onClick={paste}
              className="hidden h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink sm:inline-flex"
            >
              <ClipboardPaste aria-hidden className="size-4" /> Paste
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            className="group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-ink px-3.5 text-sm font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px disabled:opacity-70"
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {busy ? "Fetching" : "Fetch"}
            {!busy && (
              <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
            )}
          </button>
        </div>
        <AnimatePresence initial={false}>
          {hint && (
            <motion.p
              id="tool-url-hint"
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden px-1 text-sm text-danger"
            >
              <span className="block pt-2">{hint}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </form>

      {/* Output */}
      <div aria-live="polite" className="px-3 pb-3 sm:px-4 sm:pb-4">
        <AnimatePresence mode="wait" initial={false}>
          {phase.kind === "idle" && (
            <motion.div
              key="idle"
              {...swap}
              className="grid gap-6 rounded-md border border-dashed border-line px-5 py-6 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-10 sm:px-6"
            >
              <div>
                <p className="text-[15px] font-medium text-ink">Paste a link, then press <Kbd>↵</Kbd></p>
                <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-ink-2">
                  You&apos;ll see the title and every file before anything downloads.
                </p>
              </div>
              <div>
                <p className="label-mono text-ink-3">Links that work</p>
                <ul className="mt-2.5 space-y-1.5">
                  {cfg.examples.map((ex) => (
                    <li key={ex} className="flex items-center gap-2 font-mono text-[12.5px] text-ink-2">
                      <Check aria-hidden className="size-3.5 shrink-0 text-ink-3" />
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}

          {phase.kind === "fetching" && <Skeleton key="fetching" />}

          {phase.kind === "error" && (
            <motion.div key="error" {...swap} className="flex flex-col items-center justify-center rounded-md border border-danger/25 bg-danger/[0.03] px-6 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-md border border-danger/30 bg-danger/5 text-danger">
                <AlertCircle aria-hidden className="size-5" />
              </span>
              <p className="mt-5 text-[15px] font-medium text-ink">We couldn&apos;t fetch that</p>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-2">{phase.message}</p>
              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={() => run(submitted)}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85"
                >
                  <RotateCcw aria-hidden className="size-4" /> Try again
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
                >
                  Use another link
                </button>
              </div>
            </motion.div>
          )}

          {phase.kind === "ready" && (
            <Result key="ready" preview={phase.preview} saving={saving} onSave={save} onCancel={cancelSave} onReset={reset} />
          )}
        </AnimatePresence>
      </div>
    </Workbench>
  );
}

/* ---------- Pieces ---------- */

function Skeleton() {
  return (
    <motion.div {...swap} aria-label="Fetching details" className="grid gap-5 sm:grid-cols-[200px_1fr]">
      <div className="aspect-video animate-pulse rounded-md bg-paper-2 sm:aspect-[4/5]" />
      <div className="space-y-3 py-1">
        <div className="h-3 w-24 animate-pulse rounded-sm bg-paper-2" />
        <div className="h-6 w-4/5 animate-pulse rounded-sm bg-paper-2" />
        <div className="h-4 w-1/3 animate-pulse rounded-sm bg-paper-2" />
        <div className="mt-6 h-11 animate-pulse rounded-md bg-paper-2" />
        <div className="h-11 animate-pulse rounded-md bg-paper-2" />
      </div>
    </motion.div>
  );
}

function Result({
  preview,
  saving,
  onSave,
  onCancel,
  onReset,
}: {
  preview: MediaPreview;
  saving: Saving;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const meta = [
    preview.author,
    preview.duration ? formatDuration(preview.duration) : null,
    preview.views ? `${formatCount(preview.views)} views` : null,
  ].filter(Boolean);
  const inFlight = saving.kind === "preparing" || saving.kind === "receiving";

  return (
    <motion.div {...swap} className="grid gap-5 sm:grid-cols-[200px_1fr]">
      {/* Thumbnail */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        className={cn(
          "relative overflow-hidden rounded-md border border-line bg-paper-2",
          preview.vertical ? "mx-auto aspect-[9/16] w-40 sm:w-full" : "aspect-video sm:aspect-[4/5]",
        )}
      >
        {preview.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote CDN thumbnails with short-lived URLs
          <img
            src={preview.thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-ink-3">
            <Video aria-hidden className="size-6" />
          </span>
        )}
        {preview.duration ? (
          <span className="absolute bottom-2 right-2 rounded-sm bg-ink/85 px-1.5 py-0.5 font-mono text-[11px] text-paper">
            {formatDuration(preview.duration)}
          </span>
        ) : null}
      </motion.div>

      {/* Details */}
      <div className="flex min-w-0 flex-col">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Check aria-hidden className="size-3.5 text-success" /> Found it
        </p>
        <h3 className="mt-2 line-clamp-2 text-xl font-semibold leading-snug tracking-[-0.02em] text-ink">{preview.title}</h3>
        {meta.length > 0 && <p className="mt-1.5 truncate text-sm text-ink-2">{meta.join(" · ")}</p>}

        {/* Capped at ~5 rows so the download button stays in view for big carousels. */}
        <ul className="mt-5 max-h-[226px] divide-y divide-line overflow-y-auto rounded-md border border-line">
          {preview.items.length > 1 && (
            <li className="label-mono sticky top-0 z-10 flex justify-between bg-surface px-3 py-2 text-ink-3">
              <span>{preview.items.length} files</span>
              <span>Packed as one {preview.output}</span>
            </li>
          )}
          {preview.items.map((item, i) => (
            <motion.li
              key={item.url}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.1 + i * 0.05 }}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              {item.type === "video" ? (
                <Video aria-hidden className="size-4 shrink-0 text-ink-3" />
              ) : (
                <ImageIcon aria-hidden className="size-4 shrink-0 text-ink-3" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                referrerPolicy="no-referrer"
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                Open <ExternalLink aria-hidden className="size-3" />
              </a>
            </motion.li>
          ))}
        </ul>

        <div className="mt-auto pt-6">
          <AnimatePresence mode="wait" initial={false}>
            {saving.kind === "saved" ? (
              <motion.div key="saved" {...swap} className="flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-success">
                  <Check aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">
                    Saved {saving.name} ({formatBytes(saving.size)})
                  </span>
                </p>
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
                >
                  Download another
                </button>
              </motion.div>
            ) : (
              <motion.div key="actions" {...swap}>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={inFlight}
                    className="group relative inline-flex h-12 flex-1 items-center justify-center gap-2 overflow-hidden rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px disabled:cursor-progress disabled:hover:bg-ink"
                  >
                    {saving.kind === "receiving" && saving.progress !== null && (
                      <motion.span
                        aria-hidden
                        className="absolute inset-y-0 left-0 bg-paper/15"
                        animate={{ width: `${saving.progress * 100}%` }}
                        transition={{ ease: "linear", duration: 0.2 }}
                      />
                    )}
                    <span className="relative inline-flex items-center gap-2">
                      {inFlight ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Download aria-hidden className="size-4" />}
                      {saving.kind === "preparing"
                        ? "Preparing file…"
                        : saving.kind === "receiving"
                          ? saving.progress !== null
                            ? `Downloading ${Math.round(saving.progress * 100)}%`
                            : "Downloading…"
                          : `Download ${preview.output}`}
                    </span>
                  </button>
                  {inFlight && (
                    <button
                      type="button"
                      onClick={onCancel}
                      className="inline-flex h-12 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <p className={cn("mt-2.5 text-xs", saving.kind === "failed" ? "text-danger" : "text-ink-3")}>
                  {saving.kind === "failed"
                    ? saving.message
                    : saving.kind === "preparing"
                      ? "We fetch and package the file first, which can take a moment for longer videos."
                      : `Best available quality, saved as ${preview.output === "File" ? "the original file" : preview.output}.`}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
