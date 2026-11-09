import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Container } from "@/components/ui/primitives";
import { toolHref } from "@/lib/tools";

const columns = [
  {
    title: "Tools",
    links: [
      { label: "YouTube downloader", href: toolHref("youtube") },
      { label: "Instagram downloader", href: toolHref("instagram") },
      { label: "Facebook downloader", href: toolHref("facebook") },
      { label: "Video to audio", href: toolHref("audio") },
      { label: "All tools", href: "/tools" },
    ],
  },
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Why us", href: "/#why" },
      { label: "FAQ", href: "/#faq" },
      { label: "Request a tool", href: "/#request" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Fair use", href: "/fair-use" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <Container className="pt-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Logo />
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-ink-2">
              One place to do whatever you need. Paste, pick, done.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
            {columns.map((col) => (
              <div key={col.title}>
                <p className="label-mono text-ink-3">{col.title}</p>
                <ul className="mt-4 space-y-3">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="text-[15px] text-ink-2 transition-colors hover:text-ink">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-2 border-t border-line py-6 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Do-Whatever. All rights reserved.</p>
          <p>Only download content you have the right to use.</p>
        </div>

        <p
          aria-hidden
          className="pointer-events-none -mb-[0.2em] select-none overflow-hidden whitespace-nowrap text-center text-[clamp(3rem,15vw,11.5rem)] font-semibold leading-none tracking-[-0.06em] text-paper-2"
        >
          Do-Whatever
        </p>
      </Container>
    </footer>
  );
}
