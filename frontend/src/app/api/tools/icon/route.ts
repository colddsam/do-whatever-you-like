import type { NextRequest } from "next/server";
import { proxyUpload } from "@/lib/backend";

/**
 * Icon maker (backend/app/api/v1/endpoints/icon.py).
 * POST /api/tools/icon → `file` (a picture) + `options` (JSON) in, a ZIP of icon packs or one .ico back.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

export async function POST(req: NextRequest) {
  return proxyUpload(req, "icon", {
    maxMB: MAX_MB,
    timeoutMs: 4 * 60_000,
    messages: {
      badBody: "Send the picture as form data.",
      tooBig: `That picture is over ${MAX_MB} MB.`,
      timeout: "That took too long. Try a smaller picture.",
      unreachable: "Couldn't reach the icon service. Is the backend running?",
      failed: "We couldn't make icons from that picture.",
    },
  });
}
