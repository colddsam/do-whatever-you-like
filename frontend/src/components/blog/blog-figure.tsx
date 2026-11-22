"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Maximize2, X } from "lucide-react";
import { getLenis } from "@/lib/smooth-scroll";
import type { BlogFigureData } from "@/lib/blog";

export function BlogFigure({
  figure,
  sizes = "(max-width: 1024px) 100vw, 860px",
}: {
  figure: BlogFigureData;
  sizes?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    getLenis()?.stop();

    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const triggerEl = triggerRef.current;

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      getLenis()?.start();
      triggerEl?.focus();
    };
  }, [open]);

  return (
    <figure className="my-8">
      <div className="overflow-hidden rounded-lg border border-line bg-surface p-2 transition-colors duration-150 hover:border-ink-3 hover:shadow-card sm:p-2.5">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Inspect full-size screenshot: ${figure.alt}`}
          className="group relative block w-full cursor-zoom-in overflow-hidden rounded-md bg-paper text-left"
        >
          <Image
            src={figure.src}
            alt={figure.alt}
            width={figure.width}
            height={figure.height}
            sizes={sizes}
            className="h-auto w-full object-cover"
          />
          <span
            aria-hidden
            className="label-mono pointer-events-none absolute bottom-3 right-3 inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface/95 px-2.5 text-ink opacity-0 shadow-card backdrop-blur-xs transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <Maximize2 className="size-3.5" />
            Inspect
          </span>
        </button>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 text-[13px] leading-relaxed text-ink-2">
        <span className="flex min-w-0 flex-1 items-start gap-2.5">
          <span aria-hidden className="mt-2.5 h-px w-6 shrink-0 bg-ink-3" />
          <span>
            <span className="label-mono mr-2 text-ink-3">{figure.figureLabel} —</span>
            {figure.caption}
          </span>
        </span>
        {figure.href && (
          <Link
            href={figure.href}
            className="group ml-8 inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink sm:ml-0"
          >
            {figure.linkLabel ?? "Open tool"}
            <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 ease-out-soft group-hover:translate-x-0.5" />
          </Link>
        )}
      </figcaption>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={figure.alt}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-ink/85 p-4 backdrop-blur-xs sm:p-8"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90dvh] w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-line-dark bg-ink shadow-float"
            >
              <div className="flex items-center justify-between gap-4 border-b border-line-dark bg-ink-raised px-4 py-2.5">
                <p className="label-mono truncate text-paper-dim">
                  {figure.figureLabel} · {figure.width}×{figure.height}
                </p>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close screenshot preview"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-paper transition-colors hover:bg-ink"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>
              <div className="overflow-auto bg-paper p-2 sm:p-4">
                <Image
                  src={figure.src}
                  alt={figure.alt}
                  width={figure.width}
                  height={figure.height}
                  sizes="95vw"
                  className="mx-auto h-auto max-h-[76dvh] w-auto rounded-sm object-contain"
                />
              </div>
              <p className="border-t border-line-dark bg-ink-raised px-4 py-3 text-sm text-paper-dim">
                {figure.caption}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </figure>
  );
}

export function BlogFigurePair({ figures }: { figures: [BlogFigureData, BlogFigureData] }) {
  return (
    <div className="my-8 grid grid-cols-1 gap-6 md:grid-cols-2 [&>*]:min-w-0 [&>figure]:my-0">
      <BlogFigure figure={figures[0]} sizes="(max-width: 768px) 100vw, 420px" />
      <BlogFigure figure={figures[1]} sizes="(max-width: 768px) 100vw, 420px" />
    </div>
  );
}
