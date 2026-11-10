import type { NextRequest } from "next/server";
import { apiError, proxyUpload } from "@/lib/backend";

/**
 * PDF toolkit. The workspace uploads each PDF once (`upload` → a token), then every estimate
 * and action sends tokens instead of the file. Merge/split/compress still accept files too.
 * Bodies are streamed to FastAPI untouched; the backend validates fields and files.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.
const SMALL_MB = 1; // Token-only requests are a few bytes of form data.

const ACTIONS = {
  upload: { path: "pdf/upload", maxMB: MAX_MB, failed: "We couldn't read that PDF." },
  merge: { path: "pdf/merge", maxMB: MAX_MB, failed: "We couldn't merge those PDFs." },
  split: { path: "pdf/split", maxMB: MAX_MB, failed: "We couldn't split that PDF." },
  compress: { path: "pdf/compress", maxMB: MAX_MB, failed: "We couldn't compress that PDF." },
  "merge-estimate": { path: "pdf/merge/estimate", maxMB: SMALL_MB, failed: "We couldn't work out the merged size." },
  "split-estimate": { path: "pdf/split/estimate", maxMB: SMALL_MB, failed: "We couldn't work out the split." },
  "compress-estimate": { path: "pdf/compress/estimate", maxMB: SMALL_MB, failed: "We couldn't work out the compressed size." },
} as const;

type Action = keyof typeof ACTIONS;
const isAction = (v: string): v is Action => Object.hasOwn(ACTIONS, v);

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/pdf/[action]">) {
  const { action } = await ctx.params;
  if (!isAction(action)) return apiError(404, "Unknown PDF tool.");
  const cfg = ACTIONS[action];

  return proxyUpload(req, cfg.path, {
    maxMB: cfg.maxMB,
    timeoutMs: 5 * 60_000,
    messages: {
      badBody: "Send the PDF as form data.",
      tooBig:
        action === "merge"
          ? `Those PDFs add up to more than ${MAX_MB} MB. Merge them in smaller batches.`
          : `That PDF is over ${MAX_MB} MB.`,
      timeout: "That took too long. Try a smaller PDF.",
      unreachable: "Couldn't reach the PDF service. Is the backend running?",
      failed: cfg.failed,
    },
  });
}
