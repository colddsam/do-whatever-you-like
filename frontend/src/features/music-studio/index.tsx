"use client";

import { useEffect, useLayoutEffect, type FC } from "react";
import dynamic from "next/dynamic";
import { STUDIO_PATH } from "./constants";

/**
 * Entry point for the music studio (/tools/music-studio), loaded by the tool page's playground.
 *
 * Cross-origin isolation (next.config.ts sends COOP/COEP for this page only) lets the on-device
 * MusicGen model run multi-threaded. Headers only apply on a real page load, so arriving by a
 * client-side link reloads once before the studio's code is fetched; leaving by a client-side
 * link reloads the destination, so no other page runs isolated. Same approach as the video editor.
 */

const Studio = dynamic(() => import("./ui/studio").then((m) => m.MusicStudio), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[calc(100dvh-116px)] min-h-[520px] animate-pulse rounded-lg border border-line bg-ink lg:h-[min(88dvh,1180px)]" />,
});

const strip = (p: string) => p.replace(/\/+$/, "") || "/";

function arrivedWithoutHeaders() {
  try {
    if (window.crossOriginIsolated) {
      sessionStorage.removeItem("music:coi");
      return false;
    }
    const here = strip(location.pathname);
    // Already tried once in this tab (a browser without COEP "credentialless", like Safari): carry on.
    if (sessionStorage.getItem("music:coi") === here) return false;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const landed = nav ? strip(new URL(nav.name).pathname) : here;
    if (landed === here) return false;
    sessionStorage.setItem("music:coi", here);
    return true;
  } catch {
    return false;
  }
}

/** The playground passes `toolId`; there's one music studio, so it isn't read. */
export const MusicStudioEntry: FC<{ toolId: string }> = () => {
  useLayoutEffect(() => {
    if (arrivedWithoutHeaders()) location.reload();
  }, []);
  useEffect(
    () => () => {
      if (window.crossOriginIsolated && strip(location.pathname) !== STUDIO_PATH) location.reload();
    },
    [],
  );
  return <Studio />;
};
