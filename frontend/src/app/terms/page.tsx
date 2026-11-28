import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, OPERATOR, SITE_NAME, SITE_URL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Terms & Conditions — Do-Whatever-You-Like",
  description: "The terms and conditions for using Do-Whatever-You-Like's free online tools: acceptable use, your content, intellectual property, warranties, liability and changes.",
  path: "/terms",
});

const link = "underline decoration-line underline-offset-4 hover:decoration-ink";
const strong = "font-medium text-ink";

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      updated="28 Nov 2026"
      title={
        <>
          Terms &amp; <span className="serif-em">conditions.</span>
        </>
      }
      intro={`These terms apply when you use ${SITE_NAME} (${SITE_URL.replace("https://", "")}) and its tools. By using the site you agree to them. If you don't agree, please don't use the site.`}
      sections={[
        {
          title: "Who we are",
          body: (
            <p>
              {SITE_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a free collection of online tools built and run by{" "}
              <a href={OPERATOR.url} className={link} rel="noopener" target="_blank">
                {OPERATOR.name}
              </a>
              , an independent developer. You can contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          ),
        },
        {
          title: "Using the service",
          body: (
            <>
              <p>
                The tools are free and need no account. You may use them for personal and commercial work, as long as
                you follow these terms and the law where you live.
              </p>
              <p>
                If you&apos;re under the age of digital consent where you live, you need a parent or guardian&apos;s
                permission to use the site.
              </p>
            </>
          ),
        },
        {
          title: "Acceptable use",
          body: (
            <>
              <p>You agree not to:</p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>use the tools for anything illegal, or to infringe anyone&apos;s copyright, privacy or other rights;</li>
                <li>process content that sexually exploits minors, promotes violence or is otherwise unlawful;</li>
                <li>get around a platform&apos;s privacy settings, paywalls, logins or other access controls;</li>
                <li>use the network tools (DNS, HTTP, port checks and similar) to scan or attack systems you don&apos;t own or have permission to test;</li>
                <li>overload the service with automated or bulk requests, scrape it, or get around its rate limits;</li>
                <li>upload malware, or try to break, probe or reverse-engineer the service&apos;s security.</li>
              </ul>
              <p>We may block access for anyone who breaks these rules.</p>
            </>
          ),
        },
        {
          title: "Your content",
          body: (
            <>
              <p>
                You keep every right to the files, text and links you use with the tools (&ldquo;your content&rdquo;).
                We claim no ownership of your content or of the results you create.
              </p>
              <p>
                You give us only the limited permission needed to process your content and return the result. How long
                we keep it is set out in the{" "}
                <Link href="/privacy" className={link}>
                  privacy policy
                </Link>
                : in short, server files are deleted as soon as the result is sent (30 minutes for PDF tools).
              </p>
              <p>
                You confirm you have the right to use your content in this way. You&apos;re responsible for what you
                download and how you use it; the{" "}
                <Link href="/fair-use" className={link}>
                  fair use guidelines
                </Link>{" "}
                explain what&apos;s okay.
              </p>
            </>
          ),
        },
        {
          title: "Our intellectual property",
          body: (
            <p>
              The site&apos;s design, name, logo, text and code belong to us or our licensors. Some tools are built on
              open-source software, which stays under its own licence. Using the site doesn&apos;t give you any right
              to our branding.
            </p>
          ),
        },
        {
          title: "Third-party services",
          body: (
            <p>
              Some tools contact other services to do their job, such as YouTube, Instagram, Facebook or a transcription
              provider. We don&apos;t control those services, and their own terms and policies apply. Links to other
              websites are for convenience only; we aren&apos;t responsible for their content.
            </p>
          ),
        },
        {
          title: "Availability and changes to the tools",
          body: (
            <p>
              The service is free, so we can&apos;t promise it will always be available. Tools have size and length
              limits, and we may change, limit, pause or remove any tool, or the whole service, at any time and without
              notice. Platforms change often, so a downloader may stop working for a while.
            </p>
          ),
        },
        {
          title: "No warranty",
          body: (
            <p>
              <span className={strong}>The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;.</span>{" "}
              To the extent the law allows, we make no promises that the tools will be error-free, secure,
              uninterrupted, or that their results (conversions, calculations, translations, transcriptions, health
              estimates and so on) will be accurate or fit for a particular purpose. Always keep a copy of your
              original files and check important results. See the{" "}
              <Link href="/disclaimer" className={link}>
                disclaimer
              </Link>{" "}
              for more.
            </p>
          ),
        },
        {
          title: "Limitation of liability",
          body: (
            <p>
              To the extent the law allows, we aren&apos;t liable for any indirect, incidental or consequential loss,
              or for lost data, profits or business, arising from your use of the site, even if we were told it might
              happen. Because the service is free, our total liability for any claim is limited to zero, or the lowest
              amount the law allows. Nothing in these terms limits liability that can&apos;t legally be limited.
            </p>
          ),
        },
        {
          title: "Indemnity",
          body: (
            <p>
              If someone makes a claim against us because of content you processed or your breach of these terms, you
              agree to cover the reasonable costs and losses that result, to the extent the law allows.
            </p>
          ),
        },
        {
          title: "Governing law and disputes",
          body: (
            <>
              <p>
                These terms are governed by the laws of India, including the Information Technology Act, 2000 and the
                rules made under it. Any dispute arising from these terms or your use of the site will be handled only
                by the courts of India.
              </p>
              <p>
                Before going to court, please email us first. Most problems can be sorted out quickly and informally.
              </p>
            </>
          ),
        },
        {
          title: "Grievance officer",
          body: (
            <>
              <p>
                In line with the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules,
                2021 and the Digital Personal Data Protection Act, 2023, complaints about content, misuse of the tools
                or your personal data can be sent to our grievance officer:
              </p>
              <p>
                <span className={strong}>{OPERATOR.name}</span>, Grievance Officer, {SITE_NAME}
                <br />
                Email:{" "}
                <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Grievance")}`} className={link}>
                  {CONTACT_EMAIL}
                </a>{" "}
                (subject &ldquo;Grievance&rdquo;)
              </p>
              <p>We acknowledge complaints within 24 hours and aim to resolve them within 15 days.</p>
            </>
          ),
        },
        {
          title: "Changes to these terms",
          body: (
            <p>
              We may update these terms. The date at the top shows when they last changed. If you keep using the site
              after a change, you accept the new terms.
            </p>
          ),
        },
        {
          title: "General",
          body: (
            <>
              <p>
                If any part of these terms can&apos;t be enforced, the rest still applies. If we don&apos;t enforce a
                term straight away, we haven&apos;t given up the right to do so later. These terms, together with the{" "}
                <Link href="/privacy" className={link}>
                  privacy policy
                </Link>
                ,{" "}
                <Link href="/cookies" className={link}>
                  cookie policy
                </Link>{" "}
                and{" "}
                <Link href="/fair-use" className={link}>
                  fair use guidelines
                </Link>
                , are the whole agreement between you and us about the site.
              </p>
              <p>
                Questions about these terms? Email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
