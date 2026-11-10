import type { NextRequest } from "next/server";
import { proxyUpload } from "@/lib/backend";

/**
 * QR generator. Every request (live previews and the final file) goes to the backend's
 * multipart endpoint, which takes all the style options plus an optional centre logo.
 * The body is streamed through untouched; the backend validates every field.
 */

const MAX_MB = 10; // Matches MAX_LOGO_SIZE_MB in backend/app/config/qrcode.py.

export function POST(req: NextRequest) {
  return proxyUpload(req, "qrcode/generate-with-logo", {
    maxMB: MAX_MB,
    timeoutMs: 60_000,
    messages: {
      badBody: "Send the QR details as form data.",
      tooBig: `That logo is over ${MAX_MB} MB. Try a smaller image.`,
      timeout: "That took too long. Try a smaller module size.",
      unreachable: "Couldn't reach the QR service. Is the backend running?",
      failed: "We couldn't make that QR code.",
    },
  });
}
