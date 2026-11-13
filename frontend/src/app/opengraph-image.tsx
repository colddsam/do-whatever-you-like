import { OG_SIZE, ogCard } from "@/lib/og";
import { liveCount } from "@/lib/tools";

export const alt = "Do-Whatever: free online tools for PDFs, images, video, audio and code";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: `${liveCount} free tools`,
    title: "One place to do whatever you need.",
    subtitle: "Merge PDFs, convert any file, compress images, download videos, transcribe audio and format code.",
  });
}
