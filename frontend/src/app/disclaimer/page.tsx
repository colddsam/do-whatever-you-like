import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Disclaimer — Do-Whatever-You-Like",
  description: "The limits of Do-Whatever-You-Like's free tools: results may not be accurate, health tools aren't medical advice, and you're responsible for how you use them.",
  path: "/disclaimer",
});

const link = "underline decoration-line underline-offset-4 hover:decoration-ink";

export default function DisclaimerPage() {
  return (
    <LegalPage
      current="/disclaimer"
      updated="28 Nov 2026"
      title={
        <>
          Useful, but <span className="serif-em">not perfect.</span>
        </>
      }
      intro="We work hard to make every tool reliable, but they're free, automated tools. Please read what that means before relying on a result."
      sections={[
        {
          title: "Check important results",
          body: (
            <p>
              Conversions, compression, OCR, translations, transcriptions, summaries, calculations and AI features can
              make mistakes or lose formatting. Always keep your original file, and check any result that matters before
              you use or share it.
            </p>
          ),
        },
        {
          title: "Not medical advice",
          body: (
            <p>
              The period tracker and any other health tools give estimates only. They aren&apos;t a medical device or a
              form of contraception, and they don&apos;t replace advice from a doctor or other qualified professional.
            </p>
          ),
        },
        {
          title: "Not professional advice",
          body: (
            <p>
              Currency rates, unit conversions, calculators and similar tools are for general information. They
              aren&apos;t financial, legal, tax or engineering advice, and live data such as exchange rates may be
              delayed.
            </p>
          ),
        },
        {
          title: "Security tools",
          body: (
            <p>
              The password generator, encrypted notes, hash and network tools are provided to help you, but no tool is
              perfectly secure. Use them at your own risk, and only test systems you own or have permission to test.
            </p>
          ),
        },
        {
          title: "Downloads and copyright",
          body: (
            <p>
              We&apos;re not affiliated with, endorsed by or sponsored by YouTube, Instagram, Facebook or any other
              platform; their names are used only to describe what the tools work with. You&apos;re responsible for
              making sure you have the right to download and use any content. See the{" "}
              <Link href="/fair-use" className={link}>
                fair use guidelines
              </Link>
              .
            </p>
          ),
        },
        {
          title: "External links",
          body: (
            <p>
              The site and blog may link to other websites. We don&apos;t control them and aren&apos;t responsible for
              their content or practices.
            </p>
          ),
        },
        {
          title: "Full terms",
          body: (
            <p>
              This disclaimer is part of our{" "}
              <Link href="/terms" className={link}>
                terms &amp; conditions
              </Link>
              . Spotted a wrong result? Tell us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                {CONTACT_EMAIL}
              </a>{" "}
              so we can fix it.
            </p>
          ),
        },
      ]}
    />
  );
}
