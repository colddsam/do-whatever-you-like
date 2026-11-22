import { OG_SIZE, ogCard } from "@/lib/og";
import { BLOG_POSTS, getPost } from "@/lib/blog";

export const alt = "Do-Whatever-You-Like Journal article";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) {
    return ogCard({
      eyebrow: "Journal",
      title: "Notes from the workbench",
      subtitle: "Product launches, architecture notes, and guides.",
    });
  }
  return ogCard({
    eyebrow: `Journal · ${post.category}`,
    title: post.title,
    subtitle: post.description,
  });
}
