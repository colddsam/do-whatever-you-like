import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Terms — Do-Whatever-You-Like",
  description: "The terms for using Do-Whatever-You-Like's tools.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      updated="9 Nov 2026"
      title={
        <>
          The <span className="serif-em">ground rules.</span>
        </>
      }
      intro="By using Do-Whatever-You-Like you agree to these terms. They're short on purpose."
      sections={[
        {
          title: "Using the tools",
          body: (
            <p>
              The tools are free for personal use. Don&apos;t use them to break the law, to overload the service, or
              to get around a platform&apos;s privacy settings or access controls.
            </p>
          ),
        },
        {
          title: "Your responsibility",
          body: (
            <p>
              You&apos;re responsible for what you download and how you use it. Only save content you own or have
              permission to use. See the fair use page for more on this.
            </p>
          ),
        },
        {
          title: "Limits",
          body: (
            <p>
              Some tools have size or length limits, and private, age-restricted or live content may not be
              supported. We may change limits to keep the service running for everyone.
            </p>
          ),
        },
        {
          title: "No warranty",
          body: (
            <p>
              The service is provided as is. Platforms change often, so a tool may stop working for a while. We do
              our best but can&apos;t promise every link will work.
            </p>
          ),
        },
        {
          title: "Changes",
          body: <p>We may update these terms. The date at the top of this page shows when they last changed.</p>,
        },
      ]}
    />
  );
}
