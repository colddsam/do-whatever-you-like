import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Privacy — Do-Whatever-You-Like",
  description: "What Do-Whatever-You-Like does with the links and files you give it: what runs in your browser, what reaches our server, and when it is deleted.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      updated="28 Nov 2026"
      title={
        <>
          Privacy, in <span className="serif-em">plain words.</span>
        </>
      }
      intro="Do-Whatever-You-Like is built to do a job and forget about it. Here's exactly what that means for the links and files you hand us."
      sections={[
        {
          title: "No accounts",
          body: <p>You don&apos;t sign up, so we don&apos;t hold a name, email address or password for you.</p>,
        },
        {
          title: "Where your files go",
          body: (
            <>
              <p>
                <strong className="font-medium text-ink">On your device.</strong> Most developer and text utilities,
                the meme generator, the photo editor and the font creator run entirely in your browser. What you paste
                or add to them is never sent to us.
              </p>
              <p>
                <strong className="font-medium text-ink">On our server.</strong> Everything else (PDF, image, file
                conversion, compression, transcription, downloads and network lookups) sends your file, link or text
                to our server to do the work. Every tool page shows which kind it is under &ldquo;At a glance&rdquo;.
              </p>
            </>
          ),
        },
        {
          title: "What we receive",
          body: (
            <p>
              When a tool runs on our server, we receive the link, file or text you submit and the technical details
              any web request carries, such as your IP address and browser type. We use them only to complete that
              request.
            </p>
          ),
        },
        {
          title: "How long we keep it",
          body: (
            <>
              <p>
                Files are deleted as soon as the result is sent. PDF tools are the exception: your PDF is kept for 30
                minutes after you last use it, so you can try other settings without uploading again, and then
                it&apos;s deleted.
              </p>
              <p>
                Downloaded media is fetched into a temporary folder, sent to you, and deleted as soon as the response
                finishes. We don&apos;t keep a library of what people download or convert.
              </p>
            </>
          ),
        },
        {
          title: "Third parties",
          body: (
            <>
              <p>
                To fetch a post we contact the platform it lives on, such as YouTube, Instagram or Facebook. Their own
                privacy policies apply to that request.
              </p>
              <p>
                Audio to text may send your recording to Groq&apos;s Whisper service for transcription; the tool says
                so when it does. We don&apos;t sell or share your data with advertisers.
              </p>
            </>
          ),
        },
        {
          title: "Analytics",
          body: (
            <p>
              We use Vercel Web Analytics and Google Analytics (GA4) to understand overall site traffic and which tools
              are most helpful. Google Analytics may set cookies in your browser to count visits; neither analytics
              service ever receives the files, links, notes or period entries you work with in our tools. The{" "}
              <Link href="/cookies" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                cookie policy
              </Link>{" "}
              lists everything stored in your browser.
            </p>
          ),
        },
        {
          title: "Your rights",
          body: (
            <>
              <p>
                We process personal data in line with India&apos;s Digital Personal Data Protection Act, 2023 and the
                Information Technology Act, 2000. You can ask what personal data we hold about you, ask us to correct
                or delete it, withdraw consent, and raise a complaint with our grievance officer (details in the{" "}
                <Link href="/terms" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                  terms
                </Link>
                ). Because we don&apos;t keep accounts or files, there is usually very little to find.
              </p>
              <p>
                If you&apos;re not satisfied with our answer, you can complain to the Data Protection Board of India.
              </p>
            </>
          ),
        },
        {
          title: "Contact",
          body: (
            <p>
              Questions about privacy, or want something removed? Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
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
