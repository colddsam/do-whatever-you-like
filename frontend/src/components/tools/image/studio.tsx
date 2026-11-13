"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { Eraser, FileOutput, Maximize2, Minimize2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CompressImageTool, ConvertToJpgTool, RemoveBackgroundTool, ResizeImageTool } from "./simple-tools";

type Mode = "compress" | "resize" | "convert" | "background";

const MODES: Record<Mode, { label: string; hint: string; icon: LucideIcon; toolId: string; Tool: typeof CompressImageTool }> = {
  compress: { label: "Compress", hint: "Smaller files", icon: Minimize2, toolId: "compress-image", Tool: CompressImageTool },
  resize: { label: "Resize", hint: "Pixels or %", icon: Maximize2, toolId: "resize-image", Tool: ResizeImageTool },
  convert: { label: "Convert", hint: "To JPG", icon: FileOutput, toolId: "convert-to-jpg", Tool: ConvertToJpgTool },
  background: { label: "Cut out", hint: "Remove background", icon: Eraser, toolId: "remove-background", Tool: RemoveBackgroundTool },
};

/**
 * The Image studio on the home page: the four image jobs people reach for most, behind the same
 * mode switch as the PDF toolkit. Each mode is the full single-purpose tool.
 */
export function ImageStudio() {
  const [mode, setMode] = useState<Mode>("compress");
  const { Tool, toolId } = MODES[mode];
  return <Tool key={mode} toolId={toolId} band={<ModeBand mode={mode} onChange={setMode} />} />;
}

function ModeBand({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const keys = Object.keys(MODES) as Mode[];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const n = (i + delta + keys.length) % keys.length;
    refs.current[n]?.focus();
    onChange(keys[n]);
  };
  return (
    <div className="border-b border-line bg-paper/60 p-2 sm:px-3">
      <div role="tablist" aria-label="What to do with your images" className="grid grid-cols-4 gap-1">
        {keys.map((k, i) => {
          const m = MODES[k];
          const active = k === mode;
          return (
            <button
              key={k}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(k)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "group relative flex h-14 flex-col items-center justify-center gap-1 rounded-md px-1 text-[13px] transition-colors duration-150 sm:h-12 sm:flex-row sm:justify-start sm:gap-2 sm:px-3 sm:text-sm",
                active ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
              )}
            >
              {active && (
                <motion.span layoutId="image-mode-thumb" aria-hidden className="absolute inset-0 rounded-md bg-ink" transition={{ type: "spring", bounce: 0.22, duration: 0.5 }} />
              )}
              <m.icon aria-hidden className="relative size-4 shrink-0" />
              <span className="relative flex min-w-0 flex-col items-center leading-tight sm:items-start">
                <span className="font-medium">{m.label}</span>
                <span className={cn("label-mono hidden text-[12px] sm:block", active ? "text-paper-dim" : "text-ink-3")}>{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
