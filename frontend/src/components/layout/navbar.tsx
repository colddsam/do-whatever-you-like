"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useScroll, useSpring } from "motion/react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { getLenis } from "@/lib/smooth-scroll";

const EASE = [0.22, 1, 0.36, 1] as const;
const BUBBLE = { type: "spring", bounce: 0.22, duration: 0.5 } as const;

const links = [
  { id: "tools", label: "Tools" },
  { id: "how", label: "How it works" },
  { id: "why", label: "Why us" },
  { id: "faq", label: "FAQ" },
];

/** Which home-page section is under the middle of the viewport. */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const sections = links
      .map((l) => document.getElementById(l.id))
      .filter((el): el is HTMLElement => Boolean(el));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
          else setActive((cur) => (cur === e.target.id ? null : cur));
        }
      },
      // A thin band across the middle of the screen.
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [enabled]);
  return enabled ? active : null;
}

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const active = useActiveSection(pathname === "/");
  const bubble = hovered ?? active;
  const pill = scrolled || open;

  // Reading progress, drawn along the pill's bottom edge.
  const { scrollYProgress } = useScroll();
  const meter = useSpring(scrollYProgress, { stiffness: 260, damping: 40, restDelta: 0.001 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    // Smooth scrolling drives the page from the wheel, so pause it while the menu is open.
    if (open) getLenis()?.stop();
    else getLenis()?.start();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 h-16">
      {/* Mobile menu scrim — tapping outside the card closes it. */}
      <AnimatePresence>
        {open && (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-ink/20 backdrop-blur-[2px] md:hidden"
          />
        )}
      </AnimatePresence>

      {/*
        At the top of the page this is the full-width bar, ruled like the container below it.
        Once you scroll it tucks in to a floating pill.
      */}
      <div
        className={cn(
          "relative mx-auto flex items-center justify-between border transition-[max-width,height,margin,padding,background-color,border-color,box-shadow,border-radius] duration-500 ease-out-soft",
          pill
            ? "mt-2 h-12 max-w-[min(920px,calc(100%-24px))] rounded-full border-line bg-surface/90 pl-4 pr-1.5 shadow-card backdrop-blur-xl md:h-[52px] md:pl-5"
            : "mt-0 h-16 max-w-[1200px] rounded-none border-transparent px-5 md:px-8 lg:border-x-line",
        )}
      >
        <Logo />

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center" onMouseLeave={() => setHovered(null)}>
            {links.map((l) => {
              const has = bubble === l.id;
              const isActive = active === l.id;
              return (
                <li key={l.id}>
                  <Link
                    href={`/#${l.id}`}
                    aria-current={isActive ? "location" : undefined}
                    onMouseEnter={() => setHovered(l.id)}
                    onFocus={() => setHovered(l.id)}
                    onBlur={() => setHovered(null)}
                    className="relative block whitespace-nowrap rounded-full px-2.5 py-2 text-sm outline-offset-0 lg:px-3.5"
                  >
                    {has && (
                      <motion.span
                        layoutId="nav-bubble"
                        transition={BUBBLE}
                        className={cn(
                          "absolute inset-0 rounded-full transition-colors duration-200",
                          isActive ? "bg-ink" : "bg-paper-2",
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "relative transition-colors duration-200",
                        has && isActive ? "text-paper" : has || isActive ? "text-ink" : "text-ink-2",
                      )}
                    >
                      {l.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <ButtonLink href="/#request" variant="ghost" pill className="max-lg:hidden">
            Request a tool
          </ButtonLink>
          <ButtonLink href="/tools" arrow pill>
            Open toolbox
          </ButtonLink>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "relative inline-flex items-center justify-center rounded-full transition-colors md:hidden",
            pill ? "-mr-0.5 size-9 bg-ink text-paper after:absolute after:-inset-1.5 after:content-['']" : "-mr-2 size-11 text-ink hover:bg-paper-2",
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={open ? "x" : "menu"}
              initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="inline-flex"
            >
              {open ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
            </motion.span>
          </AnimatePresence>
        </button>

        {/* Reading progress along the pill's straight bottom edge. */}
        <motion.span
          aria-hidden
          style={{ scaleX: meter }}
          className={cn(
            "absolute inset-x-7 -bottom-px h-px origin-left bg-ink transition-opacity duration-300",
            pill && !open ? "opacity-60" : "opacity-0",
          )}
        />
      </div>

      {/* Mobile menu — a card that drops out of the pill. */}
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            data-lenis-prevent
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="absolute inset-x-3 top-[64px] max-h-[calc(100dvh-76px)] origin-top overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-2 shadow-float md:hidden"
          >
            <ul>
              {links.map((l, i) => (
                <motion.li
                  key={l.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE, delay: 0.05 + i * 0.04 }}
                >
                  <Link
                    href={`/#${l.id}`}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center justify-between rounded-md px-4 py-3.5 text-xl font-semibold tracking-[-0.02em] transition-colors hover:bg-paper-2",
                      active === l.id && "bg-paper-2",
                    )}
                  >
                    {l.label}
                    <span className="label-mono text-ink-3">0{i + 1}</span>
                  </Link>
                </motion.li>
              ))}
            </ul>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line p-2 pt-4">
              <ButtonLink href="/#request" variant="secondary" size="lg" pill className="w-full">
                Request a tool
              </ButtonLink>
              <ButtonLink href="/tools" size="lg" arrow pill className="w-full">
                Toolbox
              </ButtonLink>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
