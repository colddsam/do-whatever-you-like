"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Camera, CameraOff, Download, ExternalLink, Eye, EyeOff, Lock, MapPin, RefreshCw, Unlock } from "lucide-react";
import { password as makePassword, type PasswordOptions } from "@/lib/dev";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { stripMetadata } from "@/lib/metadata";
import { zipFiles } from "@/lib/video";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor } from "../dev/parts";
import type { EngineProps } from "./text-engines";

const randInt = (n: number) => {
  const limit = Math.floor(2 ** 32 / n) * n;
  const b = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < limit) return b[0] % n;
  }
};

/* ================= Passwords, passphrases, strength ================= */

const COMMON = new Set(
  "123456 password 123456789 12345678 12345 qwerty 1234567 111111 1234567890 123123 abc123 1234 password1 iloveyou 1q2w3e4r 000000 qwerty123 zaq12wsx dragon sunshine princess letmein 654321 monkey 27653 1qaz2wsx 123321 qwertyuiop superman asdfghjkl trustno1 welcome admin login football baseball master shadow michael 666666 123qwe 7777777 121212 hello charlie donald freedom whatever qazwsx batman starwars passw0rd password123 india123 qwerty12 aa123456 abcd1234".split(" "),
);
const KEYBOARD = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "1qaz2wsx3edc", "qazwsxedc"];

/** An honest estimate: brute-force space, cut down for the patterns attackers try first. */
function strength(pw: string, words: Set<string> | null) {
  const notes: string[] = [];
  if (!pw) return { bits: 0, notes, label: "", score: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(Math.max(pool, 2));
  const low = pw.toLowerCase();
  if (COMMON.has(low) || COMMON.has(low.replace(/[!@#$.]+$/, ""))) {
    bits = Math.min(bits, 10);
    notes.push("This is one of the most common passwords: it's tried first.");
  }
  if (KEYBOARD.some((k) => [...Array(Math.max(0, low.length - 3))].some((_, i) => k.includes(low.slice(i, i + 4))))) {
    bits *= 0.6;
    notes.push("It contains a keyboard run (like qwer or 1234).");
  }
  if (/(.)\1{2,}/.test(pw)) {
    bits *= 0.75;
    notes.push("It repeats a character three or more times.");
  }
  if (/(19|20)\d{2}/.test(pw)) {
    bits -= 6;
    notes.push("It contains a year, which attackers guess (birthdays, anniversaries).");
  }
  if (words) {
    const found = (low.match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w));
    if (found.length && found.join("").length >= low.replace(/[^a-z]/g, "").length * 0.8 && found.length < 4) {
      bits = Math.min(bits, found.length * 13 + (pw.length - found.join("").length) * 4 + 6);
      notes.push(`It's mostly dictionary words (${found.slice(0, 3).join(", ")}): guessed by word, not letter.`);
    }
  }
  if (pw.length < 12) notes.push("Use at least 12 characters (16 or more is better).");
  bits = Math.max(0, Math.round(bits));
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, notes, label: ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score], score };
}
/** Offline attack at 10 billion guesses a second (a modern GPU rig against a fast hash). */
function crackTime(bits: number) {
  const s = 2 ** bits / 2 / 1e10;
  if (s < 1) return "instantly";
  const units: [number, string][] = [[31557600 * 1e9, "billion years"], [31557600 * 1e6, "million years"], [31557600 * 1000, "thousand years"], [31557600, "years"], [86400 * 30, "months"], [86400, "days"], [3600, "hours"], [60, "minutes"], [1, "seconds"]];
  for (const [u, name] of units) if (s >= u) return `${Math.round(s / u).toLocaleString("en")} ${name}`;
  return "seconds";
}

function Meter({ bits }: { bits: number }) {
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.span key={i} className={cn("h-2 flex-1 rounded-full", i <= score ? (score <= 1 ? "bg-danger" : score === 2 ? "bg-warning" : "bg-success") : "bg-paper-2")} initial={false} animate={{ opacity: i <= score ? 1 : 0.5 }} />
        ))}
      </div>
      <p className="font-mono text-[12px] text-ink-3">
        {["Very weak", "Weak", "Fair", "Strong", "Very strong"][score]} · {bits} bits · cracked offline in about {crackTime(bits)}
      </p>
    </div>
  );
}

function Big({ value, onAgain }: { value: string; onAgain: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-4">
      <p className="min-w-0 flex-1 break-all font-mono text-xl text-ink">{value || "…"}</p>
      <CopyButton text={value} />
      <button type="button" onClick={onAgain} aria-label="Make another" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:border-ink-3 hover:text-ink">
        <RefreshCw aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function PasswordEngine({ preset }: EngineProps) {
  const [mode, setMode] = useState<"password" | "passphrase" | "check">((preset.mode as "password") ?? "password");
  const [o, setO] = useState<PasswordOptions>({ length: 20, lower: true, upper: true, digits: true, symbols: true, noLookalikes: false });
  const [words, setWords] = useState<string[] | null>(null);
  const [count, setCount] = useState(6);
  const [sep, setSep] = useState("-");
  const [caps, setCaps] = useState(true);
  const [digit, setDigit] = useState(true);
  const [seed, setSeed] = useState(0);
  const [check, setCheck] = useState("");
  const [show, setShow] = useState(true);

  useEffect(() => {
    void import("@/lib/utilities/eff-wordlist").then((m) => setWords(m.EFF_WORDS));
  }, []);
  const wordSet = useMemo(() => (words ? new Set(words) : null), [words]);

  const pw = useMemo(() => (void seed, makePassword(o)), [o, seed]);
  const phrase = useMemo(() => {
    void seed;
    if (!words) return "";
    const list = Array.from({ length: count }, () => words[randInt(words.length)]).map((w) => (caps ? w[0].toUpperCase() + w.slice(1) : w));
    if (digit) list[randInt(list.length)] += String(randInt(10));
    return list.join(sep);
  }, [words, count, sep, caps, digit, seed]);
  const phraseBits = Math.round(count * Math.log2(7776) + (digit ? Math.log2(10 * count) : 0));
  const pwBits = Math.round(o.length * Math.log2(Math.max(2, (o.lower ? 26 : 0) + (o.upper ? 26 : 0) + (o.digits ? 10 : 0) + (o.symbols ? 25 : 0) - (o.noLookalikes ? 6 : 0))));
  const checked = strength(check, wordSet);

  return (
    <>
      <Panel>
        <Row label="Make">
          <Chips value={mode} options={[{ value: "password", label: "Password" }, { value: "passphrase", label: "Passphrase" }, { value: "check", label: "Check my password" }]} onChange={setMode} label="Mode" />
        </Row>
        {mode === "password" && (
          <>
            <Row label="Length">
              <Slider label="Length" value={o.length} min={8} max={64} onChange={(v) => setO((x) => ({ ...x, length: v }))} />
            </Row>
            <Row label="Characters">
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Toggle checked={o.lower} onChange={(v) => setO((x) => ({ ...x, lower: v }))} label="a–z" />
                <Toggle checked={o.upper} onChange={(v) => setO((x) => ({ ...x, upper: v }))} label="A–Z" />
                <Toggle checked={o.digits} onChange={(v) => setO((x) => ({ ...x, digits: v }))} label="0–9" />
                <Toggle checked={o.symbols} onChange={(v) => setO((x) => ({ ...x, symbols: v }))} label="Symbols" />
                <Toggle checked={o.noLookalikes} onChange={(v) => setO((x) => ({ ...x, noLookalikes: v }))} label="No look-alikes (Il1O0)" />
              </div>
            </Row>
          </>
        )}
        {mode === "passphrase" && (
          <>
            <Row label="Words">
              <Slider label="Words" value={count} min={3} max={12} onChange={setCount} />
            </Row>
            <Row label="Style">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Chips value={sep} options={["-", ".", "_", " ", ""].map((s) => ({ value: s, label: s === " " ? "space" : s === "" ? "none" : s }))} onChange={setSep} label="Separator" />
                <Toggle checked={caps} onChange={setCaps} label="Capitalise" />
                <Toggle checked={digit} onChange={setDigit} label="Add a digit" />
              </div>
            </Row>
          </>
        )}
      </Panel>
      {mode === "password" && (
        <>
          <Big value={pw} onAgain={() => setSeed((x) => x + 1)} />
          <Meter bits={pwBits} />
        </>
      )}
      {mode === "passphrase" && (
        <>
          <Big value={phrase} onAgain={() => setSeed((x) => x + 1)} />
          <Meter bits={phraseBits} />
          <Notice>Passphrases are random words from the EFF&apos;s 7,776-word list (CC BY 3.0): easy to type and remember, and every word adds about 12.9 bits.</Notice>
        </>
      )}
      {mode === "check" && (
        <>
          <div className="relative">
            <TextField label="Password to check" value={check} onChange={setCheck} type={show ? "text" : "password"} placeholder="Type a password: it never leaves this page" mono autoComplete="off" />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide" : "Show"} className="absolute right-1 top-1 inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink">
              {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </div>
          {check && (
            <>
              <Meter bits={checked.bits} />
              {checked.notes.length > 0 ? (
                <ul className="grid gap-1.5">
                  {checked.notes.map((n) => (
                    <li key={n} className="text-sm text-ink-2">
                      • {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-success">No obvious weaknesses found.</p>
              )}
            </>
          )}
          <Notice>Checked on this page only: nothing you type is sent anywhere or stored. Still, never reuse a password across sites.</Notice>
        </>
      )}
    </>
  );
}

/* ================= Encrypted notes (AES-256-GCM) ================= */

const ITER = 600_000;
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function key(pass: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
/** "dw1." + base64url(salt 16 | iv 12 | ciphertext+tag). */
async function encrypt(text: string, pass: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(pass, salt, ITER), new TextEncoder().encode(text)));
  const all = new Uint8Array(28 + ct.length);
  all.set(salt);
  all.set(iv, 16);
  all.set(ct, 28);
  return `dw1.${b64url(all)}`;
}
async function decrypt(blob: string, pass: string) {
  const s = blob.trim().replace(/^.*#/, "");
  if (!s.startsWith("dw1.")) throw new Error("That isn't an encrypted note from this tool (it should start with dw1.).");
  const all = unb64url(s.slice(4));
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(16, 28) }, await key(pass, all.slice(0, 16), ITER), all.slice(28));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("Wrong password, or the text was changed or cut short.");
  }
}

export function EncryptEngine() {
  const [mode, setMode] = useState<"encrypt" | "decrypt">("encrypt");
  const [text, setText] = useState("");
  const [pass, setPass] = useState("");
  const [out, setOut] = useState<{ value: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(true);

  // Opened from a share link: the note is in the #fragment, which browsers never send to a server.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h.startsWith("dw1.")) {
      queueMicrotask(() => {
        setMode("decrypt");
        setText(h);
      });
    }
  }, []);

  const run = async () => {
    setBusy(true);
    setOut(null);
    try {
      if (mode === "encrypt") {
        const c = await encrypt(text, pass);
        setOut({ value: link ? `${window.location.origin}${window.location.pathname}#${c}` : c });
      } else setOut({ value: await decrypt(text, pass) });
    } catch (e) {
      setOut({ value: "", error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const weak = mode === "encrypt" && pass.length > 0 && pass.length < 10;
  return (
    <>
      <Panel>
        <Row label="Do">
          <Chips value={mode} options={[{ value: "encrypt", label: "Encrypt a note" }, { value: "decrypt", label: "Decrypt a note" }]} onChange={(m) => (setMode(m), setOut(null))} label="Mode" />
        </Row>
      </Panel>
      <Editor value={text} onChange={setText} name={mode === "encrypt" ? "secret note" : "encrypted note or link"} rows={6} spellCheck={mode === "encrypt"} placeholder={mode === "encrypt" ? "Type the private text…" : "Paste the dw1.… text, or the whole link"} />
      <Panel>
        <Row label="Password" hint="Share it separately (a call, another app)">
          <TextField label="Password" value={pass} onChange={setPass} type="password" autoComplete="new-password" invalid={weak} />
          {weak && <p className="mt-1.5 text-xs text-warning">Use 10 or more characters; a short password can be guessed offline.</p>}
        </Row>
        {mode === "encrypt" && (
          <Row label="Share as">
            <Toggle checked={link} onChange={setLink} label="A link" description="The encrypted note goes after # in the link, a part browsers never send to any server." />
          </Row>
        )}
      </Panel>
      <button type="button" onClick={run} disabled={busy || !text.trim() || !pass} className="inline-flex h-11 w-fit items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-40">
        {mode === "encrypt" ? <Lock aria-hidden className="size-4" /> : <Unlock aria-hidden className="size-4" />}
        {busy ? "Working…" : mode === "encrypt" ? "Encrypt" : "Decrypt"}
      </button>
      {out?.error && <Notice tone="danger">{out.error}</Notice>}
      {out && !out.error && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-md border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1.5">
            <span className="font-mono text-[12px] text-ink">{mode === "encrypt" ? (link ? "share link" : "encrypted note") : "your note"}</span>
            <CopyButton text={out.value} />
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[13px] text-ink" data-lenis-prevent>
            {out.value}
          </pre>
        </motion.div>
      )}
      <Notice>AES-256-GCM with a key made from your password (PBKDF2-SHA-256, 600,000 rounds), all in your browser. Without the password the note can&apos;t be read, by anyone, including us.</Notice>
    </>
  );
}

/* ================= QR scanner ================= */

type Decoded = { text: string; kind: string; action?: { label: string; href: string } };

function describe(text: string): Decoded {
  if (/^https?:\/\//i.test(text)) return { text, kind: "Link", action: { label: "Open the link", href: text } };
  if (/^WIFI:/i.test(text)) {
    const f = (k: string) => new RegExp(`${k}:((?:\\\\.|[^;])*)`, "i").exec(text)?.[1]?.replace(/\\(.)/g, "$1") ?? "";
    return { text: `Network: ${f("S")}\nPassword: ${f("P") || "(none)"}\nSecurity: ${f("T") || "open"}`, kind: "Wi-Fi" };
  }
  if (/^BEGIN:VCARD/i.test(text)) return { text, kind: "Contact (vCard)" };
  if (/^mailto:/i.test(text)) return { text, kind: "Email", action: { label: "Write the email", href: text } };
  if (/^tel:/i.test(text)) return { text, kind: "Phone number", action: { label: "Call", href: text } };
  if (/^geo:/i.test(text)) {
    const [lat, lon] = text.slice(4).split(/[,;?]/);
    return { text, kind: "Location", action: { label: "Show on a map", href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}` } };
  }
  if (/^SMSTO:/i.test(text)) return { text, kind: "Text message" };
  if (/^BEGIN:VEVENT|^BEGIN:VCALENDAR/i.test(text)) return { text, kind: "Calendar event" };
  return { text, kind: "Text" };
}

async function decodeCanvas(c: HTMLCanvasElement): Promise<string | null> {
  const jsQR = (await import("jsqr")).default;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const { data } = g.getImageData(0, 0, c.width, c.height);
  return jsQR(data, c.width, c.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

export function QrScanEngine() {
  const [result, setResult] = useState<Decoded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cam, setCam] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCam(false);
  };
  useEffect(() => () => stop(), []);

  const fromFile = async (f: File) => {
    setError(null);
    setResult(null);
    try {
      const bmp = await createImageBitmap(f);
      // Try a few sizes: very large photos decode faster (and often better) scaled down.
      for (const max of [1200, 800, 2000, bmp.width]) {
        const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * k);
        c.height = Math.round(bmp.height * k);
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        const text = await decodeCanvas(c);
        if (text) return setResult(describe(text));
      }
      setError("No QR code found in that picture. Make sure the whole code is in view and sharp.");
    } catch {
      setError("That picture couldn't be opened.");
    }
  };
  const startCam = async () => {
    setError(null);
    setResult(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
      stream.current = s;
      setCam(true);
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      const c = document.createElement("canvas");
      let busy = false;
      const loop = async () => {
        if (!stream.current) return;
        if (!busy && v.videoWidth) {
          busy = true;
          const k = Math.min(1, 800 / v.videoWidth);
          c.width = Math.round(v.videoWidth * k);
          c.height = Math.round(v.videoHeight * k);
          c.getContext("2d", { willReadFrequently: true })!.drawImage(v, 0, 0, c.width, c.height);
          const text = await decodeCanvas(c);
          busy = false;
          if (text) {
            navigator.vibrate?.(60);
            setResult(describe(text));
            stop();
            return;
          }
        }
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
    } catch (e) {
      stop();
      const n = (e as DOMException).name;
      setError(n === "NotAllowedError" ? "Camera access was blocked. Allow it in the address bar and try again." : n === "NotFoundError" ? "No camera was found." : "The camera couldn't start.");
    }
  };

  return (
    <>
      <div
        className="grid gap-3 @2xl:grid-cols-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void fromFile(f);
        }}
        onPaste={(e) => {
          const f = [...e.clipboardData.files][0];
          if (f) void fromFile(f);
        }}
      >
        <button type="button" onClick={() => fileInput.current?.click()} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-ink-3/60 bg-paper px-4 text-center transition-colors hover:border-ink">
          <span className="text-sm font-medium text-ink">Choose, drop or paste a picture</span>
          <span className="font-mono text-[12px] text-ink-3">A screenshot or photo of a QR code</span>
        </button>
        <input ref={fileInput} type="file" accept="image/*" className="sr-only" onChange={(e) => (e.target.files?.[0] && void fromFile(e.target.files[0]), (e.target.value = ""))} />
        <div className="relative min-h-40 overflow-hidden rounded-md border border-line bg-ink">
          <video ref={video} muted playsInline className={cn("absolute inset-0 size-full object-cover", !cam && "hidden")} />
          {cam && <span aria-hidden className="absolute inset-[18%] rounded-lg border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />}
          <div className="relative flex h-full min-h-40 flex-col items-center justify-end gap-2 p-3">
            <button type="button" onClick={cam ? stop : startCam} className="inline-flex h-10 items-center gap-2 rounded-md bg-paper px-4 text-sm font-medium text-ink">
              {cam ? <CameraOff aria-hidden className="size-4" /> : <Camera aria-hidden className="size-4" />}
              {cam ? "Stop the camera" : "Scan with the camera"}
            </button>
          </div>
        </div>
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      {result && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-md border border-success/40 bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-success/10 px-3 py-2">
            <span className="text-sm font-medium text-success">✓ Found: {result.kind}</span>
            <CopyButton text={result.text} />
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-3 py-3 font-mono text-[14px] text-ink" data-lenis-prevent>
            {result.text}
          </pre>
          {result.action && (
            <div className="border-t border-line px-3 py-2">
              <a href={result.action.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline">
                {result.action.label} <ExternalLink aria-hidden className="size-3.5" />
              </a>
              {result.kind === "Link" && <p className="mt-1 text-xs text-ink-3">Check the address before opening: QR codes can point anywhere.</p>}
            </div>
          )}
        </motion.div>
      )}
      <Notice>Decoded in your browser: neither the picture nor the camera feed leaves your device.</Notice>
    </>
  );
}

/* ================= Photo metadata viewer & remover ================= */

type Meta = { file: File; tags: Record<string, unknown>; gps: { latitude: number; longitude: number } | null; orientation: number; clean?: { blob: Blob; removed: string[] }; error?: string };
const SHOW: [string, string][] = [
  ["Make", "Camera maker"], ["Model", "Camera"], ["LensModel", "Lens"], ["Software", "Software"], ["DateTimeOriginal", "Taken"], ["CreateDate", "Created"], ["ModifyDate", "Modified"],
  ["ExposureTime", "Shutter"], ["FNumber", "Aperture"], ["ISO", "ISO"], ["FocalLength", "Focal length"], ["Artist", "Artist"], ["Copyright", "Copyright"], ["ImageDescription", "Description"],
  ["OwnerName", "Owner"], ["SerialNumber", "Camera serial"], ["BodySerialNumber", "Body serial"], ["HostComputer", "Device"], ["creator", "Creator"], ["title", "Title"],
];
const show = (v: unknown) => (v instanceof Date ? v.toLocaleString("en-GB") : typeof v === "number" ? String(+v.toPrecision(6)) : Array.isArray(v) ? v.join(", ") : String(v));

export function ExifEngine() {
  const [items, setItems] = useState<Meta[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const add = async (files: File[]) => {
    setBusy(true);
    const exifr = (await import("exifr")).default;
    const out: Meta[] = [];
    for (const file of files.slice(0, 30)) {
      try {
        const tags = ((await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, ifd1: false, translateValues: true, mergeOutput: true })) ?? {}) as Record<string, unknown>;
        const gps = (await exifr.gps(file).catch(() => null)) as Meta["gps"];
        const orientation = Number((await exifr.orientation(file).catch(() => 1)) ?? 1) || 1;
        out.push({ file, tags, gps: gps && Number.isFinite(gps.latitude) ? gps : null, orientation });
      } catch {
        out.push({ file, tags: {}, gps: null, orientation: 1 });
      }
    }
    setItems((all) => [...all, ...out]);
    setBusy(false);
  };

  const clean = async () => {
    setBusy(true);
    const next: Meta[] = [];
    for (const m of items) {
      const bytes = new Uint8Array(await m.file.arrayBuffer());
      const r = stripMetadata(bytes, m.orientation);
      if (r) next.push({ ...m, clean: { blob: new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: m.file.type || "image/jpeg" }), removed: r.removed } });
      else next.push({ ...m, error: "Only JPEG, PNG and WebP can be cleaned without re-saving. Convert it to JPG first." });
    }
    setItems(next);
    setBusy(false);
  };
  const cleaned = items.filter((m) => m.clean);
  const download = async () => {
    if (cleaned.length === 1) return saveBlob(cleaned[0].clean!.blob, cleaned[0].file.name.replace(/(\.[^.]+)$/, "-clean$1"));
    saveBlob(await zipFiles(cleaned.map((m) => ({ name: m.file.name.replace(/(\.[^.]+)$/, "-clean$1"), blob: m.clean!.blob }))), "photos-without-metadata.zip");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => (e.preventDefault(), void add([...e.dataTransfer.files]))}
        className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-ink-3/60 bg-paper px-4 text-center transition-colors hover:border-ink"
      >
        <span className="text-sm font-medium text-ink">{busy ? "Reading…" : items.length ? "Add more photos" : "Choose or drop photos"}</span>
        <span className="font-mono text-[12px] text-ink-3">JPG · PNG · WebP (HEIC and TIFF can be read) · up to 30</span>
      </button>
      <input ref={fileInput} type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ""))} />

      {items.map((m, i) => {
        const rows = SHOW.filter(([k]) => m.tags[k] !== undefined && m.tags[k] !== "");
        const count = Object.keys(m.tags).length;
        return (
          <section key={i} className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-3 py-2">
              <p className="min-w-0 truncate text-sm font-medium text-ink">
                {m.file.name} <span className="font-mono text-[12px] font-normal text-ink-3">· {formatBytes(m.file.size)} · {count} metadata fields</span>
              </p>
              {m.gps ? <span className="rounded-sm bg-danger/10 px-2 py-0.5 font-mono text-[12px] text-danger">GPS location inside</span> : count ? <span className="rounded-sm bg-warning/10 px-2 py-0.5 font-mono text-[12px] text-warning">has metadata</span> : <span className="rounded-sm bg-success/10 px-2 py-0.5 font-mono text-[12px] text-success">clean</span>}
            </div>
            {m.gps && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
                <MapPin aria-hidden className="size-4 text-danger" />
                <span className="font-mono text-ink">
                  {m.gps.latitude.toFixed(5)}, {m.gps.longitude.toFixed(5)}
                </span>
                <a href={`https://www.openstreetmap.org/?mlat=${m.gps.latitude}&mlon=${m.gps.longitude}#map=15/${m.gps.latitude}/${m.gps.longitude}`} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                  See where it was taken ↗
                </a>
              </div>
            )}
            {rows.length > 0 && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 py-2 text-[13px]">
                {rows.map(([k, label]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-3">{label}</dt>
                    <dd className="truncate font-mono text-ink">{show(m.tags[k])}</dd>
                  </div>
                ))}
              </dl>
            )}
            {m.clean && <p className="border-t border-line bg-success/5 px-3 py-2 text-sm text-success">✓ Removed: {m.clean.removed.length ? m.clean.removed.join(", ") : "nothing to remove"} · {formatBytes(m.clean.blob.size)}</p>}
            {m.error && <p className="border-t border-line px-3 py-2 text-sm text-warning">{m.error}</p>}
          </section>
        );
      })}

      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {!cleaned.length ? (
            <button type="button" onClick={clean} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
              Remove the metadata
            </button>
          ) : (
            <button type="button" onClick={download} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper hover:opacity-90">
              <Download aria-hidden className="size-4" /> Download {cleaned.length === 1 ? "the clean photo" : `${cleaned.length} clean photos (ZIP)`}
            </button>
          )}
          <button type="button" onClick={() => setItems([])} className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm text-ink hover:border-ink-3">
            Clear
          </button>
        </div>
      )}
      <Notice>Lossless: the picture itself is copied as it is; only the metadata (GPS, camera, dates, names, XMP, IPTC) is dropped. The colour profile and the photo&apos;s rotation are kept. Everything happens in your browser.</Notice>
    </>
  );
}
