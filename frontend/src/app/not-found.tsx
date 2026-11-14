import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/primitives";
import { Page } from "@/components/ui/paper";

export const metadata: Metadata = {
  title: "Page not found — Do-Whatever-You-Like",
  description: "This page doesn't exist. Browse every Do-Whatever-You-Like tool instead.",
};

export default function NotFound() {
  return (
    <Page className="pt-24 md:pt-36">
      <p className="label-mono text-ink-3">404 — Not found</p>
      <h1 className="text-display mt-6 max-w-[12ch] text-balance">
        Nothing to do <span className="serif-em text-accent">here.</span>
      </h1>
      <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-2">
        That page doesn&apos;t exist, or the tool has moved. Everything that works is in the toolbox.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/tools" size="lg" arrow>
          Open toolbox
        </ButtonLink>
        <ButtonLink href="/" size="lg" variant="secondary">
          Back home
        </ButtonLink>
      </div>
    </Page>
  );
}
