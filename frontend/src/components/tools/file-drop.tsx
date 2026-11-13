"use client";

import { useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The drop zone every file tool starts with. The whole box is a <label> for a real file
 * input, so click, keyboard (focus + Enter/Space) and drag-and-drop all work.
 */
const CORNERS = [
  "left-2 top-2 rounded-tl-[4px] border-l-2 border-t-2",
  "right-2 top-2 rounded-tr-[4px] border-r-2 border-t-2",
  "bottom-2 right-2 rounded-br-[4px] border-b-2 border-r-2",
  "bottom-2 left-2 rounded-bl-[4px] border-b-2 border-l-2",
];

export function FileDrop({
  accept,
  title,
  formats,
  error,
  multiple = false,
  compact = false,
  onFile,
  onFiles,
}: {
  /** The input's `accept` attribute. */
  accept: string;
  /** e.g. "Drop a video here". */
  title: string;
  /** The small mono line listing what works. */
  formats: string;
  error?: string | null;
  /** Lets people pick or drop several files at once; they arrive through `onFiles`. */
  multiple?: boolean;
  /** A shorter box, for adding more files under a list that's already there. */
  compact?: boolean;
  onFile?: (file: File) => void;
  onFiles?: (files: File[]) => void;
}) {
  const id = useId();
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (onFiles) onFiles(multiple ? files : files.slice(0, 1));
    else onFile?.(files[0]);
  };
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave fire for children too; count them.

  return (
    <div>
      <label
        htmlFor={id}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "group relative flex cursor-pointer rounded-md border border-dashed text-center transition-[border-color,background-color,box-shadow] duration-150",
          compact ? "items-center gap-3 px-4 py-3 text-left" : "flex-col items-center px-6 py-8 sm:py-10",
          "has-[:focus-visible]:border-ink has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15",
          over
            ? "border-ink bg-surface"
            : error
              ? "border-danger/60 bg-paper"
              : "border-ink-3/50 bg-paper hover:border-ink-3 hover:bg-paper-2/40",
        )}
      >
        {/* While a file is held over it, viewfinder brackets snap onto the corners (the scanner's motif). */}
        <AnimatePresence>
          {over &&
            CORNERS.map((c, i) => (
              <motion.span
                key={i}
                aria-hidden
                initial={{ opacity: 0, scale: 1.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.2 }}
                transition={{ type: "spring", stiffness: 420, damping: 24, delay: i * 0.02 }}
                className={cn("pointer-events-none absolute size-4 border-ink", c)}
              />
            ))}
        </AnimatePresence>
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          aria-describedby={error ? `${id}-error` : `${id}-formats`}
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = ""; // so picking the same file again still fires
          }}
        />
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md border transition-[color,background-color,border-color,transform] duration-150 ease-out-soft",
            compact ? "size-9" : "size-11",
            over
              ? "-translate-y-1 border-ink bg-ink text-paper"
              : "border-line bg-surface text-ink-2 group-hover:border-ink-3 group-hover:text-ink",
          )}
        >
          <FileUp aria-hidden className={compact ? "size-4" : "size-5"} />
        </span>
        {compact ? (
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">{over ? "Let go to add them" : title}</span>
            <span id={`${id}-formats`} className="label-mono mt-0.5 block text-pretty text-ink-3">
              {formats}
            </span>
          </span>
        ) : (
          <>
            <p className="mt-4 text-[15px] font-medium text-ink">{over ? `Let go to add ${multiple ? "them" : "it"}` : title}</p>
            <p className="mt-1 text-sm text-ink-2">
              or <span className="underline decoration-line underline-offset-4 group-hover:decoration-ink-2">choose from your device</span>
            </p>
            <p id={`${id}-formats`} className="label-mono mt-5 text-balance text-ink-3">
              {formats}
            </p>
          </>
        )}
      </label>
      {error && (
        <p id={`${id}-error`} role="alert" className="px-1 pt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
