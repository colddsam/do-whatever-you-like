"use client";

import type { FC } from "react";
import dynamic from "next/dynamic";

/**
 * Entry point for the API client (/tools/api-client), loaded by the tool page's playground.
 * Client-only: it keeps everything in IndexedDB and runs scripts in a worker.
 */
const Studio = dynamic(() => import("./ui/app").then((m) => m.ApiStudio), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[calc(100dvh-116px)] min-h-[540px] animate-pulse rounded-lg border border-line bg-surface lg:h-[min(88dvh,1120px)]" />,
});

/** The playground passes `toolId`; there's one API client, so it isn't read. */
export const ApiStudioEntry: FC<{ toolId: string }> = () => <Studio />;
