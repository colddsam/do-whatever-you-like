"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Delete, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyButton } from "../dev/parts";

type Angle = "deg" | "rad" | "grad";
type MathJs = typeof import("mathjs");
type Entry = { expr: string; result: string };

let mathjs: Promise<MathJs> | null = null;
const loadMath = () => (mathjs ??= import("mathjs"));

/** What people type (and the keys insert) → what mathjs reads. */
function toMath(src: string): string {
  return src
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .replace(/√\(/g, "sqrt(")
    .replace(/∛\(/g, "cbrt(")
    .replace(/(\d+(?:\.\d+)?|\))\s*%(?!\s*[\d(a-z])/gi, "($1/100)") // 50% → 0.5 (mod is "mod")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
}

function scopeFor(math: MathJs, angle: Angle, ans: number, mem: number) {
  const k = angle === "deg" ? Math.PI / 180 : angle === "grad" ? Math.PI / 200 : 1;
  const toRad = (x: number) => x * k;
  const fromRad = (x: number) => x / k;
  const n = (f: (x: number) => number) => (x: unknown) => f(Number(x));
  return {
    sin: n((x) => math.sin(toRad(x)) as number),
    cos: n((x) => math.cos(toRad(x)) as number),
    tan: n((x) => {
      const v = math.tan(toRad(x)) as number;
      return Math.abs(v) > 1e15 ? Infinity : v;
    }),
    sec: n((x) => 1 / Math.cos(toRad(x))),
    csc: n((x) => 1 / Math.sin(toRad(x))),
    cot: n((x) => 1 / Math.tan(toRad(x))),
    asin: n((x) => fromRad(Math.asin(x))),
    acos: n((x) => fromRad(Math.acos(x))),
    atan: n((x) => fromRad(Math.atan(x))),
    log: (x: number, base?: number) => (base === undefined ? math.log10(x) : math.log(x, base)),
    ln: (x: number) => math.log(x),
    nCr: (a: number, b: number) => math.combinations(a, b),
    nPr: (a: number, b: number) => math.permutations(a, b),
    rand: () => Math.random(),
    ans,
    Ans: ans,
    M: mem,
  };
}

function evaluate(math: MathJs, expr: string, angle: Angle, ans: number, mem: number): { value: string; num: number | null } {
  const v = math.evaluate(toMath(expr), scopeFor(math, angle, ans, mem));
  if (typeof v === "function" || v === undefined) throw new Error("Incomplete expression");
  if (typeof v === "number") {
    if (Number.isNaN(v)) throw new Error("Not a number (check the inputs)");
    if (!Number.isFinite(v)) return { value: v > 0 ? "∞" : "−∞", num: v };
    // 15 significant digits hides binary rounding (0.1 + 0.2 = 0.3) without losing real precision.
    return { value: math.format(v, { precision: 15, lowerExp: -9, upperExp: 15 }), num: v };
  }
  return { value: math.format(v, { precision: 15 }), num: typeof (v as { toNumber?: () => number }).toNumber === "function" ? null : null };
}

type Key = { label: string; insert?: string; act?: string; title?: string; tone?: "fn" | "num" | "op" | "eq" | "danger"; second?: { label: string; insert: string; title?: string } };

const FN_KEYS: Key[] = [
  { label: "sin", insert: "sin(", second: { label: "sin⁻¹", insert: "asin(" } },
  { label: "cos", insert: "cos(", second: { label: "cos⁻¹", insert: "acos(" } },
  { label: "tan", insert: "tan(", second: { label: "tan⁻¹", insert: "atan(" } },
  { label: "sinh", insert: "sinh(", second: { label: "sinh⁻¹", insert: "asinh(" } },
  { label: "cosh", insert: "cosh(", second: { label: "cosh⁻¹", insert: "acosh(" } },
  { label: "x²", insert: "²", second: { label: "x³", insert: "³" } },
  { label: "xʸ", insert: "^", second: { label: "ʸ√x", insert: "nthRoot(", title: "nthRoot(x, y)" } },
  { label: "√", insert: "√(", second: { label: "∛", insert: "∛(" } },
  { label: "1/x", insert: "1/(", second: { label: "|x|", insert: "abs(" } },
  { label: "tanh", insert: "tanh(", second: { label: "tanh⁻¹", insert: "atanh(" } },
  { label: "log", insert: "log(", title: "log₁₀", second: { label: "10ˣ", insert: "10^(" } },
  { label: "ln", insert: "ln(", second: { label: "eˣ", insert: "e^(" } },
  { label: "log₂", insert: "log2(", second: { label: "2ˣ", insert: "2^(" } },
  { label: "n!", insert: "!", second: { label: "Γ", insert: "gamma(" } },
  { label: "mod", insert: " mod ", second: { label: "gcd", insert: "gcd(" } },
  { label: "nCr", insert: "nCr(", second: { label: "lcm", insert: "lcm(" } },
  { label: "nPr", insert: "nPr(", second: { label: "round", insert: "round(" } },
  { label: "π", insert: "π", second: { label: "τ", insert: "tau" } },
  { label: "e", insert: "e", second: { label: "φ", insert: "phi" } },
  { label: "EXP", insert: "e", title: "×10ⁿ: 3EXP5 = 3×10⁵", second: { label: "Rand", insert: "rand()" } },
];
const NUM_KEYS: Key[] = [
  { label: "AC", act: "clear", tone: "danger" },
  { label: "(", insert: "(" },
  { label: ")", insert: ")" },
  { label: "÷", insert: "÷", tone: "op" },
  { label: "7", insert: "7", tone: "num" },
  { label: "8", insert: "8", tone: "num" },
  { label: "9", insert: "9", tone: "num" },
  { label: "×", insert: "×", tone: "op" },
  { label: "4", insert: "4", tone: "num" },
  { label: "5", insert: "5", tone: "num" },
  { label: "6", insert: "6", tone: "num" },
  { label: "−", insert: "−", tone: "op" },
  { label: "1", insert: "1", tone: "num" },
  { label: "2", insert: "2", tone: "num" },
  { label: "3", insert: "3", tone: "num" },
  { label: "+", insert: "+", tone: "op" },
  { label: "0", insert: "0", tone: "num" },
  { label: ".", insert: ".", tone: "num" },
  { label: "%", insert: "%", title: "Percent (50% = 0.5)" },
  { label: "=", act: "equals", tone: "eq" },
];

export function CalculatorEngine() {
  const [math, setMath] = useState<MathJs | null>(null);
  const [expr, setExpr] = useState("");
  const [angle, setAngle] = useState<Angle>("deg");
  const [second, setSecond] = useState(false);
  const [ans, setAns] = useState(0);
  const [mem, setMem] = useState(0);
  const [result, setResult] = useState<{ value: string; num: number | null; error?: string; done?: boolean } | null>(null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadMath().then(setMath);
    try {
      const h = localStorage.getItem("dw:calc-history");
      if (h) queueMicrotask(() => setHistory(JSON.parse(h)));
    } catch {
      /* private mode */
    }
  }, []);

  // The answer as you type; "=" makes it final.
  const live = useMemo(() => {
    if (!math || !expr.trim()) return null;
    try {
      return evaluate(math, expr, angle, ans, mem);
    } catch {
      return null;
    }
  }, [math, expr, angle, ans, mem]);

  const insert = useCallback((text: string) => {
    const el = input.current;
    setResult(null);
    setExpr((cur) => {
      const s = el?.selectionStart ?? cur.length;
      const e = el?.selectionEnd ?? cur.length;
      const next = cur.slice(0, s) + text + cur.slice(e);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(s + text.length, s + text.length);
      });
      return next;
    });
  }, []);

  const equals = () => {
    if (!math || !expr.trim()) return;
    try {
      const r = evaluate(math, expr, angle, ans, mem);
      setResult({ ...r, done: true });
      if (r.num !== null && Number.isFinite(r.num)) setAns(r.num);
      const next = [{ expr, result: r.value }, ...history.filter((h) => h.expr !== expr)].slice(0, 50);
      setHistory(next);
      try {
        localStorage.setItem("dw:calc-history", JSON.stringify(next));
      } catch {
        /* private mode */
      }
    } catch (e) {
      setResult({ value: "", num: null, error: friendly((e as Error).message) });
    }
  };
  const press = (k: Key) => {
    if (k.act === "clear") {
      setExpr("");
      setResult(null);
      return input.current?.focus();
    }
    if (k.act === "equals") return equals();
    const ins = second && k.second ? k.second.insert : k.insert!;
    // After a finished answer, an operator continues from it and a number starts afresh.
    if (result?.done && /^[+\-−×÷^²³!%]|^ mod $/.test(ins)) {
      setExpr("Ans" + ins);
      setResult(null);
      return;
    }
    if (result?.done && /^[\d.(πe√∛]|^[a-z]/i.test(ins)) {
      setExpr(ins);
      setResult(null);
      return;
    }
    insert(ins);
    if (second) setSecond(false);
  };
  const memory = (op: "mc" | "m+" | "m-" | "mr") => {
    const v = result?.num ?? live?.num ?? null;
    if (op === "mc") setMem(0);
    else if (op === "mr") insert(String(mem));
    else if (v !== null) setMem((m) => (op === "m+" ? m + v : m - v));
  };

  const shownValue = result?.error ? null : (result?.value ?? live?.value ?? null);
  const shownNum = result?.num ?? live?.num ?? null;
  const extras = useMemo(() => {
    if (!math || shownNum === null || !Number.isFinite(shownNum)) return [];
    const out: [string, string][] = [];
    if (!Number.isInteger(shownNum) && Math.abs(shownNum) < 1e9) {
      try {
        const f = math.fraction(shownNum) as unknown as { n: bigint | number; d: bigint | number; s: bigint | number };
        if (Number(f.d) <= 10000 && Math.abs(Number(f.n) / Number(f.d) * Number(f.s) - shownNum) < 1e-12) out.push(["Fraction", `${Number(f.s) < 0 ? "−" : ""}${f.n}/${f.d}`]);
      } catch {
        /* not a simple fraction */
      }
    }
    if (Number.isInteger(shownNum) && Math.abs(shownNum) < 2 ** 53) {
      out.push(["Hex", (shownNum < 0 ? "−0x" : "0x") + Math.abs(shownNum).toString(16).toUpperCase()]);
      if (Math.abs(shownNum) < 2 ** 32) out.push(["Binary", (shownNum < 0 ? "−" : "") + Math.abs(shownNum).toString(2)]);
    }
    if (Math.abs(shownNum) >= 1e6 || (Math.abs(shownNum) < 1e-3 && shownNum !== 0)) out.push(["Scientific", shownNum.toExponential(8).replace(/\.?0+e/, "e")]);
    return out;
  }, [math, shownNum]);

  const keyClass = (k: Key) =>
    cn(
      "relative flex h-12 select-none items-center justify-center rounded-[10px] border text-[15px] font-medium transition-[background-color,transform,border-color] duration-100 active:scale-[0.96] @3xl:h-11",
      k.tone === "num" && "border-line bg-surface text-ink hover:border-ink-3",
      k.tone === "op" && "border-line bg-paper-2 text-ink hover:border-ink-3",
      k.tone === "eq" && "border-ink bg-ink text-paper hover:opacity-90",
      k.tone === "danger" && "border-line bg-paper text-danger hover:border-danger/50",
      !k.tone && "border-line bg-paper text-ink-2 hover:border-ink-3 hover:text-ink",
    );

  return (
    <div
      className="grid gap-4"
      onKeyDown={(e) => {
        if (e.target !== input.current) return;
        if (e.key === "Enter") {
          e.preventDefault();
          equals();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setExpr("");
          setResult(null);
        }
      }}
    >
      {/* Display */}
      <div className="overflow-hidden rounded-lg border border-ink bg-ink text-paper">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-dark px-3 py-2">
          <div role="radiogroup" aria-label="Angle unit" className="flex rounded-[8px] bg-ink-raised p-0.5">
            {(["deg", "rad", "grad"] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={angle === a} onClick={() => setAngle(a)} className={cn("h-7 rounded-[6px] px-2.5 font-mono text-[12px] uppercase", angle === a ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}>
                {a}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 font-mono text-[12px] text-paper-dim">
            {mem !== 0 && <span title="Memory">M = {mem}</span>}
            <span title="Last answer">Ans = {String(+ans.toPrecision(12))}</span>
            <button type="button" onClick={() => setShowHistory((v) => !v)} aria-pressed={showHistory} className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 hover:bg-ink-raised hover:text-paper">
              <History aria-hidden className="size-3.5" /> History
            </button>
          </div>
        </div>
        <div className="px-4 pb-4 pt-3">
          <input
            ref={input}
            value={expr}
            onChange={(e) => (setExpr(e.target.value), setResult(null))}
            placeholder="Type or tap: 2 × sin(30) + √(16)"
            aria-label="Expression"
            spellCheck={false}
            autoComplete="off"
            inputMode="decimal"
            className="w-full bg-transparent text-right font-mono text-lg text-paper outline-none placeholder:text-paper-dim/60"
          />
          <div className="mt-2 flex min-h-[52px] items-end justify-end gap-3" aria-live="polite">
            {result?.error ? (
              <p className="text-right text-sm text-[#f0a37c]">{result.error}</p>
            ) : (
              <>
                {shownValue && <CopyButton text={shownValue} label="" className="border-line-dark bg-ink-raised text-paper-dim hover:text-paper" />}
                <p className={cn("break-all text-right font-mono tracking-tight transition-colors", result?.done ? "text-4xl text-paper" : "text-2xl text-paper-dim")}>
                  {shownValue ? `${result?.done ? "" : "= "}${shownValue}` : "0"}
                </p>
              </>
            )}
          </div>
          {extras.length > 0 && (
            <p className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 font-mono text-[12px] text-paper-dim">
              {extras.map(([k, v]) => (
                <span key={k}>
                  {k} <span className="text-paper">{v}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showHistory && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="max-h-56 overflow-auto rounded-md border border-line bg-surface" data-lenis-prevent>
              {history.length ? (
                <ul className="divide-y divide-line">
                  {history.map((h, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => (setExpr(h.expr), setResult(null), input.current?.focus())} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-mono text-[13px] hover:bg-paper">
                        <span className="truncate text-ink-2">{h.expr}</span>
                        <span className="shrink-0 text-ink">= {h.result}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-3 text-sm text-ink-3">Nothing yet. Press = to keep a result here.</p>
              )}
              {history.length > 0 && (
                <button type="button" onClick={() => (setHistory([]), localStorage.removeItem("dw:calc-history"))} className="w-full border-t border-line px-3 py-2 text-left text-xs text-ink-3 hover:text-ink">
                  Clear history
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keys */}
      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-5 gap-1.5">
          <button type="button" onClick={() => setSecond((v) => !v)} aria-pressed={second} className={cn(keyClass({ label: "2nd" }), second && "border-accent bg-accent text-paper hover:text-paper")}>
            2nd
          </button>
          {(["mc", "m+", "m-", "mr"] as const).map((m) => (
            <button key={m} type="button" onClick={() => memory(m)} className={keyClass({ label: m })} title={{ mc: "Clear memory", "m+": "Add to memory", "m-": "Subtract from memory", mr: "Recall memory" }[m]}>
              {m.toUpperCase().replace("-", "−")}
            </button>
          ))}
          {FN_KEYS.map((k) => {
            const alt = second && k.second;
            return (
              <button key={k.label} type="button" onClick={() => press(k)} title={(alt ? k.second!.title : k.title) ?? undefined} className={cn(keyClass(k), alt && "text-accent")}>
                {alt ? k.second!.label : k.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {NUM_KEYS.map((k) => (
            <button key={k.label} type="button" onClick={() => press(k)} title={k.title} className={keyClass(k)}>
              {k.label}
            </button>
          ))}
          <button type="button" onClick={() => insert("Ans")} className={keyClass({ label: "Ans" })}>
            Ans
          </button>
          <button type="button" onClick={() => insert(",")} className={keyClass({ label: "," })} title="Separates arguments: nCr(5, 2)">
            ,
          </button>
          <button type="button" onClick={() => insert("−")} className={keyClass({ label: "±" })} title="Negative">
            ±
          </button>
          <button
            type="button"
            aria-label="Delete"
            onClick={() => {
              setResult(null);
              setExpr((v) => v.slice(0, -1));
            }}
            className={keyClass({ label: "⌫" })}
          >
            <Delete aria-hidden className="size-4" />
          </button>
        </div>
      </div>
      <p className="text-xs text-ink-3">
        Type freely too: <span className="font-mono">nCr(10, 3)</span>, <span className="font-mono">log(8, 2)</span>, <span className="font-mono">5!</span>, <span className="font-mono">17 mod 5</span>,{" "}
        <span className="font-mono">15% × 80</span>, <span className="font-mono">3e8</span>, even units: <span className="font-mono">5 inch to cm</span>. Enter = equals, Esc clears.
      </p>
    </div>
  );
}

function friendly(msg: string) {
  if (/Unexpected end|Parenthesis|Incomplete/i.test(msg)) return "The expression isn't finished (check the brackets).";
  if (/Undefined symbol (\w+)/.test(msg)) return `“${/Undefined symbol (\w+)/.exec(msg)![1]}” isn't a number, function or unit I know.`;
  if (/Unexpected/i.test(msg)) return "Something's out of place in the expression.";
  if (/Not a number/.test(msg)) return "That has no real answer (for example, the root of a negative number).";
  return msg.split("(char")[0];
}
