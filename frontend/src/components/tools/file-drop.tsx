"use client";

import { useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The drop zone every file tool starts with. The whole box is a <label> for a real file
 * input, so click, keyboard (focus + Enter/Space) and drag-and-drop all work.
 */
export function FileDrop({
  accept,
  title,
  formats,
  error,
  onFile,
}: {
  /** The input's `accept` attribute. */
  accept: string;
  /** e.g. "Drop a video here". */
  title: string;
  /** The small mono line listing what works. */
  formats: string;
  error?: string | null;
  onFile: (file: File) => void;
}) {
  const id = useId();
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
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center rounded-md border border-dashed px-6 py-8 text-center transition-[border-color,background-color,box-shadow] duration-150 sm:py-10",
          "has-[:focus-visible]:border-ink has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15",
          over
            ? "border-ink bg-surface"
            : error
              ? "border-danger/60 bg-paper"
              : "border-ink-3/50 bg-paper hover:border-ink-3 hover:bg-paper-2/40",
        )}
      >
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          aria-describedby={error ? `${id}-error` : `${id}-formats`}
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = ""; // so picking the same file again still fires
          }}
        />
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-md border transition-[color,background-color,border-color,transform] duration-150 ease-out-soft",
            over
              ? "-translate-y-1 border-ink bg-ink text-paper"
              : "border-line bg-surface text-ink-2 group-hover:border-ink-3 group-hover:text-ink",
          )}
        >
          <FileUp aria-hidden className="size-5" />
        </span>
        <p className="mt-4 text-[15px] font-medium text-ink">{over ? "Let go to add it" : title}</p>
        <p className="mt-1 text-sm text-ink-2">
          or <span className="underline decoration-line underline-offset-4 group-hover:decoration-ink-2">choose from your device</span>
        </p>
        <p id={`${id}-formats`} className="label-mono mt-5 text-ink-3">
          {formats}
        </p>
      </label>
      {error && (
        <p id={`${id}-error`} role="alert" className="px-1 pt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
