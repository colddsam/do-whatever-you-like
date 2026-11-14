import type { ClusterId } from "@/lib/tools";

/**
 * Copy for each collection's own page (/tools/category/<id>): the search title, the description
 * shown in results, and an opening paragraph. Counts are added where the page renders.
 */
export const HUBS: Record<ClusterId, { title: string; description: string; intro: string }> = {
  files: {
    title: "Free File Converter & Compressor Online",
    description: "Convert, compress, merge and split almost any file: documents, spreadsheets, slides, images, audio and video. Free, no sign-up.",
    intro:
      "Tools that work on any kind of file. The universal converter knows 112 formats, and the popular pairs (PDF to Word, Word to PDF, Video to MP3 and more) each have their own page. Compress, merge and split work across documents, images, audio and video.",
  },
  pdf: {
    title: "Free PDF Tools Online: Merge, Compress, Edit, Sign",
    description: "Merge, split, compress, edit, sign, protect, unlock and OCR PDFs online. Free, no sign-up, nothing to install.",
    intro:
      "Everything you need to do to a PDF, in one place. Organise pages, shrink files for email, turn images and web pages into PDF, edit and sign, add or remove passwords, and make scans searchable with OCR. PDFs are kept for at most 30 minutes after you last use them, then deleted.",
  },
  images: {
    title: "Free Image Tools Online: Compress, Resize, Remove Background",
    description: "Compress, resize, crop, pixelate, convert and upscale images, remove backgrounds, edit GIF speed, make emoji images and icons. Free, no sign-up.",
    intro:
      "Tools for pictures: make them smaller for the web, resize and crop them, convert between formats, cut out the background, upscale with AI, blur faces, pixelate regions, adjust GIF speed, render emojis as PNG/SVG, add a watermark, or make a full set of icons. The meme generator, photo editor, emoji maker, pixelator and GIF speed changer run entirely in your browser.",
  },
  developer: {
    title: "Free Developer Tools: Formatters, Hashes, DNS, JSON",
    description: "Format, minify and validate code, generate hashes and random data, query JSON and XML, and check DNS and HTTP. Free, in your browser.",
    intro:
      "Everyday tools for developers. Format and minify HTML, CSS, JavaScript, SQL and more; validate code; generate hashes, UUIDs and test data; query XML and JSON; and look up DNS records, headers and open ports. Most run entirely in your browser, so they're safe for private code and keys.",
  },
  text: {
    title: "Free Text Tools: Binary Translator, Number to Words, Morse",
    description: "Convert text to binary, hex and ASCII, find and replace, split text, spell numbers in words, decode Morse audio and summarise text. Free, in your browser.",
    intro:
      "Small tools for working with text: translate to and from binary, hex and ASCII codes, find and replace with regex, split text into lists, write numbers as words (with lakh and crore), convert Roman numerals, translate Morse code (and decode Morse audio), summarise long text, and flip, mirror or repeat text for posts.",
  },
  design: {
    title: "Free Chart, Flowchart, Font & Colour Tools Online",
    description: "Make charts and flowcharts, check WCAG contrast, generate CSS gradients and shadows, inspect or create fonts, and pick colours. Free, no sign-up.",
    intro:
      "Tools for diagrams, type and colour. Build bar, line, pie and scatter charts; draw flowcharts and Mermaid diagrams; check a font file's glyphs or make your own font; pick colours from any file; test WCAG AA/AAA contrast; and generate CSS gradients, box shadows and border radii.",
  },
  downloads: {
    title: "Free Video Downloader: YouTube, Instagram, Facebook",
    description: "Save public YouTube videos and Shorts, Instagram Reels and carousels, and Facebook videos, or just their audio. Free, no sign-up.",
    intro:
      "Paste a link to save a public video or post, or just its sound. Downloads are fetched, sent to you and deleted straight away; nothing is kept. Only download content you own or have permission to use.",
  },
  media: {
    title: "Free Audio & Video Tools: Trim, Denoise, Record, Subtitles, GIF",
    description: "Trim video and audio, remove background noise, boost volume, record screen and voice, edit SRT/VTT subtitles, extract MP3s, transcribe speech and make GIFs. Free, no sign-up.",
    intro:
      "Tools for audio and video: trim clips losslessly or frame-exact, clean up background hiss and hum, boost or normalise loudness, record your screen or voice, edit and sync SRT/VTT subtitles, extract MP3 audio, transcribe speech in 99 languages, or turn videos into still frames and animated GIFs.",
  },
  utilities: {
    title: "Free Everyday Tools: Period Tracker, Converters, Passwords & QR",
    description: "Private period tracker, unit and currency converters, strong password generator, encrypted notes, photo EXIF remover, QR tools and device tests. Free, no sign-up.",
    intro:
      "Handy everyday tools: track your period privately on your own device, convert units and 30 currencies, check world time zones, run a Pomodoro or stopwatch, calculate ages and dates, generate passphrases, encrypt private notes with AES-256, view or strip photo EXIF metadata, scan or create QR codes, crunch maths in a scientific calculator, and test your screen, webcam, mic and IP.",
  },
};
