import { Check, FileVideo, Link2 } from "lucide-react";
import { Container, SectionHeader } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

function PasteVisual() {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line-dark bg-ink p-1.5 pl-3.5">
      <Link2 aria-hidden className="size-4 shrink-0 text-paper-dim" />
      <span className="flex-1 truncate font-mono text-[13px] text-paper">youtu.be/dQw4…</span>
      <span className="h-5 w-px animate-blink bg-paper" />
    </div>
  );
}

function PickVisual() {
  const options = ["MP4 · 1080p", "MP4 · 720p", "MP3 · Audio"];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o, i) => (
        <span
          key={o}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 font-mono text-[12px]",
            i === 0 ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim",
          )}
        >
          {i === 0 && <Check aria-hidden className="size-3.5" />}
          {o}
        </span>
      ))}
    </div>
  );
}

function DoneVisual() {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line-dark bg-ink p-3">
      <span className="flex size-9 items-center justify-center rounded-sm bg-ink-raised text-paper">
        <FileVideo aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-paper">video-1080p.mp4</span>
        <span className="block font-mono text-[12px] text-paper-dim">48.2 MB · ready</span>
      </span>
      <span className="flex size-6 items-center justify-center rounded-full bg-accent text-ink">
        <Check aria-hidden className="size-3.5" strokeWidth={3} />
      </span>
    </div>
  );
}

const steps = [
  {
    word: "Paste",
    title: "Drop in a link or a file",
    body: "Start from whatever you have: a URL, a document, an image. No account, no setup.",
    visual: <PasteVisual />,
  },
  {
    word: "Pick",
    title: "Choose what you want back",
    body: "Format, quality, size. Sensible defaults are already selected, so most of the time you just confirm.",
    visual: <PickVisual />,
  },
  {
    word: "Done",
    title: "Grab the result and go",
    body: "Your file is ready in seconds. We don't keep it afterwards.",
    visual: <DoneVisual />,
  },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="bg-ink text-paper">
      <Container dark className="py-20 md:py-28">
        <Reveal>
          <SectionHeader
            dark
            index="02"
            label="How it works"
            title={
              <span id="how-title">
                Paste. Pick. <span className="serif-em text-accent">Done.</span>
              </span>
            }
            description="Every tool on Do-Whatever follows the same three steps. Learn it once and every task feels familiar."
          />
        </Reveal>

        <ol className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line-dark bg-line-dark md:mt-16 lg:grid-cols-3">
          {steps.map((s, i) => (
            // The tile's colour stays put and only its content fades in, so the hairline grid never shows through.
            <li key={s.word} className="bg-ink-raised">
              <Reveal delay={i * 0.06} className="flex h-full flex-col p-6 md:p-8">
                <div className="flex items-baseline justify-between">
                  <span className="serif-em text-5xl text-paper md:text-6xl">{s.word}</span>
                  <span className="label-mono text-paper-dim">0{i + 1}</span>
                </div>
                <div className="mt-6 md:mt-8 lg:mt-10 lg:min-h-[92px]">{s.visual}</div>
                <h3 className="mt-6 text-lg lg:mt-8 font-semibold tracking-[-0.01em]">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-paper-dim">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
