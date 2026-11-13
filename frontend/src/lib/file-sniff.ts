/**
 * A quick look at each file's first bytes before it's uploaded, so a renamed or wrong file is turned
 * away instantly instead of costing an upload. It mirrors the server's guard
 * (backend/app/core/file_guard.py), which remains the real protection; anything this doesn't know
 * is left for the server to judge.
 */

type Rule = (b: Uint8Array) => boolean;

const at = (b: Uint8Array, offset: number, ...bytes: number[]) => bytes.every((x, i) => b[offset + i] === x);
const ascii = (b: Uint8Array, offset: number, s: string) => [...s].every((c, i) => b[offset + i] === c.charCodeAt(0));

const isExecutable = (b: Uint8Array) =>
  ascii(b, 0, "MZ") || at(b, 0, 0x7f, 0x45, 0x4c, 0x46) || at(b, 0, 0xfe, 0xed, 0xfa, 0xce) || at(b, 0, 0xfe, 0xed, 0xfa, 0xcf) || at(b, 0, 0xcf, 0xfa, 0xed, 0xfe) || at(b, 0, 0xce, 0xfa, 0xed, 0xfe) || at(b, 0, 0xca, 0xfe, 0xba, 0xbe);

const pdf: Rule = (b) => {
  const head = new TextDecoder("latin1").decode(b.subarray(0, 1024));
  return head.includes("%PDF-");
};
const png: Rule = (b) => at(b, 0, 0x89, 0x50, 0x4e, 0x47);
const jpeg: Rule = (b) => at(b, 0, 0xff, 0xd8, 0xff);
const gif: Rule = (b) => ascii(b, 0, "GIF8");
const riff = (kind: string): Rule => (b) => ascii(b, 0, "RIFF") && ascii(b, 8, kind);
const ftyp: Rule = (b) => ascii(b, 4, "ftyp") || ["moov", "mdat", "wide", "free"].some((a) => ascii(b, 4, a));
const zip: Rule = (b) => ascii(b, 0, "PK");
const ole: Rule = (b) => at(b, 0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const ebml: Rule = (b) => at(b, 0, 0x1a, 0x45, 0xdf, 0xa3);
const ogg: Rule = (b) => ascii(b, 0, "OggS");
const mp3: Rule = (b) => ascii(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
const sfnt: Rule = (b) => at(b, 0, 0, 1, 0, 0) || ascii(b, 0, "OTTO") || ascii(b, 0, "true") || ascii(b, 0, "ttcf");
const tiff: Rule = (b) => ascii(b, 0, "II*") || at(b, 0, 0x4d, 0x4d, 0, 0x2a);
const rtf: Rule = (b) => new TextDecoder("latin1").decode(b.subarray(0, 16)).trimStart().startsWith("{\\rtf");
const text: Rule = (b) => {
  if (at(b, 0, 0xff, 0xfe) || at(b, 0, 0xfe, 0xff)) return true; // UTF-16 with a BOM
  return !b.includes(0);
};
const svg: Rule = (b) => text(b) && /<svg[\s>]/i.test(new TextDecoder().decode(b));
const any =
  (...rules: Rule[]): Rule =>
  (b) =>
    rules.some((r) => r(b));

const RULES: Record<string, Rule> = {
  pdf,
  png,
  jpg: jpeg, jpeg, jpe: jpeg, jfif: jpeg,
  gif,
  webp: riff("WEBP"),
  bmp: (b) => ascii(b, 0, "BM"),
  tif: tiff, tiff,
  heic: ftyp, heif: ftyp, avif: ftyp,
  psd: (b) => ascii(b, 0, "8BPS"),
  ico: any((b) => at(b, 0, 0, 0, 1, 0), png),
  svg,
  docx: zip, docm: zip, dotx: zip, xlsx: zip, xlsm: zip, pptx: zip, ppsx: zip, pptm: zip,
  odt: zip, ods: zip, odp: zip, odg: zip, epub: zip, zip,
  doc: any(ole, rtf, text), xls: ole, ppt: ole, pps: ole,
  rtf,
  mp4: ftyp, m4a: ftyp, m4v: ftyp, mov: ftyp, "3gp": ftyp,
  webm: ebml, mkv: ebml, mka: ebml, weba: ebml,
  ogg, oga: ogg, opus: ogg, ogv: ogg,
  mp3: any(mp3, (b) => b[0] === 0xff),
  wav: riff("WAVE"), avi: riff("AVI "),
  flac: (b) => ascii(b, 0, "fLaC") || ascii(b, 0, "ID3"),
  ttf: sfnt, otf: sfnt, ttc: sfnt, woff: (b) => ascii(b, 0, "wOFF"), woff2: (b) => ascii(b, 0, "wOF2"),
  gz: (b) => at(b, 0, 0x1f, 0x8b), tgz: (b) => at(b, 0, 0x1f, 0x8b), "7z": (b) => ascii(b, 0, "7z"),
  ...Object.fromEntries(
    "txt md markdown csv tsv html htm xml json yaml yml toml ini srt vtt tex rst py js ts tsx jsx css scss sql sh log".split(" ").map((e) => [e, text]),
  ),
};

const NAMES: Record<string, string> = { pdf: "PDF", jpg: "JPEG", jpeg: "JPEG", png: "PNG", docx: "Word", xlsx: "Excel", pptx: "PowerPoint", mp3: "MP3", mp4: "MP4" };

/** Throws a readable error for the first file in `form` whose bytes can't be what its name says. */
export async function checkUploads(form: FormData): Promise<void> {
  for (const [, value] of form.entries()) {
    if (!(value instanceof File) || value.size === 0) continue;
    const bytes = new Uint8Array(await value.slice(0, 4096).arrayBuffer());
    const name = value.name || "the file";
    if (isExecutable(bytes)) throw new UploadRejected(`“${name}” is a program, not a document, picture or media file. It can't be uploaded.`);
    const ext = name.toLowerCase().split(".").pop() ?? "";
    const rule = RULES[ext];
    if (rule && !rule(bytes)) {
      throw new UploadRejected(`“${name}” doesn't look like a real ${NAMES[ext] ?? ext.toUpperCase()} file. It may be damaged, or renamed from another type.`);
    }
  }
}

export class UploadRejected extends Error {}
