import { CLUSTERS, clusterHref, liveCount, toolHref, toolsIn, wherePrivacy } from "@/lib/tools";
import { HUBS } from "@/lib/hubs";
import { CONTACT_EMAIL, SITE_NAME, absUrl } from "@/lib/site";

/**
 * /llms-full.txt (llmstxt.org): full Markdown reference of every live tool with inputs, outputs,
 * limits, privacy/execution location, and feature list for LLMs and AI answer engines (GEO/LLMO).
 */
export function GET() {
  const lines = [
    `# ${SITE_NAME} — Full Tool Specifications`,
    "",
    `> ${liveCount} free online tools across ${CLUSTERS.length} collections. No sign-up, no watermarks, nothing to install.`,
    "",
    `Contact: ${CONTACT_EMAIL}`,
    `Compact index: ${absUrl("/llms.txt")}`,
    "",
    ...CLUSTERS.flatMap((c) => {
      const live = toolsIn(c.id).filter((t) => t.status === "live");
      if (!live.length) return [];
      return [
        `## ${c.title}`,
        "",
        `${HUBS[c.id].intro} (${absUrl(clusterHref(c.id))})`,
        "",
        ...live.flatMap((t) => {
          const privacy = wherePrivacy(t) ?? "Runs in your browser";
          return [
            `### ${t.name}`,
            `- **URL:** ${absUrl(toolHref(t.id))}`,
            `- **Summary:** ${t.description}`,
            `- **Takes:** ${t.takes}`,
            `- **Gives:** ${t.gives}`,
            ...(t.limit ? [`- **Limit:** ${t.limit}`] : []),
            `- **Privacy / Execution:** ${privacy}`,
            `- **Capabilities:** ${t.features.join("; ")}`,
            "",
          ];
        }),
      ];
    }),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

