import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = {
  title: "Privacy — Do-Whatever",
  description: "What Do-Whatever does with the links and files you give it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      updated="9 Nov 2026"
      title={
        <>
          Privacy, in <span className="serif-em">plain words.</span>
        </>
      }
      intro="Do-Whatever is built to do a job and forget about it. Here's exactly what that means for the links and files you hand us."
      sections={[
        {
          title: "No accounts",
          body: <p>You don&apos;t sign up, so we don&apos;t hold a name, email address or password for you.</p>,
        },
        {
          title: "What we receive",
          body: (
            <p>
              When you use a tool, we receive the link or file you submit and the technical details any web request
              carries, such as your IP address and browser type. We use them only to complete that request.
            </p>
          ),
        },
        {
          title: "How long we keep it",
          body: (
            <p>
              Media is fetched into a temporary folder, sent to you, and deleted as soon as the response finishes.
              We don&apos;t keep a library of what people download.
            </p>
          ),
        },
        {
          title: "Third parties",
          body: (
            <p>
              To fetch a post we contact the platform it lives on, such as YouTube, Instagram or Facebook. Their own
              privacy policies apply to that request. We don&apos;t sell or share your data with advertisers.
            </p>
          ),
        },
        {
          title: "Contact",
          body: <p>Questions about privacy? Use the request form on the home page and we&apos;ll get back to you.</p>,
        },
      ]}
    />
  );
}
