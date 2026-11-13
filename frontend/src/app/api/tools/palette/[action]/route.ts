import type { NextRequest } from "next/server";
import { apiError, proxyUpload } from "@/lib/backend";

/**
 * Colour picker (backend/app/api/v1/endpoints/palette.py).
 * POST /api/tools/palette/extract → any file in; pictures of it and the exact colours it declares back (JSON).
 * Pictures the browser can open itself never leave the device.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/palette/[action]">) {
  const { action } = await ctx.params;
  if (action !== "extract") return apiError(404, "Unknown action.");
  return proxyUpload(req, "palette/extract", {
    maxMB: MAX_MB,
    timeoutMs: 6 * 60_000,
    messages: {
      badBody: "Send the file as form data.",
      tooBig: `That file is over ${MAX_MB} MB.`,
      timeout: "That took too long. Try a smaller file.",
      unreachable: "Couldn't reach the colour service. Is the backend running?",
      failed: "We couldn't read colours from that file.",
    },
  });
}
