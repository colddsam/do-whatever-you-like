"use client";

import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Binary,
  Braces,
  CaseSensitive,
  Clock,
  Fingerprint,
  GitCompare,
  Hash,
  KeyRound,
  Link2,
  Lock,
  Palette,
  RefreshCw,
  Regex,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  asText,
  CASES,
  contrast,
  decodeJwt,
  diffLines,
  entropyBits,
  fromBase64,
  fromUnix,
  hash,
  HASHES,
  jsonToCsv,
  nanoid,
  parseBigInt,
  parseColor,
  parseJson,
  password,
  relative,
  rgbToHsl,
  sortKeys,
  toBase64,
  toHex,
  utf8,
  uuidV4,
  uuidV7,
  verifyHmacJwt,
  words,
  type HashName,
  type PasswordOptions,
} from "@/lib/dev";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor, FilePick, JsonTree, Output, ValueList, ValueRow } from "./parts";

type UtilId = "json" | "diff" | "base64" | "url" | "hash" | "jwt" | "regex" | "time" | "base" | "color" | "case" | "uuid" | "password";

const UTILS: { id: UtilId; label: string; blurb: string; group: string; icon: LucideIcon }[] = [
  { id: "json", label: "JSON", blurb: "Format, validate, minify, tree, CSV", group: "Data", icon: Braces },
  { id: "diff", label: "Text diff", blurb: "What changed between two texts", group: "Data", icon: GitCompare },
  { id: "base64", label: "Base64", blurb: "Encode and decode text or files", group: "Encode", icon: Binary },
  { id: "url", label: "URL", blurb: "Encode, decode and take apart", group: "Encode", icon: Link2 },
  { id: "hash", label: "Hash", blurb: "MD5, SHA-1/256/384/512, HMAC", group: "Encode", icon: Hash },
  { id: "jwt", label: "JWT", blurb: "Decode and verify tokens", group: "Inspect", icon: ShieldCheck },
  { id: "regex", label: "Regex", blurb: "Test patterns, see every match", group: "Inspect", icon: Regex },
  { id: "time", label: "Timestamp", blurb: "Unix time to dates and back", group: "Convert", icon: Clock },
  { id: "base", label: "Number base", blurb: "Binary, octal, decimal, hex", group: "Convert", icon: Hash },
  { id: "color", label: "Colour", blurb: "HEX, RGB, HSL and contrast", group: "Convert", icon: Palette },
  { id: "case", label: "Case & count", blurb: "camelCase, snake_case, word count", group: "Convert", icon: CaseSensitive },
  { id: "uuid", label: "UUID & IDs", blurb: "UUID v4, v7 and Nano IDs", group: "Generate", icon: Fingerprint },
  { id: "password", label: "Password", blurb: "Strong, random, made here", group: "Generate", icon: KeyRound },
];
const isUtil = (v: string): v is UtilId => UTILS.some((u) => u.id === v);

/* The chosen utility lives in the URL hash (#jwt), so every utility has a link of its own. */
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const readHash = () => window.location.hash.slice(1);
const choose = (id: UtilId) => {
  history.replaceState(null, "", `#${id}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

export function DevUtilities({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const hashValue = useSyncExternalStore(subscribe, readHash, () => "");
  const active: UtilId = isUtil(hashValue) ? hashValue : "json";
  const util = UTILS.find((u) => u.id === active)!;

  return (
    <Workbench steps={stepsFor(tool)} current={1} footer={<>Everything here runs in your browser. Nothing you paste is sent anywhere, so it&apos;s safe for tokens and keys.</>}>
      <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-[208px_minmax(0,1fr)] md:gap-5">
        <nav aria-label="Utilities" className="min-w-0">
          {/* Phones: one scrolling row. From md: a rail, grouped. */}
          <ul role="tablist" aria-orientation="vertical" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
            {UTILS.map((u, i) => {
              const on = u.id === active;
              const Icon = u.icon;
              const newGroup = i === 0 || UTILS[i - 1].group !== u.group;
              return (
                <li key={u.id} role="none" className="shrink-0">
                  {newGroup && <p className="label-mono mb-1 mt-3 hidden px-2.5 text-ink-3 first:mt-0 md:block">{u.group}</p>}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => choose(u.id)}
                    className={cn(
                      "group relative flex h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-sm transition-colors duration-150",
                      on ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
                    )}
                  >
                    {on && <motion.span layoutId="dev-rail" aria-hidden className="absolute inset-0 rounded-[8px] bg-ink" transition={{ type: "spring", bounce: 0.22, duration: 0.45 }} />}
                    <Icon aria-hidden className="relative size-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                    <span className="relative whitespace-nowrap">{u.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-labelledby="dev-title" className="@container min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="dev-title" className="text-lg font-semibold tracking-[-0.015em] text-ink">
              {util.label}
            </h2>
            <p className="text-sm text-ink-3">{util.blurb}</p>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
              className="space-y-3"
            >
              {active === "json" && <JsonUtil />}
              {active === "diff" && <DiffUtil />}
              {active === "base64" && <Base64Util />}
              {active === "url" && <UrlUtil />}
              {active === "hash" && <HashUtil />}
              {active === "jwt" && <JwtUtil />}
              {active === "regex" && <RegexUtil />}
              {active === "time" && <TimeUtil />}
              {active === "base" && <BaseUtil />}
              {active === "color" && <ColorUtil />}
              {active === "case" && <CaseUtil />}
              {active === "uuid" && <UuidUtil />}
              {active === "password" && <PasswordUtil />}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </Workbench>
  );
}

/* ---------------------------------------------------------------------------------------------- */

const SAMPLE_JSON = '{"name":"Do-Whatever","tools":58,"free":true,"tags":["pdf","images","dev"],"owner":{"team":"core","since":2026}}';

function JsonUtil() {
  const [input, setInput] = useState(SAMPLE_JSON);
  const [indent, setIndent] = useState<"2" | "4" | "tab" | "min">("2");
  const [sorted, setSorted] = useState(false);
  const [view, setView] = useState<"text" | "tree" | "csv">("text");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const deferred = useDeferredValue(input);
  const parsed = useMemo(() => (deferred.trim() ? parseJson(deferred) : null), [deferred]);
  const value = parsed?.ok ? (sorted ? sortKeys(parsed.value) : parsed.value) : undefined;
  const text = parsed?.ok ? JSON.stringify(value, null, indent === "min" ? undefined : indent === "tab" ? "\t" : Number(indent)) : "";
  const error = parsed && !parsed.ok ? (
    <>
      {parsed.error}
      {parsed.line ? <span className="font-mono"> · line {parsed.line}, column {parsed.column}</span> : null}
    </>
  ) : undefined;

  return (
    <>
      <Editor value={input} onChange={setInput} name="input.json" placeholder='Paste JSON, like {"a": 1}' invalid={Boolean(error)} rows={8} />
      <Panel>
        <Row label="Output">
          <Chips value={view} onChange={setView} options={[{ value: "text", label: "Text" }, { value: "tree", label: "Tree" }, { value: "csv", label: "CSV" }]} />
        </Row>
        {view === "text" && (
          <Row label="Spacing">
            <Chips value={indent} onChange={setIndent} options={[{ value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }, { value: "tab", label: "Tabs" }, { value: "min", label: "Minified" }]} />
          </Row>
        )}
        <Row label="Keys">
          <Toggle checked={sorted} onChange={setSorted} label="Sort keys A to Z" description="Handy before comparing two JSON files." />
        </Row>
      </Panel>
      {parsed?.ok && !error && <p className="px-1 text-sm text-success">✓ Valid JSON{Array.isArray(value) ? ` · array of ${(value as unknown[]).length}` : value && typeof value === "object" ? ` · ${Object.keys(value as object).length} keys` : ""}</p>}
      {view === "tree" ? (
        <Output value={text} name="tree" lang={copiedPath ? `copied ${copiedPath}` : "click a key to copy its path"} error={error}>
          {value !== undefined && (
            <JsonTree
              value={value}
              onPath={(p) => {
                void navigator.clipboard.writeText(p).catch(() => undefined);
                setCopiedPath(p);
              }}
            />
          )}
        </Output>
      ) : view === "csv" ? (
        <Output value={value !== undefined ? jsonToCsv(value) : ""} name="output.csv" lang="CSV" error={error} download="data.csv" wrap={false} />
      ) : (
        <Output value={text} name={indent === "min" ? "output.min.json" : "output.json"} lang="JSON" error={error} download="data.json" wrap={indent === "min"} />
      )}
    </>
  );
}

function DiffUtil() {
  const [a, setA] = useState("The quick brown fox\njumps over\nthe lazy dog");
  const [b, setB] = useState("The quick brown fox\nleaps over\nthe lazy dog\nand runs away");
  const da = useDeferredValue(a);
  const db = useDeferredValue(b);
  const result = useMemo(() => {
    try {
      return { lines: diffLines(da, db), error: null };
    } catch (e) {
      return { lines: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [da, db]);
  const added = result.lines.filter((l) => l.kind === "add").length;
  const removed = result.lines.filter((l) => l.kind === "del").length;
  const unified = result.lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${l.text}`).join("\n");
  return (
    <>
      <div className="grid gap-3 @2xl:grid-cols-2">
        <Editor value={a} onChange={setA} name="before.txt" rows={7} />
        <Editor value={b} onChange={setB} name="after.txt" rows={7} />
      </div>
      <Output value={unified} name="changes.diff" lang={`+${added} −${removed}`} error={result.error ?? undefined} download="changes.diff">
        {a === b ? (
          <p className="px-3 py-3 text-sm text-ink-2">The two texts are the same.</p>
        ) : (
          <ol className="max-h-[420px] overflow-auto overscroll-contain py-1 font-mono text-[13px] leading-relaxed" data-lenis-prevent>
            {result.lines.map((l, i) => (
              <li
                key={i}
                className={cn(
                  "grid grid-cols-[2.5rem_2.5rem_1rem_minmax(0,1fr)] px-1",
                  l.kind === "add" && "bg-success/10",
                  l.kind === "del" && "bg-danger/10",
                )}
              >
                <span className="select-none pr-2 text-right text-[11px] text-ink-3">{l.a ?? ""}</span>
                <span className="select-none pr-2 text-right text-[11px] text-ink-3">{l.b ?? ""}</span>
                <span className={cn("select-none", l.kind === "add" ? "text-success" : l.kind === "del" ? "text-danger" : "text-ink-3")}>
                  {l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}
                </span>
                <span className="whitespace-pre-wrap break-all text-ink">{l.text || " "}</span>
              </li>
            ))}
          </ol>
        )}
      </Output>
    </>
  );
}

function Base64Util() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("Hello, world! ✓");
  const [file, setFile] = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [urlSafe, setUrlSafe] = useState(false);
  const [dataUrl, setDataUrl] = useState(false);

  const pick = (f: File | null) => {
    setFile(f);
    setFileBytes(null);
    if (f) void f.arrayBuffer().then((b) => setFileBytes(new Uint8Array(b)));
  };

  const result = useMemo(() => {
    try {
      if (mode === "encode") {
        const bytes = file ? fileBytes : utf8(input);
        if (!bytes) return { text: "", bytes: null as Uint8Array | null, error: null as string | null };
        const b64 = toBase64(bytes, urlSafe);
        return { text: dataUrl ? `data:${(file?.type || "text/plain;charset=utf-8")};base64,${b64}` : b64, bytes: null, error: null };
      }
      if (!input.trim()) return { text: "", bytes: null, error: null };
      const bytes = fromBase64(input);
      const text = asText(bytes);
      return { text: text ?? "", bytes, error: null };
    } catch (e) {
      return { text: "", bytes: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [mode, input, file, fileBytes, urlSafe, dataUrl]);

  const binary = mode === "decode" && result.bytes && !result.text;
  const mime = input.trim().match(/^data:([^;,]+)/)?.[1];
  return (
    <>
      <Panel>
        <Row label="Do">
          <Chips value={mode} onChange={(m) => (setMode(m), pick(null))} options={[{ value: "encode", label: "Encode to Base64" }, { value: "decode", label: "Decode Base64" }]} />
        </Row>
        {mode === "encode" && (
          <>
            <Row label="Source">
              <FilePick label={file ? "Pick another file" : "Or encode a file…"} onFile={pick} file={file} />
            </Row>
            <Row label="Form">
              <div className="space-y-2.5">
                <Toggle checked={urlSafe} onChange={setUrlSafe} label="URL-safe (- and _ instead of + and /, no padding)" />
                <Toggle checked={dataUrl} onChange={setDataUrl} label="As a data: URL" description="Ready to paste into HTML or CSS (src=, url())." />
              </div>
            </Row>
          </>
        )}
      </Panel>
      {!(mode === "encode" && file) && (
        <Editor value={input} onChange={setInput} name={mode === "encode" ? "input.txt" : "input.b64"} placeholder={mode === "encode" ? "Text to encode" : "Base64 (or a data: URL) to decode"} rows={6} invalid={Boolean(result.error)} />
      )}
      {binary ? (
        <Notice>
          That decodes to {formatBytes(result.bytes!.length)} of binary data (not text).{" "}
          <button type="button" className="underline underline-offset-4 hover:text-ink" onClick={() => saveBlob(new Blob([result.bytes! as BlobPart], { type: mime ?? "application/octet-stream" }), `decoded${mime?.startsWith("image/") ? `.${mime.split("/")[1]}` : ".bin"}`)}>
            Download it as a file
          </button>
          .
        </Notice>
      ) : (
        <Output value={result.text} name={mode === "encode" ? "output.b64" : "output.txt"} lang={mode === "encode" ? "Base64" : "UTF-8 text"} error={result.error ?? undefined} />
      )}
      {mode === "decode" && mime?.startsWith("image/") && result.bytes && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={input.trim()} alt="Decoded picture" className="max-h-64 rounded-md border border-line bg-paper-2 object-contain" />
      )}
    </>
  );
}

function UrlUtil() {
  const [input, setInput] = useState("https://example.com/search?q=caf%C3%A9 latte&page=2#results");
  const [mode, setMode] = useState<"decode" | "encode" | "component">("decode");
  const out = useMemo(() => {
    try {
      if (mode === "decode") return { v: decodeURIComponent(input.replace(/\+/g, " ")), e: null };
      if (mode === "encode") return { v: encodeURI(input), e: null };
      return { v: encodeURIComponent(input), e: null };
    } catch {
      return { v: "", e: "That text has a % that isn't followed by two hex digits, so it can't be decoded." };
    }
  }, [input, mode]);
  const parts = useMemo(() => {
    try {
      return new URL(input.trim());
    } catch {
      return null;
    }
  }, [input]);
  return (
    <>
      <Editor value={input} onChange={setInput} name="input.url" rows={3} placeholder="A URL, or text to encode" />
      <Panel>
        <Row label="Do">
          <Chips value={mode} onChange={setMode} options={[{ value: "decode", label: "Decode" }, { value: "encode", label: "Encode a whole URL" }, { value: "component", label: "Encode a value (component)" }]} />
          <p className="mt-2 text-xs text-ink-3">
            {mode === "component" ? "Encodes every reserved character (& = / ? #), for one query value." : mode === "encode" ? "Keeps the URL's structure (: / ? & #) and encodes the rest." : "Turns %XX and + back into characters."}
          </p>
        </Row>
      </Panel>
      <Output value={out.v} name="output.txt" lang="URL" error={out.e ?? undefined} />
      {parts && (
        <ValueList>
          <ValueRow label="Protocol" value={parts.protocol.replace(":", "")} />
          <ValueRow label="Host" value={parts.host} />
          <ValueRow label="Path" value={decodeURIComponent(parts.pathname)} />
          {[...parts.searchParams.entries()].map(([k, v], i) => (
            <ValueRow key={`${k}-${i}`} label={`?${k}`} value={v} />
          ))}
          {parts.hash && <ValueRow label="Fragment" value={decodeURIComponent(parts.hash.slice(1))} />}
        </ValueList>
      )}
    </>
  );
}

function HashUtil() {
  const [input, setInput] = useState("hello world");
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [check, setCheck] = useState("");
  const [hashes, setHashes] = useState<Partial<Record<HashName, string>>>({});
  const deferred = useDeferredValue(input);

  useEffect(() => {
    let live = true;
    const run = async () => {
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : utf8(deferred);
      const out: Partial<Record<HashName, string>> = {};
      for (const h of HASHES) out[h] = await hash(h, bytes, key || undefined);
      if (live) setHashes(out);
    };
    void run();
    return () => {
      live = false;
    };
  }, [deferred, file, key]);

  const want = check.trim().toLowerCase();
  const match = want ? HASHES.find((h) => hashes[h] === want) : undefined;
  return (
    <>
      <Panel>
        <Row label="Source">
          <FilePick label={file ? "Pick another file" : "Or hash a file…"} onFile={setFile} file={file} />
        </Row>
        <Row label="HMAC key (optional)">
          <TextField label="HMAC key" value={key} onChange={setKey} placeholder="Leave empty for a plain hash" mono />
        </Row>
      </Panel>
      {!file && <Editor value={input} onChange={setInput} name="input.txt" rows={5} />}
      <ValueList>
        {HASHES.map((h) => (
          <ValueRow key={h} label={key ? `HMAC ${h}` : h} value={hashes[h] ?? ""} highlight={match === h} note={h === "MD5" || h === "SHA-1" ? "Checksums only; not safe for passwords or signatures." : undefined} />
        ))}
      </ValueList>
      <Panel>
        <Row label="Compare">
          <TextField label="Hash to compare" value={check} onChange={setCheck} placeholder="Paste a hash to check it matches" mono invalid={Boolean(want) && !match} />
          {want && <p className={cn("mt-1.5 text-xs", match ? "text-success" : "text-danger")}>{match ? `✓ Matches the ${match} hash.` : "✗ Doesn't match any of the hashes above."}</p>}
        </Row>
      </Panel>
    </>
  );
}

const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

function JwtUtil() {
  const [token, setToken] = useState(SAMPLE_JWT);
  const [secret, setSecret] = useState("");
  const [verified, setVerified] = useState<{ for: string; ok: boolean | null } | null>(null);
  const [now] = useState(() => Date.now());
  const parsed = useMemo(() => {
    try {
      return { jwt: decodeJwt(token), error: null };
    } catch (e) {
      return { jwt: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [token]);

  useEffect(() => {
    if (!parsed.jwt || !secret) return;
    let live = true;
    void verifyHmacJwt(parsed.jwt, secret).then((ok) => live && setVerified({ for: `${token}|${secret}`, ok }));
    return () => {
      live = false;
    };
  }, [parsed.jwt, secret, token]);

  const p = parsed.jwt?.payload ?? {};
  const time = (k: string) => (typeof p[k] === "number" ? new Date((p[k] as number) * 1000) : null);
  const exp = time("exp");
  const state = verified && verified.for === `${token}|${secret}` && secret ? verified.ok : undefined;
  return (
    <>
      <Editor value={token} onChange={setToken} name="token.jwt" rows={4} invalid={Boolean(parsed.error)} />
      {parsed.error ? (
        <Notice tone="danger">{parsed.error}</Notice>
      ) : (
        parsed.jwt && (
          <>
            <div className="grid gap-3 @2xl:grid-cols-2">
              <Output value={JSON.stringify(parsed.jwt.header, null, 2)} name="header.json" lang={`alg ${String(parsed.jwt.header.alg ?? "?")}`} />
              <Output value={JSON.stringify(parsed.jwt.payload, null, 2)} name="payload.json" lang="claims" />
            </div>
            {(exp || time("iat") || time("nbf")) && (
              <ValueList>
                {(["iat", "nbf", "exp"] as const).map((k) => {
                  const d = time(k);
                  return d ? (
                    <ValueRow
                      key={k}
                      label={{ iat: "Issued", nbf: "Valid from", exp: "Expires" }[k]}
                      value={d.toISOString()}
                      mono
                      note={`${d.toLocaleString()} · ${relative(d, now)}${k === "exp" && d.getTime() < now ? " · expired" : ""}`}
                    />
                  ) : null;
                })}
              </ValueList>
            )}
            <Panel>
              <Row label="Verify the signature">
                <TextField label="Secret" value={secret} onChange={setSecret} placeholder="Shared secret (HS256, HS384, HS512)" mono />
                <p className={cn("mt-1.5 text-xs", state === true ? "text-success" : state === false ? "text-danger" : "text-ink-3")}>
                  {!secret
                    ? "Decoding never needs the secret; checking the signature does. It stays in this tab."
                    : state === true
                      ? "✓ Signature verified with this secret."
                      : state === false
                        ? "✗ Signature doesn't match this secret."
                        : state === null
                          ? `${String(parsed.jwt.header.alg)} is signed with a private key; it can't be checked with a shared secret here.`
                          : "Checking…"}
                </p>
              </Row>
            </Panel>
          </>
        )
      )}
    </>
  );
}

function RegexUtil() {
  const [pattern, setPattern] = useState("(\\w+)@(\\w+)\\.com");
  const [flags, setFlags] = useState<string[]>(["g", "i"]);
  const [text, setText] = useState("Write to ana@example.com or BEN@test.com, not ana@example.org.");
  const [replace, setReplace] = useState("");
  const result = useMemo(() => {
    try {
      const re = new RegExp(pattern, flags.join(""));
      const global = new RegExp(pattern, flags.includes("g") ? flags.join("") : flags.join("") + "g");
      const matches = pattern ? [...text.matchAll(global)].slice(0, 500) : [];
      return { re, matches, error: null };
    } catch (e) {
      return { re: null, matches: [], error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : String(e) };
    }
  }, [pattern, flags, text]);

  const pieces: { t: string; m: boolean }[] = [];
  let last = 0;
  for (const m of result.matches) {
    if (m.index === undefined || !m[0]) continue;
    pieces.push({ t: text.slice(last, m.index), m: false }, { t: m[0], m: true });
    last = m.index + m[0].length;
  }
  pieces.push({ t: text.slice(last), m: false });

  return (
    <>
      <Panel>
        <Row label="Pattern">
          <div className="flex items-center gap-2 font-mono">
            <span className="text-ink-3">/</span>
            <TextField label="Pattern" value={pattern} onChange={setPattern} mono invalid={Boolean(result.error)} />
            <span className="whitespace-nowrap text-ink-3">/{flags.join("")}</span>
          </div>
          {result.error && <p className="mt-1.5 text-xs text-danger">{result.error}</p>}
        </Row>
        <Row label="Flags">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["g", "global"],
                ["i", "ignore case"],
                ["m", "multiline"],
                ["s", "dot matches newline"],
                ["u", "unicode"],
              ] as const
            ).map(([f, name]) => {
              const on = flags.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFlags((v) => (on ? v.filter((x) => x !== f) : [...v, f]))}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[13px] transition-colors", on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3")}
                >
                  <span className="font-mono">{f}</span>
                  <span className={on ? "text-paper-dim" : "text-ink-3"}>{name}</span>
                </button>
              );
            })}
          </div>
        </Row>
      </Panel>
      <Editor value={text} onChange={setText} name="test.txt" rows={5} />
      <Output value={result.matches.map((m) => m[0]).join("\n")} name="matches" lang={`${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`} error={result.error ?? undefined}>
        <div className="max-h-[260px] overflow-auto overscroll-contain px-3 py-2.5 font-mono text-[13px] leading-relaxed" data-lenis-prevent>
          <p className="whitespace-pre-wrap break-words text-ink-2">
            {pieces.map((p, i) => (p.m ? <mark key={i} className="rounded-[3px] bg-accent/15 px-0.5 text-ink ring-1 ring-accent/40">{p.t}</mark> : <span key={i}>{p.t}</span>))}
          </p>
          {result.matches.some((m) => m.length > 1) && (
            <table className="mt-3 w-full text-left text-[12px]">
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 pr-3 font-normal">#</th>
                  <th className="py-1 pr-3 font-normal">Match</th>
                  {Array.from({ length: result.matches[0].length - 1 }, (_, g) => (
                    <th key={g} className="py-1 pr-3 font-normal">${g + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-3 text-ink-3">{i + 1}</td>
                    <td className="py-1 pr-3 text-ink">{m[0]}</td>
                    {m.slice(1).map((g, j) => (
                      <td key={j} className="py-1 pr-3 text-ink-2">{g ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Output>
      <Panel>
        <Row label="Replace with (optional)">
          <TextField label="Replacement" value={replace} onChange={setReplace} placeholder="$1 at $2 · use $1, $2 for groups" mono />
        </Row>
      </Panel>
      {replace && result.re && <Output value={text.replace(result.re, replace)} name="replaced.txt" lang="text" />}
    </>
  );
}

function TimeUtil() {
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const unix = fromUnix(input);
  const date = unix?.date ?? (input.trim() && !Number.isNaN(Date.parse(input)) ? new Date(input) : null);
  return (
    <>
      <Panel>
        <Row label="A Unix time or a date" hint={unix ? `read as ${unix.unit === "ms" ? "milliseconds" : "seconds"}` : undefined}>
          <div className="flex gap-2">
            <TextField label="Time" value={input} onChange={setInput} placeholder="1700000000, 2026-11-13T10:00:00Z or Nov 13 2026" mono invalid={Boolean(input.trim()) && !date} />
            <button type="button" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
              <Clock aria-hidden className="size-4" /> Now
            </button>
          </div>
          <p className="mt-2 font-mono text-xs text-ink-3">
            Now: <span className="text-ink-2">{Math.floor(now / 1000)}</span> · {new Date(now).toISOString()}
          </p>
        </Row>
      </Panel>
      {input.trim() && !date ? (
        <Notice tone="warning">That isn&apos;t a time we can read. Try seconds (1700000000), milliseconds, or an ISO date.</Notice>
      ) : (
        date && (
          <ValueList>
            <ValueRow label="Unix (s)" value={String(Math.floor(date.getTime() / 1000))} />
            <ValueRow label="Unix (ms)" value={String(date.getTime())} />
            <ValueRow label="ISO 8601" value={date.toISOString()} />
            <ValueRow label="UTC" value={date.toUTCString()} mono={false} />
            <ValueRow label="Your time" value={date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })} mono={false} />
            <ValueRow label="Relative" value={relative(date, now)} mono={false} />
          </ValueList>
        )
      )}
    </>
  );
}

const BASES = [
  { base: 2, label: "Binary" },
  { base: 8, label: "Octal" },
  { base: 10, label: "Decimal" },
  { base: 16, label: "Hex" },
] as const;

function BaseUtil() {
  const [src, setSrc] = useState<{ base: number; text: string }>({ base: 10, text: "255" });
  const value = parseBigInt(src.text, src.base);
  return (
    <Panel>
      {BASES.map(({ base, label }) => {
        const shown = src.base === base ? src.text : value === null ? "" : value.toString(base).toUpperCase();
        return (
          <Row key={base} label={`${label} · base ${base}`}>
            <div className="flex items-center gap-2">
              <TextField label={label} value={shown} onChange={(t) => setSrc({ base, text: t })} mono invalid={src.base === base && Boolean(src.text.trim()) && value === null} inputMode={base === 10 ? "numeric" : "text"} />
              <CopyButton text={shown} label="" className="h-11 shrink-0 px-3" />
            </div>
          </Row>
        );
      })}
      {value !== null && <p className="pt-2 font-mono text-xs text-ink-3">{value.toString(2).replace(/^-/, "").length} bits</p>}
    </Panel>
  );
}

function ColorUtil() {
  const [input, setInput] = useState("#eb4a10");
  const c = parseColor(input);
  const [h, s, l] = c ? rgbToHsl(c) : [0, 0, 0];
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const grade = (r: number) => (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : "fails");
  return (
    <>
      <Panel>
        <Row label="Colour">
          <div className="flex items-center gap-2">
            <label className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line" style={{ background: c ? toHex(c) : "transparent" }}>
              <input type="color" aria-label="Pick a colour" value={c ? toHex({ ...c, a: 1 }) : "#000000"} onChange={(e) => setInput(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <TextField label="Colour" value={input} onChange={setInput} placeholder="#1a73e8, rgb(26 115 232), hsl(214 82% 51%)" mono invalid={!c && Boolean(input.trim())} />
          </div>
        </Row>
      </Panel>
      {c ? (
        <>
          <ValueList>
            <ValueRow label="HEX" value={toHex(c)} />
            <ValueRow label="RGB" value={c.a < 1 ? `rgb(${c.r} ${c.g} ${c.b} / ${+c.a.toFixed(2)})` : `rgb(${c.r} ${c.g} ${c.b})`} />
            <ValueRow label="HSL" value={c.a < 1 ? `hsl(${h} ${s}% ${l}% / ${+c.a.toFixed(2)})` : `hsl(${h} ${s}% ${l}%)`} />
          </ValueList>
          <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line @md:grid-cols-2">
            {[
              { bg: white, label: "On white" },
              { bg: black, label: "On black" },
            ].map(({ bg, label }) => {
              const r = contrast(c, bg);
              return (
                <div key={label} className="px-4 py-4" style={{ background: toHex(bg) }}>
                  <p className="text-lg font-semibold" style={{ color: toHex({ ...c, a: 1 }) }}>
                    Sample text Aa
                  </p>
                  <p className="mt-1 font-mono text-xs" style={{ color: bg === white ? "#57544a" : "#a9a496" }}>
                    {label} · {r.toFixed(2)}:1 · {grade(r)}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        input.trim() && <Notice tone="warning">That isn&apos;t a colour we can read. Try #1a73e8, rgb(26, 115, 232) or hsl(214, 82%, 51%).</Notice>
      )}
    </>
  );
}

function CaseUtil() {
  const [input, setInput] = useState("Convert any file to any format");
  const w = words(input);
  return (
    <>
      <Editor value={input} onChange={setInput} name="input.txt" rows={4} spellCheck />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line @lg:grid-cols-4">
        {[
          ["Characters", input.length],
          ["Words", input.trim() ? input.trim().split(/\s+/).length : 0],
          ["Lines", input ? input.split("\n").length : 0],
          ["Bytes (UTF-8)", utf8(input).length],
        ].map(([label, n]) => (
          <div key={label} className="bg-surface px-3 py-2.5">
            <p className="label-mono text-ink-3">{label}</p>
            <motion.p key={String(n)} initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }} className="mt-1 font-mono text-lg text-ink">
              {Number(n).toLocaleString("en")}
            </motion.p>
          </div>
        ))}
      </div>
      <ValueList>
        {CASES.map((c) => (
          <ValueRow key={c.id} label={c.label} value={w.length || c.id === "lower" || c.id === "upper" ? c.fn(input) : ""} />
        ))}
      </ValueList>
    </>
  );
}

function UuidUtil() {
  const [kind, setKind] = useState<"v4" | "v7" | "nano">("v4");
  const [count, setCount] = useState(5);
  const [upper, setUpper] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const make = (k = kind, n = count) => Array.from({ length: n }, () => (k === "v4" ? uuidV4() : k === "v7" ? uuidV7() : nanoid()));
  const [ids, setIds] = useState<string[]>(() => make());
  const shown = ids.map((id) => {
    let v = kind === "nano" || hyphens ? id : id.replace(/-/g, "");
    if (upper && kind !== "nano") v = v.toUpperCase();
    return v;
  });
  return (
    <>
      <Panel>
        <Row label="Kind">
          <Chips value={kind} onChange={(k) => (setKind(k), setIds(make(k)))} options={[{ value: "v4", label: "UUID v4 · random" }, { value: "v7", label: "UUID v7 · time-ordered" }, { value: "nano", label: "Nano ID" }]} />
          <p className="mt-2 text-xs text-ink-3">
            {kind === "v7" ? "Sorts by creation time: the better choice for database keys." : kind === "nano" ? "21 URL-safe characters, as unique as a UUID and shorter." : "122 random bits: the everyday unique ID."}
          </p>
        </Row>
        <Row label="How many">
          <Slider value={count} min={1} max={100} onChange={(n) => (setCount(n), setIds(make(kind, n)))} label="How many" />
        </Row>
        {kind !== "nano" && (
          <Row label="Format">
            <div className="space-y-2.5">
              <Toggle checked={upper} onChange={setUpper} label="UPPER CASE" />
              <Toggle checked={hyphens} onChange={setHyphens} label="With hyphens" />
            </div>
          </Row>
        )}
      </Panel>
      <div className="flex justify-end">
        <RegenerateButton onClick={() => setIds(make())} />
      </div>
      <Output value={shown.join("\n")} name={`${kind}.txt`} lang={`${shown.length} ID${shown.length === 1 ? "" : "s"}`} download="ids.txt" wrap={false} />
    </>
  );
}

function PasswordUtil() {
  const [o, setO] = useState<PasswordOptions>({ length: 20, lower: true, upper: true, digits: true, symbols: true, noLookalikes: true });
  const [pw, setPw] = useState(() => password(o));
  const set = (patch: Partial<PasswordOptions>) => {
    const next = { ...o, ...patch };
    setO(next);
    setPw(password(next));
  };
  const bits = entropyBits(o);
  const strength = bits >= 100 ? "Very strong" : bits >= 70 ? "Strong" : bits >= 50 ? "Fair" : "Weak";
  return (
    <>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex items-center gap-2 px-3 py-3">
          <Lock aria-hidden className="size-4 shrink-0 text-ink-3" />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.output
              key={pw}
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="min-w-0 flex-1 break-all font-mono text-[17px] tracking-[0.02em] text-ink"
            >
              {pw || "Pick at least one kind of character."}
            </motion.output>
          </AnimatePresence>
          <RegenerateButton onClick={() => setPw(password(o))} compact />
          <CopyButton text={pw} />
        </div>
        <div className="h-1 bg-paper-2" aria-hidden>
          <motion.div
            className={cn("h-full", bits >= 70 ? "bg-success" : bits >= 50 ? "bg-warning" : "bg-danger")}
            animate={{ width: `${Math.min(100, (bits / 128) * 100)}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 30 }}
          />
        </div>
        <p className="flex justify-between bg-paper px-3 py-1 font-mono text-[11px] text-ink-3">
          <span>{strength}</span>
          <span>≈ {bits} bits of entropy</span>
        </p>
      </div>
      <Panel>
        <Row label="Length">
          <Slider value={o.length} min={8} max={128} onChange={(length) => set({ length })} label="Length" />
        </Row>
        <Row label="Use">
          <div className="grid gap-2.5 @lg:grid-cols-2">
            <Toggle checked={o.lower} onChange={(lower) => set({ lower })} label="Lower case (a–z)" />
            <Toggle checked={o.upper} onChange={(upper) => set({ upper })} label="Upper case (A–Z)" />
            <Toggle checked={o.digits} onChange={(digits) => set({ digits })} label="Digits (0–9)" />
            <Toggle checked={o.symbols} onChange={(symbols) => set({ symbols })} label="Symbols (!@#…)" />
            <Toggle checked={o.noLookalikes} onChange={(noLookalikes) => set({ noLookalikes })} label="No look-alikes (I l 1 O 0 o)" />
          </div>
        </Row>
      </Panel>
    </>
  );
}

function RegenerateButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  const [turns, setTurns] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setTurns((t) => t + 1);
        onClick();
      }}
      aria-label="Make new ones"
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink", compact && "px-2")}
    >
      <motion.span animate={{ rotate: turns * 180 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} className="inline-flex">
        <RefreshCw aria-hidden className="size-3.5" />
      </motion.span>
      {!compact && "New"}
    </button>
  );
}
