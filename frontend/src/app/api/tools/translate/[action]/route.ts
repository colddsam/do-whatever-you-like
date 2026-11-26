import type { NextRequest } from "next/server";
import {
  apiError,
  backendConfig,
  directTarget,
  getJson,
  notConfigured,
  passFile,
  postJson,
  proxyUpload,
  upstreamError,
  wantsDirect,
} from "@/lib/backend";

/**
 * Translator endpoints (backend/app/api/v1/endpoints/translate.py):
 *   GET  /api/tools/translate/capabilities         -> supported languages, providers, limits
 *   GET  /api/tools/translate/result?token=...     -> stream translated audio/video (or signed direct target on ?direct=1)
 *   POST /api/tools/translate/text                 -> translate plain text or .srt/.vtt subtitles
 *   POST /api/tools/translate/batch                -> translate an ordered list of cue/segment strings
 *   POST /api/tools/translate/detect               -> which language a snippet is in
 *   POST /api/tools/translate/insights             -> romanisation, alternatives, dictionary, definitions, examples
 *   POST /api/tools/translate/speak                -> read text aloud (audio bytes)
 *   POST /api/tools/translate/media                -> NDJSON streaming upload -> transcribe -> translate -> voiceover/dubbing
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.
const TOKEN_RE = /^[a-f0-9]{32}$/;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/tools/translate/[action]">) {
  const { action } = await ctx.params;

  if (action === "capabilities") {
    return getJson("translate/capabilities", "We couldn't load the translator languages.");
  }

  if (action !== "result") {
    return apiError(404, "Unknown translator action.");
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) {
    return apiError(400, "Invalid download token.");
  }

  if (wantsDirect(req)) {
    const target = directTarget(`translate/result/${token}`, 1024);
    if (!target) {
      return Response.json({ direct: false }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(
      { direct: true, ...target },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const backend = backendConfig();
  if (!backend) return notConfigured();

  let upstream: Response;
  try {
    upstream = await fetch(backend.endpoint(`translate/result/${token}`), {
      headers: { Authorization: `Bearer ${backend.token}` },
      cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(5 * 60_000)]),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return apiError(504, "Downloading the translated file took too long.");
    }
    return apiError(502, "Couldn't reach the translation service. Is the backend running?");
  }

  if (!upstream.ok) {
    return upstreamError(upstream, "The translated file expired. Translate it again to generate a fresh download.");
  }

  return passFile(upstream);
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/translate/[action]">) {
  const { action } = await ctx.params;

  if (action === "text") {
    return postJson(req, "translate/text", {
      maxBytes: 120_000,
      timeoutMs: 90_000,
      failed: "We couldn't translate that text.",
    });
  }

  if (action === "batch") {
    return postJson(req, "translate/batch", {
      maxBytes: 350_000,
      timeoutMs: 120_000,
      failed: "We couldn't translate those lines.",
    });
  }

  if (action === "detect") {
    return postJson(req, "translate/detect", { maxBytes: 20_000, timeoutMs: 30_000, failed: "We couldn't detect that language." });
  }

  if (action === "insights") {
    return postJson(req, "translate/insights", { maxBytes: 10_000, timeoutMs: 30_000, failed: "Word details aren't available right now." });
  }

  if (action === "speak") {
    const backend = backendConfig();
    if (!backend) return notConfigured();
    const body = await req.text().catch(() => "");
    if (!body) return apiError(400, "Send the text to read as JSON.");
    if (body.length > 20_000) return apiError(413, "That's too much text to read aloud at once.");
    let upstream: Response;
    try {
      upstream = await fetch(backend.endpoint("translate/speak"), {
        method: "POST",
        headers: { Authorization: `Bearer ${backend.token}`, "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]),
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      return apiError(timedOut ? 504 : 502, timedOut ? "Reading aloud took too long." : "Couldn't reach the voice service.");
    }
    if (!upstream.ok) return upstreamError(upstream, "No voice is available for that language right now.");
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store",
        "X-TTS-Engine": upstream.headers.get("x-tts-engine") ?? "",
      },
    });
  }

  if (action === "media") {
    return proxyUpload(req, "translate/media", {
      maxMB: MAX_MB,
      timeoutMs: 3 * 60 * 60_000,
      messages: {
        badBody: "Send the audio or video file as form data.",
        tooBig: `That file is over ${MAX_MB} MB.`,
        timeout: "That took too long. Try a shorter recording.",
        unreachable: "Couldn't reach the translation service. Is the backend running?",
        failed: "We couldn't translate that recording.",
      },
    });
  }

  return apiError(404, "Unknown translator action.");
}
