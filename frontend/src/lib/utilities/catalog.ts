/**
 * The Developer, Text and Everyday utilities, as data. Each entry becomes a tool page (see lib/tools.ts);
 * many pages share one engine with a preset (all hash pages are the hash engine with an algorithm
 * picked), so there's one implementation per job, not one per page.
 *
 * Tools this site already had (Base64, URL encode, JSON format/validate/view, number bases, case,
 * timestamps, UUIDs, passwords, colour codes, file conversions, OCR, image crop/convert) are not
 * repeated here; their keywords point search at the existing tools instead.
 */

import {
  AppWindow,
  AudioLines,
  Binary,
  Calculator,
  CalendarDays,
  Clock3,
  Contrast,
  FileLock2,
  Globe2,
  ImageOff,
  KeyRound,
  Mic,
  Palette,
  Scale,
  ScanLine,
  ScanQrCode,
  Square,
  SquareDashed,
  Timer,
  Replace,
  Scissors,
  CheckCheck,
  Code,
  CreditCard,
  Cpu,
  Dices,
  Eye,
  BookOpen,
  FileText,
  FileCode,
  Globe,
  Hash,
  Link,
  ListChecks,
  Maximize2,
  Minimize,
  Monitor,
  Network,
  PanelsTopLeft,
  Quote,
  Radio,
  Repeat,
  Ruler,
  ScrollText,
  Shuffle,
  Sigma,
  SquareTerminal,
  TextCursorInput,
  Type,
  Webcam,
  type LucideIcon,
} from "lucide-react";

export const DEV_GROUPS = ["Format", "Minify", "Validate", "Edit & view", "XML & JSON", "Encode", "Hash", "Random data", "Web & network", "HTML & CSS"] as const;
export const TEXT_GROUPS = ["Convert", "Transform", "Generate", "Analyze"] as const;
export const EVERYDAY_GROUPS = ["Health", "Calculate & convert", "Time & dates", "Privacy & security", "QR codes", "Device & browser"] as const;
export const DESIGN_GROUPS = ["Charts & diagrams", "Fonts", "Colour", "CSS"] as const;

export type Engine =
  | "codes" | "fancy" | "numwords" | "roman" | "repeat" | "lines" | "morse" | "morse-audio" | "lorem" | "summarize" | "text-image"
  | "format" | "minify" | "validate" | "card" | "editor" | "html-viewer" | "markdown"
  | "xpath" | "xslt" | "xsd" | "xml-viewer" | "jsonpath" | "uritemplate" | "escape" | "ieee"
  | "hash" | "random" | "network" | "device" | "webgen" | "calculator" | "find-replace" | "split"
  | "units" | "worldclock" | "timer" | "date" | "password" | "encrypt" | "qrscan" | "exif" | "cron" | "contrast" | "cssgen";

export type UtilityDef = {
  id: string;
  name: string;
  cluster: "dev" | "text" | "everyday" | "design";
  group: string;
  engine: Engine;
  preset?: Record<string, string>;
  description: string;
  keywords: string[];
  icon: LucideIcon;
};

const d = (cluster: UtilityDef["cluster"], group: string, engine: Engine, icon: LucideIcon) => (id: string, name: string, description: string, keywords: string[], preset?: Record<string, string>): UtilityDef => ({ id, name, cluster, group, engine, preset, description, keywords, icon });

/* ---------- Text ---------- */

const codes = d("text", "Convert", "codes", Binary);
const fancy = d("text", "Transform", "fancy", Type);
const textConvert = (engine: Engine, icon: LucideIcon) => d("text", "Convert", engine, icon);

const TEXT: UtilityDef[] = [
  codes("text-to-binary", "Text to binary", "Turn text into binary code, eight bits per byte.", ["binary translator", "text to binary converter", "ascii to binary", "binary code", "01"], { from: "text", base: "binary" }),
  codes("binary-to-text", "Binary to text", "Read binary code back as text (binary translator).", ["binary translator", "binary to ascii", "binary decoder", "decode binary"], { from: "codes", base: "binary" }),
  codes("text-to-hex", "Text to hex", "Text as hexadecimal byte values.", ["ascii to hex", "string to hex", "hex encode", "hexadecimal"], { from: "text", base: "hex" }),
  codes("hex-to-text", "Hex to text", "Hexadecimal bytes back to readable text.", ["hex to ascii", "hex to string", "hex decoder", "hexadecimal"], { from: "codes", base: "hex" }),
  codes("text-to-ascii", "Text to ASCII codes", "Each character's ASCII (decimal) code.", ["text to ascii", "ascii to decimal", "char code", "character code", "unicode code point"], { from: "text", base: "decimal" }),
  codes("ascii-to-text", "ASCII codes to text", "Decimal ASCII or Unicode codes back to characters.", ["ascii to text", "decimal to ascii", "char code to text", "ascii decoder"], { from: "codes", base: "decimal" }),
  textConvert("numwords", Calculator)("number-to-words", "Number to words", "Spell out any number, with lakh and crore if you like.", ["number to word", "number to text", "amount in words", "cheque words", "spell number", "lakh", "crore"], { dir: "to-words" }),
  textConvert("numwords", Calculator)("words-to-number", "Words to number", "“Two thousand and five” becomes 2005.", ["word to number", "text to number", "words to digits"], { dir: "to-number" }),
  textConvert("roman", Sigma)("roman-numerals", "Roman numeral converter", "Numbers to Roman numerals and back, 1 to 3999.", ["roman numeral", "roman to number", "number to roman", "mcmxciv", "roman date"]),
  textConvert("morse", Radio)("morse-code", "Morse code translator", "Text to Morse and back, with sound you can play.", ["morse", "morse translator", "morse to text", "text to morse", "sos", "dots and dashes"]),
  textConvert("morse-audio", AudioLines)("morse-audio-decoder", "Morse code audio decoder", "Turn Morse beeps from a recording, a video or your microphone into text.", ["morse code audio decoder", "morse sound to text", "decode morse from audio", "morse audio to text", "morse code listener", "morse decoder microphone", "cw decoder", "morse from video", "morse beeps translator"]),
  fancy("upside-down-text", "Upside-down text", "Flip text upside down for posts and bios.", ["upside down text", "flip text upside down", "rotate text 180"], { kind: "upside" }),
  fancy("mirror-text", "Mirror text", "Text as its mirror image.", ["mirror text", "reverse text", "backwards writing"], { kind: "mirror" }),
  fancy("reverse-text", "Reverse text", "Reverse the letters, the words, each word or the lines.", ["backwards text", "reverse text generator", "flip text", "reverse words", "reverse lines"], { kind: "reverse" }),
  d("text", "Transform", "repeat", Repeat)("text-repeater", "Text repeater", "Repeat text any number of times, with a separator.", ["text repeater", "repeat text", "duplicate text", "copy paste many times"]),
  d("text", "Transform", "find-replace", Replace)("find-and-replace", "Find and replace", "Find words or patterns in text, see every match, and replace them.", ["find and replace", "replace text", "search and replace", "find word in text", "find pattern", "regex replace", "replace all", "word finder", "highlight matches"]),
  d("text", "Transform", "split", Scissors)("split-text", "Split text", "Split text by lines, commas, words, a pattern or a length.", ["split text", "split string", "string splitter", "text to list", "comma separated to list", "explode string", "chunk text", "split by delimiter", "csv to list"]),
  d("text", "Transform", "lines", Shuffle)("line-tools", "Sort and shuffle lines", "Shuffle, sort, de-duplicate, number or trim lines.", ["text lines shuffler", "shuffle lines", "sort lines", "remove duplicate lines", "randomize list"]),
  d("text", "Generate", "lorem", ScrollText)("lorem-ipsum", "Lorem ipsum generator", "Placeholder text by paragraphs, sentences or words.", ["lorem ipsum", "dummy text", "placeholder text", "filler text"]),
  d("text", "Generate", "text-image", Type)("text-to-image", "Text to image", "Turn text into a PNG, with font, colours and padding.", ["text to image", "text to png", "quote image", "caption image"]),
  d("text", "Analyze", "summarize", ListChecks)("text-summarizer", "Text summarizer", "The key sentences of a long text, in your browser.", ["summarizer", "summarize text", "summary generator", "tldr", "key points"]),
];

/* ---------- Developer ---------- */

const fmt = d("dev", "Format", "format", Code);
const min = d("dev", "Minify", "minify", Minimize);
const val = d("dev", "Validate", "validate", CheckCheck);
const hash = d("dev", "Hash", "hash", Hash);
const rnd = d("dev", "Random data", "random", Dices);
const net = d("dev", "Web & network", "network", Globe);
const web = d("dev", "HTML & CSS", "webgen", PanelsTopLeft);

const DEV: UtilityDef[] = [
  fmt("html-formatter", "HTML formatter", "Indent and tidy HTML (HTML beautifier).", ["html beautifier", "html prettify", "format html", "indent html"], { lang: "html" }),
  fmt("css-formatter", "CSS formatter", "Indent and tidy CSS, SCSS or Less.", ["beautify css", "css beautifier", "format css", "scss formatter", "less formatter"], { lang: "css" }),
  fmt("javascript-formatter", "JavaScript formatter", "Format JavaScript (JS beautifier, Babel).", ["js beautifier", "javascript beautifier", "babel formatter", "format js", "prettier"], { lang: "javascript" }),
  fmt("typescript-formatter", "TypeScript formatter", "Format TypeScript with Prettier.", ["typescript formatter", "ts beautifier", "format typescript"], { lang: "typescript" }),
  fmt("react-formatter", "React (JSX) formatter", "Format React components and JSX.", ["react formatter", "jsx formatter", "tsx formatter", "react beautifier"], { lang: "jsx" }),
  fmt("angular-formatter", "Angular template formatter", "Format Angular HTML templates.", ["angular formatter", "angular template", "ng template beautify"], { lang: "angular" }),
  fmt("xml-formatter", "XML formatter", "Indent XML (XML beautifier).", ["xml beautifier", "pretty print xml", "format xml", "indent xml"], { lang: "xml" }),
  fmt("php-formatter", "PHP formatter", "Format PHP code (PHP beautifier).", ["php beautifier", "format php", "php prettify"], { lang: "php" }),
  fmt("java-formatter", "Java formatter", "Format Java code.", ["java formatter", "java beautifier", "format java"], { lang: "java" }),
  fmt("sql-formatter", "SQL formatter", "Format SQL for MySQL, PostgreSQL, SQL Server and more.", ["sql beautifier", "format sql", "sql pretty print", "mysql formatter", "postgres formatter"], { lang: "sql" }),
  fmt("yaml-formatter", "YAML formatter", "Format YAML consistently.", ["yaml beautifier", "format yaml", "yml formatter"], { lang: "yaml" }),
  fmt("markdown-formatter", "Markdown formatter", "Tidy Markdown: lists, tables, spacing.", ["markdown formatter", "format md", "prettier markdown"], { lang: "markdown" }),
  min("html-minifier", "HTML minifier", "Strip comments and spaces from HTML.", ["minify html", "html compressor", "compress html"], { lang: "html" }),
  min("css-minifier", "CSS minifier", "Make CSS as small as it gets (csso).", ["minify css", "css compressor", "compress css"], { lang: "css" }),
  min("javascript-minifier", "JavaScript minifier", "Minify and mangle JavaScript (Terser).", ["minify js", "js minifier", "uglify", "terser", "compress javascript"], { lang: "javascript" }),
  val("javascript-validator", "JavaScript validator", "Find syntax errors in JavaScript, JSX or jQuery code.", ["javascript validator", "js validator", "jquery validator", "syntax checker", "js lint"], { lang: "javascript" }),
  val("css-validator", "CSS validator", "Check CSS syntax and property values.", ["css validator", "css checker", "validate css", "css lint"], { lang: "css" }),
  val("xml-validator", "XML validator", "Check XML is well-formed, with the line of any error.", ["xml validator", "well formed xml", "validate xml", "xml checker"], { lang: "xml" }),
  val("yaml-validator", "YAML validator", "Check YAML and see it as JSON.", ["yaml validator", "yml validator", "validate yaml", "yaml lint"], { lang: "yaml" }),
  d("dev", "Validate", "card", CreditCard)("card-validator", "Card number validator", "Luhn check and card brand, for testing forms.", ["credit card validator", "luhn check", "card number checker", "card type", "visa", "mastercard", "test card"]),
  d("dev", "Validate", "xsd", CheckCheck)("xsd-validator", "XSD validator", "Validate XML against an XML Schema.", ["xsd validation", "xml schema validator", "validate xml against xsd"]),
  d("dev", "Edit & view", "editor", SquareTerminal)("code-editor", "Code editor", "Edit code in 100+ languages with highlighting, then copy or download.", ["online editor", "code editor", "online code editor", "python editor", "java editor", "c++ editor", "php editor", "sql editor", "html editor", "css editor", "javascript editor", "typescript editor", "markdown editor", "latex editor", "yaml editor", "xml editor", "json editor", "rust editor", "go editor", "ruby editor", "kotlin editor", "swift editor", "lua editor", "perl editor", "r editor", "haskell editor", "scala editor", "dart editor", "shell editor", "powershell editor", "batch editor", "dockerfile", "toml editor", "ini editor", "svg editor", "diff editor", "cobol editor", "fortran", "pascal editor", "verilog editor", "matlab editor", "julia editor", "clojure editor", "erlang editor", "groovy editor", "sass editor", "scss editor", "less editor", "stylus editor", "twig editor", "liquid editor", "ejs editor", "jsx editor", "tex editor", "assembly editor"]),
  d("dev", "Edit & view", "editor", TextCursorInput)("text-editor", "Online text editor", "A plain notepad in the browser, saved as you type.", ["online text editor", "editpad", "notepad online", "online notepad", "write text"], { lang: "text" }),
  d("dev", "Edit & view", "markdown", FileText)("markdown-editor", "Markdown editor", "Write Markdown with a live preview, then export .md, HTML or PDF.", ["markdown editor", "md editor", "online markdown editor", "markdown live preview", "readme editor", "github markdown", "gfm", "markdown to html", "markdown to pdf", "write markdown", "dillinger", "stackedit"]),
  d("dev", "Edit & view", "markdown", BookOpen)("markdown-viewer", "Markdown viewer", "Open a .md file or a GitHub link and read it beautifully formatted.", ["markdown viewer", "md viewer", "open md file", "view markdown", "readme viewer", "markdown reader", "md file opener", "preview markdown"], { mode: "preview" }),
  d("dev", "Edit & view", "html-viewer", Eye)("html-viewer", "HTML viewer", "See HTML rendered as you type, safely sandboxed.", ["html viewer", "html preview", "render html", "html editor live preview"]),
  d("dev", "Edit & view", "xml-viewer", FileCode)("xml-viewer", "XML viewer", "Browse XML as a collapsible tree.", ["xml viewer", "xml tree", "view xml", "xml explorer"]),
  d("dev", "XML & JSON", "xpath", FileCode)("xpath-tester", "XPath tester", "Run XPath on XML and see every match.", ["xpath", "xpath evaluator", "xpath online", "w3c xpath"]),
  d("dev", "XML & JSON", "xslt", FileCode)("xslt-transformer", "XSLT transformer", "Transform XML with an XSLT stylesheet.", ["xslt", "xsl transformation", "xslt online", "xml transform"]),
  d("dev", "XML & JSON", "jsonpath", FileCode)("jsonpath-tester", "JSONPath tester", "Query JSON with JSONPath and see the results.", ["jsonpath", "json path tester", "json query", "jsonpath evaluator"]),
  d("dev", "XML & JSON", "uritemplate", Link)("uri-template", "URI template expander", "Expand RFC 6570 URI templates with your values.", ["uri template", "url template", "rfc 6570", "uritemplate parser"]),
  d("dev", "Encode", "escape", Quote)("json-escape", "JSON escape / unescape", "Escape text for a JSON string, or unescape it.", ["json escape", "json unescape", "escape string json", "stringify"], { kind: "json" }),
  d("dev", "Encode", "escape", Code)("html-entities", "HTML entities encoder", "Encode text to HTML entities, or decode them.", ["html encoder", "html decoder", "html entities", "escape html", "unescape html"], { kind: "html" }),
  d("dev", "Encode", "ieee", Cpu)("ieee-754", "IEEE-754 float analyser", "See how a number is stored as a 32- or 64-bit float.", ["ieee 754", "float converter", "floating point", "float to hex", "double precision", "binary32", "binary64"]),
  ...[
    ["md5", "MD5 hash generator", ["md5", "md5 generator", "md5 checksum"]],
    ["sha1", "SHA-1 hash generator", ["sha1", "sha-1"]],
    ["sha224", "SHA-224 hash generator", ["sha224", "sha-224"]],
    ["sha256", "SHA-256 hash generator", ["sha256", "sha-256", "checksum"]],
    ["sha384", "SHA-384 hash generator", ["sha384", "sha-384"]],
    ["sha512", "SHA-512 hash generator", ["sha512", "sha-512"]],
    ["sha512-224", "SHA-512/224 hash generator", ["sha512/224", "sha-512/224"]],
    ["sha512-256", "SHA-512/256 hash generator", ["sha512/256", "sha-512/256"]],
    ["sha3-224", "SHA3-224 hash generator", ["sha3-224", "sha3"]],
    ["sha3-256", "SHA3-256 hash generator", ["sha3-256", "sha3", "keccak"]],
    ["sha3-384", "SHA3-384 hash generator", ["sha3-384", "sha3"]],
    ["sha3-512", "SHA3-512 hash generator", ["sha3-512", "sha3"]],
    ["shake128", "SHAKE-128 hash generator", ["shake128", "shake-128"]],
    ["shake256", "SHAKE-256 hash generator", ["shake256", "shake-256"]],
    ["md2", "MD2 hash generator", ["md2"]],
    ["md4", "MD4 hash generator", ["md4"]],
    ["ntlm", "NTLM hash generator", ["ntlm", "windows password hash", "nt hash"]],
    ["crc16", "CRC-16 checksum", ["crc16", "crc-16", "checksum"]],
    ["crc32", "CRC-32 checksum", ["crc32", "crc-32", "checksum", "zip crc"]],
  ].map(([alg, name, kw]) => hash(`${alg}-hash`, name as string, `${(name as string).replace(" generator", "")} of text or a file, in your browser.`, [...(kw as string[]), "hash generator", "hash"], { alg: alg as string })),
  hash("hmac-generator", "HMAC generator", "Keyed hashes (HMAC) with SHA-2, SHA-3, SHA-1 or MD5.", ["hmac", "hmac generator", "hmac sha256", "signature", "keyed hash"], { alg: "sha256", hmac: "1" }),
  hash("wordpress-hash", "WordPress password hash", "Make or check a WordPress (phpass) password hash.", ["wordpress hash", "phpass", "wp password", "$P$"], { alg: "wordpress" }),
  ...[
    ["random-name-picker", "Random name picker", "names", ["name picker", "random name", "pick a winner", "raffle", "draw names"]],
    ["random-string", "Random string generator", "string", ["random string", "random text"]],
    ["random-alphanumeric", "Random alphanumeric", "alnum", ["alphanumeric", "random code", "random id"]],
    ["random-letters", "Random letter generator", "letters", ["random letter", "random alphabet"]],
    ["random-integer", "Random number generator", "integer", ["random number", "random integer", "number range", "dice"]],
    ["random-decimal", "Random decimal generator", "decimal", ["random decimal", "random float"]],
    ["random-fraction", "Random fraction generator", "fraction", ["random fraction"]],
    ["random-prime", "Random prime generator", "prime", ["prime number", "random prime"]],
    ["random-hex", "Random hex generator", "hex", ["random hex", "hex string"]],
    ["random-binary", "Random binary generator", "binary", ["random binary", "random bits"]],
    ["random-bytes", "Random byte generator", "bytes", ["random bytes", "random byte"]],
    ["random-date", "Random date generator", "date", ["random date", "random birthday"]],
    ["random-time", "Random time generator", "time", ["random time"]],
    ["random-ip", "Random IP address generator", "ip", ["random ip", "ip generator", "ipv4", "ipv6"]],
    ["random-mac", "MAC address generator", "mac", ["mac address", "random mac"]],
    ["random-json", "Random JSON generator", "json", ["random json", "mock json", "fake data", "test data"]],
    ["random-csv", "Random CSV generator", "csv", ["random csv", "mock csv", "fake csv", "sample data"]],
    ["random-tsv", "Random TSV generator", "tsv", ["random tsv", "tab separated"]],
    ["random-xml", "Random XML generator", "xml", ["random xml", "mock xml"]],
    ["random-from-regex", "Random data from regex", "regex", ["regex generator", "string from regex", "randexp"]],
    ["random-bitmap", "Random bitmap generator", "bitmap", ["random bitmap", "noise image", "random pixels"]],
  ].map(([id, name, kind, kw]) => rnd(id as string, name as string, `${name}: as many as you need, made in your browser.`, kw as string[], { kind: kind as string })),
  net("dns-lookup", "DNS lookup", "Every DNS record of a domain: A, AAAA, CNAME, MX, NS, TXT, SOA, CAA.", ["dns lookup", "dns records", "dns checker", "txt record", "cname"], { kind: "dns" }),
  net("mx-lookup", "MX lookup", "A domain's mail servers, in priority order.", ["mx lookup", "mx record", "mail server lookup"], { kind: "mx" }),
  net("ns-lookup", "NS lookup", "A domain's name servers.", ["ns lookup", "nameserver lookup", "nslookup"], { kind: "ns" }),
  net("website-to-ip", "Website to IP", "The IP addresses of a website or hostname.", ["hostname to ip", "website to ip address", "domain ip lookup", "domain to ip", "find ip of website"], { kind: "ip" }),
  net("ip-to-hostname", "IP to hostname", "The hostname behind an IP address (reverse DNS).", ["ip to hostname", "reverse dns", "ptr lookup", "reverse ip"], { kind: "reverse" }),
  net("http-headers", "HTTP header checker", "Every response header a URL sends back.", ["http header checker", "check headers", "response headers", "security headers"], { kind: "headers" }),
  net("http-status", "HTTP status checker", "A URL's status code and its whole redirect chain.", ["http status checker", "status code", "redirect checker", "301 302 checker"], { kind: "status" }),
  net("open-port-checker", "Open port checker", "Is a TCP port open on a public server?", ["open port checker", "port checker", "port scan", "is port open"], { kind: "port" }),
  net("api-tester", "API tester", "Send GET, POST, PUT or DELETE requests with headers and a body.", ["api test", "rest client", "http client", "postman online", "curl online"], { kind: "api" }),
  web("html-link-generator", "HTML link generator", "Link code with target, rel and title, ready to paste.", ["html link code generator", "a href generator", "link html"], { kind: "link" }),
  web("html-table-generator", "HTML table generator", "Build a table in a grid, get clean HTML.", ["html table generator", "table html", "table code"], { kind: "table" }),
  web("redirect-generator", "Redirect generator", "Redirect code for .htaccess, Nginx, HTML, JavaScript and PHP.", ["redirect generator", "301 redirect", "htaccess redirect", "nginx redirect", "meta refresh"], { kind: "redirect" }),
  web("share-link-generator", "Share link generator", "Share links for X, Facebook, LinkedIn, WhatsApp, email and more.", ["share link generator", "social share link", "whatsapp link", "tweet link"], { kind: "share" }),
  web("rem-px-converter", "REM to PX converter", "REM, EM, PX, PT and % at any base font size.", ["rem to px", "px to rem", "em to px", "pt to px", "css units"], { kind: "units" }),
  web("css-to-less", "CSS to Less", "Nest flat CSS rules into Less.", ["css to less", "css to scss", "nest css"], { kind: "less" }),
  web("ascii-table", "ASCII table", "Every ASCII character with decimal, hex, octal, binary and HTML codes.", ["ascii table", "ascii chart", "ascii codes"], { kind: "ascii" }),
];

/* ---------- Everyday: device and browser ---------- */

const dev = (icon: LucideIcon) => d("everyday", "Device & browser", "device", icon);
const EVERYDAY: UtilityDef[] = [
  d("everyday", "Calculate & convert", "calculator", Calculator)("scientific-calculator", "Scientific calculator", "Trig, logs, powers, factorials, memory and history, with units too.", ["scientific calculator", "calculator", "calc", "sin cos tan", "logarithm", "factorial", "nCr", "permutation", "combination", "online calculator", "percentage calculator", "unit converter", "math"]),
  dev(Monitor)("screen-resolution", "Screen resolution", "Your screen's resolution, pixel ratio and colour depth.", ["screen resolution detection", "what is my screen resolution", "display size", "dpi"], { kind: "screen" }),
  dev(Maximize2)("browser-window-size", "Browser window size", "The browser's viewport size, live as you resize.", ["browser window size checker", "viewport size", "window size"], { kind: "window" }),
  dev(AppWindow)("screen-resolution-tester", "Responsive tester", "See a website in 30+ real device frames, or at any custom size.", ["screen resolution tester", "responsive design checker", "mobile view", "viewport tester", "device mockup", "iphone preview", "ipad preview", "macbook frame", "mobile simulator", "custom screen size"], { kind: "tester" }),
  dev(Webcam)("webcam-test", "Webcam test", "Check your camera works, and see its resolution and frame rate.", ["webcam test", "camera test", "test webcam online"], { kind: "webcam" }),
  dev(Ruler)("pixel-ruler", "Pixel ruler", "Measure anything on screen in pixels.", ["online pixel ruler", "screen ruler", "measure pixels"], { kind: "ruler" }),
  dev(Network)("my-ip", "What is my IP", "Your public IP address and what it says about your connection.", ["my ip address", "what is my ip", "my ip", "public ip", "ip address"], { kind: "myip" }),
  dev(Mic)("mic-speaker-test", "Mic & speaker test", "Check your microphone with a live level meter, and your speakers left and right.", ["mic test", "microphone test", "test my mic", "speaker test", "left right audio test", "headphone test", "sound test", "audio test"], { kind: "mic" }),
  dev(SquareDashed)("dead-pixel-test", "Dead pixel test", "Full-screen colours to spot dead or stuck pixels, and a flasher to try to fix them.", ["dead pixel test", "stuck pixel fixer", "screen test", "monitor test", "pixel checker", "backlight bleed test"], { kind: "deadpixel" }),
  d("everyday", "Calculate & convert", "units", Scale)("unit-converter", "Unit converter", "Length, weight, temperature, area, volume, speed, data and more, all at once.", ["unit converter", "cm to inches", "kg to lbs", "celsius to fahrenheit", "km to miles", "liters to gallons", "mb to gb", "metric to imperial", "conversion calculator"]),
  d("everyday", "Calculate & convert", "units", Globe2)("currency-converter", "Currency converter", "30 currencies at today's European Central Bank rates.", ["currency converter", "exchange rate", "usd to inr", "eur to usd", "gbp to inr", "dollar to rupee", "forex rates", "money converter"], { cat: "currency" }),
  d("everyday", "Time & dates", "worldclock", Clock3)("world-clock", "World clock & time zones", "The time in any city, and a meeting planner across time zones.", ["world clock", "time zone converter", "timezone converter", "time in london", "ist to est", "utc converter", "meeting planner", "what time is it in"]),
  d("everyday", "Time & dates", "timer", Timer)("pomodoro-timer", "Pomodoro timer", "Focus in 25-minute rounds with breaks, chimes and the time in your tab.", ["pomodoro timer", "focus timer", "study timer", "tomato timer", "productivity timer"], { mode: "pomodoro" }),
  d("everyday", "Time & dates", "timer", Timer)("stopwatch", "Stopwatch & countdown", "A stopwatch with laps, and a countdown timer with an alarm.", ["stopwatch", "online stopwatch", "lap timer", "countdown timer", "timer", "alarm timer", "kitchen timer"], { mode: "stopwatch" }),
  d("everyday", "Time & dates", "date", CalendarDays)("age-calculator", "Age calculator", "Your exact age in years, months and days, and your next birthday.", ["age calculator", "how old am i", "date of birth calculator", "birthday calculator", "age in days"], { mode: "age" }),
  d("everyday", "Time & dates", "date", CalendarDays)("date-calculator", "Date calculator", "Days between two dates, business days, or a date plus or minus any time.", ["date calculator", "days between dates", "date difference", "business days calculator", "working days", "add days to date", "date duration"], { mode: "between" }),
  d("everyday", "Privacy & security", "password", KeyRound)("password-generator", "Password generator & checker", "Strong passwords and memorable passphrases, and an honest strength check.", ["password generator", "passphrase generator", "diceware", "password strength checker", "how secure is my password", "random password", "strong password"]),
  d("everyday", "Privacy & security", "encrypt", FileLock2)("encrypt-note", "Encrypt a note", "Lock a message with a password (AES-256), and share it as text or a link.", ["encrypt text", "encrypt message", "password protect text", "secret note", "aes encryption online", "decrypt text", "private message"]),
  d("everyday", "Privacy & security", "exif", ImageOff)("exif-remover", "Photo metadata viewer & remover", "See the hidden GPS, camera and date in photos, and remove it without losing quality.", ["exif viewer", "exif remover", "remove metadata from photo", "remove gps from photo", "photo location", "image metadata", "strip exif", "exif data"]),
  d("everyday", "QR codes", "qrscan", ScanQrCode)("qr-scanner", "QR code scanner", "Read a QR code from a picture, a screenshot or your camera.", ["qr scanner", "qr code reader", "scan qr code", "read qr from image", "qr decoder", "scan qr online", "wifi qr"]),
];

/* ---------- Design: colour and CSS ---------- */

const DESIGN: UtilityDef[] = [
  d("design", "Colour", "contrast", Contrast)("contrast-checker", "Contrast checker", "Check any text and background colours against WCAG AA and AAA, with fixes.", ["contrast checker", "wcag contrast", "color contrast", "accessibility checker", "a11y colors", "contrast ratio", "aa aaa"]),
  d("design", "CSS", "cssgen", Palette)("css-gradient-generator", "CSS gradient generator", "Linear, radial and conic gradients with any number of colours.", ["css gradient generator", "gradient maker", "linear gradient", "radial gradient", "background gradient", "color gradient"], { kind: "gradient" }),
  d("design", "CSS", "cssgen", Square)("box-shadow-generator", "Box shadow generator", "Layered, soft or crisp CSS shadows, live.", ["box shadow generator", "css shadow", "drop shadow css", "shadow maker", "inset shadow"], { kind: "shadow" }),
  d("design", "CSS", "cssgen", ScanLine)("border-radius-generator", "Border radius generator", "Rounded corners, one by one, or organic blob shapes.", ["border radius generator", "rounded corners css", "css blob", "border-radius"], { kind: "radius" }),
];

/* ---------- Developer: scheduling ---------- */

const CRON: UtilityDef[] = [
  d("dev", "Validate", "cron", Clock3)("cron-explainer", "Cron expression explainer", "Cron schedules in plain English, with the next run times.", ["cron expression", "crontab guru", "cron explainer", "cron parser", "cron schedule", "cron next run", "crontab"]),
];

export const UTILITIES: UtilityDef[] = [...TEXT, ...DEV, ...CRON, ...EVERYDAY, ...DESIGN];
export const getUtility = (id: string) => UTILITIES.find((u) => u.id === id);

/** What each engine takes and gives, and the promises shown on its pages. */
export const ENGINE_INFO: Record<Engine, { takes: string; gives: string; steps: [string, string, string]; features: string[]; server?: boolean }> = {
  codes: { takes: "Text or codes", gives: "Codes or text", steps: ["Paste text", "Pick the format", "Copy the result"], features: ["Live as you type", "Any UTF-8 text, not just ASCII", "Spaces, commas or no separators", "Nothing leaves your browser"] },
  fancy: { takes: "Text", gives: "Transformed text", steps: ["Paste text", "Pick a style", "Copy it"], features: ["Live as you type", "Works anywhere Unicode does", "Copy with one tap"] },
  numwords: { takes: "A number or words", gives: "Words or a number", steps: ["Type it", "Pick the system", "Copy the result"], features: ["Up to 21-digit numbers and decimals", "International or Indian (lakh, crore)", "Negative numbers too"] },
  roman: { takes: "A number or numeral", gives: "Roman or Arabic", steps: ["Type either", "Read the other", "Copy it"], features: ["Both directions, detected for you", "1 to 3999, written the standard way", "Explains malformed numerals"] },
  repeat: { takes: "Text", gives: "Repeated text", steps: ["Type text", "Set the count", "Copy it"], features: ["Up to 10,000 times", "New line, space, comma or your own separator", "Size shown before you copy"] },
  lines: { takes: "Lines of text", gives: "Reordered lines", steps: ["Paste lines", "Pick an action", "Copy them"], features: ["Shuffle fairly (crypto random)", "Sort A–Z, Z–A, by length or naturally", "Remove duplicates and blank lines", "Number or trim every line"] },
  "morse-audio": { takes: "A recording, a video or your mic", gives: "Plain text", steps: ["Add a recording or listen", "It reads the beeps", "Copy the text"], features: ["MP3, WAV, M4A, OGG, or the sound of a video", "Live from the microphone: hold a speaker near it", "Tone pitch and speed found for you (5 to 50+ WPM)", "Copes with noise, hum, hand-keyed and Farnsworth timing", "Decoded in your browser: nothing is uploaded"] },
  morse: { takes: "Text or Morse", gives: "Morse or text, and sound", steps: ["Type either", "Listen or copy", "Download audio"], features: ["Both directions, detected for you", "Play it with adjustable speed and pitch", "Download it as a WAV"] },
  lorem: { takes: "How much", gives: "Placeholder text", steps: ["Pick paragraphs, sentences or words", "Set the amount", "Copy it"], features: ["Paragraphs, sentences or words", "Classic “Lorem ipsum” start optional", "As HTML paragraphs if you like"] },
  summarize: { takes: "A long text", gives: "Its key sentences", steps: ["Paste text", "Set the length", "Copy the summary"], features: ["Picks the most representative sentences", "Keeps their original order", "Runs in your browser: private"] },
  "text-image": { takes: "Text", gives: "PNG image", steps: ["Type text", "Style it", "Download PNG"], features: ["Any size, font, colour and padding", "Transparent background option", "Sharp at 2× for retina screens"] },
  format: { takes: "Code", gives: "Formatted code", steps: ["Paste code", "Set the style", "Copy it"], features: ["Prettier and sql-formatter, in your browser", "Indent width, quotes and line length", "Points to the line of any syntax error"] },
  minify: { takes: "Code", gives: "Minified code", steps: ["Paste code", "Minify it", "Copy it"], features: ["Terser, csso or a safe HTML minifier", "Size before and after", "Runs in your browser"] },
  validate: { takes: "Code", gives: "Errors, or a pass", steps: ["Paste code", "Check it", "Fix what's flagged"], features: ["Line and column of every error", "Live as you type", "Runs in your browser"] },
  card: { takes: "A card number", gives: "Valid or not, and brand", steps: ["Type a number", "See the result", "Fix it"], features: ["Luhn checksum and length rules", "Visa, Mastercard, Amex, RuPay and more", "Never sent anywhere"] },
  editor: { takes: "Code or text", gives: "Your file", steps: ["Pick a language", "Edit", "Download or copy"], features: ["100+ languages with highlighting", "Saved in this browser as you type", "Open a file, download as a file", "Live HTML preview (Markdown has its own editor)"] },
  markdown: { takes: "Markdown, a .md file or a link", gives: "Formatted document, .md, HTML or PDF", steps: ["Open or write", "See it formatted", "Export"], features: ["GitHub-flavoured Markdown: tables, task lists, footnotes", "Highlighted code, maths (KaTeX) and Mermaid diagrams", "Live split view with synced scrolling and an outline", "Open a file, drop it in, or load a GitHub link", "Export .md, a standalone HTML page, or PDF", "Saved in this browser as you type"] },
  calculator: { takes: "Numbers and functions", gives: "The answer", steps: ["Type or tap", "See it live", "Copy or reuse"], features: ["Trig in degrees, radians or gradians, with inverses and hyperbolics", "Logs, powers, roots, factorials, nCr and nPr, mod, %", "Memory, Ans and a history you can reuse", "Fractions, hex and binary of every answer, and units (5 inch to cm)", "Full keyboard input; runs in your browser"] },
  "find-replace": { takes: "Text", gives: "Text, replaced", steps: ["Paste text", "Find and replace", "Copy the result"], features: ["Every match highlighted, counted, with its line", "Match case, whole words, or a regex pattern", "Keeps capitals: Fox → Cat, FOX → CAT", "Regex groups ($1) in the replacement"] },
  split: { takes: "Text", gives: "A list", steps: ["Paste text", "Pick how to split", "Copy the pieces"], features: ["By lines, commas, spaces, sentences, words or characters", "A custom separator, a regex, or every N characters", "Trim, drop empties, remove duplicates, sort", "Out as lines, numbered, JSON, CSV or a quoted list"] },
  "html-viewer": { takes: "HTML", gives: "A live preview", steps: ["Paste HTML", "See it", "Copy or download"], features: ["Live as you type", "Sandboxed: scripts can't touch this site", "Phone, tablet and desktop widths"] },
  xpath: { takes: "XML and an XPath", gives: "Matching nodes", steps: ["Paste XML", "Write XPath", "See matches"], features: ["Browser's own XPath engine", "Namespaces supported", "Each match with its path"] },
  xslt: { takes: "XML and XSLT", gives: "Transformed output", steps: ["Paste XML", "Paste XSLT", "Copy the output"], features: ["XSLT 1.0 (libxslt), the same in every browser", "HTML output previewed", "Locked down: no file or network access"], server: true },
  xsd: { takes: "XML and an XSD", gives: "Valid or the errors", steps: ["Paste XML", "Paste the schema", "Fix what's flagged"], features: ["libxml2 schema validation", "Line of every error", "No network access: safe"], server: true },
  "xml-viewer": { takes: "XML", gives: "A tree", steps: ["Paste XML", "Browse it", "Copy paths"], features: ["Collapsible tree", "Attributes and text shown", "Click a node to copy its XPath"] },
  jsonpath: { takes: "JSON and a path", gives: "Matches", steps: ["Paste JSON", "Write JSONPath", "See matches"], features: ["Full JSONPath (filters, wildcards)", "Each match's path", "Live as you type"] },
  uritemplate: { takes: "A template and values", gives: "The URL", steps: ["Write the template", "Fill the values", "Copy the URL"], features: ["RFC 6570, all levels", "Values from a JSON object", "Live as you type"] },
  escape: { takes: "Text", gives: "Escaped or unescaped text", steps: ["Paste text", "Pick a direction", "Copy it"], features: ["Both directions", "Live as you type", "Explains invalid escapes"] },
  ieee: { takes: "A number", gives: "Its bits", steps: ["Type a number", "Pick 32 or 64 bits", "Read the bits"], features: ["Sign, exponent and mantissa", "Hex and the stored value", "Rounding error shown"] },
  hash: { takes: "Text or a file", gives: "Hash", steps: ["Paste or add a file", "Pick the algorithm", "Copy the hash"], features: ["Text or files of any size", "Compare against a known hash", "Upper or lower case hex", "Nothing leaves your browser"] },
  random: { takes: "Settings", gives: "Random data", steps: ["Pick the kind", "Set the options", "Copy or download"], features: ["Cryptographically random", "As many as you need", "Copy or download"] },
  network: { takes: "A domain, IP or URL", gives: "Live results", steps: ["Type it", "Run the check", "Read the result"], features: ["Live answers from our server", "Public addresses only: safe", "Timing for each step"], server: true },
  webgen: { takes: "A few details", gives: "Code to paste", steps: ["Fill in the details", "Preview it", "Copy the code"], features: ["Live preview", "Clean, standard code", "Copy with one tap"] },
  device: { takes: "This device", gives: "Measurements", steps: ["Open it", "Read the results", "Copy them"], features: ["Live, nothing to install", "Runs in your browser", "Private: nothing is stored"] },
  units: { takes: "A value", gives: "Every unit at once", steps: ["Pick what to convert", "Type a value", "Read or copy"], features: ["12 kinds: length, weight, temperature, area, volume, speed, data, time, energy, pressure, angle, fuel", "Every unit converted at once", "Currencies at the European Central Bank's daily reference rates", "Runs in your browser"] },
  worldclock: { takes: "Cities or time zones", gives: "Their times", steps: ["Add cities", "Pick a time", "See it everywhere"], features: ["Every IANA time zone, daylight saving included", "Plan a meeting: pick a time in one city, see it in all", "Working hours, evenings and nights marked", "Runs in your browser"] },
  timer: { takes: "Nothing", gives: "A timer", steps: ["Pick a timer", "Start it", "Hear the chime"], features: ["Pomodoro with short and long breaks", "Stopwatch with laps, best and worst marked", "Countdown with an alarm", "Time shown in the tab title; keeps time in the background"] },
  date: { takes: "Dates", gives: "Ages, gaps and dates", steps: ["Pick the calculation", "Enter dates", "Read the answer"], features: ["Exact age in years, months and days", "Days, weeks and business days between dates", "Add or subtract days, weeks, months, years or business days", "Leap years and month ends handled"] },
  password: { takes: "Your settings or a password", gives: "A password, or its strength", steps: ["Pick generate or check", "Set the options", "Copy it"], features: ["Unbiased, cryptographically random", "Passphrases from the EFF's 7,776-word list", "Strength in bits, and time to crack", "Spots common passwords, keyboard runs and years", "Never sent anywhere"] },
  encrypt: { takes: "A note and a password", gives: "Encrypted text or a link", steps: ["Write the note", "Set a password", "Share the result"], features: ["AES-256-GCM, tamper-evident", "PBKDF2 key, 600,000 rounds", "Share as text or a link (the note sits after #, never sent to a server)", "Runs entirely in your browser"] },
  qrscan: { takes: "A picture or your camera", gives: "What the code says", steps: ["Add a picture or open the camera", "It reads the code", "Copy or open it"], features: ["Pictures, screenshots and pasted images", "Live camera scanning on phones and laptops", "Links, Wi-Fi, contacts, email, phone and places recognised", "Decoded in your browser"] },
  exif: { takes: "Photos", gives: "Their metadata, or clean copies", steps: ["Add photos", "See what's hidden", "Download clean copies"], features: ["GPS location shown on a map", "Camera, lens, dates, software and serial numbers", "Removed losslessly from JPG, PNG and WebP: no re-compression", "Rotation and colour profile kept", "Many photos at once, as a ZIP"] },
  cron: { takes: "A cron expression", gives: "Plain English and the next runs", steps: ["Type the expression", "Read it in English", "Check the next runs"], features: ["Explains every field", "The next 8 run times, in your time or UTC", "5 or 6 fields, names (MON, JAN) and macros (@daily)", "Common examples to start from"] },
  contrast: { takes: "Two colours", gives: "WCAG contrast results", steps: ["Pick text and background", "See the ratio", "Use a passing fix"], features: ["AA and AAA for normal and large text", "UI components and icons (3:1)", "Nearest passing colour suggested", "Hex, rgb() and hsl(), with transparency"] },
  cssgen: { takes: "A few settings", gives: "CSS to paste", steps: ["Adjust it", "Preview it live", "Copy the CSS"], features: ["Live preview", "Clean, standard CSS that works in every browser", "Gradients, layered shadows and blob shapes", "Copy with one tap"] },
};

