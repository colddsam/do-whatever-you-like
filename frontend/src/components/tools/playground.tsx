"use client";

import type { ComponentType } from "react";
import { getTool, type ToolKind } from "@/lib/tools";
import { ConvertPlayground } from "./convert-playground";
import { DownloaderPlayground } from "./downloader-playground";
import { PdfPlayground } from "./pdf-playground";
import { SoonWorkspace } from "./soon-workspace";

type Workspace = ComponentType<{ toolId: string }>;

/**
 * Where a live tool's workspace comes from.
 *
 * Adding an integration:
 * 1. Add the tool to `lib/tools.ts` with its `kind`, `takes`/`gives` and (optionally) `steps`.
 * 2. If its kind already has a workspace here, flip it to `live` and you're done.
 *    Otherwise build one inside `<Workbench>` and register it below, by kind or by id.
 *
 * Built-in workspaces and the config they read:
 * - link → DownloaderPlayground (`downloader`)
 * - file → ConvertPlayground (`converter`: one file in, one file out)
 * - pdf (by id) → PdfPlayground (merge, split and compress behind one mode switch)
 *
 * Anything not registered shows its kind's preview in SoonWorkspace.
 */
const byKind: Partial<Record<ToolKind, Workspace>> = {
  link: DownloaderPlayground,
  file: ConvertPlayground,
};
const byId: Record<string, Workspace> = {
  pdf: PdfPlayground,
};

export function Playground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const Live = tool.status === "live" ? (byId[tool.id] ?? byKind[tool.kind]) : undefined;
  // A kind's shared workspace needs that kind's config; without it, fall back to the preview.
  if (Live && !byId[tool.id] && tool.kind === "file" && !tool.converter) return <SoonWorkspace toolId={toolId} />;
  return Live ? <Live toolId={toolId} /> : <SoonWorkspace toolId={toolId} />;
}
