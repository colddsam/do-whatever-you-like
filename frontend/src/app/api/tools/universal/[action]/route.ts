import type { NextRequest } from "next/server";
import { apiError, getJson, proxyUpload } from "@/lib/backend";

/**
 * Universal converter (backend/app/api/v1/endpoints/universal.py).
 * POST /api/tools/universal/convert → `file` + `target` (a format id) in, the converted file back.
 *   In production the browser sends the file straight to the backend with a ticket (lib/backend.ts).
 * GET  /api/tools/universal/formats → every format and every route the live server can run.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/universal/[action]">) {
  const { action } = await ctx.params;
  if (action !== "convert") return apiError(404, "Unknown converter action.");
  return proxyUpload(req, "universal/convert", {
    maxMB: MAX_MB,
    // Re-encoding a long video on a small server takes a while (the backend stops at 15 minutes).
    timeoutMs: 16 * 60_000,
    messages: {
      badBody: "Send the file as form data.",
      tooBig: `That file is over ${MAX_MB} MB.`,
      timeout: "That took too long. Try a smaller file.",
      unreachable: "Couldn't reach the conversion service. Is the backend running?",
      failed: "We couldn't convert that file.",
    },
  });
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tools/universal/[action]">) {
  const { action } = await ctx.params;
  if (action !== "formats") return apiError(404, "Unknown converter action.");
  return getJson("universal/formats", "We couldn't load the list of formats.");
}
