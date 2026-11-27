import { CONTACT_EMAIL, OPERATOR, SITE_NAME, SITE_URL, absUrl } from "@/lib/site";
import { CLUSTERS, clusterHref, clusterOf, getCluster, liveCount, toolHref, type Tool } from "@/lib/tools";
import { guideFor, howTo, type Faq } from "@/lib/guides";
import { blogHref, estimateWordCount, type BlogPost } from "@/lib/blog";
import { lastModified } from "@/lib/lastmod";

/** `dateModified` when the page has a real one (see lib/lastmod). */
const modified = (path: string) => {
  const date = lastModified(path);
  return date ? { dateModified: date } : {};
};

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
      alternateName: ["Do-Whatever-You-Like Tools", "do-whatever-you-like"],
      url: SITE_URL,
      logo: absUrl("/icon.svg"),
      image: absUrl("/logo.png"),
      description: `${SITE_NAME} is a free, no-sign-up web toolbox with ${liveCount} online utilities for PDFs, images, file conversion, video/audio, design, and software development.`,
      email: CONTACT_EMAIL,
      contactPoint: {
        "@type": "ContactPoint",
        email: CONTACT_EMAIL,
        contactType: "customer support",
      },
      knowsAbout: [
        "PDF processing and OCR",
        "Universal file conversion",
        "Image compression and editing",
        "Video and audio processing",
        "Developer utilities and formatters",
        "Web accessibility and contrast checking",
        "Client-side cryptography and hashing",
      ],
      publishingPrinciples: absUrl("/privacy"),
      termsOfService: absUrl("/terms"),
      founder: { "@type": "Person", name: OPERATOR.name, url: OPERATOR.url },
      // Profiles that exist today; add YouTube, Product Hunt, AlternativeTo… as they go live.
      sameAs: [OPERATOR.url, "https://www.saashub.com/do-whatever-you-like"],
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
        ...modified("/"),
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["#hero-title", "#faq-title", "#faq details summary", "#faq details p"],
        },
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
        ...(tool.keywords?.length ? { keywords: tool.keywords.join(", ") } : {}),
        softwareHelp: { "@type": "CreativeWork", url: `${url}#guide-title` },
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        ...modified(toolHref(tool.id)),
      },
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: `${tool.name} — ${SITE_NAME}`,
        description: tool.description,
        isPartOf: { "@id": SITE_ID },
        mainEntity: { "@id": `${url}#app` },
        inLanguage: "en",
        ...modified(toolHref(tool.id)),
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["h1", "#guide-title"],
        },
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
        ...modified(path),
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
        ...modified("/tools"),
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

/** /blog: Blog index + breadcrumbs. */
export function blogIndexGraph(posts: BlogPost[]) {
  const url = absUrl("/blog");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${url}#blog`,
        name: `Journal — ${SITE_NAME}`,
        description: `Product releases, architecture notes, and deep dives into how ${liveCount} free browser-first tools are built.`,
        url,
        inLanguage: "en",
        isPartOf: { "@id": SITE_ID },
        publisher: { "@id": ORG_ID },
        blogPost: posts.map((p) => ({
          "@type": "BlogPosting",
          headline: p.title,
          url: absUrl(blogHref(p.slug)),
          datePublished: p.publishedAt,
        })),
      },
      crumbs([
        ["Home", "/"],
        ["Blog", "/blog"],
      ]),
    ],
  };
}

/** /blog/[slug]: BlogPosting, optional VideoObject, and breadcrumbs. */
export function blogPostGraph(post: BlogPost) {
  const url = absUrl(blogHref(post.slug));
  const modified = post.updatedAt ?? post.publishedAt;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${url}#post`,
        headline: post.title,
        description: post.description,
        url,
        mainEntityOfPage: url,
        datePublished: post.publishedAt,
        dateModified: modified,
        inLanguage: "en",
        articleSection: post.category,
        keywords: post.tags.join(", "),
        wordCount: estimateWordCount(post),
        image: absUrl(post.cover.src),
        author: { "@type": "Person", name: post.author.name, url: post.author.url },
        publisher: { "@id": ORG_ID },
        isPartOf: { "@id": `${absUrl("/blog")}#blog` },
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["h1", ".blog-standfirst"],
        },
      },
      ...(post.video
        ? [
            {
              "@type": "VideoObject",
              "@id": `${url}#video`,
              name: post.video.title,
              description: post.video.caption,
              thumbnailUrl: [
                absUrl(post.video.poster),
                `https://i.ytimg.com/vi/${post.video.youtubeId}/hqdefault.jpg`,
              ],
              uploadDate: post.video.uploadDate,
              duration: post.video.isoDuration,
              contentUrl: `https://youtu.be/${post.video.youtubeId}`,
              embedUrl: `https://www.youtube-nocookie.com/embed/${post.video.youtubeId}`,
              publisher: { "@id": ORG_ID },
            },
          ]
        : []),
      crumbs([
        ["Home", "/"],
        ["Blog", "/blog"],
        [post.title, blogHref(post.slug)],
      ]),
    ],
  };
}
