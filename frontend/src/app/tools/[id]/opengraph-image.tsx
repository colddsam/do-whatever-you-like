import { OG_SIZE, ogCard } from "@/lib/og";
import { clusterOf, getCluster, getTool, tools } from "@/lib/tools";

export const alt = "A free Do-Whatever tool";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return tools.map((t) => ({ id: t.id }));
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const tool = getTool((await params).id);
  if (!tool) return ogCard({ eyebrow: "Do-Whatever", title: "Free online tools", subtitle: "No sign-up, nothing to install." });
  return ogCard({ eyebrow: getCluster(clusterOf(tool)).name, title: tool.name, subtitle: tool.description });
}
