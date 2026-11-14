"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import Lenis from "lenis";
import { getLenis, setLenis } from "@/lib/smooth-scroll";

const NAVBAR_SCROLL_OFFSET = -72;

/**
 * Recompute Lenis's scrollable bounds immediately from the true document height so
 * route transitions, expandable panels, and dynamic filters never get clamped at a stale limit.
 */
function syncDimensions(lenis: Lenis) {
  lenis.dimensions.resize();
  lenis.dimensions.scrollHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  );
}

/** Resolve an in-page hash string to a scrollable target element (or top = 0). */
function resolveHashTarget(hash: string): HTMLElement | 0 | null {
  if (!hash || hash === "#") return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    id = hash.slice(1);
  }
  const el = id ? document.getElementById(id) : null;
  if (el) return el;
  return id === "top" ? 0 : null;
}

/**
 * Smooth, inertial wheel scrolling (Lenis). Touch keeps native scrolling, and people who
 * ask for reduced motion get the browser's default scroll with no easing at all.
 */
function useSmoothScroll() {
  const pathname = usePathname();

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;
    let rafId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let removeClickListener: (() => void) | null = null;

    const start = () => {
      if (media.matches || lenis) return;
      const instance = new Lenis({
        autoRaf: true,
        lerp: 0.1,
        // Inner lists (command palette, carousel items) scroll themselves first, then hand off to the page.
        allowNestedScroll: true,
        wheelMultiplier: 0.95,
        // We handle in-page and Next.js <Link href="/#..."> anchors ourselves below.
        anchors: false,
      });

      const origScrollTo = instance.scrollTo.bind(instance);
      instance.scrollTo = ((target, options) => {
        syncDimensions(instance);
        // Resolve element targets against window.scrollY so a recent native scroll never skews Lenis's animatedScroll base.
        const resolvedTarget =
          target instanceof HTMLElement
            ? target.getBoundingClientRect().top + window.scrollY
            : target;
        return origScrollTo(resolvedTarget, options);
      }) as Lenis["scrollTo"];

      const scheduleSync = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          syncDimensions(instance);
        });
      };
      resizeObserver = new ResizeObserver(scheduleSync);
      resizeObserver.observe(document.documentElement);
      resizeObserver.observe(document.body);

      const onAnchorClick = (event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        const anchor = (event.target as Element | null)?.closest("a[href]") as
          | HTMLAnchorElement
          | null;
        if (
          !anchor ||
          (anchor.target && anchor.target !== "_self") ||
          anchor.hasAttribute("download")
        ) {
          return;
        }

        let url: URL;
        try {
          url = new URL(anchor.href, window.location.href);
        } catch {
          return;
        }
        if (
          url.origin !== window.location.origin ||
          url.pathname !== window.location.pathname ||
          !url.hash
        ) {
          return;
        }

        const target = resolveHashTarget(url.hash);
        if (target === null) return;

        event.preventDefault();
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
          history.pushState(null, "", nextUrl);
        }
        syncDimensions(instance);
        instance.scrollTo(target, { offset: NAVBAR_SCROLL_OFFSET, force: true });
      };

      document.addEventListener("click", onAnchorClick, true);
      removeClickListener = () => document.removeEventListener("click", onAnchorClick, true);

      lenis = instance;
      setLenis(instance);
      syncDimensions(instance);
    };

    const stop = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      removeClickListener?.();
      removeClickListener = null;
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

  useEffect(() => {
    const scrollAfterRouteCommit = () => {
      const activeLenis = getLenis();
      const target = resolveHashTarget(window.location.hash);

      if (activeLenis) {
        syncDimensions(activeLenis);
        if (target !== null) {
          activeLenis.scrollTo(target, { offset: NAVBAR_SCROLL_OFFSET, force: true });
        } else {
          activeLenis.scrollTo(0, { immediate: true, force: true });
        }
        return;
      }

      if (target instanceof HTMLElement) {
        const top = target.getBoundingClientRect().top + window.scrollY + NAVBAR_SCROLL_OFFSET;
        window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    };

    const activeLenis = getLenis();
    if (activeLenis) syncDimensions(activeLenis);
    const frameId = requestAnimationFrame(scrollAfterRouteCommit);
    return () => cancelAnimationFrame(frameId);
  }, [pathname]);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useSmoothScroll();
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
