import type { MetadataRoute } from "next";
import { CLUSTERS, clusterHref, toolHref, tools } from "@/lib/tools";
import { BLOG_POSTS, blogHref } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";
import LASTMOD from "@/lib/lastmod.json";

const LEGAL_PAGES = ["/about", "/privacy", "/terms", "/fair-use"];

/**
 * When the page's content last changed, from scripts/lastmod.mjs (runs before every build). A page
 * it doesn't know yet gets no date: a made-up one would teach search engines to ignore them all.
 */
const changed = (path: string) => (LASTMOD as Record<string, { date: string }>)[path]?.date;

export default function sitemap(): MetadataRoute.Sitemap {
  // Only tools that work today; "coming soon" pages are noindex.
  const liveTools = tools.filter((t) => t.status === "live").map((t) => toolHref(t.id));
  const hubs = CLUSTERS.map((c) => clusterHref(c.id));
  const entry = (path: string, changeFrequency: "weekly" | "monthly", priority: number) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
    lastModified: changed(path),
    changeFrequency,
    priority,
  });

  return [
    entry("/", "weekly", 1.0),
    entry("/tools", "weekly", 0.9),
    entry("/blog", "weekly", 0.8),
    ...BLOG_POSTS.map((p) => ({
      url: `${SITE_URL}${blogHref(p.slug)}`,
      lastModified: p.updatedAt ?? p.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...hubs.map((path) => entry(path, "weekly", 0.9)),
    ...liveTools.map((path) => entry(path, "weekly", 0.8)),
    ...LEGAL_PAGES.map((path) => entry(path, "monthly", 0.4)),
  ];
}
