"use client";

import { motion, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { fadeMask, graphPaper } from "@/components/ui/paper";

/**
 * The hero's "worksheet" backdrop: graph-paper rules that fade out toward the edges,
 * and a lighter wash where the 3D object sits (grain comes from <body>, like every page). The rules drift slower than the
 * page as you scroll (the far layer of the parallax).
 */
export function HeroBackdrop({ progress }: { progress: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const gridY = useTransform(progress, [0, 1], [0, reduce ? 0 : 240]);
  const washY = useTransform(progress, [0, 1], [0, reduce ? 0 : 140]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        style={{
          y: gridY,
          ...graphPaper,
          ...fadeMask("radial-gradient(ellipse 75% 70% at 62% 30%, #000 20%, transparent 78%)"),
        }}
        className="absolute inset-x-0 -top-[10%] h-[120%] opacity-60"
      />

      {/* A lighter patch of paper behind the object, like a spot under a desk lamp. */}
      <motion.div
        style={{
          y: washY,
          background: "radial-gradient(closest-side, var(--color-surface), transparent)",
        }}
        className="absolute right-[-10%] top-[-8%] hidden aspect-square w-[70%] max-w-[900px] lg:block"
      />

      {/* Rules dissolve into the plain page below. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-paper" />
    </div>
  );
}
