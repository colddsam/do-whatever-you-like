"use client";

import { useHapticsPreference } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * The person's own kill switch for tap feedback. Only shown on touch screens (coarse pointers),
 * where haptics exist at all; desktop layouts never see it.
 */
export function HapticsToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useHapticsPreference();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      // The switch answers for itself: a tap when turned on, silence when turned off.
      data-haptics="off"
      onClick={() => setEnabled(!enabled)}
      className={cn(
        "hidden items-center gap-2 self-start py-1 text-sm text-ink-3 transition-colors hover:text-ink pointer-coarse:inline-flex",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 rounded-full border transition-colors duration-150",
          enabled ? "border-ink bg-ink" : "border-line bg-paper-2",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-[left,background-color] duration-150 ease-out-soft",
            enabled ? "left-[14px] bg-paper" : "left-[2px] bg-ink-3",
          )}
        />
      </span>
      Haptics {enabled ? "on" : "off"}
    </button>
  );
}
