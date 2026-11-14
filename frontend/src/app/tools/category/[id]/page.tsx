import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { CLUSTERS, clusterHref, toolHref, toolsIn, type ClusterId, type Tool } from "@/lib/tools";
import { HUBS } from "@/lib/hubs";
import { SITE_URL, absUrl, pageMeta } from "@/lib/site";
import { JsonLd } from "@/components/seo/json-ld";
import { Page } from "@/components/ui/paper";
import { Badge } from "@/components/ui/primitives";
import { ToolHopperSearch } from "@/components/tools/tool-hopper-search";
import { cn } from "@/lib/utils";

const clusterFor = (id: string) => CLUSTERS.find((c) => c.id === id);

export function generateStaticParams() {
  return CLUSTERS.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: PageProps<"/tools/category/[id]">): Promise<Metadata> {
  const cluster = clusterFor((await params).id);
  if (!cluster) return {};
  const hub = HUBS[cluster.id];
  return pageMeta({ title: `${hub.title} — Do-Whatever-You-Like`, description: hub.description, path: clusterHref(cluster.id) });
}

/**
 * A collection's own page: what it's for, then every tool in it, in the family's groups. Server
 * HTML only (no filter or scroll tracking), so it's light and readable without scripts; the full
 * directory with search lives at /tools.
 */
export default async function CategoryPage({ params }: PageProps<"/tools/category/[id]">) {
  const cluster = clusterFor((await params).id);
  if (!cluster) notFound();
  const copy = HUBS[cluster.id];
  const all = toolsIn(cluster.id);
  const live = all.filter((t) => t.status === "live");
  const hub = cluster.hub ? all.find((t) => t.id === cluster.hub) : undefined;
  const rest = all.filter((t) => t !== hub);
  const sections: [string | null, Tool[]][] = cluster.groups
    ? cluster.groups.map((g) => [g, rest.filter((t) => t.group === g)] as [string, Tool[]]).filter(([, l]) => l.length)
    : [[null, rest]];
  const Icon = cluster.icon;
  const words = cluster.title.split(" ");
  const url = absUrl(clusterHref(cluster.id));

  return (
    <Page className="pt-8 md:pt-10">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "CollectionPage",
              "@id": `${url}#page`,
              name: copy.title,
              description: copy.description,
              url,
              isPartOf: { "@id": `${SITE_URL}/#website` },
              mainEntity: {
                "@type": "ItemList",
                numberOfItems: live.length,
                itemListElement: live.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, url: absUrl(toolHref(t.id)) })),
              },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                ["Home", "/"],
                ["All tools", "/tools"],
                [cluster.title, clusterHref(cluster.id)],
              ].map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: absUrl(path) })),
            },
          ],
        }}
      />

      <nav aria-label="Breadcrumb" className="flex items-center justify-between gap-3">
        <Link
          href="/tools"
          className="group -ml-2 inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-x-0.5" />
          All tools
        </Link>
        <ToolHopperSearch mode="compact" contextClusterId={cluster.id} />
      </nav>

      <header className="mt-8 flex items-start gap-4 md:mt-12 md:gap-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink md:size-14">
          <Icon aria-hidden className="size-5 md:size-6" />
        </span>
        <div className="min-w-0">
          <p className="label-mono text-ink-3">
            {cluster.name} · {live.length} free {live.length === 1 ? "tool" : "tools"}
          </p>
          <h1 className="mt-2 text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">
            {words.slice(0, -1).join(" ")} <span className="serif-em">{words.at(-1)}</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-2 text-pretty">{copy.intro}</p>
        </div>
      </header>

      {hub && (
        <Link
          href={toolHref(hub.id)}
          className="group mt-10 flex items-center justify-between gap-4 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-ink-3 md:p-6"
        >
          <span>
            <span className="label-mono text-ink-3">All-in-one</span>
            <span className="mt-1 block text-lg font-semibold tracking-[-0.015em] text-ink">{hub.name}</span>
            <span className="mt-0.5 block text-[15px] text-ink-2">{hub.description}</span>
          </span>
          <ArrowRight aria-hidden className="size-5 shrink-0 text-ink-2 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      )}

      <div className="mt-12 space-y-10">
        {sections.map(([group, list]) => (
          <section key={group ?? "all"} aria-label={group ?? cluster.title}>
            {group && (
              <h2 className="label-mono mb-3 flex items-center gap-2 text-ink-2">
                {group} <span className="text-ink-3">· {list.length}</span>
              </h2>
            )}
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
              {list.map((t) => (
                <li key={t.id} className="bg-paper">
                  <Link href={toolHref(t.id)} className="group flex h-full items-start gap-3.5 p-4 transition-colors duration-150 hover:bg-surface md:p-5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors duration-150 group-hover:border-ink group-hover:bg-ink group-hover:text-paper">
                      <t.icon aria-hidden className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold tracking-[-0.01em] text-ink">{t.name}</span>
                      <span className="mt-0.5 block text-sm leading-relaxed text-ink-2">{t.description}</span>
                    </span>
                    {t.status !== "live" && <Badge className="shrink-0">Soon</Badge>}
                  </Link>
                </li>
              ))}
              <Fill count={list.length} />
            </ul>
          </section>
        ))}
      </div>

      <nav aria-labelledby="more-collections" className="mt-20 border-t border-line pt-8">
        <h2 id="more-collections" className="label-mono text-ink-3">
          More collections
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {CLUSTERS.filter((c) => c.id !== cluster.id).map((c) => (
            <li key={c.id}>
              <Link
                href={clusterHref(c.id as ClusterId)}
                className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-[15px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Page>
  );
}

/** Closes a short last row of the hairline grid with plain paper, so there's no grey hole. */
function Fill({ count }: { count: number }) {
  const sm = count % 2 ? 1 : 0;
  const xl = (3 - (count % 3)) % 3;
  if (!sm && !xl) return null;
  return (
    <li
      aria-hidden
      className={cn(
        "bg-paper-2/40 max-sm:hidden",
        sm ? "sm:col-span-1" : "sm:hidden",
        xl === 0 ? "xl:hidden" : xl === 1 ? "xl:col-span-1 xl:block" : "xl:col-span-2 xl:block",
      )}
    />
  );
}
