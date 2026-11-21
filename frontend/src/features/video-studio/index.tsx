"use client";

import { useEffect, useLayoutEffect, type FC } from "react";
import dynamic from "next/dynamic";
import { STUDIO_PATH } from "./constants";

/**
 * Entry point for the video editor (/tools/video-editor), loaded by the tool page's playground.
 *
 * Cross-origin isolation: next.config.ts sends COOP/COEP for this page only, which unlocks
 * SharedArrayBuffer (multi-threaded WASM for the AI models). Headers only take effect on a real page
 * load, so arriving by a client-side link keeps the previous page's (non-isolated) document: this
 * component reloads once, before the editor's code is even fetched. Leaving the editor by a
 * client-side link reloads the destination, so no other page ever runs cross-origin isolated (it
 * would block iframes elsewhere on the site).
 */

const Studio = dynamic(() => import("./ui/studio").then((m) => m.VideoStudio), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[calc(100dvh-76px)] min-h-[600px] animate-pulse rounded-lg border border-line bg-ink lg:h-[min(90vh,980px)] lg:min-h-[680px]" />,
});

const strip = (p: string) => p.replace(/\/+$/, "") || "/";

function arrivedWithoutHeaders() {
  try {
    if (window.crossOriginIsolated) {
      sessionStorage.removeItem("studio:coi");
      return false;
    }
    const here = strip(location.pathname);
    // Already tried once in this tab (a browser without COEP "credentialless", like Safari): carry on.
    if (sessionStorage.getItem("studio:coi") === here) return false;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const landed = nav ? strip(new URL(nav.name).pathname) : here;
    if (landed === here) return false;
    sessionStorage.setItem("studio:coi", here);
    return true;
  } catch {
    return false;
  }
}

/** The playground passes `toolId` to every workspace; there's only one video editor, so it isn't read. */
export const VideoEditorEntry: FC<{ toolId: string }> = () => {
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
