import type { NextRequest } from "next/server";
import { apiError, backendConfig, directTarget, getJson, notConfigured, passFile, postJson, upstreamError, wantsDirect } from "@/lib/backend";

/**
 * The video editor's server helpers (backend/app/api/v1/endpoints/studio.py). The editor itself runs
 * in the browser; nothing here ever sees the user's media.
 *
 * GET  /api/tools/studio/proxy?url=…   an allowlisted public file (Google Fonts, free stock media)
 *      ?direct=1 asks for a signed ticket instead, so big files go browser → backend directly
 *      (Vercel caps what a route can pass through)
 * GET  /api/tools/studio/capabilities  which free AI the AI Director has: Gemini, Groq or none
 * POST /api/tools/studio/director      a request plus a timeline summary → timeline operations
 * POST /api/tools/studio/tts           text → speech (MP3 as base64) with word timings, free Edge voices
 */

export const maxDuration = 60;

const PROXY_MAX_BYTES = 200 * 1024 * 1024;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/tools/studio/[action]">) {
  const { action } = await ctx.params;
  if (action === "capabilities") return getJson("studio/capabilities", "Couldn't check the AI Director.");
  if (action !== "proxy") return apiError(404, "Unknown action.");
  if (wantsDirect(req)) {
    return Response.json(directTarget("studio/proxy", PROXY_MAX_BYTES) ?? { direct: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const url = req.nextUrl.searchParams.get("url") ?? "";
  if (!url || url.length > 2048) return apiError(400, "Give the file's full address.");
  const backend = backendConfig();
  if (!backend) return notConfigured();
  let upstream: Response;
  try {
    upstream = await fetch(`${backend.endpoint("studio/proxy")}?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${backend.token}` },
      cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(55_000)]),
    });
  } catch {
    return apiError(502, "Couldn't reach the tool service. Is the backend running?");
  }
  if (!upstream.ok) return upstreamError(upstream, "That file couldn't be fetched.");
  return passFile(upstream);
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/studio/[action]">) {
  const { action } = await ctx.params;
  if (action === "tts") return postJson(req, "studio/tts", { maxBytes: 20_000, timeoutMs: 55_000, failed: "The voice-over couldn't be made." });
  if (action !== "director") return apiError(404, "Unknown action.");
  return postJson(req, "studio/director", { maxBytes: 200_000, timeoutMs: 50_000, failed: "The AI Director couldn't plan that." });
}
