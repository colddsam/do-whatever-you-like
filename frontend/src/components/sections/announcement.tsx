"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { SignalDot } from "@/components/ui/primitives";
import { toolHref } from "@/lib/tools";

const EASE = [0.22, 1, 0.36, 1] as const;
const ROTATE_MS = 4200;

/** Short, true headlines. Each one links to the tool it's about. */
const news = [
  { tag: "New", text: "Compress any file: PDF, Office, video…", tool: "compress-files" },
  { tag: "New", text: "Merge and split Word, Excel and PowerPoint", tool: "merge-files" },
  { tag: "New", text: "Favicons and app icons for every platform", tool: "icon-maker" },
  { tag: "New", text: "Convert any file to any format", tool: "convert-anything" },
  { tag: "New", text: "Speech to text in 99 languages", tool: "audio-to-text" },
  { tag: "New", text: "PDF to Word, Excel and PowerPoint", tool: "pdf-to-word" },
  { tag: "New", text: "QR codes with your logo on them", tool: "qr" },
  { tag: "Live", text: "Turn any video into an MP3", tool: "audio" },
  { tag: "Live", text: "Instagram carousels in one ZIP", tool: "instagram" },
  { tag: "Live", text: "YouTube Shorts, best quality", tool: "youtube" },
  { tag: "Live", text: "Facebook reels from a link", tool: "facebook" },
] as const;

/**
 * The hero's announcement chip: a rounded bubble with an ink "tag" bubble inside it.
 * Messages roll upward every few seconds and the chip's width springs to fit each one.
 * Hovering or focusing it pauses the rotation; reduced motion shows the first message only.
 */
export function Announcement() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [width, setWidth] = useState<number | "auto">("auto");
  const measure = useRef<HTMLSpanElement>(null);
  const item = news[i];

  useEffect(() => {
    if (reduce || paused) return;
    const t = setInterval(() => {
      if (!document.hidden) setI((n) => (n + 1) % news.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [reduce, paused]);

  // Measure the incoming message so the bubble can spring to its width. A ResizeObserver
  // (not a one-off read) so a late web-font swap re-measures too.
  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    setWidth(el.offsetWidth);
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [i]);

  return (
    <Link
      href={toolHref(item.tool)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="group inline-flex h-9 max-w-full items-center gap-2.5 rounded-full border border-line bg-surface/90 py-1 pl-1 pr-3 text-sm text-ink shadow-card backdrop-blur transition-[border-color,transform,box-shadow] duration-200 ease-out-soft hover:-translate-y-px hover:border-ink-3 active:translate-y-0"
    >
      <span className="label-mono inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ink pl-2.5 pr-3 text-paper">
        <SignalDot pulse />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={item.tag}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            {item.tag}
          </motion.span>
        </AnimatePresence>
      </span>

      <motion.span
        animate={{ width }}
        transition={{ type: "spring", bounce: 0.25, duration: 0.6 }}
        className="relative block h-5 min-w-0 max-w-[calc(100vw-9.5rem)] overflow-hidden sm:max-w-none"
      >
        {/* Invisible in-flow copy: sizes the slot before hydration and is measured after. */}
        <span ref={measure} aria-hidden className="invisible inline-block w-max whitespace-nowrap leading-5">
          {item.text}
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={i}
            initial={{ y: "110%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            exit={{ y: "-110%", opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="absolute left-0 top-0 block truncate whitespace-nowrap leading-5"
            style={{ maxWidth: "100%" }}
          >
            {item.text}
          </motion.span>
        </AnimatePresence>
      </motion.span>

      <ArrowRight
        aria-hidden
        className="size-3.5 shrink-0 text-ink-3 transition-[transform,color] duration-200 ease-out-soft group-hover:translate-x-0.5 group-hover:text-ink"
      />
    </Link>
  );
}
