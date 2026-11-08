import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
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
      <Navbar />
      <main id="main" className="flex-1">
        <Hero />
        <Marquee />
        <ToolsGrid />
        <HowItWorks />
        <Principles />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
