import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { toolHref, tools } from "@/lib/tools";
import { Badge, SectionHeader, SignalDot } from "@/components/ui/primitives";
import { Page } from "@/components/ui/paper";
import { Reveal } from "@/components/ui/reveal";
import { CommandPalette } from "@/components/sections/command-palette";

export const metadata: Metadata = {
  title: "All tools — Do-Whatever",
  description: "Every Do-Whatever tool in one place: downloaders that work today and the ones in the works.",
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

      <Reveal delay={0.06} className="mt-12 md:ml-[25%] md:mt-14">
        <CommandPalette />
      </Reveal>

      {(
        [
          ["Live now", live],
          ["In the works", soon],
        ] as const
      ).map(([label, list], g) => (
        <section key={label} aria-label={label} className="mt-16 md:mt-20">
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
          </ul>
        </section>
      ))}
    </Page>
  );
}
