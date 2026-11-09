"use client";

import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import Lenis from "lenis";
import { setLenis } from "@/lib/smooth-scroll";

/**
 * Smooth, inertial wheel scrolling (Lenis). Touch keeps native scrolling, and people who
 * ask for reduced motion get the browser's default scroll with no easing at all.
 */
function useSmoothScroll() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;

    const start = () => {
      if (media.matches || lenis) return;
      lenis = new Lenis({
        autoRaf: true,
        lerp: 0.1,
        // Inner lists (command palette, carousel items) scroll themselves first, then hand off to the page.
        allowNestedScroll: true,
        wheelMultiplier: 0.95,
        // In-page links glide to their section and clear the sticky navbar.
        anchors: { offset: -72 },
      });
      setLenis(lenis);
    };
    const stop = () => {
      lenis?.destroy();
      lenis = null;
      setLenis(null);
    };
    const onChange = () => (media.matches ? stop() : start());

    start();
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
      stop();
    };
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useSmoothScroll();
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
