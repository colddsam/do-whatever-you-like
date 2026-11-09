import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUpRight, Plus } from "lucide-react";
import { toolHref, tools } from "@/lib/tools";
import { Badge, SectionHeader, SignalDot } from "@/components/ui/primitives";
import { Page } from "@/components/ui/paper";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/sections/command-palette";

export const metadata: Metadata = {
  title: "All tools — Do-Whatever",
  description: "Every Do-Whatever tool in one place: the ones that work today and the ones in the works.",
};

export default function ToolsPage() {
  const live = tools.filter((t) => t.status === "live");
  const soon = tools.filter((t) => t.status === "soon");

  return (
    <Page className="pt-8 md:pt-10">
      <Link
        href="/"
        className="group -ml-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-x-0.5" />
        Home
      </Link>

      <Reveal className="mt-10 md:mt-14">
        <SectionHeader
          index="00"
          label="Toolbox"
          title={
            <>
              Every tool, <span className="serif-em">one place.</span>
            </>
          }
          description={`${live.length} tools work today and ${soon.length} more are on the way. Search for a task, or pick one below.`}
        />
      </Reveal>

      {/* Same 12-col grid as the header, so the palette lines up with the title, not 32px off it. */}
      <div className="mt-12 grid md:mt-14 md:grid-cols-12 md:gap-8">
        <Reveal delay={0.06} className="min-w-0 md:col-span-9 md:col-start-4">
          <CommandPalette />
        </Reveal>
      </div>

      {(
        [
          ["Live now", live],
          ["In the works", soon],
        ] as const
      ).map(([label, list], g) => (
        <section key={label} id={g === 0 ? "live" : "soon"} aria-label={label} className="mt-16 scroll-mt-24 md:mt-20">
          <Reveal>
            <p className="label-mono flex items-center gap-2 border-b border-line pb-4 text-ink-3">
              {g === 0 && <SignalDot pulse />}
              0{g + 1} — {label}
            </p>
          </Reveal>
          <ul className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {list.map((tool, i) => {
              const Icon = tool.icon;
              return (
                <Reveal as="li" key={tool.id} delay={i * 0.06} className="bg-paper">
                  <Link
                    href={toolHref(tool.id)}
                    className="group flex h-full min-h-[200px] flex-col p-6 transition-colors duration-150 hover:bg-surface md:p-8"
                  >
                    <div className="flex items-start justify-between">
                      <span className="flex size-10 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors duration-150 group-hover:border-ink group-hover:bg-ink group-hover:text-paper">
                        <Icon aria-hidden className="size-[18px]" />
                      </span>
                      {tool.status === "live" ? <Badge variant="live">Live</Badge> : <Badge>Soon</Badge>}
                    </div>
                    <div className="mt-auto pt-10">
                      <p className="label-mono text-ink-3">{tool.category}</p>
                      <h2 className="mt-2 flex items-center gap-1.5 text-xl font-semibold tracking-[-0.02em]">
                        {tool.name}
                        <ArrowUpRight
                          aria-hidden
                          className="size-4 text-ink-3 opacity-0 transition-[opacity,transform] duration-150 ease-out-soft group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
                        />
                      </h2>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{tool.description}</p>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
            <EndCell
              count={list.length}
              {...(g === 0
                ? {
                    href: "#soon",
                    icon: ArrowDown,
                    title: `${soon.length} more on the way`,
                    text: "PDFs, images, writing and developer tools are next.",
                    cta: "See what's next",
                  }
                : {
                    href: "/#request",
                    icon: Plus,
                    title: "Don't see your task?",
                    text: "Tell us what you need done. The most-requested tools get built first.",
                    cta: "Request a tool",
                  })}
            />
          </ul>
        </section>
      ))}
    </Page>
  );
}

/*
 * The grid is hairlines drawn by a 1px gap over a `line` background, so a short last row would
 * leave a grey hole. This cell always closes the row: it takes whatever columns are left at each
 * breakpoint (a full row when the tools divide evenly). Class names are spelled out for Tailwind.
 */
const smSpan = { 1: "sm:col-span-1", 2: "sm:col-span-2" } as const;
const lgSpan = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3" } as const;

function EndCell({
  count,
  href,
  icon: Icon,
  title,
  text,
  cta,
}: {
  count: number;
  href: string;
  icon: typeof Plus;
  title: string;
  text: string;
  cta: string;
}) {
  const sm = (2 - (count % 2)) as 1 | 2;
  const lg = (3 - (count % 3)) as 1 | 2 | 3;
  // Narrow (one column): no button, so the row stays as tall as its neighbours; an arrow
  // beside the title says it's a link, like the tool cards. Wide: a proper button on the right.
  const narrowSm = sm === 1;
  const narrowLg = lg === 1;
  return (
    <li className={cn("bg-paper-2/60", smSpan[sm], lgSpan[lg])}>
      <Link
        href={href}
        className={cn(
          "group flex h-full min-h-[200px] flex-col p-6 transition-colors duration-150 hover:bg-paper-2 md:p-8",
          !narrowLg && "lg:flex-row lg:items-end lg:justify-between lg:gap-8",
        )}
      >
        <div className="flex flex-1 flex-col">
          <span className="flex size-10 items-center justify-center rounded-md border border-dashed border-ink-3 text-ink-2 transition-colors duration-150 group-hover:border-ink group-hover:text-ink">
            <Icon aria-hidden className="size-[18px]" />
          </span>
          <div className="mt-auto pt-10">
            <h2 className="flex items-center gap-1.5 text-xl font-semibold tracking-[-0.02em]">
              {title}
              <ArrowUpRight
                aria-hidden
                className={cn(
                  "hidden size-4 text-ink-3 transition-transform duration-150 ease-out-soft group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink",
                  narrowSm && "sm:block",
                  narrowLg ? "lg:block" : "lg:hidden",
                )}
              />
            </h2>
            <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-ink-2">{text}</p>
          </div>
        </div>
        <span
          className={cn(
            "mt-6 inline-flex h-10 shrink-0 items-center gap-1.5 self-start rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors duration-150 group-hover:border-ink-3",
            narrowSm && "sm:hidden",
            narrowLg ? "lg:hidden" : "lg:mt-0 lg:inline-flex lg:self-auto",
          )}
        >
          {cta}
          <ArrowUpRight aria-hidden className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </Link>
    </li>
  );
}
