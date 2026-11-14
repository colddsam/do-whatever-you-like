import { CLUSTERS, clusterHref, liveCount, toolHref, toolsIn } from "@/lib/tools";
import { HUBS } from "@/lib/hubs";
import { CONTACT_EMAIL, SITE_NAME, absUrl } from "@/lib/site";

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
    "## Key Facts",
    "",
    `- **Total live tools:** ${liveCount} across ${CLUSTERS.length} collections`,
    "- **Cost & accounts:** 100% free, no sign-up, no watermarks",
    "- **Where tools run:** Browser-only for most developer, text, meme, photo editor, and font creator tools; isolated server processing for PDF, image, media, transcription, and network lookup tools",
    "- **Data retention:** Files are deleted immediately after download (or after 30 minutes for multi-step PDF tools)",
    "",
    "## Core Pages",
    "",
    `- [Home](${absUrl("/")}): overview, search, and FAQ`,
    `- [All tools](${absUrl("/tools")}): full searchable directory of all ${liveCount} live tools`,
    `- [Full tool specs (llms-full.txt)](${absUrl("/llms-full.txt")}): detailed inputs, outputs, limits, and features for every tool`,
    `- [About](${absUrl("/about")}): who runs the site and how to get in touch (${CONTACT_EMAIL})`,
    `- [Privacy](${absUrl("/privacy")}): where files go and how long they're kept`,
    `- [Terms](${absUrl("/terms")}): ground rules for using the tools`,
    `- [Fair use](${absUrl("/fair-use")}): guidelines for responsible media downloads`,
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
