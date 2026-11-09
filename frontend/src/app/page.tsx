import { Hero } from "@/components/sections/hero";
import { Marquee } from "@/components/sections/marquee";
import { ToolsGrid } from "@/components/sections/tools-grid";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Principles } from "@/components/sections/principles";
import { Faq } from "@/components/sections/faq";
import { Cta } from "@/components/sections/cta";

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
