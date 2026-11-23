import type { NextRequest } from "next/server";
import { apiError, getJson, postJson } from "@/lib/backend";

/**
 * The music studio's server helpers (backend/app/api/v1/endpoints/music.py). Every sound is made
 * in the browser; these only carry small JSON to and from the free AI composer and lyricist.
 * Vocals use /api/tools/studio/tts (free Edge voices with word timings).
 *
 * GET  /api/tools/music/capabilities  which AI is available (groq, gemini or none)
 * POST /api/tools/music/compose       a description → a song plan (tempo, key, sections, lyrics)
 * POST /api/tools/music/lyrics        a topic → original lyrics by section
 */

export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tools/music/[action]">) {
  const { action } = await ctx.params;
  if (action !== "capabilities") return apiError(404, "Unknown action.");
  return getJson("music/capabilities", "Couldn't check the AI composer.");
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/music/[action]">) {
  const { action } = await ctx.params;
  if (action === "compose") return postJson(req, "music/compose", { maxBytes: 12_000, timeoutMs: 55_000, failed: "The AI composer couldn't plan that song." });
  if (action === "lyrics") return postJson(req, "music/lyrics", { maxBytes: 4_000, timeoutMs: 55_000, failed: "The AI couldn't write those lyrics." });
  return apiError(404, "Unknown action.");
}
