import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Cookie Policy — Do-Whatever-You-Like",
  description: "Which cookies and browser storage Do-Whatever-You-Like uses: analytics cookies, local storage for tools that run in your browser, and how to control them.",
  path: "/cookies",
});

const link = "underline decoration-line underline-offset-4 hover:decoration-ink";
const strong = "font-medium text-ink";

export default function CookiesPage() {
  return (
    <LegalPage
      current="/cookies"
      updated="28 Nov 2026"
      title={
        <>
          Cookies, <span className="serif-em">kept to a minimum.</span>
        </>
      }
      intro="We don't run ads and don't have accounts, so we need very few cookies. Here's everything the site stores in your browser, and why."
      sections={[
        {
          title: "What cookies are",
          body: (
            <p>
              Cookies are small text files a website saves in your browser. Similar technologies, such as local storage
              and IndexedDB, let a site save data on your device too. This page covers all of them.
            </p>
          ),
        },
        {
          title: "Analytics cookies",
          body: (
            <>
              <p>
                <span className={strong}>Google Analytics (GA4)</span> sets cookies (named <code>_ga</code> and{" "}
                <code>_ga_*</code>) to count visits and see which tools are used most. They last up to two years and
                don&apos;t contain your files, links or anything you type into a tool.
              </p>
              <p>
                <span className={strong}>Vercel Web Analytics</span> counts page views without cookies and without
                tracking you across websites.
              </p>
            </>
          ),
        },
        {
          title: "Browser storage used by the tools",
          body: (
            <>
              <p>
                Some tools save your work and settings in your browser&apos;s local storage or IndexedDB so it&apos;s
                still there next time, for example notes, period-tracker entries, editor projects, chart and flowchart
                drafts, and preferences like haptic feedback.
              </p>
              <p>
                This data stays on your device. It&apos;s never sent to us or to analytics services, and we can&apos;t
                read it. These items are needed for the tools to work, so they don&apos;t need your consent.
              </p>
            </>
          ),
        },
        {
          title: "Third-party content",
          body: (
            <p>
              When a tool fetches content from another platform, such as YouTube or Instagram, it does so from our
              server, so those platforms don&apos;t set cookies in your browser through our tools. A badge or link to
              another site may set its own cookies if you click through.
            </p>
          ),
        },
        {
          title: "How to control cookies",
          body: (
            <>
              <p>
                You can block or delete cookies and site data in your browser&apos;s settings. Blocking analytics
                cookies won&apos;t stop any tool from working. Deleting site data will remove anything the browser tools
                have saved, so export it first.
              </p>
              <p>
                You can also opt out of Google Analytics on every site with Google&apos;s{" "}
                <a href="https://tools.google.com/dlpage/gaoptout" className={link} rel="noopener" target="_blank">
                  opt-out browser add-on
                </a>
                .
              </p>
            </>
          ),
        },
        {
          title: "More information",
          body: (
            <p>
              The{" "}
              <Link href="/privacy" className={link}>
                privacy policy
              </Link>{" "}
              explains how we handle your data. Questions? Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
