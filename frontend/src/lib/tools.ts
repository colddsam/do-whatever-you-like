import {
  Archive,
  AudioLines,
  Braces,
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
  Minimize2,
  PencilLine,
  PenLine,
  Presentation,
  QrCode,
  RotateCw,
  ScanLine,
  ScanText,
  Scissors,
  Signature,
  Stamp,
  Wrench,
  type LucideIcon,
} from "lucide-react";

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
export const PDF_GROUPS = ["Organize", "Optimize", "Convert to PDF", "Convert from PDF", "Edit", "Security"] as const;
export type PdfGroup = (typeof PDF_GROUPS)[number];

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
  family?: "pdf";
  group?: PdfGroup;
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
  /** Live single-file converters only: where the file goes and what's allowed. */
  converter?: {
    /** Our proxy route (see app/api/tools). It takes `file` as form data and returns the result. */
    endpoint: string;
    /** What goes in, in a word: "video", "PDF". Used in the workspace's copy. */
    input: string;
    /** Lower-case, with the dot. Mirrors the backend's allow-list. */
    extensions: string[];
    maxMB: number;
    /** Format of the result, e.g. "MP3". */
    output: string;
    /** One line on the result's quality, shown under the download button. */
    quality: string;
    /** Constant-bitrate outputs: bytes per second of input, to predict the result's size. */
    bytesPerSecond?: number;
  };
};

const PDF_ACCEPT = { label: "PDF files", types: ".pdf,application/pdf" };
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
    description: "Photograph paper with your phone and get a clean PDF.",
    takes: "Photos of pages", gives: "One PDF", limit: "Up to 100 pages",
    steps: ["Take or add photos", "Tidy the scan", "Download"],
    accept: { label: "Photos", types: "image/*" },
    keywords: ["scan", "camera", "photo", "document scanner", "paper", "pdf"],
    features: ["Use your phone's camera straight from the page", "Scan look: white paper, crisp text", "Reorder pages before you save"],
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
    id: "word-to-pdf", name: "Word to PDF", group: "Convert to PDF", icon: FileText,
    description: "Turn DOC and DOCX files into PDF.",
    takes: "DOC, DOCX, ODT, RTF", gives: "PDF", steps: ["Add a document", "Convert it", "Download"],
    accept: { label: "Word documents", types: ".doc,.docx,.odt,.rtf,.txt" },
    keywords: ["word", "doc", "docx", "odt", "rtf", "convert", "pdf"],
    features: ["Keeps fonts, tables, images and layout", "DOC, DOCX, ODT, RTF and TXT", "Preview the PDF before you save it"],
  }),
  pdfTool({
    id: "powerpoint-to-pdf", name: "PowerPoint to PDF", group: "Convert to PDF", icon: Presentation,
    description: "Turn slides into a PDF, one page per slide.",
    takes: "PPT, PPTX, ODP", gives: "PDF", steps: ["Add slides", "Convert them", "Download"],
    accept: { label: "Presentations", types: ".ppt,.pptx,.odp,.pps,.ppsx" },
    keywords: ["powerpoint", "ppt", "pptx", "slides", "presentation", "convert", "pdf"],
    features: ["One page per slide", "PPT, PPTX, PPS and ODP", "Preview the PDF before you save it"],
  }),
  pdfTool({
    id: "excel-to-pdf", name: "Excel to PDF", group: "Convert to PDF", icon: FileSpreadsheet,
    description: "Turn spreadsheets into PDF.",
    takes: "XLS, XLSX, ODS, CSV", gives: "PDF", steps: ["Add a spreadsheet", "Choose the fit", "Download"],
    accept: { label: "Spreadsheets", types: ".xls,.xlsx,.xlsm,.ods,.csv" },
    keywords: ["excel", "xls", "xlsx", "csv", "spreadsheet", "sheet", "convert", "pdf"],
    features: ["Every sheet included", "Option: each sheet on a single page", "XLS, XLSX, ODS and CSV"],
  }),
  pdfTool({
    id: "html-to-pdf", name: "HTML to PDF", group: "Convert to PDF", icon: Globe,
    description: "Save any public web page as a PDF.",
    takes: "A web address or HTML file", gives: "PDF", steps: ["Add a page", "Set up the paper", "Download"],
    accept: { label: "HTML files", types: ".html,.htm,text/html" },
    keywords: ["html", "web page", "website", "url", "link", "save page", "convert", "pdf"],
    features: ["Renders the page in a real browser", "A4, Letter, Legal or A3, portrait or landscape", "Private and internal addresses are blocked"],
  }),
  // Convert from PDF
  pdfTool({
    id: "pdf-to-jpg", name: "PDF to JPG", group: "Convert from PDF", icon: FileImage,
    description: "Each page as an image, or the pictures inside.",
    takes: "One PDF", gives: "JPG or PNG", steps: ["Add a PDF", "Choose the images", "Download"],
    keywords: ["pdf to jpg", "jpg", "png", "image", "extract images", "convert", "pdf"],
    features: ["Pages as JPG or PNG, up to 300 dpi", "Or pull out the original pictures", "Several images arrive as one ZIP"],
  }),
  pdfTool({
    id: "pdf-to-word", name: "PDF to Word", group: "Convert from PDF", icon: FileText,
    description: "An editable Word document from your PDF.",
    takes: "One PDF", gives: "DOCX", steps: ["Add a PDF", "Convert it", "Download"],
    keywords: ["pdf to word", "docx", "word", "editable", "convert", "pdf"],
    features: ["Text, tables and images, editable in Word", "Keeps the layout as closely as it can", "Scans need OCR first"],
  }),
  pdfTool({
    id: "pdf-to-powerpoint", name: "PDF to PowerPoint", group: "Convert from PDF", icon: Presentation,
    description: "Each PDF page as an editable slide.",
    takes: "One PDF", gives: "PPTX", steps: ["Add a PDF", "Convert it", "Download"],
    keywords: ["pdf to powerpoint", "pptx", "slides", "presentation", "convert", "pdf"],
    features: ["One slide per page", "Text and shapes stay editable", "Opens in PowerPoint, Keynote and Google Slides"],
  }),
  pdfTool({
    id: "pdf-to-excel", name: "PDF to Excel", group: "Convert from PDF", icon: FileSpreadsheet,
    description: "Tables from your PDF, ready in Excel.",
    takes: "One PDF", gives: "XLSX", steps: ["Add a PDF", "Choose the sheets", "Download"],
    keywords: ["pdf to excel", "xlsx", "table", "spreadsheet", "extract table", "convert", "pdf"],
    features: ["Finds the tables on every page", "Numbers stay numbers", "A sheet per table, or per page"],
  }),
  pdfTool({
    id: "pdf-to-pdfa", name: "PDF to PDF/A", group: "Convert from PDF", icon: Archive,
    description: "An archive-ready PDF for long-term storage.",
    takes: "One PDF", gives: "PDF/A", steps: ["Add a PDF", "Choose the level", "Download"],
    keywords: ["pdfa", "pdf/a", "archive", "iso", "long term", "convert", "pdf"],
    features: ["PDF/A-1b, 2b or 3b", "Fonts embedded, colours fixed to sRGB", "Accepted by courts and archives"],
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

export const toolHref = (id: string) => `/tools/${id}`;
export const getTool = (id: string) => tools.find((t) => t.id === id);
export const stepsFor = (tool: Tool) => tool.steps ?? defaultSteps[tool.kind];

export const tools: Tool[] = [
  {
    id: "youtube",
    name: "YouTube downloader",
    category: "Downloads",
    description: "Save videos and Shorts in the best quality available.",
    status: "live",
    icon: Download,
    kind: "link",
    takes: "A public YouTube link",
    gives: "MP4 video",
    limit: "Up to 1 hour",
    keywords: ["video", "shorts", "save", "yt", "download"],
    features: ["Videos and Shorts up to 1 hour", "Best available quality, merged to MP4", "Title, channel and length preview before you save"],
    downloader: { platform: "youtube", placeholder: "https://www.youtube.com/watch?v=…", hosts: ["youtube.com", "youtu.be"], examples: ["youtube.com/watch?v=…", "youtube.com/shorts/…", "youtu.be/…"] },
  },
  {
    id: "instagram",
    name: "Instagram downloader",
    category: "Downloads",
    description: "Reels, posts and carousels, straight from a link.",
    status: "live",
    icon: Download,
    kind: "link",
    takes: "A post link or shortcode",
    gives: "MP4, JPG or ZIP",
    limit: "Public posts only",
    keywords: ["reel", "reels", "post", "carousel", "ig", "insta", "download"],
    features: ["Reels, single posts and carousels", "Carousels arrive as one ZIP", "Paste a link or just the shortcode"],
    downloader: { platform: "instagram", placeholder: "https://www.instagram.com/reel/…", hosts: ["instagram.com", "instagr.am"], allowShortcode: true, examples: ["instagram.com/reel/…", "instagram.com/p/…", "A bare shortcode"] },
  },
  {
    id: "facebook",
    name: "Facebook downloader",
    category: "Downloads",
    description: "Grab public videos and reels without the hassle.",
    status: "live",
    icon: Download,
    kind: "link",
    takes: "A public video or reel link",
    gives: "MP4 video",
    limit: "Public videos only",
    keywords: ["fb", "video", "reel", "download", "save"],
    features: ["Public videos and reels", "Share links are resolved for you", "Saved as MP4"],
    downloader: { platform: "facebook", placeholder: "https://www.facebook.com/reel/…", hosts: ["facebook.com", "fb.watch", "fb.com"], examples: ["facebook.com/reel/…", "facebook.com/watch?v=…", "fb.watch/…"] },
  },
  {
    id: "audio",
    name: "Video to audio",
    category: "Convert",
    description: "Pull a clean MP3 out of any video file.",
    status: "live",
    icon: AudioLines,
    kind: "file",
    options: ["MP3 · 192 kbps"],
    takes: "A video file",
    gives: "MP3 audio",
    limit: "Up to 150 MB",
    steps: ["Add a video", "Extract the audio", "Save the MP3"],
    accept: { label: "MP4, MOV, MKV or WebM", types: ".mp4,.mov,.mkv,.webm,.avi,.flv,.m4v,video/*" },
    keywords: ["mp3", "music", "extract", "convert", "sound", "audio", "video"],
    features: [
      "MP4, MOV, MKV, WebM, AVI, FLV and M4V",
      "192 kbps MP3, ready for any player",
      "Listen before you save",
      "Your video is deleted once the MP3 is sent",
    ],
    converter: {
      endpoint: "/api/tools/video2audio/extract",
      input: "video",
      extensions: [".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv", ".m4v"],
      maxMB: 150,
      output: "MP3",
      quality: "192 kbps MP3, named after your video.",
      bytesPerSecond: 192_000 / 8,
    },
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
    description: "Resize, convert and remove backgrounds.",
    status: "soon",
    icon: ImageIcon,
    kind: "file",
    options: ["Resize", "Convert", "Remove background"],
    takes: "PNG, JPG or WebP",
    gives: "PNG, JPG or WebP",
    steps: ["Add images", "Resize or convert", "Download"],
    accept: { label: "PNG, JPG or WebP", types: "image/*" },
    keywords: ["resize", "png", "jpg", "webp", "background", "photo"],
    features: ["Resize to exact dimensions", "Convert between PNG, JPG and WebP", "One-click background removal"],
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
    description: "Format JSON, encode Base64, hash strings.",
    status: "soon",
    icon: Braces,
    kind: "text",
    options: ["Format JSON", "Base64", "Hash"],
    takes: "JSON or plain text",
    gives: "Formatted or encoded text",
    steps: ["Paste your input", "Pick a utility", "Copy the result"],
    keywords: ["json", "base64", "hash", "format", "encode", "decode"],
    features: ["Format and validate JSON", "Base64 encode and decode", "SHA-256 and MD5 hashes"],
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
  ...pdfTools,
];

export const exampleTasks = [
  "download this instagram reel",
  "save a youtube video",
  "turn a video into mp3",
  "merge two pdfs",
  "convert a pdf to word",
  "sign a pdf",
  "remove an image background",
  "format some json",
  "make a qr code for my wifi",
];

export function searchTools(query: string): Tool[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  const terms = q.split(/\s+/);
  return tools
    .map((tool) => {
      const haystack = [tool.name, tool.category, tool.description, ...tool.keywords]
        .join(" ")
        .toLowerCase();
      const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.tool.status === "live") - Number(a.tool.status === "live"))
    .map((r) => r.tool);
}
