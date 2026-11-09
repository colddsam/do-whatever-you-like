import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Page } from "@/components/ui/paper";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/fair-use", label: "Fair use" },
];

export type LegalSection = { title: string; body: React.ReactNode };

export function LegalPage({
  current,
  title,
  intro,
  updated,
  sections,
}: {
  current: string;
  title: React.ReactNode;
  intro: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <Page className="pt-8 md:pt-10">
      <Link
        href="/"
        className="group -ml-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-x-0.5" />
        Home
      </Link>

      <div className="mt-10 grid gap-10 md:mt-14 md:grid-cols-12 md:gap-8">
        <aside className="md:col-span-3">
          <nav aria-label="Legal" className="md:sticky md:top-24">
            <p className="label-mono text-ink-3">Legal</p>
            <ul className="mt-4 flex gap-1 md:flex-col">
              {legalLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={l.href === current ? "page" : undefined}
                    className={cn(
                      "-ml-2 inline-flex h-9 items-center gap-2 rounded-md px-2 text-[15px] transition-colors",
                      l.href === current ? "font-medium text-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
                    )}
                  >
                    {l.href === current && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="md:col-span-9">
          <Reveal>
            <p className="label-mono text-ink-3">Last updated {updated}</p>
            <h1 className="text-h2 mt-4 text-balance">{title}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2 text-pretty">{intro}</p>
          </Reveal>

          <ol className="mt-12 divide-y divide-line border-y border-line">
            {sections.map((s, i) => (
              <Reveal as="li" key={s.title} delay={Math.min(i, 4) * 0.04} className="grid gap-3 py-8 sm:grid-cols-[3rem_1fr]">
                <span className="label-mono pt-1 text-ink-3">0{i + 1}</span>
                <div className="max-w-2xl">
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">{s.title}</h2>
                  <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink-2">{s.body}</div>
                </div>
              </Reveal>
            ))}
          </ol>
        </article>
      </div>
    </Page>
  );
}
