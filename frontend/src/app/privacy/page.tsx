import type { Metadata } from "next";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Privacy — Do-Whatever",
  description: "What Do-Whatever does with the links and files you give it.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      updated="13 Nov 2026"
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
