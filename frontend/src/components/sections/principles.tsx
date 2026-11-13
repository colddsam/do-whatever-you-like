import { Gift, MonitorSmartphone, ShieldCheck, UserRoundX } from "lucide-react";
import { Container, SectionHeader } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";

const principles = [
  {
    icon: UserRoundX,
    title: "No sign-up wall",
    body: "Open a tool and use it. An account will only ever be optional.",
  },
  {
    icon: ShieldCheck,
    title: "Private by default",
    body: "Some tools never leave your device. The rest delete your file once the result is sent (PDFs after 30 minutes). Nothing is resold.",
  },
  {
    icon: MonitorSmartphone,
    title: "Works anywhere",
    body: "Phone, tablet or laptop. Every tool opens in your web browser, so there's nothing to install.",
  },
  {
    icon: Gift,
    title: "Free to start",
    body: "The everyday essentials are free. Heavy-duty extras may come later, clearly labelled.",
  },
];

export function Principles() {
  return (
    <section id="why" aria-labelledby="why-title">
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeader
            index="03"
            label="Why us"
            title={
              <span id="why-title">
                Built to get out of your <span className="serif-em">way.</span>
              </span>
            }
            description="Most free tools come with pop-ups, sign-ups and mystery watermarks. We'd rather earn your trust by being boring in the best way."
          />
        </Reveal>

        <ul className="mt-14 grid grid-cols-1 border-t border-line sm:grid-cols-2 md:mt-16 lg:grid-cols-4">
          {principles.map((p, i) => {
            const Icon = p.icon;
            return (
              <Reveal
                as="li"
                key={p.title}
                delay={i * 0.06}
                className="border-b border-line py-6 sm:px-6 sm:py-8 sm:[&:nth-child(odd)]:border-r lg:border-r lg:px-6 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0"
              >
                <div className="flex items-center justify-between">
                  <Icon aria-hidden className="size-5 text-ink" />
                  <span className="label-mono text-ink-3">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg sm:mt-10 font-semibold tracking-[-0.01em]">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{p.body}</p>
              </Reveal>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
