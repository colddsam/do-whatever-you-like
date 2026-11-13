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
    description: "Compress, resize, crop, convert and upscale images, remove backgrounds, add watermarks and make icons. Free, no sign-up.",
    intro:
      "Tools for pictures: make them smaller for the web, resize and crop them, convert between formats, cut out the background, upscale with AI, blur faces, add a watermark, or make a full set of icons. The meme generator and photo editor run entirely in your browser.",
  },
  developer: {
    title: "Free Developer Tools: Formatters, Hashes, DNS, JSON",
    description: "Format, minify and validate code, generate hashes and random data, query JSON and XML, and check DNS and HTTP. Free, in your browser.",
    intro:
      "Everyday tools for developers. Format and minify HTML, CSS, JavaScript, SQL and more; validate code; generate hashes, UUIDs and test data; query XML and JSON; and look up DNS records, headers and open ports. Most run entirely in your browser, so they're safe for private code and keys.",
  },
  text: {
    title: "Free Text Tools: Binary Translator, Number to Words, Morse",
    description: "Convert text to binary, hex and ASCII, spell numbers in words, translate Morse, summarise text and more. Free, in your browser.",
    intro:
      "Small tools for working with text: translate to and from binary, hex and ASCII codes, write numbers as words (with lakh and crore), convert Roman numerals, translate Morse code with sound, summarise long text, and flip, mirror or repeat text for posts.",
  },
  design: {
    title: "Free Font & Colour Tools: Font Checker, Font Maker, Colour Picker",
    description: "Check any font file, make your own font, and pick colours and palettes from images and documents. Free, no sign-up.",
    intro:
      "Tools for type and colour. Inspect a font file's glyphs, features and metadata; draw or build your own font and export it; and pick exact colours or a whole palette from a picture or document.",
  },
  downloads: {
    title: "Free Video Downloader: YouTube, Instagram, Facebook",
    description: "Save public YouTube videos and Shorts, Instagram Reels and carousels, and Facebook videos, or just their audio. Free, no sign-up.",
    intro:
      "Paste a link to save a public video or post, or just its sound. Downloads are fetched, sent to you and deleted straight away; nothing is kept. Only download content you own or have permission to use.",
  },
  media: {
    title: "Free Audio & Video Tools: Video to MP3, Audio to Text",
    description: "Pull MP3 audio out of any video, or transcribe speech to text and subtitles in 99 languages. Free, no sign-up.",
    intro:
      "Tools for sound: extract a clean MP3 from any video file, or turn speech from a recording or your microphone into editable text and SRT or VTT subtitles.",
  },
  utilities: {
    title: "Free Everyday Tools: QR Code Generator, My IP, Screen Size",
    description: "Make QR codes, see your IP address and screen resolution, test your webcam and measure pixels on screen. Free, no sign-up.",
    intro:
      "Handy everyday tools: make a styled QR code for a link, Wi-Fi or contact; see your public IP address; check your screen resolution and browser window size; test your webcam; and measure anything on screen with a pixel ruler.",
  },
};
