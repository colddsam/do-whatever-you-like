/**
 * The written guide under each tool: what it is for, how to use it, and the questions people ask.
 *
 * Every tool gets a how-to built from its spec (`howTo`). The most-used tools have a hand-written
 * guide (GUIDES), and the families that share one engine (hashes, random data, formatters,
 * minifiers, validators) get notes specific to each variant, so their pages don't read the same.
 *
 * Keep every claim true to the tool: limits, formats and retention come from lib/tools.ts and the
 * workspace footers. No FAQPage schema: these are for readers, not rich results.
 */
import { getUtility } from "@/lib/utilities/catalog";
import { stepsFor, type Tool } from "@/lib/tools";

export type Faq = { q: string; a: string };
export type Guide = {
  /** One to three paragraphs on what the tool does and when to use it. */
  intro: string[];
  faqs: Faq[];
  /** Tool ids worth suggesting next (rendered as links). */
  see?: string[];
};

/** The three steps, each with what it needs or gives, from the tool's own spec. */
export function howTo(tool: Tool): [string, string][] {
  const [a, b, c] = stepsFor(tool);
  const first = [tool.accept?.label ?? tool.takes, tool.limit].filter(Boolean).join(" · ");
  const second = tool.options?.length ? `Choose from ${tool.options.join(", ")}.` : "";
  return [
    [a, first ? `${first}.` : ""],
    [b, second],
    [c, `You get ${lowerFirst(tool.gives)}.`],
  ];
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(PDF|PNG|JPG|MP|SVG|ZIP|DOCX|CSV)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

const RETAIN_PDF = "Your PDF is kept on our server for 30 minutes after you last use it, so you can try other settings without uploading again. Then it's deleted.";
const RIGHTS = "Only download content you own or have permission to use. The tool works with public posts only: nothing private, paywalled or behind a login.";

const GUIDES: Record<string, Guide> = {
  "merge-pdf": {
    intro: [
      "Merge PDF joins 2 to 20 PDF files into one document, in the order you choose. Drag the files to reorder them, and the size of the combined file is shown before you merge, so there are no surprises.",
      "It's the quick way to put a scanned contract back together, attach receipts to a report, or send one file instead of ten.",
    ],
    faqs: [
      { q: "How many PDFs can I merge at once?", a: "Between 2 and 20 files, up to 150 MB in total." },
      { q: "Can I change the order of the files?", a: "Yes. Drag the files into the order you want before merging. The pages of each file stay in their original order." },
      { q: "Can I merge password-protected PDFs?", a: "No. Password-protected PDFs can't be opened. Remove the password with Unlock PDF first, if you're allowed to." },
      { q: "What happens to my files?", a: RETAIN_PDF },
    ],
    see: ["split-pdf", "organize-pdf", "compress-pdf", "unlock-pdf"],
  },
  "compress-pdf": {
    intro: [
      "Compress PDF makes a PDF smaller so it fits an email attachment or an upload limit. Pick Light, Balanced or Strong, or slide to any strength in between, and the predicted size updates as you move the slider.",
      "Text and vector drawings stay sharp at every strength, so a compressed document is still easy to read and print.",
    ],
    faqs: [
      { q: "Which strength should I pick?", a: "Start with Balanced. Use Light when quality matters most, and Strong when you need the smallest file and the PDF is mostly photos or scans." },
      { q: "Will the text still be selectable?", a: "Yes. Text and vector drawings are kept sharp, so text you could select before stays selectable." },
      { q: "Why didn't my PDF get much smaller?", a: "A PDF that is mostly text is already small. Compression saves the most on PDFs full of photos or scanned pages." },
      { q: "What happens to my file?", a: RETAIN_PDF },
    ],
    see: ["merge-pdf", "split-pdf", "compress-image", "pdf-to-word"],
  },
  "split-pdf": {
    intro: [
      "Split PDF breaks one PDF into several. Split every page into its own file, type page ranges like 1-3, 7, 10-12, or pick which pages go together on the page grid. The parts arrive together in one ZIP, and each part's size is shown before you split.",
    ],
    faqs: [
      { q: "How do I get every page as a separate PDF?", a: "Choose to split every page on its own. Each page becomes its own PDF inside the ZIP." },
      { q: "Can I take out just a few pages?", a: "Yes. Type the pages you want, or use Extract pages to save chosen pages as a single new PDF." },
      { q: "What happens to my file?", a: RETAIN_PDF },
    ],
    see: ["extract-pages", "remove-pages", "merge-pdf", "organize-pdf"],
  },
  "pdf-to-word": {
    intro: [
      "PDF to Word turns a PDF into a DOCX file you can edit in Microsoft Word, Google Docs or LibreOffice. Text, tables and images come across as editable content, and the layout is kept as closely as it can be.",
      "It works on PDFs that contain real text. A scanned PDF is just pictures of pages, so run it through OCR PDF first to make the text readable.",
    ],
    faqs: [
      { q: "Will the formatting be exactly the same?", a: "Close, but not always identical. PDFs place text at exact positions while Word flows it, so complex layouts can shift a little. Simple documents convert very cleanly." },
      { q: "Why is my converted document empty or full of images?", a: "The PDF is probably a scan. Use OCR PDF first, then convert the searchable PDF." },
      { q: "What happens to my file?", a: "It's converted on our server and deleted as soon as the result is sent." },
    ],
    see: ["ocr-pdf", "word-to-pdf", "edit-pdf", "convert-anything"],
  },
  "word-to-pdf": {
    intro: [
      "Word to PDF turns DOC, DOCX, ODT and RTF documents into PDF, keeping fonts, tables, images and layout. You can preview the PDF before you save it.",
      "A PDF looks the same on every device and can't be changed by accident, which is why CVs, invoices and forms are usually sent as PDF.",
    ],
    faqs: [
      { q: "Which formats can I convert?", a: "DOC, DOCX, ODT and RTF." },
      { q: "Do I need Microsoft Word installed?", a: "No. The conversion happens on our server, so it works on any phone, tablet or computer." },
      { q: "What happens to my file?", a: "It's converted on our server and deleted as soon as the result is sent." },
    ],
    see: ["pdf-to-word", "merge-pdf", "compress-pdf", "protect-pdf"],
  },
  "jpg-to-pdf": {
    intro: [
      "JPG to PDF puts up to 100 photos or images into one PDF. It takes JPG, PNG, WebP, GIF, BMP and TIFF. Choose A4, Letter or each image's own size, and drag the pages into order.",
      "Use it to send a set of scanned receipts, a photographed document, or a portfolio as one file.",
    ],
    faqs: [
      { q: "How many images can I add?", a: "Up to 100 images in one PDF." },
      { q: "Which page size should I use?", a: "A4 or Letter for printing and documents; the image's own size when you want each picture shown exactly as it is, with no margins." },
      { q: "Can I make the text in a photographed page searchable?", a: "Yes. Make the PDF here, then run it through OCR PDF." },
    ],
    see: ["scan-to-pdf", "ocr-pdf", "compress-pdf", "merge-pdf"],
  },
  "ocr-pdf": {
    intro: [
      "OCR PDF reads the text in a scanned PDF and adds it as an invisible layer, so you can search, select and copy it. The pages look exactly as they did before. It recognises over 100 languages, up to 5 at once, and handles PDFs of up to 300 pages.",
      "Pages that already contain text are left alone, so it's safe to run on a PDF that is only partly scanned.",
    ],
    faqs: [
      { q: "Which languages should I pick?", a: "Pick the languages the document is written in, up to 5. Choosing the right ones makes recognition noticeably more accurate." },
      { q: "Will the pages look different?", a: "No. The text layer is invisible; the scanned images stay exactly as they were." },
      { q: "Can I convert the result to Word?", a: "Yes. Once the PDF is searchable, PDF to Word can turn it into an editable document." },
      { q: "What happens to my file?", a: RETAIN_PDF },
    ],
    see: ["pdf-to-word", "scan-to-pdf", "compress-pdf", "jpg-to-pdf"],
  },
  "compress-image": {
    intro: [
      "Compress image makes JPG, PNG, GIF, WebP and SVG files smaller for websites, email and uploads. Choose Light (lossless), Recommended or Strong, and see the before and after size of every image.",
      "Animated GIFs stay animated. Camera data such as location and device details is removed unless you choose to keep it, which also saves a little space.",
    ],
    faqs: [
      { q: "What's the difference between the strengths?", a: "Light is lossless: the picture is unchanged, only stored more efficiently. Recommended and Strong save much more by simplifying detail you're unlikely to notice." },
      { q: "Does it remove location data from photos?", a: "Yes, camera data (EXIF), including location, is stripped unless you choose to keep it." },
      { q: "Can I compress several images at once?", a: "Yes. Add several images and each one shows its own before and after size." },
      { q: "What happens to my images?", a: "They're compressed on our server and deleted as soon as the result is sent." },
    ],
    see: ["resize-image", "convert-to-jpg", "crop-image", "compress-pdf"],
  },
  "remove-background": {
    intro: [
      "Remove background cuts out the subject of a photo — people, products or pets — on its own. Keep the background transparent, fill it with a solid colour, or blur it softly, then drag to compare before and after. It handles up to 10 images at once and saves PNG cut-outs, with no watermark.",
    ],
    faqs: [
      { q: "Do I need to select the subject?", a: "No. It finds people, products and pets automatically." },
      { q: "Why is the result a PNG?", a: "PNG keeps transparency, so the cut-out can sit on any background." },
      { q: "Is there a watermark?", a: "No. It's free, with no watermark." },
      { q: "What happens to my images?", a: "They're processed on our server and deleted as soon as the result is sent." },
    ],
    see: ["upscale-image", "crop-image", "resize-image", "photo-editor"],
  },
  "convert-anything": {
    intro: [
      "The universal converter turns almost any file into the format you need: documents, spreadsheets, slides, ebooks, data files, images, audio, video, subtitles, fonts and archives. It knows 112 formats in 15 families and more than 1,800 conversions between them.",
      "Add a file and it lists only the formats that file can actually become. Conversions run on our server using open-source programs such as LibreOffice, Pandoc and FFmpeg.",
    ],
    faqs: [
      { q: "How big can the file be?", a: "Up to 150 MB." },
      { q: "Why can't I pick a certain format?", a: "Only conversions that make sense for your file are offered. A video can become audio, but not a spreadsheet." },
      { q: "What happens to my file?", a: "It's converted on our server and deleted as soon as the result is sent." },
    ],
    see: ["pdf-to-word", "word-to-pdf", "audio", "compress-files"],
  },
  youtube: {
    intro: [
      "Paste a YouTube link to save a video or Short in the quality you pick, up to 1080p, with each option's size shown first. Or save just the sound as M4A (the original audio) or MP3. Videos up to 4 hours long are supported, and you see the title, channel and length before saving.",
      RIGHTS,
    ],
    faqs: [
      { q: "Which links work?", a: "Public youtube.com/watch, youtube.com/shorts and youtu.be links." },
      { q: "M4A or MP3?", a: "M4A is the original audio, untouched. MP3 is re-encoded but plays on absolutely everything." },
      { q: "Are downloads kept?", a: "No. The video is fetched into a temporary folder, sent to you, and deleted as soon as the download finishes." },
    ],
    see: ["instagram", "facebook", "audio", "audio-to-text"],
  },
  instagram: {
    intro: [
      "Paste an Instagram link, or just the post's shortcode, to save Reels, single posts and carousels. A carousel arrives as one ZIP with every photo and video, and a Reel's sound can be saved as MP3 or M4A.",
      RIGHTS,
    ],
    faqs: [
      { q: "Can I download from a private account?", a: "No. Only public posts work." },
      { q: "What's a shortcode?", a: "The letters after /p/ or /reel/ in the post's link. You can paste just that instead of the whole link." },
      { q: "Are downloads kept?", a: "No. Media is fetched into a temporary folder, sent to you, and deleted as soon as the download finishes." },
    ],
    see: ["youtube", "facebook", "audio", "compress-image"],
  },
  audio: {
    intro: [
      "Video to MP3 pulls the soundtrack out of a video and saves it as an MP3 that plays anywhere. It takes MP4, MOV, MKV, WebM, AVI, FLV and other video formats up to 150 MB. Pick 128, 192 or 320 kbps and listen before you save.",
    ],
    faqs: [
      { q: "Which quality should I choose?", a: "192 kbps is a good balance for music and speech. 320 kbps is the highest MP3 quality; 128 kbps makes the smallest file and is fine for voice." },
      { q: "Can I convert a YouTube video?", a: "Use the YouTube downloader instead: paste the link and save the audio directly." },
      { q: "What happens to my video?", a: "It's deleted from our server once the MP3 is sent." },
    ],
    see: ["audio-to-text", "youtube", "convert-anything", "compress-files"],
  },
  "audio-to-text": {
    intro: [
      "Audio to text turns speech into text with Whisper speech recognition, in 99 languages detected for you. Add audio or video up to 150 MB and 3 hours long, or record straight from your microphone, and watch the text appear as it's recognised.",
      "While it plays, the line being heard is highlighted so you can check it. Fix any line, translate the finished transcript into 100+ languages right inside the workspace, then copy either version or download TXT, SRT or VTT subtitles, or JSON.",
    ],
    faqs: [
      { q: "Which languages are supported?", a: "99 languages for speech recognition, plus 100+ languages when translating the finished transcript." },
      { q: "Can I make subtitles?", a: "Yes. Download SRT or VTT, the subtitle formats video players and YouTube accept." },
      { q: "How long can the recording be?", a: "Up to 3 hours and 150 MB." },
      { q: "Where is my recording processed?", a: "On our own server or through Groq's Whisper service; the tool tells you which. Either way, the recording is deleted afterwards." },
    ],
    see: ["translator", "subtitle-editor", "audio", "youtube"],
  },
  qr: {
    intro: [
      "Make a QR code for a link, plain text, Wi-Fi login, contact card, email, SMS, phone call, place or event. The preview updates as you type and is exactly what you'll download.",
      "Style it with dot and eye shapes, colours, gradients and a centre logo, then save PNG, SVG, WebP, JPEG or a print-ready PDF. It warns you before a design gets hard to scan.",
    ],
    faqs: [
      { q: "Do the codes expire?", a: "No. What you enter is stored in the code itself, with no redirect in between, so it works for as long as the link or details it holds do." },
      { q: "Which format should I download?", a: "SVG or PDF for print, since they stay sharp at any size. PNG for screens and documents." },
      { q: "Can I add my logo?", a: "Yes, a centre logo up to 10 MB. Keep it small so the code stays easy to scan." },
    ],
    see: ["icon-maker", "my-ip", "compress-image"],
  },
  "emoji-to-image": {
    intro: [
      "Turn any of 1,900 emoji into a crisp PNG, WebP, or SVG image at any size from 16 px to 2048 px. Pick between Noto, Twemoji, OpenMoji, or your device's native emoji style, with skin tone support.",
      "Everything renders right in your browser—keep a transparent background, add a solid backdrop, or download a full ZIP of icon sizes.",
    ],
    faqs: [
      { q: "Which emoji styles are included?", a: "Noto, Twemoji, OpenMoji, and your device's own system emoji." },
      { q: "Can I download a transparent PNG or SVG?", a: "Yes. Keep the background transparent and export as PNG, WebP, or the original SVG." },
      { q: "Is anything uploaded?", a: "No. Everything runs in your browser." },
    ],
    see: ["icon-maker", "text-to-image", "resize-image"],
  },
  "pixelate-image": {
    intro: [
      "Turn any picture into retro pixel art or censor part of a photo with a live preview. Choose square blocks, rounded blocks, dots, or mosaic tiles, and optionally snap colours to Game Boy, PICO-8, or CGA palettes.",
      "You can pixelate the whole image or select just a region, then export as PNG, JPG, or WebP without uploading your photo.",
    ],
    faqs: [
      { q: "Can I pixelate only part of an image?", a: "Yes. You can apply the effect to the entire image or target just a selected area." },
      { q: "Can I export true pixel-art dimensions?", a: "Yes, you can export at pixel-art size for sprites as well as full-resolution PNG, JPG, or WebP." },
      { q: "Does my image leave my device?", a: "No. Pixelation runs entirely in your browser." },
    ],
    see: ["blur-faces", "crop-image", "compress-image"],
  },
  "gif-speed": {
    intro: [
      "Speed up or slow down any animated GIF from 0.1× to 8×, or set a fixed delay per frame. You can also play the animation backwards, turn it into a boomerang, and adjust the loop count.",
      "Only the frame timing metadata is rewritten, so every pixel stays lossless and your GIF never leaves your browser.",
    ],
    faqs: [
      { q: "Does changing GIF speed reduce image quality?", a: "No. It's lossless—only the frame timing changes while every pixel stays intact." },
      { q: "Can I reverse or boomerang a GIF?", a: "Yes. You can reverse the frames, create a forward-and-back boomerang, and compare before and after side by side." },
      { q: "Is my GIF uploaded to a server?", a: "No. All processing happens locally in your browser." },
    ],
    see: ["video-to-gif", "compress-image", "crop-image"],
  },
  "video-to-frames": {
    intro: [
      "Extract still frames from any MP4, MOV, WebM, or M4V video right in your browser. Trim to the exact clip you need, then capture a fixed number of frames, one every few seconds, or N frames per second.",
      "Inspect the captured frames, pick the ones you want, and download them as a ZIP of JPG, PNG, or WebP images—or as a single contact sheet.",
    ],
    faqs: [
      { q: "How many frames can I extract?", a: "Up to 500 frames per run, trimmed to any part of your video." },
      { q: "Can I make a contact sheet?", a: "Yes. You can download individual frames in a ZIP or export a combined contact sheet." },
      { q: "Is my video uploaded?", a: "No. Your video stays on your device and is processed in your browser." },
    ],
    see: ["video-to-gif", "audio", "compress-image"],
  },
  "video-to-gif": {
    intro: [
      "Convert any short MP4, MOV, WebM, or M4V clip (up to 30 seconds) into a smooth animated GIF directly in your browser. Trim the exact moment with a live preview, then pick 5 to 25 fps and 240 to 800 px width.",
      "Adjust playback speed from 0.25× to 4×, turn on boomerang mode, or set looping, with an estimated size before and exact size after.",
    ],
    faqs: [
      { q: "How long can the video clip be?", a: "Up to 30 seconds of video per GIF." },
      { q: "Can I control the file size?", a: "Yes. Lowering the frame rate (5–25 fps) or width (240–800 px) shrinks the GIF, and you get a size estimate before exporting." },
      { q: "Does it upload my video?", a: "No. The GIF is created entirely in your browser." },
    ],
    see: ["gif-speed", "video-to-frames", "audio"],
  },
  "find-and-replace": {
    intro: [
      "Search and replace text in your browser with every match highlighted, counted, and shown with its line number. Toggle case matching, whole words, or full regular expressions with capture groups ($1).",
      "Smart case preservation can even match capitalization automatically—for example turning Fox into Cat and FOX into CAT.",
    ],
    faqs: [
      { q: "Does it support regular expressions?", a: "Yes. You can switch on regex mode and use capture groups like $1 in the replacement." },
      { q: "Is my text sent anywhere?", a: "No. Everything runs locally in your browser." },
    ],
    see: ["split-text", "line-tools", "regex-tester"],
  },
  "split-text": {
    intro: [
      "Split any block of text into clean pieces by lines, commas, spaces, sentences, words, characters, a custom separator, a regex, or every N characters.",
      "Tidy the result by trimming whitespace, dropping empty items, removing duplicates, or sorting, then copy it as lines, numbered items, JSON, CSV, or a quoted list.",
    ],
    faqs: [
      { q: "Can I convert a comma-separated list into JSON or lines?", a: "Yes. Split by commas, optionally trim and deduplicate, and export as lines, JSON, CSV, or a quoted list." },
      { q: "Does my text stay private?", a: "Yes. Splitting and formatting happen entirely in your browser." },
    ],
    see: ["find-and-replace", "line-tools", "json-formatter"],
  },
  "scientific-calculator": {
    intro: [
      "A full scientific calculator in your browser with trigonometry (degrees, radians, or gradians, including inverses and hyperbolics), logarithms, powers, roots, factorials, nCr, nPr, modulo, and percentages.",
      "It also keeps memory, Ans, and a reusable history, shows each result as a fraction, hex, and binary, and handles unit conversions like 5 inch to cm.",
    ],
    faqs: [
      { q: "Can I use my keyboard?", a: "Yes. Full keyboard input is supported alongside clicking the keypad." },
      { q: "Does it convert units too?", a: "Yes. You can type unit conversions directly, such as 5 inch to cm." },
    ],
    see: ["unit-converter", "number-to-words", "roman-numerals"],
  },
  "trim-media": {
    intro: [
      "Cut any video or audio file (MP4, MOV, MKV, WebM, MP3, WAV, M4A, and more up to 150 MB) to the exact start and end time you want. Drag the handles on a live preview or type exact timestamps.",
      "Use fast mode to trim without re-encoding, or exact mode to cut on the precise frame. Your file keeps its original format and is deleted from our server once sent.",
    ],
    faqs: [
      { q: "Does trimming reduce video or audio quality?", a: "Fast mode cuts without re-encoding, so it keeps the original quality. Exact mode re-encodes only when you need frame-accurate cuts." },
      { q: "What happens to my file?", a: "It is deleted from our server as soon as the trimmed file is sent." },
    ],
    see: ["audio-volume", "noise-remover", "video-to-gif"],
  },
  "noise-remover": {
    intro: [
      "Clean up background hiss, fan noise, traffic, room rumble, and 50/60 Hz mains hum from audio or a video's soundtrack (up to 150 MB). It learns the noise profile from the quietest moment—or a section you choose—and removes it.",
      "Switch between before and after while listening, keep your video's picture completely untouched, and download the cleaned file.",
    ],
    faqs: [
      { q: "Does it touch the video picture?", a: "No. Only the audio track is cleaned; the video stream is kept intact." },
      { q: "What kinds of noise can it remove?", a: "Steady hiss, fan and room noise, 50/60 Hz hum, and optionally clicks and pops." },
      { q: "Are uploaded files kept?", a: "No. Files are deleted from our server once the cleaned result is sent." },
    ],
    see: ["audio-volume", "trim-media", "audio-to-text"],
  },
  "audio-volume": {
    intro: [
      "Make any audio or video file (up to 150 MB) louder or quieter by up to 30 dB with a built-in limiter to prevent clipping, normalise loudness to -16 LUFS for podcasts and streaming, or mute a video completely.",
      "Preview the loudness change in your browser first; muting a video leaves its picture untouched without re-encoding.",
    ],
    faqs: [
      { q: "What does normalising to -16 LUFS mean?", a: "-16 LUFS is the standard integrated loudness target used by podcasts and streaming platforms so episodes play at a consistent volume." },
      { q: "Can I mute a video without losing quality?", a: "Yes. Muting removes the audio track without re-encoding the video stream." },
    ],
    see: ["noise-remover", "trim-media", "audio"],
  },
  "screen-recorder": {
    intro: [
      "Record your entire screen, a single window, or a browser tab with your microphone and system audio—or record just your voice—directly in your browser with no sign-up, no watermark, and no time limit.",
      "Pause and resume anytime, watch the live mic level meter, and save as MP4 or WebM video (or audio).",
    ],
    faqs: [
      { q: "Is my recording uploaded anywhere?", a: "No. Everything is recorded locally on your device unless you choose to convert an audio recording to MP3." },
      { q: "Is there a watermark or time limit?", a: "No. Recordings have no watermark and no artificial time limit." },
    ],
    see: ["trim-media", "audio-to-text", "mic-speaker-test"],
  },
  "subtitle-editor": {
    intro: [
      "Open an SRT or VTT subtitle file—or start from scratch—to fix typos, split or merge cues, translate captions into 100+ languages while keeping every timestamp intact, flag overlaps, convert frame rates (23.976, 25, 29.97 fps), and shift timing earlier or later.",
      "Preview your subtitles live on top of your own video, copy source or translated text, and export as SRT, VTT, or plain text.",
    ],
    faqs: [
      { q: "Can I shift all subtitles by a few seconds?", a: "Yes. You can offset every line or shift timing from a chosen line onward." },
      { q: "Can I translate captions without losing timestamps?", a: "Yes. Pick any target language to translate every cue while keeping start and end times unchanged, with one-click Restore original." },
      { q: "Does it upload my video or subtitles?", a: "Your video and cue editing stay in your browser; only caption text lines are sent if you click Translate captions." },
    ],
    see: ["translator", "audio-to-text", "trim-media", "video-to-frames"],
  },
  "chart-maker": {
    intro: [
      "Create publication-ready bar, grouped bar, stacked bar, line, area, pie, donut, and scatter charts in your browser. Paste data from Excel or CSV, edit cells directly, and customise colours, fonts, gridlines, data labels, and legends.",
      "Export crisp PNG, SVG, CSV, or PDF—everything stays on your device.",
    ],
    faqs: [
      { q: "Can I paste data from Excel or Google Sheets?", a: "Yes. Paste tabular data or CSV directly into the data table." },
      { q: "Which export formats are supported?", a: "PNG, scalable SVG, CSV data, and PDF." },
    ],
    see: ["flowchart-maker", "contrast-checker", "color-picker"],
  },
  "flowchart-maker": {
    intro: [
      "Build flowcharts, process maps, decision trees, org charts, and Mermaid diagrams in your browser. Drag 14 standard shapes onto the canvas or write Mermaid syntax, connect nodes with curved or orthogonal links, and animate the flow step by step.",
      "Export as PNG, SVG, animated SVG, or Mermaid text—no account required.",
    ],
    faqs: [
      { q: "Can I write Mermaid syntax instead of dragging shapes?", a: "Yes. You can start from a template, drag shapes visually, or edit in Mermaid text." },
      { q: "Can I export an animated diagram?", a: "Yes. You can animate links and export as PNG, SVG, animated SVG, or Mermaid." },
    ],
    see: ["chart-maker", "markdown-editor", "icon-maker"],
  },
  "contrast-checker": {
    intro: [
      "Check any text and background colour pair against WCAG 2.1 AA and AAA contrast ratios for normal text, large text, and UI components (3:1). Supports hex, rgb(), and hsl() with alpha transparency.",
      "If a pair fails, the checker suggests the nearest passing colour so you can fix accessibility issues in one click.",
    ],
    faqs: [
      { q: "What ratio is needed for WCAG AA and AAA?", a: "WCAG AA requires 4.5:1 for normal text and 3:1 for large text or UI components. AAA requires 7:1 for normal text and 4.5:1 for large text." },
      { q: "Does it handle semi-transparent colours?", a: "Yes. Alpha transparency is composited over the background before calculating the contrast ratio." },
    ],
    see: ["color-picker", "css-gradient-generator", "font-checker"],
  },
  "css-gradient-generator": {
    intro: [
      "Design linear, radial, and conic CSS gradients visually with any number of colour stops, angles, and positions. Preview the result live and copy clean, standard CSS in one click.",
    ],
    faqs: [
      { q: "Which gradient types are supported?", a: "Linear, radial, and conic CSS gradients with multiple colour stops." },
      { q: "Does it work in all modern browsers?", a: "Yes. It outputs standard CSS linear-gradient(), radial-gradient(), and conic-gradient() syntax." },
    ],
    see: ["box-shadow-generator", "border-radius-generator", "contrast-checker"],
  },
  "box-shadow-generator": {
    intro: [
      "Craft layered, soft, or crisp CSS box shadows with live controls for offset, blur, spread, colour, opacity, and inset mode. Stack multiple shadow layers and copy ready-to-paste CSS.",
    ],
    faqs: [
      { q: "Can I layer multiple shadows?", a: "Yes. You can combine multiple shadow layers for realistic depth." },
      { q: "Are inset shadows supported?", a: "Yes. Toggle inset on any shadow layer." },
    ],
    see: ["border-radius-generator", "css-gradient-generator", "contrast-checker"],
  },
  "border-radius-generator": {
    intro: [
      "Adjust all four corners together or individually, or switch to 8-value organic CSS blob shapes with a live preview. Copy the exact `border-radius` CSS rule in one click.",
    ],
    faqs: [
      { q: "Can I make organic CSS blob shapes?", a: "Yes. Use the 8-value border-radius controls to shape smooth organic blobs." },
      { q: "Can I control each corner separately?", a: "Yes. Toggle individual corner controls for asymmetric shapes." },
    ],
    see: ["box-shadow-generator", "css-gradient-generator", "crop-image"],
  },
  "json-formatter": {
    intro: [
      "Format, validate, minify, and inspect JSON right in your browser. Syntax errors point to the exact line and column, and you can browse nested objects as a collapsible tree, sort keys, or convert JSON to CSV.",
    ],
    faqs: [
      { q: "Is my JSON sent to a server?", a: "No. Parsing, formatting, and validation run 100% in your browser." },
      { q: "Can I convert JSON to CSV?", a: "Yes. Arrays of JSON objects can be exported directly as CSV." },
    ],
    see: ["jsonpath", "yaml-formatter", "diff-checker"],
  },
  "jwt-decoder": {
    intro: [
      "Decode any JSON Web Token (JWT) in your browser to inspect its header, payload claims, and expiration time in readable form. You can also verify HS256, HS384, and HS512 signatures with your secret.",
    ],
    faqs: [
      { q: "Is it safe to paste real JWTs here?", a: "Yes. Decoding and signature verification run locally in your browser—nothing is sent to any server." },
      { q: "Which signature algorithms can it verify?", a: "HS256, HS384, and HS512 HMAC signatures using your secret." },
    ],
    see: ["base64-encoder", "hmac-generator", "json-formatter"],
  },
  "base64-encoder": {
    intro: [
      "Encode text or files to Base64 and decode Base64 strings back to text or downloadable files in your browser. Supports standard and URL-safe Base64 (`base64url`) as well as `data:` URLs with image previews.",
    ],
    faqs: [
      { q: "Does it support URL-safe Base64?", a: "Yes. Switch between standard Base64 and URL-safe Base64url." },
      { q: "Can I preview decoded Base64 images?", a: "Yes. Image data URLs and Base64-encoded images preview right in the browser." },
    ],
    see: ["jwt-decoder", "url-encoder", "sha256-hash"],
  },
  "regex-tester": {
    intro: [
      "Test JavaScript regular expressions live with every match and capture group highlighted. Toggle global (`g`), case-insensitive (`i`), multiline (`m`), dotAll (`s`), and unicode (`u`) flags, and preview replacements using `$1` groups.",
    ],
    faqs: [
      { q: "Does it show capture groups?", a: "Yes. Every match and numbered capture group is highlighted." },
      { q: "Can I test find-and-replace patterns?", a: "Yes. Use the replacement preview with `$1` group references." },
    ],
    see: ["find-and-replace", "random-regex", "diff-checker"],
  },
  "timestamp-converter": {
    intro: [
      "Convert Unix timestamps (in seconds or milliseconds, auto-detected) to human-readable local, UTC, and ISO 8601 dates—or convert any date and time back to a Unix epoch timestamp.",
    ],
    faqs: [
      { q: "Does it detect seconds vs milliseconds?", a: "Yes. 10-digit seconds and 13-digit millisecond timestamps are detected automatically." },
      { q: "Can I see the current live Unix timestamp?", a: "Yes. The live current epoch timestamp updates in real time." },
    ],
    see: ["world-clock", "cron-explainer", "date-calculator"],
  },
  "diff-checker": {
    intro: [
      "Compare two blocks of text or code side by side or inline to spot every added, removed, and modified line or word. Optionally ignore whitespace or letter case—everything stays in your browser.",
    ],
    faqs: [
      { q: "Can I ignore whitespace or case differences?", a: "Yes. Toggle whitespace and case sensitivity options to focus on meaningful changes." },
      { q: "Is my code uploaded?", a: "No. Text comparison runs locally in your browser." },
    ],
    see: ["compare-pdf", "json-formatter", "find-and-replace"],
  },
  "cron-explainer": {
    intro: [
      "Translate any 5-field or 6-field cron expression (including day/month names and macros like `@daily`) into plain English and preview the next 8 scheduled run times in your local time zone or UTC.",
    ],
    faqs: [
      { q: "Does it support 6-field cron and macros?", a: "Yes. Both standard 5-field and 6-field expressions, names (MON, JAN), and macros (@daily, @hourly) are supported." },
      { q: "Can I check run times in UTC?", a: "Yes. Switch between your local time zone and UTC." },
    ],
    see: ["timestamp-converter", "world-clock", "regex-tester"],
  },
  "morse-audio-decoder": {
    intro: [
      "Decode Morse code beeps from an audio file (MP3, WAV, M4A, OGG), a video's audio track, or live through your microphone. It automatically detects tone pitch and speed from 5 to 50+ WPM, even with background noise or hand-keyed timing.",
    ],
    faqs: [
      { q: "Can I decode Morse live from a speaker?", a: "Yes. Use microphone mode and hold your device near the audio source." },
      { q: "Is the audio uploaded?", a: "No. Signal detection and decoding run locally in your browser." },
    ],
    see: ["morse-code", "audio-to-text", "mic-speaker-test"],
  },
  "unit-converter": {
    intro: [
      "Convert length, weight, temperature, area, volume, speed, data storage, time, energy, pressure, angle, and fuel economy across every unit at once in your browser.",
    ],
    faqs: [
      { q: "How many unit categories are supported?", a: "12 categories, showing conversions to every unit in that category simultaneously." },
      { q: "Can I convert currencies too?", a: "Yes. Use the Currency converter for 30 currencies at daily ECB reference rates." },
    ],
    see: ["currency-converter", "scientific-calculator", "date-calculator"],
  },
  "currency-converter": {
    intro: [
      "Convert between 30 world currencies using the European Central Bank's daily reference exchange rates. Type any amount to see instant conversions across currencies.",
    ],
    faqs: [
      { q: "Where do the exchange rates come from?", a: "They use the European Central Bank's daily reference rates." },
      { q: "Is it free to use?", a: "Yes, completely free with no sign-up." },
    ],
    see: ["unit-converter", "scientific-calculator", "number-to-words"],
  },
  "world-clock": {
    intro: [
      "Track the current time across any IANA city or time zone with automatic daylight saving adjustments, and use the meeting planner to pick a time in one city and see working hours, evenings, and nights everywhere else.",
    ],
    faqs: [
      { q: "Does it handle daylight saving time automatically?", a: "Yes. It uses standard IANA time zones with current DST rules." },
      { q: "Can I plan meetings across time zones?", a: "Yes. Pick a proposed time in any city to compare local hours across all added cities." },
    ],
    see: ["timestamp-converter", "date-calculator", "pomodoro-timer"],
  },
  "pomodoro-timer": {
    intro: [
      "Stay focused with 25-minute work intervals, short breaks, and long breaks, complete with a subtle chime and the remaining time shown right in your browser tab title so it keeps accurate time in the background.",
    ],
    faqs: [
      { q: "Does the timer keep running if I switch tabs?", a: "Yes. It tracks elapsed wall-clock time and updates your browser tab title." },
      { q: "Can I adjust focus and break lengths?", a: "Yes, you can customise work and break durations." },
    ],
    see: ["stopwatch", "world-clock", "date-calculator"],
  },
  stopwatch: {
    intro: [
      "Use a precision stopwatch with lap recording (highlighting your fastest and slowest laps) alongside a countdown timer with an audio alarm—all running locally in your browser tab.",
    ],
    faqs: [
      { q: "Does it highlight best and worst laps?", a: "Yes. Fastest and slowest lap splits are automatically marked." },
      { q: "Does the countdown timer play an alarm?", a: "Yes, it plays a chime when the countdown finishes." },
    ],
    see: ["pomodoro-timer", "world-clock", "date-calculator"],
  },
  "age-calculator": {
    intro: [
      "Calculate your exact age in years, months, and days—plus total days lived and a countdown to your next birthday—right in your browser, handling leap years and varying month lengths accurately.",
    ],
    faqs: [
      { q: "Does it handle leap-year birthdays?", a: "Yes. Leap years and varying month lengths are handled accurately." },
      { q: "Can I calculate days between two arbitrary dates?", a: "Yes. Use the Date calculator for spans, business days, and adding or subtracting days." },
    ],
    see: ["date-calculator", "world-clock", "timestamp-converter"],
  },
  "date-calculator": {
    intro: [
      "Find the exact days, weeks, and business days between any two dates, or add and subtract days, weeks, months, years, or working days from a starting date—all in your browser.",
    ],
    faqs: [
      { q: "Can it count business days only?", a: "Yes. Both date-difference and add/subtract modes support business days." },
      { q: "Are leap years handled?", a: "Yes, calendar leap years and month-end rules are handled automatically." },
    ],
    see: ["age-calculator", "world-clock", "timestamp-converter"],
  },
  "password-generator": {
    intro: [
      "Generate cryptographically random passwords or memorable Diceware passphrases from the EFF's 7,776-word list, or test an existing password's entropy in bits, estimated crack time, and common-pattern weaknesses.",
    ],
    faqs: [
      { q: "Is my password sent to any server?", a: "No. Generation (via Web Crypto) and strength checking run 100% locally in your browser." },
      { q: "What is a passphrase?", a: "A sequence of random dictionary words (from the EFF 7,776-word list) that is easier to type and remember than random symbols while staying high-entropy." },
    ],
    see: ["encrypt-note", "sha256-hash", "random-string"],
  },
  "encrypt-note": {
    intro: [
      "Encrypt a private note or message in your browser using AES-256-GCM with a PBKDF2 key (600,000 rounds), then share it as encrypted text or a `#`-fragment link that never sends your note or password to any server.",
    ],
    faqs: [
      { q: "Can the server read my encrypted note or link?", a: "No. Encryption happens in your browser, and shareable links put the ciphertext after the `#` URL fragment, which browsers never send to servers." },
      { q: "What encryption standard is used?", a: "AES-256-GCM authenticated encryption with PBKDF2-SHA256 (600,000 iterations)." },
    ],
    see: ["password-generator", "sha256-hash", "base64-encoder"],
  },
  "exif-remover": {
    intro: [
      "Inspect hidden EXIF, GPS location (plotted on a map), camera, lens, software, and serial number metadata inside your photos—then strip it losslessly from JPG, PNG, and WebP images without re-compression.",
    ],
    faqs: [
      { q: "Does removing EXIF metadata reduce photo quality?", a: "No. Metadata is stripped losslessly from JPG, PNG, and WebP without re-compressing pixels, while keeping orientation and colour profiles intact." },
      { q: "Are my photos uploaded?", a: "No. Metadata inspection and removal run locally in your browser." },
    ],
    see: ["compress-image", "blur-faces", "pixelate-image"],
  },
  "qr-scanner": {
    intro: [
      "Decode any QR code directly in your browser by uploading an image, pasting a screenshot, or scanning live with your phone or laptop camera. Recognises URLs, Wi-Fi logins, contacts, email, phone numbers, and locations.",
    ],
    faqs: [
      { q: "Can I paste a screenshot directly?", a: "Yes. Paste an image from your clipboard, upload a file, or use your camera." },
      { q: "Is the scanned image uploaded?", a: "No. QR decoding runs entirely in your browser." },
    ],
    see: ["qr", "webcam-test", "exif-remover"],
  },
  "mic-speaker-test": {
    intro: [
      "Test your microphone with a live audio level meter and verify your left and right speakers or headphones directly in your browser—no downloads or recordings stored.",
    ],
    faqs: [
      { q: "Is my microphone audio recorded or uploaded?", a: "No. Audio is analysed locally in your browser solely for the live level meter." },
      { q: "Can I test left and right stereo channels separately?", a: "Yes. You can play test tones to the left channel, right channel, or both." },
    ],
    see: ["webcam-test", "screen-recorder", "audio-to-text"],
  },
  "dead-pixel-test": {
    intro: [
      "Display full-screen solid colours (red, green, blue, black, white, and more) to spot dead pixels, stuck pixels, or backlight bleed on any monitor or phone screen, plus an optional rapid colour flasher to try unstucking stuck pixels.",
    ],
    faqs: [
      { q: "What is the difference between a dead and a stuck pixel?", a: "A dead pixel stays permanently black, while a stuck pixel remains lit in red, green, blue, or white and can sometimes be revived by rapid colour cycling." },
      { q: "How do I exit full-screen mode?", a: "Press Esc or tap/click the exit control." },
    ],
    see: ["screen-resolution", "pixel-ruler", "webcam-test"],
  },
  "period-tracker": {
    intro: [
      "Log your period with one tap, track flow, symptoms, mood, pain, and daily notes, and see your next period, fertile window, and ovulation predictions learnt from your own cycle history—with a confidence indicator and gentle notes when something may be worth asking a doctor about.",
      "Everything stays strictly on your device in your browser's local storage, with an optional AES-256 PIN lock, discreet calendar reminders, JSON backups, and one-tap delete-all.",
    ],
    faqs: [
      { q: "Is my period data sent to any server?", a: "No. Everything is stored locally on your device—nothing is uploaded, and there is no account." },
      { q: "Can I lock it with a PIN?", a: "Yes. You can enable an optional PIN lock encrypted with AES-256 on your device." },
      { q: "Can I back up or delete all my data?", a: "Yes. Export a JSON backup anytime to move between devices, or erase everything with one tap." },
    ],
    see: ["date-calculator", "age-calculator", "encrypt-note"],
  },
  translator: {
    intro: [
      "Translate plain text, SRT/VTT subtitle files, spoken audio recordings, microphone voice notes, and videos between 100+ languages with automatic language detection.",
      "In Text mode you get a clean copyable source and translation view without extra media clutter. For Audio and Video, the speech is transcribed, translated, dubbed into a downloadable translated audio or video file (with optional quiet background audio and soft captions), and returned with both original and translated transcripts ready to copy.",
    ],
    faqs: [
      { q: "Is this completely free with no paid API keys required?", a: "Yes. Everything runs on free endpoints, Whisper speech recognition, and free neural voices with zero paid subscriptions required." },
      { q: "What do I get when translating audio or video?", a: "You get the dubbed translated audio or video file to preview and download, plus both the original spoken transcript and the translated text with dedicated Copy buttons and TXT/SRT/VTT downloads." },
      { q: "What happens to uploaded files?", a: "Uploads are processed in an isolated temporary workspace that is deleted right after dubbing; the downloadable result stays cached briefly so you can save it and expires automatically." },
    ],
    see: ["audio-to-text", "subtitle-editor", "whatsapp-chat-analyzer"],
  },
  "whatsapp-chat-analyzer": {
    intro: [
      "Upload an exported WhatsApp .txt or .zip file (or paste chat lines directly) to explore message volume, active participants, reply speed, conversation starters, a 7×24 hour activity heatmap, top emojis, recurring words across scripts, and shared links.",
      "Everything is parsed and analyzed locally inside your browser—nothing is sent to any server, and it works free of charge with exports from iOS, Android, and Desktop in any language or script (Latin, Hindi/Devanagari, Arabic RTL, CJK, Cyrillic, accents, and emojis).",
    ],
    faqs: [
      { q: "Is my WhatsApp chat sent to your server?", a: "No. ZIP extraction, parsing, charts, search, and exports all run locally in your browser. Your messages never leave your device." },
      { q: "Which WhatsApp export formats and languages work?", a: "Both iOS [date, time] and Android date, time - exports (as .txt or .zip with media), 12h/24h clocks, DMY/MDY/YMD date order (auto-detected with manual override), localized AM/PM and digits, RTL Arabic/Hebrew, Hindi, CJK, and emojis." },
      { q: "Can I export the statistics?", a: "Yes. Download full JSON analytics, Excel-ready UTF-8 CSV tables, a self-contained printable HTML report, or copy a text summary." },
    ],
    see: ["text-summarizer", "diff-checker", "chart-maker"],
  },
};

/* ---------- Families that share one engine: a note specific to each variant ---------- */

type HashInfo = { bits?: number; what: string; use: string; secure: string };
const HASHES: Record<string, HashInfo> = {
  md5: { bits: 128, what: "MD5 is a 1992 hash function that turns any input into a 128-bit digest.", use: "Still common for file checksums and cache keys.", secure: "No. Collisions can be made deliberately, so don't use MD5 for passwords, signatures or anything an attacker could tamper with." },
  sha1: { bits: 160, what: "SHA-1 produces a 160-bit digest and was the standard hash for years.", use: "Still seen in older systems and Git object IDs.", secure: "No. A practical collision was published in 2017. Use SHA-256 for anything new." },
  sha224: { bits: 224, what: "SHA-224 is a member of the SHA-2 family: SHA-256 with different starting values, cut to 224 bits.", use: "Used where a shorter SHA-2 digest is needed.", secure: "Yes, for integrity checks and signatures. For passwords, use a slow password hash instead." },
  sha256: { bits: 256, what: "SHA-256 is the most widely used SHA-2 hash, producing a 256-bit digest.", use: "Used for download checksums, TLS certificates, code signing and Bitcoin.", secure: "Yes. It's the safe default for integrity checks. For storing passwords, use a slow password hash such as bcrypt or Argon2 instead." },
  sha384: { bits: 384, what: "SHA-384 is SHA-512 with different starting values, cut to 384 bits.", use: "Common in TLS cipher suites and high-assurance signatures.", secure: "Yes." },
  sha512: { bits: 512, what: "SHA-512 is the largest SHA-2 hash, producing a 512-bit digest.", use: "Often faster than SHA-256 on 64-bit processors, and used where a longer digest is wanted.", secure: "Yes." },
  "sha512-224": { bits: 224, what: "SHA-512/224 runs SHA-512's 64-bit internals and cuts the result to 224 bits.", use: "A shorter digest that's fast on 64-bit machines.", secure: "Yes." },
  "sha512-256": { bits: 256, what: "SHA-512/256 runs SHA-512's 64-bit internals and cuts the result to 256 bits.", use: "A SHA-256-sized digest that's often faster on 64-bit machines.", secure: "Yes." },
  "sha3-224": { bits: 224, what: "SHA3-224 belongs to SHA-3 (FIPS 202, 2015), built on the Keccak sponge — a different design from SHA-2.", use: "A backup standard in case SHA-2 is ever weakened.", secure: "Yes." },
  "sha3-256": { bits: 256, what: "SHA3-256 is the 256-bit SHA-3 hash, built on the Keccak sponge rather than SHA-2's design.", use: "Used where a standard alternative to SHA-256 is wanted. Note it differs from the original Keccak-256 used by Ethereum.", secure: "Yes." },
  "sha3-384": { bits: 384, what: "SHA3-384 is the 384-bit SHA-3 hash, built on the Keccak sponge.", use: "A SHA-3 counterpart to SHA-384.", secure: "Yes." },
  "sha3-512": { bits: 512, what: "SHA3-512 is the largest fixed-size SHA-3 hash, built on the Keccak sponge.", use: "A SHA-3 counterpart to SHA-512.", secure: "Yes." },
  shake128: { what: "SHAKE-128 is an extendable-output function from the SHA-3 standard: you choose how long the output is.", use: "Used in newer cryptographic designs that need output of a custom length.", secure: "Yes, with 128-bit security when the output is long enough." },
  shake256: { what: "SHAKE-256 is an extendable-output function from the SHA-3 standard with a higher security level than SHAKE-128.", use: "Used in post-quantum schemes and anywhere a custom-length digest is needed.", secure: "Yes, with 256-bit security when the output is long enough." },
  md2: { bits: 128, what: "MD2 is a 1989 hash function for 8-bit computers, producing a 128-bit digest.", use: "Only for checking old systems and certificates that still use it.", secure: "No. It's obsolete and should not be used for anything new." },
  md4: { bits: 128, what: "MD4 is a 1990 hash function and the ancestor of MD5, producing a 128-bit digest.", use: "Mainly of interest because Windows NTLM password hashes are built on it.", secure: "No. It's badly broken." },
  ntlm: { bits: 128, what: "An NTLM (NT) hash is MD4 of the password encoded as UTF-16LE. It's how Windows has stored local passwords.", use: "Useful for testing and checking Windows authentication setups.", secure: "No. It's unsalted and fast, so it's easy to crack. Only hash passwords you're allowed to test." },
  crc16: { bits: 16, what: "CRC-16 is a 16-bit cyclic redundancy check, a checksum for catching accidental errors.", use: "Used in serial protocols, Modbus and storage formats.", secure: "No. CRCs detect accidental corruption, not tampering." },
  crc32: { bits: 32, what: "CRC-32 is a 32-bit cyclic redundancy check.", use: "Used in ZIP archives, PNG images and Ethernet to catch accidental corruption.", secure: "No. CRCs detect accidental corruption, not tampering." },
};

function hashGuide(tool: Tool, alg: string): Guide | undefined {
  const h = HASHES[alg];
  if (!h) return undefined;
  const name = tool.name.replace(/ (hash generator|checksum)$/, "");
  return {
    intro: [`${h.what} ${h.use}`, "Type or paste text, or add a file, and the hash is worked out in your browser. Nothing you enter is sent anywhere."],
    faqs: [
      ...(h.bits ? [{ q: `How long is a ${name} hash?`, a: `${h.bits} bits, written as ${h.bits / 4} hexadecimal characters.` }] : []),
      { q: `Is ${name} secure?`, a: h.secure },
      { q: "Can a hash be reversed?", a: "No. A hash is one-way. The only way back is guessing inputs until one matches, which is why weak or unsalted hashes of short passwords can be cracked." },
    ],
    see: alg === "md5" ? ["sha256-hash", "sha1-hash", "crc32-hash"] : alg.startsWith("sha3") ? ["sha256-hash", "sha3-512-hash", "hmac-generator"] : ["sha256-hash", "sha512-hash", "hmac-generator"],
  };
}

const RANDOM: Record<string, string> = {
  names: "Draw one or more names fairly from a list: raffle winners, who goes first, or teams.",
  string: "Random strings from the characters you choose, for test data, temporary passwords and identifiers.",
  alnum: "Random letters and digits, for coupon codes, reference numbers and IDs.",
  letters: "Random letters of the alphabet, for word games, classroom activities and test data.",
  integer: "Whole numbers in the range you set, for dice rolls, draws and sampling.",
  decimal: "Decimal numbers in a range with the precision you set, for simulations and test data.",
  fraction: "Random fractions, for maths practice and test data.",
  prime: "Random prime numbers, for maths, teaching and testing number code.",
  hex: "Random hexadecimal strings, for tokens, colour codes and test IDs.",
  binary: "Random strings of 0s and 1s, for teaching, testing and bit patterns.",
  bytes: "Random bytes, for keys, salts and test files.",
  date: "Random dates in a range, for test data, scheduling practice and birthdays in sample records.",
  time: "Random times of day, for test data and scheduling.",
  ip: "Random IPv4 or IPv6 addresses, for test data, logs and documentation.",
  mac: "Random MAC addresses, for test data and device simulation.",
  json: "Random JSON records, for mocking an API or filling a test database.",
  csv: "Random CSV rows, for spreadsheet testing and sample data.",
  tsv: "Random tab-separated rows, for spreadsheet testing and sample data.",
  xml: "Random XML documents, for testing parsers and feeds.",
  regex: "Random strings that match a regular expression, for testing validators and filling forms.",
  bitmap: "A random noise image, for textures, placeholders and testing.",
};

/** Roughly what one result looks like, so each page shows its own kind of output. */
const RANDOM_LOOKS: Record<string, string> = {
  names: "One or more names drawn from the list you paste, such as the winner of a raffle.",
  string: "Something like kQ7#vP2!xZ, from the character sets you tick.",
  alnum: "Something like X7k2P9qA, from the letters and digits you tick.",
  letters: "Letters such as M, Q and B, one after another or as a string.",
  integer: "A whole number such as 17, anywhere in the range you set, ends included.",
  decimal: "A number such as 3.1416, with as many decimal places as you ask for.",
  fraction: "A fraction such as 7/12.",
  prime: "A prime such as 7919, within the range you set.",
  hex: "Something like 9f3a1c7e: digits 0-9 and letters a-f.",
  binary: "Something like 10110011.",
  bytes: "Bytes written as hex pairs, such as a3 1f 9c 04.",
  date: "A calendar date between the two you set.",
  time: "A time of day such as 14:37:05.",
  ip: "An address such as 203.0.113.42, or an IPv6 address.",
  mac: "An address such as 3c:22:fb:1a:9e:07.",
  json: "An array of JSON objects with the fields you choose, ready to paste into a test.",
  csv: "Rows of comma-separated values with a header row, ready to open in a spreadsheet.",
  tsv: "Rows of tab-separated values, which paste straight into spreadsheet columns.",
  xml: "An XML document of repeated records.",
  regex: "Strings that match your pattern: for [A-Z]{3}[0-9]{2}, something like QWE42.",
  bitmap: "An image of random pixels you can download.",
};

function randomGuide(tool: Tool, kind: string): Guide | undefined {
  const use = RANDOM[kind];
  if (!use) return undefined;
  return {
    intro: [use, "Results are made in your browser with crypto.getRandomValues, the browser's cryptographically secure generator, so every value is equally likely and nothing is sent anywhere."],
    faqs: [{ q: `What does a result look like?`, a: RANDOM_LOOKS[kind] ?? use }],
    see: ["random-integer", "random-string", "random-name-picker"].filter((id) => id !== tool.id),
  };
}

const LANGS: Record<string, string> = {
  html: "HTML is the markup every web page is written in.",
  css: "CSS sets how web pages look: layout, colours and type.",
  javascript: "JavaScript is the programming language of the web, in browsers and in Node.js.",
  typescript: "TypeScript is JavaScript with types, compiled to plain JavaScript.",
  jsx: "JSX is the HTML-like syntax React components are written in.",
  angular: "Angular templates are HTML with Angular's bindings and control flow.",
  xml: "XML is a markup language for structured data, used in feeds, configs and office files.",
  php: "PHP is a server-side language that powers WordPress and much of the web.",
  java: "Java is a typed, compiled language used for back-end services and Android apps.",
  sql: "SQL is the language for querying and changing data in relational databases.",
  yaml: "YAML is an indentation-based format for configuration files, such as Docker Compose, Kubernetes and CI pipelines.",
  markdown: "Markdown is plain text with light formatting, used in READMEs, docs and notes.",
};

/** What minifying actually does to each language (the engines named in the tools' descriptions). */
const MINIFY: Record<string, Faq> = {
  html: { q: "What gets removed from HTML?", a: "Comments and the spaces and line breaks between tags that don't change how the page renders. Text content and attributes are kept." },
  css: { q: "What does CSS minification change?", a: "csso removes comments and whitespace, then restructures: it merges duplicate rules and selectors, shortens colours (#ffffff to #fff) and drops units from zero values. The styles behave exactly the same." },
  javascript: { q: "What does Terser do to JavaScript?", a: "It removes comments and whitespace, renames local variables to short names (mangling) and drops code that can never run. Global names and behaviour are kept." },
};

function codeGuide(tool: Tool, engine: string, lang: string): Guide | undefined {
  const about = LANGS[lang];
  if (!about) return undefined;
  const label = tool.name.replace(/ (formatter|minifier|validator)$/i, "");
  const what =
    engine === "format"
      ? `Paste ${label} and it's re-indented and laid out consistently, so it's easier to read, review and diff.`
      : engine === "minify"
        ? `Paste ${label} and it's made as small as possible by removing comments, spaces and anything else the computer doesn't need, so pages load faster.`
        : `Paste ${label} and it's checked for syntax errors, with any problems pointed out.`;
  return {
    intro: [`${about} ${what}`, "It runs in your browser, so nothing you paste is sent anywhere."],
    faqs: [
      engine === "minify"
        ? (MINIFY[lang] ?? { q: "Can minified code be turned back?", a: "It can be re-formatted to be readable again, but comments are gone for good. Keep your source and minify a copy." })
        : engine === "format"
          ? { q: `Will formatting change what my ${label} does?`, a: "No. Only spacing, indentation and line breaks change." }
          : { q: `What does valid ${label} mean here?`, a: "That the syntax is correct and it will parse. It doesn't check that the code does what you meant." },
    ],
  };
}

/** The written guide for a tool, if there is one. */
export function guideFor(tool: Tool): Guide | undefined {
  if (GUIDES[tool.id]) return GUIDES[tool.id];
  const u = getUtility(tool.id);
  if (!u?.preset) return undefined;
  if (u.engine === "hash" && !u.preset.hmac) return hashGuide(tool, u.preset.alg);
  if (u.engine === "random") return randomGuide(tool, u.preset.kind);
  if ((u.engine === "format" || u.engine === "minify" || u.engine === "validate") && u.preset.lang) return codeGuide(tool, u.engine, u.preset.lang);
  return undefined;
}
