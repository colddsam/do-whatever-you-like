import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Copyright & DMCA — Do-Whatever-You-Like",
  description: "How rights holders can report copyright infringement involving Do-Whatever-You-Like, what a takedown notice should include, and how we respond.",
  path: "/copyright",
});

const link = "underline decoration-line underline-offset-4 hover:decoration-ink";

export default function CopyrightPage() {
  return (
    <LegalPage
      current="/copyright"
      updated="28 Nov 2026"
      title={
        <>
          Copyright &amp; <span className="serif-em">takedowns.</span>
        </>
      }
      intro="We respect creators' rights. If you believe our site or tools are being used to infringe your copyright, tell us and we'll act quickly. We handle notices under India's Copyright Act, 1957 and the Information Technology Act, 2000, and we also accept notices in the format of the US DMCA."
      sections={[
        {
          title: "We don't host media",
          body: (
            <p>
              Our tools process files and public links when someone asks, then delete them. We don&apos;t keep a
              library of downloaded or converted content, and nothing is published on the site. The tools only work
              with public content and never get around logins, paywalls or DRM. See the{" "}
              <Link href="/fair-use" className={link}>
                fair use guidelines
              </Link>
              .
            </p>
          ),
        },
        {
          title: "Sending a takedown notice",
          body: (
            <>
              <p>
                Email{" "}
                <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Copyright notice")}`} className={link}>
                  {CONTACT_EMAIL}
                </a>{" "}
                with the subject &ldquo;Copyright notice&rdquo; and include:
              </p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>your name and contact details, and who you act for if you&apos;re an agent;</li>
                <li>the copyrighted work you believe is being infringed;</li>
                <li>the page on our site, or the original content link, involved, and how it&apos;s being misused;</li>
                <li>a statement that you believe in good faith the use isn&apos;t authorised by the owner, its agent or the law;</li>
                <li>a statement that the information is accurate and, under penalty of perjury, that you&apos;re the owner or authorised to act for them;</li>
                <li>your physical or electronic signature.</li>
              </ul>
            </>
          ),
        },
        {
          title: "What we do next",
          body: (
            <p>
              We acknowledge notices within 24 hours and review every complete notice promptly, within the timelines set by Indian law. Where it&apos;s valid we act on it, for example by blocking a
              specific link or content source from our tools, or removing material from our own pages. We may contact
              you if we need more information.
            </p>
          ),
        },
        {
          title: "Counter-notices",
          body: (
            <p>
              If you believe something was blocked by mistake, email us with the details, why you have the right to use
              the content, and your contact information. We&apos;ll review it and may share it with the person who
              sent the original notice.
            </p>
          ),
        },
        {
          title: "Repeat or false claims",
          body: (
            <p>
              We may block anyone who repeatedly uses our tools to infringe copyright. Knowingly sending a false notice
              may make you legally liable for the harm it causes.
            </p>
          ),
        },
      ]}
    />
  );
}
