import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------- Container ---------- */

export function Container({
  className,
  children,
  ruled = true,
  dark = false,
}: {
  className?: string;
  children: React.ReactNode;
  /** Draws the signature left/right hairlines on large screens. */
  ruled?: boolean;
  /** Use the dark-band rule colour. */
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1200px] px-5 md:px-8",
        ruled && "lg:border-x",
        ruled && (dark ? "lg:border-line-dark" : "lg:border-line"),
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";
type ButtonSize = "md" | "lg";

const buttonBase =
  "group inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-out-soft active:translate-y-px";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/85",
  secondary: "border border-line bg-surface text-ink hover:border-ink-3",
  ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink",
  inverse: "bg-paper text-ink hover:bg-paper-2",
};

const buttonSizes: Record<ButtonSize, string> = {
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  arrow = false,
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}>
      {children}
      {arrow && (
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform duration-150 ease-out-soft group-hover:translate-x-0.5"
        />
      )}
    </Link>
  );
}

/* ---------- Badge ---------- */

export function Badge({
  variant = "default",
  className,
  children,
}: {
  variant?: "default" | "live" | "dark";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "label-mono inline-flex h-6 items-center gap-1.5 rounded-sm border px-2",
        variant === "dark" ? "border-line-dark text-paper-dim" : "border-line text-ink-2",
        variant === "live" && "bg-surface text-ink",
        className,
      )}
    >
      {variant === "live" && <SignalDot />}
      {children}
    </span>
  );
}

export function SignalDot({ pulse = false, className }: { pulse?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-1.5", className)}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />}
      <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
    </span>
  );
}

/* ---------- Kbd ---------- */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-paper px-1 font-mono text-[11px] text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ---------- Section header ---------- */

export function SectionHeader({
  index,
  label,
  title,
  description,
  dark = false,
  className,
}: {
  index: string;
  label: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-6 md:grid-cols-12 md:gap-8", className)}>
      <p className={cn("label-mono md:col-span-3 md:pt-3", dark ? "text-paper-dim" : "text-ink-3")}>
        {index} — {label}
      </p>
      <div className="md:col-span-9">
        <h2 className="text-h2 text-balance">{title}</h2>
        {description && (
          <p
            className={cn(
              "mt-5 max-w-xl text-[17px] leading-relaxed text-pretty",
              dark ? "text-paper-dim" : "text-ink-2",
            )}
          >
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
