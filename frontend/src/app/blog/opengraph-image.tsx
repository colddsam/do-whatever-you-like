import { OG_SIZE, ogCard } from "@/lib/og";
import { liveCount } from "@/lib/tools";

export const alt = "Do-Whatever-You-Like Journal";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "Journal",
    title: "Notes from the workbench",
    subtitle: `Product launches, architecture notes, and how ${liveCount} free browser-first tools work.`,
  });
}
