import { BLOG_POSTS, blogHref } from "@/lib/blog";
import { SITE_NAME, absUrl } from "@/lib/site";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function rfc822Date(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toUTCString();
}

export function GET() {
  const posts = [...BLOG_POSTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const lastBuild = posts[0] ? rfc822Date(posts[0].updatedAt ?? posts[0].publishedAt) : new Date().toUTCString();

  const items = posts
    .map((p) => {
      const link = absUrl(blogHref(p.slug));
      return [
        "    <item>",
        `      <title>${escapeXml(p.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${rfc822Date(p.publishedAt)}</pubDate>`,
        `      <category>${escapeXml(p.category)}</category>`,
        `      <description>${escapeXml(p.subtitle)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(`${SITE_NAME} — Journal`)}</title>`,
    `    <link>${escapeXml(absUrl("/blog"))}</link>`,
    `    <atom:link href="${escapeXml(absUrl("/blog/rss.xml"))}" rel="self" type="application/rss+xml" />`,
    `    <description>${escapeXml("Product launches, engineering architecture notes, and practical guides for Do-Whatever-You-Like.")}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
