"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The frame every tool runs in, whatever kind it is.
 *
 * A step tracker runs across the top (always three steps, named by the tool) so people
 * can see where they are without reading instructions. The tool's own UI goes in the body,
 * and an optional footer holds the small print.
 *
 * `current` is the index of the step in progress: -1 before anything can happen
 * (a tool that isn't built yet), `steps.length` once everything is done.
 */
export function Workbench({
  steps,
  current,
  children,
  footer,
  className,
}: {
  steps: readonly string[];
  current: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    // overflow-clip (not hidden) keeps the rounded corners without becoming a scroll
    // container, so sticky panels inside a tool (the QR preview) still stick to the page.
    <div className={cn("overflow-clip rounded-lg border border-line bg-surface shadow-float", className)}>
      <ol aria-label="Steps" className="flex border-b border-line">
        {steps.map((title, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li
              key={title}
              aria-current={state === "active" ? "step" : undefined}
              className={cn(
                "relative flex min-w-0 items-center gap-2.5 px-4 py-3.5 sm:flex-1 sm:px-5 [&+&]:border-l [&+&]:border-line",
                // On phones only the current step shows its name; the others shrink to their number.
                state === "active" || (current < 0 && i === 0) ? "flex-1" : "shrink-0",
              )}
            >
              {/* Fill along the top edge: ink for finished steps, accent for the one you're on. */}
              <motion.span
                aria-hidden
                initial={false}
                animate={{ scaleX: state === "todo" ? 0 : 1 }}
                transition={{ duration: 0.5, ease: EASE }}
                className={cn(
                  "absolute inset-x-0 -top-px h-0.5 origin-left transition-colors duration-300",
                  state === "active" ? "bg-accent" : "bg-ink",
                )}
              />
              <span
                className={cn(
                  "label-mono flex size-6 shrink-0 items-center justify-center rounded-sm border transition-colors duration-300",
                  state === "done" && "border-ink bg-ink text-paper",
                  state === "active" && "border-ink bg-surface text-ink",
                  state === "todo" && "border-line bg-paper text-ink-3",
                )}
              >
                {state === "done" ? <Check aria-hidden className="size-3.5" strokeWidth={2.5} /> : `0${i + 1}`}
              </span>
              <span
                className={cn(
                  "truncate text-sm transition-colors duration-300",
                  state === "active" ? "font-medium text-ink" : state === "done" ? "text-ink-2" : "text-ink-3",
                  state === "active" || (current < 0 && i === 0) ? "block" : "hidden sm:block",
                )}
              >
                <span className="sr-only">{state === "done" ? "Done: " : state === "active" ? "Now: " : "Next: "}</span>
                {title}
              </span>
            </li>
          );
        })}
      </ol>

      {children}

      {footer && (
        <div className="border-t border-line bg-paper/50 px-4 py-3 text-xs leading-relaxed text-ink-3 sm:px-5">{footer}</div>
      )}
    </div>
  );
}
