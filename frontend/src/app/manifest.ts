import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — Free Online Tools`,
    short_name: SITE_NAME,
    description:
      "Free online tools for PDF, images, file conversion, media downloads, audio transcription, developer and text utilities. No sign-up, nothing to install.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f0e8",
    theme_color: "#f3f0e8",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}

