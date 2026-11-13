import { CONTACT_EMAIL, OPERATOR, SITE_NAME, SITE_URL, absUrl } from "@/lib/site";
import { CLUSTERS, clusterHref, clusterOf, getCluster, liveCount, toolHref, type Tool } from "@/lib/tools";
import { guideFor, howTo, type Faq } from "@/lib/guides";

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
      logo: absUrl("/icon.svg"),
      email: CONTACT_EMAIL,
      contactPoint: {
        "@type": "ContactPoint",
        email: CONTACT_EMAIL,
        contactType: "customer support",
      },
      founder: { "@type": "Person", name: OPERATOR.name, url: OPERATOR.url },
      sameAs: [OPERATOR.url],
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      name: SITE_NAME,
      description: `${liveCount} free online tools for PDF, images, file conversion, media downloads, audio transcription, developer and text utilities. No sign-up, nothing to install.`,
      url: SITE_URL,
      inLanguage: "en",
      publisher: { "@id": ORG_ID },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/tools?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

const crumbs = (items: [string, string][]) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: absUrl(path) })),
});

const faqEntity = (items: Faq[]) => ({
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
});

/** Home page: WebPage, collection directory, and FAQPage for answer/AI engines. */
export function homeGraph(faqs: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#webpage`,
        url: SITE_URL,
        name: `Free Online Tools for PDF, Images, Video & Code — ${SITE_NAME}`,
        isPartOf: { "@id": SITE_ID },
        about: { "@id": ORG_ID },
        inLanguage: "en",
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: CLUSTERS.length,
          itemListElement: CLUSTERS.map((c, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: c.title,
            url: absUrl(clusterHref(c.id)),
          })),
        },
      },
      faqEntity(faqs),
    ],
  };
}

/** A tool page: the free web app, step-by-step HowTo, FAQs (if present), and breadcrumbs. */
export function toolGraph(tool: Tool) {
  const cluster = getCluster(clusterOf(tool));
  const url = absUrl(toolHref(tool.id));
  const steps = howTo(tool);
  const guide = guideFor(tool);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${url}#app`,
        name: tool.name,
        description: tool.description,
        url,
        mainEntityOfPage: url,
        inLanguage: "en",
        screenshot: absUrl(`${toolHref(tool.id)}/opengraph-image`),
        applicationCategory: tool.family === "developer" ? "DeveloperApplication" : "UtilitiesApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript. Works in any modern browser.",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: tool.features,
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "HowTo",
        name: `How to use ${tool.name}`,
        description: tool.description,
        totalTime: "PT1M",
        step: steps.map(([name, text], i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name,
          text: text || name,
        })),
      },
      ...(guide?.faqs.length ? [faqEntity(guide.faqs)] : []),
      crumbs([
        ["Home", "/"],
        ["All tools", "/tools"],
        [cluster.title, clusterHref(cluster.id)],
        [tool.name, toolHref(tool.id)],
      ]),
    ],
  };
}

/** /about, /privacy, /terms, /fair-use: WebPage/AboutPage + breadcrumbs. */
export function legalGraph(path: string, label: string, description: string) {
  const url = absUrl(path);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": path === "/about" ? "AboutPage" : "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: `${label} — ${SITE_NAME}`,
        description,
        isPartOf: { "@id": SITE_ID },
        inLanguage: "en",
      },
      crumbs([
        ["Home", "/"],
        [label, path],
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
