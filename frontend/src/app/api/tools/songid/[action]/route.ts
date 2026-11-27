import type { NextRequest } from "next/server";
import { apiError, getJson, postJson, proxyUpload } from "@/lib/backend";

/**
 * The song finder (backend/app/api/v1/endpoints/songid.py). Small requests only: a few words of
 * lyrics, or a clip of at most ~30 seconds (well under Vercel's 4.5 MB request cap).
 *
 * GET  /api/tools/songid/capabilities           what works on this server
 * GET  /api/tools/songid/video?title=&artist=   the song's YouTube video id
 * POST /api/tools/songid/lyrics                 {"text": "..."} → matches
 * POST /api/tools/songid/audio                  form data: file (+ notes) → matches
 */

export const maxDuration = 60;

const MAX_MB = 4; // Vercel refuses bodies over 4.5 MB; the backend allows 10 MB for direct calls.

export async function GET(req: NextRequest, ctx: RouteContext<"/api/tools/songid/[action]">) {
  const { action } = await ctx.params;
  if (action === "capabilities") return getJson("songid/capabilities", "Couldn't check the song finder.");
  if (action === "video") {
    const url = new URL(req.url);
    const title = (url.searchParams.get("title") ?? "").trim().slice(0, 160);
    const artist = (url.searchParams.get("artist") ?? "").trim().slice(0, 160);
    if (!title) return apiError(400, "Which song?");
    return getJson(`songid/video?${new URLSearchParams({ title, artist })}`, "Couldn't find the video.");
  }
  return apiError(404, "Unknown action.");
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/songid/[action]">) {
  const { action } = await ctx.params;
  if (action === "lyrics") return postJson(req, "songid/lyrics", { maxBytes: 4_000, timeoutMs: 55_000, failed: "We couldn't search for that song." });
  if (action === "audio") {
    return proxyUpload(req, "songid/audio", {
      maxMB: MAX_MB,
      timeoutMs: 58_000,
      messages: {
        badBody: "Send the recording as form data.",
        tooBig: `That clip is over ${MAX_MB} MB. A few seconds of singing is plenty.`,
        timeout: "That took too long. Try again with a shorter clip.",
        unreachable: "Couldn't reach the song finder. Try again in a moment.",
        failed: "We couldn't search with that recording.",
      },
    });
  }
  return apiError(404, "Unknown action.");
}
