import type { MetadataRoute } from "next";
import { CLUSTERS, clusterHref, toolHref, tools } from "@/lib/tools";
import { SITE_URL } from "@/lib/site";

const PAGES = ["/", "/tools", "/about", "/privacy", "/terms", "/fair-use"];

export default function sitemap(): MetadataRoute.Sitemap {
  // Only tools that work today; "coming soon" pages are noindex.
  const toolPaths = tools.filter((t) => t.status === "live").map((t) => toolHref(t.id));
  const hubs = CLUSTERS.map((c) => clusterHref(c.id));
  return [...PAGES, ...hubs, ...toolPaths].map((path) => ({ url: path === "/" ? SITE_URL : `${SITE_URL}${path}` }));
}
