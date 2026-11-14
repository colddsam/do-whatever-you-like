/**
 * Multilingual WhatsApp chat export parser & analyzer — 100% browser/client-side.
 *
 * Zero server calls, zero paid APIs, zero storage fees. Supports:
 * - iOS / macOS / Desktop `[date, time] Author: message` exports
 * - Android / older Desktop `date, time - Author: message` exports
 * - `.txt` files, `.zip` archives (`_chat.txt` or `.txt` via fflate), and pasted text
 * - Any script or language (Latin, Devanagari/Hindi, Arabic/RTL, CJK, Cyrillic, European, Emoji)
 * - Auto DMY / MDY / YMD date-order disambiguation + localized digits & AM/PM markers
 */
import { unzipSync } from "fflate";

export type DateOrder = "auto" | "dmy" | "mdy" | "ymd";
export type ResolvedDateOrder = "dmy" | "mdy" | "ymd";
export type ExportStyle = "ios-bracket" | "android-dash" | "mixed";
export type MediaKind = "image" | "video" | "audio" | "sticker" | "document" | "location" | "contact" | "media";

export interface ChatMessage {
  index: number;
  timestampMs: number;
  dateKey: string; // YYYY-MM-DD (wall-clock UTC)
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  weekday: number; // 0 = Mon .. 6 = Sun
  hour: number; // 0..23
  minute: number; // 0..59
  sender: string | null; // null when system event
  isSystem: boolean;
  body: string;
  cleanBody: string; // without trailing edited marker
  wordCount: number;
  charCount: number;
  emojis: string[];
  urls: string[];
  isMedia: boolean;
  mediaKind: MediaKind | null;
  isDeleted: boolean;
  isEdited: boolean;
  isQuestion: boolean;
}

export interface ParsedChat {
  messages: ChatMessage[];
  senders: string[];
  exportStyle: ExportStyle;
  dateOrder: ResolvedDateOrder;
  ambiguousDateOrder: boolean;
  minDate: string;
  maxDate: string;
  totalLines: number;
  ignoredLines: number;
  archiveEntriesCount?: number;
}

export interface AnalyzeFilter {
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  senders?: string[]; // empty/undefined = all
  includeSystem?: boolean;
  hideStopwords?: boolean;
}

export interface SenderStats {
  sender: string;
  messages: number;
  share: number; // 0..1
  words: number;
  avgWords: number;
  chars: number;
  avgChars: number;
  media: number;
  links: number;
  questions: number;
  deleted: number;
  edited: number;
  emojis: number;
  topEmojis: { emoji: string; count: number }[];
  bursts: number;
  maxBurst: number;
  starters: number;
  medianReplyMin: number | null;
  avgReplyMin: number | null;
  peakHour: number;
}

export interface TimelinePoint {
  key: string; // YYYY-MM-DD, YYYY-Wxx, or YYYY-MM
  label: string;
  count: number;
  words: number;
  media: number;
  bySender: Record<string, number>;
}

export interface ChatAnalysis {
  filter: AnalyzeFilter;
  totalMessages: number;
  userMessages: number;
  systemMessages: number;
  participantCount: number;
  activeDays: number;
  calendarSpanDays: number;
  avgPerActiveDay: number;
  avgPerCalendarDay: number;
  totalWords: number;
  totalChars: number;
  totalMedia: number;
  mediaByKind: { kind: MediaKind; count: number }[];
  totalLinks: number;
  totalQuestions: number;
  totalDeleted: number;
  totalEdited: number;
  totalEmojis: number;
  uniqueEmojis: number;
  longestStreakDays: number;
  longestStreakRange: [string, string] | null;
  longestSilenceHours: number;
  longestSilenceRange: [string, string] | null;
  peakDay: { date: string; count: number } | null;
  peakHour: { hour: number; count: number } | null;
  peakWeekday: { weekday: number; name: string; count: number } | null;
  weekendShare: number;
  dayBuckets: { label: string; range: string; count: number; share: number }[];
  heatmap: number[][]; // [weekday Mon..Sun 0..6][hour 0..23]
  daily: TimelinePoint[];
  weekly: TimelinePoint[];
  monthly: TimelinePoint[];
  senders: SenderStats[];
  topEmojis: { emoji: string; count: number }[];
  topWords: { word: string; count: number }[];
  topBigrams: { phrase: string; count: number }[];
  topDomains: { domain: string; count: number }[];
  filteredMessages: ChatMessage[];
}

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const BIDI_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const SPACE_RE = /[\u00A0\u202F\u2009\u2007\t]+/g;

/** Converts localized Unicode decimal numerals (Arabic-Indic, Devanagari, Bengali, Thai, etc.) into ASCII 0-9. */
function toAsciiDigits(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (c >= 0x0966 && c <= 0x096f) out += String(c - 0x0966);
    else if (c >= 0x09e6 && c <= 0x09ef) out += String(c - 0x09e6);
    else if (c >= 0x0a66 && c <= 0x0a6f) out += String(c - 0x0a66);
    else if (c >= 0x0ae6 && c <= 0x0aef) out += String(c - 0x0ae6);
    else if (c >= 0x0be6 && c <= 0x0bef) out += String(c - 0x0be6);
    else if (c >= 0x0c66 && c <= 0x0c6f) out += String(c - 0x0c66);
    else if (c >= 0x0ce6 && c <= 0x0cef) out += String(c - 0x0ce6);
    else if (c >= 0x0d66 && c <= 0x0d6f) out += String(c - 0x0d66);
    else if (c >= 0x0e50 && c <= 0x0e59) out += String(c - 0x0e50);
    else if (c >= 0xff10 && c <= 0xff19) out += String(c - 0xff10);
    else out += input[i];
  }
  return out;
}

/** Decodes raw UTF-8 or UTF-16LE/BE text bytes reliably. */
export function decodeChatBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Extracts `_chat.txt` or primary `.txt` export from a WhatsApp `.zip` without decompressing heavy media files. */
export function extractChatTextFromZip(bytes: Uint8Array): { fileName: string; text: string; archiveEntriesCount: number } {
  let archiveEntriesCount = 0;
  const unzipped = unzipSync(bytes, {
    filter(file) {
      if (!file.name.endsWith("/") && !/(^|\/)__MACOSX\//.test(file.name)) {
        archiveEntriesCount++;
      }
      return /\.txt$/i.test(file.name) && !/(^|\/)__MACOSX\//.test(file.name);
    },
  });

  const txtNames = Object.keys(unzipped).filter((n) => unzipped[n]?.length > 0);
  if (txtNames.length === 0) {
    throw new Error("No WhatsApp chat .txt file was found inside this ZIP archive.");
  }

  txtNames.sort((a, b) => {
    const aChat = /(^|\/)_chat\.txt$/i.test(a) ? 1 : 0;
    const bChat = /(^|\/)_chat\.txt$/i.test(b) ? 1 : 0;
    if (aChat !== bChat) return bChat - aChat;
    return unzipped[b].length - unzipped[a].length;
  });

  const best = txtNames[0];
  return {
    fileName: best.split("/").pop() || best,
    text: decodeChatBytes(unzipped[best]),
    archiveEntriesCount,
  };
}

/** Month lookup covering English, Spanish, French, German, Portuguese, Italian, Dutch, Turkish, Indonesian, Polish, Russian. */
const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1, janv: 1, janvier: 1, janr: 1, jän: 1, jänner: 1, januar: 1, gen: 1, gennaio: 1, oca: 1, ocak: 1, sty: 1, янв: 1, январь: 1, января: 1,
  feb: 2, february: 2, febr: 2, febrero: 2, févr: 2, février: 2, fev: 2, fevereiro: 2, febb: 2, febbraio: 2, şub: 2, sub: 2, şubat: 2, lut: 2, фев: 2, февр: 2, февраль: 2, февраля: 2,
  mar: 3, march: 3, marzo: 3, mars: 3, mär: 3, märz: 3, maerz: 3, março: 3, marco: 3, mrt: 3, maart: 3, mart: 3, mrz: 3, мар: 3, март: 3, марта: 3,
  apr: 4, april: 4, abr: 4, abril: 4, avr: 4, avril: 4, aprill: 4, nis: 4, nisan: 4, kwi: 4, апр: 4, апрель: 4, апреля: 4,
  may: 5, mayo: 5, mai: 5, maio: 5, mag: 5, maggio: 5, mei: 5, mayıs: 5, mayis: 5, maj: 5, май: 5, мая: 5,
  jun: 6, june: 6, junio: 6, juin: 6, juni: 6, junho: 6, giu: 6, giugno: 6, haz: 6, haziran: 6, cze: 6, июн: 6, июнь: 6, июня: 6,
  jul: 7, july: 7, julio: 7, juil: 7, juillet: 7, juli: 7, julho: 7, lug: 7, luglio: 7, tem: 7, temmuz: 7, lip: 7, июл: 7, июль: 7, июля: 7,
  aug: 8, august: 8, ago: 8, agosto: 8, août: 8, aout: 8, augs: 8, ağustos: 8, agu: 8, agustus: 8, sie: 8, авг: 8, август: 8, августа: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, septembre: 9, set: 9, setembro: 9, settembre: 9, eyl: 9, eylül: 9, wrz: 9, сен: 9, сент: 9, сентябрь: 9, сентября: 9,
  oct: 10, october: 10, octo: 10, octubre: 10, octobre: 10, okt: 10, oktober: 10, out: 10, outubro: 10, ott: 10, ottobre: 10, eki: 10, ekim: 10, paź: 10, окт: 10, октябрь: 10, октября: 10,
  nov: 11, november: 11, noviembre: 11, novembre: 11, novembro: 11, kas: 11, kasım: 11, nop: 11, lis: 11, ноя: 11, нояб: 11, ноябрь: 11, ноября: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12, déc: 12, décembre: 12, dez: 12, dezember: 12, dezembro: 12, dicem: 12, dicembre: 12, ara: 12, aralık: 12, des: 12, gru: 12, дек: 12, декабрь: 12, декабря: 12,
};

function parseMonthToken(raw: string): number | null {
  const key = raw.toLowerCase().replace(/\./g, "").trim();
  return MONTH_MAP[key] ?? null;
}

function classifyMeridiem(raw: string | undefined): "am" | "pm" | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[\s.]+/g, "");
  if (!s) return null;
  if (
    s === "am" ||
    s === "a" ||
    s === "오전" ||
    s === "上午" ||
    s === "凌晨" ||
    s === "早上" ||
    s === "午前" ||
    s === "ص" ||
    s === "صباحا" ||
    s === "صباحاً" ||
    s === "صباح" ||
    s === "पूर्वाह्न" ||
    s === "पू" ||
    s === "सुबह" ||
    s === "प्रातः" ||
    s === "sa" ||
    s === "sáng" ||
    s === "dop" ||
    s === "de" ||
    s === "vorm" ||
    s === "πμ" ||
    s === "pagi" ||
    s === "pg"
  ) {
    return "am";
  }
  if (
    s === "pm" ||
    s === "p" ||
    s === "오후" ||
    s === "下午" ||
    s === "晚上" ||
    s === "傍晚" ||
    s === "中午" ||
    s === "午後" ||
    s === "م" ||
    s === "مساء" ||
    s === "مساءا" ||
    s === "مساءً" ||
    s === "अपराह्न" ||
    s === "अप" ||
    s === "शाम" ||
    s === "दोपहर" ||
    s === "रात" ||
    s === "ch" ||
    s === "chiều" ||
    s === "tối" ||
    s === "odp" ||
    s === "du" ||
    s === "nachm" ||
    s === "μμ" ||
    s === "sore" ||
    s === "malam" ||
    s === "mlm" ||
    s === "ptg"
  ) {
    return "pm";
  }
  return null;
}

type RawDateSpec =
  | { fixed: true; year: number; month: number; day: number }
  | { fixed: false; a: number; b: number; c: number; firstLen: number };

interface HeaderCandidate {
  style: "ios" | "android";
  date: RawDateSpec;
  hour: number;
  minute: number;
  second: number;
  meridiem: "am" | "pm" | null;
  rest: string;
}

const MERIDIEM_TOKEN =
  "(?:[ap]\\.?\\s*m\\.?|오전|오후|上午|下午|凌晨|晚上|早上|中午|傍晚|午前|午後|صباحاً|صباحا|صباح|ص|مساءً|مساءا|مساء|م|पूर्वाह्न|अपराह्न|सुबह|शाम|दोपहर|रात|प्रातः|पू|अप|π\\.?\\s*μ\\.?|μ\\.?\\s*μ\\.?|[\\p{L}\\p{M}.]{1,14})";

const TIME_RE = new RegExp(
  `^(?:(${MERIDIEM_TOKEN})\\s*)?(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?(?:\\s*(${MERIDIEM_TOKEN}))?`,
  "u",
);

function parseDatePart(segment: string): { date: RawDateSpec; consumed: number } | null {
  // Optional weekday prefix like "Mon, "
  const leadMatch = /^[\p{L}\p{M}.]{2,14}[,،]?\s+(?=\d|[\p{L}])/u.exec(segment);
  let offset = 0;
  let s = segment;
  // Only strip weekday prefix if it's NOT itself a month name followed by day number
  if (leadMatch && parseMonthToken(leadMatch[0].replace(/[,،\s]+$/, "")) === null) {
    offset = leadMatch[0].length;
    s = segment.slice(offset);
  }

  // 1. CJK: 2026年11月14日
  const cjk = /^(\d{4})年(\d{1,2})月(\d{1,2})日?/.exec(s);
  if (cjk) {
    return {
      date: { fixed: true, year: Number(cjk[1]), month: Number(cjk[2]), day: Number(cjk[3]) },
      consumed: offset + cjk[0].length,
    };
  }

  // 2. Korean spaced dots: 2026. 11. 14.
  const kor = /^(\d{4})\.\s+(\d{1,2})\.\s+(\d{1,2})\.?/.exec(s);
  if (kor) {
    return {
      date: { fixed: true, year: Number(kor[1]), month: Number(kor[2]), day: Number(kor[3]) },
      consumed: offset + kor[0].length,
    };
  }

  // 3. Numeric 3-part: D/M/YY, M/D/YYYY, YYYY-MM-DD, DD.MM.YYYY
  const num = /^(\d{1,4})([./-])(\d{1,2})\2(\d{1,4})\.?/.exec(s);
  if (num) {
    return {
      date: {
        fixed: false,
        a: Number(num[1]),
        b: Number(num[3]),
        c: Number(num[4]),
        firstLen: num[1].length,
      },
      consumed: offset + num[0].length,
    };
  }

  // 4. Day Month Year (e.g., "14 Nov 2026", "14 de nov de 2026", "14 нояб. 2026 г.")
  const dmyText = /^(\d{1,2})\.?(?:\s+de)?\s+([\p{L}\p{M}.]{2,16})(?:\s+de)?\s+(\d{2,4})(?:\s*г)?\.?/u.exec(s);
  if (dmyText) {
    const mon = parseMonthToken(dmyText[2]);
    if (mon !== null) {
      return {
        date: { fixed: true, year: expandYear(Number(dmyText[3])), month: mon, day: Number(dmyText[1]) },
        consumed: offset + dmyText[0].length,
      };
    }
  }

  // 5. Month Day Year (e.g., "Nov 14, 2026")
  const mdyText = /^([\p{L}\p{M}.]{2,16})\s+(\d{1,2}),?\s+(\d{2,4})/u.exec(s);
  if (mdyText) {
    const mon = parseMonthToken(mdyText[1]);
    if (mon !== null) {
      return {
        date: { fixed: true, year: expandYear(Number(mdyText[3])), month: mon, day: Number(mdyText[2]) },
        consumed: offset + mdyText[0].length,
      };
    }
  }

  return null;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

function parseDateTimeBlock(block: string): {
  date: RawDateSpec;
  hour: number;
  minute: number;
  second: number;
  meridiem: "am" | "pm" | null;
  consumed: number;
} | null {
  const dp = parseDatePart(block);
  if (!dp) return null;

  const afterDate = block.slice(dp.consumed);
  const cjkAdjacent = dp.consumed > 0 && block[dp.consumed - 1] === "日";
  const sepMatch = cjkAdjacent
    ? /^(?:\s*[,،]\s*|\s*)/.exec(afterDate)
    : /^(?:\s*[,،]\s*|\s+(?:à|um|om|at|a las|às|alle|klo|kl\.|в)\s+|\s+-\s+|\s+)/i.exec(afterDate);
  if (!sepMatch) return null;

  const afterSep = afterDate.slice(sepMatch[0].length);
  const tm = TIME_RE.exec(afterSep);
  if (!tm) return null;

  const hour = Number(tm[2]);
  const minute = Number(tm[3]);
  const second = tm[4] ? Number(tm[4]) : 0;
  if (hour > 24 || minute > 59 || second > 59) return null;

  const meridiem = classifyMeridiem(tm[1]) ?? classifyMeridiem(tm[5]);
  return {
    date: dp.date,
    hour,
    minute,
    second,
    meridiem,
    consumed: dp.consumed + sepMatch[0].length + tm[0].length,
  };
}

function matchHeaderPrefix(rawLine: string): HeaderCandidate | null {
  // Normalize only prefix (up to ~120 code points) so body stays untouched except trimming bidi marks cleanly
  const cleanHead = toAsciiDigits(rawLine.slice(0, 120).replace(BIDI_RE, "").replace(SPACE_RE, " ")).trimStart();

  // iOS / Desktop style: `[date, time] body`
  if (cleanHead.startsWith("[")) {
    const closeIdx = cleanHead.indexOf("]", 8);
    if (closeIdx > 0 && closeIdx <= 68) {
      const inner = cleanHead.slice(1, closeIdx).trim();
      const dt = parseDateTimeBlock(inner);
      if (dt && dt.consumed === inner.length) {
        const rawClose = rawLine.indexOf("]");
        const rest = rawClose >= 0 ? rawLine.slice(rawClose + 1).replace(/^[\s\u200E\u200F]+/, "") : "";
        return {
          style: "ios",
          date: dt.date,
          hour: dt.hour,
          minute: dt.minute,
          second: dt.second,
          meridiem: dt.meridiem,
          rest,
        };
      }
    }
  }

  // Android style: `date, time - body`
  const dt = parseDateTimeBlock(cleanHead);
  if (!dt) return null;
  const afterDt = cleanHead.slice(dt.consumed);
  const dashMatch = /^\s+[-–—]\s+/.exec(afterDt);
  if (!dashMatch) return null;

  // Locate the body start directly in original rawLine after matching the dash separator
  const leadBidiTrim = rawLine.length - rawLine.replace(/^[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\s]+/, "").length;
  // Find exact dash separator in original rawLine starting around expected offset
  const rawAfterLead = rawLine.slice(leadBidiTrim);
  const rawDashSearch = /^[^-\n–—]*(?:[-./]\d{1,4}[^-\n–—]*)?\s+[-–—]\s+/.exec(rawAfterLead);
  // Even safer: map consumed+dash length using normalized match on rawLine prefix
  let rest = "";
  let normCount = 0;
  const targetLen = dt.consumed + dashMatch[0].length;
  let pos = 0;
  let prevSpace = false;
  while (pos < rawLine.length && normCount < targetLen) {
    const ch = rawLine[pos];
    pos++;
    if (BIDI_RE.test(ch)) {
      BIDI_RE.lastIndex = 0;
      continue;
    }
    BIDI_RE.lastIndex = 0;
    const isSp = SPACE_RE.test(ch) || ch === " ";
    SPACE_RE.lastIndex = 0;
    if (isSp) {
      if (normCount === 0) continue; // trimStart parity
      if (!prevSpace) normCount++;
      prevSpace = true;
    } else {
      normCount++;
      prevSpace = false;
    }
  }
  rest = rawLine.slice(pos).replace(/^[\u200E\u200F\s]+/, "");
  if (!rest && rawDashSearch) {
    rest = rawAfterLead.slice(rawDashSearch[0].length).replace(/^[\u200E\u200F\s]+/, "");
  }

  return {
    style: "android",
    date: dt.date,
    hour: dt.hour,
    minute: dt.minute,
    second: dt.second,
    meridiem: dt.meridiem,
    rest,
  };
}

function resolveHour24(hour: number, meridiem: "am" | "pm" | null): number {
  if (meridiem === "am") return hour === 12 ? 0 : hour % 24;
  if (meridiem === "pm") return hour < 12 ? hour + 12 : hour % 24;
  return hour === 24 ? 0 : hour;
}

function resolveYMD(date: RawDateSpec, order: ResolvedDateOrder): { year: number; month: number; day: number } | null {
  if (date.fixed) {
    const y = expandYear(date.year);
    if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return null;
    return { year: y, month: date.month, day: date.day };
  }
  let year: number;
  let month: number;
  let day: number;
  if (date.firstLen === 4 || order === "ymd") {
    year = expandYear(date.a);
    month = date.b;
    day = date.c;
  } else if (order === "mdy") {
    month = date.a;
    day = date.b;
    year = expandYear(date.c);
  } else {
    day = date.a;
    month = date.b;
    year = expandYear(date.c);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Validate actual calendar day (e.g. Feb 30 invalid)
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function detectDateOrder(candidates: HeaderCandidate[], forced: DateOrder): { order: ResolvedDateOrder; ambiguous: boolean } {
  if (forced !== "auto") return { order: forced, ambiguous: false };

  let ymdVotes = 0;
  let dmyVotes = 0;
  let mdyVotes = 0;
  const numericDates: Extract<RawDateSpec, { fixed: false }>[] = [];

  for (const c of candidates) {
    if (c.date.fixed) continue;
    numericDates.push(c.date);
    if (c.date.firstLen === 4) {
      ymdVotes += 100;
    } else {
      if (c.date.a > 12 && c.date.b <= 12) dmyVotes += 100;
      else if (c.date.b > 12 && c.date.a <= 12) mdyVotes += 100;
    }
  }

  if (ymdVotes > 0 && ymdVotes >= dmyVotes && ymdVotes >= mdyVotes) {
    return { order: "ymd", ambiguous: false };
  }
  if (dmyVotes > mdyVotes) return { order: "dmy", ambiguous: false };
  if (mdyVotes > dmyVotes) return { order: "mdy", ambiguous: false };
  if (numericDates.length === 0) return { order: "dmy", ambiguous: false };

  // No day > 12 present: test chronological monotonicity & span across DMY vs MDY
  const scoreOrder = (ord: ResolvedDateOrder) => {
    let invalid = 0;
    let inversions = 0;
    let prev = -Infinity;
    let firstTs = Infinity;
    let lastTs = -Infinity;
    for (const c of candidates) {
      const ymd = resolveYMD(c.date, ord);
      if (!ymd) {
        invalid++;
        continue;
      }
      const h = resolveHour24(c.hour, c.meridiem);
      const ts = Date.UTC(ymd.year, ymd.month - 1, ymd.day, h, c.minute, c.second);
      if (ts < prev) inversions++;
      prev = ts;
      if (ts < firstTs) firstTs = ts;
      if (ts > lastTs) lastTs = ts;
    }
    return { invalid, inversions, span: Number.isFinite(lastTs - firstTs) ? lastTs - firstTs : Infinity };
  };

  const dmyScore = scoreOrder("dmy");
  const mdyScore = scoreOrder("mdy");
  if (mdyScore.invalid < dmyScore.invalid) return { order: "mdy", ambiguous: false };
  if (dmyScore.invalid < mdyScore.invalid) return { order: "dmy", ambiguous: false };
  if (mdyScore.inversions < dmyScore.inversions) return { order: "mdy", ambiguous: false };
  if (dmyScore.inversions < mdyScore.inversions) return { order: "dmy", ambiguous: false };
  if (mdyScore.span < dmyScore.span) return { order: "mdy", ambiguous: true };
  return { order: "dmy", ambiguous: true };
}

function splitSenderAndBody(rest: string): { sender: string | null; body: string; isSystem: boolean } {
  const colonIdx = rest.indexOf(": ");
  if (colonIdx <= 0 || colonIdx > 80) {
    return { sender: null, body: rest, isSystem: true };
  }
  const candidateSender = rest.slice(0, colonIdx).replace(BIDI_RE, "").trim();
  if (!candidateSender || /^https?$/i.test(candidateSender) || candidateSender.includes("\n")) {
    return { sender: null, body: rest, isSystem: true };
  }
  // WhatsApp E2E notices or group descriptions almost never have short colon-prefixed sender names,
  // except rare lines starting with known WhatsApp system banners.
  if (/^messages and calls are end-to-end encrypted/i.test(rest)) {
    return { sender: null, body: rest, isSystem: true };
  }
  const body = rest.slice(colonIdx + 2);
  return { sender: candidateSender, body, isSystem: false };
}

const EDITED_MARKER_RE =
  /(?:\s*(?:\u200E|\u200F)*<(?:This message was edited|Se edit[oó] este mensaje|Mensaje editado|Esta mensagem foi editada|Ce message a été modifié|Diese Nachricht wurde bearbeitet|Questo messaggio è stato modificato|Dit bericht is bewerkt|यह संदेश संपादित किया गया|تم تعديل هذه الرسالة|Pesan ini telah diedit|Bu mesaj düzenlendi|Сообщение изменено|此消息已编辑|このメッセージは編集されました|이 메시지는 수정되었습니다)>)\s*$/iu;

const DELETED_PATTERNS = [
  /^this message was deleted\.?$/i,
  /^you deleted this message\.?$/i,
  /^se elimin[oó] este mensaje\.?$/i,
  /^eliminaste este mensaje\.?$/i,
  /^mensagem apagada\.?$/i,
  /^voc[eê] apagou esta mensagem\.?$/i,
  /^ce message a été supprimé\.?$/i,
  /^vous avez supprimé ce message\.?$/i,
  /^diese nachricht wurde gelöscht\.?$/i,
  /^du hast diese nachricht gelöscht\.?$/i,
  /^questo messaggio è stato eliminato\.?$/i,
  /^dit bericht is verwijderd\.?$/i,
  /^यह संदेश मिटाया गया\.?$/u,
  /^आपने यह संदेश मिटाया\.?$/u,
  /^تم حذف هذه الرسالة\.?$/u,
  /^لقد حذفت هذه الرسالة\.?$/u,
  /^pesan ini telah dihapus\.?$/i,
  /^anda menghapus pesan ini\.?$/i,
  /^bu mesaj silindi\.?$/i,
  /^сообщение удалено\.?$/iu,
  /^此消息已删除$/u,
  /^이 메시지는 삭제되었습니다\.?$/u,
];

const BRACKET_MEDIA_OMITTED_RE =
  /<(?:media omitted|multimedia omitido|m[ií]dia oculta|m[eé]dias omis|medien ausgeschlossen|media omessi|media weggelaten|media tidak disertakan|medya dahil edilmedi|मीडिया छोड़ा गया|मीडिया शामिल नहीं है|الوسائط غير مدرجة)>/i;

function classifyMedia(rawBody: string): MediaKind | null {
  const b = rawBody.replace(BIDI_RE, "").trim();
  const firstLine = b.split("\n")[0].trim();
  const low = firstLine.toLowerCase();

  // Attached file notation in iOS / Android with-media ZIP exports (caption may follow on next line)
  const attachMatch =
    /^<attached:\s*([^>]+)>$/i.exec(firstLine) ||
    /^(\S+\.\w{2,5})\s*\((?:file attached|archivo adjunto|arquivo anexado|fichier joint|datei angehängt|file allegato|ملف مرفق|फ़ाइल संलग्न)\)$/i.exec(firstLine);
  if (attachMatch) {
    const ext = attachMatch[1].toLowerCase().split(".").pop() ?? "";
    if (["jpg", "jpeg", "png", "gif", "heic", "avif"].includes(ext) || firstLine.includes("PHOTO")) return "image";
    if (["webp"].includes(ext) || firstLine.includes("STICKER")) return "sticker";
    if (["mp4", "mov", "3gp", "mkv", "webm"].includes(ext) || firstLine.includes("VIDEO")) return "video";
    if (["opus", "ogg", "mp3", "m4a", "aac", "wav"].includes(ext) || firstLine.includes("AUDIO")) return "audio";
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip", "csv"].includes(ext)) return "document";
    if (["vcf"].includes(ext)) return "contact";
    return "media";
  }

  if (BRACKET_MEDIA_OMITTED_RE.test(b) || low === "تم استبعاد الوسائط" || low === "без медиафайлов" || low === "省略媒体") {
    return "media";
  }

  if (/^(?:image omitted|imagen omitida|imagem ocultada|image omise|bild weggelassen|immagine omessa|afbeelding weggelaten|gambar tidak disertakan|görüntü dahil edilmedi|फ़ोटो शामिल नहीं|تم استبعاد الصورة|画像が省略されました|사진 제외됨|圖片已略過)$/i.test(firstLine)) return "image";
  if (/^(?:video omitted|v[ií]deo omitido|vid[eé]o omise|video weggelassen|video omesso|video tidak disertakan|वीडियो शामिल नहीं|تم استبعاد الفيديو|動画が省略されました|동영상 제외됨)$/i.test(firstLine)) return "video";
  if (/^(?:audio omitted|audio omitido|[aá]udio oculto|audio omis|audio weggelassen|audio omesso|ऑडियो शामिल नहीं|تم استبعاد الصوت|音声が省略されました|오디오 제외됨)$/i.test(firstLine)) return "audio";
  if (/^(?:sticker omitted|sticker omitido|figurinha omitida|autocollant omis|sticker weggelassen|स्टिकर शामिल नहीं|تم استبعاد الملصق|스티커 제외됨|貼圖已略過)$/i.test(firstLine)) return "sticker";
  if (/^(?:gif omitted|gif omitido|gif omis)$/i.test(firstLine)) return "image";
  if (/^(?:document omitted|documento omitido|document omis|dokument weggelassen|दस्तावेज़ शामिल नहीं|تم استبعاد المستند)$/i.test(firstLine)) return "document";
  if (/^(?:contact card omitted|tarjeta de contacto omitida|cartão de contato omitido|vcard omitted)$/i.test(firstLine)) return "contact";
  if (/^(?:location:|live location shared|ubicación:|localização:)/i.test(firstLine)) return "location";

  return null;
}

const EMOJI_RE =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D(?:\p{Extended_Pictographic}|\uFE0F|\p{Emoji_Modifier}))*)/gu;

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]\}]+/gi;

const WORD_SEGMENTER =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

const WORD_FALLBACK_RE = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*/gu;

/** Multilingual common filler words when user leaves stopword hiding on. */
const STOPWORDS = new Set([
  // English
  "the", "and", "for", "that", "this", "with", "you", "your", "are", "was", "were", "have", "has", "had",
  "but", "not", "all", "can", "will", "just", "like", "what", "when", "where", "who", "how", "why",
  "from", "they", "them", "their", "she", "him", "his", "her", "our", "out", "about", "there", "here",
  "then", "than", "into", "get", "got", "one", "two", "it's", "i'm", "don't", "didn't", "can't", "yes", "yeah", "okay", "ok", "oh",
  // Hindi / Hinglish (Devanagari + Roman)
  "है", "हैं", "हूँ", "हूं", "था", "थी", "थे", "का", "की", "के", "को", "में", "से", "पर", "और", "या", "नहीं", "हाँ", "हां", "क्या", "भी", "तो", "ही", "ये", "वो", "इस", "उस", "हम", "तुम", "आप", "मैं", "कर", "रहा", "रही", "रहे", "गया", "गई", "हो",
  "hai", "hain", "ka", "ki", "ke", "ko", "mein", "me", "se", "par", "aur", "nahi", "haan", "han", "kya", "bhi", "toh", "woh", "yeh", "hum", "tum", "aap", "main", "kar", "raha", "rahi", "ho",
  // Spanish / Portuguese / French / German / Italian / Indonesian / Arabic
  "que", "los", "las", "una", "uno", "con", "por", "para", "como", "pero", "más", "mas", "muy", "está", "esta", "este", "esto", "eso", "estoy", "hola", "sí",
  "não", "nao", "com", "uma", "você", "voce", "pra", "tá", "ta", "sim",
  "les", "des", "une", "est", "pas", "pour", "dans", "qui", "sur", "avec", "tout", "mais", "oui", "non",
  "und", "der", "die", "das", "ich", "ist", "nicht", "mit", "ein", "eine", "auf", "für", "auch", "wie", "mir", "dich", "wir", "ihr", "ja",
  "che", "non", "per", "con", "sono", "una", "ciao", "alla", "della",
  "yang", "dan", "ini", "itu", "ada", "aku", "kamu", "dari", "untuk", "juga", "bisa", "ya",
  "في", "من", "على", "إلى", "الى", "عن", "مع", "هذا", "هذه", "ما", "لا", "أن", "ان", "هو", "هي", "كان", "كل", "يا",
  // Noise
  "http", "https", "www", "com",
]);

function extractUrls(text: string): { urls: string[]; withoutUrls: string } {
  const urls: string[] = [];
  const withoutUrls = text.replace(URL_RE, (match) => {
    const cleaned = match.replace(/[.,!?:;]+$/, "");
    urls.push(cleaned);
    return " ";
  });
  return { urls, withoutUrls };
}

function extractWords(text: string): string[] {
  if (!text) return [];
  if (WORD_SEGMENTER) {
    const words: string[] = [];
    for (const seg of WORD_SEGMENTER.segment(text)) {
      if (seg.isWordLike) {
        const w = seg.segment.toLowerCase();
        // Exclude pure ASCII numbers while preserving words in every script
        if (!/^\d+$/.test(w)) words.push(w);
      }
    }
    return words;
  }
  const matches = text.match(WORD_FALLBACK_RE) ?? [];
  return matches.map((w) => w.toLowerCase()).filter((w) => !/^\d+$/.test(w));
}

function formatUtcDateKey(ms: number): { dateKey: string; year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // JS getUTCDay(): 0 = Sun..6 = Sat -> convert to 0 = Mon..6 = Sun
  const weekday = (d.getUTCDay() + 6) % 7;
  return { dateKey, year, month, day, weekday, hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

function stripMediaMarkerForWords(cleanBody: string, isMedia: boolean): string {
  if (!isMedia) return cleanBody;
  const lines = cleanBody.replace(BRACKET_MEDIA_OMITTED_RE, "").trim().split("\n");
  const first = (lines[0] ?? "").trim();
  if (!first) return lines.slice(1).join("\n").trim();
  const isAttachHeader =
    /^<attached:\s*[^>]+>$/i.test(first) ||
    /^\S+\.\w{2,5}\s*\((?:file attached|archivo adjunto|arquivo anexado|fichier joint|datei angehängt|file allegato|ملف مرفق|फ़ाइल संलग्न)\)$/i.test(first) ||
    classifyMedia(first) !== null;
  return (isAttachHeader ? lines.slice(1) : lines).join("\n").trim();
}

/** Parses raw exported WhatsApp chat text into structured chronological messages. */
export function parseWhatsappChat(
  rawText: string,
  options: { dateOrder?: DateOrder; archiveEntriesCount?: number } = {},
): ParsedChat {
  const normalizedLines = rawText.replace(/\r\n?/g, "\n").split("\n");
  const rawRecords: { header: HeaderCandidate; continuation: string[] }[] = [];
  let ignoredLines = 0;

  for (const line of normalizedLines) {
    const header = matchHeaderPrefix(line);
    if (header) {
      rawRecords.push({ header, continuation: [] });
    } else if (rawRecords.length > 0) {
      rawRecords[rawRecords.length - 1].continuation.push(line);
    } else if (line.trim()) {
      ignoredLines++;
    }
  }

  const { order, ambiguous } = detectDateOrder(
    rawRecords.map((r) => r.header),
    options.dateOrder ?? "auto",
  );

  let iosCount = 0;
  let androidCount = 0;
  const senderSet = new Set<string>();
  const messages: ChatMessage[] = [];

  for (const rec of rawRecords) {
    const { header, continuation } = rec;
    const ymd = resolveYMD(header.date, order);
    if (!ymd) {
      ignoredLines++;
      continue;
    }

    if (header.style === "ios") iosCount++;
    else androidCount++;

    const hour = resolveHour24(header.hour, header.meridiem);
    const timestampMs = Date.UTC(ymd.year, ymd.month - 1, ymd.day, hour, header.minute, header.second);
    const fullRest = continuation.length > 0 ? `${header.rest}\n${continuation.join("\n")}` : header.rest;
    const { sender, body, isSystem } = splitSenderAndBody(fullRest);

    if (sender) senderSet.add(sender);

    const edited = !isSystem && EDITED_MARKER_RE.test(body);
    const bodyWithoutEdited = edited ? body.replace(EDITED_MARKER_RE, "").trim() : body.trim();
    const cleanMarkerCheck = bodyWithoutEdited.replace(BIDI_RE, "").trim();
    const isDeleted = !isSystem && DELETED_PATTERNS.some((re) => re.test(cleanMarkerCheck));
    const mediaKind = !isSystem && !isDeleted ? classifyMedia(bodyWithoutEdited) : null;
    const isMedia = mediaKind !== null;

    const { urls, withoutUrls } = extractUrls(isDeleted || isSystem ? "" : stripMediaMarkerForWords(bodyWithoutEdited, isMedia));
    const emojis = isDeleted || isSystem ? [] : bodyWithoutEdited.match(EMOJI_RE) ?? [];
    const countableText = isSystem || isDeleted ? "" : withoutUrls.replace(BIDI_RE, " ");
    const words = extractWords(countableText);
    const isQuestion = !isSystem && !isDeleted && /[?؟？]/.test(withoutUrls);
    const utcInfo = formatUtcDateKey(timestampMs);

    messages.push({
      index: messages.length,
      timestampMs,
      dateKey: utcInfo.dateKey,
      year: utcInfo.year,
      month: utcInfo.month,
      day: utcInfo.day,
      weekday: utcInfo.weekday,
      hour: utcInfo.hour,
      minute: utcInfo.minute,
      sender,
      isSystem,
      body: body.trim(),
      cleanBody: bodyWithoutEdited,
      wordCount: words.length,
      charCount: isSystem || isDeleted ? 0 : [...bodyWithoutEdited.replace(BIDI_RE, "")].length,
      emojis,
      urls,
      isMedia,
      mediaKind,
      isDeleted,
      isEdited: edited,
      isQuestion,
    });
  }

  // Sort chronologically while preserving file order on equal timestamps
  messages.sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index);
  messages.forEach((m, i) => {
    m.index = i;
  });

  const exportStyle: ExportStyle = iosCount > 0 && androidCount > 0 ? "mixed" : iosCount > 0 ? "ios-bracket" : "android-dash";
  return {
    messages,
    senders: Array.from(senderSet),
    exportStyle,
    dateOrder: order,
    ambiguousDateOrder: ambiguous,
    minDate: messages[0]?.dateKey ?? "",
    maxDate: messages[messages.length - 1]?.dateKey ?? "",
    totalLines: normalizedLines.length,
    ignoredLines,
    archiveEntriesCount: options.archiveEntriesCount,
  };
}

function isoWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function daysBetweenKeys(startKey: string, endKey: string): number {
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Computes complete quantitative and qualitative analytics over a parsed chat with optional filters. */
export function analyzeWhatsappChat(parsed: ParsedChat, filter: AnalyzeFilter = {}): ChatAnalysis {
  const selectedSenders = filter.senders && filter.senders.length > 0 ? new Set(filter.senders) : null;
  const includeSystem = filter.includeSystem ?? true;
  const hideStopwords = filter.hideStopwords ?? true;

  const filtered = parsed.messages.filter((m) => {
    if (filter.fromDate && m.dateKey < filter.fromDate) return false;
    if (filter.toDate && m.dateKey > filter.toDate) return false;
    if (m.isSystem && !includeSystem) return false;
    if (selectedSenders && !m.isSystem && m.sender && !selectedSenders.has(m.sender)) return false;
    if (selectedSenders && m.isSystem && !includeSystem) return false;
    return true;
  });

  const userMessagesList = filtered.filter((m) => !m.isSystem && m.sender !== null);
  const systemMessages = filtered.length - userMessagesList.length;

  const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const dailyMap = new Map<string, TimelinePoint>();
  const weeklyMap = new Map<string, TimelinePoint>();
  const monthlyMap = new Map<string, TimelinePoint>();

  const emojiGlobal = new Map<string, number>();
  const wordGlobal = new Map<string, number>();
  const bigramGlobal = new Map<string, number>();
  const domainGlobal = new Map<string, number>();
  const mediaKindGlobal = new Map<MediaKind, number>();
  const dayBuckets = [
    { label: "Late night", range: "00–05", count: 0 },
    { label: "Morning", range: "06–11", count: 0 },
    { label: "Afternoon", range: "12–17", count: 0 },
    { label: "Evening", range: "18–23", count: 0 },
  ];

  interface SenderAcc {
    messages: number;
    words: number;
    chars: number;
    media: number;
    links: number;
    questions: number;
    deleted: number;
    edited: number;
    emojis: number;
    emojiCounts: Map<string, number>;
    hourCounts: number[];
    bursts: number;
    maxBurst: number;
    starters: number;
    replyMinutes: number[];
  }
  const senderAcc = new Map<string, SenderAcc>();
  const ensureSender = (s: string): SenderAcc => {
    let a = senderAcc.get(s);
    if (!a) {
      a = {
        messages: 0,
        words: 0,
        chars: 0,
        media: 0,
        links: 0,
        questions: 0,
        deleted: 0,
        edited: 0,
        emojis: 0,
        emojiCounts: new Map(),
        hourCounts: Array.from({ length: 24 }, () => 0),
        bursts: 0,
        maxBurst: 0,
        starters: 0,
        replyMinutes: [],
      };
      senderAcc.set(s, a);
    }
    return a;
  };

  let totalWords = 0;
  let totalChars = 0;
  let totalMedia = 0;
  let totalLinks = 0;
  let totalQuestions = 0;
  let totalDeleted = 0;
  let totalEdited = 0;
  let totalEmojis = 0;

  // Timeline accumulators
  const bumpTimeline = (map: Map<string, TimelinePoint>, key: string, label: string, m: ChatMessage) => {
    let p = map.get(key);
    if (!p) {
      p = { key, label, count: 0, words: 0, media: 0, bySender: {} };
      map.set(key, p);
    }
    p.count++;
    p.words += m.wordCount;
    if (m.isMedia) p.media++;
    if (m.sender) p.bySender[m.sender] = (p.bySender[m.sender] ?? 0) + 1;
  };

  // Interaction dynamics across userMessagesList
  const STARTER_GAP_MS = 6 * 3_600_000;
  const MAX_REPLY_MS = 12 * 3_600_000;
  let prevUserMsg: ChatMessage | null = null;
  let currentBurst = 0;
  let longestSilenceMs = 0;
  let longestSilenceRange: [string, string] | null = null;

  for (let i = 0; i < filtered.length; i++) {
    const m = filtered[i];
    if (i > 0) {
      const gap = m.timestampMs - filtered[i - 1].timestampMs;
      if (gap > longestSilenceMs) {
        longestSilenceMs = gap;
        longestSilenceRange = [filtered[i - 1].dateKey, m.dateKey];
      }
    }

    if (m.isSystem || !m.sender) continue;

    heatmap[m.weekday][m.hour]++;
    dayBuckets[Math.min(3, Math.floor(m.hour / 6))].count++;
    bumpTimeline(dailyMap, m.dateKey, m.dateKey, m);
    const wk = isoWeekKey(m.dateKey);
    bumpTimeline(weeklyMap, wk, wk, m);
    const mo = m.dateKey.slice(0, 7);
    bumpTimeline(monthlyMap, mo, mo, m);

    const acc = ensureSender(m.sender);
    acc.messages++;
    acc.words += m.wordCount;
    acc.chars += m.charCount;
    acc.hourCounts[m.hour]++;
    totalWords += m.wordCount;
    totalChars += m.charCount;

    if (m.isMedia && m.mediaKind) {
      acc.media++;
      totalMedia++;
      mediaKindGlobal.set(m.mediaKind, (mediaKindGlobal.get(m.mediaKind) ?? 0) + 1);
    }
    if (m.urls.length > 0) {
      acc.links += m.urls.length;
      totalLinks += m.urls.length;
      for (const u of m.urls) {
        try {
          const parsedUrl = new URL(u.startsWith("http") ? u : `https://${u}`);
          const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
          if (host) domainGlobal.set(host, (domainGlobal.get(host) ?? 0) + 1);
        } catch {
          /* skip malformed URL */
        }
      }
    }
    if (m.isQuestion) {
      acc.questions++;
      totalQuestions++;
    }
    if (m.isDeleted) {
      acc.deleted++;
      totalDeleted++;
    }
    if (m.isEdited) {
      acc.edited++;
      totalEdited++;
    }

    for (const em of m.emojis) {
      acc.emojis++;
      totalEmojis++;
      acc.emojiCounts.set(em, (acc.emojiCounts.get(em) ?? 0) + 1);
      emojiGlobal.set(em, (emojiGlobal.get(em) ?? 0) + 1);
    }

    if (!m.isDeleted) {
      const { withoutUrls } = extractUrls(stripMediaMarkerForWords(m.cleanBody, m.isMedia));
      const tokens = extractWords(withoutUrls);
      const meaningful = tokens.filter((w) => w.length >= 2 && (!hideStopwords || !STOPWORDS.has(w)));
      for (const w of meaningful) {
        wordGlobal.set(w, (wordGlobal.get(w) ?? 0) + 1);
      }
      for (let t = 0; t + 1 < meaningful.length; t++) {
        const bg = `${meaningful[t]} ${meaningful[t + 1]}`;
        bigramGlobal.set(bg, (bigramGlobal.get(bg) ?? 0) + 1);
      }
    }

    // Starters, bursts, and reply latency
    if (!prevUserMsg) {
      acc.starters++;
      currentBurst = 1;
      acc.bursts++;
      acc.maxBurst = 1;
    } else {
      const delta = m.timestampMs - prevUserMsg.timestampMs;
      if (delta >= STARTER_GAP_MS) {
        acc.starters++;
      }
      if (prevUserMsg.sender === m.sender) {
        currentBurst++;
        if (currentBurst === 2) acc.bursts++;
        if (currentBurst > acc.maxBurst) acc.maxBurst = currentBurst;
      } else {
        currentBurst = 1;
        if (delta > 0 && delta <= MAX_REPLY_MS) {
          acc.replyMinutes.push(delta / 60_000);
        }
      }
    }
    prevUserMsg = m;
  }

  // Daily series sorted chronologically
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.key.localeCompare(b.key));
  const weekly = Array.from(weeklyMap.values()).sort((a, b) => a.key.localeCompare(b.key));
  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.key.localeCompare(b.key));

  // Longest active daily streak
  let longestStreakDays = 0;
  let longestStreakRange: [string, string] | null = null;
  let runLen = 0;
  let runStart = "";
  let prevKey = "";
  let peakDay: { date: string; count: number } | null = null;

  for (const pt of daily) {
    if (!peakDay || pt.count > peakDay.count) {
      peakDay = { date: pt.key, count: pt.count };
    }
    if (!prevKey || daysBetweenKeys(prevKey, pt.key) > 1) {
      runLen = 1;
      runStart = pt.key;
    } else {
      runLen++;
    }
    if (runLen > longestStreakDays) {
      longestStreakDays = runLen;
      longestStreakRange = [runStart, pt.key];
    }
    prevKey = pt.key;
  }

  const activeDays = daily.length;
  const calendarSpanDays = daily.length > 0 ? daysBetweenKeys(daily[0].key, daily[daily.length - 1].key) + 1 : 0;

  // Peak hour & weekday
  const hourTotals = Array.from({ length: 24 }, (_, h) => heatmap.reduce((s, row) => s + row[h], 0));
  const weekdayTotals = heatmap.map((row) => row.reduce((s, n) => s + n, 0));
  let peakHour: { hour: number; count: number } | null = null;
  hourTotals.forEach((count, hour) => {
    if (count > 0 && (!peakHour || count > peakHour.count)) peakHour = { hour, count };
  });
  let peakWeekday: { weekday: number; name: string; count: number } | null = null;
  weekdayTotals.forEach((count, weekday) => {
    if (count > 0 && (!peakWeekday || count > peakWeekday.count)) {
      peakWeekday = { weekday, name: WEEKDAY_NAMES[weekday], count };
    }
  });
  const weekendTotal = weekdayTotals[5] + weekdayTotals[6];
  const userMsgTotal = userMessagesList.length;

  // Sender leaderboard
  const senders: SenderStats[] = Array.from(senderAcc.entries())
    .map(([sender, a]) => {
      let topHour = 0;
      for (let h = 1; h < 24; h++) {
        if (a.hourCounts[h] > a.hourCounts[topHour]) topHour = h;
      }
      const med = median(a.replyMinutes);
      const mean = a.replyMinutes.length > 0 ? a.replyMinutes.reduce((x, y) => x + y, 0) / a.replyMinutes.length : null;
      return {
        sender,
        messages: a.messages,
        share: userMsgTotal > 0 ? a.messages / userMsgTotal : 0,
        words: a.words,
        avgWords: a.messages > 0 ? Number((a.words / a.messages).toFixed(1)) : 0,
        chars: a.chars,
        avgChars: a.messages > 0 ? Math.round(a.chars / a.messages) : 0,
        media: a.media,
        links: a.links,
        questions: a.questions,
        deleted: a.deleted,
        edited: a.edited,
        emojis: a.emojis,
        topEmojis: Array.from(a.emojiCounts.entries())
          .sort((x, y) => y[1] - x[1])
          .slice(0, 5)
          .map(([emoji, count]) => ({ emoji, count })),
        bursts: a.bursts,
        maxBurst: a.maxBurst,
        starters: a.starters,
        medianReplyMin: med !== null ? Number(med.toFixed(1)) : null,
        avgReplyMin: mean !== null ? Number(mean.toFixed(1)) : null,
        peakHour: topHour,
      };
    })
    .sort((a, b) => b.messages - a.messages || b.words - a.words);

  return {
    filter,
    totalMessages: filtered.length,
    userMessages: userMsgTotal,
    systemMessages,
    participantCount: senders.length,
    activeDays,
    calendarSpanDays,
    avgPerActiveDay: activeDays > 0 ? Number((userMsgTotal / activeDays).toFixed(1)) : 0,
    avgPerCalendarDay: calendarSpanDays > 0 ? Number((userMsgTotal / calendarSpanDays).toFixed(1)) : 0,
    totalWords,
    totalChars,
    totalMedia,
    mediaByKind: Array.from(mediaKindGlobal.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    totalLinks,
    totalQuestions,
    totalDeleted,
    totalEdited,
    totalEmojis,
    uniqueEmojis: emojiGlobal.size,
    longestStreakDays,
    longestStreakRange,
    longestSilenceHours: Math.round(longestSilenceMs / 3_600_000),
    longestSilenceRange,
    peakDay,
    peakHour,
    peakWeekday,
    weekendShare: userMsgTotal > 0 ? weekendTotal / userMsgTotal : 0,
    dayBuckets: dayBuckets.map((b) => ({
      ...b,
      share: userMsgTotal > 0 ? b.count / userMsgTotal : 0,
    })),
    heatmap,
    daily,
    weekly,
    monthly,
    senders,
    topEmojis: Array.from(emojiGlobal.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([emoji, count]) => ({ emoji, count })),
    topWords: Array.from(wordGlobal.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([word, count]) => ({ word, count })),
    topBigrams: Array.from(bigramGlobal.entries())
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([phrase, count]) => ({ phrase, count })),
    topDomains: Array.from(domainGlobal.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([domain, count]) => ({ domain, count })),
    filteredMessages: filtered,
  };
}

/** Formats analysis summary as compact JSON (without dumping full raw message bodies twice). */
export function formatWhatsappJson(parsed: ParsedChat, analysis: ChatAnalysis): string {
  return JSON.stringify(
    {
      format: {
        exportStyle: parsed.exportStyle,
        dateOrder: parsed.dateOrder,
        minDate: parsed.minDate,
        maxDate: parsed.maxDate,
      },
      summary: {
        totalMessages: analysis.totalMessages,
        userMessages: analysis.userMessages,
        systemMessages: analysis.systemMessages,
        participants: analysis.participantCount,
        activeDays: analysis.activeDays,
        calendarSpanDays: analysis.calendarSpanDays,
        totalWords: analysis.totalWords,
        totalMedia: analysis.totalMedia,
        totalLinks: analysis.totalLinks,
        totalQuestions: analysis.totalQuestions,
        totalEmojis: analysis.totalEmojis,
        longestStreakDays: analysis.longestStreakDays,
        longestSilenceHours: analysis.longestSilenceHours,
        peakDay: analysis.peakDay,
        peakHour: analysis.peakHour,
        peakWeekday: analysis.peakWeekday,
      },
      senders: analysis.senders,
      topEmojis: analysis.topEmojis,
      topWords: analysis.topWords,
      topBigrams: analysis.topBigrams,
      topDomains: analysis.topDomains,
      daily: analysis.daily,
    },
    null,
    2,
  );
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a UTF-8 BOM-prefixed CSV so Excel renders Hindi, Arabic, CJK, accents, and emojis cleanly. */
export function formatWhatsappCsv(analysis: ChatAnalysis): string {
  const rows: string[] = [];
  rows.push("Section,Name,Messages,Share%,Words,AvgWords,Media,Links,Questions,Emojis,Starters,MedianReplyMin");
  for (const s of analysis.senders) {
    rows.push(
      [
        "Participant",
        s.sender,
        s.messages,
        (s.share * 100).toFixed(1),
        s.words,
        s.avgWords,
        s.media,
        s.links,
        s.questions,
        s.emojis,
        s.starters,
        s.medianReplyMin,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  rows.push("");
  rows.push("Section,Date,Messages,Words,Media");
  for (const d of analysis.daily) {
    rows.push(["Daily", d.key, d.count, d.words, d.media].map(csvCell).join(","));
  }
  return `\uFEFF${rows.join("\r\n")}`;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

/** Builds a self-contained printable HTML report matching the site's warm paper editorial aesthetic. */
export function formatWhatsappHtmlReport(title: string, analysis: ChatAnalysis): string {
  const senderRows = analysis.senders
    .map(
      (s) =>
        `<tr><td>${escHtml(s.sender)}</td><td>${s.messages.toLocaleString()}</td><td>${(s.share * 100).toFixed(1)}%</td><td>${s.words.toLocaleString()}</td><td>${s.media}</td><td>${s.links}</td><td>${s.emojis}</td><td>${s.medianReplyMin ?? "—"}</td></tr>`,
    )
    .join("");
  const topWordsHtml = analysis.topWords
    .slice(0, 20)
    .map((w) => `<span class="pill">${escHtml(w.word)} <b>${w.count}</b></span>`)
    .join("");
  const topEmojiHtml = analysis.topEmojis
    .slice(0, 15)
    .map((e) => `<span class="pill">${escHtml(e.emoji)} <b>${e.count}</b></span>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escHtml(title)} — WhatsApp Chat Report</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #F3F0E8; color: #15140F; margin: 0; padding: 32px 20px; line-height: 1.5; }
  .wrap { max-width: 920px; margin: 0 auto; background: #FBFAF6; border: 1px solid #DAD5C8; border-radius: 14px; padding: 28px; }
  h1 { margin: 0 0 6px; font-size: 24px; }
  .sub { color: #57544A; font-size: 14px; margin: 0 0 22px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .kpi { border: 1px solid #DAD5C8; border-radius: 10px; padding: 12px; background: #F3F0E8; }
  .kpi .k { font-size: 12px; color: #57544A; text-transform: uppercase; letter-spacing: .04em; }
  .kpi .v { font-size: 20px; font-weight: 600; margin-top: 4px; }
  h2 { font-size: 16px; margin: 24px 0 10px; border-bottom: 1px solid #DAD5C8; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #DAD5C8; }
  th { font-size: 12px; color: #57544A; text-transform: uppercase; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { background: #EAE6DB; border: 1px solid #DAD5C8; border-radius: 999px; padding: 4px 10px; font-size: 13px; }
  .foot { margin-top: 28px; font-size: 12px; color: #57544A; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${escHtml(title)}</h1>
  <p class="sub">${analysis.userMessages.toLocaleString()} messages · ${analysis.participantCount} participants · ${analysis.activeDays} active days (${analysis.daily[0]?.key ?? "—"} to ${analysis.daily[analysis.daily.length - 1]?.key ?? "—"})</p>
  <div class="grid">
    <div class="kpi"><div class="k">Messages</div><div class="v">${analysis.userMessages.toLocaleString()}</div></div>
    <div class="kpi"><div class="k">Words</div><div class="v">${analysis.totalWords.toLocaleString()}</div></div>
    <div class="kpi"><div class="k">Media & Files</div><div class="v">${analysis.totalMedia.toLocaleString()}</div></div>
    <div class="kpi"><div class="k">Emojis</div><div class="v">${analysis.totalEmojis.toLocaleString()}</div></div>
    <div class="kpi"><div class="k">Best Streak</div><div class="v">${analysis.longestStreakDays} days</div></div>
    <div class="kpi"><div class="k">Peak Day</div><div class="v">${analysis.peakDay ? `${analysis.peakDay.date} (${analysis.peakDay.count})` : "—"}</div></div>
  </div>
  <h2>Participants</h2>
  <table><thead><tr><th>Name</th><th>Messages</th><th>Share</th><th>Words</th><th>Media</th><th>Links</th><th>Emojis</th><th>Median reply (m)</th></tr></thead><tbody>${senderRows}</tbody></table>
  <h2>Top emojis</h2>
  <div class="pills">${topEmojiHtml || "None"}</div>
  <h2>Top words</h2>
  <div class="pills">${topWordsHtml || "None"}</div>
  <p class="foot">Generated locally in your browser by Do-Whatever-You-Like — your chat never left your device.</p>
</div>
</body>
</html>`;
}

/** Builds a concise Markdown/text summary for clipboard sharing. */
export function formatWhatsappTextSummary(analysis: ChatAnalysis): string {
  const top3 = analysis.senders
    .slice(0, 3)
    .map((s) => `- ${s.sender}: ${s.messages.toLocaleString()} msgs (${(s.share * 100).toFixed(1)}%), ${s.words.toLocaleString()} words`)
    .join("\n");
  const emojis = analysis.topEmojis
    .slice(0, 5)
    .map((e) => `${e.emoji}×${e.count}`)
    .join(" ");
  return [
    `WhatsApp Chat Summary (${analysis.daily[0]?.key ?? "—"} to ${analysis.daily[analysis.daily.length - 1]?.key ?? "—"})`,
    `Messages: ${analysis.userMessages.toLocaleString()} · Participants: ${analysis.participantCount} · Active days: ${analysis.activeDays}`,
    `Words: ${analysis.totalWords.toLocaleString()} · Media: ${analysis.totalMedia} · Links: ${analysis.totalLinks} · Emojis: ${analysis.totalEmojis}`,
    analysis.peakDay ? `Peak day: ${analysis.peakDay.date} (${analysis.peakDay.count} msgs)` : "",
    analysis.longestStreakDays ? `Longest daily streak: ${analysis.longestStreakDays} days` : "",
    top3 ? `\nTop senders:\n${top3}` : "",
    emojis ? `\nTop emojis: ${emojis}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const SAMPLE_CHATS: { id: string; label: string; description: string; text: string }[] = [
  {
    id: "launch",
    label: "Product team (English · Android)",
    description: "Android dash format with links, questions, multi-line messages, deleted & edited lines.",
    text: `02/11/2026, 09:12 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.
02/11/2026, 09:14 - Maya: Morning everyone! Are we shipping the v2 landing page today? 🚀
02/11/2026, 09:16 - Rohan: Yep, just finishing the responsive header tweaks.
Here is the preview URL: https://vercel.com/preview/v2-demo
02/11/2026, 09:18 - Sara: Looks super crisp on phone too 🔥🔥
02/11/2026, 09:19 - Sara: Did anyone check mobile overflow on 390px?
02/11/2026, 09:23 - Maya: <Media omitted>
02/11/2026, 09:24 - Maya: Screenshot above — zero overflow now ✅
02/11/2026, 20:40 - Rohan: Quick update: GA4 + analytics are live too 📊 <This message was edited>
03/11/2026, 10:05 - Sara: Awesome! Let's run full tests before announcing.
03/11/2026, 10:07 - Maya: Agreed 💯 Checking SEO metadata right now: https://github.com/acme/project
03/11/2026, 10:10 - Rohan: This message was deleted
03/11/2026, 10:12 - Rohan: Good catch earlier, fixed the typo too 😅
05/11/2026, 14:30 - Maya: Weekend numbers look great — active users doubled 🎉🎉
05/11/2026, 14:35 - Sara: Amazing work team 🙌 Sending confetti!
05/11/2026, 14:36 - Sara: Coffee treat on me Friday? ☕`,
  },
  {
    id: "multilingual",
    label: "Multilingual friends (Hindi + Arabic + Spanish · iOS)",
    description: "iOS bracketed format mixing Hindi Devanagari, Arabic RTL, Spanish accents, and emojis.",
    text: `\u200E[10/11/2026, 9:05:12 AM] \u200EAarav: नमस्ते दोस्तों! आज शाम को डिनर का क्या प्लान है? 🍛😊
\u200E[10/11/2026, 9:08:40 AM] \u200ELayla: صباح الخير! أنا متحمسة جداً للقاء اليوم 🌙✨
\u200E[10/11/2026, 9:12:03 AM] \u200EMateo: ¡Hola a todos! ¿Nos vemos a las 8:30 PM cerca del centro? 🌮🎉
\u200E[10/11/2026, 9:15:22 AM] \u200EAarav: हाँ बिल्कुल! मैं लोकेशन भेजता हूँ। https://maps.example.com/cafe-central
\u200E[10/11/2026, 9:16:00 AM] \u200EAarav: \u200Eimage omitted
\u200E[10/11/2026, 8:20:10 PM] \u200EMateo: Ya llegué aquí, la música está buenísima 🎶🙌
\u200E[10/11/2026, 8:24:45 PM] \u200ELayla: في الطريق، ٥ دقائق وأصل إن شاء الله 🚕✨
\u200E[11/11/2026, 10:30:00 AM] \u200EAarav: कल की शाम कमाल की थी, धन्यवाद सब को 🙏❤️
\u200E[11/11/2026, 10:34:19 AM] \u200EMateo: ¡Repetimos el próximo sábado! 🥳`,
  },
];
