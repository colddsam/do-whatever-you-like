import { CLUSTERS, clusterHref, liveCount, toolHref, toolsIn } from "@/lib/tools";
import { BLOG_POSTS, blogHref } from "@/lib/blog";
import { HUBS } from "@/lib/hubs";
import { CONTACT_EMAIL, SITE_NAME, absUrl } from "@/lib/site";
import { LEGAL_PAGES } from "@/lib/legal";

/**
 * /llms.txt (llmstxt.org): a plain Markdown map of the site for AI assistants and agents — what it
 * is, every collection and every live tool with a one-line description. Built from the catalogue,
 * so it never drifts from the site. Optional for search engines; Google ignores it.
 */
export function GET() {
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${liveCount} free online tools for everyday digital chores: PDF, images, file conversion, media downloads, audio transcription, developer and text utilities. No sign-up, nothing to install.`,
    "",
    // General notes go before the first H2 (llmstxt.org); H2 sections hold link lists.
    "Key facts:",
    "",
    `- **Total live tools:** ${liveCount} across ${CLUSTERS.length} collections`,
    "- **Cost & accounts:** 100% free, no sign-up, no watermarks",
    "- **Where tools run:** Browser-only for most developer, text, meme, photo editor, Pro photo editor (Photoshop/Lightroom-style, with PSD support), Video editor (Premiere/After Effects/CapCut-style multi-track timeline, keyframes, on-device auto-captions, MP4 export up to 4K), and font creator tools; isolated server processing for PDF, image, media, transcription, and network lookup tools",
    "- **Data retention:** Files are deleted immediately after download (or after 30 minutes for multi-step PDF tools)",
    "",
    "## Core Pages",
    "",
    `- [Home](${absUrl("/")}): overview, search, and FAQ`,
    `- [All tools](${absUrl("/tools")}): full searchable directory of all ${liveCount} live tools`,
    `- [Blog](${absUrl("/blog")}): product launches, architecture notes and deep dives`,
    `- [Full tool specs (llms-full.txt)](${absUrl("/llms-full.txt")}): detailed inputs, outputs, limits, and features for every tool`,
    ...LEGAL_PAGES.map((p) => `- [${p.label}](${absUrl(p.href)}): ${p.summary}`),
    `- Contact: ${CONTACT_EMAIL}`,
    "",
    "## Blog",
    "",
    ...BLOG_POSTS.map((p) => `- [${p.title}](${absUrl(blogHref(p.slug))}): ${p.subtitle}`),
    "",
    ...CLUSTERS.flatMap((c) => {
      const live = toolsIn(c.id).filter((t) => t.status === "live");
      if (!live.length) return [];
      return [
        `## ${c.title}`,
        "",
        `[${c.title} overview](${absUrl(clusterHref(c.id))}): ${HUBS[c.id].description}`,
        "",
        ...live.map((t) => `- [${t.name}](${absUrl(toolHref(t.id))}): ${t.description}`),
        "",
      ];
    }),
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
