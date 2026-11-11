import type { NextRequest } from "next/server";
import { apiError, getJson, proxyUpload } from "@/lib/backend";

/**
 * Document conversion (backend/app/api/v1/endpoints/convert.py): Office/HTML/web page → PDF and
 * PDF → Word/PowerPoint/Excel. PDF inputs send a token from /api/tools/pdf/upload.
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

const ACTIONS = {
  "office-to-pdf": { path: "convert/office-to-pdf", failed: "We couldn't convert that document." },
  "html-to-pdf": { path: "convert/html-to-pdf", failed: "We couldn't turn that page into a PDF." },
  "pdf-to-word": { path: "convert/pdf-to-word", failed: "We couldn't turn that PDF into a Word document." },
  "pdf-to-powerpoint": { path: "convert/pdf-to-powerpoint", failed: "We couldn't turn that PDF into slides." },
  "pdf-to-excel": { path: "convert/pdf-to-excel", failed: "We couldn't turn that PDF into a spreadsheet." },
} as const;

type Action = keyof typeof ACTIONS;
const isAction = (v: string): v is Action => Object.hasOwn(ACTIONS, v);

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/convert/[action]">) {
  const { action } = await ctx.params;
  if (!isAction(action)) return apiError(404, "Unknown conversion.");
  const cfg = ACTIONS[action];
  return proxyUpload(req, cfg.path, {
    maxMB: MAX_MB,
    timeoutMs: 10 * 60_000,
    messages: {
      badBody: "Send the document as form data.",
      tooBig: `That file is over ${MAX_MB} MB.`,
      timeout: "That took too long. Try a smaller file.",
      unreachable: "Couldn't reach the conversion service. Is the backend running?",
      failed: cfg.failed,
    },
  });
}

/** GET /api/tools/convert/capabilities → which converters this server has (Office, web, OCR, PDF/A). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tools/convert/[action]">) {
  const { action } = await ctx.params;
  if (action !== "capabilities") return apiError(404, "Unknown conversion.");
  return getJson("convert/capabilities", "We couldn't check the converters.");
}
