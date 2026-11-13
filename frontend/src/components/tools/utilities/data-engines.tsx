"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, RefreshCw, X } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { enc, HASH_ALGS, hashHex, hmacHex, wordpressCheck, wordpressHash } from "@/lib/utilities/hashes";
import {
  CHARSETS,
  DEFAULT_FIELDS,
  FIELD_TYPES,
  fromRegex,
  pick,
  randBetween,
  randFloat,
  randInt,
  randomDate,
  randomFraction,
  randomIp,
  randomMac,
  randomPrime,
  randomRecords,
  randString,
  recordsAs,
  shuffle,
  type Field,
  type FieldType,
  type RandomKind,
} from "@/lib/utilities/random";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor, FilePick, Output, ValueList, ValueRow } from "../dev/parts";
import type { EngineProps } from "./text-engines";

/* ---------- hashes ---------- */

const HMAC_ALGS = HASH_ALGS.filter((a) => a.hmac);

export function HashEngine({ preset }: EngineProps) {
  if (preset.alg === "wordpress") return <WordpressHash />;
  return <Hasher initial={preset.alg ?? "sha256"} hmacStart={preset.hmac === "1"} allStart={preset.all === "1"} />;
}

function Hasher({ initial, hmacStart, allStart }: { initial: string; hmacStart: boolean; allStart: boolean }) {
  const [hmacMode, setHmac] = useState(hmacStart);
  const [alg, setAlg] = useState(initial);
  const [input, setInput] = useState("hello world");
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [key, setKey] = useState("secret");
  const [upper, setUpper] = useState(false);
  const [all, setAll] = useState(allStart);
  const [check, setCheck] = useState("");
  const d = useDeferredValue(input);

  useEffect(() => {
    let live = true;
    if (file) void file.arrayBuffer().then((b) => live && setBytes(new Uint8Array(b)));
    return () => {
      live = false;
    };
  }, [file]);
  const data = useMemo(() => (file ? bytes : enc(d)), [file, bytes, d]);
  const list = useMemo(() => (all ? (hmacMode ? HMAC_ALGS : HASH_ALGS) : HASH_ALGS.filter((a) => a.id === alg)), [all, hmacMode, alg]);
  const results = useMemo(() => {
    if (!data) return [];
    return list.map((a) => {
      try {
        const h = hmacMode ? hmacHex(a.id, key, data) : hashHex(a.id, data);
        return { alg: a, value: upper ? h.toUpperCase() : h };
      } catch (e) {
        return { alg: a, value: "", error: (e as Error).message };
      }
    });
  }, [data, list, hmacMode, key, upper]);
  const want = check.trim().toLowerCase();
  const match = want ? results.find((r) => r.value.toLowerCase() === want) : undefined;
  const current = HASH_ALGS.find((a) => a.id === alg);
  return (
    <>
      <Panel>
        <Row label="Algorithm">
          <Chips value={all ? "__all" : alg} options={[...(hmacMode ? HMAC_ALGS : HASH_ALGS).map((a) => ({ value: a.id, label: a.label })), { value: "__all", label: "All at once" }]} onChange={(v) => (v === "__all" ? setAll(true) : (setAll(false), setAlg(v)))} label="Algorithm" />
          {current?.note && !all && <p className="mt-2 text-xs text-ink-3">{current.note}</p>}
        </Row>
        <Row label="Source">
          <FilePick label={file ? "Pick another file" : "Or hash a file…"} onFile={(f) => (setFile(f), setBytes(null))} file={file} />
        </Row>
        <Row label="HMAC">
          <Toggle checked={hmacMode} onChange={(v) => (setHmac(v), v && !HASH_ALGS.find((a) => a.id === alg)?.hmac && setAlg("sha256"))} label="Keyed hash (HMAC) with a secret" />
          {hmacMode && (
            <div className="mt-3">
              <TextField label="HMAC secret key" value={key} onChange={setKey} mono />
            </div>
          )}
        </Row>
        <Row label="Output">
          <Toggle checked={upper} onChange={setUpper} label="Upper-case hex" />
        </Row>
      </Panel>
      {!file && <Editor value={input} onChange={setInput} name="input.txt" rows={5} />}
      <ValueList>
        {results.map((r) => (
          <ValueRow key={r.alg.id} label={hmacMode ? `HMAC ${r.alg.label}` : r.alg.label} value={r.value} highlight={match?.alg.id === r.alg.id} note={"error" in r ? r.error : undefined} />
        ))}
      </ValueList>
      <Panel>
        <Row label="Compare">
          <TextField label="Hash to compare" value={check} onChange={setCheck} placeholder="Paste a known hash to check it matches" mono invalid={Boolean(want) && !match} />
          {want && <p className={cn("mt-1.5 text-xs", match ? "text-success" : "text-danger")}>{match ? `✓ Matches the ${match.alg.label} hash.` : all ? "✗ Doesn't match any hash above." : "✗ Doesn't match. Try “All at once” in case it's another algorithm."}</p>}
        </Row>
      </Panel>
    </>
  );
}

function WordpressHash() {
  const [pw, setPw] = useState("my-password");
  const [seed, setSeed] = useState(0);
  const [hash, setHash] = useState("");
  const [check, setCheck] = useState("");
  useEffect(() => {
    let live = true;
    // 8,192 rounds of MD5: quick, but off the input path.
    const t = setTimeout(() => live && setHash(pw ? wordpressHash(pw) : ""), 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pw, seed]);
  const verdict = check.trim() && pw ? wordpressCheck(pw, check.trim()) : null;
  return (
    <>
      <Panel>
        <Row label="Password">
          <TextField label="Password" value={pw} onChange={setPw} mono />
        </Row>
      </Panel>
      <ValueList>
        <ValueRow label="Hash" value={hash} note="phpass portable hash ($P$), as stored in wp_users.user_pass. A new random salt each time." />
      </ValueList>
      <button type="button" onClick={() => setSeed((s) => s + 1)} className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
        <RefreshCw aria-hidden className="size-4" /> New salt
      </button>
      <Panel>
        <Row label="Check a hash">
          <TextField label="WordPress hash to check" value={check} onChange={setCheck} placeholder="$P$B…" mono invalid={verdict === false} />
          {verdict !== null && <p className={cn("mt-1.5 text-xs", verdict ? "text-success" : "text-danger")}>{verdict ? "✓ That password matches this hash." : "✗ That password doesn't match this hash."}</p>}
        </Row>
      </Panel>
      <Notice>WordPress 6.8+ stores new passwords with bcrypt ($wp$2y$…) but still accepts these $P$ hashes, so a hash made here works for resetting a password in the database.</Notice>
    </>
  );
}

/* ---------- random ---------- */

const KINDS: { value: RandomKind; label: string }[] = [
  { value: "names", label: "Name picker" }, { value: "integer", label: "Integer" }, { value: "decimal", label: "Decimal" }, { value: "fraction", label: "Fraction" },
  { value: "prime", label: "Prime" }, { value: "string", label: "String" }, { value: "alnum", label: "Alphanumeric" }, { value: "letters", label: "Letters" },
  { value: "hex", label: "Hex" }, { value: "binary", label: "Binary" }, { value: "bytes", label: "Bytes" }, { value: "date", label: "Date" }, { value: "time", label: "Time" },
  { value: "ip", label: "IP address" }, { value: "mac", label: "MAC address" }, { value: "json", label: "JSON" }, { value: "csv", label: "CSV" }, { value: "tsv", label: "TSV" },
  { value: "xml", label: "XML" }, { value: "regex", label: "From regex" }, { value: "bitmap", label: "Bitmap" },
];

const num = (v: string, d: number) => (Number.isFinite(+v) && v.trim() !== "" ? +v : d);

export function RandomEngine({ preset }: EngineProps) {
  const [kind, setKind] = useState<RandomKind>((preset.kind as RandomKind) ?? "integer");
  return (
    <>
      <Panel>
        <Row label="Make">
          <Chips value={kind} options={KINDS} onChange={setKind} label="Kind of data" />
        </Row>
      </Panel>
      {kind === "names" ? <NamePicker /> : kind === "bitmap" ? <Bitmap /> : ["json", "csv", "tsv", "xml"].includes(kind) ? <Records kind={kind as "json"} /> : <Values kind={kind} key={kind} />}
    </>
  );
}

function Values({ kind }: { kind: RandomKind }) {
  const [count, setCount] = useState(kind === "prime" || kind === "integer" || kind === "decimal" ? 10 : 5);
  const [min, setMin] = useState(kind === "prime" ? "1" : "1");
  const [max, setMax] = useState(kind === "prime" ? "10000" : "100");
  const [places, setPlaces] = useState(2);
  const [len, setLen] = useState(kind === "bytes" ? 16 : kind === "binary" ? 32 : 16);
  const [sets, setSets] = useState({ lower: true, upper: true, digits: kind !== "letters", symbols: kind === "string" });
  const [unique, setUnique] = useState(false);
  const [sorted, setSorted] = useState(false);
  const [from, setFrom] = useState("2000-01-01");
  const [to, setTo] = useState("2030-12-31");
  const [ipv, setIpv] = useState<4 | 6>(4);
  const [pub, setPub] = useState(true);
  const [macSep, setMacSep] = useState(":");
  const [pattern, setPattern] = useState("[A-Z]{3}-\\d{4}-[a-z]{2}");
  const [h24, setH24] = useState(true);
  const [proper, setProper] = useState(true);
  const [seed, setSeed] = useState(0);
  const [regexOut, setRegexOut] = useState<{ list: string[]; error: string | null }>({ list: [], error: null });

  useEffect(() => {
    if (kind !== "regex") return;
    let live = true;
    void fromRegex(pattern, "", count, 10)
      .then((list) => live && setRegexOut({ list, error: null }))
      .catch((e) => live && setRegexOut({ list: [], error: `That pattern isn't valid: ${(e as Error).message}` }));
    return () => {
      live = false;
    };
  }, [kind, pattern, count, seed]);

  const { list, error } = useMemo((): { list: string[]; error: string | null } => {
    void seed;
    if (kind === "regex") return regexOut;
    const lo = num(min, 0);
    const hi = num(max, 100);
    if (["integer", "decimal", "prime"].includes(kind) && lo > hi) return { list: [], error: "The minimum is above the maximum." };
    const one = (): string => {
      switch (kind) {
        case "integer": return String(randBetween(Math.ceil(lo), Math.floor(hi)));
        case "decimal": return (lo + randFloat() * (hi - lo)).toFixed(places);
        case "fraction": return randomFraction(Math.max(2, Math.floor(hi)), proper);
        case "prime": return String(randomPrime(Math.max(2, Math.ceil(lo)), Math.floor(hi)) ?? "none");
        case "string": case "alnum": case "letters": {
          const chars = (sets.lower ? CHARSETS.lower : "") + (sets.upper ? CHARSETS.upper : "") + (kind !== "letters" && sets.digits ? CHARSETS.digits : "") + (kind === "string" && sets.symbols ? CHARSETS.symbols : "");
          return randString(len, chars);
        }
        case "hex": return randString(len, "0123456789abcdef");
        case "binary": return randString(len, "01");
        case "bytes": return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => b.toString(16).padStart(2, "0")).join(" ");
        case "date": return randomDate(from, to).toISOString().slice(0, 10);
        case "time": {
          const h = randInt(24), m = randInt(60), s = randInt(60);
          const p = (n: number) => String(n).padStart(2, "0");
          return h24 ? `${p(h)}:${p(m)}:${p(s)}` : `${((h + 11) % 12) + 1}:${p(m)}:${p(s)} ${h < 12 ? "AM" : "PM"}`;
        }
        case "ip": return randomIp(ipv, pub);
        case "mac": return randomMac(macSep, true, true);
        default: return "";
      }
    };
    if (kind === "integer" && unique && hi - lo + 1 < count) return { list: [], error: `There are only ${hi - lo + 1} whole numbers in that range.` };
    if (kind === "prime" && hi < 2) return { list: [], error: "There are no primes below 2." };
    let out: string[] = [];
    if (kind === "integer" && unique) {
      const seen = new Set<string>();
      for (let i = 0; seen.size < count && i < count * 50; i++) seen.add(one());
      out = [...seen];
    } else out = Array.from({ length: count }, one);
    if (sorted) out.sort((a, b) => (Number.isFinite(+a) && Number.isFinite(+b) ? +a - +b : a.localeCompare(b)));
    return { list: out, error: null };
  }, [kind, count, min, max, places, len, sets, unique, sorted, from, to, ipv, pub, macSep, h24, proper, seed, regexOut]);

  const numeric = ["integer", "decimal", "prime"].includes(kind);
  const stringy = ["string", "alnum", "letters", "hex", "binary", "bytes"].includes(kind);
  return (
    <>
      <Panel>
        <Row label="How many">
          <Slider label="How many" value={count} min={1} max={kind === "bytes" ? 50 : 500} onChange={setCount} />
        </Row>
        {(numeric || kind === "fraction") && (
          <Row label={kind === "fraction" ? "Largest denominator" : "Range"}>
            <div className="flex items-center gap-2">
              {kind !== "fraction" && <TextField label="Minimum" value={min} onChange={setMin} mono inputMode="decimal" />}
              {kind !== "fraction" && <span className="text-ink-3">to</span>}
              <TextField label="Maximum" value={max} onChange={setMax} mono inputMode="decimal" />
            </div>
          </Row>
        )}
        {kind === "decimal" && (
          <Row label="Decimal places">
            <Slider label="Decimal places" value={places} min={0} max={10} onChange={setPlaces} />
          </Row>
        )}
        {kind === "fraction" && (
          <Row label="Kind">
            <Toggle checked={proper} onChange={setProper} label="Proper fractions only (less than 1)" />
          </Row>
        )}
        {stringy && (
          <Row label={kind === "bytes" ? "Bytes each" : "Length"}>
            <Slider label="Length" value={len} min={1} max={kind === "bytes" ? 256 : 256} onChange={setLen} />
          </Row>
        )}
        {(kind === "string" || kind === "alnum" || kind === "letters") && (
          <Row label="Characters">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={sets.lower} onChange={(v) => setSets((s) => ({ ...s, lower: v }))} label="a–z" />
              <Toggle checked={sets.upper} onChange={(v) => setSets((s) => ({ ...s, upper: v }))} label="A–Z" />
              {kind !== "letters" && <Toggle checked={sets.digits} onChange={(v) => setSets((s) => ({ ...s, digits: v }))} label="0–9" />}
              {kind === "string" && <Toggle checked={sets.symbols} onChange={(v) => setSets((s) => ({ ...s, symbols: v }))} label="Symbols" />}
            </div>
          </Row>
        )}
        {kind === "date" && (
          <Row label="Between">
            <div className="flex items-center gap-2">
              <TextField label="From" value={from} onChange={setFrom} type="date" />
              <span className="text-ink-3">and</span>
              <TextField label="To" value={to} onChange={setTo} type="date" />
            </div>
          </Row>
        )}
        {kind === "time" && (
          <Row label="Clock">
            <Chips value={h24 ? 24 : 12} options={[{ value: 24, label: "24-hour" }, { value: 12, label: "12-hour" }]} onChange={(v) => setH24(v === 24)} label="Clock" />
          </Row>
        )}
        {kind === "ip" && (
          <Row label="Version">
            <div className="flex flex-wrap items-center gap-4">
              <Chips value={ipv} options={[{ value: 4, label: "IPv4" }, { value: 6, label: "IPv6" }]} onChange={setIpv} label="IP version" />
              {ipv === 4 && <Toggle checked={pub} onChange={setPub} label="Public addresses only" />}
            </div>
          </Row>
        )}
        {kind === "mac" && (
          <Row label="Separator" hint="Locally administered: never a real vendor's.">
            <Chips value={macSep} options={[{ value: ":", label: "00:1A:2B" }, { value: "-", label: "00-1A-2B" }, { value: "", label: "001A2B" }]} onChange={setMacSep} label="Separator" />
          </Row>
        )}
        {kind === "regex" && (
          <Row label="Pattern">
            <TextField label="Regular expression" value={pattern} onChange={setPattern} mono invalid={Boolean(regexOut.error)} />
          </Row>
        )}
        {numeric && (
          <Row label="Options">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {kind === "integer" && <Toggle checked={unique} onChange={setUnique} label="No repeats" />}
              <Toggle checked={sorted} onChange={setSorted} label="Sorted" />
            </div>
          </Row>
        )}
      </Panel>
      <Output value={list.join("\n")} error={error} name={`random-${kind}.txt`} lang={`${list.length} values · crypto random`} download={`random-${kind}.txt`} />
      <AgainButton onClick={() => setSeed((s) => s + 1)} />
    </>
  );
}

function AgainButton({ onClick, label = "Generate again" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
      <RefreshCw aria-hidden className="size-4" />
      {label}
    </button>
  );
}

function NamePicker() {
  const [names, setNames] = useState("Asha\nBen\nChloé\nDiego\nEmeka\nFatima\nGeorge\nHiro");
  const [count, setCount] = useState(1);
  const [winners, setWinners] = useState<string[]>([]);
  const [rolling, setRolling] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const list = names.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);
  const draw = () => {
    if (!list.length) return;
    if (timer.current) clearInterval(timer.current);
    let ticks = 0;
    timer.current = setInterval(() => {
      ticks++;
      setRolling(pick(list));
      if (ticks > 14) {
        clearInterval(timer.current!);
        setRolling(null);
        setWinners(shuffle(list).slice(0, Math.min(count, list.length)));
      }
    }, 70);
  };
  return (
    <>
      <Editor value={names} onChange={setNames} name="names.txt" rows={7} spellCheck />
      <Panel>
        <Row label="Pick" hint={`${list.length} names`}>
          <Slider label="How many to pick" value={Math.min(count, Math.max(1, list.length))} min={1} max={Math.max(1, list.length)} onChange={setCount} />
        </Row>
      </Panel>
      <AgainButton onClick={draw} label={winners.length ? "Pick again" : "Pick"} />
      {(rolling || winners.length > 0) && (
        <div className="rounded-md border border-line bg-surface px-5 py-6 text-center" aria-live="polite">
          {rolling ? (
            <p className="font-serif text-4xl text-ink-3">{rolling}</p>
          ) : (
            <>
              <p className="label-mono text-ink-3">{winners.length === 1 ? "The winner" : "Picked"}</p>
              <p className="mt-2 font-serif text-4xl leading-tight text-ink">{winners.join(", ")}</p>
              <div className="mt-3 flex justify-center">
                <CopyButton text={winners.join("\n")} />
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function Records({ kind }: { kind: "json" | "csv" | "tsv" | "xml" }) {
  const [fields, setFields] = useState<Field[]>(DEFAULT_FIELDS);
  const [count, setCount] = useState(10);
  const [seed, setSeed] = useState(0);
  const out = useMemo(() => (void seed, recordsAs(randomRecords(fields, count), kind)), [fields, count, kind, seed]);
  const update = (i: number, p: Partial<Field>) => setFields((f) => f.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <>
      <Panel>
        <Row label="Rows">
          <Slider label="Rows" value={count} min={1} max={1000} onChange={setCount} />
        </Row>
        <Row label="Fields">
          <ul className="space-y-2">
            {fields.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextField label={`Field ${i + 1} name`} value={f.name} onChange={(v) => update(i, { name: v })} mono />
                </div>
                <select value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldType })} aria-label={`Field ${i + 1} type`} className="h-11 rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-ink">
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setFields((all) => all.filter((_, j) => j !== i))} aria-label={`Remove field ${f.name}`} className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink">
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setFields((f) => [...f, { name: `field${f.length + 1}`, type: "word" }])} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-dashed border-ink-3/60 px-3 text-sm text-ink-2 hover:border-ink hover:text-ink">
            <Plus aria-hidden className="size-4" /> Add a field
          </button>
        </Row>
      </Panel>
      <Output value={out} name={`data.${kind}`} lang={`${count} rows · made-up data`} download={`random-data.${kind}`} wrap={false} />
      <AgainButton onClick={() => setSeed((s) => s + 1)} />
    </>
  );
}

function Bitmap() {
  const [w, setW] = useState(64);
  const [h, setH] = useState(64);
  const [mode, setMode] = useState<"bw" | "gray" | "color">("bw");
  const [scale, setScale] = useState(4);
  const [seed, setSeed] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void seed;
    const c = canvas.current;
    if (!c) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const rnd = crypto.getRandomValues(new Uint8Array(w * h * 3));
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = mode === "color" ? [rnd[i * 3], rnd[i * 3 + 1], rnd[i * 3 + 2]] : mode === "gray" ? [rnd[i * 3], rnd[i * 3], rnd[i * 3]] : rnd[i * 3] & 1 ? [255, 255, 255] : [0, 0, 0];
      img.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  }, [w, h, mode, seed]);
  return (
    <>
      <Panel>
        <Row label="Size">
          <div className="flex items-center gap-2">
            <TextField label="Width" value={String(w)} onChange={(v) => setW(Math.max(1, Math.min(2048, num(v, 64))))} mono inputMode="numeric" />
            <span className="text-ink-3">×</span>
            <TextField label="Height" value={String(h)} onChange={(v) => setH(Math.max(1, Math.min(2048, num(v, 64))))} mono inputMode="numeric" />
          </div>
        </Row>
        <Row label="Colours">
          <Chips value={mode} options={[{ value: "bw", label: "Black & white" }, { value: "gray", label: "Greyscale" }, { value: "color", label: "Colour" }]} onChange={setMode} label="Colours" />
        </Row>
        <Row label="Zoom">
          <Slider label="Zoom" value={scale} min={1} max={10} onChange={setScale} format={(v) => `${v}×`} />
        </Row>
      </Panel>
      <div className="overflow-auto rounded-md border border-line bg-paper-2 p-3" data-lenis-prevent>
        <canvas ref={canvas} aria-label="Random bitmap" style={{ width: w * scale, height: h * scale, imageRendering: "pixelated" }} />
      </div>
      <div className="flex flex-wrap gap-2">
        <AgainButton onClick={() => setSeed((s) => s + 1)} />
        <button type="button" onClick={() => canvas.current?.toBlob((b) => b && saveBlob(b, `random-${w}x${h}.png`))} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
          <Download aria-hidden className="size-4" /> Download PNG
        </button>
      </div>
    </>
  );
}
