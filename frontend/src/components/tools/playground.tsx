"use client";

import type { ComponentType } from "react";
import { getTool, type ToolKind } from "@/lib/tools";
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
  PageNumbersTool,
  PdfaTool,
  ProtectTool,
  RepairTool,
  UnlockTool,
  WatermarkTool,
} from "./pdf/simple-tools";
import { QrPlayground } from "./qr-playground";
import { BlurFaceTool } from "./image/blur-tool";
import { CropImageTool } from "./image/crop-tool";
import { HtmlToImageTool } from "./image/html-tool";
import { MemeGeneratorTool } from "./image/meme-tool";
import { PhotoEditorTool } from "./image/photo-editor";
import {
  CompressImageTool,
  ConvertFromJpgTool,
  ConvertToJpgTool,
  RemoveBackgroundTool,
  ResizeImageTool,
  RotateImageTool,
  UpscaleImageTool,
} from "./image/simple-tools";
import { ImageStudio } from "./image/studio";
import { WatermarkImageTool } from "./image/watermark-tool";
import { TranscribePlayground } from "./transcribe/transcribe-playground";
import { UniversalConverter } from "./universal/universal-converter";
import { CompressFilesTool } from "./files/compress-tool";
import { MergeFilesTool } from "./files/merge-tool";
import { SplitFilesTool } from "./files/split-tool";
import { IconMakerTool } from "./image/icon-tool";
import { DevUtilities } from "./dev/dev-utilities";
import { ScanTool } from "./pdf/scan/scan-tool";
import { FontChecker } from "./design/font-checker";
import { ColorPicker } from "./design/color-picker";
import { FontCreator } from "./design/font-creator";
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
 * - any tool with a `preset` (PDF to Word, Word to PDF, Video to MP3…) → UniversalConverter with the pair fixed
 * - pdf (by id) → PdfPlayground (merge, split, organize and compress behind one mode switch)
 * - the PDF family (by id) → single-purpose workspaces in components/tools/pdf/: most run in
 *   PdfTask (one input, options, one action, a result to check); merge/split/organize/compress,
 *   rotate, remove and extract reuse PdfPlayground on a fixed mode
 * - qr (by id) → QrPlayground (nine kinds of content, live preview, styling and a centre logo)
 * - audio-to-text (by id) → TranscribePlayground (upload or record, live transcript, read-along, export)
 * - convert-anything (by id) → UniversalConverter (any file in, a format picked from every route the server can run)
 * - compress-files, merge-files, split-files (by id) → components/tools/files/ (any kind of file, one engine per format)
 * - the image family (by id) → components/tools/image/: most run in ImageTask (images in, options,
 *   one action, a result to compare); crop and blur draw on the image; meme and photo editor run
 *   in the browser; image (the home-page hub) → ImageStudio, four of them behind a mode switch
 *
 * Anything not registered shows its kind's preview in SoonWorkspace.
 */
const byKind: Partial<Record<ToolKind, Workspace>> = {
  link: DownloaderPlayground,
};
const byId: Record<string, Workspace> = {
  pdf: PdfPlayground,
  qr: QrPlayground,
  "audio-to-text": TranscribePlayground,
  "convert-anything": UniversalConverter,
  dev: DevUtilities,
  "font-checker": FontChecker,
  "color-picker": ColorPicker,
  "font-creator": FontCreator,
  "compress-files": CompressFilesTool,
  "merge-files": MergeFilesTool,
  "split-files": SplitFilesTool,
  // PDF family: organize
  "merge-pdf": (p) => <PdfPlayground {...p} mode="merge" />,
  "split-pdf": (p) => <PdfPlayground {...p} mode="split" />,
  "remove-pages": (p) => <PdfPlayground {...p} mode="organize" />,
  "extract-pages": (p) => <PdfPlayground {...p} mode="split" chosenPages />,
  "organize-pdf": (p) => <PdfPlayground {...p} mode="organize" />,
  "scan-to-pdf": ScanTool,
  // optimize
  "compress-pdf": (p) => <PdfPlayground {...p} mode="compress" />,
  "repair-pdf": RepairTool,
  "ocr-pdf": OcrTool,
  "pdf-to-pdfa": PdfaTool,
  // convert to PDF
  "jpg-to-pdf": ImagesToPdfTool,
  "html-to-pdf": HtmlToPdfTool,
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
  // Image family
  image: ImageStudio,
  "compress-image": CompressImageTool,
  "upscale-image": UpscaleImageTool,
  "remove-background": RemoveBackgroundTool,
  "meme-generator": MemeGeneratorTool,
  "photo-editor": PhotoEditorTool,
  "resize-image": ResizeImageTool,
  "crop-image": CropImageTool,
  "rotate-image": RotateImageTool,
  "convert-to-jpg": ConvertToJpgTool,
  "jpg-to-image": ConvertFromJpgTool,
  "html-to-image": HtmlToImageTool,
  "icon-maker": IconMakerTool,
  "watermark-image": WatermarkImageTool,
  "blur-face": BlurFaceTool,
};

export function Playground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const Live = tool.status === "live" ? (byId[tool.id] ?? (tool.preset ? UniversalConverter : byKind[tool.kind])) : undefined;
  return Live ? <Live toolId={toolId} /> : <SoonWorkspace toolId={toolId} />;
}
