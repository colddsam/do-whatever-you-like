import type { NextRequest } from "next/server";
import { apiError, backendConfig, notConfigured, passFile, upstreamError } from "@/lib/backend";

/**
 * Video → MP3. The browser posts the video as multipart form data; we stream that body
 * straight to FastAPI (never buffering a 150 MB upload here) and stream the MP3 back.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.
const TIMEOUT_MS = 10 * 60_000;

export async function POST(req: NextRequest) {
  const backend = backendConfig();
  if (!backend) return notConfigured();

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data") || !req.body) {
    return apiError(400, "Send the video as form data in a `file` field.");
  }
  const length = Number(req.headers.get("content-length")) || 0;
  // A little headroom for the multipart boundaries around the file.
  if (length > (MAX_MB + 1) * 1024 * 1024) {
    return apiError(413, `That video is over ${MAX_MB} MB. Try a shorter or smaller file.`);
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${backend.token}`, "Content-Type": type };
  if (length) headers["Content-Length"] = String(length);

  let upstream: Response;
  try {
    upstream = await fetch(backend.endpoint("video2audio/extract"), {
      method: "POST",
      headers,
      body: req.body,
      // Required by Node's fetch to send a streamed body.
      duplex: "half",
      cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    } as RequestInit & { duplex: "half" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return apiError(504, "That took too long. Try a shorter video.");
    }
    return apiError(502, "Couldn't reach the audio service. Is the backend running?");
  }

  if (!upstream.ok) return upstreamError(upstream, "We couldn't pull the audio out of that video.");
  return passFile(upstream);
}
