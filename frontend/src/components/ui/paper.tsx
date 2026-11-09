import type { CSSProperties } from "react";
import { Container } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * The worksheet's paper, shared by every page so they all feel like one sheet.
 *
 * - Grain lives on <body> (globals.css), so every page and section gets it.
 * - Graph-paper rules sit at the top of every page: animated in the home hero,
 *   still everywhere else (PageBackdrop). Both use this one definition.
 */

const CELL = 60; // 1200px container ÷ 20, so grid lines land exactly on the container hairlines.

export const graphPaper: CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
  backgroundSize: `${CELL}px ${CELL}px`,
  backgroundPosition: `calc(50% + ${CELL / 2}px) 0`,
};

export const fadeMask = (shape: string): CSSProperties => ({ maskImage: shape, WebkitMaskImage: shape });

/** Still graph-paper rules across the top of a page, fading out as the page goes on. */
export function PageBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] overflow-hidden">
      <div
        className="absolute inset-0 opacity-60"
        style={{ ...graphPaper, ...fadeMask("radial-gradient(ellipse 75% 90% at 50% 0%, #000 15%, transparent 72%)") }}
      />
    </div>
  );
}

/**
 * Standard page frame for everything except the home page: pulled up under the transparent
 * navbar (like the hero) so the rules run to the top edge, then the ruled container.
 */
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="relative isolate -mt-16 pt-16">
      <PageBackdrop />
      <Container className={cn("pb-20 md:pb-28", className)}>{children}</Container>
    </div>
  );
}
