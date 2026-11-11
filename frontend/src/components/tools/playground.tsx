"use client";

import type { ComponentType } from "react";
import { getTool, type ToolKind } from "@/lib/tools";
import { ConvertPlayground } from "./convert-playground";
import { DownloaderPlayground } from "./downloader-playground";
import { PdfPlayground } from "./pdf-playground";
import { CompareTool } from "./pdf/compare-tool";
import { CropTool } from "./pdf/crop-tool";
import { EditTool } from "./pdf/edit-tool";
import { HtmlToPdfTool } from "./pdf/html-tool";
import { ImagesToPdfTool } from "./pdf/images-tool";
import { RedactTool } from "./pdf/redact-tool";
import {
  OcrTool,
  OfficeToPdfTool,
  PageNumbersTool,
  PdfaTool,
  PdfToImagesTool,
  PdfToOfficeTool,
  ProtectTool,
  RepairTool,
  UnlockTool,
  WatermarkTool,
} from "./pdf/simple-tools";
import { QrPlayground } from "./qr-playground";
import { SoonWorkspace } from "./soon-workspace";

type Workspace = ComponentType<{ toolId: string }>;

/**
 * Where a live tool's workspace comes from.
 *
 * Adding an integration:
 * 1. Add the tool to `lib/tools.ts` with its `kind`, `takes`/`gives` and (optionally) `steps`.
 * 2. If its kind already has a workspace here, flip it to `live` and you're done.
 *    Otherwise build one inside `<Workbench>` and register it below, by kind or by id.
 *
 * Built-in workspaces and the config they read:
 * - link → DownloaderPlayground (`downloader`)
 * - file → ConvertPlayground (`converter`: one file in, one file out)
 * - pdf (by id) → PdfPlayground (merge, split, organize and compress behind one mode switch)
 * - the PDF family (by id) → single-purpose workspaces in components/tools/pdf/: most run in
 *   PdfTask (one input, options, one action, a result to check); merge/split/organize/compress,
 *   rotate, remove and extract reuse PdfPlayground on a fixed mode
 * - qr (by id) → QrPlayground (nine kinds of content, live preview, styling and a centre logo)
 *
 * Anything not registered shows its kind's preview in SoonWorkspace.
 */
const byKind: Partial<Record<ToolKind, Workspace>> = {
  link: DownloaderPlayground,
  file: ConvertPlayground,
};
const byId: Record<string, Workspace> = {
  pdf: PdfPlayground,
  qr: QrPlayground,
  // PDF family: organize
  "merge-pdf": (p) => <PdfPlayground {...p} mode="merge" />,
  "split-pdf": (p) => <PdfPlayground {...p} mode="split" />,
  "remove-pages": (p) => <PdfPlayground {...p} mode="organize" />,
  "extract-pages": (p) => <PdfPlayground {...p} mode="split" chosenPages />,
  "organize-pdf": (p) => <PdfPlayground {...p} mode="organize" />,
  "scan-to-pdf": (p) => <ImagesToPdfTool {...p} scan />,
  // optimize
  "compress-pdf": (p) => <PdfPlayground {...p} mode="compress" />,
  "repair-pdf": RepairTool,
  "ocr-pdf": OcrTool,
  // convert to PDF
  "jpg-to-pdf": ImagesToPdfTool,
  "word-to-pdf": (p) => <OfficeToPdfTool {...p} kind="word" />,
  "powerpoint-to-pdf": (p) => <OfficeToPdfTool {...p} kind="powerpoint" />,
  "excel-to-pdf": (p) => <OfficeToPdfTool {...p} kind="excel" />,
  "html-to-pdf": HtmlToPdfTool,
  // convert from PDF
  "pdf-to-jpg": PdfToImagesTool,
  "pdf-to-word": (p) => <PdfToOfficeTool {...p} kind="word" />,
  "pdf-to-powerpoint": (p) => <PdfToOfficeTool {...p} kind="powerpoint" />,
  "pdf-to-excel": (p) => <PdfToOfficeTool {...p} kind="excel" />,
  "pdf-to-pdfa": PdfaTool,
  // edit
  "rotate-pdf": (p) => <PdfPlayground {...p} mode="organize" />,
  "page-numbers": PageNumbersTool,
  "watermark-pdf": WatermarkTool,
  "crop-pdf": CropTool,
  "edit-pdf": EditTool,
  // security
  "unlock-pdf": UnlockTool,
  "protect-pdf": ProtectTool,
  "sign-pdf": (p) => <EditTool {...p} sign />,
  "redact-pdf": RedactTool,
  "compare-pdf": CompareTool,
};

export function Playground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const Live = tool.status === "live" ? (byId[tool.id] ?? byKind[tool.kind]) : undefined;
  // A kind's shared workspace needs that kind's config; without it, fall back to the preview.
  if (Live && !byId[tool.id] && tool.kind === "file" && !tool.converter) return <SoonWorkspace toolId={toolId} />;
  return Live ? <Live toolId={toolId} /> : <SoonWorkspace toolId={toolId} />;
}
