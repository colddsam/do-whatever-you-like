"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ButtonLink, Container } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const links = [
  { href: "#tools", label: "Tools" },
  { href: "#how", label: "How it works" },
  { href: "#why", label: "Why us" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-colors duration-150",
        scrolled || open ? "border-line bg-paper/85 backdrop-blur-md" : "border-transparent bg-paper",
      )}
    >
      <Container className="flex h-16 items-center justify-between">
        <Logo />

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink href="#request" variant="ghost">
            Request a tool
          </ButtonLink>
          <ButtonLink href="#tools" arrow>
            Open toolbox
          </ButtonLink>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className="-mr-2 inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-paper-2 md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </Container>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "calc(100dvh - 4rem)" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-line bg-paper md:hidden"
          >
            <Container className="flex h-full flex-col pb-8">
              <ul className="divide-y divide-line">
                {links.map((l, i) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between py-5 text-2xl font-semibold tracking-[-0.02em]"
                    >
                      {l.label}
                      <span className="label-mono text-ink-3">0{i + 1}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-auto grid gap-3">
                <ButtonLink href="#request" variant="secondary" size="lg" className="w-full">
                  Request a tool
                </ButtonLink>
                <ButtonLink href="#tools" size="lg" arrow className="w-full">
                  Open toolbox
                </ButtonLink>
              </div>
            </Container>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
