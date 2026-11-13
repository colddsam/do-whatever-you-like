import {
  Archive,
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
import { DEV_GROUPS, ENGINE_INFO, EVERYDAY_GROUPS, TEXT_GROUPS, UTILITIES } from "@/lib/utilities/catalog";

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
export const FILE_GROUPS = ["Convert", "Compress", "Merge & split"] as const;
export type FileGroup = (typeof FILE_GROUPS)[number];

/** The Developer and Text collections' sections (lib/utilities/catalog.ts). */
export type DevGroup = (typeof DEV_GROUPS)[number];
export type TextGroup = (typeof TEXT_GROUPS)[number];
export type EverydayGroup = (typeof EVERYDAY_GROUPS)[number];

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
  group?: PdfGroup | ImageGroup | FileGroup | DevGroup | TextGroup | EverydayGroup;
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
  // Modify
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
    category: u.cluster === "dev" ? "Developers" : u.cluster === "text" ? "Text" : "Utilities",
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
    group: u.group as DevGroup | TextGroup | EverydayGroup,
    features: info.features,
  } satisfies Tool;
});

export const toolHref = (id: string) => `/tools/${id}`;

/** Tools whose work never leaves the device (the utilities say so in their own `limit`). */
const ON_DEVICE = new Set(["meme-generator", "photo-editor", "font-creator", "dev"]);

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
    description: "Turn speech into text you can edit, copy or subtitle.",
    status: "live",
    icon: Captions,
    kind: "file",
    takes: "A recording, or your microphone",
    gives: "Text, SRT or VTT",
    limit: "Up to 150 MB · 3 hours",
    steps: ["Add a recording", "Transcribe it", "Copy or download"],
    accept: {
      label: "Audio or video",
      types: ".mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.wma,.amr,.aiff,.aif,.weba,.mp4,.mov,.mkv,.webm,.avi,.m4v,.3gp,.mpeg,.mpg,audio/*,video/*",
    },
    keywords: ["transcribe", "transcription", "speech", "speech to text", "voice", "dictation", "subtitles", "captions", "srt", "vtt", "meeting", "lecture", "podcast", "interview", "whisper", "audio", "text"],
    features: [
      "Whisper speech recognition in 99 languages, detected for you",
      "Record from your microphone, or add audio or video",
      "Watch the text appear as it's recognised",
      "Read along: the line being heard is highlighted",
      "Fix any line, then copy it or download TXT, SRT, VTT or JSON",
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
    description: "Summarise, rewrite and fix grammar.",
    status: "soon",
    icon: PenLine,
    kind: "text",
    options: ["Summarise", "Rewrite", "Fix grammar"],
    takes: "Any text",
    gives: "Edited text",
    steps: ["Paste your text", "Summarise, rewrite or fix", "Copy the result"],
    keywords: ["summary", "summarize", "rewrite", "grammar", "text"],
    features: ["Summaries in a few bullet points", "Rewrite in a different tone", "Grammar and spelling fixes"],
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
    id: "font-checker",
    name: "Font checker",
    category: "Design",
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
    blurb: "Convert any file to any format, compress it, merge or split it.",
    icon: ArrowRightLeft,
    hub: "convert-anything",
    groups: FILE_GROUPS,
    featured: ["convert-anything", "compress-files", "merge-files", "split-files", "pdf-to-word", "word-to-pdf"],
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
    blurb: "Binary and hex translators, number to words, Morse, summaries and playful text.",
    icon: WholeWord,
    groups: TEXT_GROUPS,
    featured: ["text-to-binary", "number-to-words", "morse-code", "text-summarizer", "upside-down-text", "lorem-ipsum"],
  },
  {
    id: "design",
    name: "Design",
    title: "Fonts and colour",
    noun: "design",
    blurb: "Check any font, make your own, and pick colours from anything.",
    icon: Type,
    featured: ["font-checker", "font-creator", "color-picker"],
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
    blurb: "Pull the sound out of a video, or turn speech into text.",
    icon: AudioLines,
    featured: ["audio", "audio-to-text"],
  },
  {
    id: "utilities",
    name: "Everyday",
    title: "Everyday utilities",
    noun: "utility",
    blurb: "QR codes, your IP and screen, a webcam check and a pixel ruler.",
    icon: Monitor,
    featured: ["qr", "my-ip", "screen-resolution", "webcam-test", "browser-window-size", "pixel-ruler"],
  },
];

/** Tools outside the two families, placed by hand. Anything unlisted lands in utilities. */
const CLUSTER_OF: Record<string, ClusterId> = {
  dev: "developer",
  writing: "text",
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
 * Ranks tools for a query. A word found in the name counts most, then keywords, then the rest,
 * so "compress" puts Compress PDF and Compress image above tools that merely mention it.
 */
export function searchTools(query: string): Tool[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  const terms = q.split(/\s+/);
  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const keywords = tool.keywords.join(" ").toLowerCase();
      const rest = [tool.category, tool.description, getCluster(clusterOf(tool)).name, tool.group ?? ""].join(" ").toLowerCase();
      let score = 0;
      let hits = 0;
      for (const t of terms) {
        const s = name.includes(t) ? 3 : keywords.includes(t) ? 2 : rest.includes(t) ? 1 : 0;
        score += s;
        hits += s ? 1 : 0;
      }
      return { tool, score: score + (hits === terms.length ? 2 : 0) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.tool.status === "live") - Number(a.tool.status === "live"))
    .map((r) => r.tool);
}
