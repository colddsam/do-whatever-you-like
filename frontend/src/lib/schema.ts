import { CONTACT_EMAIL, OPERATOR, SITE_NAME, SITE_URL, absUrl } from "@/lib/site";
import { clusterHref, clusterOf, getCluster, toolHref, type Tool } from "@/lib/tools";

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

/** Site-wide: who publishes it and what the site is. Rendered once, in the root layout. */
export const siteGraph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: SITE_NAME,
      url: SITE_URL,
      email: CONTACT_EMAIL,
      founder: { "@type": "Person", name: OPERATOR.name, url: OPERATOR.url },
      sameAs: [OPERATOR.url],
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      name: SITE_NAME,
      url: SITE_URL,
      inLanguage: "en",
      publisher: { "@id": ORG_ID },
    },
  ],
};

const crumbs = (items: [string, string][]) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: absUrl(path) })),
});

/** A tool page: the free web app itself, and where it sits on the site. */
export function toolGraph(tool: Tool) {
  const cluster = getCluster(clusterOf(tool));
  const url = absUrl(toolHref(tool.id));
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${url}#app`,
        name: tool.name,
        description: tool.description,
        url,
        applicationCategory: tool.family === "developer" ? "DeveloperApplication" : "UtilitiesApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript. Works in any modern browser.",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: tool.features,
        publisher: { "@id": ORG_ID },
      },
      crumbs([
        ["Home", "/"],
        ["All tools", "/tools"],
        [cluster.title, clusterHref(cluster.id)],
        [tool.name, toolHref(tool.id)],
      ]),
    ],
  };
}

/** /tools: the directory, as a list of every tool that works today. */
export function directoryGraph(live: Tool[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${absUrl("/tools")}#page`,
        name: `All tools — ${SITE_NAME}`,
        url: absUrl("/tools"),
        isPartOf: { "@id": SITE_ID },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: live.length,
          itemListElement: live.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, url: absUrl(toolHref(t.id)) })),
        },
      },
      crumbs([
        ["Home", "/"],
        ["All tools", "/tools"],
      ]),
    ],
  };
}
