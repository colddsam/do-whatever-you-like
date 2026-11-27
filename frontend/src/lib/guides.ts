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
import { MERGED_TOOLS } from "@/lib/merged-tools";
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
  "video-editor": {
    intro: [
      "Video editor is a free, all-in-one editing, colour-grading and VFX studio that runs entirely in your browser. Build multi-track timelines with Premiere's own trim tools (razor, ripple, roll, slip, slide, rate stretch), Adjustment layers, Track Mattes (Alpha & Luma), 17 blend modes and markers. You can even open raw edit files straight from Premiere Pro (.prproj, XMEML, FCPXML, EDL), CapCut (.capcut / draft_content.json) and After Effects (.aep, .aepx, Lottie), then relink your local footage on this device.",
      "For motion graphics and typography it supports uploading custom .ttf/.otf/.woff/.woff2 fonts or loading any Google Font by name, plus 37 kinetic, per-character, per-word, cipher, wipe, curved-arc and 3D-extruded title animations with customisable in/out timings and Back/Elastic/Bounce keyframes. Its 46 GPU effects span cinema VFX (anamorphic lens flare, god rays, 35mm halation, prism, heat haze, shockwave, tilt-shift, CRT, neon edge glow, weather particles, strobe and 3D perspective), full DaVinci-style colour grading (3-way Color Wheels, monotone RGB Tone Curves, 8-band HSL secondary mixer, live Waveform/Parade/Histogram/Vectorscope scopes and .cube LUT export), and a 2D point motion tracker.",
      "Green screen and audio workflows are equally complete: Pro Chroma Key adds matte choke, edge feather, hue-preserving spill suppression, light wrap and Alpha/Status matte views alongside Unmult black-screen removal and GPU AI segmentation. Audio includes voice-over recording, Edge TTS in 30 natural voices, 10 voice changers, EQ/compression, 18 SFX, beat sync, auto-ducking and -14 LUFS loudness normalisation. Export MP4/WebM up to 4K, GIF, WAV/M4A or round-trip Premiere XML/EDL with zero uploads and no watermark.",
    ],
    faqs: [
      { q: "Can it open raw projects from Premiere Pro, CapCut or After Effects?", a: "Yes. Click Project in the Media bin (or Project File in the Inspector) to open .prproj, Premiere .xml, Final Cut .fcpxml, CMX 3600 .edl, CapCut draft_content.json/.capcut/.ccproj/.zip archives, After Effects .aep/.aepx and Lottie .json files locally, then use the one-click Relink button to connect local media files. You can also export timelines back to Premiere XML or EDL." },
      { q: "Can I use custom fonts and kinetic typography animations?", a: "Yes. Upload any .ttf, .otf, .woff or .woff2 font file (saved locally in IndexedDB and bundled inside .dwylvideo exports) or load any Google Font by exact name. Style titles with colour gradients, curved arc paths, 3D extrusion, word pills or editorial blocks, and choose from 37 entrance and exit animations including per-character cascades, mask reveals and cipher decode." },
      { q: "Are there full colour grading tools and video scopes?", a: "Yes. Combine Color grade (whites, blacks, clarity, fade), interactive 3-way Lift/Gamma/Gain Color Wheels, monotone Master/R/G/B Tone Curves, an 8-band HSL Secondary Mixer, Selective Colour Key, custom .cube LUTs and live Waveform, RGB Parade, Histogram and Vectorscope scopes — and export your finished grade as a .cube 3D LUT." },
      { q: "Are my videos or project files uploaded?", a: "No. Media decoding, WebGL2 compositing, 2D tracking, Whisper captions and WebCodecs 4K export all run on your computer. Only AI Director timeline summaries, Edge TTS text scripts and caption translation text ever touch the server — never your video, audio or project media." },
      { q: "How do green screen keying, track mattes and Unmult work?", a: "Chroma key Pro includes screen presets, eyedropper sampling, matte choke, edge feather, spill kill, edge light wrap, Alpha/Status matte diagnostics and one-click virtual studio backdrops. Use Unmult to key black backgrounds off fire/flare overlays, or set any clip's Track Matte to use the layer above it as an Alpha or Luma stencil." },
    ],
    see: ["trim-media", "audio-to-text", "subtitle-editor", "screen-recorder"],
  },
  "pro-photo-editor": {
    intro: [
      "Pro photo editor is a free, Photoshop-style image editor that runs entirely in your browser. It works with layers the way desktop editors do: each layer has its own opacity, blend mode (17 of them), layer mask, clipping and layer style (drop shadow, outer glow, stroke, colour overlay), and adjustment layers such as Curves, Levels and Hue/Saturation stay editable afterwards. Undo goes back 60 steps.",
      "It also covers what people usually open Lightroom or a phone app for: 22 one-tap looks with an amount slider, Camera Raw (exposure, highlights, shadows, temperature, texture, clarity, dehaze, vignette, grain), an HSL Color Mixer, Color Grading, and 35+ filters and effects including glitch, pencil sketch, cartoon, duotone, neon and light leaks. Text styles, stickers, frames and a collage maker are in the Create panel.",
      "For retouching there are the spot healing brush, healing brush, clone stamp, content-aware fill, red-eye, dodge, burn, sponge, smudge and liquify. Selections come from the marquee, lasso, polygonal lasso, magic wand, colour range or Select subject. Pictures never leave your device: only Select subject, background blur or removal and AI upscaling send a copy to our server, which deletes it straight away.",
    ],
    faqs: [
      { q: "Is this a free alternative to Photoshop?", a: "Yes. It has the core Photoshop workflow (layers, masks, adjustment layers, blend modes, selections, healing, clone stamp, content-aware fill, text and PSD files) free, with no account, no watermark and nothing to install. It doesn't have 3D, video, actions or layer groups." },
      { q: "Can I open and save PSD files?", a: "Yes. PSD files open with their layers, positions, opacity, blend modes and masks; layer groups are flattened into their layers. Save as PSD keeps your layers for Photoshop, Photopea or GIMP. Adjustment layers are applied to the flat preview but not kept as layers in the PSD, so use the project format (.dwlp) to keep everything editable." },
      { q: "Does it have Lightroom-style presets and editing?", a: "Yes. The Looks panel has 22 one-tap looks (Vivid, Moody, Golden hour, Teal & orange, Film, Cinematic, B&W, HDR and more) with an Amount slider, and Camera Raw, Curves, the HSL Color Mixer and Color Grading give you Lightroom's main sliders." },
      { q: "Are my photos uploaded?", a: "No. Editing happens in your browser, and your work is kept only on this device so you can continue later. Only Select subject, background blur or removal and AI upscale send a reduced copy to our server, which deletes it as soon as the result is sent." },
      { q: "How do I remove an object or a blemish from a photo?", a: "Paint over small spots with the spot healing brush (J), or select the object with the lasso and choose Edit → Content-aware fill. For larger areas, Alt-click a clean area with the clone stamp (S) and paint over the object." },
      { q: "Can I blur or replace the background?", a: "Yes. In the Create panel, Portrait blur keeps the subject sharp and softens everything behind it, and Replace swaps the background for the background colour. Remove background hides it with a layer mask, so you can paint parts back." },
      { q: "Does it work on a phone?", a: "Yes. On phones the tools sit in a scrolling row under the picture, the panels are tabs below, and two fingers pinch to zoom. Very large photos are reduced on iPhones and iPads, which limit how big a picture a browser can hold." },
      { q: "Will I lose my work if I close the tab?", a: "No. The last document is kept on this device and offered as Continue editing when you come back. To move it to another device, save a project (.dwlp) or a PSD." },
      { q: "What can I export?", a: "PNG, JPG or WebP at any size from 10% to 400% with a quality setting, and the exact file size is shown before you download. You can also copy the picture to the clipboard, save a PSD with layers, or save a project file." },
      { q: "Which keyboard shortcuts does it use?", a: "Photoshop's, wherever the browser allows: V move, M marquee, L lasso, W magic wand, B brush, S clone stamp, J healing, Ctrl+Z undo, Ctrl+J layer via copy, Ctrl+M curves, [ and ] for brush size. Free transform is Shift+T because browsers keep Ctrl+T for new tabs. Press ? for the full list." },
    ],
    see: ["remove-background", "upscale-image", "compress-image", "photo-editor"],
  },
  notepad: {
    intro: [
      "Smart notepad is a place to paste text and see what's in it. As you type, the inspector counts words, characters, lines and reading time, tells you what the text is (JSON, CSV, Markdown, a list…) and pulls out every email, link, phone number, date, number, hashtag and mention.",
      "It also finds what you can't see: zero-width characters, non-breaking spaces, stray spaces, repeated words, duplicate lines and unbalanced brackets, each with a one-click fix. Find & replace (with regex), sorting, de-duplicating, numbering and case changes work on the whole note or just your selection, and Ctrl+Z undoes all of them.",
    ],
    faqs: [
      { q: "Where are my notes saved?", a: "In this browser's local storage, as you type. Nothing is uploaded, and other people can't see them. Clearing your browser data removes them, so download a copy of anything important." },
      { q: "Can I find and replace with a regular expression?", a: "Yes. Press Ctrl+H, turn on the regex button, and use $1, $2 in the replacement for groups. Match case, whole words and Keep capitals are there too." },
      { q: "How do I remove hidden characters copied from a PDF or an AI chat?", a: "Open the Issues tab: hidden characters show as red bars in the text, and Remove (or Fix all) strips them along with odd spaces and curly quotes." },
      { q: "Can I sort or de-duplicate only part of the text?", a: "Yes. Select the lines first; every transform applies to the selection when there is one, and to the whole note when there isn't." },
    ],
    see: ["word-counter", "writing", "diff-checker"],
  },
  "css-generator": {
    intro: [
      "CSS generator makes gradients, box shadows, border radius, glassmorphism and neumorphism with a live preview. Pick what you're making at the top, adjust it with sliders and colours, and copy CSS that works in every current browser.",
    ],
    faqs: [
      { q: "What can I make here?", a: "Linear, radial and conic gradients; layered box shadows (including inset); per-corner border radius; frosted-glass (glassmorphism) panels; and soft extruded (neumorphism) surfaces." },
      { q: "Does the CSS need vendor prefixes?", a: "No. The output uses standard properties supported by current Chrome, Edge, Firefox and Safari." },
    ],
    see: ["color-picker", "contrast-checker", "color-palette-scale-generator"],
  },
  "hash-generator": {
    intro: [
      "Hash generator computes MD5, SHA-1, SHA-2 (224/256/384/512 and 512/224, 512/256), SHA-3, SHAKE, MD2, MD4, NTLM, CRC-16 and CRC-32 of text or a file, in your browser. Pick one algorithm, or All at once to see every digest side by side.",
      "Turn on HMAC to sign with a secret key, and paste an expected digest to check a download hasn't been changed.",
    ],
    faqs: [
      { q: "Is my file uploaded?", a: "No. Files and text are hashed on your device; nothing leaves your browser." },
      { q: "Which algorithm should I use?", a: "SHA-256 for checksums and integrity. MD5 and SHA-1 are fine for matching files but are broken for security, so don't use them for passwords or signatures." },
      { q: "Can I hash a password for storage here?", a: "Use a slow password hash (bcrypt, Argon2) in your app for that. For WordPress there's a separate WordPress password hash tool." },
    ],
    see: ["wordpress-hash", "base64-encoder", "password-generator"],
  },
  "random-generator": {
    intro: [
      "Random data generator makes as many random values as you need: integers and decimals in a range, fractions, primes, strings, letters, hex, binary and bytes, dates and times, IP and MAC addresses, mock JSON, CSV, TSV and XML records, strings matching a regular expression, and noise bitmaps.",
      "Values come from your browser's cryptographic random generator, so they're suitable for test data, IDs and draws.",
    ],
    faqs: [
      { q: "How many values can I make at once?", a: "Up to 500 per batch (50 for random bytes); copy them, or press again for a new batch." },
      { q: "Can I make realistic test data?", a: "Yes. The JSON, CSV, TSV and XML kinds generate records with names, emails, numbers and dates you can paste straight into a test." },
    ],
    see: ["random-name-picker", "uuid-generator", "password-generator"],
  },
  "code-formatter": {
    intro: [
      "Code formatter beautifies HTML, CSS, JavaScript, TypeScript, JSX, Angular templates, XML, PHP, Java, SQL, YAML and Markdown with Prettier (and sql-formatter for SQL). Pick the language, paste your code and copy the result; indentation, quotes and SQL keyword case are adjustable.",
    ],
    faqs: [
      { q: "Is my code sent anywhere?", a: "No. Formatting runs entirely in your browser." },
      { q: "What if my code has a syntax error?", a: "The formatter points to the line and column it couldn't read, so you can fix it and try again." },
    ],
    see: ["code-minifier", "code-validator", "json-formatter"],
  },
  "code-minifier": {
    intro: [
      "Code minifier makes JavaScript, CSS or HTML as small as possible by removing whitespace and comments (and shortening names in JavaScript), and shows how many bytes were saved.",
    ],
    faqs: [
      { q: "Will minifying change how my code works?", a: "No. Only whitespace, comments and safe renames are changed; keep the original for editing." },
      { q: "Is my code uploaded?", a: "No. It's minified in your browser." },
    ],
    see: ["code-formatter", "code-validator", "svg-optimizer-jsx"],
  },
  "code-validator": {
    intro: [
      "Code validator checks JavaScript (and JSX or jQuery), CSS, XML or YAML for syntax errors and shows each one with its line and column, so you can fix broken code before it ships.",
    ],
    faqs: [
      { q: "Does it check style too?", a: "It reports syntax errors: the things that stop code from running or parsing. For tidy formatting, use the code formatter." },
      { q: "Can it check XML against a schema?", a: "For that, use the XSD validator; this checks that the XML is well-formed." },
    ],
    see: ["code-formatter", "xsd-validator", "json-formatter"],
  },
  "convert-image": {
    intro: [
      "Convert image turns any picture into JPG, PNG, WebP or GIF: iPhone HEIC photos, camera RAW files, PSD, TIFF, SVG, BMP, AVIF and the usual web formats. Several images can also become one animated GIF, in the order you set.",
      "JPG has a Recommended or Highest quality setting and a colour for transparent areas; PNG and WebP keep every pixel.",
    ],
    faqs: [
      { q: "How do I convert an iPhone HEIC photo to JPG?", a: "Drop the HEIC files in, keep JPG selected and press Convert. Up to 30 images at once." },
      { q: "How do I make an animated GIF from photos?", a: "Pick Animated GIF, add two or more images, reorder them with the arrows, then set the seconds per frame and looping." },
      { q: "Are my images kept?", a: "No. They're converted on our server and deleted as soon as the result is sent." },
    ],
    see: ["compress-image", "resize-image", "convert-anything"],
  },
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
    see: ["split-pdf", "organize-pdf", "merge-pdf"],
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
    see: ["resize-image", "convert-image", "crop-image", "compress-pdf"],
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
    see: ["pro-photo-editor", "upscale-image", "crop-image", "resize-image"],
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
    see: ["blur-face", "crop-image", "compress-image"],
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
  "split-text": {
    intro: [
      "Split any block of text into clean pieces by lines, commas, spaces, sentences, words, characters, a custom separator, a regex, or every N characters.",
      "Tidy the result by trimming whitespace, dropping empty items, removing duplicates, or sorting, then copy it as lines, numbered items, JSON, CSV, or a quoted list.",
    ],
    faqs: [
      { q: "Can I convert a comma-separated list into JSON or lines?", a: "Yes. Split by commas, optionally trim and deduplicate, and export as lines, JSON, CSV, or a quoted list." },
      { q: "Does my text stay private?", a: "Yes. Splitting and formatting happen entirely in your browser." },
    ],
    see: ["notepad", "json-formatter"],
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
      "Cut or split any video or audio file (MP4, MOV, MKV, WebM, MP3, WAV, M4A, and more up to 150 MB) right on a live player and audio waveform. Drag trim handles, press C while listening to drop cut markers into multiple parts, toggle Keep or Skip on sections, and choose your desired output format.",
      "Keep the original format with instant lossless stream copy, cut frame-exact clips, extract audio tracks cleanly to MP3/WAV/M4A/FLAC, or preview individual ZIP parts directly in your browser before saving.",
    ],
    faqs: [
      { q: "Can I cut a video or song into several parts at once?", a: "Yes. Switch to 'Cut in parts (Split)', click 'Add cut at playhead' (or press C), split into N equal parts or second intervals, and export all kept clips as one ZIP or joined into one file." },
      { q: "Can I pick a different output format?", a: "Yes. Export in the original format, MP4, MOV, MKV, WebM, animated GIF, or extract audio directly to MP3, M4A, WAV, FLAC, OGG or OPUS." },
      { q: "What happens to my file?", a: "Files are processed on our server and deleted immediately after your download is sent." },
    ],
    see: ["trim-media", "audio-volume", "noise-remover", "video-to-gif"],
  },
  "3d-viewer": {
    intro: [
      "Open, inspect, slice and convert 3D files completely inside your browser using hardware-accelerated WebGL. Supports GLB, GLTF (with Draco decompression), STL, OBJ (+ MTL materials & textures), FBX, PLY, 3MF, DAE, PCD, XYZ and bundled ZIP packages.",
      "Orbit, pan and zoom smoothly, flip between Textured PBR, Studio Clay, Wireframe, Surface Normals and X-Ray shading, rotate Z-up CAD models to Y-up in one click, cut cross-section slice planes, inspect individual mesh parts and export PNG, GLB, STL or OBJ locally.",
    ],
    faqs: [
      { q: "Are my 3D models uploaded to a server?", a: "Never. All parsing, WebGL rendering, cross-section slicing and exports (.GLB/.STL/.OBJ/PNG) run locally in your browser." },
      { q: "My .gltf or .obj uses external .bin, .mtl or texture images—how do I load them?", a: "Select or drag all the files together at once (e.g. model.obj + model.mtl + texture.png), or drop the .zip archive directly onto the page." },
      { q: "How do I inspect hollow interiors or upside-down CAD files?", a: "Open the Slice tab to click 'Z-up -> Y-up (-90° X)' or drag an X, Y, or Z cross-section clipping plane through your mesh." },
    ],
    see: ["document-viewer", "svg-optimizer-jsx", "image-to-svg"],
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
    see: ["color-picker", "css-generator", "font-checker"],
  },
  "json-formatter": {
    intro: [
      "Format, validate, minify, and inspect JSON right in your browser. Syntax errors point to the exact line and column, and you can browse nested objects as a collapsible tree, sort keys, or convert JSON to CSV.",
    ],
    faqs: [
      { q: "Is my JSON sent to a server?", a: "No. Parsing, formatting, and validation run 100% in your browser." },
      { q: "Can I convert JSON to CSV?", a: "Yes. Arrays of JSON objects can be exported directly as CSV." },
    ],
    see: ["jsonpath-tester", "code-formatter", "diff-checker"],
  },
  "jwt-decoder": {
    intro: [
      "Decode any JSON Web Token (JWT) in your browser to inspect its header, payload claims, and expiration time in readable form. You can also verify HS256, HS384, and HS512 signatures with your secret.",
    ],
    faqs: [
      { q: "Is it safe to paste real JWTs here?", a: "Yes. Decoding and signature verification run locally in your browser—nothing is sent to any server." },
      { q: "Which signature algorithms can it verify?", a: "HS256, HS384, and HS512 HMAC signatures using your secret." },
    ],
    see: ["base64-encoder", "hash-generator", "json-formatter"],
  },
  "base64-encoder": {
    intro: [
      "Encode text or files to Base64 and decode Base64 strings back to text or downloadable files in your browser. Supports standard and URL-safe Base64 (`base64url`) as well as `data:` URLs with image previews.",
    ],
    faqs: [
      { q: "Does it support URL-safe Base64?", a: "Yes. Switch between standard Base64 and URL-safe Base64url." },
      { q: "Can I preview decoded Base64 images?", a: "Yes. Image data URLs and Base64-encoded images preview right in the browser." },
    ],
    see: ["jwt-decoder", "url-encoder", "hash-generator"],
  },
  "regex-tester": {
    intro: [
      "Test JavaScript regular expressions live with every match and capture group highlighted. Toggle global (`g`), case-insensitive (`i`), multiline (`m`), dotAll (`s`), and unicode (`u`) flags, and preview replacements using `$1` groups.",
    ],
    faqs: [
      { q: "Does it show capture groups?", a: "Yes. Every match and numbered capture group is highlighted." },
      { q: "Can I test find-and-replace patterns?", a: "Yes. Use the replacement preview with `$1` group references." },
    ],
    see: ["notepad", "random-generator", "diff-checker"],
  },
  "timestamp-converter": {
    intro: [
      "Convert Unix timestamps (in seconds or milliseconds, auto-detected) to human-readable local, UTC, and ISO 8601 dates—or convert any date and time back to a Unix epoch timestamp.",
    ],
    faqs: [
      { q: "Does it detect seconds vs milliseconds?", a: "Yes. 10-digit seconds and 13-digit millisecond timestamps are detected automatically." },
      { q: "Can I see the current live Unix timestamp?", a: "Yes. The live current epoch timestamp updates in real time." },
    ],
    see: ["world-clock", "cron-explainer", "age-calculator"],
  },
  "diff-checker": {
    intro: [
      "Compare two blocks of text or code side by side or inline to spot every added, removed, and modified line or word. Optionally ignore whitespace or letter case—everything stays in your browser.",
    ],
    faqs: [
      { q: "Can I ignore whitespace or case differences?", a: "Yes. Toggle whitespace and case sensitivity options to focus on meaningful changes." },
      { q: "Is my code uploaded?", a: "No. Text comparison runs locally in your browser." },
    ],
    see: ["compare-pdf", "json-formatter", "notepad"],
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
    see: ["unit-converter", "scientific-calculator", "age-calculator"],
  },
  "world-clock": {
    intro: [
      "Track the current time across any IANA city or time zone with automatic daylight saving adjustments, and use the meeting planner to pick a time in one city and see working hours, evenings, and nights everywhere else.",
    ],
    faqs: [
      { q: "Does it handle daylight saving time automatically?", a: "Yes. It uses standard IANA time zones with current DST rules." },
      { q: "Can I plan meetings across time zones?", a: "Yes. Pick a proposed time in any city to compare local hours across all added cities." },
    ],
    see: ["timestamp-converter", "age-calculator", "stopwatch"],
  },
  stopwatch: {
    intro: [
      "Use a precision stopwatch with lap recording (highlighting your fastest and slowest laps) alongside a countdown timer with an audio alarm—all running locally in your browser tab.",
    ],
    faqs: [
      { q: "Does it highlight best and worst laps?", a: "Yes. Fastest and slowest lap splits are automatically marked." },
      { q: "Does the countdown timer play an alarm?", a: "Yes, it plays a chime when the countdown finishes." },
    ],
    see: ["stopwatch", "world-clock", "age-calculator"],
  },
  "age-calculator": {
    intro: [
      "Calculate your exact age in years, months, and days—plus total days lived and a countdown to your next birthday—right in your browser, handling leap years and varying month lengths accurately.",
    ],
    faqs: [
      { q: "Does it handle leap-year birthdays?", a: "Yes. Leap years and varying month lengths are handled accurately." },
      { q: "Can I calculate days between two arbitrary dates?", a: "Yes. Use the Date calculator for spans, business days, and adding or subtracting days." },
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
    see: ["encrypt-note", "hash-generator", "random-generator"],
  },
  "encrypt-note": {
    intro: [
      "Encrypt a private note or message in your browser using AES-256-GCM with a PBKDF2 key (600,000 rounds), then share it as encrypted text or a `#`-fragment link that never sends your note or password to any server.",
    ],
    faqs: [
      { q: "Can the server read my encrypted note or link?", a: "No. Encryption happens in your browser, and shareable links put the ciphertext after the `#` URL fragment, which browsers never send to servers." },
      { q: "What encryption standard is used?", a: "AES-256-GCM authenticated encryption with PBKDF2-SHA256 (600,000 iterations)." },
    ],
    see: ["password-generator", "hash-generator", "base64-encoder"],
  },
  "exif-remover": {
    intro: [
      "Inspect hidden EXIF, GPS location (plotted on a map), camera, lens, software, and serial number metadata inside your photos—then strip it losslessly from JPG, PNG, and WebP images without re-compression.",
    ],
    faqs: [
      { q: "Does removing EXIF metadata reduce photo quality?", a: "No. Metadata is stripped losslessly from JPG, PNG, and WebP without re-compressing pixels, while keeping orientation and colour profiles intact." },
      { q: "Are my photos uploaded?", a: "No. Metadata inspection and removal run locally in your browser." },
    ],
    see: ["compress-image", "blur-face", "pixelate-image"],
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
    see: ["age-calculator", "encrypt-note"],
  },
  translator: {
    intro: [
      "One translator for everything in 130 languages: text that translates as you type, whole documents that keep their layout, photos and screenshots with the translation painted over the original, and audio or video dubbed with a natural voice.",
      "Short text gets a word panel like a dictionary: romanisation, other ways to say it, meanings by part of speech, definitions, synonyms and examples. Check meaning translates the result back and scores how much survived, so you know when to rephrase. A glossary keeps brand names untouched or forces your own terms, and links, emails and {placeholders} are never translated.",
      "Documents (Word, PowerPoint, Excel, OpenDocument, EPUB, HTML, Markdown, CSV, JSON i18n files, PO, XLIFF and subtitles) are rebuilt with the same styles, tables, images and formulas; PDFs are converted to Word first. Choose a bilingual output to keep the original next to each translated paragraph.",
    ],
    faqs: [
      { q: "Is it free, with no sign-up?", a: "Yes. Translation runs on free engines with automatic fallbacks, OCR runs in your browser, and voices come from free neural text-to-speech. There is no account, watermark or word quota." },
      { q: "Does translating a Word, PowerPoint or Excel file keep the formatting?", a: "Yes. The file is edited in its own XML, so fonts, colours, tables, images, charts, slide layouts, cell formats and formulas stay as they were. Each paragraph takes the style of its first word, and right-to-left languages are marked RTL." },
      { q: "Are my documents uploaded?", a: "Office, OpenDocument, EPUB, HTML and text files are read and rebuilt in your browser; only the text is sent for translation. PDF, DOC, PPT, XLS and RTF are converted on our server first and deleted straight away." },
      { q: "How does picture translation work?", a: "The text is read on your device (Tesseract), each block is translated, then painted over the original in a matching colour. You can edit any line, compare side by side and download the PNG." },
      { q: "What do I get when translating audio or video?", a: "A dubbed audio or video file to preview and download, plus the original transcript and the translation with Copy buttons and TXT/SRT/VTT downloads. Video can carry soft subtitles." },
      { q: "Can I talk to someone in another language?", a: "Yes: open the Live interpreter for two-way spoken conversation, live translated captions and a travel phrasebook." },
    ],
    see: ["interpreter", "audio-to-text", "subtitle-editor", "word-editor"],
  },
  interpreter: {
    intro: [
      "A pocket interpreter for real conversations. Each person taps their microphone and speaks; the words are recognised, translated and read out loud in a natural voice for the other person, and both lines appear in a chat you can replay, copy or export.",
      "Hands-free turns open the mic for the other person after every translation, and face-to-face mode turns Person B's half upside down for a phone lying on a table. Live captions listen continuously and show rolling translations in up to three languages, full screen for a classroom or meeting. The phrasebook has 90 everyday phrases in 8 situations, with pronunciation and a big show-card.",
    ],
    faqs: [
      { q: "Which browsers can listen?", a: "Chrome, Edge, Safari and most Android browsers recognise speech themselves. In Firefox and some in-app browsers each phrase is sent to our free Whisper server instead, which takes a second or two. You can always type." },
      { q: "Is the conversation stored?", a: "No. It stays on the page until you clear or close it; export it as TXT, SRT or JSON if you want to keep it." },
      { q: "Can it translate a lecture or a video call live?", a: "Yes: Live captions keeps listening and translates each sentence as it is finished, into up to three languages at once, and can read the first one aloud." },
    ],
    see: ["translator", "audio-to-text", "subtitle-editor"],
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
    see: ["writing", "diff-checker", "chart-maker"],
  },
  "image-to-svg": {
    intro: [
      "Trace PNG, JPG, or WebP logos, sketches, and icons into crisp scalable SVG vector paths right in your browser. Choose monochrome black-and-white tracing or multi-colour k-means quantization with smooth quadratic Bézier curve fitting and a noise speckle filter.",
    ],
    faqs: [
      { q: "Does it support multi-colour logos?", a: "Yes. Use multi-colour k-means quantization or monochrome tracing depending on your image." },
      { q: "Is my image uploaded?", a: "No. Tracing runs 100% locally on an HTML canvas in your browser." },
    ],
    see: ["svg-optimizer-jsx", "icon-maker", "compress-image"],
  },
  "mockup-frame-generator": {
    intro: [
      "Wrap screenshots inside macOS Safari browser windows, dark phone frames, or floating glass cards with gradient, solid, or transparent backgrounds—or overlay live YouTube, Shorts, Reels, TikTok, and Instagram 4:5 safe-zone guides before exporting a 2× HD PNG.",
    ],
    faqs: [
      { q: "Which social safe-zone overlays are included?", a: "YouTube thumbnails, Shorts, Instagram Reels, TikTok, and Instagram 4:5 feed crops." },
      { q: "Are my screenshots uploaded?", a: "No. Framing and 2× HD PNG export run locally in your browser." },
    ],
    see: ["crop-image", "pixelate-image", "compress-image"],
  },
  "archive-extractor-creator": {
    intro: [
      "Inspect entries, sizes, and folders inside `.zip`, `.tar`, `.tar.gz`, and `.gz` archives, preview text files or download individual items without extracting everything, or bundle multiple files into a new `.zip`, `.tar`, `.tar.gz`, or `.gz` archive—all in your browser.",
    ],
    faqs: [
      { q: "Can I extract a single file from a large ZIP?", a: "Yes. Browse the archive tree, preview text files, and download individual entries without unpacking the whole archive." },
      { q: "Are my files uploaded to a server?", a: "No. Inspection, extraction, and archive creation run locally in your browser." },
    ],
    see: ["compress-files", "merge-files", "split-files"],
  },
  "audio-waveform-generator": {
    intro: [
      "Turn any audio or video file's sound into a downloadable SVG or high-resolution PNG waveform or STFT frequency spectrogram right in your browser.",
    ],
    faqs: [
      { q: "Which export formats are supported?", a: "Scalable SVG and high-resolution PNG graphics." },
      { q: "Is my audio uploaded?", a: "No. Decoding and rendering happen locally in your browser." },
    ],
    see: ["audio", "noise-remover", "audio-volume"],
  },
  "word-counter": {
    intro: [
      "Count words, characters (with and without spaces), sentences, and paragraphs live as you type or paste, alongside estimated reading time and a Flesch readability score—all in your browser.",
    ],
    faqs: [
      { q: "Does it show reading time and readability?", a: "Yes. It calculates estimated reading time and the Flesch readability score live." },
      { q: "Is my text stored anywhere?", a: "No. Counting runs locally in your browser." },
    ],
    see: ["writing", "case-converter", "notepad"],
  },
  "case-converter": {
    intro: [
      "Convert text or identifiers cleanly between `camelCase`, `snake_case`, `kebab-case`, `PascalCase`, `Title Case`, `UPPERCASE`, and `lowercase` in your browser.",
    ],
    faqs: [
      { q: "Which case styles are supported?", a: "camelCase, snake_case, kebab-case, PascalCase, Title Case, UPPERCASE, and lowercase." },
      { q: "Does it run locally?", a: "Yes, 100% in your browser." },
    ],
    see: ["word-counter", "split-text", "notepad"],
  },
  "list-comparator": {
    intro: [
      "Compare two lists in your browser to find items only in A, only in B, their intersection, union, or symmetric difference—useful for comparing tags, emails, keywords, or IDs.",
    ],
    faqs: [
      { q: "Which set operations are included?", a: "A only, B only, intersection (common items), union (combined), and symmetric difference." },
      { q: "Are my lists sent to a server?", a: "No. Comparison runs locally in your browser." },
    ],
    see: ["diff-checker", "notepad", "split-text"],
  },
  "username-generator": {
    intro: [
      "Generate clean, memorable usernames from any name, brand, or niche keywords across multiple styles (Clean, Professional, Developer, Creative, Short), then verify handle availability across the social platforms and mail services you toggle on.",
      "Whenever a username is already taken on any selected platform or email domain, the tool automatically generates and checks the closest available variations so you can lock in a consistent online identity with zero guesswork.",
    ],
    faqs: [
      {
        q: "How are social media and mail availability checks performed?",
        a: "Developer, creator, community, and gaming networks (GitHub, YouTube, Bluesky, Mastodon, DEV.to, GitLab, Hugging Face, Hacker News, Docker Hub, etc.), X (Twitter), Mail.ru, and custom email domains (.com, .dev, .io, .in via DNS-over-HTTPS) run live public lookups. Instagram runs through cookie-free Instaloader (with rate-limit canary verification), Facebook uses cookie-free yt-dlp and public metadata, TikTok inspects public profile data / cookie-free yt-dlp (from US/EU servers), and Reddit combines live checks with public archive fallback — falling back honestly to a verify link if rate-limited or hidden. Webmail providers without unauthenticated enumeration (Gmail, Outlook, Proton, iCloud, Yahoo) validate strict handle rules and check public Gravatar/OpenPGP registries.",
      },
      {
        q: "What happens if my preferred username is occupied?",
        a: "Whenever one or more toggled platforms report the handle as occupied, the tool automatically generates close variations (natural prefixes, niche suffixes, separator adjustments) and scans their availability so you can pick the closest free alternative immediately.",
      },
      {
        q: "Is there any usage fee or sign-up required?",
        a: "No. All username generation and handle lookups are 100% free with zero API keys or accounts required.",
      },
    ],
    see: ["password-generator", "qr", "case-converter"],
  },
  "data-format-converter": {
    intro: [
      "Convert cleanly between JSON, CSV, YAML, XML, HTML, and Markdown in your browser with instant preview and copy/download.",
    ],
    faqs: [
      { q: "Which formats can I convert between?", a: "JSON, CSV, YAML, XML, HTML, and Markdown." },
      { q: "Is my data sent to a server?", a: "No. Conversion runs locally in your browser." },
    ],
    see: ["data-format-converter", "sqlite-csv-parquet-viewer"],
  },
  "json-sql-to-types": {
    intro: [
      "Generate TypeScript interfaces, Zod schemas, Python Pydantic models, or Go structs directly from sample JSON or `CREATE TABLE` SQL statements in your browser.",
    ],
    faqs: [
      { q: "Which target languages and schemas are supported?", a: "TypeScript interfaces, Zod schemas, Python Pydantic models, and Go structs." },
      { q: "Can I paste a SQL CREATE TABLE statement?", a: "Yes. Both sample JSON and SQL CREATE TABLE inputs are supported." },
    ],
    see: ["json-formatter", "code-formatter", "diff-checker"],
  },
  "chmod-calculator": {
    intro: [
      "Calculate Linux/Unix file permissions interactively with owner, group, and public checkboxes to get octal (`755`, `644`), symbolic (`-rwxr-xr-x`), and ready-to-run `chmod` commands.",
    ],
    faqs: [
      { q: "What does chmod 755 mean?", a: "Owner has read, write, and execute (7), while group and public have read and execute (5)." },
      { q: "Does it show symbolic notation too?", a: "Yes. It updates octal, symbolic (`-rwxr-xr-x`), and the `chmod` command live." },
    ],
    see: ["cron-explainer", "base64-encoder", "hash-generator"],
  },
  "sqlite-csv-parquet-viewer": {
    intro: [
      "Drop a local `.sqlite`, `.db`, `.parquet`, `.csv`, `.tsv`, or `.json` file to inspect its schema, browse rows, and run SQL queries entirely in your browser—nothing is uploaded.",
    ],
    faqs: [
      { q: "Which file formats can I query with SQL?", a: "SQLite (.sqlite, .db), Parquet, CSV, TSV, and JSON files." },
      { q: "Is my database file uploaded?", a: "No. Schema inspection and SQL queries run locally in your browser." },
    ],
    see: ["data-format-converter", "json-sql-to-types"],
  },
  "emi-sip-calculator": {
    intro: [
      "Calculate monthly loan EMIs with optional prepayments, total interest payable, amortisation schedules, SIP growth, and compound interest in your browser.",
    ],
    faqs: [
      { q: "Can I include loan prepayments?", a: "Yes. You can model prepayments to see how much interest and tenure you save." },
      { q: "Is any financial data saved on a server?", a: "No. Calculations run locally in your browser." },
    ],
    see: ["emi-sip-calculator", "gst-percentage-calculator", "scientific-calculator"],
  },
  "gst-percentage-calculator": {
    intro: [
      "Calculate inclusive and exclusive Indian GST (broken down into CGST + SGST or IGST), coupon discounts, and everyday percentage math in your browser.",
    ],
    faqs: [
      { q: "Does it support both inclusive and exclusive GST?", a: "Yes. Switch between adding GST to a base price and extracting GST from a total." },
      { q: "Does it show CGST/SGST and IGST?", a: "Yes. Both intra-state (CGST + SGST) and inter-state (IGST) breakdowns are shown." },
    ],
    see: ["invoice-signature-generator", "emi-sip-calculator", "bill-splitter"],
  },
  "bill-splitter": {
    intro: [
      "Settle group trip expenses with minimum transfers or split dinner bills cleanly with a copyable WhatsApp-ready summary—all in your browser with no sign-up.",
    ],
    faqs: [
      { q: "How does it minimise group transfers?", a: "It calculates net balances for everyone and settles debts in the fewest possible payments." },
      { q: "Can I share the split on WhatsApp?", a: "Yes. Copy a clean formatted breakdown ready to paste into WhatsApp." },
    ],
    see: ["gst-percentage-calculator", "unit-converter", "scientific-calculator"],
  },
  "invoice-signature-generator": {
    intro: [
      "Create GST-ready A4 printable invoices and draw clean transparent-background PNG signatures directly in your browser with no account or watermark.",
    ],
    faqs: [
      { q: "Can I download a transparent signature PNG?", a: "Yes. Draw your signature and export it as a transparent-background PNG." },
      { q: "Are my invoice details stored on a server?", a: "No. Invoice generation and signature drawing run locally in your browser." },
    ],
    see: ["gst-percentage-calculator", "sign-pdf", "qr"],
  },
  "svg-optimizer-jsx": {
    intro: [
      "Minify raw SVG markup, strip editor bloat, and convert SVG attributes (`class`, `stroke-width`, `fill-opacity`, etc.) into valid React JSX/TSX components or CSS Data URIs in your browser.",
    ],
    faqs: [
      { q: "Does it convert SVG attributes to React camelCase?", a: "Yes. Attributes like `stroke-width` and `class` are converted to `strokeWidth` and `className` for JSX/TSX." },
      { q: "Can I export an SVG Data URI for CSS?", a: "Yes. Copy optimised SVG, React JSX/TSX, or a CSS `url(...)` Data URI." },
    ],
    see: ["image-to-svg", "code-minifier", "css-grid-flexbox-playground"],
  },
  "css-grid-flexbox-playground": {
    intro: [
      "Build CSS Grid and Flexbox layouts visually with live cells, gap, alignment, and track controls, and export ready-to-use Tailwind classes, CSS, and HTML.",
    ],
    faqs: [
      { q: "Does it output Tailwind CSS classes too?", a: "Yes. You can copy Tailwind utility classes as well as standard CSS and HTML." },
      { q: "Does it support both Grid and Flexbox?", a: "Yes. Switch between CSS Grid and Flexbox modes." },
    ],
    see: ["css-generator", "contrast-checker"],
  },
  "color-palette-scale-generator": {
    intro: [
      "Generate full Tailwind-style 50–950 colour scales, WCAG contrast badges, and harmonious colour palettes (analogous, complementary, triadic, split-complementary) from any hex colour.",
    ],
    faqs: [
      { q: "Does it check accessibility contrast for the scale?", a: "Yes. Each shade in the 50–950 scale shows WCAG contrast badges." },
      { q: "Can I export the palette for Tailwind?", a: "Yes. Copy CSS variables or Tailwind colour scale configs directly." },
    ],
    see: ["contrast-checker", "color-picker", "css-generator"],
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
    see: alg === "md5" ? ["hash-generator"] : alg.startsWith("sha3") ? ["hash-generator"] : ["hash-generator"],
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
    see: ["random-generator", "random-name-picker"].filter((id) => id !== tool.id),
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
  const g = baseGuide(tool);
  if (!g?.see) return g;
  // Suggestions name tools by id; merged pages resolve to the tool that replaced them.
  const see = [...new Set(g.see.map((id) => MERGED_TOOLS[id]?.to ?? id))].filter((id) => id !== tool.id);
  return { ...g, see };
}

/** The XML/JSON testers and device checks: short tools whose pages need to say what they're for. */
const DEV_AND_DEVICE_GUIDES: Record<string, Guide> = {
  "jsonpath-tester": {
    intro: [
      "JSONPath tester runs a JSONPath expression against the JSON you paste and lists every match, each with the exact path that leads to it. Results update as you type, so you can build a query step by step: start with $.store, add .book[*], then narrow it with a filter such as [?(@.price < 10)].",
      "Use it to work out the path an API client, a test assertion, a Kubernetes or jq-style config, or a low-code tool expects before you put it in your code. It runs in your browser, so the JSON you paste isn't sent anywhere.",
    ],
    faqs: [
      { q: "Which JSONPath features work?", a: "The full syntax: the root $, child and recursive descent (. and ..), wildcards (*), array indexes and slices ([0], [-1:], [0:5:2]), unions ([0,2]) and filter expressions with @ ([?(@.active == true)])." },
      { q: "Why do I get no matches?", a: "Check the path starts at $, that keys match the JSON's exact case, and that you index into arrays ([*] or [0]) before reading their fields. If the JSON itself doesn't parse, the error is shown instead of results." },
      { q: "Is JSONPath the same as jq?", a: "No. They answer similar questions with different syntax. JSONPath selects values; jq is a full language that can also reshape them. Many tools (Kubernetes, AWS Step Functions, test frameworks) take JSONPath." },
    ],
    see: ["json-formatter", "xpath-tester", "code-formatter"],
  },
  "xpath-tester": {
    intro: [
      "XPath tester evaluates an XPath expression on the XML you paste and shows every matching node with its path. It uses your browser's own XPath engine, the same one scripts on a web page use, so what matches here matches in document.evaluate.",
      "It's handy for writing selectors for XML APIs and feeds, SOAP responses, sitemaps, Selenium or Playwright locators, and XSLT templates. Namespaced documents work too. Everything runs in your browser.",
    ],
    faqs: [
      { q: "Which XPath version is supported?", a: "XPath 1.0, the version built into browsers. It covers paths, predicates ([@id='a'], [1], [last()]), axes (ancestor::, following-sibling::) and functions such as contains(), starts-with(), count() and normalize-space(). XPath 2.0+ functions like matches() aren't available." },
      { q: "My query finds nothing on a document with a default namespace. Why?", a: "In XPath 1.0 an element in a default namespace has to be selected with a prefix bound to that namespace. Use the namespace prefix the tool shows, or match by local name: //*[local-name()='item']." },
      { q: "Can I test XPath against a web page's HTML?", a: "Paste the page's markup as XML. It has to be well-formed (closed tags, quoted attributes), so XHTML or cleaned-up HTML works best." },
    ],
    see: ["xml-viewer", "xslt-transformer", "jsonpath-tester"],
  },
  "xml-viewer": {
    intro: [
      "XML viewer turns the XML you paste into a collapsible tree, so a long feed, config or API response becomes something you can browse. Elements fold and unfold, and each one shows its attributes and text.",
      "Click any node to copy its XPath, which you can paste straight into code or into the XPath tester. Parse errors are reported with what went wrong, which makes it a quick way to find a broken tag too. It runs in your browser and nothing is uploaded.",
    ],
    faqs: [
      { q: "What kinds of XML can it open?", a: "Any well-formed XML: RSS and Atom feeds, sitemaps, SVG, Android and Maven configs, SOAP messages, Office XML parts and so on. If the document isn't well-formed, you'll see the parser's error instead of a tree." },
      { q: "How do I get the path to an element?", a: "Click it. Its XPath is copied to your clipboard, ready for the XPath tester, XSLT or your own code." },
      { q: "Can it pretty-print XML too?", a: "The tree is for browsing. To re-indent the text itself, use the code formatter, which also handles HTML, JSON and more." },
    ],
    see: ["xpath-tester", "xslt-transformer", "code-formatter"],
  },
  "xslt-transformer": {
    intro: [
      "XSLT transformer applies an XSLT stylesheet to your XML and shows the result. When the output is HTML you also get a rendered preview, so you can see a report or page take shape as you edit the template.",
      "It uses XSLT 1.0 through libxslt, the same engine everywhere, so results don't change from browser to browser. The processor is locked down: stylesheets can't read files or fetch other addresses, which keeps untrusted stylesheets harmless.",
    ],
    faqs: [
      { q: "Which XSLT version does it run?", a: "XSLT 1.0 with XPath 1.0, plus the EXSLT functions libxslt provides. XSLT 2.0 and 3.0 features such as xsl:for-each-group or regex functions aren't available." },
      { q: "Can my stylesheet use document() or xsl:include?", a: "Not to load other files or addresses. Put everything the transform needs into the XML and the one stylesheet you paste." },
      { q: "What can I use it for?", a: "Turning XML exports into HTML tables or reports, converting one XML format into another, extracting a CSV-like text list from a feed, or testing a template before it goes into a build pipeline." },
    ],
    see: ["xpath-tester", "xml-viewer", "html-viewer"],
  },
  "uri-template": {
    intro: [
      "URI template expander fills an RFC 6570 URI template with your values and shows the finished URL as you type. Write a template such as /repos/{owner}/{repo}/issues{?state,labels}, give the values as a JSON object, and copy the result.",
      "Templates like these are how many REST APIs (GitHub's among them), OpenAPI tooling and HAL or JSON:API links describe their URLs. Testing one here shows exactly how lists, maps, empty values and reserved characters get encoded. It runs in your browser.",
    ],
    faqs: [
      { q: "Which levels of RFC 6570 are supported?", a: "All four: simple {var}, reserved {+var}, fragment {#var}, label {.var}, path {/var}, path-style {;var}, query {?var} and continuation {&var} expressions, with the :prefix and * explode modifiers." },
      { q: "How do I pass a list or a map?", a: "Use JSON: a list is an array ([\"bug\",\"ui\"]) and a map is an object ({\"sort\":\"date\"}). Add * after the name ({?labels*}) to repeat the key for each item instead of joining with commas." },
      { q: "What happens to a variable I leave out?", a: "It's undefined, and RFC 6570 drops it from the URL entirely, including its ? or & when it's a query variable. An empty string is different: it stays, as name= with no value." },
    ],
    see: ["json-escape", "jsonpath-tester", "code-formatter"],
  },
  "html-viewer": {
    intro: [
      "HTML viewer renders the HTML you type or paste, live, next to the code. It's a quick way to check an email template, a snippet from a CMS, a component's markup or an answer you found online without making a file and opening it.",
      "The preview runs in a sandbox: scripts in your HTML can run, but they can't touch this site or your data on it. Switch between phone, tablet and desktop widths to see how it reflows, then copy the code or download it as an .html file.",
    ],
    faqs: [
      { q: "Does CSS and JavaScript in my HTML work?", a: "Yes. Inline <style> and <script>, and links to stylesheets or scripts on public addresses, all load in the preview, inside the sandbox." },
      { q: "Is it safe to paste HTML I don't trust?", a: "It's rendered in a sandboxed frame, so it can't read this site's pages or storage. Treat links in it as you would anywhere else." },
      { q: "Is my code uploaded?", a: "No. The preview is built in your browser." },
    ],
    see: ["code-formatter", "xml-viewer", "screen-resolution-tester"],
  },
  "pixel-ruler": {
    intro: [
      "Pixel ruler measures anything on screen. Press and drag on the canvas and you get the width, height and straight-line distance in pixels, plus the start point, with tick marks every 10 px to line things up.",
      "Pixels are converted to inches and centimetres using a pixels-per-inch value: 96, the CSS standard, by default. Set your monitor's real PPI (from its size and resolution) and the inches and centimetres become true physical sizes. Nothing is installed or stored.",
    ],
    faqs: [
      { q: "Are these CSS pixels or physical pixels?", a: "CSS pixels, the unit web layouts use. On a high-density display one CSS pixel covers several physical ones; the screen resolution tool shows your pixel ratio." },
      { q: "How do I find my monitor's PPI?", a: "Divide the diagonal resolution in pixels by the diagonal size in inches. A 27-inch 2560 × 1440 monitor is about 109 PPI; a 24-inch 1920 × 1080 one is about 92." },
      { q: "Can I measure something in another app?", a: "The ruler measures within this page. To measure another window, take a screenshot, open it in the image editor, and measure there at 100% zoom." },
    ],
    see: ["screen-resolution", "screen-resolution-tester", "color-picker"],
  },
  "screen-resolution": {
    intro: [
      "This page reads your screen's resolution in CSS pixels, its physical pixels (CSS pixels × pixel ratio), the device pixel ratio, aspect ratio, the area left after the taskbar or dock, colour depth and orientation.",
      "Below that, the browser window's size updates live as you resize it: the viewport (innerWidth × innerHeight), the layout size without scrollbars that media queries use, the whole window with toolbars, and which Tailwind breakpoint you're in. It's all read from your browser; nothing is sent or stored.",
    ],
    faqs: [
      { q: "Why is my resolution lower than my monitor's spec?", a: "Browsers report CSS pixels. With display scaling at 150% or on a Retina screen, a 2880 × 1800 panel reports 1440 × 900 with a pixel ratio of 2. The Physical row shows the panel's real count." },
      { q: "What's the difference between viewport and window size?", a: "The viewport is the area the page is drawn in. The window size adds the browser's tabs, address bar and borders. Responsive CSS responds to the viewport." },
      { q: "Does zooming the page change the numbers?", a: "Yes. Browser zoom changes the pixel ratio and the viewport size in CSS pixels, which is exactly what a page's media queries see." },
    ],
    see: ["screen-resolution-tester", "pixel-ruler", "my-ip"],
  },
  "screen-resolution-tester": {
    intro: [
      "Responsive tester loads a website inside 30+ real device frames (phones, tablets, laptops and monitors) at each device's real width in CSS pixels, so its layout and breakpoints behave as they would on that device. Rotate to landscape, zoom the frame to fit, or enter any custom size from 200 to 3,840 pixels.",
      "Use it to check a site you're building, or a page you're about to share, before it reaches real phones. Some sites (Google, banks, social networks) refuse to be shown inside another page and appear blank; that's their security setting, not your layout.",
    ],
    faqs: [
      { q: "Is this the same as testing on a real phone?", a: "It matches the layout: width, height and breakpoints. It runs in your browser's engine, so it won't reproduce engine-specific bugs, touch behaviour or the exact fonts of the device." },
      { q: "Can I test a site on localhost?", a: "Usually, if your dev server runs on the same computer: the preview loads in your own browser, and current Chrome, Edge and Firefox allow a localhost address inside this page. A local server that forbids framing will show blank." },
      { q: "Why is a site blank in the frame?", a: "It sends a header that forbids being shown inside another page (X-Frame-Options or a frame-ancestors policy). Your own site will show unless it does the same." },
    ],
    see: ["screen-resolution", "html-viewer", "pixel-ruler"],
  },
  "webcam-test": {
    intro: [
      "Webcam test turns on your camera in the browser and shows the picture along with what the camera reports: its name, resolution and frame rate. Pick another camera from the list if you have more than one, flip the mirror view, and save a still as a PNG.",
      "It's the quick check before a video call, an interview or a stream: is the camera found, is it the right one, and is it sending HD? The video stays on your device; nothing is recorded or uploaded.",
    ],
    faqs: [
      { q: "The camera won't start. What should I check?", a: "Allow camera access when the browser asks (or in the site settings by the address bar), close other apps that might be using the camera, and on Windows or macOS check the system's camera privacy settings for your browser." },
      { q: "Why is the resolution lower than my camera's spec?", a: "The browser asks for up to 1920 pixels wide, and the camera picks its closest mode. USB bandwidth, lighting (some cameras lower the frame rate in the dark) and other apps can also limit it." },
      { q: "Is my video recorded?", a: "No. The stream is shown on this page only. A still is saved only when you press the button, and straight to your device." },
    ],
    see: ["mic-speaker-test", "screen-recorder", "my-ip"],
  },
  "my-ip": {
    intro: [
      "What is my IP shows your public IP address, the one websites see when you visit, and whether it's IPv4 or IPv6. Under it is what the address says about your connection: an approximate location from your internet provider's address block, the time zone, your browser's user agent and preferred language.",
      "It's useful for setting up remote access or a firewall allow-list, checking that a VPN or proxy is working (the address and location should change), or giving support the details they ask for. The lookup isn't stored or logged.",
    ],
    faqs: [
      { q: "Why is the location wrong?", a: "IP locations come from the block of addresses your provider registered, not from your device, so they often point to the provider's nearest hub or another city. With a VPN, you'll see the VPN server's location." },
      { q: "Is this my device's IP address?", a: "It's your public address. Devices at home usually share it through the router and have their own private addresses (like 192.168.x.x) that only your network sees." },
      { q: "Why does my IP change?", a: "Most home and mobile providers assign addresses dynamically, so they can change when your router restarts or your phone reconnects. A fixed address is usually a paid option." },
    ],
    see: ["screen-resolution", "webcam-test", "mic-speaker-test"],
  },
};

function baseGuide(tool: Tool): Guide | undefined {
  if (GUIDES[tool.id]) return GUIDES[tool.id];
  if (DEV_AND_DEVICE_GUIDES[tool.id]) return DEV_AND_DEVICE_GUIDES[tool.id];
  const u = getUtility(tool.id);
  if (!u?.preset) return undefined;
  if (u.engine === "hash" && !u.preset.hmac) return hashGuide(tool, u.preset.alg);
  if (u.engine === "random") return randomGuide(tool, u.preset.kind);
  if ((u.engine === "format" || u.engine === "minify" || u.engine === "validate") && u.preset.lang) return codeGuide(tool, u.engine, u.preset.lang);
  return undefined;
}
