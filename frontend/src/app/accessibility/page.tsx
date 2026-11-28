import type { Metadata } from "next";
import { CONTACT_EMAIL, pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = pageMeta({
  title: "Accessibility — Do-Whatever-You-Like",
  description: "Do-Whatever-You-Like's accessibility commitment: the WCAG 2.2 AA target, what we've built in, known limitations, and how to report a barrier.",
  path: "/accessibility",
});

const link = "underline decoration-line underline-offset-4 hover:decoration-ink";

export default function AccessibilityPage() {
  return (
    <LegalPage
      current="/accessibility"
      updated="28 Nov 2026"
      title={
        <>
          Tools for <span className="serif-em">everyone.</span>
        </>
      }
      intro="Everyone should be able to use these tools, whatever device, browser or assistive technology they use. Here's where we stand."
      sections={[
        {
          title: "Our goal",
          body: (
            <p>
              We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA across the site, and we
              keep improving as we add tools.
            </p>
          ),
        },
        {
          title: "What we've built in",
          body: (
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Keyboard access to navigation, search and tool controls, with visible focus outlines.</li>
              <li>Meaningful page structure, headings and labels for screen readers.</li>
              <li>Text and colours chosen for readable contrast.</li>
              <li>Layouts that work on phones and when you zoom up to 200%.</li>
              <li>Reduced motion when your device asks for it, and haptic feedback you can turn off.</li>
            </ul>
          ),
        },
        {
          title: "Known limitations",
          body: (
            <p>
              Some visual tools, such as the photo, video and music editors, chart and flowchart makers and canvas-based
              design tools, rely on pointer or touch input and may be hard to use with a keyboard or screen reader alone.
              Files you create with the tools are only as accessible as their source.
            </p>
          ),
        },
        {
          title: "Report a barrier",
          body: (
            <p>
              If something on the site is hard or impossible for you to use, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Accessibility")}`} className={link}>
                {CONTACT_EMAIL}
              </a>{" "}
              with the page, what you were trying to do, and the browser and assistive technology you use. We treat
              accessibility reports as bugs and prioritise them.
            </p>
          ),
        },
      ]}
    />
  );
}
