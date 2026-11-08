"use client";

import { motion } from "motion/react";
import { Badge, ButtonLink, Container } from "@/components/ui/primitives";
import { CommandPalette } from "./command-palette";

const EASE = [0.22, 1, 0.36, 1] as const;
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE, delay },
});

export function Hero() {
  return (
    <section aria-labelledby="hero-title">
      <Container className="pb-20 pt-14 md:pb-28 md:pt-20">
        <motion.div {...rise(0)}>
          <Badge variant="live">New tools ship regularly</Badge>
        </motion.div>

        <motion.h1 id="hero-title" {...rise(0.06)} className="text-display mt-7 max-w-[13ch] text-balance">
          One place to do <span className="serif-em text-accent">whatever</span> you need.
        </motion.h1>

        <div className="mt-12 grid grid-cols-1 gap-12 md:mt-16 lg:grid-cols-12 lg:gap-10 [&>*]:min-w-0">
          <motion.div {...rise(0.14)} className="flex flex-col lg:col-span-4">
            <p className="max-w-md text-lg leading-relaxed text-ink-2 text-pretty">
              Do-Whatever is a growing toolbox for everyday digital chores. Download media, convert
              files, tidy documents and more, without installing a thing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#tools" size="lg" arrow>
                Browse tools
              </ButtonLink>
              <ButtonLink href="#how" size="lg" variant="secondary">
                See how it works
              </ButtonLink>
            </div>

            <dl className="mt-auto hidden grid-cols-3 gap-4 border-t border-line pt-6 lg:grid">
              {[
                ["0", "sign-ups"],
                ["3", "steps max"],
                ["1", "search box"],
              ].map(([n, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="text-3xl font-semibold tracking-[-0.03em]">{n}</dd>
                  <dd className="label-mono mt-1 text-ink-3">{l}</dd>
                </div>
              ))}
            </dl>
          </motion.div>

          <motion.div {...rise(0.22)} className="lg:col-span-8">
            <CommandPalette />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
