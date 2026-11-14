import Link from "next/link";
import { LOGO_HALO_PATH, LOGO_INK_PATH, LOGO_VIEWBOX } from "@/lib/logo-paths";
import { cn } from "@/lib/utils";

export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} aria-hidden className={cn("h-9 w-auto shrink-0", className)}>
      <path d={LOGO_HALO_PATH} className={inverted ? "fill-ink" : "fill-surface"} />
      <path d={LOGO_INK_PATH} fillRule="evenodd" className={inverted ? "fill-paper" : "fill-ink"} />
    </svg>
  );
}

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link href="/" aria-label="Do-Whatever-You-Like home" className="inline-flex min-h-11 shrink-0 items-center gap-2.5">
      <LogoMark inverted={inverted} />
      <span className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em]">
        Do<span className={inverted ? "text-paper-dim" : "text-ink-3"}>-</span>Whatever<span className={inverted ? "text-paper-dim" : "text-ink-3"}>-</span>You<span className={inverted ? "text-paper-dim" : "text-ink-3"}>-</span>Like
      </span>
    </Link>
  );
}
