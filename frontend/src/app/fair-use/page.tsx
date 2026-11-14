import type { Metadata } from "next";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Fair use — Do-Whatever-You-Like",
  description: "How to use Do-Whatever-You-Like's downloaders responsibly.",
  path: "/fair-use",
});

export default function FairUsePage() {
  return (
    <LegalPage
      current="/fair-use"
      updated="9 Nov 2026"
      title={
        <>
          Download <span className="serif-em">responsibly.</span>
        </>
      }
      intro="Downloaders are handy for keeping your own content, saving something for offline viewing, or quoting a clip in a review. They're not a way around creators' rights."
      sections={[
        {
          title: "Good uses",
          body: (
            <p>
              Backing up videos and posts you made yourself, saving content the creator has openly licensed, or
              keeping a copy for personal, offline viewing where the law allows it.
            </p>
          ),
        },
        {
          title: "Not okay",
          body: (
            <p>
              Re-uploading someone else&apos;s work as your own, selling it, or redistributing it without permission.
              Respect each platform&apos;s terms as well as copyright law where you live.
            </p>
          ),
        },
        {
          title: "Public content only",
          body: (
            <p>
              The tools only work with public posts. They won&apos;t open private accounts, paywalled content or
              anything behind a login, and we won&apos;t add ways to do that.
            </p>
          ),
        },
        {
          title: "Rights holders",
          body: (
            <p>
              We don&apos;t host or store the media people download. If you believe a tool is being misused with your
              content, email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
                {CONTACT_EMAIL}
              </a>{" "}
              and we&apos;ll act on it quickly.
            </p>
          ),
        },
      ]}
    />
  );
}
