"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Rss, Search, X } from "lucide-react";
import { Badge, Kbd } from "@/components/ui/primitives";
import {
  BLOG_CATEGORIES,
  blogHref,
  estimateReadingMinutes,
  formatBlogDate,
  type BlogCategory,
  type BlogPost,
} from "@/lib/blog";
import { cn } from "@/lib/utils";

function postSearchText(post: BlogPost): string {
  return [post.title, post.subtitle, post.description, post.category, ...post.tags].join(" ").toLowerCase();
}

export function BlogIndex({ posts }: { posts: BlogPost[] }) {
  const params = useSearchParams();
  const initialCat = params.get("category") ?? "";
  const initialTag = params.get("tag") ?? "";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(
    BLOG_CATEGORIES.includes(initialCat as BlogCategory) ? initialCat : "",
  );
  const [tag, setTag] = useState<string>(initialTag);
  const paramsKey = params.toString();
  const [prevParamsKey, setPrevParamsKey] = useState(paramsKey);
  const inputRef = useRef<HTMLInputElement>(null);

  if (prevParamsKey !== paramsKey) {
    setPrevParamsKey(paramsKey);
    const paramCat = params.get("category") ?? "";
    setCategory(BLOG_CATEGORIES.includes(paramCat as BlogCategory) ? paramCat : "");
    setTag(params.get("tag") ?? "");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) {
          return;
        }
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === inputRef.current && query) {
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query]);

  const categories = useMemo(
    () =>
      BLOG_CATEGORIES.map((c) => ({ name: c, count: posts.filter((p) => p.category === c).length })).filter(
        (c) => c.count > 0,
      ),
    [posts],
  );

  const tags = useMemo(() => [...new Set(posts.flatMap((p) => p.tags))], [posts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((p) => {
      if (category && p.category !== category) return false;
      if (tag && !p.tags.includes(tag)) return false;
      if (q && !postSearchText(p).includes(q)) return false;
      return true;
    });
  }, [posts, category, tag, query]);

  const hasFilters = Boolean(query.trim() || category || tag);
  const lead = filtered[0];
  const rest = filtered.slice(1);

  return (
    <div className="mt-10 md:mt-14">
      {/* Filter bar: search, category chips, RSS link */}
      <div className="flex flex-col gap-4 border-y border-line py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-md">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles, tools or topics…"
              aria-label="Search blog posts"
              className="h-11 w-full rounded-md border border-line bg-surface pl-10 pr-16 text-[15px] text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink"
              >
                <X aria-hidden className="size-4" />
              </button>
            ) : (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 max-sm:hidden">
                <Kbd>/</Kbd>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCategory("")}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-sm border px-3 text-sm font-medium transition-colors",
                !category
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              All
              <span className={cn("font-mono text-[12px]", !category ? "text-paper-dim" : "text-ink-3")}>
                {posts.length}
              </span>
            </button>
            {categories.map((c) => {
              const on = category === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setCategory(on ? "" : c.name)}
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 rounded-sm border px-3 text-sm font-medium transition-colors",
                    on
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  {c.name}
                  <span className={cn("font-mono text-[12px]", on ? "text-paper-dim" : "text-ink-3")}>
                    {c.count}
                  </span>
                </button>
              );
            })}
            <Link
              href="/blog/rss.xml"
              className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              <Rss aria-hidden className="size-3.5 text-accent" />
              RSS
            </Link>
          </div>
        </div>

        {/* Tag row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mono mr-1 text-ink-3">Topics</span>
          {tags.map((t) => {
            const on = tag === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setTag(on ? "" : t)}
                className={cn(
                  "inline-flex h-8 items-center rounded-sm border px-2.5 text-[13px] transition-colors",
                  on
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper text-ink-2 hover:border-ink-3 hover:text-ink",
                )}
              >
                {t}
              </button>
            );
          })}
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("");
                setTag("");
              }}
              className="ml-auto text-[13px] font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {!lead ? (
        <div className="mt-10 rounded-lg border border-line bg-surface p-8 text-center md:p-12">
          <p className="label-mono text-ink-3">No matching posts</p>
          <p className="mt-3 text-lg font-semibold tracking-[-0.015em] text-ink">
            Nothing matched those filters.
          </p>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-2">
            Clear the active search or topic filters to return to the journal archive.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategory("");
              setTag("");
            }}
            className="mt-6 inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* Featured / Lead article spread */}
          <article className="mt-10">
            <Link
              href={blogHref(lead.slug)}
              className="group grid grid-cols-1 overflow-hidden rounded-lg border border-line bg-surface transition-[border-color,box-shadow] duration-150 hover:border-ink-3 hover:shadow-card lg:grid-cols-12"
            >
              <div className="relative overflow-hidden border-b border-line bg-paper p-2.5 lg:col-span-6 lg:border-b-0 lg:border-r lg:p-3">
                <div className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-line bg-paper">
                  <Image
                    src={lead.cover.src}
                    alt={lead.cover.alt}
                    width={lead.cover.width}
                    height={lead.cover.height}
                    priority
                    sizes="(max-width: 1024px) 100vw, 560px"
                    className="size-full object-cover object-top transition-transform duration-500 ease-out-soft group-hover:scale-[1.015]"
                  />
                </div>
              </div>

              <div className="flex flex-col justify-between p-6 sm:p-8 lg:col-span-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="label-mono text-ink-3">No. {lead.issue}</span>
                    <Badge variant="live">{lead.category}</Badge>
                    <span className="label-mono text-ink-3">
                      {formatBlogDate(lead.publishedAt)} · {estimateReadingMinutes(lead)} min read
                    </span>
                  </div>

                  <h2 className="mt-5 text-[clamp(1.625rem,2.8vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-ink text-balance">
                    {lead.titleParts.before}{" "}
                    <span className="serif-em text-accent">{lead.titleParts.em}</span>
                    {lead.titleParts.after ? ` ${lead.titleParts.after}` : ""}
                  </h2>

                  <p className="mt-4 text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">
                    {lead.subtitle}
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
                  <div className="flex flex-wrap gap-1.5">
                    {lead.tags.map((t) => (
                      <span
                        key={t}
                        className="label-mono inline-flex h-6 items-center rounded-sm border border-line bg-paper px-2 text-ink-2"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                    Read article
                    <ArrowRight
                      aria-hidden
                      className="size-4 transition-transform duration-150 ease-out-soft group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </div>
            </Link>
          </article>

          {/* Archive list when multiple posts match */}
          {rest.length > 0 && (
            <section aria-labelledby="archive-heading" className="mt-14">
              <h2 id="archive-heading" className="label-mono mb-4 text-ink-3">
                More issues
              </h2>
              <ol className="divide-y divide-line border-y border-line">
                {rest.map((post) => (
                  <li key={post.slug}>
                    <Link
                      href={blogHref(post.slug)}
                      className="group grid gap-4 py-6 transition-colors hover:bg-surface/70 sm:px-3 md:grid-cols-12 md:items-baseline"
                    >
                      <div className="flex items-center gap-3 md:col-span-3">
                        <span className="label-mono text-ink-3">No. {post.issue}</span>
                        <Badge>{post.category}</Badge>
                      </div>
                      <div className="md:col-span-7">
                        <h3 className="text-lg font-semibold tracking-[-0.015em] text-ink group-hover:underline group-hover:decoration-line group-hover:underline-offset-4">
                          {post.title}
                        </h3>
                        <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{post.description}</p>
                      </div>
                      <div className="flex items-center justify-between gap-2 md:col-span-2 md:justify-end">
                        <span className="label-mono text-ink-3">
                          {formatBlogDate(post.publishedAt)} · {estimateReadingMinutes(post)}m
                        </span>
                        <ArrowRight
                          aria-hidden
                          className="size-4 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Calm editorial footer strip when Issue 01 is the only article */}
          {rest.length === 0 && (
            <div className="mt-12 grid gap-6 rounded-lg border border-line bg-paper p-6 sm:grid-cols-3 sm:p-8">
              <div>
                <p className="label-mono text-ink-3">Follow updates</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                  Subscribe via{" "}
                  <Link
                    href="/blog/rss.xml"
                    className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    RSS
                  </Link>{" "}
                  for new releases and engineering write-ups.
                </p>
              </div>
              <div>
                <p className="label-mono text-ink-3">Try the toolbox</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                  Jump straight into all 162 utilities in the{" "}
                  <Link
                    href="/tools"
                    className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    tools directory
                  </Link>
                  .
                </p>
              </div>
              <div>
                <p className="label-mono text-ink-3">Missing a job?</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                  Tell us what to build next using{" "}
                  <Link
                    href="/#request"
                    className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    Request a tool
                  </Link>
                  .
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
