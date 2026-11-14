"use client";

import type { ComponentType } from "react";
import { getTool, type ToolKind } from "@/lib/tools";
import dynamic from "next/dynamic";
import { getUtility } from "@/lib/utilities/catalog";

/**
 * Each workspace is its own chunk, so a tool page downloads only the code for its tool (the PDF,
 * image and converter workspaces pull in heavy libraries). Pages are still rendered on the server;
 * `loading` only shows during client-side navigation, at the workbench's usual height.
 */
const loading = () => <div aria-hidden className="h-80 animate-pulse rounded-lg border border-line bg-surface" />;
const DownloaderPlayground = dynamic(() => import("./downloader-playground").then((m) => m.DownloaderPlayground), { loading });
const PdfPlayground = dynamic(() => import("./pdf-playground").then((m) => m.PdfPlayground), { loading });
const CompareTool = dynamic(() => import("./pdf/compare-tool").then((m) => m.CompareTool), { loading });
const CropTool = dynamic(() => import("./pdf/crop-tool").then((m) => m.CropTool), { loading });
const EditTool = dynamic(() => import("./pdf/edit-tool").then((m) => m.EditTool), { loading });
const HtmlToPdfTool = dynamic(() => import("./pdf/html-tool").then((m) => m.HtmlToPdfTool), { loading });
const ImagesToPdfTool = dynamic(() => import("./pdf/images-tool").then((m) => m.ImagesToPdfTool), { loading });
const RedactTool = dynamic(() => import("./pdf/redact-tool").then((m) => m.RedactTool), { loading });
const OcrTool = dynamic(() => import("./pdf/simple-tools").then((m) => m.OcrTool), { loading });
const PageNumbersTool = dynamic(() => import("./pdf/simple-tools").then((m) => m.PageNumbersTool), { loading });
const PdfaTool = dynamic(() => import("./pdf/simple-tools").then((m) => m.PdfaTool), { loading });
const ProtectTool = dynamic(() => import("./pdf/simple-tools").then((m) => m.ProtectTool), { loading });
const RepairTool = dynamic(() => import("./pdf/simple-tools").then((m) => m.RepairTool), { loading });
const UnlockTool = dynamic(() => import("./pdf/simple-tools").then((m) => m.UnlockTool), { loading });
const WatermarkTool = dynamic(() => import("./pdf/simple-tools").then((m) => m.WatermarkTool), { loading });
const QrPlayground = dynamic(() => import("./qr-playground").then((m) => m.QrPlayground), { loading });
const BlurFaceTool = dynamic(() => import("./image/blur-tool").then((m) => m.BlurFaceTool), { loading });
const CropImageTool = dynamic(() => import("./image/crop-tool").then((m) => m.CropImageTool), { loading });
const HtmlToImageTool = dynamic(() => import("./image/html-tool").then((m) => m.HtmlToImageTool), { loading });
const MemeGeneratorTool = dynamic(() => import("./image/meme-tool").then((m) => m.MemeGeneratorTool), { loading });
const PhotoEditorTool = dynamic(() => import("./image/photo-editor").then((m) => m.PhotoEditorTool), { loading });
const CompressImageTool = dynamic(() => import("./image/simple-tools").then((m) => m.CompressImageTool), { loading });
const ConvertFromJpgTool = dynamic(() => import("./image/simple-tools").then((m) => m.ConvertFromJpgTool), { loading });
const ConvertToJpgTool = dynamic(() => import("./image/simple-tools").then((m) => m.ConvertToJpgTool), { loading });
const RemoveBackgroundTool = dynamic(() => import("./image/simple-tools").then((m) => m.RemoveBackgroundTool), { loading });
const ResizeImageTool = dynamic(() => import("./image/simple-tools").then((m) => m.ResizeImageTool), { loading });
const RotateImageTool = dynamic(() => import("./image/simple-tools").then((m) => m.RotateImageTool), { loading });
const UpscaleImageTool = dynamic(() => import("./image/simple-tools").then((m) => m.UpscaleImageTool), { loading });
const ImageStudio = dynamic(() => import("./image/studio").then((m) => m.ImageStudio), { loading });
const WatermarkImageTool = dynamic(() => import("./image/watermark-tool").then((m) => m.WatermarkImageTool), { loading });
const TranscribePlayground = dynamic(() => import("./transcribe/transcribe-playground").then((m) => m.TranscribePlayground), { loading });
const UniversalConverter = dynamic(() => import("./universal/universal-converter").then((m) => m.UniversalConverter), { loading });
const CompressFilesTool = dynamic(() => import("./files/compress-tool").then((m) => m.CompressFilesTool), { loading });
const MergeFilesTool = dynamic(() => import("./files/merge-tool").then((m) => m.MergeFilesTool), { loading });
const SplitFilesTool = dynamic(() => import("./files/split-tool").then((m) => m.SplitFilesTool), { loading });
const IconMakerTool = dynamic(() => import("./image/icon-tool").then((m) => m.IconMakerTool), { loading });
const DevUtilities = dynamic(() => import("./dev/dev-utilities").then((m) => m.DevUtilities), { loading });
const ScanTool = dynamic(() => import("./pdf/scan/scan-tool").then((m) => m.ScanTool), { loading });
const FontChecker = dynamic(() => import("./design/font-checker").then((m) => m.FontChecker), { loading });
const ColorPicker = dynamic(() => import("./design/color-picker").then((m) => m.ColorPicker), { loading });
const FontCreator = dynamic(() => import("./design/font-creator").then((m) => m.FontCreator), { loading });
const ChartMaker = dynamic(() => import("./design/chart-maker").then((m) => m.ChartMaker), { loading });
const FlowchartMaker = dynamic(() => import("./design/flowchart-maker").then((m) => m.FlowchartMaker), { loading });
const SoonWorkspace = dynamic(() => import("./soon-workspace").then((m) => m.SoonWorkspace), { loading });
const UtilityTool = dynamic(() => import("./utilities/utility-tool").then((m) => m.UtilityTool), { loading });
const VideoFramesTool = dynamic(() => import("./media/video-frames-tool").then((m) => m.VideoFramesTool), { loading });
const VideoGifTool = dynamic(() => import("./media/video-gif-tool").then((m) => m.VideoGifTool), { loading });
const GifSpeedTool = dynamic(() => import("./image/gif-speed-tool").then((m) => m.GifSpeedTool), { loading });
const PixelateTool = dynamic(() => import("./image/pixelate-tool").then((m) => m.PixelateTool), { loading });
const EmojiTool = dynamic(() => import("./image/emoji-tool").then((m) => m.EmojiTool), { loading });
const TrimMediaTool = dynamic(() => import("./media/media-edit-tools").then((m) => m.TrimMediaTool), { loading });
const SoundTool = dynamic(() => import("./media/media-edit-tools").then((m) => m.SoundTool), { loading });
const DenoiseTool = dynamic(() => import("./media/media-edit-tools").then((m) => m.DenoiseTool), { loading });
const RecorderTool = dynamic(() => import("./media/recorder-tool").then((m) => m.RecorderTool), { loading });
const SubtitleTool = dynamic(() => import("./media/subtitle-tool").then((m) => m.SubtitleTool), { loading });

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
 * - the Developer, Text and Everyday utilities (lib/utilities/catalog.ts) → UtilityTool: one engine
 *   per job (format, hash, random, network…) with the page's preset as its starting state
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
  "chart-maker": ChartMaker,
  "flowchart-maker": FlowchartMaker,
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
  image: () => <ImageStudio />,
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
  "pixelate-image": PixelateTool,
  "gif-speed": GifSpeedTool,
  "emoji-to-image": EmojiTool,
  // Audio & video, made in the browser
  "video-to-frames": VideoFramesTool,
  "video-to-gif": VideoGifTool,
  // Audio & video, edited on our server (trim, volume) or in the browser (recorder, subtitles)
  "trim-media": TrimMediaTool,
  "audio-volume": SoundTool,
  "noise-remover": DenoiseTool,
  "screen-recorder": RecorderTool,
  "subtitle-editor": SubtitleTool,
};

/** A standalone page for one tab of the developer hub (JSON formatter, JWT decoder…). */
function DevTabPage({ toolId }: { toolId: string }) {
  return <DevUtilities toolId={toolId} start={getTool(toolId)?.devTab} />;
}

export function Playground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const Live =
    tool.status === "live"
      ? (byId[tool.id] ?? (tool.devTab ? DevTabPage : getUtility(tool.id) ? UtilityTool : tool.preset ? UniversalConverter : byKind[tool.kind]))
      : undefined;
  return Live ? <Live toolId={toolId} /> : <SoonWorkspace toolId={toolId} />;
}
