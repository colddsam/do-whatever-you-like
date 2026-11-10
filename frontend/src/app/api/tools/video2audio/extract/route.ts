import type { NextRequest } from "next/server";
import { proxyUpload } from "@/lib/backend";

/**
 * Video → MP3. The browser posts the video as multipart form data; we stream that body
 * straight to FastAPI (never buffering a 150 MB upload here) and stream the MP3 back.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

export function POST(req: NextRequest) {
  return proxyUpload(req, "video2audio/extract", {
    maxMB: MAX_MB,
    messages: {
      badBody: "Send the video as form data in a `file` field.",
      tooBig: `That video is over ${MAX_MB} MB. Try a shorter or smaller file.`,
      timeout: "That took too long. Try a shorter video.",
      unreachable: "Couldn't reach the audio service. Is the backend running?",
      failed: "We couldn't pull the audio out of that video.",
    },
  });
}
