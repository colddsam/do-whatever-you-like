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
      "While it plays, the line being heard is highlighted so you can check it. Fix any line, then copy the transcript or download TXT, SRT or VTT subtitles, or JSON.",
    ],
    faqs: [
      { q: "Which languages are supported?", a: "99 languages. The language is detected automatically." },
      { q: "Can I make subtitles?", a: "Yes. Download SRT or VTT, the subtitle formats video players and YouTube accept." },
      { q: "How long can the recording be?", a: "Up to 3 hours and 150 MB." },
      { q: "Where is my recording processed?", a: "On our own server or through Groq's Whisper service; the tool tells you which. Either way, the recording is deleted afterwards." },
    ],
    see: ["audio", "youtube", "convert-anything"],
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
