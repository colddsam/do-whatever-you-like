"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowUpRight, Play, Video } from "lucide-react";
import { SignalDot } from "@/components/ui/primitives";
import type { BlogVideoData } from "@/lib/blog";
import { cn } from "@/lib/utils";

/**
 * Editorial video theatre inside the dark band (`ink` / `ink-raised` / `line-dark`).
 * Loads `youtube-nocookie.com` only after the reader clicks Play or picks a chapter,
 * avoiding third-party embed bloat and cookies on initial page load.
 */
export function BlogVideo({ video }: { video: BlogVideoData }) {
  const [playing, setPlaying] = useState(false);
  const [startSeconds, setStartSeconds] = useState(0);
  const [playNonce, setPlayNonce] = useState(0);

  const playFrom = (seconds: number) => {
    setStartSeconds(seconds);
    setPlaying(true);
    setPlayNonce((n) => n + 1);
  };

  const watchUrl = `https://youtu.be/${video.youtubeId}`;
  const embedSrc = `https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0&start=${startSeconds}`;

  return (
    <figure className="my-10">
      <div className="overflow-hidden rounded-lg border border-line bg-ink text-paper shadow-card">
        <div className="relative aspect-video w-full bg-ink">
          {playing ? (
            <iframe
              key={`${video.youtubeId}-${playNonce}-${startSeconds}`}
              src={embedSrc}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
            />
          ) : (
            <button
              type="button"
              onClick={() => playFrom(0)}
              aria-label={`Play video: ${video.title}`}
              className="group relative flex size-full cursor-pointer items-center justify-center text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
            >
              <Image
                src={video.poster}
                alt={video.posterAlt}
                width={video.posterWidth}
                height={video.posterHeight}
                sizes="(max-width: 1024px) 100vw, 860px"
                className="size-full object-cover object-top opacity-45 transition-transform duration-700 ease-out-soft group-hover:scale-[1.015]"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-ink/60"
              />

              <div className="absolute left-4 top-4 flex items-center gap-2 sm:left-6 sm:top-6">
                <span className="label-mono inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-dark bg-ink-raised/90 px-2.5 text-paper">
                  <SignalDot />
                  Walkthrough · {video.duration}
                </span>
              </div>

              <div className="relative z-10 flex max-w-lg flex-col items-center px-6 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-paper text-ink shadow-float transition-transform duration-200 ease-out-soft group-hover:scale-105 sm:size-[72px]">
                  <Play aria-hidden className="ml-0.5 size-6 fill-current" />
                </span>
                <p className="mt-5 text-lg font-semibold tracking-[-0.02em] text-paper sm:text-xl">
                  {video.title}
                </p>
                <p className="label-mono mt-2 text-paper-dim">
                  Loads youtube-nocookie.com on play · no prior cookies
                </p>
              </div>
            </button>
          )}
        </div>

        {/* Interactive chapter strip + direct YouTube fallback */}
        <div className="flex flex-col gap-2 border-t border-line-dark bg-ink-raised px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div
            className="no-scrollbar flex items-center gap-1 overflow-x-auto"
            role="group"
            aria-label="Video chapters"
          >
            {video.chapters.map((ch) => {
              const isCurrent = playing && startSeconds === ch.seconds;
              return (
                <button
                  key={ch.time}
                  type="button"
                  onClick={() => playFrom(ch.seconds)}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[12px] transition-colors",
                    isCurrent
                      ? "bg-paper text-ink font-medium"
                      : "text-paper-dim hover:bg-ink hover:text-paper",
                  )}
                >
                  <span className={cn("font-mono", isCurrent ? "text-accent" : "text-paper-dim")}>
                    {ch.time}
                  </span>
                  <span>{ch.label}</span>
                </button>
              );
            })}
          </div>

          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-sm px-2.5 font-mono text-[12px] text-paper-dim transition-colors hover:bg-ink hover:text-paper sm:self-auto"
          >
            <Video aria-hidden className="size-3.5" />
            Watch on YouTube
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </div>
      </div>

      <figcaption className="mt-3 flex flex-col gap-1.5 text-[13px] leading-relaxed text-ink-2">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="mt-2.5 h-px w-6 shrink-0 bg-ink-3" />
          <span>
            <span className="label-mono mr-2 text-ink-3">{video.figureLabel} —</span>
            {video.caption}
          </span>
        </div>
        {video.note && (
          <p className="pl-[34px] text-[13px] text-ink-3">Note: {video.note}</p>
        )}
      </figcaption>
    </figure>
  );
}
