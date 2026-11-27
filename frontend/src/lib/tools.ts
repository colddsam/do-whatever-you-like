import {
  MicVocal,
  Webhook,
  Music4,
  Archive,
  AtSign,
  Box,
  CalendarHeart,
  ChartColumnBig,
  Languages,
  MessageSquareText,
  MessagesSquare,
  NotebookPen,
  Workflow,
  AudioWaveform,
  GitCompare,
  Clock,
  Regex,
  Binary,
  Fingerprint,
  KeySquare,
  Link2,
  FileJson,
  Volume2,
  MonitorPlay,
  Clapperboard,
  Film,
  Gauge,
  Grid3x3,
  Smile,
  CodeSquare,
  Monitor,
  WholeWord,
  AppWindow,
  Type,
  Pipette,
  PenTool,
  ArrowRightLeft,
  AudioLines,
  Braces,
  Captions,
  CodeXml,
  ImageDown,
  ImagePlay,
  ImageUpscale,
  Laugh,
  Paintbrush,
  Scaling,
  ScanFace,
  Crop,
  Download,
  Eraser,
  Eye,
  FileDiff,
  FileImage,
  FileMinus,
  FileOutput,
  FileSpreadsheet,
  FileStack,
  FileText,
  Globe,
  ImageIcon,
  ImagePlus,
  Layers,
  LayoutGrid,
  ListOrdered,
  Lock,
  LockOpen,
  Merge,
  Minimize2,
  PencilLine,
  PenLine,
  Presentation,
  QrCode,
  RotateCw,
  ScanLine,
  ScanText,
  Scissors,
  Shrink,
  Signature,
  Split,
  Stamp,
  Videotape,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { DESIGN_GROUPS, DEV_GROUPS, ENGINE_INFO, EVERYDAY_GROUPS, TEXT_GROUPS, UTILITIES } from "@/lib/utilities/catalog";
import { MERGED_TOOLS } from "./merged-tools";
import { rankToolsForTask } from "./tool-search";

export type ToolStatus = "live" | "soon";

/**
 * How a tool is used. The playground picks its workspace from this, so a new
 * integration only needs a kind (and, once it's built, an entry in the playground registry).
 * - link:     paste a URL, preview what it points to, save the result
 * - file:     drop in files, choose options, download the result
 * - text:     paste text, pick an action, copy the result
 * - generate: fill in a few details, see it update live, download it
 */
export type ToolKind = "link" | "file" | "text" | "generate";

/** The three steps shown across the top of every workspace. */
export const defaultSteps: Record<ToolKind, [string, string, string]> = {
  link: ["Paste a link", "Check the preview", "Save the file"],
  file: ["Add your files", "Choose options", "Download"],
  text: ["Paste your text", "Pick an action", "Copy the result"],
  generate: ["Enter details", "Adjust the look", "Download"],
};

/** The sections of the PDF family, in the order /tools shows them. */
export const PDF_GROUPS = ["Organize", "Optimize", "Convert to PDF", "Edit", "Security"] as const;
export type PdfGroup = (typeof PDF_GROUPS)[number];

/** The sections of the image family, in the order /tools shows them (iLoveIMG's grouping). */
export const IMAGE_GROUPS = ["Optimize", "Create", "Modify", "Convert", "Security"] as const;
export type ImageGroup = (typeof IMAGE_GROUPS)[number];

/**
 * The sections of the file family: the universal converter (and the popular pairs it powers),
 * compression for any file, and merge/split for every format where they make sense.
 */
export const FILE_GROUPS = ["Edit", "View", "Convert", "Compress", "Merge & split"] as const;
export type FileGroup = (typeof FILE_GROUPS)[number];

/** The Developer and Text collections' sections (lib/utilities/catalog.ts). */
export type DevGroup = (typeof DEV_GROUPS)[number];
export type TextGroup = (typeof TEXT_GROUPS)[number];
export type EverydayGroup = (typeof EVERYDAY_GROUPS)[number];
export type DesignGroup = (typeof DESIGN_GROUPS)[number];

export type Tool = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: ToolStatus;
  /** True for server-heavy workloads (FFmpeg, AI/ONNX/Whisper, Chromium, LibreOffice, yt-dlp, PyMuPDF) in Beta on the free backend. */
  beta?: boolean;
  icon: LucideIcon;
  kind: ToolKind;
  /** The spec sheet: what goes in, what comes out, and any limit worth knowing. */
  takes: string;
  gives: string;
  limit?: string;
  /** Overrides the kind's default step titles. */
  steps?: [string, string, string];
  /** The choices offered in step two (formats, modes, actions). */
  options?: string[];
  /** File tools: what the drop zone accepts. */
  accept?: { label: string; types: string };
  /** Extra words the command palette matches against. */
  keywords: string[];
  /**
   * Tools that belong to a family (the single-purpose PDF tools) get their own section on /tools,
   * grouped by `group`, and stay out of the home page grid, which shows the family's hub instead.
   */
  family?: "pdf" | "image" | "files" | "developer" | "text";
  group?: PdfGroup | ImageGroup | FileGroup | DevGroup | TextGroup | EverydayGroup | DesignGroup;
  /** What the tool page promises, shown as a checklist. */
  features: string[];
  /** Live downloaders only: how the playground talks to the backend. */
  downloader?: {
    platform: "youtube" | "instagram" | "facebook";
    placeholder: string;
    /** Hostnames we accept, checked in the browser before calling the API. */
    hosts: string[];
    /** Instagram also accepts a bare shortcode. */
    allowShortcode?: boolean;
    /** Link shapes shown in the empty workspace, so people know what will work. */
    examples: string[];
  };
  /**
   * A popular pair (PDF to Word, Video to MP3…) run by the universal converter: one engine, one
   * workspace, with the source formats it takes and the format it makes fixed.
   */
  preset?: { from: string[]; to: string };
  /** A standalone page for one tab of the developer hub (`dev`): the tab it opens on. */
  devTab?: string;
  /** Editors that need room (charts, flowcharts): the workspace spans the page, the spec sheet goes under it. */
  wide?: boolean;
  /** The <title> when the name alone misses how people search ("free Photoshop alternative"). */
  seoTitle?: string;
};

const PDF_ACCEPT = { label: "PDF files", types: ".pdf,application/pdf" };
const IMAGE_ACCEPT = { label: "JPG, PNG, GIF, WebP…", types: "image/*" };
const imageTool = (t: Omit<Tool, "category" | "status" | "kind" | "family" | "accept"> & Partial<Tool>): Tool => ({
  category: "Images",
  status: "live",
  kind: "file",
  family: "image",
  accept: IMAGE_ACCEPT,
  limit: "Up to 30 images, 150 MB",
  ...t,
});

/**
 * Every image job as its own page (the iLoveIMG set), registered by id in
 * components/tools/playground.tsx. Meme generator and photo editor run in the browser.
 */
const imageTools: Tool[] = [
  // Optimize
  imageTool({
    id: "compress-image", name: "Compress image", group: "Optimize", icon: ImageDown,
    description: "Make JPG, PNG, GIF, WebP and SVG files smaller.",
    takes: "JPG, PNG, GIF, WebP or SVG", gives: "Smaller images", steps: ["Add images", "Pick a strength", "Download"],
    keywords: ["compress", "shrink", "reduce", "optimize", "smaller", "image", "photo", "jpg", "png", "gif", "svg", "webp", "size"],
    features: ["Light (lossless), Recommended or Strong", "Before and after size for every image", "Animated GIFs stay animated", "Strips camera data unless you keep it"],
  }),
  imageTool({
    id: "upscale-image", name: "Upscale image", group: "Optimize", icon: ImageUpscale,
    description: "Enlarge a picture 2× or 4× with AI that redraws the detail.",
    takes: "One image", gives: "A 2× or 4× image", limit: "Results up to 12–16 MP",
    steps: ["Add an image", "Pick 2× or 4×", "Download"],
    keywords: ["upscale", "enlarge", "enhance", "super resolution", "ai", "increase resolution", "hd", "4k", "sharpen", "image"],
    features: ["Real-ESRGAN, the open AI upscaler", "2× or 4× for any picture, with the new size shown first", "Big pictures are handled too: the AI works on a reduced copy, then the result is enlarged", "Drag to compare before and after", "Runs on our server: no account, no credits"],
  }),
  imageTool({
    id: "remove-background", name: "Remove background", group: "Optimize", icon: Eraser,
    description: "Cut out the subject: transparent, a colour, or a soft blur behind.",
    takes: "Up to 10 images", gives: "PNG cut-outs", limit: "Up to 10 images",
    steps: ["Add images", "Pick a background", "Download"],
    keywords: ["remove background", "background remover", "cut out", "cutout", "transparent", "no background", "bg", "png", "product photo", "image"],
    features: ["Finds people, products and pets on its own", "Transparent PNG, a solid colour, or a blurred backdrop", "Drag to compare before and after", "Free, with no watermark"],
  }),
  // Create
  imageTool({
    id: "meme-generator", name: "Meme generator", group: "Create", icon: Laugh,
    description: "Captions on a picture, the classic way, in seconds.",
    takes: "A picture", gives: "JPG or PNG", limit: "Made in your browser",
    steps: ["Add a picture", "Write the captions", "Download"],
    keywords: ["meme", "caption", "funny", "impact", "top text", "bottom text", "generator", "image"],
    features: ["Text on the picture, or in bands above and below", "Impact-style lettering with an outline", "Hindi and Bangla captions work too", "Your picture never leaves your device"],
  }),
  imageTool({
    id: "photo-editor", name: "Photo editor", group: "Create", icon: Paintbrush,
    description: "Filters, highlights/shadows, sharpness, custom fonts, text, stickers, frames and JPG/PNG/WebP export.",
    takes: "A photo", gives: "JPG, PNG or WebP", limit: "Made in your browser",
    steps: ["Add a photo", "Edit it", "Download"],
    keywords: ["photo editor", "edit photo", "filter", "brightness", "contrast", "saturation", "highlights", "shadows", "sharpness", "custom font", "webp", "compare before after", "text on photo", "sticker", "frame", "image editor"],
    features: ["Nine filters, plus nine sliders (including Highlights, Shadows & Sharpness)", "Before/After compare toggle right on the preview stage", "Turn, flip, crop to square/story and upload custom .ttf/.otf/.woff2 fonts", "Export crisp JPG, transparent PNG (frames/rounded corners) or WebP"],
  }),
  imageTool({
    id: "pro-photo-editor", name: "Pro photo editor", group: "Create", icon: Layers, wide: true,
    seoTitle: "Pro Photo Editor — Free Photoshop Alternative Online",
    description: "Photoshop-grade browser studio: layers, 3D .cube LUTs, 35mm halation & lens tools, symmetry & mosaic brushes, Google/custom fonts & PSD support across all devices.",
    takes: "A photo, a PSD, a project or a blank canvas", gives: "PNG, JPG, WebP, PSD, SVG or a project", limit: "Made in your browser",
    accept: { label: "JPG, PNG, WebP, GIF, AVIF, SVG or PSD", types: "image/*,.psd,.dwlp" },
    steps: ["Open or create", "Edit with layers", "Export"],
    options: ["layers and masks", "3D .cube LUTs & optics", "symmetry & mosaic brushes", "retouching & liquify", "crop straighten & watermark", "responsive mobile/tablet/desktop"],
    keywords: ["photoshop", "photoshop online", "free photoshop alternative", "photopea alternative", "lightroom online", "lightroom presets", "cube lut photo editor", "3d lut", "halation", "pro mist bloom", "perspective keystone", "lens distortion correction", "symmetry brush", "censor mosaic brush", "crop straighten", "before after split wipe", "watermark generator", "google fonts photo editor", "custom fonts", "responsive photo editor", "layers", "layer mask", "blend modes", "adjustment layer", "curves", "levels", "hsl color mixer", "color grading", "magic wand", "lasso", "clone stamp", "healing brush", "spot healing", "content aware fill", "dodge burn", "liquify", "psd editor", "open psd online", "camera raw"],
    features: [
      "Layers, 17 blend modes, masks, vector paths, non-destructive adjustment layers & 3D .cube LUT loader",
      "Optical filters (35mm Halation, Pro-Mist Bloom, Perspective Keystone, Lens Distortion) & interactive Before/After wipe",
      "Symmetry painting (Mirror/Quad/Radial ×6/×8), Mosaic/Censor brush, healing, clone, dodge/burn & liquify",
      "Crop horizon Straighten + compositional guides (Rule of Thirds, Grid, Golden Ratio, Diagonals) & Watermark generator",
      "Google Fonts loader + custom .ttf/.otf/.woff/.woff2 upload, stickers, frames, collages & PSD read/write",
      "Responsive 3-tier UI tuned for phones, tablets, laptops and ultrawide monitors with touch/pinch gestures",
    ],
  }),
  imageTool({
    id: "emoji-to-image", name: "Emoji to image", group: "Create", icon: Smile,
    description: "Any emoji as a PNG, WebP or SVG, in four styles and any size.",
    takes: "An emoji", gives: "PNG, WebP or SVG", limit: "Made in your browser", accept: undefined,
    steps: ["Pick an emoji", "Style it", "Download"],
    keywords: ["emoji to image", "emoji to png", "emoji png", "emoji svg", "emoji picture", "emoji icon", "emoji download", "twemoji", "noto emoji", "openmoji", "emoji favicon"],
    features: ["Search 1,900 emoji by name, with skin tones", "Noto, Twemoji, OpenMoji or your device's own", "Any size from 16 to 2048 px, with a background or transparent", "PNG, WebP, the original SVG, or every icon size in a ZIP"],
  }),
  // Modify
  imageTool({
    id: "pixelate-image", name: "Pixelate image", group: "Modify", icon: Grid3x3,
    description: "Turn a picture into pixel art, or pixelate just a part of it.",
    takes: "One picture", gives: "PNG, JPG or WebP", limit: "Made in your browser",
    steps: ["Add a picture", "Set the blocks", "Download"],
    keywords: ["pixelate", "pixelate image", "pixel art", "8 bit", "mosaic", "pixelator", "censor", "blocky", "retro", "game boy palette", "lego"],
    features: ["Any block size, with a live preview", "Squares, rounded, dots or mosaic tiles", "Fewer colours, or Game Boy, PICO-8 and CGA palettes", "The whole picture or just a part; pixel-art size for sprites"],
  }),
  imageTool({
    id: "gif-speed", name: "Change GIF speed", group: "Modify", icon: Gauge,
    description: "Speed up or slow down an animated GIF, reverse it or make a boomerang.",
    takes: "An animated GIF", gives: "A GIF", limit: "Made in your browser", accept: { label: "Animated GIFs", types: ".gif,image/gif" },
    steps: ["Add a GIF", "Set the speed", "Download"],
    keywords: ["gif speed", "speed up gif", "slow down gif", "gif speed changer", "gif delay", "reverse gif", "boomerang gif", "gif loop", "gif frame rate"],
    features: ["Lossless: only the timing changes, every pixel stays", "Any speed from 0.1× to 8×, or a fixed time per frame", "Play backwards, boomerang, and set the looping", "Before and after, side by side"],
  }),
  // Modify (continued)
  imageTool({
    id: "resize-image", name: "Resize image", group: "Modify", icon: Scaling,
    description: "Set an exact size in pixels, or scale by percentage.",
    takes: "JPG, PNG, GIF, WebP, SVG, HEIC…", gives: "Resized images", steps: ["Add images", "Set the size", "Download"],
    keywords: ["resize", "scale", "dimensions", "pixels", "width", "height", "percentage", "smaller", "bigger", "image", "photo"],
    features: ["By pixels or percentage", "Keep proportions, or set an exact size", "The new size shows on every image first", "Animated GIFs and SVGs resize cleanly"],
  }),
  imageTool({
    id: "crop-image", name: "Crop image", group: "Modify", icon: Crop,
    description: "Drag a box on the picture, or type exact pixels.",
    takes: "One image", gives: "A cropped image", steps: ["Add an image", "Draw the crop", "Download"],
    keywords: ["crop", "cut", "trim", "frame", "aspect ratio", "square", "image", "photo"],
    features: ["Drag and resize the crop on the picture", "Square, 4:5, 16:9 and more", "Exact pixel fields that stay in sync", "Animated GIFs stay animated"],
  }),
  imageTool({
    id: "rotate-image", name: "Rotate image", group: "Modify", icon: RotateCw,
    description: "Turn or flip many images at once, or each on its own.",
    takes: "JPG, PNG, GIF, WebP…", gives: "Rotated images", steps: ["Add images", "Turn them", "Download"],
    keywords: ["rotate", "turn", "flip", "mirror", "orientation", "sideways", "upside down", "image", "photo"],
    features: ["Turn all, only portraits, or only landscapes", "Per-image turn and flip buttons", "Pixel-exact quarter turns: no blur", "See every turn before you save"],
  }),
  // Convert
  imageTool({
    id: "convert-image", name: "Convert image", group: "Convert", icon: FileImage,
    description: "Any image (HEIC, PNG, WebP, TIFF, PSD, SVG, RAW, JPG…) to JPG, PNG, WebP or GIF, or several into an animated GIF.",
    takes: "HEIC, JPG, PNG, WebP, TIFF, PSD, SVG, RAW…", gives: "JPG, PNG, WebP, GIF or animated GIF", steps: ["Add images", "Pick a format", "Download"],
    keywords: ["convert image", "image converter", "photo converter", "change image format"],
    features: ["iPhone HEIC photos and camera RAW files", "JPG, PNG, WebP or GIF; Highest quality keeps every pixel", "Animated GIF from several images, in your order", "Up to 30 images at once"],
  }),
  imageTool({
    id: "convert-to-jpg", name: "Convert to JPG", group: "Convert", icon: FileImage,
    description: "HEIC, PNG, WebP, TIFF, PSD, SVG, RAW and more, to JPG.",
    takes: "HEIC, PNG, WebP, TIFF, PSD, SVG, RAW…", gives: "JPG images", steps: ["Add images", "Pick the quality", "Download"],
    keywords: ["convert", "to jpg", "jpeg", "heic", "heic to jpg", "png to jpg", "webp to jpg", "tiff", "psd", "svg", "raw", "cr2", "nef", "iphone photo"],
    features: ["iPhone HEIC photos and camera RAW files", "Highest quality keeps every pixel, free", "Choose the colour behind transparent areas", "Up to 30 images at once"],
  }),
  imageTool({
    id: "jpg-to-image", name: "Convert from JPG", group: "Convert", icon: ImagePlay,
    description: "JPG to PNG, WebP or GIF, or several into an animated GIF.",
    takes: "JPG images", gives: "PNG, WebP, GIF or animated GIF", steps: ["Add images", "Pick a format", "Download"],
    keywords: ["jpg to png", "jpg to gif", "jpg to webp", "animated gif", "gif maker", "convert", "png", "gif", "slideshow"],
    features: ["PNG and WebP keep every pixel", "Animated GIF from several images, in your order", "Set the seconds per frame and looping", "Up to 30 images at once"],
  }),
  imageTool({
    id: "html-to-image", name: "HTML to image", group: "Convert", icon: CodeXml,
    description: "Capture a web page, or HTML you paste, as a picture.",
    takes: "A web address or HTML", gives: "JPG, PNG or WebP", limit: "Public pages only",
    steps: ["Add the page", "Pick a screen", "Download"],
    accept: undefined,
    keywords: ["html to image", "html to jpg", "screenshot", "web page", "website", "capture", "full page screenshot", "url to image"],
    features: ["The whole page, or one screen", "Phone, tablet, laptop or desktop width", "Blocks ads and hides cookie banners", "Private addresses are never opened"],
  }),
  imageTool({
    id: "icon-maker", name: "Icon maker", group: "Convert", icon: AppWindow,
    description: "Favicons and app icons for websites, Windows, macOS, iOS and Android, from one picture.",
    takes: "A PNG, SVG, JPG…", gives: "ICO, ICNS and PNG sets", limit: "One picture",
    steps: ["Add a picture", "Pick platforms", "Download"],
    accept: { label: "PNG, SVG, JPG, WebP, HEIC…", types: "image/*,.svg,.heic,.heif,.psd,.ico" },
    keywords: [
      "icon", "ico", "favicon", "icon maker", "icon generator", "favicon generator", "app icon", "png to ico", "svg to ico", "jpg to ico",
      "icns", "mac icon", "windows icon", "exe icon", "ios icon", "android icon", "pwa", "manifest", "apple touch icon", "launcher icon",
    ],
    features: [
      "Website: favicon.ico, PNGs, Apple touch and PWA icons, plus the HTML",
      "Windows: one .ico with every size from 16 to 256, and Store tiles",
      "macOS .icns, an Xcode-ready iOS icon set and Android mipmaps",
      "Square, rounded or round, with padding and a background colour",
    ],
  }),
  // Security
  imageTool({
    id: "watermark-image", name: "Watermark image", group: "Security", icon: Stamp,
    description: "Stamp text or a logo, placed, faded, turned or tiled.",
    takes: "JPG, PNG, GIF, WebP…", gives: "Watermarked images", steps: ["Add images", "Design the stamp", "Download"],
    keywords: ["watermark", "stamp", "logo", "copyright", "protect", "brand", "text on image", "image"],
    features: ["Text in five fonts, or your logo", "Opacity, rotation and nine positions", "Repeat it across the image (hard to crop)", "Live preview on your own picture"],
  }),
  imageTool({
    id: "blur-face", name: "Blur face", group: "Security", icon: ScanFace,
    description: "Find faces and hide them, plus anything else you mark.",
    takes: "One image", gives: "A blurred image", steps: ["Add an image", "Check the areas", "Download"],
    keywords: ["blur face", "anonymize", "anonymise", "pixelate", "hide face", "privacy", "censor", "license plate", "number plate", "blur"],
    features: ["Finds faces on its own, even small ones", "Keep any face sharp, or add areas by hand", "Blur or pixelate, oval or rectangle", "Baked in: can't be undone from the file"],
  }),
  imageTool({
    id: "image-to-svg", name: "Image to SVG vectoriser", group: "Convert", icon: PenTool,
    description: "Trace PNG or JPG logos, sketches and icons into crisp scalable SVG vectors in your browser.",
    takes: "A PNG, JPG or WebP image", gives: "A scalable SVG file", steps: ["Drop an image", "Tune threshold or colours", "Copy or download SVG"],
    keywords: ["image to svg", "png to svg", "jpg to svg", "vectorize image", "svg tracer", "raster to vector", "logo vectorizer"],
    features: ["Monochrome B&W tracing and multi-colour k-means quantization", "Smooth quadratic Bézier curve fitting with noise speckle filter", "Includes a sample badge so you can test immediately", "Runs 100% locally on an HTML canvas"],
  }),
  imageTool({
    id: "mockup-frame-generator", name: "Mockup & safe-zone frame", group: "Create", icon: AppWindow,
    description: "Frame screenshots inside browser windows or phones, or preview YouTube/Reels/TikTok safe zones.",
    takes: "A screenshot or thumbnail", gives: "A framed PNG", steps: ["Drop a screenshot", "Choose frame or safe-zone HUD", "Download PNG"],
    keywords: ["mockup generator", "browser frame screenshot", "phone frame mockup", "youtube thumbnail safe zone", "reels safe zone overlay", "tiktok safe zone"],
    features: ["macOS Safari browser, dark phone and floating glass card frames", "Live YouTube, Shorts, Reels, TikTok and Instagram 4:5 safe-zone overlays", "Gradient, solid or transparent backgrounds with custom padding", "One-click 2x HD PNG export"],
  }),
];
const pdfTool = (t: Omit<Tool, "category" | "status" | "kind" | "family" | "accept"> & Partial<Tool>): Tool => ({
  category: "Documents",
  status: "live",
  kind: "file",
  family: "pdf",
  accept: PDF_ACCEPT,
  limit: "Up to 150 MB",
  ...t,
});

/**
 * Every PDF job as its own page, so people land straight on the task they have. Their
 * workspaces are registered by id in components/tools/playground.tsx.
 */
const pdfTools: Tool[] = [
  // Organize
  pdfTool({
    id: "merge-pdf", name: "Merge PDF", group: "Organize", icon: Layers,
    description: "Combine PDFs into one, in the order you set.",
    takes: "2 to 20 PDFs", gives: "One PDF", steps: ["Add PDFs", "Set the order", "Download"],
    keywords: ["merge", "combine", "join", "append", "pdf"],
    features: ["Up to 20 PDFs, 150 MB in total", "Drag to set the order", "Exact size shown before you merge"],
  }),
  pdfTool({
    id: "split-pdf", name: "Split & extract PDF pages", group: "Organize", icon: Scissors,
    description: "Break a PDF into parts, or pull out just the pages you pick as a new PDF.",
    takes: "One PDF", gives: "A PDF, or PDFs in a ZIP", steps: ["Add a PDF", "Pick the pages", "Download"],
    keywords: ["split", "separate", "divide", "break", "pages", "pdf", "extract pages", "select pages"],
    features: ["Every page on its own, or ranges you type", "Extract chosen pages into one new PDF", "Pick which pages go together on the page grid", "Each part's size before you split"],
  }),
  pdfTool({
    id: "remove-pages", name: "Remove pages", group: "Organize", icon: FileMinus,
    description: "Delete the pages you don't need.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Pick pages to remove", "Download"],
    keywords: ["delete pages", "remove", "drop", "pages", "pdf"],
    features: ["See every page before you remove it", "Removed pages can be put back", "Links to kept pages still work"],
  }),
  pdfTool({
    id: "extract-pages", name: "Extract pages", group: "Organize", icon: FileOutput,
    description: "Keep just the pages you pick, as a new PDF.",
    takes: "One PDF", gives: "PDF, or a ZIP of parts", steps: ["Add a PDF", "Pick the pages", "Download"],
    keywords: ["extract", "pull", "select pages", "pages", "pdf"],
    features: ["Click pages or type ranges like 1-3, 7", "Put several pages in one PDF with +", "Preview the result before saving"],
  }),
  pdfTool({
    id: "organize-pdf", name: "Organize, rotate & remove PDF pages", group: "Organize", icon: LayoutGrid,
    description: "Reorder, rotate and delete pages on a page grid, seeing each one.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Arrange the pages", "Download"],
    keywords: ["organize", "reorder", "rearrange", "sort", "move pages", "pdf"],
    features: ["Drag pages into a new order", "Rotate one page, a selection or all of them", "Remove pages, and put them back from the tray", "Keyboard shortcuts for every action"],
  }),
  pdfTool({
    id: "scan-to-pdf", name: "Scan to PDF", group: "Organize", icon: ScanLine,
    description: "A guided camera finds the page, straightens it and cleans it up: a crisp, searchable PDF.",
    takes: "Your camera, or photos", gives: "Searchable PDF", limit: "Up to 100 pages",
    steps: ["Scan the pages", "Check and adjust", "Download"],
    accept: { label: "Photos", types: "image/*" },
    keywords: ["scan", "scanner", "camera", "photo", "document scanner", "adobe scan", "camscanner", "paper", "receipt", "whiteboard", "edge detection", "crop", "ocr", "searchable", "pdf"],
    features: [
      "Finds the page's edges live and shoots by itself when it's steady",
      "Tells you what to fix: light, distance, angle, focus",
      "Straightened to the page's true shape, shadows evened out",
      "Auto, greyscale or black & white; drag corners to fine-tune",
      "Searchable text (OCR) in 100+ languages, free, no watermark",
    ],
  }),
  // Optimize
  pdfTool({
    id: "compress-pdf", name: "Compress PDF", group: "Optimize", icon: Minimize2,
    description: "Make a PDF smaller, at the strength you choose.",
    takes: "One PDF", gives: "A smaller PDF", steps: ["Add a PDF", "Set the strength", "Download"],
    keywords: ["compress", "shrink", "reduce", "smaller", "size", "optimize", "pdf"],
    features: ["Light, Balanced or Strong, or any strength in between", "Predicted size as you slide", "Text and vector drawings stay sharp"],
  }),
  pdfTool({
    id: "repair-pdf", name: "Repair PDF", group: "Optimize", icon: Wrench,
    description: "Recover the pages of a damaged PDF.",
    takes: "A damaged PDF", gives: "A working PDF", steps: ["Add the PDF", "Repair it", "Download"],
    keywords: ["repair", "fix", "broken", "corrupt", "damaged", "recover", "pdf"],
    features: ["Rebuilds a broken file structure", "Keeps every page that can be read", "Tells you what was recovered"],
  }),
  pdfTool({
    id: "ocr-pdf", name: "OCR PDF", group: "Optimize", icon: ScanText,
    description: "Make scanned PDFs searchable and selectable.",
    takes: "A scanned PDF", gives: "Searchable PDF", limit: "Up to 300 pages",
    steps: ["Add a PDF", "Pick the languages", "Download"],
    keywords: ["ocr", "text recognition", "searchable", "scan", "select text", "copy text", "pdf"],
    features: ["Over 100 languages, up to 5 at once", "The pages look exactly as before", "Pages that already have text are left alone"],
  }),
  pdfTool({
    id: "pdf-to-pdfa", name: "PDF to PDF/A", group: "Optimize", icon: Archive,
    description: "An archive-ready PDF for long-term storage.",
    takes: "One PDF", gives: "PDF/A", steps: ["Add a PDF", "Choose the level", "Download"],
    keywords: ["pdfa", "pdf/a", "archive", "iso", "long term", "convert", "pdf"],
    features: ["PDF/A-1b, 2b or 3b", "Fonts embedded, colours fixed to sRGB", "Accepted by courts and archives"],
  }),
  // Convert to PDF
  pdfTool({
    id: "jpg-to-pdf", name: "JPG to PDF", group: "Convert to PDF", icon: ImagePlus,
    description: "Turn photos and images into one PDF.",
    takes: "JPG, PNG, WebP…", gives: "One PDF", limit: "Up to 100 images",
    steps: ["Add images", "Choose the layout", "Download"],
    accept: { label: "Images", types: "image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff" },
    keywords: ["jpg", "jpeg", "png", "image", "photo", "picture", "convert", "pdf"],
    features: ["JPG, PNG, WebP, GIF, BMP and TIFF", "A4, Letter or the image's own size", "Drag to set the page order"],
  }),
  pdfTool({
    id: "html-to-pdf", name: "HTML to PDF", group: "Convert to PDF", icon: Globe,
    description: "Save any public web page as a PDF.",
    takes: "A web address or HTML file", gives: "PDF", steps: ["Add a page", "Set up the paper", "Download"],
    accept: { label: "HTML files", types: ".html,.htm,text/html" },
    keywords: ["html", "web page", "website", "url", "link", "save page", "convert", "pdf"],
    features: ["Renders the page in a real browser", "A4, Letter, Legal or A3, portrait or landscape", "Private and internal addresses are blocked"],
  }),
  // Edit
  pdfTool({
    id: "rotate-pdf", name: "Rotate PDF", group: "Edit", icon: RotateCw,
    description: "Turn pages the right way up, one or all at once.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Turn the pages", "Download"],
    keywords: ["rotate", "turn", "flip", "landscape", "portrait", "upside down", "pdf"],
    features: ["Turn single pages or all of them", "See each page as you turn it", "Nothing is re-compressed"],
  }),
  pdfTool({
    id: "page-numbers", name: "Add page numbers", group: "Edit", icon: ListOrdered,
    description: "Number pages where you want, how you want.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Place the numbers", "Download"],
    keywords: ["page numbers", "numbering", "paginate", "footer", "header", "pdf"],
    features: ["Six positions, four styles", "Start from any number, skip pages", "Upright on turned pages too"],
  }),
  pdfTool({
    id: "watermark-pdf", name: "Add watermark", group: "Edit", icon: Stamp,
    description: "Stamp text or an image over your pages.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Design the stamp", "Download"],
    keywords: ["watermark", "stamp", "confidential", "draft", "logo", "pdf"],
    features: ["Text or image, any angle", "Nine positions, or tiled across the page", "Over or under the page content"],
  }),
  pdfTool({
    id: "crop-pdf", name: "Crop PDF", group: "Edit", icon: Crop,
    description: "Trim margins or cut pages down to an area.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Draw the crop", "Download"],
    keywords: ["crop", "trim", "margins", "cut", "resize page", "pdf"],
    features: ["Drag the box on the real page", "All pages or just some", "Nothing outside the box is printed"],
  }),
  pdfTool({
    id: "edit-pdf", name: "Edit PDF", group: "Edit", icon: PencilLine,
    description: "Add text, images, shapes and drawings.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Make your changes", "Download"],
    keywords: ["edit", "add text", "write", "annotate", "draw", "shapes", "highlight", "white out", "pdf"],
    features: ["Text, images, shapes, highlights and freehand", "White-out to cover what's there", "Move, resize and style everything"],
  }),
  // Security
  pdfTool({
    id: "unlock-pdf", name: "Unlock PDF", group: "Security", icon: LockOpen,
    description: "Remove a PDF's password and restrictions.",
    takes: "A protected PDF", gives: "PDF", steps: ["Add the PDF", "Enter the password", "Download"],
    keywords: ["unlock", "remove password", "decrypt", "unprotect", "restrictions", "pdf"],
    features: ["Removes the open password (you'll need it)", "Lifts print, copy and edit restrictions", "Your password is never stored"],
  }),
  pdfTool({
    id: "protect-pdf", name: "Protect PDF", group: "Security", icon: Lock,
    description: "Lock a PDF with a password.",
    takes: "One PDF", gives: "Encrypted PDF", steps: ["Add a PDF", "Set a password", "Download"],
    keywords: ["protect", "password", "encrypt", "lock", "secure", "pdf"],
    features: ["AES-256 encryption", "Choose whether it can be printed, copied or edited", "Your password is never stored"],
  }),
  pdfTool({
    id: "sign-pdf", name: "Sign PDF", group: "Security", icon: Signature,
    description: "Draw, type or upload your signature and place it.",
    takes: "One PDF", gives: "Signed PDF", steps: ["Add a PDF", "Sign and place", "Download"],
    keywords: ["sign", "signature", "e-sign", "initials", "fill", "pdf"],
    features: ["Draw, type or upload a signature", "Place it on any page, as often as you need", "Add the date and your initials"],
  }),
  pdfTool({
    id: "redact-pdf", name: "Redact PDF", group: "Security", icon: Eraser,
    description: "Black out private details for good.",
    takes: "One PDF", gives: "Redacted PDF", steps: ["Add a PDF", "Mark what to hide", "Download"],
    keywords: ["redact", "black out", "censor", "hide", "remove text", "privacy", "gdpr", "pdf"],
    features: ["Find emails, phone numbers, card numbers and words", "Or draw boxes by hand", "Hidden text is removed, not just covered"],
  }),
  pdfTool({
    id: "compare-pdf", name: "Compare PDF", group: "Security", icon: FileDiff,
    description: "See exactly what changed between two versions.",
    takes: "Two PDFs", gives: "Changes, and a report", steps: ["Add both PDFs", "Review the changes", "Download"],
    keywords: ["compare", "diff", "difference", "changes", "versions", "pdf"],
    features: ["Every word added, removed or changed", "Changes marked on both versions", "Side-by-side report you can save"],
  }),
];

const fileTool = (t: Omit<Tool, "category" | "status" | "kind" | "family"> & Partial<Tool>): Tool => ({
  category: "Files",
  status: "live",
  kind: "file",
  family: "files",
  limit: "Up to 150 MB",
  ...t,
});

const OFFICE_FORMATS = {
  word: ["docx", "doc", "odt", "rtf", "docm", "dotx"],
  slides: ["pptx", "ppt", "odp", "pps", "ppsx", "pptm"],
  sheets: ["xlsx", "xls", "ods", "xlsm", "csv", "tsv"],
};
const dotted = (list: string[]) => list.map((e) => "." + e).join(",");

/**
 * Tools for any file. The popular pairs are presets of the universal converter (same engine and
 * workspace, the pair fixed), so there's one converter in the codebase, not one per pair.
 */
const fileTools: Tool[] = [
  // Edit: full office editors (Word, Excel, PowerPoint alternatives), in the browser
  fileTool({
    id: "excel-editor", name: "Excel editor (Sheets)", group: "Edit", icon: FileSpreadsheet, wide: true,
    seoTitle: "Free Online Excel Editor: 225 Formulas, Charts & XLSX",
    description: "A free Excel alternative in your browser: 225 formulas, charts, conditional formatting, filters, sort, freeze panes and real .xlsx open & save. No sign-up.",
    takes: "A new workbook, a template, or XLSX, XLS, ODS, CSV and TSV files",
    gives: "XLSX, CSV, TSV, HTML, JSON or PDF",
    limit: "Saved in your browser",
    steps: ["Start blank, from a template, or open a file", "Type, calculate, format and chart", "Download .xlsx, CSV or PDF"],
    accept: { label: "Spreadsheets", types: ".xlsx,.xlsm,.xls,.ods,.csv,.tsv" },
    keywords: [
      "excel online", "free excel", "excel alternative", "online spreadsheet", "spreadsheet editor", "edit xlsx online", "xlsx editor", "open xlsx and edit",
      "google sheets alternative", "microsoft excel free", "excel formulas", "vlookup", "xlookup", "pivot", "sumif", "conditional formatting", "excel charts",
      "csv editor", "edit csv online", "budget spreadsheet", "invoice template excel", "freeze panes", "data validation dropdown", "remove duplicates",
    ],
    features: [
      "225 Excel functions incl. XLOOKUP, SUMIFS, FILTER, SORT, UNIQUE, SEQUENCE, TEXT, dates and finance, with spilled arrays and autocomplete",
      "Fast canvas grid: millions of cells, frozen panes, merge, wrap, borders, fills, fonts and number formats (currency, %, dates, custom codes)",
      "Fill handle with smart series, copy/paste to and from Excel or Google Sheets, undo/redo, find & replace, format painter",
      "Sort, filter, remove duplicates, text to columns, drop-down lists, conditional formatting (rules, colour scales, data bars)",
      "Charts (column, bar, line, area, pie, doughnut, scatter, radar) that update live; notes, links and named ranges",
      "Real .xlsx open & save with styles, formulas, merges and widths; CSV/TSV/HTML/JSON and print to PDF; autosaves in your browser",
    ],
  }),
  // Edit: full office editors (Word, Excel, PowerPoint alternatives), in the browser
  fileTool({
    id: "word-editor", name: "Word editor (Docs)", group: "Edit", icon: FileText, wide: true,
    seoTitle: "Free Online Word Editor: Write & Save DOCX in Browser",
    description: "A free Microsoft Word alternative: rich formatting, styles, tables, images, equations, headers & footers, page setup, comments, translation and real .docx open & save. No sign-up.",
    takes: "A new document, a template, or DOCX, ODT, RTF, HTML, Markdown and text files",
    gives: "DOCX, PDF, HTML, Markdown or text",
    limit: "Saved in your browser",
    steps: ["Start blank, from a template, or open a file", "Write, format and lay out", "Download .docx or PDF"],
    accept: { label: "Documents", types: ".docx,.docm,.dotx,.doc,.odt,.rtf,.html,.htm,.md,.txt" },
    keywords: [
      "word online", "free word", "word alternative", "microsoft word free", "online document editor", "edit docx online", "docx editor", "open docx and edit",
      "google docs alternative", "write document online", "resume template", "letter template", "word processor", "rich text editor", "table of contents",
    ],
    features: [
      "Fonts, sizes, colours, highlight, styles (Title, Headings, Quote, Code), lists, alignment, spacing and format painter",
      "Tables, images, links, equations, symbols, page breaks, horizontal lines, checklists and an automatic table of contents",
      "Page setup (A4, Letter, margins, orientation, columns), headers & footers with page numbers, watermarks, print to PDF",
      "Find & replace, word count, read aloud, translate selection into 130 languages, focus mode and an outline pane",
      "Real .docx open & save (styles, lists, tables, images, links), plus PDF, HTML, Markdown and text; autosaves in your browser",
    ],
  }),
  // Edit: full office editors (Word, Excel, PowerPoint alternatives), in the browser
  fileTool({
    id: "powerpoint-editor", name: "PowerPoint editor (Slides)", group: "Edit", icon: Presentation, wide: true,
    seoTitle: "Free Online PowerPoint Editor: Make Slides, Save PPTX",
    description: "A free PowerPoint alternative: themes, layouts, text, shapes, images, tables, charts, transitions and animations, presenter mode and real .pptx export. No sign-up.",
    takes: "A new deck, a theme, or a PPTX file",
    gives: "PPTX, PDF, PNG images or HTML",
    limit: "Saved in your browser",
    steps: ["Pick a theme or open a deck", "Design slides", "Present or download .pptx"],
    accept: { label: "Presentations", types: ".pptx,.ppsx,.potx,.ppt,.odp" },
    keywords: [
      "powerpoint online", "free powerpoint", "powerpoint alternative", "online presentation maker", "slides maker", "edit pptx online", "pptx editor",
      "google slides alternative", "keynote alternative", "presentation templates", "slideshow maker", "pitch deck maker",
    ],
    features: [
      "Themes and layouts, text boxes, 20 shapes, lines and arrows, images, tables and live charts",
      "Drag, resize, rotate, align, distribute, group order, snapping guides, copy/paste and undo",
      "Slide transitions and entrance animations, speaker notes and a presenter view with timer",
      "Real .pptx open & save, plus PDF and PNG export; autosaves in your browser; works with touch",
    ],
  }),
  // View: instant in-browser readers for Office docs, spreadsheets, presentations, CSV and PDFs
  fileTool({
    id: "document-viewer", name: "Document viewer", group: "View", icon: Eye,
    description: "Open Word, Excel, PowerPoint, CSV, ODF and PDF files right in your browser: the right viewer is picked for each file.",
    takes: "DOCX, XLSX, PPTX, CSV, ODT, ODP, ODS, RTF or PDF",
    gives: "Interactive preview, search & clean exports",
    steps: ["Drop any document or pick a sample", "Read, inspect sheets or slides, or search", "Export clean CSV, JSON, Markdown or print"],
    accept: {
      label: "Office, CSV & PDF documents",
      types: ".xlsx,.xlsm,.xltx,.ods,.csv,.tsv,.docx,.docm,.dotx,.odt,.rtf,.pptx,.ppsx,.pptm,.odp,.pdf,.xls,.doc,.ppt,.md,.txt",
    },
    limit: "Runs in your browser",
    keywords: [
      "document viewer", "office viewer", "microsoft 365", "m365", "office 365", "open docx",
      "open xlsx", "open pptx", "open odt", "excel viewer", "word viewer", "powerpoint viewer",
      "csv viewer", "pdf viewer", "rtf", "viewer",
    ],
    features: [
      "Reads Word (.docx, .odt, .rtf), Excel (.xlsx, .ods), CSV/TSV, PowerPoint (.pptx, .odp) and PDFs",
      "Multi-sheet grid with formula bar, column statistics, sorting and filtering",
      "16:9 slide stage with speaker notes, filmstrip and slide images",
      "100% client-side — your files never leave your browser",
    ],
  }),
  fileTool({
    id: "excel-viewer", name: "Excel viewer", group: "View", icon: FileSpreadsheet,
    description: "Inspect XLSX, XLSM, ODS, CSV and TSV workbooks with sheets, formulas and stats.",
    takes: "XLSX, XLSM, XLTX, ODS, CSV or TSV",
    gives: "Interactive spreadsheet grid, stats & CSV/JSON/Markdown export",
    steps: ["Drop a workbook or load sample XLSX", "Switch sheets, sort or inspect formulas", "Export cleaned CSV, JSON or Markdown"],
    accept: { label: "Spreadsheets", types: ".xlsx,.xlsm,.xltx,.ods,.csv,.tsv,.xls" },
    limit: "Runs in your browser",
    keywords: [
      "excel", "excel viewer", "xlsx", "xlsx viewer", "xlsm", "ods", "spreadsheet viewer",
      "workbook", "open excel online", "formulas", "excel reader",
    ],
    features: [
      "Switch between worksheets with sheet row/column counts",
      "Inspect raw Excel formulas (`fx` bar) alongside evaluated values and cell comments",
      "Sort, filter and compute instant column Sum / Average / Min / Max",
      "Export any sheet to CSV, JSON or Markdown table locally",
    ],
  }),
  fileTool({
    id: "word-viewer", name: "Word viewer", group: "View", icon: FileText,
    description: "Read DOCX, ODT, RTF and Markdown documents with clean typography and an outline.",
    takes: "DOCX, DOCM, DOTX, ODT, RTF or Markdown",
    gives: "Formatted reader, heading outline & search",
    steps: ["Drop a Word file or load sample DOCX", "Browse the heading outline and tables", "Search text, copy or print to PDF"],
    accept: { label: "Word documents", types: ".docx,.docm,.dotx,.odt,.rtf,.md,.txt,.doc" },
    limit: "Runs in your browser",
    keywords: [
      "word", "word viewer", "docx", "docx viewer", "odt viewer", "rtf viewer",
      "open word online", "microsoft word", "document reader", "docx reader",
    ],
    features: [
      "Preserves headings, bold/italic/code runs, lists, tables, footnotes and embedded images",
      "Clickable heading outline sidebar with live reading stats",
      "Full-text search with match count and highlighted snippets",
      "Export cleanly to Markdown or print straight to PDF",
    ],
  }),
  fileTool({
    id: "powerpoint-viewer", name: "PowerPoint viewer", group: "View", icon: Presentation,
    description: "Step through PPTX, PPSX and ODP slide decks with speaker notes and filmstrip.",
    takes: "PPTX, PPSX, PPTM or ODP",
    gives: "16:9 slide viewer, thumbnails & speaker notes",
    steps: ["Drop a deck or load sample PPTX", "Step through slides or browse filmstrip", "Read speaker notes or export Markdown"],
    accept: { label: "Presentations", types: ".pptx,.ppsx,.pptm,.odp,.ppt" },
    limit: "Runs in your browser",
    keywords: [
      "powerpoint", "powerpoint viewer", "pptx", "pptx viewer", "odp viewer", "ppsx",
      "slides viewer", "presentation reader", "open pptx online", "speaker notes",
    ],
    features: [
      "Renders slide frames, titles, bullets, positioned shapes, tables and embedded images",
      "Thumbnail filmstrip strip plus Previous / Next keyboard & button controls",
      "Side panel with slide speaker notes and full outline",
      "Export slides and notes into a structured Markdown deck",
    ],
  }),
  fileTool({
    id: "pdf-viewer", name: "PDF viewer", group: "View", icon: FileStack,
    description: "View PDF pages in-browser and inspect metadata, embedded fonts and extracted text.",
    takes: "PDF",
    gives: "Visual PDF reader, fonts/metadata inspector & text extract",
    steps: ["Drop a PDF document", "Read pages and inspect PDF fonts & info", "Copy or search extracted text"],
    accept: PDF_ACCEPT,
    limit: "Runs in your browser",
    keywords: [
      "pdf viewer", "open pdf", "pdf reader", "pdf inspector", "pdf fonts",
      "pdf metadata", "pdf text", "view pdf",
    ],
    features: [
      "Embedded native PDF reader with zoom, scroll and print controls",
      "Automatic inspection of PDF version, page count, dimensions, title/author & embedded fonts",
      "Decompresses text streams to extract searchable text right in your browser",
      "Stays 100% on your device with zero uploads",
    ],
  }),
  fileTool({
    id: "csv-viewer", name: "CSV & TSV viewer", group: "View", icon: FileSpreadsheet,
    description: "Filter, sort, search and summarize CSV and TSV tables cleanly in your browser.",
    takes: "CSV or TSV",
    gives: "Sortable data grid, column stats & JSON/Markdown export",
    steps: ["Drop a CSV/TSV file or load sample", "Filter rows, sort columns or inspect cells", "Export JSON, Markdown or clean CSV"],
    accept: { label: "CSV & TSV", types: ".csv,.tsv,.tab,.txt" },
    limit: "Runs in your browser",
    keywords: [
      "csv", "csv viewer", "tsv viewer", "open csv online", "csv reader",
      "csv to json", "csv table", "delimiter", "tabular viewer",
    ],
    features: [
      "Auto-detects comma, tab, semicolon or pipe delimiters plus quoted multiline cells",
      "Instant text filter, one-click column sorting and numeric column statistics",
      "Handles large files fast by slicing the visible grid window cleanly",
      "One-click export to cleaned CSV, JSON array or Markdown table",
    ],
  }),
  fileTool({
    id: "3d-viewer", name: "3D model viewer & inspector", group: "View", icon: Box, wide: true,
    description: "Inspect GLB, GLTF, STL, OBJ (+MTL), FBX, PLY, 3MF & ZIP 3D files with orbit, slicing, mesh tree and exports.",
    takes: "3D model files or .ZIP bundles",
    gives: "Interactive WebGL viewport, measurements & GLB/STL/OBJ/PNG exports",
    steps: ["Drop 3D model files (or try a sample)", "Inspect shading, slices, meshes & stats", "Export PNG, GLB, STL or OBJ"],
    accept: {
      label: "3D models (GLB, GLTF, STL, OBJ, FBX, PLY, 3MF, DAE, ZIP)",
      types: ".glb,.gltf,.stl,.obj,.mtl,.ply,.fbx,.dae,.3mf,.pcd,.xyz,.zip,.bin,.png,.jpg,.jpeg,.webp",
    },
    limit: "Runs in your browser",
    keywords: [
      "3d viewer", "3d model viewer", "glb viewer", "gltf viewer", "stl viewer", "obj viewer", "fbx viewer", "ply viewer",
      "3mf viewer", "dae viewer", "inspect 3d", "mesh viewer", "cad viewer", "webgl viewer", "glb to stl", "stl to glb",
    ],
    features: [
      "Supports GLB, GLTF (with Draco), STL, OBJ + MTL textures, FBX, PLY, 3MF, DAE, PCD, XYZ & ZIP bundles",
      "Orbit, pan, zoom, camera presets (Front/Top/Iso), Perspective/Ortho & auto-rotate",
      "Shading inspector: Textured PBR, Studio Clay, Wireframe, Normals, X-Ray & cross-section slice planes",
      "Mesh hierarchy tree with Hide/Solo, bounding dimensions (mm/cm/m/in), animations & PNG/GLB/STL/OBJ export",
    ],
  }),
  // Convert: the popular pairs
  fileTool({
    id: "pdf-to-word", name: "PDF to Word", group: "Convert", icon: FileText,
    description: "An editable Word document from your PDF.",
    takes: "One PDF", gives: "DOCX", steps: ["Add a PDF", "Convert it", "Download"],
    accept: PDF_ACCEPT, preset: { from: ["pdf"], to: "docx" },
    keywords: ["pdf to word", "pdf to docx", "docx", "word", "editable", "convert", "pdf"],
    features: ["Text, tables and images, editable in Word", "Keeps the layout as closely as it can", "Scans need OCR first"],
  }),
  fileTool({
    id: "pdf-to-excel", name: "PDF to Excel", group: "Convert", icon: FileSpreadsheet,
    description: "Tables from your PDF, ready in Excel.",
    takes: "One PDF", gives: "XLSX", steps: ["Add a PDF", "Choose the sheets", "Download"],
    accept: PDF_ACCEPT, preset: { from: ["pdf"], to: "xlsx" },
    keywords: ["pdf to excel", "pdf to xlsx", "xlsx", "table", "spreadsheet", "extract table", "convert", "pdf"],
    features: ["Finds the tables on every page", "Numbers stay numbers", "A sheet per table, or per page"],
  }),
  fileTool({
    id: "pdf-to-powerpoint", name: "PDF to PowerPoint", group: "Convert", icon: Presentation,
    description: "Each PDF page as an editable slide.",
    takes: "One PDF", gives: "PPTX", steps: ["Add a PDF", "Convert it", "Download"],
    accept: PDF_ACCEPT, preset: { from: ["pdf"], to: "pptx" },
    keywords: ["pdf to powerpoint", "pdf to pptx", "pptx", "slides", "presentation", "convert", "pdf"],
    features: ["One slide per page", "Text and shapes stay editable", "Opens in PowerPoint, Keynote and Google Slides"],
  }),
  fileTool({
    id: "pdf-to-jpg", name: "PDF to JPG", group: "Convert", icon: FileImage,
    description: "Each page as an image, or the pictures inside.",
    takes: "One PDF", gives: "JPG, or a ZIP", steps: ["Add a PDF", "Choose the images", "Download"],
    accept: PDF_ACCEPT, preset: { from: ["pdf"], to: "jpg" },
    keywords: ["pdf to jpg", "pdf to image", "pdf to png", "jpg", "png", "image", "extract images", "convert", "pdf"],
    features: ["Pages as JPG at 72, 150 or 300 dpi", "Or pull out the original pictures", "Pick the pages you want", "Several images arrive as one ZIP"],
  }),
  fileTool({
    id: "word-to-pdf", name: "Word to PDF", group: "Convert", icon: FileText,
    description: "Turn DOC and DOCX files into PDF.",
    takes: "DOC, DOCX, ODT, RTF", gives: "PDF", steps: ["Add a document", "Convert it", "Download"],
    accept: { label: "Word documents", types: dotted(OFFICE_FORMATS.word) },
    preset: { from: OFFICE_FORMATS.word, to: "pdf" },
    keywords: ["word to pdf", "docx to pdf", "doc", "docx", "odt", "rtf", "convert", "pdf"],
    features: ["Keeps fonts, tables, images and layout", "DOC, DOCX, ODT and RTF", "Preview the PDF before you save it"],
  }),
  fileTool({
    id: "powerpoint-to-pdf", name: "PowerPoint to PDF", group: "Convert", icon: Presentation,
    description: "Turn slides into a PDF, one page per slide.",
    takes: "PPT, PPTX, ODP", gives: "PDF", steps: ["Add slides", "Convert them", "Download"],
    accept: { label: "Presentations", types: dotted(OFFICE_FORMATS.slides) },
    preset: { from: OFFICE_FORMATS.slides, to: "pdf" },
    keywords: ["powerpoint to pdf", "ppt to pdf", "pptx to pdf", "slides", "presentation", "convert", "pdf"],
    features: ["One page per slide", "PPT, PPTX, PPS and ODP", "Preview the PDF before you save it"],
  }),
  fileTool({
    id: "excel-to-pdf", name: "Excel to PDF", group: "Convert", icon: FileSpreadsheet,
    description: "Turn spreadsheets into PDF.",
    takes: "XLS, XLSX, ODS, CSV", gives: "PDF", steps: ["Add a spreadsheet", "Choose the fit", "Download"],
    accept: { label: "Spreadsheets", types: dotted(OFFICE_FORMATS.sheets) },
    preset: { from: OFFICE_FORMATS.sheets, to: "pdf" },
    keywords: ["excel to pdf", "xlsx to pdf", "xls", "csv to pdf", "spreadsheet", "sheet", "convert", "pdf"],
    features: ["Every sheet included", "Option: each sheet on a single page", "XLS, XLSX, ODS and CSV"],
  }),
  // Compress
  fileTool({
    id: "compress-files", name: "Compress files", group: "Compress", icon: Shrink,
    description: "Make any file smaller: PDF, Word, PowerPoint, Excel, photos, audio, video and more.",
    takes: "Up to 20 files, any kind", gives: "Smaller files", limit: "Up to 20 files, 150 MB",
    steps: ["Add files", "Pick a strength", "Download"],
    accept: { label: "Any file", types: "" },
    keywords: [
      "compress", "compressor", "shrink", "reduce", "reduce size", "smaller", "file size", "optimize", "zip",
      "compress pdf", "compress word", "compress docx", "compress powerpoint", "compress pptx", "compress excel",
      "compress video", "compress mp4", "compress audio", "compress mp3", "compress wav", "compress image", "compress heic", "compress font",
    ],
    features: [
      "PDF, Word, PowerPoint, Excel and EPUB: pictures inside are re-encoded",
      "Photos (HEIC, TIFF, BMP, RAW…), audio and video",
      "Fonts to WOFF2, JSON minified, anything else zipped",
      "Light, Recommended or Strong",
      "Before and after size for every file; nothing ever grows",
    ],
  }),
  fileTool({
    id: "archive-extractor-creator", name: "ZIP, TAR & GZ archive tool", group: "Compress", icon: Archive,
    description: "Inspect archive contents, preview files inside or bundle multiple files into .zip, .tar, .tar.gz or .gz in your browser.",
    takes: "Archives or multiple files", gives: "Extracted files or a .zip / .tar.gz bundle",
    steps: ["Drop an archive or files", "Inspect or build your bundle", "Extract or download"],
    accept: { label: "Archives (.zip, .tar, .tar.gz, .gz)", types: ".zip,.tar,.tgz,.gz" },
    keywords: ["zip extractor", "unzip online", "create zip", "tar gz extractor", "untar in browser", "gzip online"],
    features: ["Inspect entries, sizes and folders inside .zip, .tar, .tar.gz and .gz", "Text preview and single-file download without extracting everything", "Bundle files cleanly into standard .zip, .tar, .tar.gz or .gz archives"],
  }),
  // Merge & split
  fileTool({
    id: "merge-files", name: "Merge files", group: "Merge & split", icon: Merge,
    description: "Combine Word, PowerPoint, Excel, CSV, PDF, audio or video files into one.",
    takes: "2 to 20 files of one kind", gives: "One file", limit: "Up to 20 files, 150 MB",
    steps: ["Add files", "Set the order", "Download"],
    accept: { label: "Word, PowerPoint, Excel, CSV, PDF, audio or video", types: "" },
    keywords: [
      "merge", "combine", "join", "append", "concatenate", "merge word", "merge docx", "combine word documents",
      "merge powerpoint", "merge pptx", "combine slides", "merge excel", "combine excel", "merge csv", "combine csv", "stack",
      "merge pdf", "merge audio", "join mp3", "merge video", "join mp4",
    ],
    features: [
      "Word: styles, pictures and numbering kept, each on a new page",
      "PowerPoint: every deck keeps its own design and speaker notes",
      "Excel and CSV: sheets side by side, or rows stacked by column name",
      "PDF, audio and video too, in the order you set",
    ],
  }),
  fileTool({
    id: "split-files", name: "Split files", group: "Merge & split", icon: Split,
    description: "Break Word, PowerPoint, Excel, CSV, PDF, audio or video into parts.",
    takes: "One file", gives: "Parts in a ZIP",
    steps: ["Add a file", "Choose the parts", "Download"],
    accept: { label: "Word, PowerPoint, Excel, CSV, PDF, audio or video", types: "" },
    keywords: [
      "split", "separate", "divide", "break", "cut", "split word", "split docx", "split by heading", "split chapters",
      "split powerpoint", "split pptx", "split slides", "split excel", "split sheets", "split csv", "split rows", "split by column",
      "split pdf", "split audio", "cut mp3", "split video", "cut mp4",
    ],
    features: [
      "Word: at headings, page breaks or pages",
      "PowerPoint and PDF: each, every few, or ranges you type",
      "Excel and CSV: by sheet, every N rows, or by a column's values",
      "Audio and video: every few minutes, in equal parts, or at times you type",
    ],
  }),
];

/**
 * The Developer, Text and Everyday utilities: one Tool per page, generated from the catalogue
 * (each page is a shared engine with a preset; see components/tools/utilities).
 */
const utilityTools: Tool[] = UTILITIES.map((u) => {
  const info = ENGINE_INFO[u.engine];
  return {
    id: u.id,
    name: u.name,
    category: u.cluster === "dev" ? "Developers" : u.cluster === "text" ? "Text" : u.cluster === "design" ? "Design" : "Utilities",
    description: u.description,
    status: "live",
    icon: u.icon,
    kind: u.engine === "device" ? "generate" : "text",
    takes: info.takes,
    gives: info.gives,
    limit: info.server ? "Public addresses only" : "Runs in your browser",
    steps: info.steps,
    keywords: u.keywords,
    family: u.cluster === "dev" ? "developer" : u.cluster === "text" ? "text" : undefined,
    group: u.group as DevGroup | TextGroup | EverydayGroup | DesignGroup,
    features: info.features,
  } satisfies Tool;
});

/** Standalone pages for the most-searched tabs of the developer hub: same workspace, opened on that tab. */
const devTab = (id: string, tab: string, name: string, group: DevGroup, icon: LucideIcon, description: string, keywords: string[], features: string[]): Tool => ({
  id,
  name,
  category: "Developers",
  family: "developer",
  group,
  description,
  status: "live",
  icon,
  kind: "text",
  takes: "Text, JSON or tokens",
  gives: "The result, live",
  limit: "Runs in your browser",
  steps: ["Paste your input", "See the result", "Copy it"],
  keywords,
  features,
  devTab: tab,
});
const devTabTools: Tool[] = [
  devTab("json-formatter", "json", "JSON formatter & validator", "XML & JSON", FileJson, "Format, validate, minify and browse JSON, with errors pointed out.", ["json formatter", "json beautifier", "json validator", "pretty print json", "json viewer", "json minify", "json lint", "json to csv"], ["Errors point to the line and column", "Beautify, minify, sort keys", "Browse it as a tree; JSON to CSV", "Nothing leaves your browser"]),
  devTab("jwt-decoder", "jwt", "JWT decoder", "Encode", KeySquare, "Decode a JSON Web Token's header and claims, and verify its signature.", ["jwt decoder", "jwt debugger", "decode jwt", "jwt verify", "json web token", "jwt parser", "bearer token"], ["Header, claims and expiry made readable", "Verify HS256/384/512 with your secret", "Nothing leaves your browser: safe for real tokens"]),
  devTab("base64-encoder", "base64", "Base64 encode & decode", "Encode", Binary, "Encode text or files to Base64, or decode it back, including data URLs.", ["base64 encode", "base64 decode", "base64 converter", "base64 to image", "image to base64", "data url", "base64url"], ["Text or files, both directions", "Standard and URL-safe Base64", "Decoded images previewed", "Nothing leaves your browser"]),
  devTab("regex-tester", "regex", "Regex tester", "Format & validate", Regex, "Test a regular expression and see every match and group, live.", ["regex tester", "regular expression tester", "regex101", "regex match", "test regex online", "javascript regex"], ["Every match and capture group highlighted", "Flags: global, case, multiline, dotall, unicode", "Replace preview with $1 groups", "Live as you type"]),
  devTab("timestamp-converter", "time", "Unix timestamp converter", "Encode", Clock, "Unix time to a date and back, in seconds or milliseconds, any time zone.", ["unix timestamp", "epoch converter", "timestamp to date", "date to timestamp", "unix time", "epoch time", "milliseconds to date"], ["Seconds or milliseconds, detected", "Local, UTC and ISO 8601", "Relative time (3 days ago)", "Live current timestamp"]),
  devTab("diff-checker", "diff", "Diff checker", "Edit & view", GitCompare, "Compare two texts and see exactly what was added, removed or changed.", ["diff checker", "text compare", "compare two texts", "diff tool", "find differences", "text diff online", "code compare"], ["Line and word differences highlighted", "Side by side or inline", "Ignore whitespace or case", "Nothing leaves your browser"]),
  devTab("uuid-generator", "uuid", "UUID, ULID & NanoID generator", "Hash & random", Fingerprint, "Generate sortable UUID v7, ULID, UUID v4 or custom NanoIDs in bulk (up to 500).", ["uuid generator", "uuid v7", "ulid generator", "nanoid generator", "bulk uuid"], ["UUID v4, UUID v7, ULID and customizable NanoID", "Generate up to 500 IDs in one click", "Export as Lines, JSON array, CSV or SQL values", "Cryptographically random in your browser"]),
  devTab("url-encoder", "url", "URL encoder & query parser", "Encode", Link2, "Encode/decode URLs and edit URL query parameters in a live key-value table.", ["url encoder", "url decoder", "query string parser", "url params builder", "percent encoding"], ["Interactive key-value query parameter editor", "One-click sort, trim or remove empty parameters", "Full URL encode, decode and Query JSON preview", "Everything stays in your browser"]),
];

export const toolHref = (id: string) => `/tools/${id}`;

/** Tools whose work never leaves the device (the utilities say so in their own `limit`). */
const ON_DEVICE = new Set([
  "meme-generator",
  "photo-editor",
  "pro-photo-editor",
  "font-creator",
  "dev",
  "contrast-checker",
  "css-generator",
  "svg-optimizer-jsx",
  "css-grid-flexbox-playground",
  "color-palette-scale-generator",
  "image-to-svg",
  "mockup-frame-generator",
  "archive-extractor-creator",
  "audio-waveform-generator",
  "writing",
  "document-viewer",
  "3d-viewer",
]);

/**
 * Where a tool does its work and how long anything is kept, for the tool page's spec sheet.
 * Mirrors each workspace's footer note; undefined when the tool's `limit` already says it.
 */
export function wherePrivacy(tool: Tool): string | undefined {
  if (tool.status !== "live") return undefined;
  if (tool.limit === "Public addresses only") return "Runs on our server";
  if (/browser/i.test(tool.limit ?? "") || tool.family === "developer" || tool.family === "text" || tool.category === "Utilities") return undefined;
  if (ON_DEVICE.has(tool.id)) return "Stays on your device";
  if (tool.kind === "link") return "Fetched on our server, deleted once sent";
  if (tool.id === "audio-to-text") return "On our server or Groq's Whisper, then deleted";
  if (tool.id === "song-finder") return "Clips go to our server and Groq's Whisper, then deleted at once";
  if (tool.id === "pdf" || tool.family === "pdf") return "On our server, deleted within 30 min";
  if (tool.id === "color-picker") return "Pictures stay on your device; documents are deleted after";
  return "On our server, deleted once done";
}
export const getTool = (id: string) => tools.find((t) => t.id === id);
export const stepsFor = (tool: Tool) => tool.steps ?? defaultSteps[tool.kind];

/**
 * Tools that execute heavy media, document, OCR, AI/ML, headless Chromium, LibreOffice or yt-dlp
 * workloads on the free-tier backend (`512 MB RAM`). Marked Beta across the UI and serialized
 * behind the backend heavy lane so concurrent requests never overload or crash the server.
 */
export const SERVER_HEAVY_TOOL_IDS = new Set<string>([
  "youtube",
  "instagram",
  "facebook",
  "audio",
  "audio-to-text",
  "translator",
  "interpreter",
  "song-finder",
  "trim-media",
  "noise-remover",
  "audio-volume",
  "color-picker",
  "convert-anything",
  "compress-files",
  "merge-files",
  "split-files",
  "pdf-to-word",
  "pdf-to-excel",
  "pdf-to-powerpoint",
  "pdf-to-jpg",
  "word-to-pdf",
  "powerpoint-to-pdf",
  "excel-to-pdf",
  "pdf",
  "merge-pdf",
  "split-pdf",
  "organize-pdf",
  "scan-to-pdf",
  "compress-pdf",
  "repair-pdf",
  "ocr-pdf",
  "pdf-to-pdfa",
  "jpg-to-pdf",
  "html-to-pdf",
  "page-numbers",
  "watermark-pdf",
  "crop-pdf",
  "edit-pdf",
  "unlock-pdf",
  "protect-pdf",
  "sign-pdf",
  "redact-pdf",
  "compare-pdf",
  "image",
  "compress-image",
  "upscale-image",
  "remove-background",
  "resize-image",
  "crop-image",
  "rotate-image",
  "convert-image",
  "html-to-image",
  "watermark-image",
  "blur-face",
]);

const rawTools: Tool[] = [
  {
    id: "youtube",
    name: "YouTube downloader",
    category: "Downloads",
    description: "Save videos and Shorts in the quality you pick, or just the audio as MP3 or M4A.",
    status: "live",
    icon: Download,
    kind: "link",
    takes: "A public YouTube link",
    gives: "MP4 video, MP3 or M4A audio",
    limit: "Up to 4 hours",
    keywords: ["video", "shorts", "save", "yt", "download", "youtube to mp3", "youtube audio", "mp3", "m4a", "extract audio", "song"],
    features: ["Videos and Shorts up to 4 hours", "Pick the quality, up to 1080p, with each size shown", "Or save just the audio: M4A (original sound) or MP3", "Title, channel and length preview before you save"],
    downloader: { platform: "youtube", placeholder: "https://www.youtube.com/watch?v=…", hosts: ["youtube.com", "youtu.be"], examples: ["youtube.com/watch?v=…", "youtube.com/shorts/…", "youtu.be/…"] },
  },
  {
    id: "instagram",
    name: "Instagram downloader",
    category: "Downloads",
    description: "Reels, posts and carousels, or just a reel's audio, straight from a link.",
    status: "live",
    icon: Download,
    kind: "link",
    takes: "A post link or shortcode",
    gives: "MP4, JPG, ZIP, MP3 or M4A",
    limit: "Public posts only",
    keywords: ["reel", "reels", "post", "carousel", "ig", "insta", "download", "reel audio", "reel to mp3", "instagram mp3", "extract audio", "song"],
    features: ["Reels, single posts and carousels", "Carousels arrive as one ZIP", "Save a reel's sound as MP3 or M4A", "Paste a link or just the shortcode"],
    downloader: { platform: "instagram", placeholder: "https://www.instagram.com/reel/…", hosts: ["instagram.com", "instagr.am"], allowShortcode: true, examples: ["instagram.com/reel/…", "instagram.com/p/…", "A bare shortcode"] },
  },
  {
    id: "facebook",
    name: "Facebook downloader",
    category: "Downloads",
    description: "Grab public videos and reels, or just their audio, without the hassle.",
    status: "live",
    icon: Download,
    kind: "link",
    takes: "A public video or reel link",
    gives: "MP4 video, MP3 or M4A audio",
    limit: "Public videos only",
    keywords: ["fb", "video", "reel", "download", "save", "facebook mp3", "facebook audio", "extract audio"],
    features: ["Public videos and reels", "Share links are resolved for you", "Saved as MP4, or just the audio as MP3 or M4A"],
    downloader: { platform: "facebook", placeholder: "https://www.facebook.com/reel/…", hosts: ["facebook.com", "fb.watch", "fb.com"], examples: ["facebook.com/reel/…", "facebook.com/watch?v=…", "fb.watch/…"] },
  },
  {
    id: "video-editor",
    name: "Video editor",
    category: "Edit",
    seoTitle: "Free Online Video Editor: Premiere & CapCut Alternative",
    description: "All-in-one editing, colour grading & VFX suite: custom fonts, 37 kinetic title animations, 46 GPU effects, 3-way wheels/curves/scopes, pro green screen & Premiere/CapCut/AE project import.",
    status: "live",
    icon: Videotape,
    kind: "file",
    wide: true,
    takes: "Videos, music, pictures, fonts or NLE projects (.prproj, .capcut, .aep/.aepx)",
    gives: "MP4, WebM, GIF, audio or Premiere XML/EDL up to 4K",
    limit: "Made in your browser",
    steps: ["Import media or NLE project", "Edit, grade & composite VFX", "Export video up to 4K"],
    options: ["multi-track timeline", "keyframes & motion presets", "46 VFX & colour effects", "3-way wheels, curves & scopes", "Before/After wipe & safe zones", "custom .ttf/.otf fonts", "pro green screen & track mattes", "open .prproj/.capcut/.aep"],
    accept: { label: "MP4, MOV, WebM, MKV, AVI, WMV, MP3, WAV, .prproj, .capcut, .aep/.aepx…", types: "video/*,audio/*,image/*" },
    keywords: [
      "video editor", "online video editor", "free video editor", "edit video", "video editing", "premiere pro", "premiere pro online",
      "open prproj online", "open capcut draft", "open aep online", "custom fonts video editor", "kinetic typography", "color wheels",
      "rgb curves", "video scopes", "waveform monitor", "vectorscope", "luts", "cube lut export", "motion tracker", "track matte", "unmult",
      "lens flare", "god rays", "film halation", "tilt shift", "3d perspective", "before after wipe", "reels safe zone", "tiktok safe zone",
      "copy paste clip attributes", "sync grade", "detach audio", "extract audio", "1 click motion presets", "pinch zoom timeline",
      "premiere alternative", "after effects", "after effects online", "capcut", "capcut online", "capcut alternative", "davinci resolve online",
      "imovie online", "clipchamp alternative", "timeline", "multi track", "cut video", "merge videos", "join videos", "combine videos",
      "add music to video", "add text to video", "titles", "auto captions", "auto subtitles", "subtitle generator", "remove silence",
      "silence remover", "jump cut", "green screen", "chroma key", "keyframes", "keyframe animation", "motion graphics", "color grading",
      "colour grading", "transitions", "cross dissolve", "remove background from video", "4k export", "no watermark", "shorts editor",
      "reels editor", "tiktok editor", "vertical video", "picture in picture", "slow motion", "speed up video", "glitch effect",
      "speed ramp", "velocity edit", "speed curve", "reverse video", "freeze frame", "split screen", "blur background video", "lut",
      "film grain", "vhs effect", "light leak", "camera shake", "zoom transition", "text to speech", "voice over", "voice changer",
      "beat sync", "audio ducking", "normalize audio", "stabilize video", "auto reframe", "scene detection", "transcript editing",
      "remove filler words", "translate subtitles", "srt", "gif maker", "webm", "screen recorder", "ripple edit", "slip edit",
    ],
    features: [
      "Multi-track timeline with Premiere tools, Copy/Paste attributes, 1-tap Sync grade, Detach Audio & 1-click keyframe motion presets",
      "GPU Before/After split-screen comparison wipe + Broadcast, Golden Ratio, Reels, TikTok & Shorts safe-zone overlays",
      "46 GPU effects including optical VFX (lens flare, god rays, 35mm halation, prism, heat haze, shockwave, tilt-shift, CRT, 3D tilt, particles)",
      "Full DaVinci-style colour suite: 3-way Color Wheels, monotone RGB Tone Curves, 8-band HSL mixer, live Video Scopes & .cube LUT export",
      "Custom .ttf/.otf/.woff/.woff2 & Google Fonts manager + 37 kinetic/per-character/mask/curved-arc/3D-extruded title animations",
      "Pro Chroma Key (choke/feather/spill kill/light wrap), Unmult, Track Mattes, 2D Point Tracker & responsive mobile/tablet/desktop/ultrawide layout",
      "Open raw edit projects from Premiere Pro (.prproj, .xml, FCPXML, EDL), CapCut (.capcut/draft_content.json) and After Effects (.aep, .aepx, Lottie)",
    ],
  },
  {
    id: "music-studio",
    name: "Music studio",
    category: "Create",
    seoTitle: "Free AI Music Studio — Song Maker, Online DAW & Audio Editor",
    description: "Make full songs with AI vocals from a prompt, then record, produce, mix and master on a multi-track studio. Free, no sign-up, made in your browser.",
    status: "live",
    icon: Music4,
    kind: "generate",
    wide: true,
    takes: "A song idea, lyrics, a picture, your voice or instrument, or audio, video and MIDI files",
    gives: "MP3, WAV (16/24/32-bit), AAC, Opus, stems and MIDI",
    limit: "Made in your browser",
    steps: ["Create or record", "Arrange & mix", "Export"],
    options: [
      "AI songs with vocals & lyrics",
      "backing tracks to any length",
      "image to music",
      "on-device MusicGen",
      "multi-track recording",
      "piano roll & step sequencer",
      "26 instruments, 7 drum kits",
      "14 effects & vocal presets",
      "audio editor & noise reduction",
      "auto-tune, stems, hum to MIDI",
      "mastering to LUFS",
      "podcast auto-ducking",
    ],
    accept: { label: "WAV, MP3, M4A, FLAC, OGG, MP4, MOV, MIDI, .dwylsong", types: "audio/*,video/*,.mid,.midi" },
    keywords: [
      "music studio", "ai music generator", "ai song generator", "song maker", "make a song", "text to music", "text to song", "lyrics to song", "ai vocals", "ai singer",
      "suno alternative", "suno free", "udio alternative", "musicgpt alternative", "mubert alternative", "soundraw alternative", "musicai", "canva music generator",
      "royalty free music", "background music generator", "music for videos", "podcast music", "beat maker", "make beats online", "drum machine", "step sequencer",
      "online daw", "daw online free", "bandlab alternative", "garageband online", "garageband for windows", "fl studio online", "fl studio mobile alternative", "n-track",
      "audacity online", "audio editor online", "multitrack recorder", "record vocals online", "voice recorder", "piano roll", "midi editor", "virtual piano", "virtual instruments",
      "synthesizer online", "808", "trap beat maker", "lofi beat maker", "chord progression generator", "melody generator", "lyrics generator", "ai lyrics",
      "auto tune online", "autotune", "pitch correction", "vocal effects", "voice changer", "noise reduction", "remove background noise", "vocal remover", "karaoke maker",
      "stem splitter", "stem separation", "split vocals and instruments", "hum to midi", "audio to midi", "bpm detector", "key finder", "tuner online", "guitar tuner", "metronome",
      "mastering online", "free mastering", "lufs normalize", "mixer", "audio mixing", "reverb", "delay", "compressor", "eq", "sound effects generator", "sfx generator",
      "text to speech", "voice over", "audio story", "podcast editor", "auto ducking", "mp3 export", "wav export", "midi export", "image to music", "music from image",
    ],
    features: [
      "AI songs from a prompt (Suno/MusicGPT-style): structure, chords, lyrics in 15 languages and a sung, auto-tuned vocal with harmonies, or rap",
      "Instant royalty-free backing tracks in 18 genres, fitted to any length up to 10 minutes or to a video's exact duration (Canva/Soundraw/Mubert-style)",
      "Image to music, plus Meta's MusicGen text-to-audio running on your device, a lyric writer, loops in your key and 18 synthesised sound effects",
      "Multi-track recording with count-in, metronome and monitoring; piano roll, drum step sequencer, chord pads, musical typing and MIDI keyboards",
      "26 instruments and 7 drum kits, 14 effects with one-tap vocal presets, mixer with ducking and automation, mastering to −14/−16 LUFS",
      "Audacity-grade editing: cut, fades, normalise, speed/tempo/pitch, noise reduction, truncate silence, auto-tune, vocal remover, stems, hum to MIDI, spectrogram",
      "Export MP3, WAV, AAC, Opus, stems and MIDI; projects autosave on the device and travel as .dwylsong files. Works on phones, tablets and desktops",
    ],
  },
  {
    id: "video-to-frames",
    name: "Video to frames",
    category: "Convert",
    description: "Split a video into still frames: pick how many, which part and the format.",
    status: "live",
    icon: Film,
    kind: "file",
    takes: "A video (MP4, MOV, WebM…)",
    gives: "JPG, PNG or WebP frames (ZIP)",
    limit: "Up to 500 frames, made in your browser",
    steps: ["Add a video", "Pick the frames", "Download"],
    accept: { label: "MP4, MOV, WebM, M4V…", types: "video/*" },
    keywords: ["video to frames", "extract frames", "video to images", "video to jpg", "video to png", "frame grabber", "screenshots from video", "split video into frames", "frame extractor", "contact sheet", "thumbnails"],
    features: ["A number of frames, one every few seconds, or N per second", "Trim to any part with a live preview", "JPG, PNG or WebP at full or smaller size", "Pick the frames you want, download a ZIP, or a contact sheet", "Your video is never uploaded"],
  },
  {
    id: "video-to-gif",
    name: "Video to GIF",
    category: "Convert",
    description: "Turn a clip into a GIF: trim it, set the size, smoothness, speed and loop.",
    status: "live",
    icon: Clapperboard,
    kind: "file",
    takes: "A video (MP4, MOV, WebM…)",
    gives: "An animated GIF",
    limit: "Up to 30 s of video, made in your browser",
    steps: ["Add a video", "Trim and style", "Download"],
    accept: { label: "MP4, MOV, WebM, M4V…", types: "video/*" },
    keywords: ["video to gif", "mp4 to gif", "gif maker", "make a gif", "clip to gif", "mov to gif", "webm to gif", "gif from video", "boomerang"],
    features: ["Trim to the moment with a live preview", "5 to 25 frames a second, 240 to 800 px wide", "Speed from 0.25× to 4×, boomerang, loop or play once", "Size estimate before, exact size after", "Your video is never uploaded"],
  },
  {
    id: "trim-media",
    name: "Trim & cut video or audio",
    category: "Edit",
    wide: true,
    description: "Cut a video or audio file cleanly or split it into multiple parts on a waveform timeline, in your chosen format.",
    status: "live",
    icon: Scissors,
    kind: "file",
    takes: "A video or audio file",
    gives: "Trimmed clip, ZIP of parts, or joined highlights in MP4, MOV, MKV, WebM, GIF, MP3, WAV…",
    limit: "Up to 150 MB",
    steps: ["Drop video or audio", "Mark cuts on the waveform & pick format", "Download clip(s)"],
    accept: { label: "MP4, MOV, MKV, WebM, MP3, WAV, M4A…", types: "audio/*,video/*,.mkv,.avi,.flac,.opus,.m4a,.wma,.amr,.3gp" },
    keywords: [
      "trim video", "cut video", "video cutter", "trim audio", "cut mp3", "audio cutter", "ringtone maker",
      "clip video", "shorten video", "mp3 cutter", "video trimmer", "cut video in parts", "split video", "split audio",
    ],
    features: [
      "Live video preview + interactive audio waveform with scrub & keyboard shortcuts",
      "Single clip trim OR multi-part cutter (drop cuts while playing, split equal parts, keep/skip clips, or join kept parts)",
      "Choose desired output format: keep original, MP4, MOV, MKV, WebM, GIF, or extract MP3 / M4A / WAV / FLAC / OGG / OPUS",
      "Fast lossless stream copy or frame-exact cut, with inline browser preview for every cut part",
    ],
  },
  {
    id: "split-media",
    name: "Video & audio multi-cutter",
    category: "Edit",
    wide: true,
    description: "Cut a video or song into several clips visually on a waveform timeline, drop unwanted parts, or export in your chosen format.",
    status: "live",
    icon: Split,
    kind: "file",
    takes: "A video or audio file",
    gives: "Separate parts (ZIP) or joined clip in MP4, MOV, MKV, WebM, GIF, MP3, WAV…",
    limit: "Up to 150 MB",
    steps: ["Drop video or audio", "Place cut markers or split parts & choose format", "Preview & download"],
    accept: { label: "MP4, MOV, MKV, WebM, MP3, WAV, M4A…", types: "audio/*,video/*,.mkv,.avi,.flac,.opus,.m4a,.wma,.amr,.3gp" },
    keywords: [
      "cut video into parts", "split video into parts", "video splitter", "audio splitter", "cut audio into parts",
      "multi part video cutter", "split mp3", "split mp4", "cut scenes", "remove middle of video", "clip splitter",
    ],
    features: [
      "Click 'Add cut at playhead' (or press C) while watching/listening on a waveform timeline",
      "Auto-split into N equal parts, fixed second intervals, or custom start/end clip ranges",
      "Toggle Keep / Skip on any segment to remove filler or download selected parts in one ZIP or joined file",
      "Output to original format, MP4, MOV, MKV, WebM, GIF, MP3, M4A, WAV, FLAC, OGG or OPUS, with inline clip preview",
    ],
  },
  {
    id: "noise-remover",
    name: "Noise remover",
    category: "Edit",
    description: "Remove background noise, hiss, hum and clicks from audio or a video's sound.",
    status: "live",
    icon: AudioWaveform,
    kind: "file",
    takes: "A video or audio file",
    gives: "The same format, cleaner",
    limit: "Up to 150 MB",
    steps: ["Add a file", "Pick the strength", "Compare and download"],
    accept: { label: "MP4, MOV, MKV, WebM, MP3, WAV, M4A…", types: "audio/*,video/*,.mkv,.avi,.flac,.opus,.m4a,.wma,.amr,.3gp" },
    keywords: ["noise remover", "remove background noise", "noise reduction", "denoise audio", "remove hiss", "remove hum", "clean audio", "remove noise from video", "background noise removal", "audio cleaner", "remove static", "fan noise", "voice cleaner", "podcast cleanup"],
    features: [
      "Learns the noise from the quietest moment (or a part you pick), then removes it",
      "Hiss, fan, traffic and room noise; 50/60 Hz mains hum found by itself",
      "Speech mode trims rumble and hiss; clicks and pops smoothed if you like",
      "Flip between before and after while it plays",
      "Video keeps its picture untouched; deleted from our server once sent",
    ],
  },
  {
    id: "audio-volume",
    name: "Volume booster & normaliser",
    category: "Edit",
    description: "Make audio or a video louder or quieter, even out the loudness, or mute a video.",
    status: "live",
    icon: Volume2,
    kind: "file",
    takes: "A video or audio file",
    gives: "The same format, louder, even or silent",
    limit: "Up to 150 MB",
    steps: ["Add a file", "Pick boost, normalise or mute", "Download"],
    accept: { label: "MP4, MOV, MKV, WebM, MP3, WAV, M4A…", types: "audio/*,video/*,.mkv,.avi,.flac,.opus,.m4a,.wma,.amr,.3gp" },
    keywords: ["volume booster", "increase volume", "make audio louder", "boost mp3", "normalize audio", "loudness normalization", "mute video", "remove audio from video", "silent video", "decrease volume", "amplify audio"],
    features: [
      "Boost or lower by up to 30 dB, with a limiter so it doesn't clip",
      "Normalise to the -16 LUFS podcasts and streaming use",
      "Mute a video without re-encoding the picture",
      "Hear the change in the browser before you process it",
      "Deleted from our server once it's sent",
    ],
  },
  {
    id: "screen-recorder",
    name: "Screen & voice recorder",
    category: "Record",
    description: "Record your screen, a window or a tab with your voice, or just your voice.",
    status: "live",
    icon: MonitorPlay,
    kind: "generate",
    takes: "Your screen and microphone",
    gives: "MP4 or WebM video, or audio",
    limit: "Recorded in your browser",
    steps: ["Pick screen or voice", "Record", "Save it"],
    keywords: ["screen recorder", "record screen", "screen capture", "voice recorder", "record audio", "online voice recorder", "record my screen", "screencast", "loom alternative", "record tab", "audio recorder"],
    features: [
      "A whole screen, one window or a browser tab",
      "Mix your microphone with the computer's sound",
      "Pause and resume; a live mic level meter",
      "Recorded on your device: nothing is uploaded unless you save it as MP3",
      "No sign-up, no watermark, no time limit",
    ],
  },
  {
    id: "subtitle-editor",
    name: "Subtitle editor",
    category: "Edit",
    description: "Fix subtitle timing, translate captions into 100+ languages, sync to a video, and save as SRT or VTT.",
    status: "live",
    icon: Captions,
    kind: "file",
    takes: "An SRT or VTT file, or nothing",
    gives: "SRT, VTT, translated captions or plain text",
    limit: "Edited in your browser",
    steps: ["Open subtitles", "Fix timing, text or translate", "Copy or download"],
    accept: { label: "SRT or VTT", types: ".srt,.vtt,text/vtt" },
    keywords: ["subtitle editor", "srt editor", "vtt editor", "edit subtitles", "translate subtitles", "subtitle translator", "subtitle sync", "shift subtitles", "subtitle delay", "fix subtitle timing", "caption editor", "srt to vtt", "subtitle timing"],
    features: [
      "Shift every line earlier or later, or from one line on",
      "Edit, add, delete and split lines; overlaps flagged and fixed",
      "Translate every caption line into 100+ languages while keeping timestamps",
      "Convert between frame rates (23.976, 25, 29.97…)",
      "Preview on your own video, with the subtitles drawn on it",
      "Copy source or translated text, or save SRT, VTT or plain text",
    ],
  },
  {
    id: "audio-waveform-generator",
    name: "Audio waveform & spectrogram",
    category: "Create",
    description: "Turn any audio clip into a downloadable SVG/PNG waveform or STFT frequency spectrogram.",
    status: "live",
    icon: AudioWaveform,
    kind: "file",
    takes: "An audio or video file",
    gives: "SVG or high-res PNG graphic",
    steps: ["Drop an audio file", "Pick waveform or spectrogram", "Export SVG or PNG"],
    limit: "Runs in your browser",
    keywords: ["audio waveform generator", "spectrogram generator", "podcast visualizer", "audio spectrum png", "svg waveform"],
    features: [
      "Bars, smooth curve, mirror and radial circular waveforms",
      "Real Radix-2 FFT STFT frequency spectrogram heatmap",
      "Transparent or custom-coloured crisp SVG and 4K PNG download",
      "Includes a built-in synth sample so you can preview immediately",
    ],
  },
  {
    id: "audio",
    name: "Video to MP3",
    category: "Convert",
    description: "Pull a clean MP3 out of any video file.",
    status: "live",
    icon: AudioLines,
    kind: "file",
    takes: "A video file",
    gives: "MP3 audio",
    limit: "Up to 150 MB",
    steps: ["Add a video", "Pick the quality", "Save the MP3"],
    accept: { label: "MP4, MOV, MKV, WebM, AVI…", types: "video/*,.mkv,.avi,.flv,.wmv,.mts,.m2ts,.3gp" },
    keywords: ["mp3", "music", "extract", "convert", "sound", "audio", "video", "video to mp3", "mp4 to mp3"],
    features: [
      "MP4, MOV, MKV, WebM, AVI, FLV and every other video format",
      "128, 192 or 320 kbps, ready for any player",
      "Listen before you save",
      "Your video is deleted once the MP3 is sent",
    ],
    preset: { from: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "flv", "wmv", "3gp", "mpeg", "mts", "ogv"], to: "mp3" },
  },
  {
    id: "song-finder",
    name: "Song finder",
    category: "Audio & video",
    description: "Hum, sing or type a few words and find the song, with its lyrics, a preview to play and the music video.",
    seoTitle: "Song Finder: Find a Song by Humming, Singing or Lyrics",
    status: "live",
    icon: MicVocal,
    kind: "file",
    takes: "Your voice (sing or hum), music playing nearby, a clip, or lyrics you remember",
    gives: "The song, its lyrics, a 30-second preview and the music video",
    limit: "Clips up to 15 s recorded or 4 MB uploaded",
    steps: ["Sing, hum or type", "We find the song", "Listen, watch, read"],
    accept: { label: "Audio or video clip", types: "audio/*,video/*,.mp3,.m4a,.wav,.ogg,.oga,.opus,.webm,.weba,.aac,.flac,.mp4,.mov,.3gp,.amr" },
    keywords: [
      "song finder", "find song", "what song is this", "what's this song", "name that song", "identify song", "song identifier", "song recognition",
      "music recognition", "recognize song", "shazam", "shazam alternative", "hum to search", "hum a song", "humming", "sing to search", "whistle",
      "find song by lyrics", "lyrics search", "search lyrics", "lyrics finder", "song lyrics", "song from lyrics", "song name", "music finder",
      "find music video", "song video", "song preview", "soundhound", "midomi", "tune", "melody", "bollywood song", "song stuck in my head",
    ],
    features: [
      "Sing a line, hum the tune, or hold your phone to music playing nearby",
      "Or type lyrics you half-remember: misheard and misspelt words are fine",
      "Every answer is checked against the song's real lyrics, and the matching line is highlighted",
      "Play a 30-second preview, watch the music video and read the full lyrics on one page",
      "Works with songs in many languages, from pop and rock to Bollywood and K-pop",
      "Humming works best for well-known melodies; words always work better",
    ],
  },
  {
    id: "audio-to-text",
    name: "Audio to text",
    category: "Convert",
    description: "Turn speech into text you can edit, translate into 100+ languages, copy or subtitle.",
    status: "live",
    icon: Captions,
    kind: "file",
    takes: "A recording, or your microphone",
    gives: "Text, translated script, SRT or VTT",
    limit: "Up to 150 MB · 3 hours",
    steps: ["Add a recording", "Transcribe or translate", "Copy or download"],
    accept: {
      label: "Audio or video",
      types: ".mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.wma,.amr,.aiff,.aif,.weba,.mp4,.mov,.mkv,.webm,.avi,.m4v,.3gp,.mpeg,.mpg,audio/*,video/*",
    },
    keywords: ["transcribe", "transcription", "speech", "speech to text", "voice", "dictation", "subtitles", "captions", "srt", "vtt", "meeting", "lecture", "podcast", "interview", "whisper", "audio", "text", "translate audio"],
    features: [
      "Whisper speech recognition in 99 languages, detected for you",
      "Record from your microphone, or add audio or video",
      "Watch the text appear as it's recognised",
      "Read along: the line being heard is highlighted",
      "Translate transcripts into 100+ languages, copy either version, or export TXT, SRT, VTT or JSON",
    ],
  },
  {
    id: "pdf",
    name: "PDF toolkit",
    category: "Documents",
    description: "Merge, split, rearrange and compress PDFs in seconds.",
    status: "live",
    icon: FileStack,
    kind: "file",
    options: ["Merge", "Split", "Organize", "Compress"],
    takes: "One or more PDFs",
    gives: "PDF, or a ZIP of parts",
    limit: "Up to 150 MB",
    steps: ["Add PDFs", "Merge, split or shrink", "Download"],
    accept: { label: "PDF files", types: ".pdf,application/pdf" },
    keywords: ["pdf", "merge", "combine", "join", "split", "extract", "pages", "organize", "reorder", "rearrange", "rotate", "delete pages", "compress", "shrink", "reduce", "smaller", "document"],
    features: [
      "Merge up to 20 PDFs, in the order you set",
      "Split into single pages, or pick on the pages which go together",
      "Reorder, rotate and remove pages, seeing each one",
      "Compress with a strength you choose",
      "Preview the result before you save it",
      "Your files are deleted once the result is sent",
    ],
  },
  {
    id: "image",
    name: "Image studio",
    category: "Images",
    description: "Compress, resize, convert and cut out images in seconds.",
    status: "live",
    icon: ImageIcon,
    kind: "file",
    options: ["Compress", "Resize", "Convert", "Remove background"],
    takes: "JPG, PNG, WebP, HEIC…",
    gives: "Images, or a ZIP",
    limit: "Up to 30 images, 150 MB",
    steps: ["Add images", "Choose options", "Download"],
    accept: { label: "Images", types: "image/*" },
    keywords: ["image", "photo", "picture", "resize", "compress", "convert", "png", "jpg", "webp", "heic", "background", "cut out"],
    features: [
      "Compress, resize, convert and remove backgrounds in one place",
      "Up to 30 images at once",
      "Exact sizes before you download",
      "All 13 image tools are on the Tools page",
    ],
  },
  {
    id: "notepad",
    name: "Smart notepad",
    category: "Text",
    family: "text",
    group: "Analyze",
    description: "Paste any text and see what's in it: counts, emails, links, numbers, hidden characters and stray spaces, with one-click fixes, find & replace and saved notes.",
    status: "live",
    icon: NotebookPen,
    kind: "text",
    takes: "Any text, pasted, typed or a text file",
    gives: "Inspected, cleaned text to copy or save",
    limit: "Saved in your browser only",
    steps: ["Paste your text", "Inspect & fix", "Copy or save"],
    wide: true,
    keywords: [
      "notepad",
      "online notepad",
      "notepad online",
      "text inspector",
      "paste text",
      "scratch pad",
      "clipboard viewer",
      "text checker",
      "find and replace",
      "hidden characters",
      "extract emails",
      "extract links",
      "remove duplicate lines",
      "sort lines",
      "notes",
    ],
    features: [
      "Several notes in tabs, saved as you type in this browser (nothing is uploaded)",
      "Live inspector: words, characters, lines, reading time and what the text is (JSON, CSV, Markdown…)",
      "Finds emails, links, phone numbers, dates, numbers (with sum and average), hashtags and mentions",
      "Spots hidden zero-width characters, odd spaces, repeats, duplicate lines and broken brackets, with one-click fixes",
      "Find & replace with match case, whole words and regex, go to line, and highlights in the text",
      "30+ transforms (case, sort, dedupe, number, clean, JSON) on the whole note or just the selection, all undoable",
    ],
  },
  {
    id: "writing",
    name: "Writing helper & summarizer",
    category: "Text",
    family: "text",
    group: "Analyze",
    description: "Summarise long text into key points, tighten and rewrite it, or fix grammar, right in your browser.",
    status: "live",
    icon: PenLine,
    kind: "text",
    options: ["Summarise", "Rewrite", "Fix grammar"],
    takes: "Any text",
    gives: "Edited text",
    limit: "Runs in your browser",
    steps: ["Paste your text", "Summarise, rewrite or fix", "Copy the result"],
    keywords: ["summary", "summarize", "rewrite", "grammar checker", "writing helper", "proofreader"],
    features: [
      "Extractive key-sentence summaries with adjustable ratio",
      "Concise, Plain English, Formal and Sentence-Split rewrites",
      "Deterministic grammar, spacing, capitalisation and typo fixes",
      "Runs 100% in your browser — nothing you type is sent anywhere",
    ],
  },
  {
    id: "username-generator",
    name: "Username & handle generator",
    category: "Text",
    family: "text",
    group: "Generate",
    description: "Generate tailored usernames from any name or niche, check social & email availability, and discover closest free handles.",
    status: "live",
    icon: AtSign,
    kind: "generate",
    options: ["Clean", "Professional", "Developer", "Creative", "Short"],
    takes: "A name, brand, or keywords",
    gives: "Scored usernames, live social/mail availability & closest alternatives",
    limit: "Live public checks · Free",
    steps: ["Type name & niche", "Toggle social & mail", "Verify & claim handles"],
    wide: true,
    keywords: [
      "username generator", "handle generator", "handle checker", "username availability",
      "social media username checker", "email availability checker", "check username",
      "instagram username ideas", "facebook username checker", "github username checker", "youtube handle checker",
      "bluesky handle", "domain email checker", "gamertag generator", "brand handle",
    ],
    features: [
      "Generates 30+ scored usernames across Clean, Professional, Developer, Creative & Short styles",
      "Toggle individual social platforms (GitHub, YouTube, Bluesky, Mastodon, DEV, Instagram, Facebook, X, Reddit…)",
      "Toggle mail & custom email domains (Gmail, Outlook, Proton rules/registries, Mail.ru, .com/.dev/.io/.in DNS)",
      "When a handle is occupied, automatically suggests and verifies the closest available alternatives",
      "Star favorites to a shortlist and export availability reports as CSV or JSON",
    ],
  },
  {
    id: "api-client",
    name: "API client",
    category: "Developers",
    family: "developer",
    group: "Web & network",
    seoTitle: "Free API Client: Postman Alternative for REST & GraphQL",
    description: "A free, open-source Postman alternative in your browser: collections, environments, auth, scripts and tests, runner, mocks, monitors, flows, docs and code snippets. No sign-up.",
    status: "live",
    icon: Webhook,
    kind: "text",
    wide: true,
    takes: "Requests you build, cURL commands, Postman collections, OpenAPI/Swagger specs, HAR and Insomnia files",
    gives: "Responses with tests and timings, code in 25 languages, Postman v2.1 and OpenAPI exports, API docs",
    limit: "Collections stay in your browser",
    steps: ["Build a request", "Send it", "Test, save & share"],
    options: [
      "REST, GraphQL, WebSocket, Socket.IO, MQTT, gRPC",
      "collections & folders",
      "environments, globals & vault",
      "13 auth types incl. OAuth 2.0",
      "pre-request & test scripts (pm API)",
      "collection runner & data files",
      "performance tests",
      "mock servers",
      "monitors",
      "flows",
      "API docs & OpenAPI specs",
      "code in 25 languages",
    ],
    keywords: [
      "api client", "api tester", "api testing", "test api online", "rest client", "http client", "postman", "postman online", "postman alternative", "postman web", "free postman",
      "postman alternative open source", "insomnia alternative", "hoppscotch alternative", "bruno alternative", "thunder client", "paw", "httpie online", "curl online", "send http request",
      "api request online", "graphql client", "graphql playground", "websocket client", "websocket tester", "socket.io client", "mqtt client", "grpc client", "grpc web client",
      "server sent events", "sse client", "rest api", "collection runner", "api automation", "api test scripts", "pm.test", "newman", "mock server", "mock api", "api mock",
      "api monitor", "uptime monitor", "api documentation generator", "openapi", "swagger", "swagger to postman", "openapi to postman", "curl to code", "code generator",
      "oauth 2.0", "oauth2 token", "jwt bearer", "aws signature", "digest auth", "ntlm", "hawk", "akamai edgegrid", "load testing", "performance testing", "api flows",
    ],
    features: [
      "Postman-style workspace: tabs, collections with folders, environments, globals and a vault; import and export Postman v2.1, OpenAPI 3, Swagger 2, HAR, Insomnia and cURL",
      "HTTP with every method, params and path variables, form-data and binary files, raw JSON/XML, GraphQL with schema explorer; Cloud agent (no CORS limits) or Browser agent (localhost)",
      "13 auth types: API key, Bearer, Basic, Digest, OAuth 1.0, OAuth 2.0 (PKCE, refresh), Hawk, AWS SigV4, NTLM, Akamai EdgeGrid, JWT, ASAP",
      "Pre-request and post-response scripts with Postman's pm API, chai, ajv, CryptoJS and lodash, run in a sandbox; tests, visualizations and generated tests",
      "Collection runner with iterations, CSV/JSON data and setNextRequest; performance tests with virtual users; monitors on a schedule; visual flows",
      "Mock servers from saved examples, generated API documentation, OpenAPI editor, cookie jar, console, timings and TLS details, code in 25 languages",
      "WebSocket, Socket.IO, MQTT and gRPC (proto or server reflection) clients; works on phones, tablets and desktops",
    ],
  },
  {
    id: "dev",
    name: "Developer utilities",
    category: "Developers",
    description: "JSON, Base64, hashes, JWT, regex, timestamps, UUIDs and more, in your browser.",
    status: "live",
    icon: Braces,
    kind: "text",
    options: ["JSON", "Diff", "Base64", "URL", "Hash", "JWT", "Regex", "Timestamp", "Number base", "Colour", "Case", "UUID", "Password"],
    takes: "Text, JSON, tokens or files",
    gives: "Formatted, encoded or generated text",
    limit: "Runs in your browser",
    steps: ["Pick a utility", "Paste your input", "Copy the result"],
    keywords: [
      "json", "json formatter", "json validator", "beautify", "minify", "json to csv", "diff", "compare text",
      "base64", "encode", "decode", "data url", "url encode", "url decode", "query string",
      "hash", "md5", "sha1", "sha256", "sha512", "hmac", "checksum", "jwt", "jwt decoder", "token",
      "regex", "regular expression", "timestamp", "unix time", "epoch", "binary", "hex", "octal",
      "color", "colour", "hex to rgb", "contrast", "camelcase", "snake case", "word count",
      "uuid", "guid", "uuid v7", "nanoid", "password generator", "developer", "dev tools",
    ],
    features: [
      "13 utilities: JSON, diff, Base64, URL, hashes, JWT, regex and more",
      "Results update as you type; copy or download any of them",
      "JSON errors point to the line and column; browse it as a tree",
      "Verify JWT signatures and HMACs with your own secret",
      "Nothing leaves your browser: safe for tokens and keys",
    ],
  },
  {
    id: "convert-anything",
    name: "Universal converter",
    category: "Convert",
    family: "files",
    group: "Convert",
    description: "Turn almost any file into the format you need: documents, data, images, audio, video, fonts and more.",
    status: "live",
    icon: ArrowRightLeft,
    kind: "file",
    takes: "Almost any file · 112 formats",
    gives: "Any format it can become",
    limit: "Up to 150 MB",
    steps: ["Add a file", "Pick a format", "Download"],
    accept: { label: "Any file", types: "" },
    keywords: [
      "convert", "converter", "any", "anything", "universal", "format", "file", "change format", "to",
      "docx", "word", "pdf", "markdown", "md", "html", "epub", "latex", "odt", "rtf", "txt",
      "xlsx", "excel", "csv", "json", "yaml", "xml", "toml", "sql", "tsv",
      "pptx", "powerpoint", "heic", "jpg", "png", "webp", "avif", "svg", "ico", "tiff",
      "mp3", "wav", "flac", "m4a", "ogg", "mp4", "mov", "mkv", "webm", "avi", "gif",
      "srt", "vtt", "subtitles", "font", "ttf", "otf", "woff", "woff2", "zip", "7z", "tar", "eml", "ipynb", "notebook",
    ],
    features: [
      "112 formats in 15 families, 1,800+ conversions",
      "Documents, spreadsheets, slides, ebooks and Markdown",
      "CSV, Excel, JSON, YAML, XML, TOML and SQL",
      "Images (HEIC, RAW, SVG…), audio, video and subtitles",
      "Fonts, archives, notebooks, email and source code",
      "Picks the best route for you, and shows it",
      "Free, no sign-up, deleted once it's sent",
    ],
  },
  {
    id: "period-tracker",
    name: "Period tracker",
    category: "Utilities",
    group: "Health",
    description: "Track your period, see when the next one is due, and log symptoms and moods. Private: it never leaves your phone.",
    status: "live",
    icon: CalendarHeart,
    kind: "generate",
    takes: "A tap when your period starts",
    gives: "Predictions, a calendar and insights",
    limit: "Stays on your device",
    steps: ["Answer three questions", "Log with one tap", "See what's next"],
    keywords: ["period tracker", "period calculator", "menstrual cycle tracker", "period app", "next period date", "ovulation calculator", "fertile window", "cycle tracker", "pms tracker", "period calendar", "when is my next period", "menstruation", "periods for girls", "private period tracker"],
    features: [
      "One tap to log a period; flow, symptoms, mood, pain and notes for any day",
      "Next period, fertile window and ovulation, learnt from your own cycles, with how sure the guess is",
      "A clear calendar, a cycle ring, and insights: average cycle, history, common symptoms",
      "Gentle notes when something is worth asking a doctor about (late, very long or irregular cycles)",
      "Totally private: saved only on your device, optional PIN lock (AES-256), backups and delete-all",
      "Calendar reminders a day before, with a discreet name if you like",
    ],
  },
  {
    id: "translator",
    name: "Translator",
    category: "Text",
    family: "text",
    group: "Convert",
    seoTitle: "Free Online Translator: Text, Docs, Images, Audio, Video",
    description: "Translate text as you type, whole Word/PowerPoint/Excel/PDF files with their layout, photos and screenshots, and audio or video (dubbed) into 130 languages. Dictionary, tones, glossary and a meaning check included.",
    status: "live",
    icon: Languages,
    kind: "file",
    takes: "Text, documents (DOCX, PPTX, XLSX, PDF, ODT, EPUB, HTML, MD, CSV, JSON, PO, XLIFF, SRT), pictures, audio or video",
    gives: "Translated text, the same document translated, a translated picture, or dubbed audio / video + transcripts",
    limit: "Free · Docs 50 MB · Audio 30m · Video 10m",
    steps: ["Add text, a file, a picture or media", "Pick languages & options", "Copy, listen or download"],
    options: ["live text", "documents (layout kept)", "images (OCR overlay)", "audio dubbing", "video dubbing", "dictionary & alternatives", "tones", "glossary", "meaning check", "history & phrasebook"],
    accept: {
      label: "Text, documents, pictures, audio or video",
      types: ".txt,.md,.srt,.vtt,.docx,.pptx,.xlsx,.pdf,.odt,.odp,.ods,.epub,.html,.csv,.json,.po,.xlf,image/*,audio/*,video/*",
    },
    wide: true,
    keywords: [
      "translator", "translate", "online translator", "free translator", "google translate alternative", "deepl alternative", "microsoft translator alternative",
      "translate text", "translate document", "translate word document", "translate docx", "translate pdf", "translate powerpoint", "translate pptx",
      "translate excel", "translate xlsx", "translate epub", "translate html", "translate json", "i18n translator", "po file translator", "xliff translator",
      "translate image", "photo translator", "translate screenshot", "camera translator", "ocr translate", "menu translator", "sign translator",
      "audio translator", "video translator", "dubbing", "ai dubbing", "voiceover", "subtitle translator", "srt translator", "vtt translator",
      "speech translator", "voice translator", "dictionary", "romanization", "transliteration", "formal translation", "glossary", "back translation",
      "hindi translator", "english to hindi", "spanish translator", "arabic translator", "bengali translator", "french translator", "multilingual",
    ],
    features: [
      "Text that translates as you type, with auto-detect, dictation, natural neural read-aloud and an editable result",
      "Whole documents keep their layout: Word, PowerPoint, Excel, OpenDocument, EPUB, HTML, Markdown, CSV, JSON/i18n, PO, XLIFF, subtitles — and PDF via Word",
      "Pictures: reads the text on photos, screenshots, signs and menus on your device and paints the translation over it",
      "Audio and video dubbing with a neural voice, synced timing, the original as background and soft subtitles",
      "Word panel: romanisation, alternative translations, a dictionary by part of speech, definitions, synonyms and examples",
      "Glossary (keep brand names, force terms), protected links/emails/{placeholders}, tones when an AI key is set",
      "Meaning check: translates back and scores how much survived; sentence-by-sentence view; up to 6 extra languages at once",
      "History, a starred phrasebook, share links and bilingual downloads; 130 languages with right-to-left support",
    ],
  },
  {
    id: "interpreter",
    name: "Live interpreter",
    category: "Text",
    family: "text",
    group: "Convert",
    seoTitle: "Free Live Interpreter & Real-Time Translated Captions",
    description: "Talk with anyone in another language: speak, and it translates and says it out loud for the other person. Live translated captions for lectures and meetings, and a tap-to-speak travel phrasebook.",
    status: "live",
    icon: MessagesSquare,
    kind: "generate",
    takes: "Your voice (or typing) in any of 130 languages",
    gives: "Spoken and written translations, live captions and a transcript",
    limit: "Free · works on phones",
    steps: ["Pick both languages", "Tap the mic and talk", "Listen, show or export"],
    options: ["two-way conversation", "hands-free turns", "face-to-face mode", "live captions in 3 languages", "phrasebook", "full-screen show card"],
    wide: true,
    keywords: [
      "interpreter", "live interpreter", "voice translator", "conversation translator", "speech to speech translation", "real time translator", "talk and translate",
      "travel translator", "phrasebook", "live captions", "live subtitles", "lecture translator", "meeting translator", "translate speech live", "google interpreter mode alternative",
      "two way translator", "face to face translator", "speak and translate", "pocket translator", "translator app",
    ],
    features: [
      "Two-way conversation: each person taps their mic, the other hears the translation in a natural voice",
      "Hands-free turns open the mic for the other person automatically; face-to-face mode flips one side for a phone on the table",
      "Live captions: continuous listening with rolling translations into up to three languages at once, full screen for a room",
      "Phrasebook: 90 everyday phrases in 8 situations, spoken with pronunciation, and a big show-card for counters",
      "Type instead of talking at any time; replay, copy and export the conversation as text, SRT or JSON",
      "Your browser's own recogniser where it exists (Chrome, Edge, Safari); our free Whisper server everywhere else",
    ],
  },
  {
    id: "whatsapp-chat-analyzer",
    name: "WhatsApp chat analyzer",
    category: "Text",
    family: "text",
    group: "Analyze",
    description: "Turn any exported WhatsApp chat into stats, timelines, activity heatmaps, reply speed, top emojis and searchable messages — in your browser.",
    status: "live",
    icon: MessageSquareText,
    kind: "file",
    takes: "WhatsApp .txt, .zip export, or pasted text",
    gives: "Stats, heatmaps, search and CSV / JSON / HTML",
    limit: "Analyzed in your browser",
    steps: ["Add chat export", "Filter & adjust", "Explore & save"],
    accept: { label: "WhatsApp chat .txt or .zip", types: ".txt,.zip,text/plain,application/zip" },
    wide: true,
    keywords: [
      "whatsapp chat analyzer",
      "whatsapp stats",
      "whatsapp wrapped",
      "chat analyser",
      "whatsapp export analyzer",
      "whatsapp zip analyzer",
      "whatsapp message counter",
      "reply time whatsapp",
      "whatsapp heatmap",
      "multilingual chat analyzer",
    ],
    features: [
      "Works with iOS, Android & Desktop exports (.txt, .zip archives with media, or pasted text)",
      "Supports any language or script: Hindi Devanagari, Arabic RTL, Spanish, CJK, Cyrillic and emojis",
      "Auto-detects DMY/MDY/YMD date order, localized digits and AM/PM markers with manual override",
      "Participant leaderboard with reply speed, conversation starters and double-text bursts",
      "Timeline charts (day/week/month), 7×24 activity heatmap, top emojis, words and domains",
      "Searchable message viewer and local exports (Excel UTF-8 CSV, JSON report and standalone HTML)",
    ],
  },
  {
    id: "chart-maker",
    name: "Chart maker",
    category: "Design",
    group: "Charts & diagrams",
    description: "Make 30 kinds of charts from your own data, animate them, and save them as pictures, GIFs, videos or web pages.",
    status: "live",
    icon: ChartColumnBig,
    kind: "generate",
    takes: "Your numbers (typed, pasted or a CSV)",
    gives: "PNG, JPG, SVG, GIF, video or HTML",
    limit: "Made in your browser",
    steps: ["Pick a chart", "Add your data", "Style and export"],
    wide: true,
    keywords: ["chart maker", "graph maker", "make a graph", "create chart online", "bar chart", "pie chart", "line graph", "donut chart", "scatter plot", "histogram", "radar chart", "sankey diagram", "treemap", "gauge chart", "waterfall chart", "candlestick chart", "heatmap", "animated chart", "csv to chart", "excel to chart", "infographic"],
    features: [
      "30 chart types: bar, line, area, pie, doughnut, scatter, bubble, radar, funnel, gauge, heatmap, treemap, sunburst, Sankey, candlestick, waterfall, box plot, calendar…",
      "Type data in a table, paste straight from Excel or Google Sheets, or import CSV / JSON",
      "Palettes, per-series colours, dark mode, fonts, labels, number formats (₹, $, %, 1.2K), axes and sorting",
      "Animated: bars grow, lines draw, slices sweep, with bounce, elastic and stagger effects",
      "Export PNG, JPG and SVG up to 4K, an animated GIF, a video, an animated SVG or a web page",
      "Saved in your browser as you work, or as a project file",
    ],
  },
  {
    id: "flowchart-maker",
    name: "Flowchart maker",
    category: "Design",
    group: "Charts & diagrams",
    description: "Draw flowcharts and diagrams by dragging shapes or typing text, with animated links and a play-through.",
    status: "live",
    icon: Workflow,
    kind: "generate",
    takes: "Shapes you drag in, or text",
    gives: "PNG, SVG, animated SVG or Mermaid",
    limit: "Made in your browser",
    steps: ["Start from a template", "Draw and connect", "Export or save"],
    wide: true,
    keywords: ["flowchart maker", "flow chart", "diagram maker", "process diagram", "decision tree", "workflow diagram", "org chart", "mind map", "mermaid editor", "draw.io alternative", "lucidchart alternative", "flowchart online free", "process map", "swimlane"],
    features: [
      "14 shapes: process, decision, start/end, input/output, database, document, subprocess and more",
      "Drag to connect; curved, rounded, square or straight links with labels and arrows",
      "Colours, borders, text size and style for every shape and link",
      "Animated links (flowing or moving dots) and “Play the flow”, step by step",
      "Type it as text (Mermaid syntax) or start from a template; tidy up with one click",
      "Undo, copy and paste, full screen; export PNG, SVG, animated SVG or Mermaid",
    ],
  },
  {
    id: "font-checker",
    name: "Font checker",
    category: "Design",
    group: "Fonts",
    description: "See, test and validate any font, or find the fonts inside a PDF or Office file.",
    status: "live",
    icon: Type,
    kind: "file",
    takes: "TTF, OTF, WOFF, WOFF2, TTC, or a document",
    gives: "A full report and live preview",
    limit: "Fonts up to 60 MB",
    steps: ["Add a font", "Test and inspect", "Fix or save"],
    accept: { label: "Fonts or documents", types: "" },
    keywords: ["font", "font checker", "font validator", "font viewer", "glyphs", "ttf", "otf", "woff", "woff2", "type tester", "opentype", "variable font", "fonts in pdf", "embedded fonts", "character map"],
    features: [
      "Type tester with OpenType features and variable axes",
      "Every glyph, with outlines, points and metrics",
      "Over 20 checks, incl. the sanitizer browsers run on web fonts",
      "Script and language coverage, names, licence and embedding rights",
      "Fonts used in PDF, Word, PowerPoint, Excel and EPUB files",
    ],
  },
  {
    id: "font-creator",
    name: "Font creator",
    category: "Design",
    group: "Fonts",
    description: "Make your own font: draw letters, build a pixel font, or turn your handwriting into a font.",
    status: "live",
    icon: PenTool,
    kind: "generate",
    takes: "Your drawing, pixels or handwriting",
    gives: "OTF, TTF, WOFF and WOFF2",
    limit: "Made in your browser",
    steps: ["Make the letters", "Preview and tune", "Download"],
    keywords: ["font creator", "font maker", "make a font", "create font", "handwriting font", "my handwriting", "pixel font", "bitmap font", "draw font", "custom font", "calligraphy", "otf", "ttf", "woff2", "typeface"],
    features: [
      "Draw each letter with mouse, finger or pen",
      "Or build a pixel font on a grid",
      "Or print a template, write on it, and photograph it",
      "Live preview while you work; spacing and name are yours",
      "OTF, TTF, WOFF and WOFF2, free for any use",
    ],
  },
  {
    id: "color-picker",
    name: "Colour picker",
    category: "Design",
    group: "Colour",
    description: "Pick colours from any image, PDF, slide deck, document or video, and export the palette.",
    status: "live",
    icon: Pipette,
    kind: "file",
    takes: "Any image, PDF, Office file, video, SVG or CSS",
    gives: "Colour codes and palettes",
    limit: "Up to 150 MB",
    steps: ["Add a file", "Pick colours", "Copy or export"],
    accept: { label: "Any file", types: "" },
    keywords: ["color picker", "colour picker", "eyedropper", "hex", "rgb", "hsl", "palette", "extract colors", "colors from image", "color from pdf", "color from powerpoint", "brand colors", "theme colors", "ase", "tailwind colors"],
    features: [
      "A magnifier shows the exact pixel; click to pick",
      "The main colours found automatically, with their share",
      "Exact colours from PDFs and Office files (theme and text)",
      "HEX, RGB, HSL, OKLCH and CMYK, with contrast grades",
      "Export to CSS, Tailwind, SCSS, JSON, GIMP or Adobe .ase",
    ],
  },
  {
    id: "qr",
    name: "QR generator",
    category: "Utilities",
    group: "QR codes",
    description: "Turn links, Wi-Fi, contacts and more into a crisp QR code.",
    status: "live",
    icon: QrCode,
    kind: "generate",
    options: ["PNG", "SVG", "WebP", "JPEG", "PDF"],
    takes: "A link, text, Wi-Fi, contact…",
    gives: "PNG, SVG, WebP, JPEG or PDF",
    limit: "Logo up to 10 MB",
    steps: ["Enter the details", "Adjust the look", "Download"],
    keywords: ["qr", "code", "link", "share", "wifi", "wi-fi", "vcard", "contact", "barcode", "scan", "logo", "event", "sms"],
    features: [
      "Links, text, Wi-Fi, contacts, email, SMS, calls, places and events",
      "Live preview as you type, exactly what you'll download",
      "Dot and eye shapes, colours, gradients and a centre logo",
      "PNG, SVG, WebP, JPEG or print-ready PDF",
      "Warns you before a code gets hard to scan",
    ],
  },
  ...fileTools,
  ...pdfTools,
  ...imageTools,
  ...devTabTools,
  ...utilityTools,
];

/**
 * Pages folded into broader tools (lib/merged-tools.ts) leave the directory; their names and
 * keywords move to the tool that replaced them, so searching "md5" or "csv viewer" still finds it.
 */
function foldMerged(list: Tool[]): Tool[] {
  const absorbed = new Map<string, string[]>();
  for (const t of list) {
    const m = MERGED_TOOLS[t.id];
    if (m) absorbed.set(m.to, [...(absorbed.get(m.to) ?? []), t.name.toLowerCase(), ...t.keywords]);
  }
  return list
    .filter((t) => !MERGED_TOOLS[t.id])
    .map((t) => (absorbed.has(t.id) ? { ...t, keywords: [...new Set([...t.keywords, ...absorbed.get(t.id)!])] } : t));
}

export const tools: Tool[] = foldMerged(rawTools).map((tool) =>
  SERVER_HEAVY_TOOL_IDS.has(tool.id) ? { ...tool, beta: true } : tool,
);

export const exampleTasks = [
  "download this instagram reel",
  "save a youtube video",
  "turn a video into mp3",
  "transcribe a voice recording",
  "what song is this",
  "merge two pdfs",
  "convert a pdf to word",
  "compress a video",
  "merge powerpoint files",
  "split an excel sheet by region",
  "make a favicon",
  "convert csv to json",
  "turn markdown into a word doc",
  "sign a pdf",
  "remove an image background",
  "convert heic to jpg",
  "make a meme",
  "format some json",
  "make a qr code for my wifi",
  "suggest a username",
];

/* ---------- Collections: how the toolbox is organised everywhere on the site ---------- */

export type ClusterId = "files" | "pdf" | "images" | "developer" | "text" | "design" | "downloads" | "media" | "utilities";

export type Cluster = {
  id: ClusterId;
  /** Short name for chips, menus and breadcrumbs. */
  name: string;
  /** Section title; the last word is set in the serif italic. */
  title: string;
  /** For counts: "30 PDF tools", "14 image tools". */
  noun: string;
  blurb: string;
  icon: LucideIcon;
  /** The all-in-one workspace for this collection, if it has one. */
  hub?: string;
  /** Sub-sections, in order (the family's groups). */
  groups?: readonly string[];
  /** What the navbar menu and the home page show first. */
  featured: string[];
};

/** The nine collections, in the order the site lists them. Every tool belongs to exactly one. */
export const CLUSTERS: Cluster[] = [
  {
    id: "files",
    name: "Any file",
    title: "Any file",
    noun: "file",
    blurb: "View Word, Excel, PowerPoint, CSV and PDF files in your browser, convert formats, compress, merge or split.",
    icon: ArrowRightLeft,
    hub: "convert-anything",
    groups: FILE_GROUPS,
    featured: ["document-viewer", "3d-viewer", "convert-anything", "compress-files", "merge-files", "split-files", "pdf-to-word", "word-to-pdf"],
  },
  {
    id: "pdf",
    name: "PDF",
    title: "PDF tools",
    noun: "PDF",
    blurb: "Merge, split, edit, sign, protect and OCR PDFs.",
    icon: FileStack,
    hub: "pdf",
    groups: PDF_GROUPS,
    featured: ["merge-pdf", "compress-pdf", "split-pdf", "edit-pdf", "sign-pdf", "jpg-to-pdf", "ocr-pdf", "protect-pdf"],
  },
  {
    id: "images",
    name: "Images",
    title: "Image tools",
    noun: "image",
    blurb: "Compress, resize, convert, cut out and edit pictures, and make icons.",
    icon: ImageIcon,
    hub: "image",
    groups: IMAGE_GROUPS,
    featured: ["pro-photo-editor", "compress-image", "resize-image", "remove-background", "convert-image", "icon-maker", "upscale-image"],
  },
  {
    id: "developer",
    name: "Developer",
    title: "Developer tools",
    noun: "developer",
    blurb: "Format, minify and validate code, hash, query XML and JSON, and check DNS and HTTP.",
    icon: CodeSquare,
    hub: "dev",
    groups: DEV_GROUPS,
    featured: ["dev", "api-client", "code-formatter", "json-formatter", "data-format-converter", "markdown-editor", "hash-generator", "dns-lookup"],
  },
  {
    id: "text",
    name: "Text",
    title: "Text tools",
    noun: "text",
    blurb: "Smart notepad to paste, inspect & clean text, free text, audio & video translator, username generator & checker, WhatsApp chat insights, binary/Morse converters and summaries.",
    icon: WholeWord,
    groups: TEXT_GROUPS,
    featured: ["notepad", "translator", "username-generator", "whatsapp-chat-analyzer", "text-to-binary", "number-to-words", "morse-code", "writing"],
  },
  {
    id: "design",
    name: "Design",
    title: "Charts, fonts and colour",
    noun: "design",
    blurb: "Make charts and flowcharts, check and make fonts, pick colours, check contrast, and generate CSS.",
    icon: Type,
    groups: DESIGN_GROUPS,
    featured: ["chart-maker", "flowchart-maker", "font-checker", "color-picker", "contrast-checker", "css-generator"],
  },
  {
    id: "downloads",
    name: "Downloads",
    title: "Media downloads",
    noun: "download",
    blurb: "Save public videos and posts from the platforms you use every day.",
    icon: Download,
    featured: ["youtube", "instagram", "facebook"],
  },
  {
    id: "media",
    name: "Audio & video",
    title: "Audio and video",
    noun: "audio and video",
    blurb: "Edit video on a timeline, make music with AI, find any song by humming or lyrics; trim, clean up, boost and record; subtitles, speech into text, frames and GIFs.",
    icon: AudioLines,
    hub: "video-editor",
    featured: ["video-editor", "music-studio", "song-finder", "trim-media", "noise-remover", "screen-recorder", "audio", "audio-to-text", "subtitle-editor"],
  },
  {
    id: "utilities",
    name: "Everyday",
    title: "Everyday utilities",
    noun: "utility",
    blurb: "A private period tracker, converters, clocks and timers, passwords and privacy, QR codes, and device checks.",
    icon: Monitor,
    groups: EVERYDAY_GROUPS,
    featured: ["period-tracker", "unit-converter", "qr", "password-generator", "world-clock", "age-calculator", "stopwatch", "emi-sip-calculator"],
  },
];

/*
 * A collection only ever points at tools that exist: if a tool is removed from the registry, its id
 * drops out of every `featured` list and `hub` here, so no menu, card or search shortcut can link to it.
 */
{
  const known = new Set(tools.map((t) => t.id));
  for (const c of CLUSTERS) {
    c.featured = c.featured.filter((id) => known.has(id));
    if (c.hub && !known.has(c.hub)) c.hub = undefined;
  }
}

/** Tools outside the two families, placed by hand. Anything unlisted lands in utilities. */
const CLUSTER_OF: Record<string, ClusterId> = {
  dev: "developer",
  writing: "text",
  "chart-maker": "design",
  "flowchart-maker": "design",
  "font-checker": "design",
  "font-creator": "design",
  "color-picker": "design",
  pdf: "pdf",
  image: "images",
  youtube: "downloads",
  instagram: "downloads",
  facebook: "downloads",
  audio: "media",
  "audio-to-text": "media",
  "video-editor": "media",
  "music-studio": "media",
  "song-finder": "media",
  "video-to-frames": "media",
  "video-to-gif": "media",
  "trim-media": "media",
  "audio-volume": "media",
  "noise-remover": "media",
  "screen-recorder": "media",
  "subtitle-editor": "media",
  "audio-waveform-generator": "media",
  ...Object.fromEntries(UTILITIES.filter((u) => u.cluster === "design").map((u) => [u.id, "design" as ClusterId])),
};

export const clusterOf = (tool: Tool): ClusterId =>
  tool.family === "pdf"
    ? "pdf"
    : tool.family === "image"
      ? "images"
      : tool.family === "files"
        ? "files"
        : tool.family === "developer"
          ? "developer"
          : tool.family === "text"
            ? "text"
            : (CLUSTER_OF[tool.id] ?? "utilities");
export const getCluster = (id: ClusterId) => CLUSTERS.find((c) => c.id === id)!;
/** A collection's own page (app/tools/category/[id]). The directory at /tools still has #<id> anchors. */
export const clusterHref = (id: ClusterId) => `/tools/category/${id}`;

/** A collection's tools: its hub first, then the rest in registry order, tools in the works last. */
export function toolsIn(id: ClusterId): Tool[] {
  const cluster = getCluster(id);
  return tools
    .filter((t) => clusterOf(t) === id)
    .sort((a, b) => Number(b.id === cluster.hub) - Number(a.id === cluster.hub) || Number(b.status === "live") - Number(a.status === "live"));
}

export const liveCount = tools.filter((t) => t.status === "live").length;
/** Live tools in Beta (server-heavy work on the free backend). */
export const betaCount = tools.filter((t) => t.status === "live" && t.beta).length;

/**
 * Ranks tools for a query using natural-language task intent, synonyms and format routes.
 */
export function searchTools(query: string): Tool[] {
  return rankToolsForTask(query);
}
