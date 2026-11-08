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

export type Tool = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: ToolStatus;
  icon: LucideIcon;
  /** Extra words the command palette matches against. */
  keywords: string[];
};

export const tools: Tool[] = [
  {
    id: "youtube",
    name: "YouTube downloader",
    category: "Downloads",
    description: "Save videos and Shorts in the quality you pick.",
    status: "live",
    icon: Download,
    keywords: ["video", "shorts", "save", "yt", "download"],
  },
  {
    id: "instagram",
    name: "Instagram downloader",
    category: "Downloads",
    description: "Reels, posts and carousels, straight from a link.",
    status: "live",
    icon: Download,
    keywords: ["reel", "reels", "post", "carousel", "ig", "insta", "download"],
  },
  {
    id: "facebook",
    name: "Facebook downloader",
    category: "Downloads",
    description: "Grab public videos and reels without the hassle.",
    status: "live",
    icon: Download,
    keywords: ["fb", "video", "reel", "download", "save"],
  },
  {
    id: "audio",
    name: "Video to audio",
    category: "Convert",
    description: "Pull a clean MP3 out of any video file.",
    status: "soon",
    icon: AudioLines,
    keywords: ["mp3", "music", "extract", "convert", "sound"],
  },
  {
    id: "pdf",
    name: "PDF toolkit",
    category: "Documents",
    description: "Merge, split and compress PDFs in seconds.",
    status: "soon",
    icon: FileStack,
    keywords: ["merge", "split", "compress", "document"],
  },
  {
    id: "image",
    name: "Image studio",
    category: "Images",
    description: "Resize, convert and remove backgrounds.",
    status: "soon",
    icon: ImageIcon,
    keywords: ["resize", "png", "jpg", "webp", "background", "photo"],
  },
  {
    id: "writing",
    name: "Writing helper",
    category: "Text",
    description: "Summarise, rewrite and fix grammar.",
    status: "soon",
    icon: PenLine,
    keywords: ["summary", "summarize", "rewrite", "grammar", "text"],
  },
  {
    id: "dev",
    name: "Developer utilities",
    category: "Developers",
    description: "Format JSON, encode Base64, hash strings.",
    status: "soon",
    icon: Braces,
    keywords: ["json", "base64", "hash", "format", "encode", "decode"],
  },
  {
    id: "qr",
    name: "QR generator",
    category: "Utilities",
    description: "Turn any link or text into a crisp QR code.",
    status: "soon",
    icon: QrCode,
    keywords: ["qr", "code", "link", "share"],
  },
];

export const exampleTasks = [
  "download this instagram reel",
  "save a youtube video",
  "turn a video into mp3",
  "merge two pdfs",
  "remove an image background",
  "format some json",
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
