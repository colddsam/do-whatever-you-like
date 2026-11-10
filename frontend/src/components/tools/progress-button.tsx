"use client";

import { motion } from "motion/react";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export type Job =
  | { kind: "ready" }
  | { kind: "uploading"; progress: number }
  | { kind: "processing" }
  | { kind: "failed"; message: string };

export const isBusy = (job: Job) => job.kind === "uploading" || job.kind === "processing";

/**
 * Step two's action for every file tool. The button doubles as the progress bar: it fills
 * while uploading, then a slow sheen runs while the server works. A Cancel button sits beside
 * it while busy, and the line underneath explains what's happening (or what went wrong).
 */
export function ProgressButton({
  job,
  label,
  working,
  hint,
  disabled = false,
  onStart,
  onCancel,
}: {
  job: Job;
  /** Idle label, e.g. "Merge 3 PDFs". */
  label: string;
  /** Shown while the server works, e.g. "Merging…". */
  working: string;
  /** The line under the button when nothing is happening. */
  hint: React.ReactNode;
  disabled?: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const busy = isBusy(job);
  const fill = job.kind === "uploading" ? job.progress : job.kind === "processing" ? 1 : 0;

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={busy || disabled}
          className="group relative inline-flex h-12 flex-1 items-center justify-center overflow-hidden rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform,opacity] duration-150 hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink disabled:active:translate-y-0 data-[busy=true]:cursor-progress data-[busy=true]:opacity-100"
          data-busy={busy}
        >
          {busy && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-paper/15"
              animate={{ width: `${fill * 100}%` }}
              transition={{ ease: "linear", duration: 0.2 }}
            />
          )}
          {job.kind === "processing" && (
            // Server-side work has no progress to report, so a slow sheen says "still going".
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-paper/15 to-transparent"
              initial={{ left: "-33%" }}
              animate={{ left: "100%" }}
              transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
            />
          )}
          <span className="relative inline-flex items-center gap-2">
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {job.kind === "uploading"
              ? `Uploading ${Math.round(job.progress * 100)}%`
              : job.kind === "processing"
                ? working
                : job.kind === "failed"
                  ? "Try again"
                  : label}
            {job.kind === "ready" && (
              <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
            )}
            {job.kind === "failed" && <RotateCcw aria-hidden className="size-4" />}
          </span>
        </button>
        {busy && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-12 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
          >
            Cancel
          </button>
        )}
      </div>
      <p aria-live="polite" className={cn("mt-2.5 text-xs leading-relaxed", job.kind === "failed" ? "text-danger" : "text-ink-3")}>
        {job.kind === "failed"
          ? job.message
          : job.kind === "uploading"
            ? "Uploading is the slow part. Keep this tab open."
            : job.kind === "processing"
              ? "Almost there. This usually takes a few seconds."
              : hint}
      </p>
    </div>
  );
}
