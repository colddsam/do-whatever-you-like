"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { ArrowUpDown, Pause, Play, Plus, RotateCcw, Timer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton, ValueList, ValueRow } from "../dev/parts";
import type { EngineProps } from "./text-engines";

/* ================= Units & currency ================= */

type Unit = { id: string; label: string; to: (v: number) => number; from: (v: number) => number };
const lin = (id: string, label: string, factor: number): Unit => ({ id, label, to: (v) => v * factor, from: (v) => v / factor });

/** Every unit as a factor to the category's base unit (or a function, for temperature and fuel). */
const UNITS: Record<string, { label: string; units: Unit[] }> = {
  length: { label: "Length", units: [lin("mm", "Millimetre", 0.001), lin("cm", "Centimetre", 0.01), lin("m", "Metre", 1), lin("km", "Kilometre", 1000), lin("in", "Inch", 0.0254), lin("ft", "Foot", 0.3048), lin("yd", "Yard", 0.9144), lin("mi", "Mile", 1609.344), lin("nmi", "Nautical mile", 1852)] },
  weight: { label: "Weight", units: [lin("mg", "Milligram", 1e-6), lin("g", "Gram", 0.001), lin("kg", "Kilogram", 1), lin("t", "Tonne", 1000), lin("oz", "Ounce", 0.028349523125), lin("lb", "Pound", 0.45359237), lin("st", "Stone", 6.35029318), lin("ct", "Carat", 0.0002)] },
  temperature: {
    label: "Temperature",
    units: [
      { id: "c", label: "Celsius", to: (v) => v, from: (v) => v },
      { id: "f", label: "Fahrenheit", to: (v) => ((v - 32) * 5) / 9, from: (v) => (v * 9) / 5 + 32 },
      { id: "k", label: "Kelvin", to: (v) => v - 273.15, from: (v) => v + 273.15 },
    ],
  },
  area: { label: "Area", units: [lin("cm2", "Square centimetre", 1e-4), lin("m2", "Square metre", 1), lin("ha", "Hectare", 1e4), lin("km2", "Square kilometre", 1e6), lin("in2", "Square inch", 0.00064516), lin("ft2", "Square foot", 0.09290304), lin("ac", "Acre", 4046.8564224), lin("mi2", "Square mile", 2589988.110336)] },
  volume: { label: "Volume", units: [lin("ml", "Millilitre", 0.001), lin("l", "Litre", 1), lin("m3", "Cubic metre", 1000), lin("tsp", "Teaspoon (US)", 0.00492892159375), lin("tbsp", "Tablespoon (US)", 0.01478676478125), lin("cup", "Cup (US)", 0.2365882365), lin("floz", "Fluid ounce (US)", 0.0295735295625), lin("gal", "Gallon (US)", 3.785411784), lin("galuk", "Gallon (UK)", 4.54609)] },
  speed: { label: "Speed", units: [lin("ms", "Metres a second", 1), lin("kmh", "Kilometres an hour", 1 / 3.6), lin("mph", "Miles an hour", 0.44704), lin("kn", "Knots", 0.514444), lin("fts", "Feet a second", 0.3048)] },
  data: {
    label: "Data",
    units: [lin("bit", "Bit", 1 / 8), lin("B", "Byte", 1), lin("KB", "Kilobyte (1000)", 1e3), lin("MB", "Megabyte (1000²)", 1e6), lin("GB", "Gigabyte (1000³)", 1e9), lin("TB", "Terabyte (1000⁴)", 1e12), lin("KiB", "Kibibyte (1024)", 1024), lin("MiB", "Mebibyte (1024²)", 1024 ** 2), lin("GiB", "Gibibyte (1024³)", 1024 ** 3), lin("TiB", "Tebibyte (1024⁴)", 1024 ** 4), lin("Mbit", "Megabit", 125000)],
  },
  time: { label: "Time", units: [lin("ms", "Millisecond", 0.001), lin("s", "Second", 1), lin("min", "Minute", 60), lin("h", "Hour", 3600), lin("d", "Day", 86400), lin("wk", "Week", 604800), lin("mo", "Month (avg)", 2629746), lin("yr", "Year (365.25 d)", 31557600)] },
  energy: { label: "Energy", units: [lin("j", "Joule", 1), lin("kj", "Kilojoule", 1000), lin("cal", "Calorie", 4.184), lin("kcal", "Kilocalorie", 4184), lin("wh", "Watt-hour", 3600), lin("kwh", "Kilowatt-hour", 3.6e6), lin("btu", "BTU", 1055.05585)] },
  pressure: { label: "Pressure", units: [lin("pa", "Pascal", 1), lin("kpa", "Kilopascal", 1000), lin("bar", "Bar", 1e5), lin("atm", "Atmosphere", 101325), lin("psi", "PSI", 6894.757293), lin("mmhg", "mmHg", 133.322387)] },
  angle: { label: "Angle", units: [lin("deg", "Degree", Math.PI / 180), lin("rad", "Radian", 1), lin("grad", "Gradian", Math.PI / 200), lin("turn", "Turn", 2 * Math.PI), lin("arcmin", "Arcminute", Math.PI / 10800)] },
  fuel: {
    label: "Fuel economy",
    units: [
      { id: "kml", label: "Kilometres per litre", to: (v) => v, from: (v) => v },
      { id: "l100", label: "Litres per 100 km", to: (v) => (v ? 100 / v : Infinity), from: (v) => (v ? 100 / v : Infinity) },
      { id: "mpg", label: "Miles per gallon (US)", to: (v) => v * 0.425143707, from: (v) => v / 0.425143707 },
      { id: "mpguk", label: "Miles per gallon (UK)", to: (v) => v * 0.354006189, from: (v) => v / 0.354006189 },
    ],
  },
};

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) return n.toExponential(6).replace(/\.?0+e/, "e");
  return Number(n.toPrecision(12)).toLocaleString("en", { maximumFractionDigits: 10 });
};

export function UnitEngine({ preset }: EngineProps) {
  const [cat, setCat] = useState<string>(preset.cat ?? "length");
  const [value, setValue] = useState("1");
  const [unit, setUnit] = useState(UNITS[preset.cat ?? "length"]?.units[2]?.id ?? "m");
  if (cat === "currency") return <CurrencyEngine onBack={(c) => setCat(c)} />;
  const group = UNITS[cat];
  const from = group.units.find((u) => u.id === unit) ?? group.units[0];
  const v = Number(value.replace(/,/g, ""));
  const base = Number.isFinite(v) ? from.to(v) : NaN;
  return (
    <>
      <Panel>
        <Row label="Convert">
          <Chips value={cat} options={[...Object.entries(UNITS).map(([id, g]) => ({ value: id, label: g.label })), { value: "currency", label: "Currency (live)" }]} onChange={(c) => (setCat(c), c !== "currency" && setUnit(UNITS[c].units[Math.min(1, UNITS[c].units.length - 1)].id))} label="Category" />
        </Row>
        <Row label="Value">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <TextField label="Value" value={value} onChange={setValue} mono inputMode="decimal" invalid={!Number.isFinite(v)} />
            </div>
            <select value={from.id} onChange={(e) => setUnit(e.target.value)} aria-label="From unit" className="h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-ink">
              {group.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        </Row>
      </Panel>
      <ValueList>
        {group.units.map((u) => (
          <ValueRow key={u.id} label={u.id} value={Number.isFinite(base) ? fmt(u.from(base)) : ""} highlight={u.id === from.id} note={u.label} />
        ))}
      </ValueList>
      {cat === "data" && <Notice>Storage makers count in thousands (1 GB = 1,000,000,000 bytes); Windows counts in 1024s and calls them GB (really GiB). That&apos;s why a “1 TB” drive shows as 931 GB.</Notice>}
    </>
  );
}

type Rates = { base: string; date: string; rates: Record<string, number> };
const POPULAR = ["USD", "EUR", "GBP", "INR", "JPY", "CNY", "AUD", "CAD", "CHF", "SGD", "AED"];

function CurrencyEngine({ onBack }: { onBack: (cat: string) => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("INR");
  useEffect(() => {
    void fetch("https://api.frankfurter.dev/v1/currencies")
      .then((r) => r.json())
      .then(setNames)
      .catch(() => setError("Exchange rates couldn't be loaded. Check your connection."));
  }, []);
  useEffect(() => {
    let live = true;
    void fetch(`https://api.frankfurter.dev/v1/latest?base=${from}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Rates) => live && (setRates(d), setError(null)))
      .catch(() => live && setError("Exchange rates couldn't be loaded. Check your connection."));
    return () => {
      live = false;
    };
  }, [from]);
  const a = Number(amount.replace(/,/g, ""));
  const rate = rates && (to === from ? 1 : rates.rates[to]);
  const codes = Object.keys(names).sort();
  const money = (n: number, code: string) => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `${n.toFixed(2)} ${code}`;
    }
  };
  const select = (value: string, set: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-ink">
      {(codes.length ? codes : POPULAR).map((c) => (
        <option key={c} value={c}>
          {c} {names[c] ? `· ${names[c]}` : ""}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <Panel>
        <Row label="Convert">
          <Chips value="currency" options={[...Object.entries(UNITS).map(([id, g]) => ({ value: id, label: g.label })), { value: "currency", label: "Currency (live)" }]} onChange={onBack} label="Category" />
        </Row>
        <Row label="Amount">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-40">
                <TextField label="Amount" value={amount} onChange={setAmount} mono inputMode="decimal" invalid={!Number.isFinite(a)} />
              </div>
              {select(from, setFrom, "From currency")}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => (setFrom(to), setTo(from))} aria-label="Swap currencies" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink">
                <ArrowUpDown aria-hidden className="size-4" />
              </button>
              {select(to, setTo, "To currency")}
            </div>
          </div>
        </Row>
      </Panel>
      {error && <Notice tone="warning">{error}</Notice>}
      {rate && Number.isFinite(a) && (
        <motion.div key={`${from}${to}${rates?.date}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-line bg-surface px-5 py-5">
          <p className="text-sm text-ink-2">{money(a, from)} =</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p className="font-mono text-3xl font-semibold tracking-tight text-ink">{money(a * rate, to)}</p>
            <CopyButton text={(a * rate).toFixed(2)} />
          </div>
          <p className="mt-2 font-mono text-[12px] text-ink-3">
            1 {from} = {fmt(rate)} {to} · 1 {to} = {fmt(1 / rate)} {from} · rates of {rates?.date}
          </p>
        </motion.div>
      )}
      {rates && (
        <ValueList>
          {POPULAR.filter((c) => c !== from && (rates.rates[c] || c === from)).map((c) => (
            <ValueRow key={c} label={c} value={Number.isFinite(a) ? money(a * rates.rates[c], c) : ""} note={names[c]} />
          ))}
        </ValueList>
      )}
      <Notice>Daily reference rates from the European Central Bank (via Frankfurter), updated each working day around 16:00 CET. Banks and card networks add their own margin.</Notice>
    </>
  );
}

/* ================= World clock & timezone converter ================= */

const CITIES: [string, string][] = [
  ["Kolkata", "Asia/Kolkata"], ["London", "Europe/London"], ["New York", "America/New_York"], ["San Francisco", "America/Los_Angeles"], ["Tokyo", "Asia/Tokyo"],
  ["Sydney", "Australia/Sydney"], ["Dubai", "Asia/Dubai"], ["Singapore", "Asia/Singapore"], ["Berlin", "Europe/Berlin"], ["Paris", "Europe/Paris"], ["São Paulo", "America/Sao_Paulo"],
  ["Chicago", "America/Chicago"], ["Toronto", "America/Toronto"], ["Mexico City", "America/Mexico_City"], ["Hong Kong", "Asia/Hong_Kong"], ["Shanghai", "Asia/Shanghai"], ["Seoul", "Asia/Seoul"],
  ["Jakarta", "Asia/Jakarta"], ["Dhaka", "Asia/Dhaka"], ["Karachi", "Asia/Karachi"], ["Lagos", "Africa/Lagos"], ["Nairobi", "Africa/Nairobi"], ["Cairo", "Africa/Cairo"], ["Moscow", "Europe/Moscow"],
  ["Istanbul", "Europe/Istanbul"], ["Auckland", "Pacific/Auckland"], ["Honolulu", "Pacific/Honolulu"], ["Anchorage", "America/Anchorage"], ["Denver", "America/Denver"], ["UTC", "UTC"],
];
const subscribeSecond = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};
const nowSecond = () => Math.floor(Date.now() / 1000);

function offsetMinutes(zone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}
/** A wall-clock time in `zone` → the real instant. */
function zonedToDate(dateStr: string, timeStr: string, zone: string) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const off = offsetMinutes(zone, guess);
  const first = new Date(guess.getTime() - off * 60000);
  return new Date(guess.getTime() - offsetMinutes(zone, first) * 60000);
}

export function WorldClockEngine() {
  const tick = useSyncExternalStore(subscribeSecond, nowSecond, () => 0);
  const local = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [zones, setZones] = useState<string[]>(() => [local, "Europe/London", "America/New_York", "Asia/Tokyo"].filter((z, i, a) => a.indexOf(z) === i));
  const [mode, setMode] = useState<"now" | "plan">("now");
  const [planZone, setPlanZone] = useState(local);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [planTime, setPlanTime] = useState("10:00");
  const [adding, setAdding] = useState("");
  const allZones = useMemo(() => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : CITIES.map((c) => c[1])), []);
  if (!tick) return null;
  const at = mode === "now" ? new Date(tick * 1000) : zonedToDate(planDate, planTime, planZone);
  const label = (z: string) => CITIES.find((c) => c[1] === z)?.[0] ?? z.split("/").pop()!.replace(/_/g, " ");
  const localOff = offsetMinutes(local, at);
  return (
    <>
      <Panel>
        <Row label="Show">
          <Chips value={mode} options={[{ value: "now", label: "Time now" }, { value: "plan", label: "Plan a meeting" }]} onChange={setMode} label="Show" />
        </Row>
        {mode === "plan" && (
          <Row label="When, where">
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} aria-label="Date" className="h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink" />
              <input type="time" value={planTime} onChange={(e) => setPlanTime(e.target.value)} aria-label="Time" className="h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink" />
              <span className="text-sm text-ink-2">in</span>
              <select value={planZone} onChange={(e) => setPlanZone(e.target.value)} aria-label="Time zone" className="h-11 max-w-56 rounded-md border border-line bg-surface px-3 text-sm text-ink">
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {label(z)}
                  </option>
                ))}
              </select>
            </div>
          </Row>
        )}
        <Row label="Add a city or zone">
          <div className="flex gap-2">
            <input list="tz-list" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Type a city or zone: Paris, Asia/Dhaka…" aria-label="Add a time zone" className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-ink" />
            <datalist id="tz-list">
              {CITIES.map(([n]) => <option key={n} value={n} />)}
              {allZones.map((z) => <option key={z} value={z} />)}
            </datalist>
            <button
              type="button"
              onClick={() => {
                const z = CITIES.find((c) => c[0].toLowerCase() === adding.trim().toLowerCase())?.[1] ?? allZones.find((x) => x.toLowerCase() === adding.trim().toLowerCase());
                if (z && !zones.includes(z)) setZones((all) => [...all, z]);
                setAdding("");
              }}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90"
            >
              <Plus aria-hidden className="size-4" /> Add
            </button>
          </div>
        </Row>
      </Panel>
      <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line @2xl:grid-cols-2">
        {zones.map((z) => {
          const off = offsetMinutes(z, at);
          const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "numeric", hour12: false }).format(at)) % 24;
          const work = hour >= 9 && hour < 18;
          const night = hour < 7 || hour >= 22;
          const diff = (off - localOff) / 60;
          return (
            <li key={z} className="relative bg-surface px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{label(z)}</p>
                  <p className="font-mono text-[12px] text-ink-3">
                    UTC{off >= 0 ? "+" : "−"}
                    {Math.floor(Math.abs(off) / 60)}
                    {Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, "0")}` : ""}
                    {z !== local && ` · ${diff === 0 ? "same as you" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} h`}`}
                    {z === local && " · you"}
                  </p>
                </div>
                {zones.length > 1 && (
                  <button type="button" onClick={() => setZones((all) => all.filter((x) => x !== z))} aria-label={`Remove ${label(z)}`} className="inline-flex size-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink">
                    <X aria-hidden className="size-4" />
                  </button>
                )}
              </div>
              <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight text-ink">
                {new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", second: mode === "now" ? "2-digit" : undefined }).format(at)}
              </p>
              <p className="flex items-center gap-2 text-sm text-ink-2">
                {new Intl.DateTimeFormat("en-GB", { timeZone: z, weekday: "short", day: "numeric", month: "short" }).format(at)}
                <span className={cn("rounded-sm px-1.5 py-0.5 font-mono text-[12px]", work ? "bg-success/10 text-success" : night ? "bg-ink/10 text-ink-2" : "bg-warning/10 text-warning")}>{work ? "working hours" : night ? "night" : "evening/morning"}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ================= Pomodoro, stopwatch, countdown ================= */

function beep(times = 3) {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.start(t);
      o.stop(t + 0.3);
    }
    setTimeout(() => void ctx.close(), times * 400 + 200);
  } catch {
    /* no audio */
  }
}
const clock = (ms: number, tenths = false) => {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const t = Math.floor(total / 100) % 10;
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${tenths ? `.${t}` : ""}`;
};
function useNow(running: boolean, every = 100) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [running, every]);
  return now;
}

export function TimerEngine({ preset }: EngineProps) {
  const [mode, setMode] = useState<"pomodoro" | "stopwatch" | "countdown">((preset.mode as "pomodoro") ?? "pomodoro");
  return (
    <>
      <Panel>
        <Row label="Timer">
          <Chips value={mode} options={[{ value: "pomodoro", label: "Pomodoro" }, { value: "stopwatch", label: "Stopwatch" }, { value: "countdown", label: "Countdown" }]} onChange={setMode} label="Timer" />
        </Row>
      </Panel>
      {mode === "pomodoro" ? <Pomodoro /> : mode === "stopwatch" ? <Stopwatch /> : <Countdown />}
    </>
  );
}

function Dial({ ms, total, label, accent }: { ms: number; total: number; label: string; accent?: boolean }) {
  const p = total ? 1 - ms / total : 0;
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="relative size-60">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--color-paper-2)" strokeWidth="5" />
          <motion.circle cx="50" cy="50" r="45" fill="none" stroke={accent ? "var(--color-accent)" : "var(--color-ink)"} strokeWidth="5" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" animate={{ strokeDashoffset: 1 - p }} transition={{ duration: 0.3 }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-mono text-5xl font-semibold tabular-nums tracking-tight text-ink" aria-live="off">
            {clock(Math.ceil(ms / 1000) * 1000)}
          </p>
          <p className="label-mono mt-1 text-ink-3">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Controls({ running, onToggle, onReset, extra }: { running: boolean; onToggle: () => void; onReset: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <button type="button" onClick={onToggle} className="inline-flex h-12 min-w-36 items-center justify-center gap-2 rounded-md bg-ink px-6 text-[15px] font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
        {running ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
        {running ? "Pause" : "Start"}
      </button>
      {extra}
      <button type="button" onClick={onReset} className="inline-flex h-12 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
        <RotateCcw aria-hidden className="size-4" /> Reset
      </button>
    </div>
  );
}

function notify(text: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(text);
  } catch {
    /* not available */
  }
}

function Pomodoro() {
  const [len, setLen] = useState({ focus: 25, short: 5, long: 15 });
  const [phase, setPhase] = useState<"focus" | "short" | "long">("focus");
  const [done, setDone] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(25 * 60_000);
  const [sound, setSound] = useState(true);
  const now = useNow(endsAt !== null, 250);
  const total = len[phase] * 60_000;
  const remaining = endsAt !== null ? endsAt - now : left;

  useEffect(() => {
    if (endsAt === null || remaining > 0) return;
    // Phase over: chime, and roll on to the next one (paused, so nothing starts behind your back).
    if (sound) beep();
    const next = phase === "focus" ? ((done + 1) % 4 === 0 ? "long" : "short") : "focus";
    notify(phase === "focus" ? "Focus done: time for a break." : "Break over: back to it.");
    queueMicrotask(() => {
      if (phase === "focus") setDone((d) => d + 1);
      setPhase(next);
      setEndsAt(null);
      setLeft(len[next] * 60_000);
    });
  }, [remaining, endsAt, phase, done, len, sound]);
  useEffect(() => {
    document.title = endsAt !== null ? `${clock(remaining)} · ${phase === "focus" ? "Focus" : "Break"}` : "Pomodoro timer · Do-Whatever-You-Like";
  }, [remaining, endsAt, phase]);
  useEffect(() => () => void (document.title = "Do-Whatever-You-Like"), []);

  const toggle = () => {
    if (endsAt !== null) {
      setLeft(endsAt - Date.now());
      setEndsAt(null);
    } else {
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      setEndsAt(Date.now() + left);
    }
  };
  const go = (p: typeof phase) => {
    setPhase(p);
    setEndsAt(null);
    setLeft(len[p] * 60_000);
  };
  return (
    <>
      <div className="flex justify-center">
        <Chips value={phase} options={[{ value: "focus", label: "Focus" }, { value: "short", label: "Short break" }, { value: "long", label: "Long break" }]} onChange={go} label="Phase" />
      </div>
      <Dial ms={remaining} total={total} label={phase === "focus" ? `Focus · ${done} done today` : "Break"} accent={phase === "focus"} />
      <Controls running={endsAt !== null} onToggle={toggle} onReset={() => go(phase)} extra={<button type="button" onClick={() => go(phase === "focus" ? "short" : "focus")} className="inline-flex h-12 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">Skip</button>} />
      <Panel>
        <Row label="Lengths (minutes)">
          <div className="grid gap-3 @xl:grid-cols-3">
            {(["focus", "short", "long"] as const).map((k) => (
              <Slider key={k} label={k} value={len[k]} min={1} max={k === "focus" ? 90 : 45} onChange={(v) => (setLen((l) => ({ ...l, [k]: v })), k === phase && endsAt === null && setLeft(v * 60_000))} format={(v) => `${v}`} />
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-3">Focus · short break · long break (every fourth). The page title shows the time left, so it works in a background tab.</p>
        </Row>
        <Row label="Alerts">
          <Toggle checked={sound} onChange={setSound} label="Chime when a phase ends" description="And a notification, if you allow it." />
        </Row>
      </Panel>
    </>
  );
}

function Stopwatch() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [kept, setKept] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const now = useNow(startedAt !== null, 47);
  const elapsed = kept + (startedAt !== null ? now - startedAt : 0);
  const toggle = () => {
    if (startedAt !== null) {
      setKept(kept + Date.now() - startedAt);
      setStartedAt(null);
    } else setStartedAt(Date.now());
  };
  return (
    <>
      <p className="py-6 text-center font-mono text-6xl font-semibold tabular-nums tracking-tight text-ink">{clock(elapsed, true)}</p>
      <Controls
        running={startedAt !== null}
        onToggle={toggle}
        onReset={() => (setStartedAt(null), setKept(0), setLaps([]))}
        extra={<button type="button" disabled={!elapsed} onClick={() => setLaps((l) => [elapsed, ...l])} className="inline-flex h-12 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40"><Timer aria-hidden className="size-4" /> Lap</button>}
      />
      {laps.length > 0 && (
        <ol className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface font-mono text-[13px]">
          {laps.map((t, i) => {
            const split = t - (laps[i + 1] ?? 0);
            const splits = laps.map((x, j) => x - (laps[j + 1] ?? 0));
            const best = laps.length > 1 && split === Math.min(...splits);
            const worst = laps.length > 1 && split === Math.max(...splits);
            return (
              <li key={t} className="flex justify-between px-3 py-2">
                <span className="text-ink-3">Lap {laps.length - i}</span>
                <span className={cn(best ? "text-success" : worst ? "text-danger" : "text-ink")}>{clock(split, true)}</span>
                <span className="text-ink-2">{clock(t, true)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function Countdown() {
  const [set, setSet] = useState({ h: "0", m: "10", s: "0" });
  const total = ((Number(set.h) || 0) * 3600 + (Number(set.m) || 0) * 60 + (Number(set.s) || 0)) * 1000;
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const fired = useRef(false);
  const now = useNow(endsAt !== null, 200);
  const remaining = endsAt !== null ? endsAt - now : (left ?? total);
  useEffect(() => {
    if (endsAt !== null && remaining <= 0 && !fired.current) {
      fired.current = true;
      beep(5);
      notify("Time's up!");
      queueMicrotask(() => (setEndsAt(null), setLeft(0)));
    }
  }, [remaining, endsAt]);
  const toggle = () => {
    if (endsAt !== null) {
      setLeft(endsAt - Date.now());
      setEndsAt(null);
    } else {
      fired.current = false;
      setEndsAt(Date.now() + (left && left > 0 ? left : total));
    }
  };
  return (
    <>
      {endsAt === null && left === null && (
        <div className="flex flex-wrap items-end justify-center gap-2">
          {(["h", "m", "s"] as const).map((k) => (
            <label key={k} className="grid gap-1 text-center">
              <span className="label-mono text-ink-3">{k === "h" ? "Hours" : k === "m" ? "Minutes" : "Seconds"}</span>
              <input value={set[k]} onChange={(e) => setSet((v) => ({ ...v, [k]: e.target.value.replace(/\D/g, "").slice(0, 3) }))} inputMode="numeric" className="h-14 w-20 rounded-md border border-line bg-surface text-center font-mono text-2xl text-ink outline-none focus:border-ink" />
            </label>
          ))}
          <div className="flex gap-1 pb-1">
            {[1, 5, 10, 15, 30].map((m) => (
              <button key={m} type="button" onClick={() => setSet({ h: "0", m: String(m), s: "0" })} className="rounded-[6px] bg-paper-2 px-2 py-1 font-mono text-[12px] text-ink-2 hover:text-ink">
                {m}m
              </button>
            ))}
          </div>
        </div>
      )}
      <Dial ms={remaining} total={total} label={remaining <= 0 && left === 0 ? "Time's up" : "Countdown"} accent={remaining <= 10_000} />
      <Controls running={endsAt !== null} onToggle={toggle} onReset={() => (setEndsAt(null), setLeft(null))} />
    </>
  );
}

/* ================= Date & age calculator ================= */

const DAY = 86_400_000;
const parseDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : NaN;
};
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const longDay = (t: number) => new Date(t).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Whole years, months and days between two days (calendar-exact). */
function ymd(a: number, b: number) {
  const [x, y] = a <= b ? [new Date(a), new Date(b)] : [new Date(b), new Date(a)];
  let years = y.getUTCFullYear() - x.getUTCFullYear();
  let months = y.getUTCMonth() - x.getUTCMonth();
  let days = y.getUTCDate() - x.getUTCDate();
  if (days < 0) {
    months--;
    days += new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  return { years, months, days };
}
function businessDays(a: number, b: number) {
  const [s, e] = a <= b ? [a, b] : [b, a];
  let n = 0;
  for (let t = s; t < e; t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
function addBusiness(t: number, n: number) {
  let left = Math.abs(n);
  const step = n >= 0 ? DAY : -DAY;
  let cur = t;
  while (left > 0) {
    cur += step;
    const wd = new Date(cur).getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return cur;
}

export function DateEngine({ preset }: EngineProps) {
  const today = isoDay(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  const [mode, setMode] = useState<"age" | "between" | "add">((preset.mode as "age") ?? "age");
  const [a, setA] = useState(mode === "age" ? "1995-08-15" : today);
  const [b, setB] = useState(today);
  const [n, setN] = useState("30");
  const [unit, setUnit] = useState<"days" | "weeks" | "months" | "years" | "business">("days");
  const [sign, setSign] = useState<1 | -1>(1);
  const ta = parseDay(a);
  const tb = parseDay(b);
  const valid = Number.isFinite(ta) && Number.isFinite(tb);

  const dateInput = (value: string, set: (v: string) => void, label: string) => <input type="date" value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-ink" />;

  let body: React.ReactNode = null;
  if (mode === "age" && valid) {
    const r = ymd(ta, tb);
    const days = Math.round((tb - ta) / DAY);
    const nextBirthday = (() => {
      const x = new Date(ta);
      const y = new Date(tb);
      let t = Date.UTC(y.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
      if (t < tb) t = Date.UTC(y.getUTCFullYear() + 1, x.getUTCMonth(), x.getUTCDate());
      return t;
    })();
    body =
      ta > tb ? (
        <Notice tone="warning">The birth date is after the “on” date.</Notice>
      ) : (
        <>
          <div className="rounded-md border border-line bg-surface px-5 py-5">
            <p className="label-mono text-ink-3">Age</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
              {r.years} years, {r.months} months, {r.days} days
            </p>
          </div>
          <ValueList>
            <ValueRow label="Days" value={days.toLocaleString("en")} />
            <ValueRow label="Weeks" value={`${Math.floor(days / 7).toLocaleString("en")} weeks, ${days % 7} days`} mono={false} />
            <ValueRow label="Months" value={(r.years * 12 + r.months).toLocaleString("en")} />
            <ValueRow label="Hours" value={(days * 24).toLocaleString("en")} />
            <ValueRow label="Born on" value={longDay(ta)} mono={false} />
            <ValueRow label="Next birthday" value={`${longDay(nextBirthday)} · in ${Math.round((nextBirthday - tb) / DAY)} days`} mono={false} />
          </ValueList>
        </>
      );
  } else if (mode === "between" && valid) {
    const r = ymd(ta, tb);
    const days = Math.abs(Math.round((tb - ta) / DAY));
    body = (
      <>
        <div className="rounded-md border border-line bg-surface px-5 py-5">
          <p className="label-mono text-ink-3">Between</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{days.toLocaleString("en")} days</p>
          <p className="mt-1 text-sm text-ink-2">
            {r.years ? `${r.years} years, ` : ""}
            {r.months ? `${r.months} months, ` : ""}
            {r.days} days{ta > tb ? " (the end is before the start)" : ""}
          </p>
        </div>
        <ValueList>
          <ValueRow label="Business" value={`${businessDays(ta, tb).toLocaleString("en")} weekdays`} note="Monday to Friday, not counting the end date. Public holidays aren't removed." mono={false} />
          <ValueRow label="Weekends" value={`${(days - businessDays(ta, tb)).toLocaleString("en")} days`} mono={false} />
          <ValueRow label="Weeks" value={`${Math.floor(days / 7)} weeks, ${days % 7} days`} mono={false} />
          <ValueRow label="Including end" value={`${(days + 1).toLocaleString("en")} days`} mono={false} />
          <ValueRow label="Hours" value={(days * 24).toLocaleString("en")} />
        </ValueList>
      </>
    );
  } else if (mode === "add" && Number.isFinite(ta)) {
    const k = (Number(n) || 0) * sign;
    let out = ta;
    if (unit === "days") out = ta + k * DAY;
    else if (unit === "weeks") out = ta + k * 7 * DAY;
    else if (unit === "business") out = addBusiness(ta, k);
    else {
      const d = new Date(ta);
      const months = unit === "months" ? k : k * 12;
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
      const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      out = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last));
    }
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-5 py-5">
        <div>
          <p className="label-mono text-ink-3">Result</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{longDay(out)}</p>
          <p className="font-mono text-[12px] text-ink-3">{isoDay(out)}</p>
        </div>
        <CopyButton text={isoDay(out)} />
      </div>
    );
  }

  return (
    <>
      <Panel>
        <Row label="Calculate">
          <Chips value={mode} options={[{ value: "age", label: "Age" }, { value: "between", label: "Days between dates" }, { value: "add", label: "Add or subtract" }]} onChange={setMode} label="Calculate" />
        </Row>
        {mode === "age" && (
          <Row label="Born on, age on">
            <div className="flex flex-wrap items-center gap-2">
              {dateInput(a, setA, "Date of birth")}
              <span className="text-ink-3">→</span>
              {dateInput(b, setB, "Age on")}
            </div>
          </Row>
        )}
        {mode === "between" && (
          <Row label="From, to">
            <div className="flex flex-wrap items-center gap-2">
              {dateInput(a, setA, "Start date")}
              <span className="text-ink-3">→</span>
              {dateInput(b, setB, "End date")}
            </div>
          </Row>
        )}
        {mode === "add" && (
          <Row label="Start, then">
            <div className="flex flex-wrap items-center gap-2">
              {dateInput(a, setA, "Start date")}
              <Chips value={sign} options={[{ value: 1, label: "+ add" }, { value: -1, label: "− subtract" }]} onChange={setSign} label="Add or subtract" />
              <div className="w-24">
                <TextField label="How many" value={n} onChange={(v) => setN(v.replace(/\D/g, "").slice(0, 6))} mono inputMode="numeric" />
              </div>
              <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} aria-label="Unit" className="h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink">
                <option value="days">days</option>
                <option value="business">business days</option>
                <option value="weeks">weeks</option>
                <option value="months">months</option>
                <option value="years">years</option>
              </select>
            </div>
          </Row>
        )}
      </Panel>
      {body}
    </>
  );
}
