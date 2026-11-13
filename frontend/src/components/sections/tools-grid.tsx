import Link from "next/link";
import { ArrowRight, ArrowUpRight, Link2, Plus } from "lucide-react";
import { CLUSTERS, clusterHref, getCluster, getTool, liveCount, toolHref, toolsIn, type ClusterId, type Tool } from "@/lib/tools";
import { STATIC_CATALOGUE } from "@/lib/universal";
import { Badge, ButtonLink, Container, SectionHeader, SignalDot } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

const cell = "relative flex flex-col bg-paper p-6 md:p-8";

/** A collection's popular tools, as rows that open the tool. */
function ToolRows({ ids, compact, columns }: { ids: string[]; compact?: boolean; columns?: boolean }) {
  const list = ids.map(getTool).filter((t): t is Tool => Boolean(t));
  return (
    <ul className={cn("border-t border-line", columns ? "grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 sm:gap-x-6" : "")}>
      {list.map((tool) => {
        const Icon = tool.icon;
        const live = tool.status === "live";
        return (
          <li key={tool.id} className="border-b border-line">
            <Link
              href={toolHref(tool.id)}
              className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors duration-150 hover:bg-surface"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-ink-2 transition-colors duration-150 group-hover:border-ink group-hover:bg-ink group-hover:text-paper">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">{tool.name}</span>
                {!compact && <span className="block truncate text-sm text-ink-3">{tool.description}</span>}
              </span>
              {live ? (
                <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-ink" />
              ) : (
                <span className="label-mono shrink-0 text-ink-3">Soon</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Head of a collection card: its mono label, count and a short headline. */
function CardHead({ id, title, big }: { id: ClusterId; title: React.ReactNode; big?: boolean }) {
  const c = getCluster(id);
  const Icon = c.icon;
  const all = toolsIn(id);
  const live = all.filter((t) => t.status === "live").length;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink">
            <Icon aria-hidden className="size-[18px]" />
          </span>
          <span className="label-mono truncate text-ink-3">
            {c.name} · {all.length} {all.length === 1 ? "tool" : "tools"}
          </span>
        </span>
        {live ? <Badge variant="live">{live === all.length ? "Live" : `${live} live`}</Badge> : <Badge>Soon</Badge>}
      </div>
      <h3 className={cn("mt-6 max-w-md font-semibold tracking-[-0.03em]", big ? "text-[26px] leading-tight sm:text-[28px] md:text-[32px]" : "text-xl tracking-[-0.02em]")}>
        {title}
      </h3>
    </div>
  );
}

/** The card's way out: all of the collection, on the Tools page. */
function SeeAll({ id, label }: { id: ClusterId; label?: string }) {
  const c = getCluster(id);
  const n = toolsIn(id).length;
  return (
    <Link href={clusterHref(id)} className="group mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-medium text-ink-2 transition-colors hover:text-ink">
      {label ?? `All ${n} ${c.noun} tools`}
      <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * The home page's map of the toolbox: one card per collection with its most-used tools one click
 * away, and a way into the rest. Same hairline bento as before, so the page keeps its rhythm.
 */
export function ToolsGrid() {
  const pdf = getCluster("pdf");
  const images = getCluster("images");
  const files = getCluster("files");
  const total = CLUSTERS.reduce((n, c) => n + toolsIn(c.id).length, 0);
  const formats = Object.keys(STATIC_CATALOGUE.formats).length;
  const pairs = Object.values(STATIC_CATALOGUE.routes).reduce((n, r) => n + r.length, 0);

  return (
    <section id="tools" aria-labelledby="tools-title">
      <Container className="py-20 md:py-28">
        <Reveal>
          <SectionHeader
            index="01"
            label="Tools"
            title={
              <span id="tools-title">
                Seven collections, <span className="serif-em">one flow.</span>
              </span>
            }
            description={`${liveCount} tools that work today, sorted the way you think about the job: any file, PDFs, images, fonts and colour, downloads, audio and video, and handy utilities. Pick a collection, or search for the task.`}
          />
        </Reveal>

        <Reveal delay={0.08} className="mt-14 md:mt-16">
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-6 [&>*]:min-w-0">
            {/* Any file: the converter, compressor and merge/split for every format. */}
            <article className={cn(cell, "sm:col-span-2 lg:col-span-6")}>
              <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                <div className="flex flex-col">
                  <CardHead id="files" big title={<>Any file, into any <span className="serif-em">format.</span></>} />
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">{files.blurb}</p>
                  <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12px] tracking-[0.04em] text-ink-3">
                    <span>
                      <span className="text-ink">{formats}</span> formats
                    </span>
                    <span>
                      <span className="text-ink">{pairs.toLocaleString("en")}</span> conversions
                    </span>
                    <span>Office · PDF · data · media · fonts</span>
                  </p>
                  <SeeAll id="files" label="All file tools" />
                </div>
                <ToolRows ids={files.featured} columns />
              </div>
            </article>

            {/* PDF: the biggest collection. */}
            <article className={cn(cell, "sm:col-span-2 lg:col-span-4 lg:row-span-2")}>
              <CardHead id="pdf" big title={<>Every PDF job, from merge to <span className="serif-em">sign.</span></>} />
              <ul aria-label="PDF groups" className="mt-5 flex flex-wrap gap-1.5">
                {pdf.groups!.map((g) => (
                  <li key={g}>
                    <Link
                      href={`/tools#pdf-${g.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                    >
                      {g}
                      <span className="font-mono text-[11px] text-ink-3">{toolsIn("pdf").filter((t) => t.group === g).length}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <ToolRows ids={pdf.featured} columns />
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <SeeAll id="pdf" />
                <Link href={toolHref("pdf")} className="group inline-flex items-center gap-1.5 pt-6 text-sm text-ink-3 transition-colors hover:text-ink">
                  Or open the all-in-one PDF toolkit
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </Link>
              </div>
            </article>

            {/* Images */}
            <article className={cn(cell, "sm:col-span-2 lg:col-span-2 lg:row-span-2")}>
              <CardHead id="images" title={<>Pictures, <span className="serif-em">sorted.</span></>} />
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{images.blurb}</p>
              <div className="mt-6">
                <ToolRows ids={images.featured} compact />
              </div>
              <SeeAll id="images" />
            </article>

            {/* Downloads */}
            <article className={cn(cell, "sm:col-span-2 lg:col-span-3")}>
              <CardHead id="downloads" title={<>Save it from a <span className="serif-em">link.</span></>} />
              <Link
                href={toolHref("instagram")}
                aria-label="Open the Instagram downloader"
                className="group mt-5 flex items-center gap-3 rounded-md border border-line bg-surface p-1.5 pl-3.5 transition-[border-color,box-shadow] duration-150 hover:border-ink-3 hover:shadow-card"
              >
                <Link2 aria-hidden className="size-4 shrink-0 text-ink-3" />
                <span className="flex-1 truncate font-mono text-[13px] text-ink-3">https://www.instagram.com/reel/…</span>
                <span className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-ink px-3.5 text-sm font-medium text-paper">
                  Fetch
                  <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
              </Link>
              <div className="mt-5">
                <ToolRows ids={getCluster("downloads").featured} compact />
              </div>
              <p className="mt-auto flex items-center gap-1.5 pt-5 text-sm text-ink-3">
                <SignalDot /> Public posts only. Preview before you save.
              </p>
            </article>

            {/* Audio & video */}
            <article className={cn(cell, "lg:col-span-3")}>
              <CardHead id="media" title={<>Sound, out of video. Words, out of <span className="serif-em">sound.</span></>} />
              <div className="mt-6">
                <ToolRows ids={getCluster("media").featured} />
              </div>
              <SeeAll id="media" label="All audio and video tools" />
            </article>

            {/* Design: fonts and colour */}
            <article className={cn(cell, "sm:col-span-2 lg:col-span-3")}>
              <CardHead id="design" title={<>Type and colour, <span className="serif-em">checked.</span></>} />
              <div className="mt-6">
                <ToolRows ids={getCluster("design").featured} />
              </div>
              <SeeAll id="design" label="All design tools" />
            </article>

            {/* Text & utilities */}
            <article className={cn(cell, "lg:col-span-3")}>
              <CardHead id="utilities" title={<>Handy <span className="serif-em">extras.</span></>} />
              <div className="mt-6">
                <ToolRows ids={getCluster("utilities").featured} compact />
              </div>
              <SeeAll id="utilities" label="All utilities" />
            </article>

            {/* Request */}
            <article className={cn(cell, "justify-between gap-8 bg-paper-2/60 sm:col-span-2 sm:flex-row sm:items-end lg:col-span-6")}>
              <div>
                <span className="flex size-10 items-center justify-center rounded-md border border-dashed border-ink-3 text-ink-2">
                  <Plus aria-hidden className="size-[18px]" />
                </span>
                <h3 className="mt-6 text-xl font-semibold tracking-[-0.02em] sm:mt-10">Don&apos;t see your task?</h3>
                <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-ink-2">
                  {total} tools so far. Tell us what you need done: the most-requested tools get built first.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 self-start sm:self-auto">
                <ButtonLink href="/tools" variant="secondary">
                  Browse all {total}
                </ButtonLink>
                <ButtonLink href="#request" variant="secondary">
                  Request a tool
                  <ArrowUpRight aria-hidden className="size-4" />
                </ButtonLink>
              </div>
            </article>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
