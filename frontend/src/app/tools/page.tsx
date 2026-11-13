import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CLUSTERS, liveCount, toolsIn, tools } from "@/lib/tools";
import { SectionHeader } from "@/components/ui/primitives";
import { Page } from "@/components/ui/paper";
import { Reveal } from "@/components/ui/reveal";
import { ToolDirectory } from "@/components/sections/tool-directory";

export const metadata: Metadata = {
  title: "All tools — Do-Whatever",
  description:
    "Every Do-Whatever tool in one place: PDF, image, download, audio and video tools, all free with no sign-up.",
};

export default function ToolsPage() {
  const soon = tools.length - liveCount;
  // "30 PDF, 14 image, 3 download, 2 audio and video, and 3 utility tools"
  const parts = CLUSTERS.map((c) => `${toolsIn(c.id).length} ${c.noun}`);
  const summary = `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)} tools`;

  return (
    <Page className="pt-8 md:pt-10">
      <Link
        href="/"
        className="group -ml-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4 transition-transform duration-150 ease-out-soft group-hover:-translate-x-0.5" />
        Home
      </Link>

      <Reveal className="mt-10 md:mt-14">
        <SectionHeader
          index="00"
          label="Toolbox"
          title={
            <>
              Every tool, <span className="serif-em">one place.</span>
            </>
          }
          description={`${liveCount} tools work today${soon ? ` and ${soon} more are on the way` : ""}, in ${CLUSTERS.length} collections: ${summary}. Filter by what you want to do, or jump to a collection.`}
        />
      </Reveal>

      <ToolDirectory />
    </Page>
  );
}
