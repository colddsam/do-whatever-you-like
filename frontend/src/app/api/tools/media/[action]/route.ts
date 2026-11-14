import type { NextRequest } from "next/server";
import { apiError, proxyUpload } from "@/lib/backend";

/**
 * Audio and video edits (backend/app/api/v1/endpoints/media.py).
 * POST /api/tools/media/trim  → `file` + `start`, `end` (seconds) + `exact`
 * POST /api/tools/media/sound → `file` + `mode` (volume | normalize | mute) + `gain_db`
 * POST /api/tools/media/denoise → `file` + `strength`, `voice`, `hum`, `clicks` (+ `noise_start`, `noise_end`)
 * In production the browser sends the file straight to the backend with a ticket (lib/backend.ts).
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/media/[action]">) {
  const { action } = await ctx.params;
  if (action !== "trim" && action !== "sound" && action !== "denoise") return apiError(404, "Unknown action.");
  return proxyUpload(req, `media/${action}`, {
    maxMB: MAX_MB,
    timeoutMs: 16 * 60_000,
    messages: {
      badBody: "Send the file as form data.",
      tooBig: `That file is over ${MAX_MB} MB.`,
      timeout: "That took too long. Try a shorter file.",
      unreachable: "Couldn't reach the media service. Is the backend running?",
      failed: action === "trim" ? "We couldn't cut that file." : action === "denoise" ? "We couldn't clean the sound of that file." : "We couldn't change the sound of that file.",
    },
  });
}
