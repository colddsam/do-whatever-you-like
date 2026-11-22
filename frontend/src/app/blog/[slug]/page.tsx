import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Page } from "@/components/ui/paper";
import { Badge, ButtonLink } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { ArticleBody } from "@/components/blog/article-body";
import { BlogShare } from "@/components/blog/blog-share";
import { BlogToc } from "@/components/blog/blog-toc";
import {
  BLOG_POSTS,
  blogHref,
  estimateReadingMinutes,
  extractToc,
  formatBlogDate,
  getPost,
} from "@/lib/blog";
import { blogPostGraph } from "@/lib/schema";
import { pageMeta } from "@/lib/site";
import { CLUSTERS, liveCount } from "@/lib/tools";

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};

  return pageMeta({
    title: `${post.title} — Do-Whatever-You-Like`,
    description: post.description,
    path: blogHref(post.slug),
    image: `${blogHref(post.slug)}/opengraph-image`,
    type: "article",
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt ?? post.publishedAt,
    tags: post.tags,
  });
}

export default function BlogPostPage({ params }: PageProps<"/blog/[slug]">) {
  return (
    <Suspense fallback={<BlogPostSkeleton />}>
      <BlogPostContent params={params} />
    </Suspense>
  );
}

async function BlogPostContent({ params }: Pick<PageProps<"/blog/[slug]">, "params">) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const toc = extractToc(post);
  const readingMinutes = estimateReadingMinutes(post);
  const path = blogHref(post.slug);

  const facts = [
    ["Live tools", `${liveCount} across ${CLUSTERS.length} collections`],
    ["Browser-only", "103 tools (on your device)"],
    ["Cost", "Free, no sign-up"],
    ["Code", "Source-available on GitHub"],
  ];

  return (
    <Page className="pt-6 md:pt-8">
      <JsonLd data={blogPostGraph(post)} />

      {/* Top breadcrumb bar */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href="/blog"
          className="group -ml-2 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <ArrowLeft
            aria-hidden
            className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-x-0.5"
          />
          All posts
        </Link>
        <span aria-hidden className="h-4 w-px shrink-0 bg-line" />
        <Link
          href={`/blog?category=${encodeURIComponent(post.category)}`}
          className="label-mono inline-flex min-h-11 items-center text-ink-3 transition-colors hover:text-ink"
        >
          {post.category}
        </Link>

        <div className="ml-auto max-sm:hidden">
          <BlogShare path={path} title={post.title} />
        </div>
      </nav>

      {/* Editorial header: painted directly in server HTML (LCP-safe, no Reveal) */}
      <header className="mt-8 border-b border-line pb-8 md:mt-12 md:pb-10">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="label-mono text-ink-3">No. {post.issue}</span>
          <Badge variant="live">{post.category}</Badge>
          <span className="label-mono text-ink-3">
            {formatBlogDate(post.publishedAt)} · {readingMinutes} min read
          </span>
        </div>

        <h1 className="mt-5 max-w-4xl text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-ink text-balance">
          {post.titleParts.before}{" "}
          <span className="serif-em text-accent">{post.titleParts.em}</span>
          {post.titleParts.after ? ` ${post.titleParts.after}` : ""}
        </h1>

        <p className="blog-standfirst mt-5 max-w-3xl text-lg leading-relaxed text-ink-2 text-pretty md:text-xl">
          {post.subtitle}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
          <div className="flex items-center gap-3">
            <a
              href={post.author.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1 text-[15px] font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              {post.author.name}
              <ArrowUpRight aria-hidden className="size-3.5 text-ink-3 group-hover:text-ink" />
            </a>
            <span className="label-mono text-ink-3">· {post.author.role}</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((t) => (
              <Link
                key={t}
                href={`/blog?tag=${encodeURIComponent(t)}`}
                className="label-mono inline-flex h-7 items-center rounded-sm border border-line bg-surface px-2.5 text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                {t}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* Main 12-column editorial body */}
      <div className="mt-10 grid grid-cols-1 gap-10 lg:mt-14 lg:grid-cols-12 lg:gap-10 [&>*]:min-w-0">
        <aside className="lg:col-span-3">
          <div className="space-y-8 lg:sticky lg:top-24">
            <BlogToc items={toc} />

            <section aria-labelledby="blog-facts" className="max-lg:hidden">
              <h2 id="blog-facts" className="label-mono text-ink-3">
                At a glance
              </h2>
              <dl className="mt-3 border-t border-line">
                {facts.map(([k, v]) => (
                  <div key={k} className="border-b border-line py-2.5">
                    <dt className="label-mono text-ink-3">{k}</dt>
                    <dd className="mt-0.5 text-[14px] text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <div className="max-lg:hidden">
              <ButtonLink href="/tools" arrow className="w-full">
                Open toolbox
              </ButtonLink>
            </div>
          </div>
        </aside>

        <article className="lg:col-span-9">
          <ArticleBody blocks={post.blocks} />

          {/* Mobile share bar + closing action */}
          <footer className="mt-14 border-t border-line pt-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="label-mono text-ink-3">Share this note</p>
                <p className="mt-1 text-sm text-ink-2">
                  Published {formatBlogDate(post.publishedAt)} · Updated{" "}
                  {formatBlogDate(post.updatedAt ?? post.publishedAt)}
                </p>
              </div>
              <BlogShare path={path} title={post.title} />
            </div>

            <div className="mt-8 flex flex-col justify-between gap-6 rounded-lg border border-line bg-surface p-6 sm:flex-row sm:items-center sm:p-8">
              <div className="max-w-lg">
                <p className="label-mono text-ink-3">Try it yourself</p>
                <p className="mt-2 text-xl font-semibold tracking-[-0.02em] text-ink">
                  Open any of the {liveCount} live tools with zero sign-up.
                </p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
                  Pick a task from the directory or suggest the next tool we should build.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 shrink-0">
                <ButtonLink href="/tools" arrow>
                  Browse all tools
                </ButtonLink>
                <ButtonLink href="/#request" variant="secondary">
                  Request a tool
                </ButtonLink>
              </div>
            </div>
          </footer>
        </article>
      </div>
    </Page>
  );
}

function BlogPostSkeleton() {
  return (
    <Page className="pt-6 md:pt-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-3">
        <span className="inline-flex h-11 items-center gap-1.5 px-2 text-sm text-ink-3">All posts</span>
        <span aria-hidden className="h-4 w-px bg-line" />
        <span aria-hidden className="h-3.5 w-20 rounded-sm bg-paper-2" />
      </nav>

      <div aria-hidden className="mt-8 animate-pulse border-b border-line pb-8 md:mt-12 md:pb-10">
        <div className="h-5 w-48 rounded-sm bg-paper-2" />
        <div className="mt-5 h-12 w-full max-w-2xl rounded-md bg-paper-2 md:h-14" />
        <div className="mt-4 h-6 w-full max-w-xl rounded-sm bg-paper-2" />
      </div>

      <div aria-hidden className="mt-10 grid animate-pulse grid-cols-1 gap-10 lg:mt-14 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-3 lg:col-span-3">
          <div className="h-4 w-24 rounded-sm bg-paper-2" />
          <div className="divide-y divide-line border-y border-line">
            <div className="h-10" />
            <div className="h-10" />
            <div className="h-10" />
            <div className="h-10" />
          </div>
        </div>
        <div className="space-y-5 lg:col-span-9">
          <div className="h-6 w-3/4 rounded-sm bg-paper-2" />
          <div className="h-24 w-full max-w-2xl rounded-md bg-surface border border-line" />
          <div className="aspect-video w-full rounded-lg border border-line bg-surface" />
        </div>
      </div>
    </Page>
  );
}
