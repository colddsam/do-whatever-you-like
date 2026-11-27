import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Page } from "@/components/ui/paper";
import { SectionHeader } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { BlogIndex } from "@/components/blog/blog-index";
import { getAllPosts } from "@/lib/blog";
import { blogIndexGraph } from "@/lib/schema";
import { pageMeta } from "@/lib/site";
import { liveCount } from "@/lib/tools";

const baseMeta = pageMeta({
  title: "Blog — Do-Whatever-You-Like",
  description: `Product launches, architecture notes, and how ${liveCount} free browser-first tools work without accounts or watermarks, from the developer who builds them.`,
  path: "/blog",
  image: "/blog/opengraph-image",
});

export const metadata: Metadata = {
  ...baseMeta,
  alternates: {
    canonical: "/blog",
    types: {
      "application/rss+xml": "/blog/rss.xml",
    },
  },
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <Page className="pt-8 md:pt-10">
      <JsonLd data={blogIndexGraph(posts)} />

      <Link
        href="/"
        className="group -ml-2 inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <ArrowLeft
          aria-hidden
          className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-x-0.5"
        />
        Home
      </Link>

      <div className="mt-10 md:mt-14">
        <SectionHeader
          index="00"
          label="Journal"
          as="h1"
          title={
            <>
              Notes from the <span className="serif-em">workbench.</span>
            </>
          }
          description={`Release notes, architecture write-ups, and practical guides for all ${liveCount} free tools across the site.`}
        />
      </div>

      <Suspense
        fallback={
          <div aria-hidden className="mt-10 space-y-6">
            <div className="h-24 rounded-lg border border-line bg-surface" />
            <div className="h-80 rounded-lg border border-line bg-surface" />
          </div>
        }
      >
        <BlogIndex posts={posts} />
      </Suspense>
    </Page>
  );
}
