import { Anton, Caveat, Noto_Sans, Noto_Sans_Bengali, Noto_Sans_Devanagari, Noto_Sans_Mono, Noto_Serif } from "next/font/google";

/*
 * The fonts the watermark and meme tools draw with. They are the same families the backend bundles
 * (backend/app/assets/fonts), so the canvas preview matches the file the server makes. Not preloaded:
 * they download only on the pages that draw with them.
 */
const sans = Noto_Sans({ subsets: ["latin", "latin-ext", "cyrillic", "greek"], weight: ["400", "700"], display: "swap", preload: false });
const serif = Noto_Serif({ subsets: ["latin", "latin-ext", "cyrillic", "greek"], weight: ["400", "700"], display: "swap", preload: false });
const mono = Noto_Sans_Mono({ subsets: ["latin", "latin-ext", "cyrillic", "greek"], weight: ["400", "700"], display: "swap", preload: false });
const impact = Anton({ subsets: ["latin", "latin-ext"], weight: "400", display: "swap", preload: false });
const hand = Caveat({ subsets: ["latin", "latin-ext", "cyrillic"], weight: ["400", "700"], display: "swap", preload: false });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari", "latin"], weight: ["400", "700"], display: "swap", preload: false });
const bengali = Noto_Sans_Bengali({ subsets: ["bengali", "latin"], weight: ["400", "700"], display: "swap", preload: false });

export type FontKey = "sans" | "serif" | "mono" | "impact" | "hand";

export const FONT_OPTIONS: { value: FontKey; label: string }[] = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
  { value: "impact", label: "Impact" },
  { value: "hand", label: "Handwritten" },
];

const FAMILY: Record<FontKey, string> = {
  sans: sans.style.fontFamily,
  serif: serif.style.fontFamily,
  mono: mono.style.fontFamily,
  impact: impact.style.fontFamily,
  hand: hand.style.fontFamily,
};

/** Class names that pull the fonts' @font-face rules into the page. */
export const FONT_CLASSES = [sans, serif, mono, impact, hand, devanagari, bengali].map((f) => f.className).join(" ");

/** The CSS family for some text: Hindi/Marathi and Bangla text switch to a font that has those letters, like the server. */
export function familyFor(font: FontKey, text: string) {
  if (/[ऀ-ॿ]/.test(text)) return devanagari.style.fontFamily;
  if (/[ঀ-৿]/.test(text)) return bengali.style.fontFamily;
  return FAMILY[font];
}

/** Waits for a font to be ready before drawing with it on a canvas. */
export async function loadFont(family: string, weight: number, size = 48) {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.load(`${weight} ${size}px ${family}`);
  } catch {}
}
