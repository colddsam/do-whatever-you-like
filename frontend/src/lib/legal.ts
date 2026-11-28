/**
 * The help, about and legal pages, in one list shared by the legal-page sidebar, the footer, the
 * sitemap and llms.txt. Add a page here (and its app/<slug>/page.tsx) and it shows up everywhere.
 * scripts/lastmod.mjs keeps its own copy of the slugs; update it too.
 */
export const LEGAL_PAGES = [
  { href: "/support", label: "Support", group: "help", summary: "help, troubleshooting and how to contact us" },
  { href: "/about", label: "About", group: "help", summary: "who runs the site and how the tools work" },
  { href: "/terms", label: "Terms", group: "legal", summary: "the terms and conditions for using the tools" },
  { href: "/privacy", label: "Privacy", group: "legal", summary: "what happens to your files, links and data" },
  { href: "/cookies", label: "Cookies", group: "legal", summary: "the cookies and browser storage the site uses" },
  { href: "/fair-use", label: "Fair use", group: "legal", summary: "guidelines for responsible media downloads" },
  { href: "/copyright", label: "Copyright", group: "legal", summary: "copyright and takedown (DMCA) requests" },
  { href: "/disclaimer", label: "Disclaimer", group: "legal", summary: "the limits of what the tools promise" },
  { href: "/accessibility", label: "Accessibility", group: "help", summary: "our accessibility commitment and known gaps" },
] as const;

export type LegalHref = (typeof LEGAL_PAGES)[number]["href"];
