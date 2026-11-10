import {
  AudioLines,
  Braces,
  Download,
  FileStack,
  ImageIcon,
  PenLine,
  QrCode,
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
    description: "Merge, split and compress PDFs in seconds.",
    status: "live",
    icon: FileStack,
    kind: "file",
    options: ["Merge", "Split", "Compress"],
    takes: "One or more PDFs",
    gives: "PDF, or a ZIP of parts",
    limit: "Up to 150 MB",
    steps: ["Add PDFs", "Merge, split or shrink", "Download"],
    accept: { label: "PDF files", types: ".pdf,application/pdf" },
    keywords: ["pdf", "merge", "combine", "join", "split", "extract", "pages", "compress", "shrink", "reduce", "smaller", "document"],
    features: [
      "Merge up to 20 PDFs, in the order you set",
      "Split into single pages or your own ranges",
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
];

export const exampleTasks = [
  "download this instagram reel",
  "save a youtube video",
  "turn a video into mp3",
  "merge two pdfs",
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
