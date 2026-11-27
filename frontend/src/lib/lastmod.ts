import LASTMOD from "@/lib/lastmod.json";

/**
 * When a page's content last changed (YYYY-MM-DD), from scripts/lastmod.mjs, which runs before
 * every build. Undefined for a page it doesn't know yet: no date beats a made-up one.
 */
export const lastModified = (path: string): string | undefined =>
  (LASTMOD as Record<string, { date: string }>)[path]?.date;

/** "27 Nov 2026", for a visible "Updated" line. */
export const formatDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
