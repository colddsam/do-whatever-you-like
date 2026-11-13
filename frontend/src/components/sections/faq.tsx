import { Plus } from "lucide-react";
import { Container } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { liveCount, toolsIn } from "@/lib/tools";

export const faqs = [
  {
    q: "What is Do-Whatever?",
    a: "A single home for small digital jobs that usually send you hunting across a dozen sketchy websites: downloading media, converting files, tidying documents and more. New tools are added over time.",
  },
  {
    q: "Is it free?",
    a: "Yes. The everyday tools are free to use. If we ever add paid extras for heavy workloads, they'll be clearly marked and entirely optional.",
  },
  {
    q: "Do I need an account?",
    a: "No. Open a tool and use it straight away. Accounts may come later for things like history and saved preferences, but they'll always be optional.",
  },
  {
    q: "Which tools are available right now?",
    // Worked out from the registry, so it never goes stale.
    a: `${liveCount} tools, in nine collections: a universal converter for 112 formats (PDF, Word, Excel, PowerPoint, images, audio, video, data…) with compress, merge and split for any file; ${toolsIn("pdf").length} PDF tools (merge, split, edit, sign, protect, OCR…), ${toolsIn("images").length} image tools (compress, resize, convert HEIC, remove backgrounds, upscale, blur faces, icons for apps and websites…), a font checker, a font creator and a colour picker that reads any file, downloaders for YouTube, Instagram and Facebook, video to MP3, speech to text, video to frames and video to GIF, ${toolsIn("developer").length} developer tools (formatters and minifiers for 12 languages, validators, a code editor for 140+ languages, every common hash, XPath, XSLT, JSONPath, random test data, DNS, HTTP and port checks, an API tester), ${toolsIn("text").length} text tools (binary, hex and ASCII translators, number to words, Roman numerals, Morse with sound, a summariser, find and replace, split text…), and everyday utilities like a QR code maker, a scientific calculator, what's my IP, screen size and a webcam test. The Tools page lists them all.`,
  },
  {
    q: "What happens to my files and links?",
    a: "They're used only to complete your request and are discarded afterwards. We don't build profiles or sell data.",
  },
  {
    q: "Can I suggest a tool?",
    a: "Please do. Use the request form below. The most-requested tasks move to the top of the list.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-line">
      <Container className="grid gap-12 py-20 md:grid-cols-12 md:gap-8 md:py-28">
        <Reveal className="md:col-span-5">
          <p className="label-mono text-ink-3">04 — FAQ</p>
          <h2 id="faq-title" className="text-h2 mt-6 text-balance">
            Questions, <span className="serif-em">answered.</span>
          </h2>
          <p className="mt-5 max-w-sm text-[17px] leading-relaxed text-ink-2">
            Can&apos;t find what you&apos;re looking for?{" "}
            <a href="#request" className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
              Send us a note.
            </a>
          </p>
        </Reveal>

        <Reveal delay={0.08} className="md:col-span-7">
          <div className="divide-y divide-line border-y border-line">
            {faqs.map((f, i) => (
              <details key={f.q} className="group" open={i === 0}>
                <summary className="flex min-h-16 cursor-pointer items-center justify-between gap-6 py-5 text-left text-[17px] font-medium tracking-[-0.01em] transition-colors hover:text-ink-2">
                  {f.q}
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line transition-[transform,background-color,border-color] duration-200 ease-out-soft group-open:rotate-45 group-open:border-ink group-open:bg-ink group-open:text-paper">
                    <Plus aria-hidden className="size-4" />
                  </span>
                </summary>
                <p className="max-w-xl pb-6 pr-12 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
