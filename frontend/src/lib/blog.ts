import { OPERATOR } from "@/lib/site";
import { liveCount } from "@/lib/tools";

export type BlogCategory = "Product" | "Engineering" | "Privacy" | "Guides";

export const BLOG_CATEGORIES: readonly BlogCategory[] = ["Product", "Engineering", "Privacy", "Guides"];

export type VideoChapter = {
  time: string;
  seconds: number;
  label: string;
};

export type BlogVideoData = {
  youtubeId: string;
  title: string;
  duration: string;
  isoDuration: string;
  uploadDate: string;
  poster: string;
  posterWidth: number;
  posterHeight: number;
  posterAlt: string;
  figureLabel: string;
  caption: string;
  note?: string;
  chapters: VideoChapter[];
};

export type BlogFigureData = {
  src: string;
  width: number;
  height: number;
  alt: string;
  figureLabel: string;
  caption: string;
  href?: string;
  linkLabel?: string;
};

export type RichSegment =
  | string
  | { label: string; href: string; external?: boolean }
  | { strong: string }
  | { code: string };

export type BlogBlock =
  | { type: "section"; id: string; index: string; heading: string }
  | { type: "subheading"; text: string }
  | { type: "paragraph"; text: string; lead?: boolean }
  | { type: "richParagraph"; segments: RichSegment[] }
  | { type: "video"; video: BlogVideoData }
  | { type: "figure"; figure: BlogFigureData }
  | { type: "figurePair"; figures: [BlogFigureData, BlogFigureData] }
  | { type: "collectionMatrix" }
  | { type: "toolGrid"; heading?: string; toolIds: string[] }
  | { type: "specTable"; caption: string; columns: [string, string, string]; rows: [string, string, string][] }
  | { type: "callout"; label: string; title: string; body: string }
  | { type: "list"; items: { title: string; detail: string; href?: string }[] };

export type BlogPost = {
  slug: string;
  issue: string;
  title: string;
  titleParts: { before: string; em: string; after?: string };
  subtitle: string;
  description: string;
  category: BlogCategory;
  tags: string[];
  publishedAt: string;
  updatedAt?: string;
  author: {
    name: string;
    role: string;
    url: string;
  };
  cover: {
    src: string;
    width: number;
    height: number;
    alt: string;
  };
  video?: BlogVideoData;
  blocks: BlogBlock[];
};

const LAUNCH_VIDEO: BlogVideoData = {
  youtubeId: "Ff1S_6-91dk",
  title: "Do-Whatever-You-Like: 76-second product walkthrough",
  duration: "01:16",
  isoDuration: "PT1M16S",
  uploadDate: "2026-11-17",
  poster: "/blog/3d-viewer.webp",
  posterWidth: 1920,
  posterHeight: 1200,
  posterAlt: "Do-Whatever-You-Like 3D model viewer and inspector workspace",
  figureLabel: "Fig. 01",
  caption: "76-second product walkthrough: task-intent search, Merge PDF, Image to SVG, WhatsApp chat analysis, animated charts and 3D inspection.",
  note: "Recorded 17 Nov 2026 before the 261-to-162 consolidation and before the Video editor, Pro photo editor and Smart notepad shipped.",
  chapters: [
    { time: "0:00", seconds: 0, label: "Intro" },
    { time: "0:13", seconds: 13, label: "Search + Merge PDF" },
    { time: "0:32", seconds: 32, label: "Logo to SVG + WhatsApp" },
    { time: "0:50", seconds: 50, label: "Charts & more tools" },
    { time: "1:06", seconds: 66, label: "Try it free" },
  ],
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "introducing-do-whatever-you-like",
    issue: "01",
    title: "162 tools, one sheet of paper, and zero sign-up walls",
    titleParts: {
      before: "162 tools, one sheet of paper, and",
      em: "zero",
      after: "sign-up walls",
    },
    subtitle:
      "How a two-week sprint on free hosting turned into 162 working utilities across 9 collections—including a 4K browser video studio, a layered PSD photo editor, and 103 tools that never send your files anywhere.",
    description:
      "162 free browser-first tools across 9 collections—4K video studio, PSD photo editor, PDFs, 112-format converter & 44 dev tools. No sign-up, no watermarks.",
    category: "Product",
    tags: ["Launch", "Browser-first", "Privacy", "Architecture"],
    publishedAt: "2026-11-22",
    // Bump only when the post itself changes (the update note at the top).
    updatedAt: "2026-11-27",
    author: {
      name: OPERATOR.name,
      role: "Creator & maintainer",
      url: OPERATOR.url,
    },
    cover: {
      src: "/blog/3d-viewer.webp",
      width: 1920,
      height: 1200,
      alt: "Do-Whatever-You-Like 3D model viewer inspecting a planetary gear GLB model",
    },
    video: LAUNCH_VIDEO,
    blocks: [
      {
        type: "callout",
        label: "Update · 27 Nov 2026",
        title: `Now ${liveCount} tools`,
        body: `This post describes the site on launch day, when it had 162 tools. Tools have been added since: ${liveCount} work today, across the same nine collections. Every number below is as of 22 November 2026; the Tools page always has the current list.`,
      },
      {
        type: "section",
        id: "why-we-built-it",
        index: "01",
        heading: "The five-minute chore problem",
      },
      {
        type: "paragraph",
        lead: true,
        text: "You only wanted to merge two PDFs before sending an email. Ten minutes later you have closed three cookie banners, hit a \"two files per day\" paywall, and been asked to verify an account just to download your own document without a watermark.",
      },
      {
        type: "paragraph",
        text: "Do-Whatever-You-Like started on 8 November 2026 to end that hunt. The goal was straightforward: put every everyday digital job—PDF work, image cleanup, file conversion, video editing, code formatting, translation, and quick calculators—behind one predictable three-step workbench with no accounts, no paywalls, and no watermarks.",
      },
      {
        type: "paragraph",
        text: "Two weeks later, 162 live tools across 9 collections are running in production on free hosting tiers (Vercel for the Next.js 16 front end and Render's 512 MB Docker tier for the FastAPI back end). Watch the 76-second walkthrough below to see the core search and file workflow in motion.",
      },
      {
        type: "video",
        video: LAUNCH_VIDEO,
      },
      {
        type: "section",
        id: "one-tool-per-job",
        index: "02",
        heading: "Why 261 pages became 162 tools",
      },
      {
        type: "paragraph",
        text: "Early on, it was tempting to ship a separate landing page for every minor variation of a task—one page for MD5, another for SHA-256, six separate document viewers, and twenty random generators. That pushed the directory to 261 pages in ten days, which looked impressive on paper and felt cluttered in practice.",
      },
      {
        type: "paragraph",
        text: "On 18 November we consolidated near-duplicates into unified workspaces: one hash generator for MD5, SHA, and CRC; one document viewer for Word, Excel, PowerPoint, CSV, ODF, and PDF; one data converter across JSON, CSV, YAML, XML, and TOML. That brought the toolbox down to 160 tools, with 108 permanent HTTP redirects preserving every old link and search result by opening the exact right mode via query parameters. Adding the Pro photo editor and Video editor brought today's directory to 162 live tools.",
      },
      {
        type: "richParagraph",
        segments: [
          "Every tool lives in one shared registry sorted into 9 collections. Instead of hunting through menus, pressing ",
          { code: "/" },
          " or ",
          { code: "⌘K" },
          " opens a task-intent search box: typing \"combine two pdfs\" or \"heic\" jumps straight to the matching workbench.",
        ],
      },
      {
        type: "collectionMatrix",
      },
      {
        type: "section",
        id: "browser-studios",
        index: "03",
        heading: "Three desktop-grade studios that never upload your files",
      },
      {
        type: "paragraph",
        text: "Most web toolboxes stop at single-button file converters. Once our core utilities stabilized, we wanted to see how far a modern browser could go without renting expensive GPU servers. Three full workspaces shipped in the second week, and all three execute locally on your machine.",
      },
      {
        type: "list",
        items: [
          {
            title: "Video editor — Premiere, After Effects & CapCut workflows in the browser",
            detail:
              "Multi-track timeline with Premiere trim tools (selection V, razor C, ripple B, roll N, slip Y, slide U, rate stretch R), 200-step undo, keyframed motion and cubic-Bézier curves, 46 WebGL2 GPU effects, 18 transitions, DaVinci-style 3-way colour wheels, monotone RGB tone curves, 8-band HSL mixer, live video scopes, .cube LUT export, 37 kinetic title animations, custom .ttf/.otf font uploads, chroma key with spill suppression, and direct project import from Premiere (.prproj, XML, EDL), CapCut (.capcut) and After Effects (.aep/.aepx, Lottie). Media stays in OPFS, Whisper auto-captions run locally across 99 languages via Transformers.js, and WebCodecs exports MP4, WebM, GIF or audio up to 4K.",
            href: "/tools/video-editor",
          },
          {
            title: "Pro photo editor — Layers, 3D LUTs & PSD read/write",
            detail:
              "Pixel, text, shape, vector-path and non-destructive adjustment layers across 17 blend modes, layer masks, layer styles, Camera Raw sliders, 22 live-thumbnail Looks, optical filters (35mm Halation, Pro-Mist Bloom, Perspective Keystone, Lens Distortion), symmetry painting, mosaic/censor brush, healing/clone tools with an OpenCV.js inpainting worker, Google & custom fonts, IndexedDB autosave and layered PSD read/write via ag-psd. Only AI background cut-outs and 2x/4x upscaling touch the server.",
            href: "/tools/pro-photo-editor",
          },
          {
            title: "Smart notepad — Paste anything, inspect what is hiding inside",
            detail:
              "Multi-tab scratchpad saved strictly in browser storage. Shows live counts, detects structured formats (JSON, CSV, Markdown), extracts emails, URLs, phone numbers and sums/averages of numbers, flags invisible zero-width characters, odd whitespace and broken brackets with one-click fixes, and runs undoable regex find-and-replace plus 30+ line transforms.",
            href: "/tools/notepad",
          },
        ],
      },
      {
        type: "richParagraph",
        segments: [
          "One subtle engineering detail makes the video studio work safely alongside the rest of the site: multi-threaded ONNX Runtime WASM needs ",
          { code: "SharedArrayBuffer" },
          ", which requires cross-origin isolation (",
          { code: "COOP: same-origin" },
          " and ",
          { code: "COEP: credentialless" },
          "). Scoping those headers strictly to ",
          { code: "/tools/video-editor" },
          " and ",
          { code: "/studio/*" },
          " in ",
          { code: "next.config.ts" },
          " unlocks local AI transcription without breaking third-party iframes or embeds anywhere else on the site.",
        ],
      },
      {
        type: "toolGrid",
        heading: "Open the flagship browser workspaces",
        toolIds: ["video-editor", "pro-photo-editor", "notepad"],
      },
      {
        type: "section",
        id: "files-and-vectors",
        index: "04",
        heading: "PDFs, 112 formats, and crisp vector tracing",
      },
      {
        type: "paragraph",
        text: "Document chores are where sketchy tool websites do the most damage—either shrinking pages silently, hiding text behind paywalls, or refusing to tell you the file size until after an upload finishes. On Do-Whatever-You-Like, every file tool shares a predictable three-step workbench: add files, pick options, preview and download with the exact byte size printed right on the button.",
      },
      {
        type: "paragraph",
        text: "Across PDFs (20 tools) and Any file (14 tools), you can merge, split by page range with live visual thumbnails, reorder/rotate on a board, redact text permanently, sign, add AES-256 passwords, run Tesseract OCR, compare revisions side-by-side, inspect Word/Excel/PowerPoint/CSV/ODF files in-browser, or convert across 112 formats using LibreOffice, Pandoc, PyMuPDF, FFmpeg and Pillow.",
      },
      {
        type: "figure",
        figure: {
          src: "/blog/merge-pdf.webp",
          width: 1920,
          height: 1080,
          alt: "Merge PDF workbench showing three reordered PDFs, inline preview button, and 164 KB exact download button",
          figureLabel: "Fig. 02",
          caption: "Merge PDF runs on our server for speed and keeps uploads up to 30 minutes so you can test options without re-uploading, showing exact merged output size before download.",
          href: "/tools/merge-pdf",
          linkLabel: "Open Merge PDF",
        },
      },
      {
        type: "paragraph",
        text: "On the image side, tasks that need heavy neural models (subject cut-outs and Real-ESRGAN 2x/4x upscaling) run on the server with before/after wipe sliders, while compression-free creative tools—like the Pro photo editor, Meme generator, Emoji rasterizer, GIF speed editor, and Image to SVG vectoriser—run directly on an HTML canvas in your browser.",
      },
      {
        type: "figure",
        figure: {
          src: "/blog/image-to-svg.webp",
          width: 1920,
          height: 1080,
          alt: "Image to SVG vectoriser tracing a raster mascot into 165 smooth Bézier paths in 23 KB",
          figureLabel: "Fig. 03",
          caption: "Image to SVG vectoriser uses k-means colour quantization and quadratic Bézier curve fitting locally on canvas—here tracing a 1080px PNG into 165 paths (23 KB).",
          href: "/tools/image-to-svg",
          linkLabel: "Try Image to SVG",
        },
      },
      {
        type: "section",
        id: "data-language-everyday",
        index: "05",
        heading: "Charts, 3D models, multilingual text, and 44 developer utilities",
      },
      {
        type: "paragraph",
        text: "Beyond files and media, the rest of the toolbox handles the technical and everyday jobs that normally require separate SaaS tabs. Chart maker renders 30 chart types with ECharts 6 and exports animated GIFs, videos, SVGs, PNGs, or self-contained interactive HTML files. The 3D model viewer loads GLB, GLTF, STL, OBJ (+MTL), FBX, PLY, 3MF, and ZIP assemblies with PBR shading, clay/wireframe/X-Ray modes, clipping slices, and mesh inspection.",
      },
      {
        type: "figurePair",
        figures: [
          {
            src: "/blog/chart-maker.webp",
            width: 1920,
            height: 1082,
            alt: "Chart maker workspace displaying 30 chart types, Studio colour palette, and animated column chart preview",
            figureLabel: "Fig. 04",
            caption: "Chart maker supports 30 chart families with replayable entry animations and lossless PNG, SVG, GIF, video and HTML export.",
            href: "/tools/chart-maker",
            linkLabel: "Open Chart maker",
          },
          {
            src: "/blog/3d-viewer.webp",
            width: 1920,
            height: 1200,
            alt: "3D model viewer inspecting a 9-part planetary gear GLB model with surface shading controls",
            figureLabel: "Fig. 05",
            caption: "3D model viewer & inspector parses GLB, STL, OBJ, FBX, PLY and 3MF right in WebGL with slicing planes and mesh trees.",
            href: "/tools/3d-viewer",
            linkLabel: "Open 3D viewer",
          },
        ],
      },
      {
        type: "paragraph",
        text: "Text and communication tools are built to handle scripts outside English cleanly. The WhatsApp chat analyzer uses Intl.Segmenter tokenization in browser memory so Hindi, Arabic RTL, CJK, Cyrillic, and emoji-heavy exports from iOS, Android, or Desktop all produce accurate timelines, reply-speed distributions, and searchable word counts without leaving your machine. When you need cross-language translation, the Translator workbench covers text, timestamp-preserving SRT/VTT subtitles, and full spoken audio/video dubbing across 99+ languages.",
      },
      {
        type: "figurePair",
        figures: [
          {
            src: "/blog/whatsapp-analyzer.webp",
            width: 1920,
            height: 1080,
            alt: "WhatsApp chat analyzer showing multilingual Devanagari word counts and top emojis locally in browser",
            figureLabel: "Fig. 06",
            caption: "WhatsApp chat analyzer parses .txt and .zip exports across Latin, Devanagari, Arabic RTL and CJK scripts entirely in browser memory.",
            href: "/tools/whatsapp-chat-analyzer",
            linkLabel: "Open WhatsApp analyzer",
          },
          {
            src: "/blog/translator.webp",
            width: 1920,
            height: 1028,
            alt: "Translator workbench auto-detecting English source text and translating into Hindi with speech playback",
            figureLabel: "Fig. 07",
            caption: "Translator handles plain text, SRT/VTT subtitles, and neural audio/video dubbing with copyable transcripts.",
            href: "/tools/translator",
            linkLabel: "Open Translator",
          },
        ],
      },
      {
        type: "paragraph",
        text: "For engineers, 44 developer tools cover 12-language code formatting/minification/validation, JSON and SQL to TypeScript/Zod/Pydantic/Go types, a local SQLite/CSV/Parquet SQL query viewer, Web Crypto hashing and HMAC, JWT inspection, regex/JSONPath/XPath testers, cron expressions, chmod math, and SSRF-checked public DNS, HTTP header, and port lookups. Everyday utilities round out the grid with customizable vector/print QR generation, EXIF metadata stripping, Indian GST & EMI/SIP calculators, an A4 invoice maker, and an on-device period tracker with optional AES-256 PIN locking.",
      },
      {
        type: "figurePair",
        figures: [
          {
            src: "/blog/qr-generator.webp",
            width: 1920,
            height: 1200,
            alt: "QR generator proof plate previewing a URL QR code with custom dot and eye shapes and contrast warnings",
            figureLabel: "Fig. 08",
            caption: "QR generator supports 9 payload types (URL, Wi-Fi, vCard, Geo, Event) with live scan-contrast checks and PNG, SVG, WebP, JPEG or print PDF output.",
            href: "/tools/qr",
            linkLabel: "Open QR generator",
          },
          {
            src: "/blog/period-tracker.webp",
            width: 1920,
            height: 1200,
            alt: "Private period tracker showing a 28-day cycle ring, fertile window indicator, and symptom chips stored locally",
            figureLabel: "Fig. 09",
            caption: "Period tracker keeps cycle history, predictions and symptom logs strictly on your device, with optional AES-256 PIN lock and encrypted local backups.",
            href: "/tools/period-tracker",
            linkLabel: "Open Period tracker",
          },
        ],
      },
      {
        type: "toolGrid",
        heading: "Jump straight into featured data & analysis tools",
        toolIds: ["chart-maker", "3d-viewer", "whatsapp-chat-analyzer", "sqlite-csv-parquet-viewer"],
      },
      {
        type: "section",
        id: "privacy-and-architecture",
        index: "06",
        heading: "Privacy by architecture, built on free tiers",
      },
      {
        type: "paragraph",
        text: "We set one strict budget rule from day one: the entire platform had to run sustainably on free hosting tiers—Next.js 16 + React 19 on Vercel Hobby, paired with a FastAPI + Python 3.13 Docker container on Render's free 512 MB instance.",
      },
      {
        type: "paragraph",
        text: "That memory ceiling turned out to be the best product decision we made. Because a 512 MB server cannot absorb concurrent 4K renders or Photoshop layer stacks, we pushed 103 of the 162 tools completely into the browser using WebGL2, WebCodecs, Web Audio, Canvas, OpenCV.js, and WebAssembly. Your videos, PSD layers, WhatsApp chats, SQLite databases, and cycle logs literally cannot leak from our server because they never arrive there.",
      },
      {
        type: "specTable",
        caption: "Execution breakdown across all 162 live tools",
        columns: ["Execution tier", "Live tools", "How your files are handled"],
        rows: [
          [
            "Browser-only (on your device)",
            "103 tools",
            "Files stay in browser memory, IndexedDB or OPFS. Zero server upload or storage.",
          ],
          [
            "Hybrid (Colour picker)",
            "1 tool",
            "Images are sampled locally on canvas; PDF/Office documents are extracted on the server and deleted immediately.",
          ],
          [
            "Isolated server (ephemeral)",
            "58 tools",
            "Magic-byte validated before opening, run in isolated subprocesses behind concurrency lanes, and deleted immediately after download (up to 30 min TTL for multi-step PDF editing).",
          ],
        ],
      },
      {
        type: "richParagraph",
        segments: [
          "Where a job genuinely needs server tools—PDF OCR via Tesseract, Office document conversion via LibreOffice, FFmpeg transcoding, Real-ESRGAN upscaling, or public DNS/HTTP checks—every upload passes client-side file sniffing and server-side magic-byte inspection (",
          { code: "415" },
          " on disguised executables) before entering a per-job temporary folder inside an isolated subprocess. To bypass Vercel's 4.5 MB request body limit without exposing our server token, the front end issues short-lived signed upload tickets for direct browser-to-Render transfers.",
        ],
      },
      {
        type: "callout",
        label: "Transparency notes",
        title: "Honest trade-offs: cold starts, optional free AI APIs & license",
        body: "First, Render's free instance sleeps after ~15 minutes of inactivity, so the first server-heavy request after a quiet spell can take 30–60 seconds; tools that run heavy queues carry a Beta badge, while the 103 browser tools start instantly. Second, optional cloud AI helpers are disclosed on each tool: Audio to Text and Translator may route through free-tier Groq Whisper when configured, Video editor's AI Director sends only timeline metadata (never media) to Gemini/Groq, and TTS uses free Edge voices. Third, the codebase is published on GitHub under a source-available license—free to inspect, learn from, and self-host for personal or non-commercial use (not an OSI open-source license).",
      },
      {
        type: "section",
        id: "whats-next",
        index: "07",
        heading: "What's next",
      },
      {
        type: "paragraph",
        text: "All 162 tools in the directory are live today, backed by 10 backend check suites, registry consistency verification, and headless Chromium layout checks across 320px phones through 1920px desktops. From here, our priorities are moving even more PDF and media utilities into WebAssembly so fewer jobs wait on a cold server, tightening mobile touch ergonomics, and building whatever tools people ask for most.",
      },
      {
        type: "richParagraph",
        segments: [
          "Try any workspace in the ",
          { label: "full 162-tool directory", href: "/tools" },
          ", read the source on ",
          { label: "GitHub", href: "https://github.com/colddsam/do-whatever-you-like", external: true },
          ", or tell us which everyday job is still missing using the ",
          { label: "Request a tool", href: "/#request" },
          " form on the home page.",
        ],
      },
    ],
  },
];

export const blogHref = (slug: string) => `/blog/${slug}`;

export function getAllPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

export function getAllCategories(): BlogCategory[] {
  const present = new Set(BLOG_POSTS.map((p) => p.category));
  return BLOG_CATEGORIES.filter((c) => present.has(c));
}

export function getAllTags(): string[] {
  return [...new Set(BLOG_POSTS.flatMap((p) => p.tags))];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Deterministic UTC date formatter ("22 Nov 2026") safe for Server Components and cacheComponents. */
export function formatBlogDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export type TocItem = {
  id: string;
  index: string;
  heading: string;
};

export function extractToc(post: BlogPost): TocItem[] {
  return post.blocks
    .filter((b): b is Extract<BlogBlock, { type: "section" }> => b.type === "section")
    .map((b) => ({ id: b.id, index: b.index, heading: b.heading }));
}

export function estimateWordCount(post: BlogPost): number {
  const parts: string[] = [post.title, post.subtitle];
  for (const b of post.blocks) {
    if (b.type === "section") parts.push(b.heading);
    else if (b.type === "subheading" || b.type === "paragraph") parts.push(b.text);
    else if (b.type === "richParagraph") {
      for (const s of b.segments) {
        if (typeof s === "string") parts.push(s);
        else if ("label" in s) parts.push(s.label);
        else if ("strong" in s) parts.push(s.strong);
        else if ("code" in s) parts.push(s.code);
      }
    } else if (b.type === "callout") parts.push(b.title, b.body);
    else if (b.type === "list") {
      for (const it of b.items) parts.push(it.title, it.detail);
    } else if (b.type === "specTable") {
      parts.push(b.caption, ...b.columns, ...b.rows.flat());
    } else if (b.type === "figure") {
      parts.push(b.figure.caption);
    } else if (b.type === "figurePair") {
      parts.push(b.figures[0].caption, b.figures[1].caption);
    }
  }
  return parts.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

export function estimateReadingMinutes(post: BlogPost): number {
  return Math.max(1, Math.round(estimateWordCount(post) / 220));
}
