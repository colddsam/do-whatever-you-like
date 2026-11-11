import type { NextRequest } from "next/server";
import { apiError, getJson, proxyUpload } from "@/lib/backend";

/**
 * Image tools (backend/app/api/v1/endpoints/image.py). Bodies stream to FastAPI untouched; in
 * production the browser sends them straight to the backend with a ticket (lib/backend.ts).
 * Meme generator and photo editor run in the browser and never come here.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

const ACTIONS = {
  compress: { path: "image/compress", failed: "We couldn't compress those images." },
  resize: { path: "image/resize", failed: "We couldn't resize those images." },
  crop: { path: "image/crop", failed: "We couldn't crop that image." },
  convert: { path: "image/convert", failed: "We couldn't convert those images." },
  gif: { path: "image/gif", failed: "We couldn't make the GIF." },
  rotate: { path: "image/rotate", failed: "We couldn't rotate those images." },
  watermark: { path: "image/watermark", failed: "We couldn't add the watermark." },
  faces: { path: "image/faces", failed: "We couldn't look for faces." },
  blur: { path: "image/blur", failed: "We couldn't blur that image." },
  "remove-background": { path: "image/remove-background", failed: "We couldn't remove the background." },
  upscale: { path: "image/upscale", failed: "We couldn't upscale that image." },
  html: { path: "image/html", failed: "We couldn't capture that page." },
} as const;

type Action = keyof typeof ACTIONS;
const isAction = (v: string): v is Action => Object.hasOwn(ACTIONS, v);

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/image/[action]">) {
  const { action } = await ctx.params;
  if (!isAction(action)) return apiError(404, "Unknown image tool.");
  const cfg = ACTIONS[action];
  return proxyUpload(req, cfg.path, {
    maxMB: MAX_MB,
    timeoutMs: 5 * 60_000,
    messages: {
      badBody: "Send the images as form data.",
      tooBig: `Those images add up to more than ${MAX_MB} MB. Send fewer or smaller ones.`,
      timeout: "That took too long. Try a smaller image, or fewer at once.",
      unreachable: "Couldn't reach the image service. Is the backend running?",
      failed: cfg.failed,
    },
  });
}

/** GET /api/tools/image/capabilities → which formats and AI tools the server has. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tools/image/[action]">) {
  const { action } = await ctx.params;
  if (action !== "capabilities") return apiError(404, "Unknown image tool.");
  return getJson("image/capabilities", "We couldn't check the image tools.");
}
