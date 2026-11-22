import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { CLUSTERS, clusterHref, getTool, toolHref, toolsIn, type Tool } from "@/lib/tools";
import type { BlogBlock, RichSegment } from "@/lib/blog";
import { BlogVideo } from "./blog-video";
import { BlogFigure, BlogFigurePair } from "./blog-figure";
import { cn } from "@/lib/utils";

function renderSegments(segments: RichSegment[]) {
  return segments.map((seg, i) => {
    if (typeof seg === "string") return <span key={i}>{seg}</span>;
    if ("code" in seg) {
      return (
        <code
          key={i}
          className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink"
        >
          {seg.code}
        </code>
      );
    }
    if ("strong" in seg) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {seg.strong}
        </strong>
      );
    }
    if (seg.external) {
      return (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
        >
          {seg.label}
        </a>
      );
    }
    return (
      <Link
        key={i}
        href={seg.href}
        className="font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
      >
        {seg.label}
      </Link>
    );
  });
}

function CollectionMatrix() {
  return (
    <div className="my-8">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
        {CLUSTERS.map((c, idx) => {
          const Icon = c.icon;
          const count = toolsIn(c.id).length;
          return (
            <Link
              key={c.id}
              href={clusterHref(c.id)}
              className="group flex flex-col bg-paper p-5 transition-colors duration-150 hover:bg-surface"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors duration-150 group-hover:border-ink group-hover:bg-ink group-hover:text-paper">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="label-mono text-ink-3">
                  {String(idx + 1).padStart(2, "0")} · {count} {count === 1 ? "tool" : "tools"}
                </span>
              </div>
              <p className="mt-4 flex items-center gap-1 text-[16px] font-semibold tracking-[-0.01em] text-ink">
                {c.title}
                <ArrowRight
                  aria-hidden
                  className="size-3.5 text-ink-3 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100"
                />
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{c.blurb}</p>
            </Link>
          );
        })}
      </div>
      <p className="mt-3 flex items-start gap-2.5 text-[13px] text-ink-2">
        <span aria-hidden className="mt-2.5 h-px w-6 shrink-0 bg-ink-3" />
        <span>
          <span className="label-mono mr-2 text-ink-3">Directory —</span>
          All 9 collections in one registry, linked directly from the home grid and{" "}
          <Link href="/tools" className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            /tools
          </Link>
          .
        </span>
      </p>
    </div>
  );
}

function ToolSpotlight({ heading, toolIds }: { heading?: string; toolIds: string[] }) {
  const list = toolIds.map(getTool).filter((t): t is Tool => Boolean(t));
  if (!list.length) return null;

  return (
    <div className="my-8">
      {heading && <p className="label-mono mb-3 text-ink-3">{heading}</p>}
      <ul
        className={cn(
          "grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line [&>*]:min-w-0",
          list.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        )}
      >
        {list.map((tool) => {
          const Icon = tool.icon;
          return (
            <li key={tool.id} className="bg-paper">
              <Link
                href={toolHref(tool.id)}
                className="group flex h-full flex-col p-5 transition-colors duration-150 hover:bg-surface"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors duration-150 group-hover:border-ink group-hover:bg-ink group-hover:text-paper">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <Badge variant="live">Live</Badge>
                </div>
                <p className="mt-4 flex items-center gap-1 text-[16px] font-semibold tracking-[-0.015em] text-ink">
                  {tool.name}
                  <ArrowUpRight
                    aria-hidden
                    className="size-4 text-ink-3 opacity-0 transition-[opacity,transform] duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
                  />
                </p>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-2">{tool.description}</p>
                <dl className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-3">
                  <dt className="label-mono text-ink-3">Gives</dt>
                  <dd className="truncate text-[13px] text-ink">{tool.gives}</dd>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ArticleBody({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "section":
            return (
              <div
                key={block.id}
                className={cn(
                  "pt-10",
                  idx > 0 && "mt-10 border-t border-line",
                )}
              >
                <p className="label-mono text-ink-3">{block.index}</p>
                <h2
                  id={block.id}
                  className="mt-2 max-w-[34ch] scroll-mt-24 text-2xl font-semibold tracking-[-0.025em] text-ink text-balance md:text-[28px] md:leading-[1.15]"
                >
                  {block.heading}
                </h2>
              </div>
            );

          case "subheading":
            return (
              <h3
                key={idx}
                className="max-w-[68ch] pt-3 text-lg font-semibold tracking-[-0.015em] text-ink"
              >
                {block.text}
              </h3>
            );

          case "paragraph":
            return (
              <p
                key={idx}
                className={cn(
                  "max-w-[68ch] leading-[1.72] text-pretty",
                  block.lead
                    ? "text-lg text-ink md:text-[19px]"
                    : "text-[16px] text-ink-2 md:text-[17px]",
                )}
              >
                {block.text}
              </p>
            );

          case "richParagraph":
            return (
              <p
                key={idx}
                className="max-w-[68ch] text-[16px] leading-[1.72] text-ink-2 text-pretty md:text-[17px]"
              >
                {renderSegments(block.segments)}
              </p>
            );

          case "video":
            return <BlogVideo key={idx} video={block.video} />;

          case "figure":
            return <BlogFigure key={idx} figure={block.figure} />;

          case "figurePair":
            return <BlogFigurePair key={idx} figures={block.figures} />;

          case "collectionMatrix":
            return <CollectionMatrix key={idx} />;

          case "toolGrid":
            return <ToolSpotlight key={idx} heading={block.heading} toolIds={block.toolIds} />;

          case "specTable":
            return (
              <div key={idx} className="my-8 overflow-x-auto rounded-lg border border-line bg-surface">
                <table className="w-full min-w-[540px] border-collapse text-left">
                  <caption className="label-mono border-b border-line bg-paper/70 px-4 py-3 text-left text-ink-3">
                    {block.caption}
                  </caption>
                  <thead>
                    <tr className="border-b border-line">
                      {block.columns.map((col) => (
                        <th key={col} scope="col" className="label-mono px-4 py-3 text-ink-3">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-[15px] leading-relaxed">
                    {block.rows.map((row) => (
                      <tr key={row[0]}>
                        <td className="px-4 py-3.5 font-medium text-ink">{row[0]}</td>
                        <td className="px-4 py-3.5 font-mono text-[13px] whitespace-nowrap text-ink">{row[1]}</td>
                        <td className="px-4 py-3.5 text-ink-2">{row[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "callout":
            return (
              <aside
                key={idx}
                aria-label={block.title}
                className="my-8 max-w-[68ch] rounded-lg border border-line border-l-2 border-l-accent bg-surface p-5 sm:p-6"
              >
                <p className="label-mono text-ink-3">{block.label}</p>
                <p className="mt-2 text-[17px] font-semibold tracking-[-0.015em] text-ink">{block.title}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{block.body}</p>
              </aside>
            );

          case "list":
            return (
              <ul key={idx} className="my-6 max-w-[68ch] divide-y divide-line border-y border-line">
                {block.items.map((it) => (
                  <li key={it.title} className="py-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{it.title}</p>
                      {it.href && (
                        <Link
                          href={it.href}
                          className="group inline-flex items-center gap-1 text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                        >
                          Open tool
                          <ArrowRight
                            aria-hidden
                            className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
                          />
                        </Link>
                      )}
                    </div>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{it.detail}</p>
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}
