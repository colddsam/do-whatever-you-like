/**
 * Font checker and creator, page side: the server's report types (backend/app/services/fonts),
 * loading a font into the page (FontFace) and parsing it for outlines (opentype.js, loaded on demand).
 */

import type { Font } from "opentype.js";

export type Check = { id: string; level: "pass" | "warn" | "fail" | "info"; title: string; detail: string };
export type Feature = { tag: string; name: string; table: string; optional: boolean };
export type Axis = { tag: string; name: string; min: number; default: number; max: number };

export type FontReport = {
  file: { name: string; size: number; format: string; woff2_size: number | null; woff2_exact: boolean };
  faces: string[] | null;
  face: number;
  family: string;
  style: string;
  names: { id: number; label: string; value: string }[];
  outline: string;
  glyphs: number;
  characters: number;
  embedding: string;
  fs_type: number;
  licence: string | null;
  metrics: Record<string, number | string | boolean | null>;
  tables: { tag: string; size: number | null }[];
  features: Feature[];
  scripts: string[];
  axes: Axis[];
  instances: { name: string; coordinates: Record<string, number> }[];
  color: string[];
  coverage: { name: string; have: number; total: number }[];
  languages: { name: string; supported: boolean; missing: string }[];
  checks: Check[];
  summary: { pass: number; warn: number; fail: number; info: number };
};

export type DocFont = { name: string; type: string | null; embedded: boolean; subset: boolean; uses: number; where: string[]; file: number | null };
export type DocReport = { kind: string; fonts: DocFont[]; files: { name: string; ext: string; data: string }[] };

export const FONT_EXTS = ["ttf", "otf", "woff", "woff2", "ttc", "otc"];
export const DOC_EXTS = ["pdf", "docx", "docm", "dotx", "pptx", "ppsx", "pptm", "xlsx", "xlsm", "odt", "ods", "odp", "odg", "epub", "html", "htm", "xhtml", "css", "svg"];
export const isFontFile = (name: string) => FONT_EXTS.includes(name.split(".").pop()?.toLowerCase() ?? "");
export const isDocFile = (name: string) => DOC_EXTS.includes(name.split(".").pop()?.toLowerCase() ?? "");

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

let faceId = 0;
/** Adds the font to the page under a private family name and returns that name. */
export async function loadFace(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const family = `dw-font-${++faceId}`;
  const face = new FontFace(family, bytes instanceof Uint8Array ? (bytes.slice().buffer as ArrayBuffer) : bytes);
  await face.load();
  document.fonts.add(face);
  return family;
}

/** opentype.js only when a font is opened (it's ~170 KB). */
export async function parseFont(bytes: ArrayBuffer): Promise<Font> {
  const ot = await import("opentype.js");
  return ot.parse(bytes);
}

export const SAMPLES: { label: string; text: string }[] = [
  { label: "Pangram", text: "The quick brown fox jumps over the lazy dog." },
  { label: "Alphabet", text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789" },
  { label: "Paragraph", text: "Typography is the craft of endowing human language with a durable visual form. Good type is invisible: you read the words, not the letters, and the page simply feels right." },
  { label: "Numbers", text: "0123456789 ½ ¾ 1st 2nd · $1,234.56 €99 ₹500 · 12:45 PM · 3×4=12" },
  { label: "Punctuation", text: "“Quotes” ‘and’ «guillemets» — dashes – (brackets) [square] {curly} @#&*!?¡¿" },
  { label: "Headline", text: "Make Every Word Count" },
];

/** A sample sentence in each language the report may list. */
export const LANGUAGE_SAMPLES: Record<string, string> = {
  English: "The quick brown fox jumps over the lazy dog.",
  French: "Voix ambiguë d’un cœur qui, au zéphyr, préfère les jattes de kiwis.",
  German: "Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich.",
  Spanish: "El veloz murciélago hindú comía feliz cardillo y kiwi.",
  Portuguese: "À noite, vovô Kowalsky vê o ímã cair no pé do pinguim queixoso.",
  Italian: "Quel vituperabile xenofobo zelante assaggia il whisky ed esclama: alleluja!",
  Polish: "Pchnąć w tę łódź jeża lub ośm skrzyń fig.",
  "Czech & Slovak": "Příliš žluťoučký kůň úpěl ďábelské ódy.",
  Turkish: "Pijamalı hasta yağız şoföre çabucak güvendi.",
  Vietnamese: "Tiếng Việt có dấu: Trăm năm trong cõi người ta.",
  Russian: "Съешь же ещё этих мягких французских булок, да выпей чаю.",
  Ukrainian: "Чуєш їх, доцю, га? Кумедна ж ти, прощайся без ґольфів!",
  Greek: "Ξεσκεπάζω την ψυχοφθόρα βδελυγμία.",
  "Hindi (Devanagari)": "ऋषियों को सताने वाले दुष्ट राक्षसों के राजा रावण का सर्वनाश करने वाले विष्णुवतार भगवान श्रीराम।",
  Bengali: "আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।",
  Tamil: "யாமறிந்த மொழிகளிலே தமிழ்மொழி போல் இனிதாவது எங்கும் காணோம்.",
  Arabic: "نص حكيم له سر قاطع وذو شأن عظيم مكتوب على ثوب أخضر.",
  Hebrew: "דג סקרן שט בים מאוכזב ולפתע מצא חברה.",
  Thai: "เป็นมนุษย์สุดประเสริฐเลิศคุณค่า",
  "Japanese (kana)": "いろはにほへと ちりぬるを わかよたれそ",
  "Chinese (common)": "我能吞下玻璃而不伤身体。",
  "Korean (Hangul)": "키스의 고유조건은 입술끼리 만나야 하고 특별한 기술은 필요치 않다.",
};
