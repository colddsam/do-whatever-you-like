import { clusterOf, exampleTasks, getCluster, tools, type Cluster, type ClusterId, type Tool } from "./tools";
import { STATIC_CATALOGUE } from "./universal";

export type ScoredToolMatch = {
  tool: Tool;
  score: number;
  matchReason: string;
  cluster: Cluster;
};

export type FormatRouteMatch = {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  dedicatedToolIds: string[];
  converterSupported: boolean;
};

export type TaskAvailability = {
  status: "idle" | "available" | "converter-route" | "coming-soon" | "unavailable";
  label: string;
  detail: string;
  liveMatches: number;
  totalMatches: number;
  topTool?: Tool;
  formatRoute?: { fromLabel: string; toLabel: string };
};

export type TaskSuggestion = {
  id: string;
  phrase: string;
  matchedPrefix: string;
  completion: string;
  tool?: Tool;
  cluster?: Cluster;
  available: boolean;
  kind: "task" | "tool" | "conversion";
};

export type TaskAnalysis = {
  results: ScoredToolMatch[];
  availability: TaskAvailability;
  suggestions: TaskSuggestion[];
  formatPair: FormatRouteMatch | null;
};

const STOP_WORDS = new Set([
  "i",
  "im",
  "ive",
  "id",
  "want",
  "wanna",
  "need",
  "needed",
  "would",
  "like",
  "how",
  "do",
  "does",
  "can",
  "could",
  "please",
  "help",
  "me",
  "my",
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "some",
  "any",
  "of",
  "is",
  "are",
  "was",
  "be",
  "there",
  "have",
  "has",
  "got",
  "with",
  "for",
  "in",
  "on",
  "at",
  "by",
  "as",
  "or",
  "and",
  "tool",
  "tools",
  "app",
  "apps",
  "site",
  "website",
  "page",
  "online",
  "free",
  "best",
  "way",
  "fast",
  "quick",
  "easy",
  "something",
  "work",
  "file",
  "files",
]);

/** Conversational glue stripped only after extraction when richer intent tokens remain. */
const GLUE_WORDS = new Set(["to", "into", "from", "out", "up", "off", "make", "get", "put", "turn", "change", "using", "use"]);

const IRREGULAR_STEMS: Record<string, string> = {
  pdfs: "pdf",
  images: "image",
  pictures: "picture",
  pics: "pic",
  photos: "photo",
  videos: "video",
  audios: "audio",
  songs: "song",
  documents: "document",
  docs: "doc",
  pages: "page",
  words: "word",
  numbers: "number",
  digits: "digit",
  colours: "color",
  colour: "color",
  colors: "color",
  fonts: "font",
  icons: "icon",
  favicons: "favicon",
  subtitles: "subtitle",
  captions: "caption",
  memes: "meme",
  gifs: "gif",
  emojis: "emoji",
  charts: "chart",
  graphs: "graph",
  diagrams: "diagram",
  flowcharts: "flowchart",
  passwords: "password",
  hashes: "hash",
  tokens: "token",
  headers: "header",
  periods: "period",
  cycles: "cycle",
  spreadsheets: "spreadsheet",
  sheets: "sheet",
  slides: "slide",
  presentations: "presentation",
  archives: "archive",
  qrcodes: "qr",
  qrcode: "qr",
  barcodes: "barcode",
  utilities: "utility",
  compressing: "compress",
  compressed: "compress",
  compressor: "compress",
  compression: "compress",
  optimizing: "optimize",
  optimized: "optimize",
  optimizer: "optimize",
  optimising: "optimize",
  merging: "merge",
  merged: "merge",
  merger: "merge",
  combining: "combine",
  combined: "combine",
  splitting: "split",
  splitter: "split",
  converting: "convert",
  converted: "convert",
  converter: "convert",
  conversion: "convert",
  downloading: "download",
  downloaded: "download",
  downloader: "download",
  transcribing: "transcribe",
  transcribed: "transcribe",
  transcriber: "transcribe",
  transcription: "transcribe",
  translating: "translate",
  translated: "translate",
  translator: "translate",
  translation: "translate",
  summarizing: "summarize",
  summarized: "summarize",
  summarizer: "summarize",
  summarising: "summarize",
  summarised: "summarize",
  summariser: "summarize",
  summary: "summarize",
  formatting: "format",
  formatted: "format",
  formatter: "format",
  minifying: "minify",
  minified: "minify",
  minifier: "minify",
  validating: "validate",
  validated: "validate",
  validator: "validate",
  validation: "validate",
  encoding: "encode",
  encoded: "encode",
  encoder: "encode",
  decoding: "decode",
  decoded: "decode",
  decoder: "decode",
  encrypting: "encrypt",
  encrypted: "encrypt",
  encryption: "encrypt",
  decrypting: "decrypt",
  decrypted: "decrypt",
  decryption: "decrypt",
  removing: "remove",
  removed: "remove",
  remover: "remove",
  blurring: "blur",
  blurred: "blur",
  cropping: "crop",
  cropped: "crop",
  resizing: "resize",
  resized: "resize",
  rotating: "rotate",
  rotated: "rotate",
  rotation: "rotate",
  recording: "record",
  recorded: "record",
  recorder: "record",
  scanning: "scan",
  scanned: "scan",
  scanner: "scan",
  signing: "sign",
  signed: "sign",
  signature: "sign",
  protecting: "protect",
  protected: "protect",
  protection: "protect",
  unlocking: "unlock",
  unlocked: "unlock",
  redacting: "redact",
  redacted: "redact",
  redaction: "redact",
  comparing: "compare",
  compared: "compare",
  comparison: "compare",
  upscaling: "upscale",
  upscaled: "upscale",
  upscaler: "upscale",
  trimming: "trim",
  trimmed: "trim",
  denoising: "denoise",
  denoised: "denoise",
  generating: "generate",
  generated: "generate",
  generator: "generate",
  creating: "create",
  created: "create",
  creator: "create",
  calculating: "calculate",
  calculated: "calculate",
  calculator: "calculate",
  analyzing: "analyze",
  analyzed: "analyze",
  analyzer: "analyze",
  analysing: "analyze",
  analysed: "analyze",
  analyser: "analyze",
  extracting: "extract",
  extracted: "extract",
  extractor: "extract",
  repairing: "repair",
  repaired: "repair",
  watermarking: "watermark",
  watermarked: "watermark",
  pixelating: "pixelate",
  pixelated: "pixelate",
  vectorizing: "vectorize",
  vectorised: "vectorize",
  vectoriser: "vectorize",
  vectorizer: "vectorize",
  organizing: "organize",
  organized: "organize",
  organising: "organize",
  reordering: "reorder",
  rearranging: "rearrange",
  editing: "edit",
  edited: "edit",
  editor: "edit",
  checking: "check",
  checked: "check",
  checker: "check",
  smaller: "small",
  louder: "loud",
  quieter: "quiet",
  reels: "reel",
  shorts: "short",
  faces: "face",
  frames: "frame",
  timestamps: "timestamp",
  emails: "email",
  links: "link",
  urls: "url",
  tags: "tag",
  tables: "table",
  boxes: "box",
  shadows: "shadow",
  gradients: "gradient",
  palettes: "palette",
  regexes: "regex",
  crons: "cron",
  invoices: "invoice",
  bills: "bill",
  taxes: "tax",
  loans: "loan",
};

const PRESERVE_S_ENDINGS = new Set(["css", "scss", "less", "js", "ts", "jsx", "tsx", "rss", "xls", "xlsx", "docx", "pptx", "ics", "vps", "dns", "https", "fps", "bps", "ios", "macos", "aws"]);

export function stemToken(raw: string): string {
  const clean = raw.toLowerCase().replace(/^['"`.]+|['"`.?!,;:/]+$/g, "");
  if (!clean) return "";
  if (IRREGULAR_STEMS[clean]) return IRREGULAR_STEMS[clean];
  if (clean.length > 5 && clean.endsWith("ies")) return `${clean.slice(0, -3)}y`;
  if (clean.length > 6 && clean.endsWith("ing") && !clean.endsWith("string")) return clean.slice(0, -3);
  if (clean.length > 5 && clean.endsWith("ed") && !clean.endsWith("eed")) return clean.slice(0, -2);
  if (
    clean.length > 4 &&
    clean.endsWith("s") &&
    !clean.endsWith("ss") &&
    !clean.endsWith("us") &&
    !clean.endsWith("is") &&
    !PRESERVE_S_ENDINGS.has(clean)
  ) {
    return clean.slice(0, -1);
  }
  return clean;
}

function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.+_-]+/)
    .flatMap((part) => (part.includes(".") && part !== "tar.gz" ? [part, ...part.split(".")] : [part]))
    .map((p) => p.replace(/^-+|-+$/g, ""))
    .filter(Boolean);
}

/** Word-level synonyms connecting user task wording to the site's vocabulary. */
const SYNONYM_GRAPH: Record<string, string[]> = {
  shrink: ["compress", "reduce", "optimize", "small", "minify"],
  small: ["compress", "shrink", "reduce", "minify"],
  lightweight: ["compress", "shrink", "reduce", "optimize"],
  filesize: ["compress", "size", "reduce"],
  size: ["compress", "resize", "dimension", "pixel"],
  mb: ["compress", "size"],
  kb: ["compress", "size"],
  email: ["compress", "smaller", "eml"],
  combine: ["merge", "join", "concat", "stack"],
  join: ["merge", "combine", "concat"],
  concat: ["merge", "combine"],
  stitch: ["merge", "combine"],
  append: ["merge", "combine"],
  separate: ["split", "extract", "divide"],
  divide: ["split", "separate"],
  chop: ["split", "trim", "cut"],
  cut: ["crop", "trim", "split", "cutout"],
  cutout: ["remove", "background", "transparent", "eraser"],
  transparent: ["remove-background", "background", "png", "opacity"],
  backdrop: ["background", "remove"],
  bg: ["background", "remove-background"],
  hide: ["redact", "blur", "pixelate", "censor", "exif"],
  censor: ["redact", "blur", "pixelate", "hide"],
  anonymize: ["redact", "blur", "pixelate", "exif"],
  anonymise: ["redact", "blur", "pixelate", "exif"],
  blackout: ["redact", "censor"],
  mask: ["redact", "blur"],
  obscure: ["blur", "pixelate", "redact"],
  searchable: ["ocr", "scan", "text"],
  scanned: ["ocr", "scan", "pdf"],
  voice: ["audio", "transcribe", "microphone", "recorder", "speech"],
  speech: ["transcribe", "audio-to-text", "translator", "voice"],
  dictate: ["transcribe", "audio-to-text"],
  dictation: ["transcribe", "audio-to-text"],
  meeting: ["transcribe", "audio-to-text", "world-clock"],
  lecture: ["transcribe", "audio-to-text"],
  podcast: ["transcribe", "noise-remover", "audio-waveform"],
  noise: ["noise-remover", "denoise", "hiss", "clean"],
  hiss: ["noise-remover", "denoise"],
  hum: ["noise-remover", "denoise"],
  static: ["noise-remover", "denoise"],
  loud: ["volume", "boost", "normalize", "amplify"],
  volume: ["audio-volume", "boost", "loud", "mute"],
  amplify: ["audio-volume", "volume"],
  mute: ["audio-volume", "silent"],
  silent: ["audio-volume", "mute"],
  rip: ["mp3", "audio", "extract"],
  song: ["mp3", "audio", "youtube"],
  music: ["mp3", "audio", "youtube"],
  save: ["download", "export"],
  grab: ["download"],
  ig: ["instagram", "reel"],
  insta: ["instagram", "reel"],
  yt: ["youtube", "video"],
  fb: ["facebook", "video"],
  reel: ["instagram", "facebook", "youtube", "download"],
  short: ["youtube", "download"],
  tiktok: ["mockup", "video"],
  beautify: ["format", "prettify", "indent"],
  prettify: ["format", "beautify"],
  pretty: ["format", "beautify"],
  indent: ["format", "beautify"],
  lint: ["validate", "checker"],
  syntax: ["validate", "formatter"],
  token: ["jwt", "bearer"],
  bearer: ["jwt", "decoder"],
  checksum: ["hash", "sha256", "md5", "crc32"],
  digest: ["hash", "sha256"],
  http: ["api", "header", "status", "url"],
  rest: ["api", "json"],
  endpoint: ["api", "http"],
  curl: ["api", "http"],
  ssl: ["http", "headers"],
  paraphrase: ["writing", "rewrite"],
  rewrite: ["writing", "grammar"],
  grammar: ["writing", "proofread"],
  proofread: ["writing", "grammar"],
  tldr: ["summarizer", "summarize"],
  condense: ["summarize", "compress"],
  dub: ["translator", "dubbing", "voiceover"],
  dubbing: ["translator", "audio", "video"],
  loan: ["emi", "calculator"],
  mortgage: ["emi", "calculator"],
  emi: ["emi-sip-calculator", "loan"],
  interest: ["emi-sip-calculator", "sip-calculator"],
  tax: ["gst", "invoice"],
  gst: ["gst-percentage-calculator", "invoice"],
  vat: ["gst-percentage-calculator"],
  dinner: ["bill-splitter", "split"],
  trip: ["bill-splitter"],
  splitwise: ["bill-splitter"],
  tip: ["bill-splitter", "percentage"],
  period: ["period-tracker", "cycle", "menstrual"],
  menstrual: ["period-tracker", "cycle"],
  ovulation: ["period-tracker", "cycle"],
  cycle: ["period-tracker", "period"],
  wifi: ["qr", "qr-scanner"],
  vcard: ["qr"],
  swatch: ["color-picker", "palette"],
  eyedropper: ["color-picker", "hex"],
  wcag: ["contrast-checker", "accessibility"],
  a11y: ["contrast-checker", "accessibility"],
  diagram: ["flowchart-maker", "chart-maker"],
  mindmap: ["flowchart-maker"],
  mermaid: ["flowchart-maker", "markdown-editor"],
  plot: ["chart-maker", "graph"],
  bar: ["chart-maker", "qr"],
  pie: ["chart-maker"],
  typeface: ["font-creator", "font-checker"],
  handwriting: ["font-creator"],
  favicon: ["icon-maker", "ico"],
  vectorize: ["image-to-svg", "svg"],
  vector: ["image-to-svg", "svg"],
  iphone: ["convert-to-jpg", "heic", "mockup-frame-generator"],
  screenshot: ["html-to-image", "mockup-frame-generator", "screen-recorder"],
  archive: ["archive-extractor-creator", "pdf-to-pdfa", "zip"],
  unzip: ["archive-extractor-creator", "zip"],
  extract: ["extract-pages", "archive-extractor-creator", "audio"],
  enlarge: ["upscale-image", "resize-image"],
  blurry: ["upscale-image"],
  resolution: ["upscale-image", "resize-image", "screen-resolution"],
  face: ["blur-face"],
  mosaic: ["pixelate-image", "pixel"],
  exif: ["exif-remover", "metadata", "gps"],
  gps: ["exif-remover"],
  metadata: ["exif-remover", "font-checker"],
  cron: ["cron-explainer", "schedule"],
  permissions: ["chmod-calculator"],
  sqlite: ["sqlite-csv-parquet-viewer"],
  parquet: ["sqlite-csv-parquet-viewer"],
  whatsapp: ["whatsapp-chat-analyzer"],
  binary: ["text-to-binary", "binary-to-text", "random-binary"],
  morse: ["morse-code", "morse-audio-decoder"],
  invoice: ["invoice-signature-generator", "gst"],
  signature: ["sign-pdf", "invoice-signature-generator"],
  sign: ["sign-pdf", "invoice-signature-generator"],
  waveform: ["audio-waveform-generator"],
  spectrogram: ["audio-waveform-generator"],
  stopwatch: ["stopwatch", "timer"],
  countdown: ["stopwatch", "pomodoro-timer"],
  focus: ["pomodoro-timer"],
  age: ["age-calculator", "birthday"],
  birthday: ["age-calculator", "date-calculator"],
  timezone: ["world-clock"],
  currency: ["currency-converter", "exchange"],
  forex: ["currency-converter"],
  webcam: ["webcam-test", "camera"],
  mic: ["mic-speaker-test", "audio-to-text", "screen-recorder"],
  speaker: ["mic-speaker-test", "audio-volume"],
  pixel: ["pixel-ruler", "dead-pixel-test", "pixelate-image", "resize-image"],
  glassmorphism: ["glassmorphism-generator"],
  neumorphism: ["neumorphism-generator"],
  flexbox: ["css-grid-flexbox-playground"],
  grid: ["css-grid-flexbox-playground", "organize-pdf"],
};

type IntentRule = {
  phrases: string[];
  boostIds: string[];
  reason: string;
};

const INTENT_RULES: IntentRule[] = [
  {
    phrases: ["shrink pdf", "smaller pdf", "reduce pdf size", "pdf for email", "compress pdf"],
    boostIds: ["compress-pdf", "compress-files"],
    reason: "Shrinks PDF file size",
  },
  {
    phrases: ["merge pdf", "combine pdf", "join pdf"],
    boostIds: ["merge-pdf", "pdf"],
    reason: "Combines multiple PDFs in order",
  },
  {
    phrases: ["split pdf", "separate pdf", "extract pdf page", "cut pdf pages"],
    boostIds: ["split-pdf", "extract-pages", "remove-pages"],
    reason: "Splits or extracts PDF pages",
  },
  {
    phrases: ["cut out background", "remove background", "erase background", "transparent background", "white background", "remove bg", "cut out subject", "cut out person"],
    boostIds: ["remove-background", "image"],
    reason: "Isolates subject with transparent or solid backdrop",
  },
  {
    phrases: ["voice to text", "speech to text", "transcribe audio", "transcribe video", "meeting notes", "audio recording to text", "turn voice into text"],
    boostIds: ["audio-to-text", "morse-audio-decoder"],
    reason: "Whisper transcription in 99 languages",
  },
  {
    phrases: ["remove hiss", "background noise", "clean audio", "noise from video", "fan noise"],
    boostIds: ["noise-remover"],
    reason: "Removes hiss, hum and room noise",
  },
  {
    phrases: ["make audio louder", "boost volume", "mute video", "remove sound from video", "quiet audio"],
    boostIds: ["audio-volume"],
    reason: "Boosts loudness, normalises or mutes video",
  },
  {
    phrases: ["instagram reel", "save reel", "download reel", "ig video"],
    boostIds: ["instagram"],
    reason: "Saves public Instagram reels, posts & audio",
  },
  {
    phrases: ["youtube video", "youtube shorts", "youtube to mp3", "save youtube"],
    boostIds: ["youtube"],
    reason: "Saves YouTube video (up to 1080p) or MP3",
  },
  {
    phrases: ["facebook video", "facebook reel", "fb reel"],
    boostIds: ["facebook"],
    reason: "Saves public Facebook videos & reels",
  },
  {
    phrases: ["blur face", "hide face", "hide license plate", "censor photo", "censor image"],
    boostIds: ["blur-face", "pixelate-image"],
    reason: "Auto-detects and obscures faces or areas",
  },
  {
    phrases: ["black out", "hide sensitive", "censor pdf", "hide credit card", "hide email in pdf", "redact"],
    boostIds: ["redact-pdf"],
    reason: "Permanently removes sensitive PDF details",
  },
  {
    phrases: ["strip exif", "remove gps", "photo location", "remove metadata"],
    boostIds: ["exif-remover"],
    reason: "Inspects & strips EXIF camera and GPS data",
  },
  {
    phrases: ["pretty print json", "format json", "validate json", "json tree"],
    boostIds: ["json-formatter", "dev"],
    reason: "Formats, validates and browses JSON",
  },
  {
    phrases: ["decode jwt", "verify jwt", "bearer token", "inspect token"],
    boostIds: ["jwt-decoder", "dev"],
    reason: "Decodes & verifies JWT claims locally",
  },
  {
    phrases: ["wifi qr", "qr code", "make qr"],
    boostIds: ["qr", "qr-scanner"],
    reason: "Creates styled QR codes for links, Wi-Fi & contacts",
  },
  {
    phrases: ["split bill", "dinner bill", "trip expense", "who owes whom"],
    boostIds: ["bill-splitter"],
    reason: "Calculates minimum transfers & WhatsApp bill splits",
  },
  {
    phrases: ["loan emi", "home loan", "compound interest", "monthly payment"],
    boostIds: ["emi-sip-calculator", "sip-calculator"],
    reason: "EMI, prepayment & compound interest schedule",
  },
  {
    phrases: ["track period", "next period", "menstrual cycle", "ovulation"],
    boostIds: ["period-tracker"],
    reason: "On-device private period & cycle tracker",
  },
  {
    phrases: ["translate video", "translate audio", "dub video", "translate text"],
    boostIds: ["translator", "subtitle-editor"],
    reason: "Translates text, spoken audio & video in 100+ languages",
  },
  {
    phrases: ["whatsapp chat", "whatsapp stats", "export chat", "chat analysis"],
    boostIds: ["whatsapp-chat-analyzer"],
    reason: "Private chat heatmaps, stats & emoji insights",
  },
  {
    phrases: ["make favicon", "app icon", "ico file", "windows icon"],
    boostIds: ["icon-maker"],
    reason: "Generates favicon.ico, macOS, iOS & Android icons",
  },
  {
    phrases: ["vectorize logo", "png to svg", "jpg to svg", "trace svg"],
    boostIds: ["image-to-svg", "svg-optimizer-jsx"],
    reason: "Traces raster logos cleanly into SVG vectors",
  },
  {
    phrases: ["extract zip", "open zip", "create zip", "tar gz", "unzip"],
    boostIds: ["archive-extractor-creator", "compress-files"],
    reason: "Inspects or bundles ZIP, TAR and GZ archives",
  },
  {
    phrases: ["read text from pdf", "scanned pdf", "searchable pdf", "image to text"],
    boostIds: ["ocr-pdf", "scan-to-pdf"],
    reason: "Runs OCR in 100+ languages on scans",
  },
  {
    phrases: ["summarize text", "rewrite text", "fix grammar", "proofread"],
    boostIds: ["writing", "text-summarizer"],
    reason: "Summarises, rewrites and proofreads in browser",
  },
  {
    phrases: ["make a chart", "bar chart", "pie chart", "line graph", "plot data"],
    boostIds: ["chart-maker"],
    reason: "Builds 30+ chart types with animated exports",
  },
  {
    phrases: ["make a flowchart", "draw diagram", "process diagram", "mermaid diagram"],
    boostIds: ["flowchart-maker"],
    reason: "Drag-and-drop & Mermaid flowcharts with SVG export",
  },
  {
    phrases: ["frame screenshot", "device frame", "browser frame", "safe zone", "youtube thumbnail"],
    boostIds: ["mockup-frame-generator", "html-to-image"],
    reason: "Frames screenshots & previews Reels/YouTube safe zones",
  },
];

const FORMAT_ALIASES: Record<string, string> = {
  word: "docx",
  doc: "docx",
  docx: "docx",
  excel: "xlsx",
  spreadsheet: "xlsx",
  xlsx: "xlsx",
  xls: "xls",
  powerpoint: "pptx",
  ppt: "pptx",
  pptx: "pptx",
  slides: "pptx",
  pdf: "pdf",
  markdown: "md",
  md: "md",
  text: "txt",
  txt: "txt",
  jpeg: "jpg",
  jpg: "jpg",
  photo: "jpg",
  picture: "jpg",
  image: "png",
  images: "png",
  png: "png",
  webp: "webp",
  heic: "heic",
  iphone: "heic",
  svg: "svg",
  vector: "svg",
  gif: "gif",
  video: "mp4",
  mp4: "mp4",
  mov: "mov",
  mkv: "mkv",
  webm: "webm",
  avi: "avi",
  audio: "mp3",
  mp3: "mp3",
  wav: "wav",
  flac: "flac",
  m4a: "m4a",
  ogg: "ogg",
  subtitle: "srt",
  subtitles: "srt",
  captions: "srt",
  srt: "srt",
  vtt: "vtt",
  epub: "epub",
  ebook: "epub",
  html: "html",
  htm: "html",
  csv: "csv",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  toml: "toml",
  sql: "sql",
  zip: "zip",
  "7zip": "7z",
  "7z": "7z",
  tar: "tar.gz",
  "tar.gz": "tar.gz",
  tgz: "tar.gz",
  ttf: "ttf",
  otf: "otf",
  woff: "woff",
  woff2: "woff2",
  ico: "ico",
  icon: "ico",
  favicon: "ico",
  avif: "avif",
  tiff: "tiff",
  tif: "tiff",
  rtf: "rtf",
  odt: "odt",
  eml: "eml",
  ipynb: "ipynb",
  notebook: "ipynb",
  latex: "tex",
  tex: "tex",
  binary: "binary",
  morse: "morse",
  hex: "hex",
};

const PAIR_DEDICATED_TOOLS: Record<string, string[]> = {
  "pdf->docx": ["pdf-to-word", "convert-anything"],
  "pdf->xlsx": ["pdf-to-excel", "convert-anything"],
  "pdf->pptx": ["pdf-to-powerpoint", "convert-anything"],
  "pdf->jpg": ["pdf-to-jpg", "convert-anything"],
  "pdf->png": ["pdf-to-jpg", "convert-anything"],
  "docx->pdf": ["word-to-pdf", "convert-anything"],
  "odt->pdf": ["word-to-pdf", "convert-anything"],
  "rtf->pdf": ["word-to-pdf", "convert-anything"],
  "pptx->pdf": ["powerpoint-to-pdf", "convert-anything"],
  "xlsx->pdf": ["excel-to-pdf", "convert-anything"],
  "csv->pdf": ["excel-to-pdf", "convert-anything"],
  "jpg->pdf": ["jpg-to-pdf", "convert-anything"],
  "png->pdf": ["jpg-to-pdf", "convert-anything"],
  "webp->pdf": ["jpg-to-pdf", "convert-anything"],
  "heic->jpg": ["convert-to-jpg", "convert-anything"],
  "png->jpg": ["convert-to-jpg", "convert-anything"],
  "webp->jpg": ["convert-to-jpg", "convert-anything"],
  "svg->jpg": ["convert-to-jpg", "convert-anything"],
  "tiff->jpg": ["convert-to-jpg", "convert-anything"],
  "jpg->png": ["jpg-to-image", "convert-anything"],
  "jpg->webp": ["jpg-to-image", "convert-anything"],
  "jpg->gif": ["jpg-to-image", "convert-anything"],
  "html->pdf": ["html-to-pdf", "convert-anything"],
  "html->jpg": ["html-to-image", "convert-anything"],
  "html->png": ["html-to-image", "convert-anything"],
  "mp4->mp3": ["audio", "convert-anything"],
  "mov->mp3": ["audio", "convert-anything"],
  "mkv->mp3": ["audio", "convert-anything"],
  "webm->mp3": ["audio", "convert-anything"],
  "avi->mp3": ["audio", "convert-anything"],
  "mp4->gif": ["video-to-gif", "convert-anything"],
  "mov->gif": ["video-to-gif", "convert-anything"],
  "webm->gif": ["video-to-gif", "convert-anything"],
  "mp4->jpg": ["video-to-frames"],
  "mp4->png": ["video-to-frames"],
  "png->svg": ["image-to-svg", "convert-anything"],
  "jpg->svg": ["image-to-svg", "convert-anything"],
  "png->ico": ["icon-maker"],
  "svg->ico": ["icon-maker"],
  "jpg->ico": ["icon-maker"],
  "json->csv": ["json-to-csv", "data-format-converter", "convert-anything"],
  "csv->json": ["csv-to-json", "data-format-converter", "convert-anything"],
  "json->yaml": ["json-to-yaml", "data-format-converter", "convert-anything"],
  "yaml->json": ["yaml-to-json", "data-format-converter", "convert-anything"],
  "json->xml": ["json-to-xml", "data-format-converter", "convert-anything"],
  "xml->json": ["xml-to-json", "data-format-converter", "convert-anything"],
  "html->md": ["html-to-markdown", "data-format-converter", "convert-anything"],
  "md->html": ["markdown-to-html", "data-format-converter", "convert-anything"],
  "mp3->txt": ["audio-to-text", "translator"],
  "wav->txt": ["audio-to-text", "translator"],
  "txt->binary": ["text-to-binary"],
  "binary->txt": ["binary-to-text"],
  "txt->hex": ["text-to-hex"],
  "hex->txt": ["hex-to-text"],
  "txt->morse": ["morse-code"],
  "morse->txt": ["morse-code", "morse-audio-decoder"],
  "txt->png": ["text-to-image"],
};

const CURATED_TASK_SUGGESTIONS: Array<{ phrase: string; toolId: string; kind: "task" | "conversion" }> = [
  { phrase: "compress pdf smaller for email", toolId: "compress-pdf", kind: "task" },
  { phrase: "merge multiple pdfs into one", toolId: "merge-pdf", kind: "task" },
  { phrase: "split pdf pages into separate files", toolId: "split-pdf", kind: "task" },
  { phrase: "convert pdf to editable word document", toolId: "pdf-to-word", kind: "conversion" },
  { phrase: "convert epub to pdf", toolId: "convert-anything", kind: "conversion" },
  { phrase: "convert heic iphone photo to jpg", toolId: "convert-to-jpg", kind: "conversion" },
  { phrase: "remove background from photo transparently", toolId: "remove-background", kind: "task" },
  { phrase: "blur faces or hide details in photo", toolId: "blur-face", kind: "task" },
  { phrase: "download instagram reel or save audio mp3", toolId: "instagram", kind: "task" },
  { phrase: "save youtube video or mp3 audio", toolId: "youtube", kind: "task" },
  { phrase: "transcribe voice or audio recording to text", toolId: "audio-to-text", kind: "task" },
  { phrase: "remove background noise and hiss from audio", toolId: "noise-remover", kind: "task" },
  { phrase: "turn a video clip into an animated gif", toolId: "video-to-gif", kind: "conversion" },
  { phrase: "translate text, audio or video into 100+ languages", toolId: "translator", kind: "task" },
  { phrase: "analyze exported whatsapp chat stats", toolId: "whatsapp-chat-analyzer", kind: "task" },
  { phrase: "format and validate messy json", toolId: "json-formatter", kind: "task" },
  { phrase: "decode and verify jwt bearer token", toolId: "jwt-decoder", kind: "task" },
  { phrase: "make a qr code for wifi or link", toolId: "qr", kind: "task" },
  { phrase: "make website favicon and app icons", toolId: "icon-maker", kind: "task" },
  { phrase: "vectorize png or jpg logo to svg", toolId: "image-to-svg", kind: "conversion" },
  { phrase: "create animated bar, pie or line chart", toolId: "chart-maker", kind: "task" },
  { phrase: "draw flowchart or mermaid diagram", toolId: "flowchart-maker", kind: "task" },
  { phrase: "track menstrual period and cycle privately", toolId: "period-tracker", kind: "task" },
  { phrase: "split trip expenses or restaurant bill", toolId: "bill-splitter", kind: "task" },
  { phrase: "calculate home loan emi or compound interest", toolId: "emi-sip-calculator", kind: "task" },
  { phrase: "extract or create zip and tar.gz archives", toolId: "archive-extractor-creator", kind: "task" },
  { phrase: "strip hidden gps exif data from photos", toolId: "exif-remover", kind: "task" },
  { phrase: "black out sensitive details in pdf", toolId: "redact-pdf", kind: "task" },
  { phrase: "summarize long article or fix grammar", toolId: "writing", kind: "task" },
  { phrase: "check website http headers and dns records", toolId: "dns-lookup", kind: "task" },
];

type IndexedTool = {
  tool: Tool;
  cluster: Cluster;
  nameLower: string;
  keywordPhrases: string[];
  nameWords: Set<string>;
  keywordWords: Set<string>;
  specWords: Set<string>;
  descWords: Set<string>;
  allTextLower: string;
};

type SearchIndex = {
  entries: IndexedTool[];
  byId: Map<string, IndexedTool>;
  suggestionsPool: Array<{
    phrase: string;
    lower: string;
    words: Set<string>;
    tool?: Tool;
    cluster?: Cluster;
    available: boolean;
    kind: "task" | "tool" | "conversion";
  }>;
};

let cachedIndex: SearchIndex | null = null;

function toWordSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of tokenizeText(text)) {
    out.add(raw);
    const stem = stemToken(raw);
    if (stem) out.add(stem);
  }
  return out;
}

function getSearchIndex(): SearchIndex {
  if (cachedIndex) return cachedIndex;

  const entries: IndexedTool[] = tools.map((tool) => {
    const cluster = getCluster(clusterOf(tool));
    const keywordPhrases = tool.keywords.map((k) => k.toLowerCase());
    const specText = [tool.takes, tool.gives, tool.category, tool.group ?? "", cluster.name, cluster.title].join(" ");
    const descText = [tool.description, ...tool.features].join(" ");
    const nameWords = toWordSet(tool.name);
    // Include hyphen-split id pieces (e.g. "remove-background" -> "remove", "background")
    for (const part of tool.id.split("-")) {
      nameWords.add(part);
      const s = stemToken(part);
      if (s) nameWords.add(s);
    }

    return {
      tool,
      cluster,
      nameLower: tool.name.toLowerCase(),
      keywordPhrases,
      nameWords,
      keywordWords: toWordSet(keywordPhrases.join(" ")),
      specWords: toWordSet(specText),
      descWords: toWordSet(descText),
      allTextLower: [tool.name, ...keywordPhrases, specText, tool.description].join(" ").toLowerCase(),
    };
  });

  const byId = new Map(entries.map((e) => [e.tool.id, e]));

  const seenPhrases = new Set<string>();
  const suggestionsPool: SearchIndex["suggestionsPool"] = [];

  const pushSuggestion = (
    phrase: string,
    kind: "task" | "tool" | "conversion",
    tool?: Tool,
  ) => {
    const clean = phrase.trim();
    const lower = clean.toLowerCase();
    if (!clean || seenPhrases.has(lower)) return;
    seenPhrases.add(lower);
    suggestionsPool.push({
      phrase: clean,
      lower,
      words: toWordSet(lower),
      tool,
      cluster: tool ? getCluster(clusterOf(tool)) : undefined,
      available: tool ? tool.status === "live" : true,
      kind,
    });
  };

  for (const item of CURATED_TASK_SUGGESTIONS) {
    const entry = byId.get(item.toolId);
    pushSuggestion(item.phrase, item.kind, entry?.tool);
  }

  for (const ex of exampleTasks) {
    const rankedTop = rankEntriesInternal(ex, entries, byId)[0]?.tool;
    pushSuggestion(ex, /\bto\b|\binto\b/.test(ex) ? "conversion" : "task", rankedTop);
  }

  for (const entry of entries) {
    pushSuggestion(entry.tool.name, /\bto\b/.test(entry.nameLower) ? "conversion" : "tool", entry.tool);
  }

  cachedIndex = { entries, byId, suggestionsPool };
  return cachedIndex;
}

function resolveFormatAlias(raw: string): string | null {
  const clean = raw.toLowerCase().trim().replace(/^\./, "");
  if (!clean) return null;
  if (FORMAT_ALIASES[clean]) return FORMAT_ALIASES[clean];
  if (STATIC_CATALOGUE.formats[clean]) return clean;
  return null;
}

function formatLabel(fmtId: string): string {
  return STATIC_CATALOGUE.formats[fmtId]?.id.toUpperCase() ?? fmtId.toUpperCase();
}

export function detectFormatPair(query: string): FormatRouteMatch | null {
  const cleaned = query
    .toLowerCase()
    .replace(/[→⇒➡]+/g, " to ")
    .replace(/->/g, " to ")
    .replace(/\b(?:convert|turn|change|export|save)\b/g, " ")
    .replace(/\b(?:into|as)\b/g, " to ")
    .replace(/\bfrom\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(/\b([a-z0-9.+_-]{2,12})\s+to\s+([a-z0-9.+_-]{2,12})\b/);
  if (!match) return null;

  const fromId = resolveFormatAlias(match[1]);
  const toId = resolveFormatAlias(match[2]);
  if (!fromId || !toId || fromId === toId) return null;

  const pairKey = `${fromId}->${toId}`;
  const dedicatedToolIds = PAIR_DEDICATED_TOOLS[pairKey] ?? [];
  const converterSupported = Boolean(STATIC_CATALOGUE.routes[fromId]?.some((r) => r.target === toId));
  if (!converterSupported && dedicatedToolIds.length === 0) return null;

  return {
    fromId,
    toId,
    fromLabel: formatLabel(fromId),
    toLabel: formatLabel(toId),
    dedicatedToolIds,
    converterSupported,
  };
}

function matchStrength(rawToken: string, stemmedToken: string, wordSet: Set<string>, rawText: string): number {
  if (wordSet.has(rawToken) || (stemmedToken && wordSet.has(stemmedToken))) return 1;
  if (rawToken.length <= 2) return 0;

  for (const w of wordSet) {
    if (w.startsWith(rawToken) || (stemmedToken.length >= 3 && w.startsWith(stemmedToken))) {
      return 0.78;
    }
  }
  if (rawToken.length >= 4 && rawText.includes(rawToken)) {
    return 0.55;
  }
  return 0;
}

function rankEntriesInternal(
  query: string,
  entries: IndexedTool[],
  byId: Map<string, IndexedTool>,
  options?: { contextClusterId?: ClusterId; currentToolId?: string },
): ScoredToolMatch[] {
  const qLower = query.trim().toLowerCase();
  if (!qLower) return [];

  const formatPair = detectFormatPair(qLower);
  const rawParts = tokenizeText(qLower);
  const withoutStop = rawParts.filter((t) => !STOP_WORDS.has(t));
  const meaningful = withoutStop.filter((t) => !GLUE_WORDS.has(t));
  const queryTokens = meaningful.length > 0 ? meaningful : withoutStop.length > 0 ? withoutStop : rawParts;

  if (queryTokens.length === 0 && !formatPair) return [];

  const stemmedTokens = queryTokens.map(stemToken).filter(Boolean);
  const queryNoNoise = queryTokens.join(" ");

  // Collect intent rule boosts triggered by natural-language phrases
  const intentBoostMap = new Map<string, { boost: number; reason: string }>();
  for (const rule of INTENT_RULES) {
    if (rule.phrases.some((p) => qLower.includes(p) || queryNoNoise.includes(p))) {
      rule.boostIds.forEach((id, idx) => {
        const prev = intentBoostMap.get(id);
        const boost = 26 - idx * 4;
        if (!prev || boost > prev.boost) {
          intentBoostMap.set(id, { boost, reason: rule.reason });
        }
      });
    }
  }

  // Expand synonym concepts from query tokens
  const expandedConcepts = new Set<string>();
  for (let i = 0; i < queryTokens.length; i++) {
    const raw = queryTokens[i];
    const stem = stemmedTokens[i] ?? raw;
    for (const syn of SYNONYM_GRAPH[raw] ?? []) expandedConcepts.add(syn);
    for (const syn of SYNONYM_GRAPH[stem] ?? []) expandedConcepts.add(syn);
  }

  const scored: ScoredToolMatch[] = [];

  for (const entry of entries) {
    let score = 0;
    let directHits = 0;
    let matchedNameOrKeyword = false;
    let matchReason = "";

    // 1. Format-pair boost & reason
    if (formatPair) {
      const dedicatedIdx = formatPair.dedicatedToolIds.indexOf(entry.tool.id);
      if (dedicatedIdx >= 0) {
        score += 46 - dedicatedIdx * 6;
        directHits = queryTokens.length;
        matchedNameOrKeyword = true;
        matchReason = `Converts ${formatPair.fromLabel} → ${formatPair.toLabel}`;
      } else if (entry.tool.id === "convert-anything" && formatPair.converterSupported) {
        score += 40;
        directHits = queryTokens.length;
        matchedNameOrKeyword = true;
        matchReason = `Converts ${formatPair.fromLabel} → ${formatPair.toLabel}`;
      }
    }

    // 2. Intent phrase boost
    const intentBoost = intentBoostMap.get(entry.tool.id);
    if (intentBoost) {
      score += intentBoost.boost;
      directHits = Math.max(directHits, queryTokens.length);
      matchedNameOrKeyword = true;
      if (!matchReason) matchReason = intentBoost.reason;
    }

    // 3. Exact phrase bonuses
    if (entry.nameLower === qLower || entry.nameLower === queryNoNoise) {
      score += 36;
    } else if (queryNoNoise.length >= 3 && entry.nameLower.includes(queryNoNoise)) {
      score += 22;
    } else if (
      queryNoNoise.length >= 3 &&
      entry.keywordPhrases.some((kw) => kw === queryNoNoise || kw.includes(queryNoNoise))
    ) {
      score += 16;
    }

    // 4. Token-by-token scoring
    for (let i = 0; i < queryTokens.length; i++) {
      const raw = queryTokens[i];
      const stem = stemmedTokens[i] ?? raw;
      const nameHit = matchStrength(raw, stem, entry.nameWords, entry.nameLower);
      const kwHit = nameHit < 1 ? matchStrength(raw, stem, entry.keywordWords, entry.keywordPhrases.join(" ")) : 0;
      const specHit = nameHit < 1 && kwHit < 1 ? matchStrength(raw, stem, entry.specWords, "") : 0;
      const descHit =
        nameHit === 0 && kwHit === 0 && specHit === 0
          ? matchStrength(raw, stem, entry.descWords, entry.allTextLower)
          : 0;

      const tokenBest = Math.max(nameHit * 13, kwHit * 9, specHit * 5.5, descHit * 3.2);
      if (tokenBest > 0) {
        score += tokenBest;
        directHits++;
        if (nameHit >= 0.78 || kwHit >= 0.78) matchedNameOrKeyword = true;
      }
    }

    // 5. Expanded concept matching (only boosts if tool aligns with synonym graph)
    let synHits = 0;
    for (const concept of expandedConcepts) {
      if (entry.tool.id === concept) {
        score += 18;
        synHits++;
        matchedNameOrKeyword = true;
        continue;
      }
      const conceptStem = stemToken(concept);
      const nameSyn = matchStrength(concept, conceptStem, entry.nameWords, entry.nameLower);
      const kwSyn = matchStrength(concept, conceptStem, entry.keywordWords, "");
      if (nameSyn >= 0.9 || kwSyn >= 0.9) {
        score += nameSyn >= 0.9 ? 6 : 4;
        synHits++;
        matchedNameOrKeyword = true;
      }
    }

    // Coverage filtering: prevent noise matches on multi-word queries that don't actually match this tool
    if (queryTokens.length >= 2 && !matchedNameOrKeyword && !intentBoost && !formatPair) {
      const coverage = (directHits + Math.min(1, synHits)) / queryTokens.length;
      if (coverage < 0.65) continue;
    }
    if (directHits === 0 && !intentBoost && !formatPair && synHits < 2) {
      continue;
    }
    // Single-word unknown query check
    if (queryTokens.length === 1 && score < 3.2) {
      continue;
    }
    // Multi-word unmatched noise protection (e.g., "3d printer slicer")
    if (queryTokens.length >= 2 && directHits < Math.ceil(queryTokens.length * 0.5) && !intentBoost && !formatPair && synHits < 2) {
      continue;
    }

    if (queryTokens.length > 1 && directHits === queryTokens.length) {
      score += 14;
    }

    // Contextual tie-breaker when hopping from inside a cluster (slightly lower for current page itself)
    if (options?.contextClusterId && entry.cluster.id === options.contextClusterId) {
      score += 0.6;
    }
    if (options?.currentToolId && entry.tool.id === options.currentToolId) {
      score -= 1.2;
    }

    if (score <= 0) continue;

    if (!matchReason) {
      matchReason = `${entry.tool.takes} → ${entry.tool.gives}`;
    }

    scored.push({
      tool: entry.tool,
      score,
      matchReason,
      cluster: entry.cluster,
    });
  }

  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.tool.status === "live") - Number(a.tool.status === "live") ||
      a.tool.name.localeCompare(b.tool.name),
  );
}

function splitCompletion(phrase: string, rawInput: string): { matchedPrefix: string; completion: string } {
  const input = rawInput.trimStart();
  if (!input) return { matchedPrefix: "", completion: phrase };
  if (phrase.toLowerCase().startsWith(input.toLowerCase())) {
    return {
      matchedPrefix: phrase.slice(0, input.length),
      completion: phrase.slice(input.length),
    };
  }
  return { matchedPrefix: "", completion: phrase };
}

function buildSuggestions(
  query: string,
  formatPair: FormatRouteMatch | null,
  results: ScoredToolMatch[],
  index: SearchIndex,
  options?: { contextClusterId?: ClusterId; currentToolId?: string; limit?: number },
): TaskSuggestion[] {
  const trimmed = query.trim();
  const qLower = trimmed.toLowerCase();
  const limit = options?.limit ?? 6;
  const out: TaskSuggestion[] = [];
  const seen = new Set<string>();

  const add = (item: Omit<TaskSuggestion, "id">) => {
    const key = item.phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, ...item });
  };

  if (!trimmed) {
    // Contextual empty-focus suggestions: current collection tasks first, then high-value daily tasks
    const pool = [...index.suggestionsPool];
    if (options?.contextClusterId) {
      pool.sort((a, b) => {
        const aSame = Number(a.cluster?.id === options.contextClusterId && a.tool?.id !== options.currentToolId);
        const bSame = Number(b.cluster?.id === options.contextClusterId && b.tool?.id !== options.currentToolId);
        return bSame - aSame || Number(b.kind === "task") - Number(a.kind === "task");
      });
    }
    for (const s of pool) {
      if (s.tool?.id === options?.currentToolId) continue;
      if (s.kind === "tool" && out.length >= limit) break;
      add({
        phrase: s.phrase,
        matchedPrefix: "",
        completion: s.phrase,
        tool: s.tool,
        cluster: s.cluster,
        available: s.available,
        kind: s.kind,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // 1. Dynamic "<ext> to " conversion route completions directly from STATIC_CATALOGUE
  const toPrefixMatch = qLower.match(/^(?:convert\s+|turn\s+)?([a-z0-9.+_-]{2,12})\s+(?:to|into)(?:\s+([a-z0-9.+_-]*))?$/);
  if (toPrefixMatch) {
    const src = resolveFormatAlias(toPrefixMatch[1]);
    const targetPrefix = (toPrefixMatch[2] ?? "").trim();
    const routes = src ? STATIC_CATALOGUE.routes[src] ?? [] : [];
    const converter = index.byId.get("convert-anything")?.tool;
    const filteredRoutes = routes.filter((r) => !targetPrefix || r.target.startsWith(targetPrefix));
    for (const r of filteredRoutes.slice(0, 4)) {
      const phrase = `${toPrefixMatch[1]} to ${r.target}`;
      const pairIds = PAIR_DEDICATED_TOOLS[`${src}->${r.target}`];
      const topTool = (pairIds?.[0] ? index.byId.get(pairIds[0])?.tool : undefined) ?? converter;
      const { matchedPrefix, completion } = splitCompletion(phrase, trimmed);
      add({
        phrase,
        matchedPrefix,
        completion,
        tool: topTool,
        cluster: topTool ? getCluster(clusterOf(topTool)) : undefined,
        available: true,
        kind: "conversion",
      });
    }
  }

  // 2. If exact format-pair detected, include canonical format suggestion first
  if (formatPair && results[0]) {
    const phrase = `${formatPair.fromId} to ${formatPair.toId}`;
    const { matchedPrefix, completion } = splitCompletion(phrase, trimmed);
    add({
      phrase,
      matchedPrefix,
      completion,
      tool: results[0].tool,
      cluster: results[0].cluster,
      available: results[0].tool.status === "live",
      kind: "conversion",
    });
  }

  // 3. Curated & tool-name completions ranked by prefix + token overlap
  const queryWords = tokenizeText(qLower)
    .map(stemToken)
    .filter((w) => w && !STOP_WORDS.has(w));

  const rankedPool = index.suggestionsPool
    .map((item) => {
      let rank = 0;
      if (item.lower.startsWith(qLower)) rank += 40;
      else if (item.lower.includes(qLower)) rank += 22;

      let wordHits = 0;
      for (const qw of queryWords) {
        for (const sw of item.words) {
          if (sw === qw) {
            rank += 9;
            wordHits++;
            break;
          }
          if (qw.length >= 2 && sw.startsWith(qw)) {
            rank += 5;
            wordHits++;
            break;
          }
        }
      }
      if (queryWords.length > 0 && wordHits === queryWords.length) rank += 12;
      if (item.kind !== "tool") rank += 2;
      if (options?.contextClusterId && item.cluster?.id === options.contextClusterId) rank += 1.5;
      return { item, rank, wordHits };
    })
    .filter((x) => x.rank >= 10 || (queryWords.length === 1 && x.wordHits >= 1))
    .sort((a, b) => b.rank - a.rank || Number(b.item.available) - Number(a.item.available));

  for (const { item } of rankedPool) {
    if (out.length >= limit) break;
    const { matchedPrefix, completion } = splitCompletion(item.phrase, trimmed);
    add({
      phrase: item.phrase,
      matchedPrefix,
      completion,
      tool: item.tool,
      cluster: item.cluster,
      available: item.available,
      kind: item.kind,
    });
  }

  return out.slice(0, limit);
}

/**
 * Ranks tools using task intent, synonyms, stems and conversion route detection.
 */
export function rankToolsForTask(query: string): Tool[] {
  if (!query.trim()) return tools;
  const index = getSearchIndex();
  return rankEntriesInternal(query, index.entries, index.byId).map((m) => m.tool);
}

/**
 * Full Google-style task check + autocomplete suggestions + ranked tool matches.
 */
export function analyzeTaskQuery(
  query: string,
  options?: { contextClusterId?: ClusterId; currentToolId?: string; limit?: number },
): TaskAnalysis {
  const index = getSearchIndex();
  const trimmed = query.trim();
  const liveTotal = tools.filter((t) => t.status === "live").length;

  if (!trimmed) {
    const suggestions = buildSuggestions("", null, [], index, options);
    return {
      results: [],
      availability: {
        status: "idle",
        label: `${liveTotal} tools ready`,
        detail: "Describe a task, paste keywords, or type “pdf to word”",
        liveMatches: liveTotal,
        totalMatches: tools.length,
      },
      suggestions,
      formatPair: null,
    };
  }

  const formatPair = detectFormatPair(trimmed);
  const results = rankEntriesInternal(trimmed, index.entries, index.byId, options);
  const suggestions = buildSuggestions(trimmed, formatPair, results, index, options);

  const liveMatches = results.filter((r) => r.tool.status === "live");
  const topLive = liveMatches[0];
  const topAny = results[0];

  let availability: TaskAvailability;

  if (
    formatPair?.converterSupported &&
    topLive &&
    (topLive.tool.id === "convert-anything" || formatPair.dedicatedToolIds.length > 0)
  ) {
    availability = {
      status: topLive.tool.id === "convert-anything" ? "converter-route" : "available",
      label:
        topLive.tool.id === "convert-anything"
          ? `Available via Universal converter`
          : `${liveMatches.length} ${liveMatches.length === 1 ? "tool" : "tools"} available`,
      detail: `Converts ${formatPair.fromLabel} → ${formatPair.toLabel} · Best: ${topLive.tool.name}`,
      liveMatches: liveMatches.length,
      totalMatches: results.length,
      topTool: topLive.tool,
      formatRoute: { fromLabel: formatPair.fromLabel, toLabel: formatPair.toLabel },
    };
  } else if (liveMatches.length > 0 && topLive) {
    availability = {
      status: "available",
      label: `${liveMatches.length} ${liveMatches.length === 1 ? "tool" : "tools"} available`,
      detail: `Best match: ${topLive.tool.name} (${topLive.cluster.name})`,
      liveMatches: liveMatches.length,
      totalMatches: results.length,
      topTool: topLive.tool,
    };
  } else if (results.length > 0 && topAny) {
    availability = {
      status: "coming-soon",
      label: "In the works",
      detail: `${topAny.tool.name} is planned — not live yet`,
      liveMatches: 0,
      totalMatches: results.length,
      topTool: topAny.tool,
    };
  } else {
    availability = {
      status: "unavailable",
      label: "Not in toolbox yet",
      detail: `No tool for “${trimmed}” yet — request it below`,
      liveMatches: 0,
      totalMatches: 0,
    };
  }

  return {
    results,
    availability,
    suggestions,
    formatPair,
  };
}
