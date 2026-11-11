"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { stamp, type Segment } from "@/lib/transcribe";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The transcript as a ruled sheet: start times in a mono margin, the words beside them.
 *
 * - While the server works (`live`), lines arrive one by one and the sheet follows the newest.
 * - Afterwards it reads along: the line being heard is filled `paper-2` and set in ink, and the
 *   sheet keeps it in view. Clicking a time or a line plays from there.
 * - `editing` turns each line into a text box, so names and slips can be fixed before export.
 */
export function TranscriptSheet({
  segments,
  active,
  live,
  liveAt,
  editing,
  following,
  onSeek,
  onEdit,
}: {
  segments: Segment[];
  /** Index of the line being heard, or -1. */
  active: number;
  live: boolean;
  /** How far the server has got (seconds), for the "listening" line while live. */
  liveAt: number;
  editing: boolean;
  /** Keep the active line in view (only while the audio plays, so reading isn't interrupted). */
  following: boolean;
  onSeek: (seconds: number) => void;
  onEdit: (id: number, text: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const count = segments.length;

  // While live, stay at the bottom, unless the reader has scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (live && el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count, live]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !following || active < 0) return;
    const row = el.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!row) return;
    const top = row.offsetTop - el.offsetTop;
    if (top < el.scrollTop + 24 || top + row.offsetHeight > el.scrollTop + el.clientHeight - 24) {
      el.scrollTo({ top: top - el.clientHeight / 3, behavior: "smooth" });
    }
  }, [active, following]);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-paper">
      <div
        ref={scroller}
        data-lenis-prevent
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="relative max-h-[min(58vh,520px)] overflow-y-auto overscroll-contain"
      >
        <ol aria-label="Transcript" className="py-1.5">
          {segments.map((s, i) => {
            const on = i === active;
            return (
              <motion.li
                key={s.id}
                data-index={i}
                initial={live ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className={cn(
                  "relative grid grid-cols-[3.25rem_1fr] gap-2 px-2 transition-colors duration-200 sm:grid-cols-[4.25rem_1fr] sm:gap-3 sm:px-3",
                  on && "bg-paper-2",
                )}
              >
                {/* The margin rule a ruled sheet has, and the ink tick of the line being heard. */}
                <span aria-hidden className="absolute inset-y-0 left-[3.75rem] w-px bg-line sm:left-[5rem]" />
                <button
                  type="button"
                  onClick={() => onSeek(s.start)}
                  aria-label={`Play from ${stamp(s.start)}`}
                  className={cn(
                    "self-start rounded-sm py-2 text-left font-mono text-[12px] tabular-nums transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15",
                    on ? "text-ink" : "text-ink-3",
                  )}
                >
                  {stamp(s.start)}
                </button>
                {editing ? (
                  <textarea
                    value={s.text}
                    onChange={(e) => onEdit(s.id, e.target.value)}
                    aria-label={`Line at ${stamp(s.start)}`}
                    rows={1}
                    spellCheck
                    className="my-1 w-full resize-none rounded-sm border border-transparent bg-transparent px-2 py-1 pl-3 text-[15px] leading-relaxed text-ink outline-none transition-[border-color,background-color,box-shadow] [field-sizing:content] hover:border-line focus:border-ink focus:bg-surface focus:ring-4 focus:ring-accent/15"
                  />
                ) : (
                  <p
                    onClick={() => onSeek(s.start)}
                    className={cn(
                      "cursor-pointer py-2 pl-3 text-[15px] leading-relaxed transition-colors duration-200",
                      on ? "text-ink" : "text-ink-2 hover:text-ink",
                    )}
                  >
                    {s.text}
                  </p>
                )}
              </motion.li>
            );
          })}

          {live && (
            <li className="relative grid grid-cols-[3.25rem_1fr] gap-2 px-2 sm:grid-cols-[4.25rem_1fr] sm:gap-3 sm:px-3">
              <span aria-hidden className="absolute inset-y-0 left-[3.75rem] w-px bg-line sm:left-[5rem]" />
              <span className="py-2 font-mono text-[12px] tabular-nums text-ink-3">{stamp(liveAt)}</span>
              <span className="flex items-center gap-2 py-2 pl-3">
                <span aria-hidden className="h-4 w-[2px] animate-pulse bg-ink motion-reduce:animate-none" />
                <span className="label-mono text-ink-3">{count ? "Listening" : "Listening for speech"}</span>
              </span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
