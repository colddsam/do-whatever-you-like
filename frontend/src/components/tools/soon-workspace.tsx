"use client";

import { ArrowRight, FileUp, Link2 } from "lucide-react";
import { getTool, stepsFor, type Tool } from "@/lib/tools";
import { ButtonLink } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Workbench } from "./workbench";

/**
 * A tool that isn't built yet still gets its real workspace, just switched off, so the page
 * shows how it will work instead of a blank "coming soon". The layout comes from the tool's
 * kind, so a new integration gets a sensible preview without any extra code.
 */
export function SoonWorkspace({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  return (
    <Workbench
      steps={stepsFor(tool)}
      current={-1}
      footer={<>The most-requested tools get built first. Asking for this one moves it up the list.</>}
    >
      <div className="flex items-center justify-between gap-4 border-b border-line bg-paper/60 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="label-mono text-ink-2">Not built yet</p>
          <p className="mt-1 text-sm leading-snug text-ink-2">This is how it will work. Want it sooner?</p>
        </div>
        <ButtonLink href="/#request" arrow className="shrink-0">
          Request it
        </ButtonLink>
      </div>

      {/* Inert: it's a picture of the tool, not something to fill in. */}
      <div inert aria-hidden className="select-none p-3 opacity-75 sm:p-4">
        {tool.kind === "link" && <LinkPreview />}
        {tool.kind === "file" && <FilePreview tool={tool} />}
        {tool.kind === "text" && <TextPreview tool={tool} />}
        {tool.kind === "generate" && <GeneratePreview tool={tool} />}
      </div>
    </Workbench>
  );
}

/* ---------- One sketch per kind ---------- */

function Options({ options }: { options?: string[] }) {
  if (!options?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o, i) => (
        <span
          key={o}
          className={cn(
            "inline-flex h-8 items-center rounded-sm border px-2.5 text-sm",
            i === 0 ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2",
          )}
        >
          {o}
        </span>
      ))}
    </div>
  );
}

function ActionButton({ label }: { label: string }) {
  return (
    <span className="inline-flex h-10 items-center gap-1.5 rounded-md bg-ink px-4 text-sm font-medium text-paper">
      {label} <ArrowRight className="size-4" />
    </span>
  );
}

function LinkPreview() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-paper p-1.5 pl-3.5">
      <Link2 className="size-4 shrink-0 text-ink-3" />
      <span className="flex-1 truncate font-mono text-[13px] text-ink-3">https://…</span>
      <span className="inline-flex h-9 items-center rounded-[8px] bg-ink px-3.5 text-sm font-medium text-paper">Fetch</span>
    </div>
  );
}

function FilePreview({ tool }: { tool: Tool }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center rounded-md border border-dashed border-ink-3/50 bg-paper px-6 py-7 text-center sm:py-9">
        <span className="flex size-11 items-center justify-center rounded-md border border-line bg-surface text-ink-2">
          <FileUp className="size-5" />
        </span>
        <p className="mt-4 text-[15px] font-medium text-ink">Drop {tool.accept?.label ?? "files"} here</p>
        <p className="mt-1 text-sm text-ink-2">
          or <span className="underline decoration-line underline-offset-4">choose from your device</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Options options={tool.options} />
        <ActionButton label={stepsFor(tool)[2]} />
      </div>
    </div>
  );
}

function TextPreview({ tool }: { tool: Tool }) {
  return (
    <div className="space-y-4">
      <Options options={tool.options} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-36 rounded-md border border-line bg-paper p-4">
          <p className="label-mono text-ink-3">Your text</p>
          <p className="mt-3 font-mono text-[13px] text-ink-3">Paste or type here…</p>
        </div>
        <div className="hidden h-36 rounded-md border border-dashed border-line p-4 md:block">
          <p className="label-mono text-ink-3">Result</p>
        </div>
      </div>
      <div className="flex justify-end">
        <ActionButton label="Run" />
      </div>
    </div>
  );
}

function GeneratePreview({ tool }: { tool: Tool }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
      <div className="space-y-4">
        <div>
          <p className="label-mono text-ink-3">Content</p>
          <div className="mt-2 flex h-11 items-center rounded-md border border-line bg-paper px-3.5 font-mono text-[13px] text-ink-3">
            https://…
          </div>
        </div>
        <div>
          <p className="label-mono text-ink-3">Format</p>
          <div className="mt-2">
            <Options options={tool.options} />
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-28 items-center justify-center rounded-md border border-line bg-paper text-ink-3 sm:size-40">
          <tool.icon className="size-12 sm:size-16" strokeWidth={1.25} />
        </div>
        <ActionButton label="Download" />
      </div>
    </div>
  );
}
