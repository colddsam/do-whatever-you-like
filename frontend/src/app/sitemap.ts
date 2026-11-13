import type { MetadataRoute } from "next";
import { CLUSTERS, clusterHref, toolHref, tools } from "@/lib/tools";
import { SITE_URL } from "@/lib/site";

const LEGAL_PAGES = ["/about", "/privacy", "/terms", "/fair-use"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  // Only tools that work today; "coming soon" pages are noindex.
  const liveTools = tools.filter((t) => t.status === "live").map((t) => toolHref(t.id));
  const hubs = CLUSTERS.map((c) => clusterHref(c.id));

  return [
    { url: SITE_URL, lastModified, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/tools`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    ...hubs.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
    ...liveTools.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...LEGAL_PAGES.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
