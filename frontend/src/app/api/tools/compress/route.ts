import type { NextRequest } from "next/server";
import { proxyUpload } from "@/lib/backend";

/**
 * Compress any file (backend/app/api/v1/endpoints/compress.py).
 * POST /api/tools/compress → `files` (1 to 20) + `level` in; one file, or a ZIP of several, back.
 * In production the browser sends the files straight to the backend with a ticket (lib/backend.ts).
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

export async function POST(req: NextRequest) {
  return proxyUpload(req, "compress", {
    maxMB: MAX_MB,
    // Re-encoding a long video on a small server takes a while (the backend stops at 15 minutes).
    timeoutMs: 16 * 60_000,
    messages: {
      badBody: "Send the files as form data.",
      tooBig: `Together the files are over ${MAX_MB} MB.`,
      timeout: "That took too long. Try fewer or smaller files.",
      unreachable: "Couldn't reach the compression service. Is the backend running?",
      failed: "We couldn't compress those files.",
    },
  });
}
