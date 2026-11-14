import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/layout/legal-page";
import { CONTACT_EMAIL, OPERATOR, pageMeta } from "@/lib/site";
import { liveCount } from "@/lib/tools";

export const metadata: Metadata = pageMeta({
  title: "About — Do-Whatever-You-Like",
  description: "Who builds Do-Whatever-You-Like, how its free tools work, and how to get in touch about bugs, privacy or takedowns.",
  path: "/about",
});

const link = "underline decoration-line underline-offset-4 hover:decoration-ink";

export default function AboutPage() {
  return (
    <LegalPage
      current="/about"
      updated="13 Nov 2026"
      title={
        <>
          Who&apos;s behind <span className="serif-em">Do-Whatever-You-Like.</span>
        </>
      }
      intro={`Do-Whatever-You-Like is ${liveCount} free tools for everyday digital chores, built and run by one independent developer. Nothing to install and no account to make.`}
      sections={[
        {
          title: "Who runs it",
          body: (
            <p>
              Do-Whatever-You-Like is built and maintained by{" "}
              <a href={OPERATOR.url} className={link} rel="me noopener" target="_blank">
                {OPERATOR.name}
              </a>
              , an independent developer.
            </p>
          ),
        },
        {
          title: "How the tools work",
          body: (
            <>
              <p>
                Some tools run entirely in your browser: most developer and text utilities, the meme generator, the photo
                editor and the font creator. What you give them never leaves your device.
              </p>
              <p>
                The rest run on our server using well-known open-source software: LibreOffice, Pandoc and FFmpeg for
                conversions, Whisper for transcription (on our server or through Groq), Real-ESRGAN for upscaling, and standard PDF libraries. Files
                are deleted as soon as the result is sent, or within 30 minutes for PDF tools so you can try other
                settings. Lookups such as DNS and port checks run on our server too, and only reach public addresses. Every tool page says where it runs. The{" "}
                <Link href="/privacy" className={link}>
                  privacy page
                </Link>{" "}
                has the details.
              </p>
            </>
          ),
        },
        {
          title: "Why it's free",
          body: (
            <p>
              There&apos;s no paid tier and no account to create. Please use the downloaders
              within the{" "}
              <Link href="/fair-use" className={link}>
                fair use guidelines
              </Link>
              .
            </p>
          ),
        },
        {
          title: "Contact",
          body: (
            <p>
              Bug reports, privacy questions, takedown requests and tool ideas:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                {CONTACT_EMAIL}
              </a>
              . You can also request a tool with the form on the{" "}
              <Link href="/#request" className={link}>
                home page
              </Link>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
