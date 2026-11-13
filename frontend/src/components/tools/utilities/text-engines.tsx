"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Download, Pause, Play } from "lucide-react";
import { saveBlob } from "@/lib/files";
import {
  checkCard,
  codesToText,
  fromMorse,
  fromRoman,
  htmlDecode,
  htmlEncode,
  ieee754,
  isMorse,
  jsonEscape,
  jsonUnescape,
  lorem,
  mirror,
  numberToWords,
  reverseText,
  summarize,
  textToCodes,
  toMorse,
  toRoman,
  upsideDown,
  wordsToNumber,
  type CodeBase,
  type ReverseMode,
} from "@/lib/utilities/text";
import { shuffle } from "@/lib/utilities/random";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor, Output, ValueList, ValueRow } from "../dev/parts";

export type EngineProps = { preset: Record<string, string> };

/** Swaps the direction of a two-way tool. */
function SwapButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
    >
      <ArrowUpDown aria-hidden className="size-3.5" />
      {label}
    </button>
  );
}

function attempt<T>(fn: () => T): { value: T | null; error: string | null } {
  try {
    return { value: fn(), error: null };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
}

/* ---------- text ⇄ codes ---------- */

const BASES: { value: CodeBase; label: string }[] = [
  { value: "binary", label: "Binary" },
  { value: "hex", label: "Hex" },
  { value: "decimal", label: "Decimal (ASCII)" },
  { value: "octal", label: "Octal" },
];
const SAMPLE_CODES: Record<CodeBase, string> = { binary: "01001000 01101001 00100001", hex: "48 69 21", decimal: "72 105 33", octal: "110 151 041" };

export function CodesEngine({ preset }: EngineProps) {
  const [fromText, setFromText] = useState(preset.from !== "codes");
  const [base, setBase] = useState<CodeBase>((preset.base as CodeBase) ?? "binary");
  const [input, setInput] = useState(preset.from === "codes" ? SAMPLE_CODES[(preset.base as CodeBase) ?? "binary"] : "Hi!");
  const [sep, setSep] = useState<" " | "" | ",">(" ");
  const [upper, setUpper] = useState(true);
  const d = useDeferredValue(input);
  const r = attempt(() => (fromText ? textToCodes(d, base, sep === "," ? ", " : sep, upper) : codesToText(d, base)));
  const flip = () => {
    if (r.value !== null) setInput(r.value);
    setFromText((v) => !v);
  };
  return (
    <>
      <Panel>
        <Row label="Code">
          <Chips value={base} options={BASES} onChange={setBase} label="Code" />
        </Row>
        {fromText && (
          <Row label="Between codes">
            <div className="flex flex-wrap items-center gap-4">
              <Chips value={sep} options={[{ value: " ", label: "Space" }, { value: ",", label: "Comma" }, { value: "", label: "Nothing" }]} onChange={setSep} label="Separator" />
              {base === "hex" && <Toggle checked={upper} onChange={setUpper} label="Upper case" />}
            </div>
          </Row>
        )}
      </Panel>
      <Editor value={input} onChange={setInput} name={fromText ? "text" : `${base}`} rows={6} spellCheck={fromText} actions={<SwapButton onClick={flip} label={fromText ? `${base} → text` : `text → ${base}`} />} />
      <Output value={r.value ?? ""} error={r.error} name={fromText ? base : "text"} lang={fromText ? `${base} · one code per UTF-8 byte` : "UTF-8 text"} />
    </>
  );
}

/* ---------- upside down, mirror, reverse ---------- */

export function FancyEngine({ preset }: EngineProps) {
  const [kind, setKind] = useState(preset.kind ?? "upside");
  const [mode, setMode] = useState<ReverseMode>("characters");
  const [input, setInput] = useState("Hello, world! 123");
  const out = kind === "upside" ? upsideDown(input) : kind === "mirror" ? mirror(input) : reverseText(input, mode);
  return (
    <>
      <Panel>
        <Row label="Style">
          <Chips value={kind} options={[{ value: "upside", label: "Upside down" }, { value: "mirror", label: "Mirror" }, { value: "reverse", label: "Reverse" }]} onChange={setKind} label="Style" />
        </Row>
        {kind === "reverse" && (
          <Row label="Reverse">
            <Chips value={mode} options={[{ value: "characters", label: "Letters" }, { value: "words", label: "Word order" }, { value: "each-word", label: "Each word" }, { value: "lines", label: "Line order" }]} onChange={setMode} label="Reverse" />
          </Row>
        )}
      </Panel>
      <Editor value={input} onChange={setInput} name="text" rows={5} spellCheck />
      <div className="@container overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1.5">
          <span className="font-mono text-[12px] text-ink">result</span>
          <CopyButton text={out} />
        </div>
        <p className="min-h-24 whitespace-pre-wrap break-words px-4 py-4 text-2xl leading-snug text-ink [overflow-wrap:anywhere]">{out || <span className="text-base text-ink-3">The result appears here as you type.</span>}</p>
      </div>
    </>
  );
}

/* ---------- number ⇄ words ---------- */

export function NumWordsEngine({ preset }: EngineProps) {
  const [toWords, setToWords] = useState(preset.dir !== "to-number");
  const [system, setSystem] = useState<"international" | "indian">("international");
  const [input, setInput] = useState(preset.dir === "to-number" ? "two million three hundred and five thousand and forty-two" : "1234567.89");
  const [caps, setCaps] = useState<"lower" | "title" | "upper">("lower");
  const r = attempt(() => (toWords ? numberToWords(input, system) : wordsToNumber(input)));
  const shaped = r.value && toWords ? (caps === "upper" ? r.value.toUpperCase() : caps === "title" ? r.value.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and") : r.value) : r.value;
  const grouped = !toWords && r.value && /^-?\d+(\.\d+)?$/.test(r.value) ? Number(r.value.split(".")[0]).toLocaleString(system === "indian" ? "en-IN" : "en") + (r.value.includes(".") ? "." + r.value.split(".")[1] : "") : null;
  return (
    <>
      <Panel>
        <Row label="Direction">
          <Chips value={toWords ? "w" : "n"} options={[{ value: "w", label: "Number → words" }, { value: "n", label: "Words → number" }]} onChange={(v) => (setToWords(v === "w"), setInput(v === "w" ? "1234567.89" : "two million three hundred and five thousand and forty-two"))} label="Direction" />
        </Row>
        <Row label="Number system">
          <Chips value={system} options={[{ value: "international", label: "International (million)" }, { value: "indian", label: "Indian (lakh, crore)" }]} onChange={setSystem} label="Number system" />
        </Row>
        {toWords && (
          <Row label="Capitals">
            <Chips value={caps} options={[{ value: "lower", label: "lower" }, { value: "title", label: "Title Case" }, { value: "upper", label: "UPPER" }]} onChange={setCaps} label="Capitals" />
          </Row>
        )}
      </Panel>
      <Editor value={input} onChange={setInput} name={toWords ? "number" : "words"} rows={3} spellCheck={!toWords} />
      <Output value={shaped ?? ""} error={r.error} name={toWords ? "words" : "number"} lang={grouped ? `Grouped: ${grouped}` : toWords ? system === "indian" ? "Indian system" : "International system" : "Digits"} />
    </>
  );
}

/* ---------- Roman ---------- */

export function RomanEngine() {
  const [input, setInput] = useState("2026");
  const t = input.trim();
  const isNum = /^\d+$/.test(t);
  const r = attempt(() => (isNum ? toRoman(+t) : t ? String(fromRoman(t)) : ""));
  return (
    <>
      <Panel>
        <Row label="Number or numeral" hint="Type either; we work out which.">
          <TextField label="Number or Roman numeral" value={input} onChange={setInput} placeholder="1994 or MCMXCIV" mono invalid={Boolean(r.error)} />
        </Row>
      </Panel>
      {r.error ? (
        <Notice tone="warning">{r.error}</Notice>
      ) : (
        r.value && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-surface px-5 py-6">
            <div>
              <p className="label-mono text-ink-3">{isNum ? "Roman numeral" : "Number"}</p>
              <p className="mt-1 font-serif text-5xl tracking-[0.04em] text-ink">{r.value}</p>
            </div>
            <CopyButton text={r.value} />
          </div>
        )
      )}
      <ValueList>
        {[1, 4, 5, 9, 10, 40, 50, 90, 100, 400, 500, 900, 1000].map((n) => (
          <ValueRow key={n} label={String(n)} value={toRoman(n)} />
        ))}
      </ValueList>
    </>
  );
}

/* ---------- repeat ---------- */

export function RepeatEngine() {
  const [input, setInput] = useState("Hello ");
  const [count, setCount] = useState(10);
  const [sep, setSep] = useState("none");
  const [custom, setCustom] = useState(" | ");
  const [numbered, setNumbered] = useState(false);
  const joiner = sep === "line" ? "\n" : sep === "space" ? " " : sep === "comma" ? ", " : sep === "custom" ? custom : "";
  const out = useMemo(() => Array.from({ length: count }, (_, i) => (numbered ? `${i + 1}. ${input}` : input)).join(joiner), [input, count, joiner, numbered]);
  return (
    <>
      <Panel>
        <Row label="Times">
          <div className="flex items-center gap-3">
            <div className="w-28 shrink-0">
              <TextField label="Times" value={String(count)} onChange={(v) => setCount(Math.max(1, Math.min(10000, Math.floor(+v.replace(/\D/g, "") || 1))))} inputMode="numeric" mono />
            </div>
            <div className="flex-1">
              <Slider label="Times" value={Math.min(count, 500)} min={1} max={500} onChange={setCount} />
            </div>
          </div>
        </Row>
        <Row label="Separator">
          <div className="flex flex-wrap items-center gap-3">
            <Chips value={sep} options={[{ value: "none", label: "None" }, { value: "line", label: "New line" }, { value: "space", label: "Space" }, { value: "comma", label: "Comma" }, { value: "custom", label: "Custom" }]} onChange={setSep} label="Separator" />
            {sep === "custom" && (
              <div className="w-32">
                <TextField label="Custom separator" value={custom} onChange={setCustom} mono />
              </div>
            )}
          </div>
        </Row>
        <Row label="Options">
          <Toggle checked={numbered} onChange={setNumbered} label="Number each copy" />
        </Row>
      </Panel>
      <Editor value={input} onChange={setInput} name="text" rows={3} spellCheck />
      <Output value={out} name="repeated" lang={`${count.toLocaleString("en")} copies`} download="repeated.txt" />
    </>
  );
}

/* ---------- lines ---------- */

const LINE_ACTIONS = [
  { value: "shuffle", label: "Shuffle" },
  { value: "az", label: "Sort A–Z" },
  { value: "za", label: "Sort Z–A" },
  { value: "natural", label: "Natural (2 before 10)" },
  { value: "length", label: "By length" },
  { value: "reverse", label: "Reverse" },
  { value: "unique", label: "Remove duplicates" },
  { value: "number", label: "Number lines" },
] as const;
type LineAction = (typeof LINE_ACTIONS)[number]["value"];

export function LinesEngine() {
  const [input, setInput] = useState("banana\napple\ncherry\napple\nitem 10\nitem 2\n\ndate");
  const [action, setAction] = useState<LineAction>("shuffle");
  const [trim, setTrim] = useState(true);
  const [dropEmpty, setDropEmpty] = useState(true);
  const [caseless, setCaseless] = useState(true);
  const [seed, setSeed] = useState(0);
  const out = useMemo(() => {
    void seed;
    let lines = input.split(/\r?\n/);
    if (trim) lines = lines.map((l) => l.trim());
    if (dropEmpty) lines = lines.filter((l) => l.length);
    const coll = new Intl.Collator(undefined, { sensitivity: caseless ? "base" : "variant", numeric: action === "natural" });
    switch (action) {
      case "shuffle": return shuffle(lines).join("\n");
      case "az": case "natural": return [...lines].sort(coll.compare).join("\n");
      case "za": return [...lines].sort((a, b) => coll.compare(b, a)).join("\n");
      case "length": return [...lines].sort((a, b) => a.length - b.length || coll.compare(a, b)).join("\n");
      case "reverse": return [...lines].reverse().join("\n");
      case "unique": {
        const seen = new Set<string>();
        return lines.filter((l) => {
          const k = caseless ? l.toLowerCase() : l;
          return seen.has(k) ? false : (seen.add(k), true);
        }).join("\n");
      }
      case "number": return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
    }
  }, [input, action, trim, dropEmpty, caseless, seed]);
  const before = input.split(/\r?\n/).length;
  const after = out ? out.split("\n").length : 0;
  return (
    <>
      <Panel>
        <Row label="Action">
          <Chips value={action} options={[...LINE_ACTIONS]} onChange={setAction} label="Action" />
        </Row>
        <Row label="Clean up">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={trim} onChange={setTrim} label="Trim spaces" />
            <Toggle checked={dropEmpty} onChange={setDropEmpty} label="Drop empty lines" />
            <Toggle checked={caseless} onChange={setCaseless} label="Ignore case" />
          </div>
        </Row>
      </Panel>
      <Editor value={input} onChange={setInput} name="lines.txt" rows={8} />
      <Output value={out} name="result.txt" lang={`${before} lines in · ${after} out`} download="lines.txt" />
      {action === "shuffle" && (
        <button type="button" onClick={() => setSeed((s) => s + 1)} className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3">
          Shuffle again
        </button>
      )}
    </>
  );
}

/* ---------- Morse ---------- */

function morseWav(code: string, wpm: number, freq: number): Blob {
  const rate = 22050;
  const unit = 1.2 / wpm;
  const parts: [boolean, number][] = [];
  for (const ch of code) {
    if (ch === ".") parts.push([true, 1], [false, 1]);
    else if (ch === "-") parts.push([true, 3], [false, 1]);
    else if (ch === " ") parts.push([false, 2]);
    else if (ch === "/") parts.push([false, 2]);
  }
  const total = Math.ceil(parts.reduce((n, [, u]) => n + u * unit, 0.2) * rate);
  const pcm = new Int16Array(total);
  let i = Math.floor(0.1 * rate);
  for (const [on, u] of parts) {
    const n = Math.floor(u * unit * rate);
    if (on) {
      const ramp = Math.min(n / 4, rate * 0.005);
      for (let k = 0; k < n && i + k < total; k++) {
        const env = Math.min(1, k / ramp, (n - k) / ramp);
        pcm[i + k] = Math.sin((2 * Math.PI * freq * k) / rate) * env * 0.6 * 32767;
      }
    }
    i += n;
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.byteLength, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

export function MorseEngine() {
  const [input, setInput] = useState("SOS Hello world");
  const [wpm, setWpm] = useState(18);
  const [freq, setFreq] = useState(650);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const morseIn = isMorse(input);
  const out = morseIn ? fromMorse(input) : toMorse(input);
  const code = morseIn ? input : out;
  useEffect(() => () => audio.current?.pause(), []);
  const play = () => {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    const url = URL.createObjectURL(morseWav(code, wpm, freq));
    const a = new Audio(url);
    audio.current = a;
    a.onended = () => (setPlaying(false), URL.revokeObjectURL(url));
    void a.play();
    setPlaying(true);
  };
  return (
    <>
      <Editor value={input} onChange={setInput} name={morseIn ? "morse" : "text"} rows={4} spellCheck={!morseIn} />
      <Output value={out} name={morseIn ? "text" : "morse"} lang={morseIn ? "Decoded from Morse" : "Letters split by spaces, words by /"}>
        {!morseIn && out ? <p className="max-h-[420px] overflow-auto px-3 py-3 font-mono text-xl leading-relaxed tracking-[0.12em] text-ink [overflow-wrap:anywhere]">{out.replace(/\./g, "·").replace(/-/g, "–")}</p> : undefined}
      </Output>
      <Panel>
        <Row label="Speed">
          <Slider label="Words per minute" value={wpm} min={5} max={40} onChange={setWpm} format={(v) => `${v} wpm`} />
        </Row>
        <Row label="Pitch">
          <Slider label="Pitch" value={freq} min={300} max={1000} step={10} onChange={setFreq} format={(v) => `${v} Hz`} />
        </Row>
        <Row label="Sound">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!code.trim()} onClick={play} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40">
              {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
              {playing ? "Stop" : "Play Morse"}
            </button>
            <button type="button" disabled={!code.trim()} onClick={() => saveBlob(morseWav(code, wpm, freq), "morse.wav")} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40">
              <Download aria-hidden className="size-4" />
              Download WAV
            </button>
          </div>
        </Row>
      </Panel>
    </>
  );
}

/* ---------- lorem ipsum ---------- */

export function LoremEngine() {
  const [kind, setKind] = useState<"paragraphs" | "sentences" | "words">("paragraphs");
  const [count, setCount] = useState(3);
  const [classic, setClassic] = useState(true);
  const [html, setHtml] = useState(false);
  const [seed, setSeed] = useState(0);
  const text = useMemo(() => (void seed, lorem(kind, count, classic)), [kind, count, classic, seed]);
  const out = html && kind === "paragraphs" ? text.split("\n\n").map((p) => `<p>${p}</p>`).join("\n") : text;
  return (
    <>
      <Panel>
        <Row label="Make">
          <Chips value={kind} options={[{ value: "paragraphs", label: "Paragraphs" }, { value: "sentences", label: "Sentences" }, { value: "words", label: "Words" }]} onChange={(k) => (setKind(k), setCount(k === "words" ? 50 : 3))} label="Kind" />
        </Row>
        <Row label="How many">
          <Slider label="How many" value={count} min={1} max={kind === "words" ? 1000 : kind === "sentences" ? 100 : 30} onChange={setCount} />
        </Row>
        <Row label="Options">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={classic} onChange={setClassic} label="Start with “Lorem ipsum dolor sit amet”" />
            {kind === "paragraphs" && <Toggle checked={html} onChange={setHtml} label="Wrap in <p> tags" />}
          </div>
        </Row>
      </Panel>
      <Output value={out} name={html ? "lorem.html" : "lorem.txt"} lang={`${out.split(/\s+/).filter(Boolean).length} words`} download={html ? "lorem.html" : "lorem.txt"} />
      <button type="button" onClick={() => setSeed((s) => s + 1)} className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3">
        Make new text
      </button>
    </>
  );
}

/* ---------- summarizer ---------- */

const SAMPLE_ARTICLE =
  "Solar power has become the cheapest source of new electricity in much of the world. Panel prices have fallen by about ninety percent in a decade. That drop came from manufacturing at enormous scale, mostly in China. Cheaper panels changed the economics for homes and for utilities. Many households now install panels without any subsidy at all. Storage is the next challenge, because the sun does not shine at night. Battery prices are falling too, following a similar curve to panels. Grid operators are learning to balance supply that rises and falls through the day. Some countries already run on mostly renewable power for hours at a time. The weather this week was mild in most of Europe. Experts expect solar to be the largest source of electricity worldwide within twenty years.";

export function SummarizeEngine() {
  const [input, setInput] = useState(SAMPLE_ARTICLE);
  const [ratio, setRatio] = useState(30);
  const [bullets, setBullets] = useState(false);
  const d = useDeferredValue(input);
  const r = useMemo(() => summarize(d, ratio / 100), [d, ratio]);
  const sentences = r.summary.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((s) => s.trim()) ?? [];
  const out = bullets ? sentences.map((s) => `• ${s}`).join("\n") : r.summary;
  return (
    <>
      <Panel>
        <Row label="Length">
          <Slider label="Summary length" value={ratio} min={10} max={70} step={5} onChange={setRatio} format={(v) => `${v}% of sentences`} />
        </Row>
        <Row label="Shape">
          <Toggle checked={bullets} onChange={setBullets} label="As bullet points" />
        </Row>
      </Panel>
      <Editor value={input} onChange={setInput} name="article.txt" rows={9} spellCheck />
      <Output value={out} name="summary.txt" lang={`${r.kept} of ${r.total} sentences · ${out.split(/\s+/).filter(Boolean).length} words`} download="summary.txt" />
      <Notice>This picks the sentences that best represent the whole text (by how often their key words appear), in their original order. It doesn&apos;t rewrite anything, so the summary is always faithful to the source.</Notice>
    </>
  );
}

/* ---------- escapes ---------- */

export function EscapeEngine({ preset }: EngineProps) {
  const kind = preset.kind === "html" ? "html" : "json";
  const [encode, setEncode] = useState(true);
  const [all, setAll] = useState(false);
  const [input, setInput] = useState(kind === "json" ? 'He said "hi"\nand left.\tTab → é' : '<a href="/x?a=1&b=2">Café & “quotes”</a>');
  const r = attempt(() => (kind === "json" ? (encode ? jsonEscape(input) : jsonUnescape(input)) : encode ? htmlEncode(input, all) : htmlDecode(input)));
  const flip = () => {
    if (r.value !== null) setInput(r.value);
    setEncode((v) => !v);
  };
  return (
    <>
      <Panel>
        <Row label="Direction">
          <Chips value={encode ? "e" : "d"} options={[{ value: "e", label: kind === "json" ? "Escape" : "Encode" }, { value: "d", label: kind === "json" ? "Unescape" : "Decode" }]} onChange={(v) => setEncode(v === "e")} label="Direction" />
        </Row>
        {kind === "html" && encode && (
          <Row label="Options">
            <Toggle checked={all} onChange={setAll} label="Also encode every non-ASCII character (é → &#233;)" />
          </Row>
        )}
      </Panel>
      <Editor value={input} onChange={setInput} name="input" rows={6} actions={<SwapButton onClick={flip} label="Use result as input" />} />
      <Output value={r.value ?? ""} error={r.error} name="output" lang={kind === "json" ? "JSON string contents (without the outer quotes)" : "HTML"} />
    </>
  );
}

/* ---------- IEEE-754 ---------- */

export function IeeeEngine() {
  const [input, setInput] = useState("0.1");
  const [precision, setPrecision] = useState<32 | 64>(32);
  const r = attempt(() => ieee754(input, precision));
  const f = r.value;
  const eBits = precision === 32 ? 8 : 11;
  return (
    <>
      <Panel>
        <Row label="Number">
          <TextField label="Number" value={input} onChange={setInput} placeholder="0.1, -2.5e10, Infinity, NaN" mono invalid={Boolean(r.error)} />
        </Row>
        <Row label="Precision">
          <Chips value={precision} options={[{ value: 32, label: "32-bit (float)" }, { value: 64, label: "64-bit (double)" }]} onChange={setPrecision} label="Precision" />
        </Row>
      </Panel>
      {r.error && <Notice tone="warning">{r.error}</Notice>}
      {f && (
        <>
          <div className="overflow-x-auto rounded-md border border-line bg-surface px-3 py-4" data-lenis-prevent>
            <div className="flex min-w-max gap-[2px] font-mono text-[12px]">
              {[...f.bits].map((b, i) => (
                <span
                  key={i}
                  title={i === 0 ? "Sign" : i <= eBits ? "Exponent" : "Mantissa"}
                  className={cn("flex h-8 w-[18px] items-center justify-center rounded-[3px] border", i === 0 ? "border-danger/40 bg-danger/10 text-danger" : i <= eBits ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-paper text-ink-2", b === "1" && "font-semibold")}
                >
                  {b}
                </span>
              ))}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-3">
              <span><span className="mr-1 inline-block size-2.5 rounded-[2px] bg-danger/60" />Sign (1 bit)</span>
              <span><span className="mr-1 inline-block size-2.5 rounded-[2px] bg-accent/60" />Exponent ({eBits} bits)</span>
              <span><span className="mr-1 inline-block size-2.5 rounded-[2px] border border-line bg-paper" />Mantissa ({precision - 1 - eBits} bits)</span>
            </p>
          </div>
          <ValueList>
            <ValueRow label="Hex" value={f.hex} />
            <ValueRow label="Binary" value={f.bits} />
            <ValueRow label="Stored" value={f.stored} note="The exact value the computer keeps." />
            <ValueRow label="Error" value={f.error} note="Stored value minus what you typed." />
            <ValueRow label="Sign" value={f.sign ? "1 (negative)" : "0 (positive)"} />
            <ValueRow label="Exponent" value={`${f.exponent} = ${f.biased} (unbiased ${f.unbiased})`} />
            <ValueRow label="Kind" value={f.kind} />
          </ValueList>
        </>
      )}
    </>
  );
}

/* ---------- card validator ---------- */

const TEST_CARDS = [
  ["Visa", "4111 1111 1111 1111"],
  ["Mastercard", "5555 5555 5555 4444"],
  ["Amex", "3782 822463 10005"],
  ["Discover", "6011 1111 1111 1117"],
];

export function CardEngine() {
  const [input, setInput] = useState("4111 1111 1111 1111");
  const r = checkCard(input);
  const empty = !input.trim();
  return (
    <>
      <Panel>
        <Row label="Card number" hint="Checked here; never sent anywhere.">
          <TextField label="Card number" value={input} onChange={setInput} placeholder="4111 1111 1111 1111" mono inputMode="numeric" autoComplete="off" invalid={!empty && !r.valid} />
        </Row>
        <Row label="Test numbers">
          <div className="flex flex-wrap gap-1.5">
            {TEST_CARDS.map(([b, n]) => (
              <button key={b} type="button" onClick={() => setInput(n)} className="inline-flex h-8 items-center rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
                {b}
              </button>
            ))}
          </div>
        </Row>
      </Panel>
      {!empty && (
        <div className={cn("rounded-md border px-5 py-5", r.valid ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5")}>
          <p className={cn("text-lg font-semibold", r.valid ? "text-success" : "text-danger")}>{r.valid ? "✓ Valid number" : "✗ Not a valid number"}</p>
          <p className="mt-1 text-sm text-ink-2">{r.reason}</p>
          <p className="mt-3 font-mono text-sm text-ink">
            {r.brand ?? "Unknown brand"} · {r.digits.length} digits
          </p>
        </div>
      )}
      <Notice>The Luhn check only proves a number is well-formed (good for catching typos in forms). It can&apos;t tell whether a card exists or has money on it. Use the test numbers above when building checkouts.</Notice>
    </>
  );
}
