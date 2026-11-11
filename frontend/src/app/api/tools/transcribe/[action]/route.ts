import type { NextRequest } from "next/server";
import { apiError, getJson, proxyUpload } from "@/lib/backend";

/**
 * Speech to text (backend/app/api/v1/endpoints/transcribe.py).
 * POST /api/tools/transcribe/run → the audio goes in, NDJSON events stream back line by line
 * (the body is streamed both ways, never buffered here). In production the browser sends the
 * file straight to the backend with a ticket instead (see `directTarget` in lib/backend.ts).
 * GET /api/tools/transcribe/capabilities → which engine the server uses, and its limits.
 */

const MAX_MB = 150; // Matches TRANSCRIBE_MAX_FILE_MB in backend/app/config/transcribe.py.

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/transcribe/[action]">) {
  const { action } = await ctx.params;
  if (action !== "run") return apiError(404, "Unknown speech tool.");
  return proxyUpload(req, "transcribe", {
    maxMB: MAX_MB,
    // A long recording on a slow CPU can take a while; the stream keeps the connection busy.
    timeoutMs: 3 * 60 * 60_000,
    messages: {
      badBody: "Send the recording as form data.",
      tooBig: `That file is over ${MAX_MB} MB.`,
      timeout: "That took too long. Try a shorter recording.",
      unreachable: "Couldn't reach the speech service. Is the backend running?",
      failed: "We couldn't transcribe that recording.",
    },
  });
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tools/transcribe/[action]">) {
  const { action } = await ctx.params;
  if (action !== "capabilities") return apiError(404, "Unknown speech tool.");
  return getJson("transcribe/capabilities", "We couldn't check the speech service.");
}
