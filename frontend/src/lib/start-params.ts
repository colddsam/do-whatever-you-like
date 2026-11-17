"use client";

import { useSyncExternalStore } from "react";

/*
 * A workspace's starting mode can come from the address (?alg=md5, ?mode=summarize), which is how
 * the pages merged into broader tools (lib/merged-tools.ts) keep opening on the variant people
 * came for. Read once in the browser; the server render (and the first hydration pass) sees null,
 * so components treat the value as a default that their own state takes over from.
 */

const noop = () => () => {};

/** The query string's value for `key`, in the browser; null on the server. */
export function useStartParam(key: string): string | null {
  return useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get(key),
    () => null,
  );
}

/** Every query parameter, for code that only runs in the browser. */
export function readStartParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(window.location.search));
}
