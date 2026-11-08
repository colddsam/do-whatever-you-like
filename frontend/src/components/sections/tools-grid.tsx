import { ArrowUpRight, Link2, Plus } from "lucide-react";
import { tools, type Tool } from "@/lib/tools";
import { Badge, ButtonLink, Container, SectionHeader, SignalDot } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

const live = tools.filter((t) => t.status === "live");
const soon = tools.filter((t) => t.status === "soon");

const cell = "relative bg-paper p-6 transition-colors duration-150 hover:bg-surface md:p-8";

function SoonCell({ tool, className }: { tool: Tool; className?: string }) {
  const Icon = tool.icon;
  return (
    <article id={`tool-${tool.id}`} className={cn(cell, "flex min-h-[220px] flex-col", className)}>
      <div className="flex items-start justify-between">
        <span className="flex size-10 items-center justify-center rounded-md border border-line bg-surface text-ink">
          <Icon aria-hidden className="size-[18px]" />
        </span>
        <Badge>Soon</Badge>
      </div>
      <div className="mt-auto pt-10">
        <p className="label-mono text-ink-3">{tool.category}</p>
        <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">{tool.name}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{tool.description}</p>
      </div>
    </article>
  );
}

export function ToolsGrid() {
  return (
    <section id="tools" aria-labelledby="tools-title">
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeader
            index="01"
            label="Tools"
            title={
              <span id="tools-title">
                A toolbox that keeps <span className="serif-em">growing.</span>
              </span>
            }
            description="Start with the jobs people ask for most. Every tool shares the same flow, so once you've used one, you know them all."
          />
        </Reveal>

        <Reveal delay={0.08} className="mt-14 md:mt-16">
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-6 [&>*]:min-w-0">
            {/* Featured: live downloads */}
            <article className="relative flex flex-col bg-paper p-6 sm:col-span-2 md:p-8 lg:col-span-4 lg:row-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="live">Live now</Badge>
                <span className="label-mono text-ink-3">Downloads</span>
              </div>
              <h3 className="mt-6 max-w-md text-[28px] font-semibold leading-tight tracking-[-0.03em] md:text-[32px]">
                Save media from the platforms you use every day.
              </h3>

              {/* Link input mock */}
              <div className="mt-8 flex items-center gap-3 rounded-md border border-line bg-surface p-1.5 pl-3.5">
                <Link2 aria-hidden className="size-4 shrink-0 text-ink-3" />
                <span className="flex-1 truncate font-mono text-[13px] text-ink-3">
                  https://www.instagram.com/reel/…
                </span>
                <span className="inline-flex h-9 items-center rounded-[8px] bg-ink px-3.5 text-sm font-medium text-paper">
                  Fetch
                </span>
              </div>

              <ul className="mt-6 divide-y divide-line border-y border-line">
                {live.map((tool) => (
                  <li key={tool.id} id={`tool-${tool.id}`} className="flex items-center gap-4 py-4">
                    <span className="w-24 shrink-0 font-medium sm:w-28">{tool.name.replace(" downloader", "")}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink-2">{tool.description}</span>
                    <span className="label-mono flex shrink-0 items-center gap-1.5 text-ink">
                      <SignalDot /> Live
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-auto pt-6 text-sm text-ink-3">Public posts only. Pick the format and quality before you download.</p>
            </article>

            <SoonCell tool={soon[0]} className="lg:col-span-2" />
            <SoonCell tool={soon[1]} className="lg:col-span-2" />
            <SoonCell tool={soon[2]} className="lg:col-span-2" />
            <SoonCell tool={soon[3]} className="lg:col-span-2" />
            <SoonCell tool={soon[4]} className="lg:col-span-2" />
            <SoonCell tool={soon[5]} className="lg:col-span-2" />

            {/* Request cell */}
            <article className={cn(cell, "flex flex-col justify-between gap-8 bg-paper-2/60 sm:col-span-2 sm:flex-row sm:items-end lg:col-span-4")}>
              <div>
                <span className="flex size-10 items-center justify-center rounded-md border border-dashed border-ink-3 text-ink-2">
                  <Plus aria-hidden className="size-[18px]" />
                </span>
                <h3 className="mt-10 text-xl font-semibold tracking-[-0.02em]">Don&apos;t see your task?</h3>
                <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-ink-2">
                  Tell us what you need done. The most-requested tools get built first.
                </p>
              </div>
              <ButtonLink href="#request" variant="secondary" className="self-start sm:self-auto">
                Request a tool
                <ArrowUpRight aria-hidden className="size-4" />
              </ButtonLink>
            </article>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
