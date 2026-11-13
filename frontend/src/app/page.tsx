import { Hero } from "@/components/sections/hero";
import { Marquee } from "@/components/sections/marquee";
import { ToolsGrid } from "@/components/sections/tools-grid";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Principles } from "@/components/sections/principles";
import { Faq } from "@/components/sections/faq";
import { Cta } from "@/components/sections/cta";
import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import { liveCount } from "@/lib/tools";

export const metadata: Metadata = pageMeta({
  title: "Free Online Tools for PDF, Images, Video & Code — Do-Whatever",
  description:
    `${liveCount} free online tools with no sign-up: merge and compress PDFs, convert any file, compress images, download videos, transcribe audio and format code.`,
  path: "/",
});

export default function Home() {
  return (
    <>
      <Hero />
      <Marquee />
      <ToolsGrid />
      <HowItWorks />
      <Principles />
      <Faq />
      <Cta />
    </>
  );
}
