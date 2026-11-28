import type { Metadata } from "next";
import Link from "next/link";
import { Bug, Lightbulb, Mail, ShieldAlert } from "lucide-react";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Support — Do-Whatever-You-Like",
  description: "Get help with Do-Whatever-You-Like: fixes for common problems with downloads, conversions and uploads, how to report a bug, and how to contact us.",
  path: "/support",
});

const link = "underline decoration-line underline-offset-4 hover:decoration-ink";
const mail = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

const channels = [
  { icon: Mail, title: "General help", text: "Questions about a tool or your data.", href: mail("Support: "), cta: "Email us" },
  { icon: Bug, title: "Report a bug", text: "Something broke or gave a wrong result.", href: mail("Bug report: "), cta: "Send a report" },
  { icon: Lightbulb, title: "Request a tool", text: "Missing a tool you need? Tell us.", href: "/#request", cta: "Open the form" },
  { icon: ShieldAlert, title: "Security issue", text: "Found a vulnerability? Report it privately.", href: mail("[SECURITY] "), cta: "Report privately" },
];

export default function SupportPage() {
  return (
    <LegalPage
      current="/support"
      updated="28 Nov 2026"
      title={
        <>
          How can we <span className="serif-em">help?</span>
        </>
      }
      intro="Most problems have a quick fix, listed below. If yours isn't covered, write to us. A real person reads every message."
      sections={[
        {
          title: "Contact us",
          body: (
            <>
              <p>
                Email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                  {CONTACT_EMAIL}
                </a>{" "}
                for anything: help, bug reports, privacy questions, takedown requests or feedback.
              </p>
              <p>
                The site is run by one independent developer, so we usually reply within a few days. Security reports
                and takedown requests go to the front of the queue.
              </p>
            </>
          ),
        },
        {
          title: "What to include in a bug report",
          body: (
            <ul className="list-disc space-y-1.5 pl-5">
              <li>The tool&apos;s name or the page link.</li>
              <li>What you did, what you expected, and what happened instead, including any error message.</li>
              <li>Your browser and device, for example &ldquo;Chrome on Android&rdquo; or &ldquo;Safari on Mac&rdquo;.</li>
              <li>For a downloader, the public link you used. Don&apos;t send private files unless we ask.</li>
            </ul>
          ),
        },
        {
          title: "The first request is slow, or a tool times out",
          body: (
            <p>
              Tools that run on our server use free hosting that goes to sleep when nobody is using it. The first
              request after a quiet spell can take up to a minute while it wakes up. Wait a moment and try again. Later
              requests are fast.
            </p>
          ),
        },
        {
          title: "A downloader isn't working",
          body: (
            <>
              <p>
                Check that the post is public and that you can open it in a private browser window without logging in.
                Private, age-restricted, paywalled and live content isn&apos;t supported.
              </p>
              <p>
                YouTube, Instagram and Facebook change their sites often, and that can break a downloader for a while.
                If a public link fails more than once, please report it so we can fix it.
              </p>
            </>
          ),
        },
        {
          title: "A conversion failed or looks wrong",
          body: (
            <p>
              Check the file opens on your own device, and check its size against the limit on the tool&apos;s page
              under &ldquo;At a glance&rdquo;. Files that are password-protected, damaged or use unusual fonts may not
              convert well. If a file that opens fine still fails, send us the details and, if you can, a sample file
              with nothing private in it.
            </p>
          ),
        },
        {
          title: "Browser tools and saved data",
          body: (
            <p>
              Many tools run entirely in your browser and save your work, such as notes, period entries and editor
              projects, in your browser&apos;s storage, not on our server. That means we can&apos;t recover it for you.
              Clearing your browser data or using a private window removes it, so export anything you want to keep.
              For the best results use a current version of Chrome, Edge, Firefox or Safari.
            </p>
          ),
        },
        {
          title: "Privacy and removal requests",
          body: (
            <p>
              We don&apos;t keep accounts or a history of your files, so there&apos;s usually nothing to delete. For any
              privacy question see the{" "}
              <Link href="/privacy" className={link}>
                privacy policy
              </Link>
              . If your copyrighted content is being misused through our tools, see the{" "}
              <Link href="/copyright" className={link}>
                copyright page
              </Link>
              .
            </p>
          ),
        },
      ]}
    >
      <ul className="mt-10 grid gap-3 sm:grid-cols-2">
        {channels.map(({ icon: Icon, title, text, href, cta }) => (
          <li key={title}>
            <a
              href={href}
              className="group flex h-full flex-col rounded-xl border border-line bg-paper p-5 transition-colors hover:border-ink-3 hover:bg-paper-2"
            >
              <Icon aria-hidden className="size-5 text-accent" />
              <span className="mt-3 font-semibold tracking-[-0.01em] text-ink">{title}</span>
              <span className="mt-1 text-[15px] leading-relaxed text-ink-2">{text}</span>
              <span className="mt-4 text-sm font-medium text-ink underline decoration-line underline-offset-4 group-hover:decoration-ink">
                {cta} →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </LegalPage>
  );
}
