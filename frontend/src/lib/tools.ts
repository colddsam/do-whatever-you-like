import {
  Archive,
  CalendarHeart,
  ChartColumnBig,
  Languages,
  MessageSquareText,
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
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { DESIGN_GROUPS, DEV_GROUPS, ENGINE_INFO, EVERYDAY_GROUPS, TEXT_GROUPS, UTILITIES } from "@/lib/utilities/catalog";
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
export const FILE_GROUPS = ["View", "Convert", "Compress", "Merge & split"] as const;
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
    takes: "One image", gives: "A 2× or 4× image", limit: "Up to 16 MP out",
    steps: ["Add an image", "Pick 2× or 4×", "Download"],
    keywords: ["upscale", "enlarge", "enhance", "super resolution", "ai", "increase resolution", "hd", "4k", "sharpen", "image"],
    features: ["Real-ESRGAN, the open AI upscaler", "2× or 4×, with the new size shown first", "Drag to compare before and after", "Runs on our server: no account, no credits"],
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
    description: "Filters, light and colour, text, stickers and frames.",
    takes: "A photo", gives: "JPG or PNG", limit: "Made in your browser",
    steps: ["Add a photo", "Edit it", "Download"],
    keywords: ["photo editor", "edit photo", "filter", "brightness", "contrast", "saturation", "text on photo", "sticker", "frame", "image editor"],
    features: ["Nine filters, then fine-tune six sliders", "Turn, flip and crop to square or story", "Drag text and stickers into place", "Frames, polaroid and rounded corners"],
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
    id: "split-pdf", name: "Split PDF", group: "Organize", icon: Scissors,
    description: "Break a PDF into parts, or group pages your way.",
    takes: "One PDF", gives: "PDFs in a ZIP", steps: ["Add a PDF", "Pick the pages", "Download"],
    keywords: ["split", "separate", "divide", "break", "pages", "pdf"],
    features: ["Every page on its own, or ranges you type", "Pick which pages go together on the page grid", "Each part's size before you split"],
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
    id: "organize-pdf", name: "Organize PDF", group: "Organize", icon: LayoutGrid,
    description: "Reorder, turn and remove pages, seeing each one.",
    takes: "One PDF", gives: "PDF", steps: ["Add a PDF", "Arrange the pages", "Download"],
    keywords: ["organize", "reorder", "rearrange", "sort", "move pages", "pdf"],
    features: ["Drag pages into a new order", "Turn and remove pages", "Keyboard shortcuts for every action"],
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
  // View: instant in-browser readers for Office docs, spreadsheets, presentations, CSV and PDFs
  fileTool({
    id: "document-viewer", name: "Document viewer", group: "View", icon: Eye,
    description: "Open Word, Excel, PowerPoint, CSV, ODF and PDF files right in your browser.",
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
  devTab("regex-tester", "regex", "Regex tester", "Validate", Regex, "Test a regular expression and see every match and group, live.", ["regex tester", "regular expression tester", "regex101", "regex match", "test regex online", "javascript regex"], ["Every match and capture group highlighted", "Flags: global, case, multiline, dotall, unicode", "Replace preview with $1 groups", "Live as you type"]),
  devTab("timestamp-converter", "time", "Unix timestamp converter", "Encode", Clock, "Unix time to a date and back, in seconds or milliseconds, any time zone.", ["unix timestamp", "epoch converter", "timestamp to date", "date to timestamp", "unix time", "epoch time", "milliseconds to date"], ["Seconds or milliseconds, detected", "Local, UTC and ISO 8601", "Relative time (3 days ago)", "Live current timestamp"]),
  devTab("diff-checker", "diff", "Diff checker", "Edit & view", GitCompare, "Compare two texts and see exactly what was added, removed or changed.", ["diff checker", "text compare", "compare two texts", "diff tool", "find differences", "text diff online", "code compare"], ["Line and word differences highlighted", "Side by side or inline", "Ignore whitespace or case", "Nothing leaves your browser"]),
  devTab("uuid-generator", "uuid", "UUID, ULID & NanoID generator", "Random data", Fingerprint, "Generate sortable UUID v7, ULID, UUID v4 or custom NanoIDs in bulk (up to 500).", ["uuid generator", "uuid v7", "ulid generator", "nanoid generator", "bulk uuid"], ["UUID v4, UUID v7, ULID and customizable NanoID", "Generate up to 500 IDs in one click", "Export as Lines, JSON array, CSV or SQL values", "Cryptographically random in your browser"]),
  devTab("url-encoder", "url", "URL encoder & query parser", "Encode", Link2, "Encode/decode URLs and edit URL query parameters in a live key-value table.", ["url encoder", "url decoder", "query string parser", "url params builder", "percent encoding"], ["Interactive key-value query parameter editor", "One-click sort, trim or remove empty parameters", "Full URL encode, decode and Query JSON preview", "Everything stays in your browser"]),
];

export const toolHref = (id: string) => `/tools/${id}`;

/** Tools whose work never leaves the device (the utilities say so in their own `limit`). */
const ON_DEVICE = new Set([
  "meme-generator",
  "photo-editor",
  "font-creator",
  "dev",
  "contrast-checker",
  "css-gradient-generator",
  "box-shadow-generator",
  "border-radius-generator",
  "glassmorphism-generator",
  "neumorphism-generator",
  "svg-optimizer-jsx",
  "css-grid-flexbox-playground",
  "color-palette-scale-generator",
  "image-to-svg",
  "mockup-frame-generator",
  "archive-extractor-creator",
  "audio-waveform-generator",
  "writing",
  "document-viewer",
  "excel-viewer",
  "word-viewer",
  "powerpoint-viewer",
  "pdf-viewer",
  "csv-viewer",
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
  if (tool.id === "pdf" || tool.family === "pdf") return "On our server, deleted within 30 min";
  if (tool.id === "color-picker") return "Pictures stay on your device; documents are deleted after";
  return "On our server, deleted once done";
}
export const getTool = (id: string) => tools.find((t) => t.id === id);
export const stepsFor = (tool: Tool) => tool.steps ?? defaultSteps[tool.kind];

export const tools: Tool[] = [
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
    name: "Video & audio trimmer",
    category: "Edit",
    description: "Cut a video or song to the part you want: fast and lossless, or frame-exact.",
    status: "live",
    icon: Scissors,
    kind: "file",
    takes: "A video or audio file",
    gives: "The same format, trimmed",
    limit: "Up to 150 MB",
    steps: ["Add a file", "Pick the start and end", "Download"],
    accept: { label: "MP4, MOV, MKV, WebM, MP3, WAV, M4A…", types: "audio/*,video/*,.mkv,.avi,.flac,.opus,.m4a,.wma,.amr,.3gp" },
    keywords: ["trim video", "cut video", "video cutter", "trim audio", "cut mp3", "audio cutter", "ringtone maker", "clip video", "shorten video", "mp3 cutter", "video trimmer"],
    features: [
      "Drag the handles on a live preview, or type exact times",
      "Fast mode keeps the original quality (no re-encoding)",
      "Exact mode cuts on the very frame you pick",
      "Keeps the format: MP4 stays MP4, MP3 stays MP3",
      "Deleted from our server once it's sent",
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
    id: "writing",
    name: "Writing helper",
    category: "Text",
    family: "text",
    group: "Analyze",
    description: "Summarise long passages, rewrite tone and fix grammar right in your browser.",
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
    description: "Translate text, spoken audio, or video into 100+ languages — returning translated media files plus copyable input and translated text.",
    status: "live",
    icon: Languages,
    kind: "file",
    takes: "Text, subtitles (.srt/.vtt), audio or video",
    gives: "Translated text, or dubbed audio / video + transcripts",
    limit: "Free · Audio 30m · Video 10m · Up to 150 MB",
    steps: ["Add text, audio, or video", "Pick languages & voice", "Copy text or save file"],
    accept: {
      label: "Text, audio or video",
      types: ".txt,.md,.srt,.vtt,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.mp4,.mov,.mkv,.webm,.avi,.m4v,audio/*,video/*",
    },
    wide: true,
    keywords: [
      "translator",
      "translate text",
      "audio translator",
      "video translator",
      "dubbing",
      "voiceover",
      "hindi translator",
      "spanish translator",
      "arabic translator",
      "subtitle translator",
      "srt translator",
      "speech translator",
      "dub video",
      "dub audio",
      "multilingual",
    ],
    features: [
      "Text mode shows source & translated text cleanly with 1-click Copy buttons and .srt/.vtt timestamp support",
      "Audio dubbing transcribes speech, translates it, and produces a downloadable dubbed audio track plus both scripts",
      "Video dubbing keeps your video stream crisp, adds a neural spoken voiceover + optional soft subtitle track",
      "Choose female or male voice, synced vs fluent timing, or blend quiet original background audio",
      "105 languages supported with Auto-detect, RTL script support, and temporary auto-expiring storage",
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

export const exampleTasks = [
  "download this instagram reel",
  "save a youtube video",
  "turn a video into mp3",
  "transcribe a voice recording",
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
    featured: ["document-viewer", "convert-anything", "compress-files", "merge-files", "split-files", "pdf-to-word", "word-to-pdf"],
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
    featured: ["compress-image", "resize-image", "remove-background", "convert-to-jpg", "icon-maker", "upscale-image"],
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
    featured: ["dev", "markdown-editor", "javascript-formatter", "sql-formatter", "code-editor", "sha256-hash", "dns-lookup", "api-tester"],
  },
  {
    id: "text",
    name: "Text",
    title: "Text tools",
    noun: "text",
    blurb: "Free text, audio & video translator, WhatsApp chat insights, binary/Morse converters and summaries.",
    icon: WholeWord,
    groups: TEXT_GROUPS,
    featured: ["translator", "whatsapp-chat-analyzer", "text-to-binary", "number-to-words", "morse-code", "text-summarizer"],
  },
  {
    id: "design",
    name: "Design",
    title: "Charts, fonts and colour",
    noun: "design",
    blurb: "Make charts and flowcharts, check and make fonts, pick colours, check contrast, and generate CSS.",
    icon: Type,
    groups: DESIGN_GROUPS,
    featured: ["chart-maker", "flowchart-maker", "font-checker", "color-picker", "contrast-checker", "css-gradient-generator"],
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
    blurb: "Trim, clean up, boost and record; subtitles, sound out of video, speech into text, frames and GIFs.",
    icon: AudioLines,
    featured: ["trim-media", "noise-remover", "screen-recorder", "audio", "audio-to-text", "audio-volume", "subtitle-editor", "video-to-gif"],
  },
  {
    id: "utilities",
    name: "Everyday",
    title: "Everyday utilities",
    noun: "utility",
    blurb: "A private period tracker, converters, clocks and timers, passwords and privacy, QR codes, and device checks.",
    icon: Monitor,
    groups: EVERYDAY_GROUPS,
    featured: ["period-tracker", "unit-converter", "currency-converter", "qr", "password-generator", "world-clock", "age-calculator", "pomodoro-timer"],
  },
];

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

/**
 * Ranks tools for a query using natural-language task intent, synonyms and format routes.
 */
export function searchTools(query: string): Tool[] {
  return rankToolsForTask(query);
}
