import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Providers } from "@/components/providers";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { OPERATOR, SITE_NAME, SITE_URL } from "@/lib/site";
import { siteGraph } from "@/lib/schema";
import { JsonLd } from "@/components/seo/json-ld";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-GVKMN99S3N";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

export const metadata: Metadata = {
  // Lets every page give a relative canonical. Pages set their own; the layout sets none, so
  // the 404 page and any page without one never claim to be the home page.
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  authors: [{ name: OPERATOR.name, url: OPERATOR.url }],
  creator: OPERATOR.name,
  publisher: SITE_NAME,
  category: "Utilities",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Search Console / Bing Webmaster ownership tags, only when the codes are set (see .env.example).
  // Not needed if the site is verified by DNS.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
  title: "Do-Whatever-You-Like — One place to get any task done",
  description:
    "Do-Whatever-You-Like is a growing toolbox for everyday digital chores. Download media, convert files, tidy documents and more. Paste a link, pick a task, done.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f3f0e8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        <link rel="alternate" type="text/markdown" href="/llms.txt" title="LLM site map" />
        <link rel="alternate" type="text/markdown" href="/llms-full.txt" title="Full LLM tool specifications" />
        <JsonLd data={siteGraph} />
        <Providers>
          <Navbar />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
        </Providers>
        <Analytics />
        {GA_ID && <GoogleAnalytics gaId={GA_ID} />}
      </body>
    </html>
  );
}
