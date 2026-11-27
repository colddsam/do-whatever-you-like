"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Link2, Rss } from "lucide-react";
import { absUrl } from "@/lib/site";
import { triggerHaptic } from "@/lib/haptics";

export function BlogShare({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const fullUrl = absUrl(path);
  const xHref = `https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(fullUrl)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      triggerHaptic("success");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in non-secure context; ignore gracefully.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copyLink}
        className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      >
        {copied ? (
          <>
            <Check aria-hidden className="size-3.5 text-success" />
            <span className="text-ink">Copied</span>
          </>
        ) : (
          <>
            <Link2 aria-hidden className="size-3.5" />
            Copy link
          </>
        )}
      </button>

      <a
        href={xHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center gap-1 rounded-sm border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      >
        Share on X
        <ArrowUpRight aria-hidden className="size-3.5" />
      </a>

      <Link
        href="/blog/rss.xml"
        className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      >
        <Rss aria-hidden className="size-3.5" />
        RSS
      </Link>
    </div>
  );
}
