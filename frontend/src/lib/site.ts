import type { Metadata } from "next";

/** The public origin. Used for canonical URLs, the sitemap, robots.txt and structured data. */
export const SITE_URL = "https://do-whatever-you-like.colddsam.com";
export const SITE_NAME = "Do-Whatever";

/** Who runs the site, shown on /about and in the Organization schema. */
export const OPERATOR = { name: "colddsam", url: "https://github.com/colddsam" } as const;
/** Questions, bug reports and takedown requests. */
export const CONTACT_EMAIL = "colddsam@gmail.com";

const DEFAULT_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Do-Whatever: free online tools" };

/**
 * A page's title, description, canonical and social cards in one place. Next replaces (not merges)
 * a parent's `openGraph`/`twitter`, so every page builds the full set here.
 */
export function pageMeta({ title, description, path, image }: { title: string; description: string; path: string; image?: string }): Metadata {
  const card = image ? { ...DEFAULT_IMAGE, url: image, alt: title } : DEFAULT_IMAGE;
  return {
    title,
    description,
    alternates: { canonical: path },
    // The site's card unless the page has its own (a route's opengraph-image file also wins for og:image).
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: path, title, description, images: [card] },
    twitter: { card: "summary_large_image", title, description, images: [card] },
  };
}

/** Absolute URL for a site path, for structured data (which can't use `metadataBase`). */
export const absUrl = (path: string) => (path === "/" ? SITE_URL : `${SITE_URL}${path}`);
