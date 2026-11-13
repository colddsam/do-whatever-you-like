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
    "Some tools run entirely in the browser (most developer and text utilities, the meme generator, the photo editor, the font creator). The rest process files on the server and delete them once the result is sent, or within 30 minutes for PDF tools. Each tool page says which.",
    "",
    `- [About](${absUrl("/about")}): who runs the site and how to get in touch (${CONTACT_EMAIL})`,
    `- [Privacy](${absUrl("/privacy")}): where files go and how long they're kept`,
    `- [All tools](${absUrl("/tools")}): the full directory`,
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
