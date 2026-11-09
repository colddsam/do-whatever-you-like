import { Plus } from "lucide-react";
import { Container } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";

const faqs = [
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
    a: "Downloaders for YouTube, Instagram and Facebook, plus a video-to-MP3 converter, are live today. PDF tools, image tools, writing helpers and developer utilities are next.",
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
