"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from "motion/react";
import { ButtonLink, Container } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Announcement } from "./announcement";
import { CommandPalette } from "./command-palette";
import { HeroBackdrop } from "./hero-backdrop";
import { HeroObject } from "./hero-object";

const EASE = [0.22, 1, 0.36, 1] as const;

const rise = (delay: number, y = 16) => ({
  initial: { opacity: 0, y },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE, delay },
});

/** Headline lines slide up from behind a mask, one after another. */
const lineVariants: Variants = {
  hidden: { y: "105%" },
  show: (i: number) => ({
    y: "0%",
    transition: { duration: 0.9, ease: EASE, delay: 0.08 + i * 0.1 },
  }),
};

const suggestions = ["reels", "mp3", "merge pdf", "json"];

const stats = [
  ["0", "sign-ups"],
  ["3", "steps max"],
  ["1", "search box"],
] as const;

/** True once the viewport is at least `px` wide (false during SSR and on smaller screens). */
function useMinWidth(px: number) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const sync = () => setMatch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [px]);
  return match;
}

function MaskLine({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    // Padding/negative margin keeps descenders and the italic overhang from being clipped.
    <span className="-mx-[0.08em] -mb-[0.12em] block overflow-hidden px-[0.08em] pb-[0.12em]">
      <motion.span className="block" variants={lineVariants} custom={i}>
        {children}
      </motion.span>
    </span>
  );
}

export function Hero() {
  const [query, setQuery] = useState("");
  const [has3d, setHas3d] = useState(true);
  const lg = useMinWidth(1024);
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  // 0 at the top of the page → 1 once the hero has scrolled away. Measured from page scroll
  // and the hero's own height (target-based tracking misreads the negative top margin).
  const height = useRef(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (height.current = Math.max(el.offsetHeight, 1)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { scrollY } = useScroll();
  const scrollYProgress = useTransform(() => Math.min(Math.max(scrollY.get() / height.current, 0), 1));
  const p = (to: number) => (reduce ? 0 : to);
  // Parallax depth: grid (far, in the backdrop) → object → headline → content (near, normal speed).
  const objectY = useTransform(scrollYProgress, [0, 1], [0, p(160)]);
  const headY = useTransform(scrollYProgress, [0, 1], [0, p(70)]);
  const headOpacity = useTransform(scrollYProgress, [0, 0.55], [1, reduce ? 1 : 0.15]);
  const captionOpacity = useTransform(scrollYProgress, [0, 0.25], [1, reduce ? 1 : 0]);

  return (
    // Pulled up under the (transparent) navbar so the backdrop runs to the top edge.
    <section ref={ref} aria-labelledby="hero-title" className="relative isolate -mt-16 overflow-x-clip pt-16">
      <HeroBackdrop progress={scrollYProgress} />

      <Container className="relative pb-20 pt-14 md:pb-28 md:pt-20">
        {/*
          Headline and toolbox share one row of the same 12-column grid as the content below, so the
          cube sits over the palette's right-hand columns. Phones: the cube follows the headline.
        */}
        <div className="relative grid grid-cols-1 md:grid-cols-12 md:gap-8 lg:gap-10">
          <motion.div style={{ y: headY, opacity: headOpacity }} className="relative z-10 min-w-0 md:col-span-8">
            <motion.div {...rise(0, 10)} className="-mt-1.5">
              <Announcement />
            </motion.div>

            <motion.h1 id="hero-title" initial="hidden" animate="show" className="text-display mt-7">
              <MaskLine i={0}>One place to do</MaskLine>
              <MaskLine i={1}>
                <span className="serif-em text-accent">whatever</span> you need.
              </MaskLine>
            </motion.h1>
          </motion.div>

          {has3d && (
            <motion.figure
              data-hero-figure
              style={{ y: lg ? objectY : 0 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="relative mt-6 h-[260px] sm:h-[300px] md:col-span-4 md:mt-0 md:h-auto"
            >
              {/*
                The canvas starts under the caption (which sits level with the announcement chip) and runs
                down to just above the palette, bleeding right into the gutter. Nothing overlaps it.
              */}
              <HeroObject
                progress={scrollYProgress}
                onUnavailable={() => setHas3d(false)}
                className="absolute inset-x-0 top-0 bottom-7 md:-bottom-14 md:-right-8 md:top-8"
              />
              <motion.figcaption
                style={{ opacity: captionOpacity }}
                className="label-mono pointer-events-none absolute bottom-0 left-0 flex items-center gap-2 whitespace-nowrap text-ink-3 md:bottom-auto md:left-auto md:right-0 md:top-0 md:h-9 md:-translate-y-1.5"
              >
                <span aria-hidden className="h-px w-6 bg-ink-3" />
                <span>
                  Fig. 01 — <span className="max-xl:hidden">One box, every tool. </span>Drag to turn
                </span>
              </motion.figcaption>
            </motion.figure>
          )}
        </div>

        <div className="relative mt-10 grid grid-cols-1 gap-12 md:mt-16 lg:grid-cols-12 lg:gap-10 [&>*]:min-w-0">
          {/* Left rail — copy, actions, suggestions, stats. Stretches to the palette's height. */}
          <div className="flex flex-col lg:col-span-5">
            {/* -mt offsets the text's half-leading so the first line sits on the palette's top edge. */}
            <motion.p
              {...rise(0.3)}
              className="max-w-md text-lg leading-relaxed text-ink-2 text-pretty lg:-mt-[0.4em]"
            >
              Do-Whatever is a growing toolbox for everyday digital chores. Download media, convert
              files, tidy documents and more, without installing a thing.
            </motion.p>

            <motion.div {...rise(0.38)} className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#tools" size="lg" arrow>
                Browse tools
              </ButtonLink>
              <ButtonLink href="#how" size="lg" variant="secondary">
                See how it works
              </ButtonLink>
            </motion.div>

            <motion.div {...rise(0.46)} className="mt-8 flex flex-wrap items-center gap-2">
              <span className="label-mono mr-1 text-ink-3">Try</span>
              {suggestions.map((s) => {
                const selected = query === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setQuery(selected ? "" : s)}
                    className={cn(
                      "h-8 rounded-sm border px-2.5 text-sm transition-[background-color,border-color,color,transform] duration-150 ease-out-soft active:translate-y-px",
                      selected
                        ? "border-ink bg-ink text-paper"
                        : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </motion.div>

            <dl className="relative mt-auto hidden grid-cols-3 gap-4 pt-6 lg:grid">
              {/* Hairline draws in from the left — the worksheet rule. */}
              <motion.span
                aria-hidden
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 1.1, ease: EASE, delay: 0.55 }}
                className="absolute inset-x-0 top-0 h-px origin-left bg-line"
              />
              {stats.map(([n, l], i) => (
                <motion.div key={l} {...rise(0.65 + i * 0.06, 10)}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="text-3xl font-semibold tracking-[-0.03em]">{n}</dd>
                  <dd className="label-mono mt-1 text-ink-3">{l}</dd>
                </motion.div>
              ))}
            </dl>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.22 }}
            className="lg:col-span-7"
          >
            <CommandPalette query={query} onQueryChange={setQuery} introDelay={0.5} />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
