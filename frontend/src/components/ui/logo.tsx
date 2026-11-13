import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className={inverted ? "fill-paper" : "fill-ink"} />
      <path
        d="M9 16.5l4.5 4.5L23 11.5"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={inverted ? "stroke-ink" : "stroke-paper"}
      />
      <circle cx="24.5" cy="24.5" r="3" className="fill-accent" />
    </svg>
  );
}

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link href="/" aria-label="Do-Whatever home" className="inline-flex min-h-11 shrink-0 items-center gap-2.5">
      <LogoMark inverted={inverted} />
      <span className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em]">
        Do<span className={inverted ? "text-paper-dim" : "text-ink-3"}>-</span>Whatever
      </span>
    </Link>
  );
}
