"use client";

import type { ComponentType } from "react";
import { getTool, type ToolKind } from "@/lib/tools";
import { DownloaderPlayground } from "./downloader-playground";
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
 * Anything not registered shows its kind's preview in SoonWorkspace.
 */
const byKind: Partial<Record<ToolKind, Workspace>> = {
  link: DownloaderPlayground,
};
const byId: Record<string, Workspace> = {};

export function Playground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const Live = tool.status === "live" ? (byId[tool.id] ?? byKind[tool.kind]) : undefined;
  return Live ? <Live toolId={toolId} /> : <SoonWorkspace toolId={toolId} />;
}
