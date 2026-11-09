import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { getTool, toolHref, tools, type Tool } from "@/lib/tools";
import { Badge } from "@/components/ui/primitives";
import { Page } from "@/components/ui/paper";
import { Reveal } from "@/components/ui/reveal";
import { Playground } from "@/components/tools/playground";

export function generateStaticParams() {
  return tools.map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: PageProps<"/tools/[id]">): Promise<Metadata> {
  const tool = getTool((await params).id);
  if (!tool) return {};
  return {
    title: `${tool.name} — Do-Whatever`,
    description: tool.description,
  };
}

/** "YouTube downloader" → "YouTube" + italic "downloader". */
function ToolTitle({ name }: { name: string }) {
  const i = name.lastIndexOf(" ");
  if (i < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, i)} <span className="serif-em">{name.slice(i + 1)}</span>
    </>
  );
}

export default function ToolPage({ params }: PageProps<"/tools/[id]">) {
  return (
    <Page className="pt-5 md:pt-6">
      {/* Breadcrumb / back link */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-3">
        <Link
          href="/tools"
          className="group -ml-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-x-0.5" />
          All tools
        </Link>
        <span aria-hidden className="h-4 w-px bg-line" />
        <Suspense fallback={<span aria-hidden className="h-3.5 w-20 rounded-sm bg-paper-2" />}>
          <ToolCategory params={params} />
        </Suspense>
      </nav>

      <Suspense fallback={<ToolDetailsSkeleton />}>
        <ToolDetails params={params} />
      </Suspense>
    </Page>
  );
}

async function ToolCategory({ params }: Pick<PageProps<"/tools/[id]">, "params">) {
  const { id } = await params;
  const tool = getTool(id);
  if (!tool) return null;
  return (
    <>
      <p className="label-mono text-ink-3">{tool.category}</p>
      {tool.status === "live" ? (
        <Badge variant="live" className="ml-auto">
          Live
        </Badge>
      ) : (
        <Badge className="ml-auto">Coming soon</Badge>
      )}
    </>
  );
}

async function ToolDetails({ params }: Pick<PageProps<"/tools/[id]">, "params">) {
  const { id } = await params;
  const tool = getTool(id);
  if (!tool) notFound();

  const Icon = tool.icon;
  const live = tool.status === "live";
  // Neighbours first (same category), then whatever works today.
  const related = tools
    .filter((t) => t.id !== tool.id)
    .sort(
      (a, b) =>
        Number(b.category === tool.category) - Number(a.category === tool.category) ||
        Number(b.status === "live") - Number(a.status === "live"),
    )
    .slice(0, 4);
  const spec = [
    ["Takes", tool.takes],
    ["Gives", tool.gives],
    ...(tool.limit ? [["Limit", tool.limit]] : []),
    ["Cost", "Free, no sign-up"],
  ];

  return (
    <>
      {/*
        Compact header: icon + name + one line. Kept short so the tool itself sits on the
        first screen, even on a 768px-tall laptop.
      */}
      <Reveal className="mt-5 flex items-start gap-4 md:mt-7 md:gap-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink md:size-14">
          <Icon aria-hidden className="size-5 md:size-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[clamp(1.875rem,3.4vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">
            <ToolTitle name={tool.name} />
          </h1>
          <p className="mt-2 max-w-xl text-base leading-relaxed text-ink-2 text-pretty md:text-lg">{tool.description}</p>
        </div>
      </Reveal>

      <div className="mt-8 grid grid-cols-1 gap-12 md:mt-10 lg:grid-cols-12 lg:gap-10 [&>*]:min-w-0">
        <Reveal delay={0.06} className="lg:col-span-8">
          <Playground toolId={tool.id} />
        </Reveal>

        <Reveal delay={0.12} className="lg:col-span-4">
          <aside className="space-y-10">
            <section aria-labelledby="spec-title">
              <h2 id="spec-title" className="label-mono text-ink-3">
                At a glance
              </h2>
              <dl className="mt-4 border-t border-line">
                {spec.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-6 border-b border-line py-3">
                    <dt className="label-mono shrink-0 text-ink-3">{k}</dt>
                    <dd className="text-right text-[15px] text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="does-title">
              <h2 id="does-title" className="label-mono text-ink-3">
                {live ? "What it does" : "What it will do"}
              </h2>
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {tool.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 py-3 text-[15px] leading-snug text-ink">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
                    {f}
                  </li>
                ))}
              </ul>
            </section>

          </aside>
        </Reveal>
      </div>

      {/* Related tools: a full-width row under the workbench, same category first. */}
      <section aria-labelledby="more-title" className="mt-20 md:mt-24">
        <div className="flex items-end justify-between gap-6 border-b border-line pb-4">
          <div>
            <p className="label-mono text-ink-3">Keep going</p>
            <h2 id="more-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
              Related <span className="serif-em">tools</span>
            </h2>
          </div>
          <Link
            href="/tools"
            className="group inline-flex shrink-0 items-center gap-1 text-sm font-medium text-ink-2 transition-colors hover:text-ink"
          >
            All tools
            <ArrowRight aria-hidden className="size-4 transition-transform duration-150 ease-out-soft group-hover:translate-x-0.5" />
          </Link>
        </div>
        <ul className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {related.map((t, i) => (
            <Reveal as="li" key={t.id} delay={i * 0.05} className="bg-paper">
              <RelatedCard tool={t} />
            </Reveal>
          ))}
        </ul>
      </section>
    </>
  );
}

function ToolDetailsSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="mt-5 flex items-start gap-4 md:mt-7 md:gap-5">
        <span className="size-11 shrink-0 rounded-md border border-line bg-surface md:size-14" />
        <div className="min-w-0 flex-1">
          <div className="h-9 w-2/3 max-w-md rounded-md bg-paper-2 md:h-11" />
          <div className="mt-3 h-5 max-w-sm rounded-sm bg-paper-2" />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-12 md:mt-10 lg:grid-cols-12 lg:gap-10">
        <div className="h-80 rounded-lg border border-line bg-surface lg:col-span-8" />
        <div className="space-y-4 lg:col-span-4">
          <span className="block h-4 w-24 rounded-sm bg-paper-2" />
          <div className="divide-y divide-line border-y border-line">
            <div className="h-12" />
            <div className="h-12" />
            <div className="h-12" />
            <div className="h-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

function RelatedCard({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const live = tool.status === "live";
  return (
    <Link
      href={toolHref(tool.id)}
      className="group flex h-full flex-col p-5 transition-colors duration-150 hover:bg-surface md:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors duration-150 group-hover:border-ink group-hover:bg-ink group-hover:text-paper">
          <Icon aria-hidden className="size-4" />
        </span>
        {live ? <Badge variant="live">Live</Badge> : <Badge>Soon</Badge>}
      </div>
      <h3 className="mt-5 flex items-center gap-1.5 text-[17px] sm:mt-8 font-semibold tracking-[-0.015em] text-ink">
        {tool.name}
        <ArrowUpRight
          aria-hidden
          className="size-4 text-ink-3 opacity-0 transition-[opacity,transform] duration-150 ease-out-soft group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
        />
      </h3>
      {/* flex-1 pushes the spec row to the bottom so it lines up across cards. */}
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-2">{tool.description}</p>
      <dl className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-3 sm:mt-6">
        <dt className="label-mono text-ink-3">Gives</dt>
        <dd className="truncate text-sm text-ink">{tool.gives}</dd>
      </dl>
    </Link>
  );
}
