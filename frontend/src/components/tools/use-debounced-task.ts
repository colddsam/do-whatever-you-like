"use client";

import { useEffect, useRef } from "react";

/**
 * Debounced async work keyed on `key`; the previous run is cancelled when the key changes.
 * Used by every tool that measures or previews its result while people adjust options.
 */
export function useDebouncedTask(key: string | null, run: (signal: AbortSignal) => Promise<void>, delay: number) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      runRef.current(ctrl.signal).catch(() => {});
    }, delay);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key, delay]);
}
