"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { SignalDot } from "@/components/ui/primitives";
import { getLenis } from "@/lib/smooth-scroll";
import type { TocItem } from "@/lib/blog";
import { cn } from "@/lib/utils";

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = getLenis();
  if (lenis) lenis.scrollTo(el, { offset: -88, force: true });
  else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: "smooth" });
  history.replaceState(null, "", `#${id}`);
}

export function BlogToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    if (!items.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.35) {
          current = item.id;
        }
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items]);

  if (!items.length) return null;

  return (
    <>
      {/* Mobile / tablet compact accordion */}
      <details className="group rounded-lg border border-line bg-surface lg:hidden">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3">
          <span className="label-mono text-ink-2">On this page · {items.length} sections</span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-ink transition-transform duration-200 ease-out-soft group-open:rotate-45">
            <Plus aria-hidden className="size-3.5" />
          </span>
        </summary>
        <ol className="divide-y divide-line border-t border-line px-4">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(it.id);
                }}
                className="flex min-h-11 items-baseline gap-3 py-2.5 text-sm text-ink-2 transition-colors hover:text-ink"
              >
                <span className="label-mono w-6 shrink-0 text-ink-3">{it.index}</span>
                <span>{it.heading}</span>
              </a>
            </li>
          ))}
        </ol>
      </details>

      {/* Desktop sticky outline */}
      <nav aria-label="On this page" className="hidden lg:block">
        <p className="label-mono text-ink-3">On this page</p>
        <ol className="mt-4 divide-y divide-line border-y border-line">
          {items.map((it) => {
            const on = active === it.id;
            return (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  aria-current={on ? "location" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(it.id);
                  }}
                  className={cn(
                    "flex items-baseline gap-2.5 py-2.5 text-[14px] leading-snug transition-colors",
                    on ? "font-medium text-ink" : "text-ink-2 hover:text-ink",
                  )}
                >
                  <span className="label-mono flex w-7 shrink-0 items-center gap-1.5 text-ink-3">
                    {on && <SignalDot />}
                    {it.index}
                  </span>
                  <span className="min-w-0 flex-1">{it.heading}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
