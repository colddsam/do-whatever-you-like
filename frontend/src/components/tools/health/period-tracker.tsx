"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, ChevronLeft, ChevronRight, Download, Droplet, FolderOpen, Lock, LockOpen, ShieldCheck, Trash2 } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import {
  FLOWS,
  MOODS,
  SYMPTOMS,
  addDays,
  analyse,
  diffDays,
  emptyData,
  localToday,
  markRange,
  marks,
  setDay,
  symptomStats,
  toIcs,
  type DayLog,
  type Flow,
  type PeriodData,
  type Phase,
  type Stats,
} from "@/lib/period";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";

const STORE = "dw-period-v1";
const PERIOD = "#eb4a10";
const FERTILE = "#0f8b8d";

/* ---------- Storage, optionally locked with a PIN (AES-256-GCM, PBKDF2) ---------- */

type Locked = { v: 1; locked: true; salt: string; iv: string; ct: string };
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pin: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 310_000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(data: PeriodData, key: CryptoKey, salt: Uint8Array): Promise<Locked> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  return { v: 1, locked: true, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function unseal(s: Locked, pin: string) {
  const salt = unb64(s.salt);
  const key = await deriveKey(pin, salt);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) }, key, unb64(s.ct));
  return { data: normalise(JSON.parse(new TextDecoder().decode(pt))), key, salt };
}
function normalise(d: Partial<PeriodData> | null): PeriodData {
  const e = emptyData();
  if (!d || typeof d !== "object" || typeof d.days !== "object") return e;
  return { v: 1, settings: { ...e.settings, ...d.settings }, days: d.days ?? {}, onboarded: d.onboarded ?? Object.keys(d.days ?? {}).length > 0 };
}
function readStore(): { kind: "plain"; data: PeriodData } | { kind: "locked"; sealed: Locked } {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const d = JSON.parse(raw);
      if (d?.locked) return { kind: "locked", sealed: d as Locked };
      return { kind: "plain", data: normalise(d) };
    }
  } catch {
    /* blocked storage: start empty, in memory */
  }
  return { kind: "plain", data: emptyData() };
}

/* ---------- Today, kept current past midnight ---------- */

const subscribeDay = (cb: () => void) => {
  const t = setInterval(cb, 60_000);
  window.addEventListener("focus", cb);
  return () => {
    clearInterval(t);
    window.removeEventListener("focus", cb);
  };
};
const useToday = () => useSyncExternalStore(subscribeDay, () => localToday(), () => "");
const noop = () => () => {};

const nice = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", o);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function PeriodTracker({ toolId }: { toolId: string }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const tool = getTool(toolId)!;
  const [step, setStep] = useState(0);
  return (
    <Workbench steps={stepsFor(tool)} current={step} footer={<>Private: everything stays in this browser on this device. Nothing is sent to our server. Not a method of contraception, and not medical advice.</>}>
      {mounted ? <Tracker onStep={setStep} /> : <div className="m-4 h-96 animate-pulse rounded-md bg-paper-2" />}
    </Workbench>
  );
}

function Tracker({ onStep }: { onStep: (s: number) => void }) {
  const [initial] = useState(readStore);
  const [data, setData] = useState<PeriodData | null>(initial.kind === "plain" ? initial.data : null);
  const [sealed, setSealed] = useState<Locked | null>(initial.kind === "locked" ? initial.sealed : null);
  const lock = useRef<{ key: CryptoKey; salt: Uint8Array } | null>(null);
  const [locked, setLocked] = useState(initial.kind === "locked");
  const today = useToday();

  useEffect(() => {
    if (!data || !today || !data.onboarded) onStep(0);
  }, [data, today, onStep]);

  // Save in this browser (locked if a PIN is set).
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(async () => {
      try {
        const value = lock.current ? await seal(data, lock.current.key, lock.current.salt) : data;
        localStorage.setItem(STORE, JSON.stringify(value));
      } catch {
        /* full or blocked: it still works for this visit */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [data, locked]);

  if (!data || !today) return sealed ? <LockScreen sealed={sealed} onOpen={(r) => ((lock.current = { key: r.key, salt: r.salt }), setData(r.data), setLocked(true), setSealed(null))} /> : null;
  if (!data.onboarded) return <Onboarding today={today} onDone={setData} data={data} />;
  return (
    <Main
      data={data}
      setData={setData}
      today={today}
      locked={locked}
      onStep={onStep}
      onLock={async (pin) => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        lock.current = { key: await deriveKey(pin, salt), salt };
        setLocked(true);
      }}
      onUnlockRemove={() => {
        lock.current = null;
        setLocked(false);
      }}
      onLockNow={async () => {
        if (!lock.current) return;
        const s = await seal(data, lock.current.key, lock.current.salt);
        localStorage.setItem(STORE, JSON.stringify(s));
        lock.current = null;
        setSealed(s);
        setData(null);
      }}
      onWipe={() => {
        try {
          localStorage.removeItem(STORE);
        } catch {
          /* nothing stored */
        }
        lock.current = null;
        setLocked(false);
        setData(emptyData());
      }}
    />
  );
}

function LockScreen({ sealed, onOpen }: { sealed: Locked; onOpen: (r: Awaited<ReturnType<typeof unseal>>) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      onOpen(await unseal(sealed, pin));
    } catch {
      setErr("That PIN isn't right.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid place-items-center px-4 py-14">
      <form onSubmit={(e) => (e.preventDefault(), void go())} className="grid w-full max-w-xs justify-items-center gap-4 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-paper-2">
          <Lock aria-hidden className="size-6 text-ink" />
        </span>
        <h3 className="text-xl font-semibold text-ink">Your tracker is locked</h3>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          type="password"
          autoFocus
          autoComplete="off"
          aria-label="PIN"
          placeholder="PIN"
          className="h-14 w-full rounded-md border border-line bg-surface text-center font-mono text-2xl tracking-[0.4em] text-ink outline-none focus:border-ink"
        />
        {err && <p className="text-sm text-danger">{err}</p>}
        <button type="submit" disabled={pin.length < 4 || busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40">
          <LockOpen aria-hidden className="size-4" /> {busy ? "Opening…" : "Open"}
        </button>
      </form>
    </div>
  );
}

/* ---------- First visit ---------- */

function Onboarding({ today, data, onDone }: { today: string; data: PeriodData; onDone: (d: PeriodData) => void }) {
  const [start, setStart] = useState(addDays(today, -10));
  const [len, setLen] = useState(5);
  const [cycle, setCycle] = useState(28);
  const [sure, setSure] = useState(true);
  const finish = (withPeriod: boolean) => {
    const end = addDays(start, len - 1) > today ? today : addDays(start, len - 1);
    onDone({
      ...data,
      onboarded: true,
      settings: { ...data.settings, cycle: sure ? cycle : 28, period: len },
      days: withPeriod && start <= today ? markRange(data.days, start, end) : data.days,
    });
  };
  return (
    <div className="mx-auto grid max-w-xl gap-5 p-4 sm:p-6">
      <div className="grid gap-1">
        <h3 className="text-2xl font-semibold tracking-tight text-ink">Let&apos;s set up your tracker</h3>
        <p className="text-sm text-ink-2">Three quick questions. Everything stays on this device; you can change it all later.</p>
      </div>
      <Panel>
        <Row label="1 · When did your last period start?">
          <input type="date" value={start} max={today} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label="Last period start date" className="h-11 w-full max-w-full rounded-md border border-line bg-surface px-3 text-ink sm:w-auto" />
        </Row>
        <Row label="2 · How many days did it last?">
          <Stepper value={len} min={1} max={12} onChange={setLen} unit="day" name="Period length" />
        </Row>
        <Row label="3 · How long is your cycle, usually?" hint="From the first day of one period to the first day of the next">
          <div className="flex flex-wrap items-center gap-3">
            <Stepper value={cycle} min={18} max={60} onChange={(v) => (setCycle(v), setSure(true))} unit="day" name="Cycle length" />
            <button type="button" aria-pressed={!sure} onClick={() => setSure((s) => !s)} className={cn("h-9 rounded-md border px-3 text-sm", !sure ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:text-ink")}>
              I&apos;m not sure
            </button>
          </div>
          {!sure && <p className="mt-2 text-xs text-ink-3">No problem: we&apos;ll start with 28 days and learn your real length as you log.</p>}
        </Row>
      </Panel>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => finish(true)} className="inline-flex h-12 items-center gap-2 rounded-md bg-ink px-6 text-[15px] font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
          Start tracking
        </button>
        <button type="button" onClick={() => finish(false)} className="h-12 rounded-md px-4 text-sm text-ink-2 hover:text-ink">
          Skip, I&apos;ll log as I go
        </button>
      </div>
      <p className="flex items-start gap-2 text-xs text-ink-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> No account, no server: your data is saved only in this browser. You can lock it with a PIN and make a backup in Settings.
      </p>
    </div>
  );
}

function Stepper({ value, min, max, onChange, unit, name }: { value: number; min: number; max: number; onChange: (v: number) => void; unit: string; name: string }) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-surface">
      <button type="button" aria-label={`${name}: one ${unit} less`} onClick={() => onChange(Math.max(min, value - 1))} className="size-11 text-xl text-ink-2 hover:text-ink">
        −
      </button>
      <span className="min-w-20 text-center font-mono text-lg text-ink" aria-live="polite">
        {plural(value, unit)}
      </span>
      <button type="button" aria-label={`${name}: one ${unit} more`} onClick={() => onChange(Math.min(max, value + 1))} className="size-11 text-xl text-ink-2 hover:text-ink">
        +
      </button>
    </div>
  );
}

/* ---------- The tracker ---------- */

type Tab = "today" | "calendar" | "insights" | "settings";
const PHASE: Record<Phase, { name: string; tip: string }> = {
  period: { name: "Period", tip: "Rest when you can, keep warm, and drink water. Iron-rich foods (greens, beans, lentils) help replace what you lose." },
  follicular: { name: "Follicular phase", tip: "After your period, rising oestrogen often brings more energy and a brighter mood." },
  fertile: { name: "Fertile window", tip: "The days when pregnancy is most likely. Estimates can be off by several days, so don't rely on them for contraception." },
  ovulation: { name: "Ovulation (estimated)", tip: "An egg is released around now. Some people feel a twinge on one side or notice clearer, stretchy discharge." },
  luteal: { name: "Luteal phase", tip: "In the days before a period, bloating, tender breasts, cravings or mood changes (PMS) are common." },
  late: { name: "Period late", tip: "A few days late is common. If you might be pregnant, a home test is reliable from the first day of a missed period." },
  unknown: { name: "Getting started", tip: "Log your period when it comes, and the tracker will start predicting." },
};

function Main({
  data,
  setData,
  today,
  locked,
  onStep,
  onLock,
  onUnlockRemove,
  onLockNow,
  onWipe,
}: {
  data: PeriodData;
  setData: React.Dispatch<React.SetStateAction<PeriodData | null>>;
  today: string;
  locked: boolean;
  onStep: (s: number) => void;
  onLock: (pin: string) => Promise<void>;
  onUnlockRemove: () => void;
  onLockNow: () => void;
  onWipe: () => void;
}) {
  const [tab, setTab] = useState<Tab>("today");
  useEffect(() => {
    onStep(tab === "insights" ? 2 : 1);
  }, [tab, onStep]);
  const st = useMemo(() => analyse(data, today), [data, today]);
  const mk = useMemo(() => marks(data, st, today), [data, st, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const update = (iso: string, patch: Partial<DayLog>) => setData((d) => (d ? { ...d, days: setDay(d.days, iso, patch) } : d));
  const setSettings = (p: Partial<PeriodData["settings"]>) => setData((d) => (d ? { ...d, settings: { ...d.settings, ...p } } : d));

  return (
    <div className="grid gap-4 p-3 sm:p-5">
      <Status st={st} today={today} data={data} onStart={() => update(today, { flow: 3 })} onCalendar={() => setTab("calendar")} />

      <div role="tablist" aria-label="Sections" className="grid grid-cols-4 gap-1 rounded-md bg-paper-2 p-1">
        {(["today", "calendar", "insights", "settings"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("relative h-10 rounded-[6px] text-[13px] transition-colors sm:text-sm", tab === k ? "font-medium text-ink" : "text-ink-2 hover:text-ink")}>
            {tab === k && <motion.span layoutId="period-tab" className="absolute inset-0 rounded-[6px] bg-surface shadow-sm" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
            <span className="relative">{{ today: "Today", calendar: "Calendar", insights: "Insights", settings: "Settings" }[k]}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="grid gap-4">
          {tab === "today" && (
            <>
              <DayEditor iso={today} today={today} log={data.days[today] ?? {}} onChange={(p) => update(today, p)} title="How's today?" />
              <div className="rounded-md border border-line bg-paper px-4 py-3">
                <p className="label-mono text-ink-3">{PHASE[st.phase].name}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{PHASE[st.phase].tip}</p>
              </div>
              {st.notices.map((n) => (
                <Notice key={n.text} tone={n.tone}>
                  {n.text}
                </Notice>
              ))}
            </>
          )}
          {tab === "calendar" && <CalendarTab data={data} st={st} mk={mk} today={today} picked={picked} setPicked={setPicked} update={update} setData={setData} />}
          {tab === "insights" && <Insights data={data} st={st} today={today} />}
          {tab === "settings" && <SettingsTab data={data} st={st} setSettings={setSettings} setData={setData} locked={locked} onLock={onLock} onUnlockRemove={onUnlockRemove} onLockNow={onLockNow} onWipe={onWipe} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ---------- Status ---------- */

function Status({ st, today, data, onStart, onCalendar }: { st: Stats; today: string; data: PeriodData; onStart: () => void; onCalendar: () => void }) {
  let head = "Log your period to begin";
  let sub = "Tap “Period started today” when it comes, or add past periods in the calendar.";
  if (st.phase === "period") {
    head = `Period · day ${st.periodDay}`;
    sub = `Usually lasts about ${plural(st.periodAvg, "day")}. Log each day's flow below.`;
  } else if (st.phase === "late") {
    head = `Period ${plural(st.late, "day")} late`;
    sub = "Log it when it starts and predictions will adjust.";
  } else if (st.nextStart && st.daysUntilNext !== null) {
    head = st.daysUntilNext === 0 ? "Period expected today" : `Next period in ${plural(st.daysUntilNext, "day")}`;
    sub = `${nice(st.nextStart, { weekday: "long", day: "numeric", month: "long" })}${st.phase === "fertile" || st.phase === "ovulation" ? ` · fertile window now, ovulation around ${nice(st.ovulation!)}` : st.fertileStart && st.fertileStart > today && data.settings.fertile ? ` · fertile window from ${nice(st.fertileStart)}` : ""}`;
  }
  const basis =
    st.confidence === "starting"
      ? `Based on your usual cycle (${data.settings.cycle} days) until you've logged two periods.`
      : `Based on ${plural(st.counted, "cycle")} you've logged${st.confidence === "high" ? ", which are steady" : st.confidence === "medium" ? ", which vary, so allow a few days either way" : ""}.`;
  return (
    <section aria-label="Your cycle" className="grid items-center gap-5 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-5">
      <Ring st={st} today={today} showFertile={data.settings.fertile} />
      <div className="grid gap-2">
        <span className="label-mono inline-flex min-h-5 w-fit items-center rounded-sm px-2 py-0.5" style={{ background: st.phase === "period" || st.phase === "late" ? `${PERIOD}1a` : st.phase === "fertile" || st.phase === "ovulation" ? `${FERTILE}1a` : "var(--color-paper-2)", color: st.phase === "period" || st.phase === "late" ? PERIOD : st.phase === "fertile" || st.phase === "ovulation" ? FERTILE : "var(--color-ink-2)" }}>
          {PHASE[st.phase].name}
        </span>
        <h3 className="text-[clamp(1.6rem,4vw,2.2rem)] font-semibold leading-tight tracking-tight text-ink">{head}</h3>
        <p className="text-sm text-ink-2">{sub}</p>
        <p className="text-xs text-ink-3">{st.lastStart ? basis : ""}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {!st.inPeriod && (
            <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={onStart} className="inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium text-white shadow-[0_8px_20px_-8px_rgba(235,74,16,.7)]" style={{ background: PERIOD }}>
              <Droplet aria-hidden className="size-4 fill-white" /> Period started today
            </motion.button>
          )}
          <button type="button" onClick={onCalendar} className="h-12 rounded-full border border-line px-4 text-sm text-ink hover:border-ink-3">
            {st.lastStart ? "Open the calendar" : "Add a past period"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Ring({ st, today, showFertile }: { st: Stats; today: string; showFertile: boolean }) {
  const L = Math.max(st.cycleAvg, st.cycleDay ?? 0, 21);
  const R = 70;
  const C = 2 * Math.PI * R;
  const arc = (from: number, to: number) => ({ strokeDasharray: `${Math.max(0, ((to - from) / L) * C - 3)} ${C}`, strokeDashoffset: -((from / L) * C) });
  const day = st.cycleDay ?? 0;
  const fertileFrom = st.lastStart && st.fertileStart ? diffDays(st.lastStart, st.fertileStart) : null;
  const ovu = st.lastStart && st.ovulation ? diffDays(st.lastStart, st.ovulation) : null;
  const angle = ((Math.min(day, L) - 0.5) / L) * 360;
  return (
    <div className="relative mx-auto size-44 shrink-0">
      <svg viewBox="0 0 180 180" className="size-full -rotate-90" aria-hidden>
        <circle cx="90" cy="90" r={R} fill="none" stroke="var(--color-paper-2)" strokeWidth="14" />
        {st.lastStart && (
          <>
            <motion.circle cx="90" cy="90" r={R} fill="none" stroke={PERIOD} strokeWidth="14" strokeLinecap="round" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={arc(0, st.periodAvg)} />
            {showFertile && fertileFrom !== null && fertileFrom >= 0 && <motion.circle cx="90" cy="90" r={R} fill="none" stroke={FERTILE} strokeOpacity={0.35} strokeWidth="14" strokeLinecap="round" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} style={arc(fertileFrom, fertileFrom + 7)} />}
            {showFertile && ovu !== null && ovu >= 0 && <circle cx={90 + R * Math.cos(((ovu + 0.5) / L) * 2 * Math.PI)} cy={90 + R * Math.sin(((ovu + 0.5) / L) * 2 * Math.PI)} r="5" fill={FERTILE} />}
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "90px 90px", transformBox: "view-box", transition: "transform .9s cubic-bezier(.34,1.56,.64,1)" }}>
              <circle cx={90 + R} cy="90" r="11" fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth="3" />
              <circle cx={90 + R} cy="90" r="3.5" fill="var(--color-ink)" />
            </g>
          </>
        )}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        {st.cycleDay ? (
          <>
            <span className="label-mono text-ink-3">Cycle day</span>
            <span className="font-mono text-5xl font-semibold tabular-nums leading-none text-ink">{st.cycleDay}</span>
            <span className="mt-1 text-xs text-ink-3">of about {st.cycleAvg}</span>
          </>
        ) : (
          <span className="text-sm text-ink-3">{today ? "No period yet" : ""}</span>
        )}
      </div>
    </div>
  );
}

/* ---------- One day: flow, symptoms, mood, note ---------- */

function DayEditor({ iso, today, log, onChange, title }: { iso: string; today: string; log: DayLog; onChange: (p: Partial<DayLog>) => void; title: string }) {
  const future = iso > today;
  const toggle = (key: "symptoms" | "mood", v: string) => {
    const cur = log[key] ?? [];
    onChange({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  return (
    <section aria-label={title} className="grid gap-4 rounded-md border border-line bg-surface p-4">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <div className="grid gap-2">
        <p className="label-mono text-ink-3">Flow</p>
        {future ? (
          <p className="text-sm text-ink-3">You can log flow on the day itself. Notes and symptoms can be added any time.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {FLOWS.map((f) => {
              const on = (log.flow ?? 0) === f.value;
              return (
                <motion.button
                  key={f.value}
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ flow: f.value as Flow })}
                  className={cn("inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors", on ? "border-transparent text-white" : "border-line bg-paper text-ink hover:border-ink-3")}
                  style={on ? { background: f.value ? PERIOD : "var(--color-ink)" } : undefined}
                >
                  {f.value > 0 && (
                    <span className="flex gap-0.5" aria-hidden>
                      {Array.from({ length: f.value === 1 ? 1 : f.value - 1 }, (_, i) => (
                        <Droplet key={i} className={cn("size-3", on ? "fill-white" : "")} style={on ? undefined : { color: PERIOD, fill: f.value > 1 ? PERIOD : "none" }} />
                      ))}
                    </span>
                  )}
                  {f.label}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
      <ToggleGroup label="Symptoms" options={SYMPTOMS} value={log.symptoms ?? []} onToggle={(v) => toggle("symptoms", v)} />
      <ToggleGroup label="Mood" options={MOODS} value={log.mood ?? []} onToggle={(v) => toggle("mood", v)} />
      <div className="grid gap-2">
        <p className="label-mono text-ink-3">Pain</p>
        <Chips
          value={log.pain ?? -1}
          options={[{ value: -1, label: "—" }, { value: 0, label: "None" }, { value: 1, label: "Mild" }, { value: 2, label: "Moderate" }, { value: 3, label: "Severe" }]}
          onChange={(v) => onChange({ pain: v < 0 ? undefined : v })}
          label="Pain"
        />
      </div>
      <label className="grid gap-2">
        <span className="label-mono text-ink-3">Note</span>
        <textarea value={log.note ?? ""} onChange={(e) => onChange({ note: e.target.value.slice(0, 500) })} rows={2} placeholder="Anything to remember (medicine taken, sleep, appointments)…" className="w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink" />
      </label>
    </section>
  );
}

function ToggleGroup({ label, options, value, onToggle }: { label: string; options: string[]; value: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="grid gap-2">
      <p className="label-mono text-ink-3">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <motion.button key={o} whileTap={{ scale: 0.94 }} type="button" aria-pressed={on} onClick={() => onToggle(o)} className={cn("h-9 rounded-full border px-3 text-[13px] transition-colors", on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2 hover:text-ink")}>
              {o}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Calendar ---------- */

function CalendarTab({
  data,
  st,
  mk,
  today,
  picked,
  setPicked,
  update,
  setData,
}: {
  data: PeriodData;
  st: Stats;
  mk: ReturnType<typeof marks>;
  today: string;
  picked: string | null;
  setPicked: (d: string | null) => void;
  update: (iso: string, p: Partial<DayLog>) => void;
  setData: React.Dispatch<React.SetStateAction<PeriodData | null>>;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [range, setRange] = useState<{ on: boolean; from: string | null }>({ on: false, from: null });
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const daysIn = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() - data.settings.weekStart + 7) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => addDays(first, i))];
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const names = data.settings.weekStart === 1 ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const tap = (iso: string) => {
    if (range.on) {
      if (iso > today) return;
      if (!range.from) return setRange({ on: true, from: iso });
      setData((d) => (d ? { ...d, days: markRange(d.days, range.from!, iso) } : d));
      setRange({ on: false, from: null });
      return;
    }
    setPicked(picked === iso ? null : iso);
  };
  return (
    <>
      <section className="grid gap-3 rounded-md border border-line bg-surface p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2 hover:text-ink">
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <div className="text-center">
            <p className="text-lg font-semibold text-ink">{new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
            {month !== today.slice(0, 7) && (
              <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="text-xs text-accent hover:underline">
                Back to today
              </button>
            )}
          </div>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2 hover:text-ink">
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {names.map((n) => (
            <span key={n} className="label-mono py-1 text-ink-3">
              {n}
            </span>
          ))}
          {cells.map((iso, i) => {
            if (!iso) return <span key={`e${i}`} />;
            const k = mk[iso] ?? {};
            const isToday = iso === today;
            const sel = picked === iso || range.from === iso;
            const label = [nice(iso, { weekday: "long", day: "numeric", month: "long" }), k.period ? "period logged" : k.predicted ? "period predicted" : "", k.ovulation ? "ovulation estimated" : k.fertile ? "fertile window" : "", k.logged ? "has notes" : "", isToday ? "today" : ""].filter(Boolean).join(", ");
            return (
              <motion.button
                key={iso}
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={() => tap(iso)}
                aria-label={label}
                aria-pressed={sel}
                className={cn("relative grid aspect-square place-items-center rounded-full text-sm transition-colors sm:text-[15px]", sel && "ring-2 ring-ink ring-offset-2 ring-offset-surface", range.on && iso > today && "opacity-30")}
                style={{
                  background: k.period ? (k.period === 1 ? `${PERIOD}33` : PERIOD) : k.fertile ? `${FERTILE}1f` : undefined,
                  color: k.period && k.period > 1 ? "#fff" : k.fertile ? FERTILE : undefined,
                  border: k.predicted && !k.period ? `2px dashed ${PERIOD}` : isToday ? "2px solid var(--color-ink)" : "2px solid transparent",
                }}
              >
                <span className={cn("tabular-nums", isToday && "font-semibold")}>{Number(iso.slice(8))}</span>
                {k.ovulation && <span aria-hidden className="absolute bottom-1 size-1.5 rounded-full" style={{ background: FERTILE }} />}
                {k.logged && !k.ovulation && <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-ink-3" />}
              </motion.button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
          <Legend swatch={<span className="size-3 rounded-full" style={{ background: PERIOD }} />} label="Period" />
          <Legend swatch={<span className="size-3 rounded-full border-2 border-dashed" style={{ borderColor: PERIOD }} />} label="Expected" />
          {data.settings.fertile && <Legend swatch={<span className="size-3 rounded-full" style={{ background: `${FERTILE}33` }} />} label="Fertile" />}
          {data.settings.fertile && <Legend swatch={<span className="size-2 rounded-full" style={{ background: FERTILE }} />} label="Ovulation" />}
          <Legend swatch={<span className="size-1.5 rounded-full bg-ink-3" />} label="Notes" />
        </div>
        <button
          type="button"
          onClick={() => setRange(range.on ? { on: false, from: null } : { on: true, from: null })}
          className={cn("h-11 rounded-md border text-sm font-medium transition-colors", range.on ? "border-transparent text-white" : "border-line text-ink hover:border-ink-3")}
          style={range.on ? { background: PERIOD } : undefined}
        >
          {range.on ? (range.from ? `From ${nice(range.from)}: now tap the last day (or tap here to cancel)` : "Tap the first day of the period (or tap here to cancel)") : "Add a period: tap its first and last day"}
        </button>
      </section>
      {picked && !range.on && (
        <div className="grid gap-2">
          <DayEditor iso={picked} today={today} log={data.days[picked] ?? {}} onChange={(p) => update(picked, p)} title={picked === today ? "Today" : nice(picked, { weekday: "long", day: "numeric", month: "long" })} />
          {(data.days[picked]?.flow ?? 0) > 0 && (
            <button type="button" onClick={() => update(picked, { flow: 0 })} className="w-fit text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              Remove the period from this day
            </button>
          )}
        </div>
      )}
      {st.predictions[0] && (
        <p className="text-xs text-ink-3">
          Upcoming: {st.predictions.slice(0, 3).map((p) => nice(p.start, { day: "numeric", month: "short" })).join(" · ")}. Predictions are estimates and move as you log.
        </p>
      )}
    </>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
}

/* ---------- Insights ---------- */

function Insights({ data, st, today }: { data: PeriodData; st: Stats; today: string }) {
  const sym = useMemo(() => symptomStats(data, st), [data, st]);
  const recent = st.cycles.slice(-12);
  const max = Math.max(40, ...recent.map((c) => c.length));
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        <Tile label="Average cycle" value={st.counted ? `${st.cycleAvg} days` : "—"} note={st.counted ? `${st.shortest}–${st.longest} days` : `Using ${data.settings.cycle} for now`} />
        <Tile label="Average period" value={`${st.periodAvg} days`} note={st.periods.length > 1 ? "From your log" : "Your setting"} />
        <Tile label="Cycles logged" value={String(st.counted)} note={st.confidence === "high" ? "Steady" : st.confidence === "medium" ? "Varies" : "Keep logging"} />
        <Tile label="Next period" value={st.nextStart ? nice(st.nextStart, { day: "numeric", month: "short" }) : "—"} note={st.daysUntilNext !== null ? (st.late ? `${st.late} days late` : `in ${plural(st.daysUntilNext, "day")}`) : ""} />
      </div>

      <section className="grid gap-3 rounded-md border border-line bg-surface p-4">
        <h3 className="font-semibold text-ink">Cycle lengths</h3>
        {recent.length ? (
          <div className="overflow-x-auto pb-1">
            <div className="grid min-w-full gap-2">
              <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Your last ${recent.length} cycles: ${recent.map((c) => c.length).join(", ")} days`}>
                {recent.map((c, i) => (
                  <div key={c.start} className="flex h-full min-w-8 flex-1 flex-col items-center justify-end gap-1">
                    <span className="font-mono text-[12px] text-ink-2">{c.length}</span>
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${(c.length / max) * 100}%` }}
                      transition={{ delay: i * 0.05, type: "spring", stiffness: 120, damping: 16 }}
                      className="w-full max-w-10 rounded-t-[6px]"
                      style={{ background: c.counted ? (c.length < 21 || c.length > 35 ? "var(--color-warning)" : PERIOD) : "var(--color-line)" }}
                      title={c.counted ? undefined : "Left out of the average (probably a period that wasn't logged)"}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                {recent.map((c) => (
                  <span key={c.start} className="min-w-8 flex-1 text-center font-mono text-[12px] text-ink-3">
                    {nice(c.start, { month: "short" })}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-3">Your cycles appear here once you&apos;ve logged two periods.</p>
        )}
      </section>

      <section className="grid gap-2 rounded-md border border-line bg-surface p-4">
        <h3 className="font-semibold text-ink">Past periods</h3>
        {st.periods.length ? (
          <ul className="divide-y divide-line text-sm">
            {[...st.periods].reverse().slice(0, 12).map((p) => {
              const c = st.cycles.find((x) => x.start === p.start);
              return (
                <li key={p.start} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink">{nice(p.start, { day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="font-mono text-[13px] text-ink-2">
                    {plural(p.length, "day")}
                    {c ? ` · ${c.length}-day cycle` : p.end >= addDays(today, -1) ? " · now" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Nothing logged yet.</p>
        )}
      </section>

      <section className="grid gap-2 rounded-md border border-line bg-surface p-4">
        <h3 className="font-semibold text-ink">What you log most</h3>
        {sym.length ? (
          <ul className="grid gap-2">
            {sym.slice(0, 8).map((s) => (
              <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
                <span className="truncate text-ink">{s.name}</span>
                <span className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-paper-2 sm:order-none sm:col-span-1">
                  <motion.span initial={{ width: 0 }} animate={{ width: `${(s.n / sym[0].n) * 100}%` }} className="block h-full rounded-full bg-ink" />
                </span>
                <span className="font-mono text-[12px] text-ink-3">
                  {s.n}× {s.periodShare >= 0.6 ? "· mostly on period days" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Log symptoms and moods to see patterns here.</p>
        )}
      </section>
      {st.notices.map((n) => (
        <Notice key={n.text} tone={n.tone}>
          {n.text}
        </Notice>
      ))}
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="label-mono text-ink-3">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="text-xs text-ink-3">{note}</p>
    </div>
  );
}

/* ---------- Settings, privacy and backups ---------- */

function SettingsTab({
  data,
  st,
  setSettings,
  setData,
  locked,
  onLock,
  onUnlockRemove,
  onLockNow,
  onWipe,
}: {
  data: PeriodData;
  st: Stats;
  setSettings: (p: Partial<PeriodData["settings"]>) => void;
  setData: React.Dispatch<React.SetStateAction<PeriodData | null>>;
  locked: boolean;
  onLock: (pin: string) => Promise<void>;
  onUnlockRemove: () => void;
  onLockNow: () => void;
  onWipe: () => void;
}) {
  const s = data.settings;
  const [pin, setPin] = useState({ a: "", b: "" });
  const [ics, setIcs] = useState({ fertile: false, discreet: true });
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };
  const pinOk = /^\d{4,8}$/.test(pin.a) && pin.a === pin.b;
  return (
    <>
      {msg && <Notice>{msg}</Notice>}
      <Panel>
        <Row label="Your usual cycle" hint="Used until you've logged two periods">
          <Slider label="Cycle length" value={s.cycle} min={18} max={60} onChange={(cycle) => setSettings({ cycle })} format={(v) => `${v} days`} />
        </Row>
        <Row label="Your usual period">
          <Slider label="Period length" value={s.period} min={1} max={12} onChange={(period) => setSettings({ period })} format={(v) => plural(v, "day")} />
        </Row>
        <Row label="Luteal phase" hint="Days from ovulation to period; 14 for most people">
          <Slider label="Luteal phase length" value={s.luteal} min={9} max={17} onChange={(luteal) => setSettings({ luteal })} format={(v) => `${v} days`} />
        </Row>
        <Row label="Show">
          <div className="grid gap-3">
            <Toggle checked={s.fertile} onChange={(fertile) => setSettings({ fertile })} label="Fertile window and ovulation" description="Turn off if you'd rather not see them." />
            <Chips value={s.weekStart} options={[{ value: 1, label: "Weeks start Monday" }, { value: 0, label: "Sunday" }]} onChange={(weekStart) => setSettings({ weekStart })} label="First day of the week" />
          </div>
        </Row>
      </Panel>

      <Panel>
        <Row label="Lock with a PIN" hint="Encrypts your data on this device (AES-256)">
          {locked ? (
            <div className="grid gap-2">
              <p className="flex items-center gap-2 text-sm text-success">
                <Lock aria-hidden className="size-4" /> Locked. You&apos;ll need your PIN each time you open the tracker.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onLockNow} className="h-10 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90">
                  Lock now
                </button>
                <button type="button" onClick={() => (onUnlockRemove(), flash("PIN removed."))} className="h-10 rounded-md border border-line px-4 text-sm text-ink hover:border-ink-3">
                  Remove the PIN
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField label="New PIN (4–8 digits)" value={pin.a} onChange={(a) => setPin((p) => ({ ...p, a: a.replace(/\D/g, "").slice(0, 8) }))} type="password" inputMode="numeric" />
                <TextField label="PIN again" value={pin.b} onChange={(b) => setPin((p) => ({ ...p, b: b.replace(/\D/g, "").slice(0, 8) }))} type="password" inputMode="numeric" />
              </div>
              <button type="button" disabled={!pinOk} onClick={async () => (await onLock(pin.a), setPin({ a: "", b: "" }), flash("Locked with your PIN."))} className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40">
                <Lock aria-hidden className="size-4" /> Lock with this PIN
              </button>
              <p className="text-xs text-ink-3">If you forget the PIN, the data can&apos;t be opened by anyone, including us. Keep a backup.</p>
            </div>
          )}
        </Row>
        <Row label="Backup">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => saveBlob(new Blob([JSON.stringify({ app: "do-whatever-period", ...data }, null, 2)], { type: "application/json" }), `period-tracker-backup-${localToday()}.json`)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-4 text-sm text-ink hover:border-ink-3"
            >
              <Download aria-hidden className="size-4" /> Download a backup
            </button>
            <button type="button" onClick={() => file.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-4 text-sm text-ink hover:border-ink-3">
              <FolderOpen aria-hidden className="size-4" /> Restore a backup
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const d = JSON.parse(await f.text());
                  if ((d?.app !== "do-whatever-period" && d?.app !== "do-whatever-you-like-period") || typeof d.days !== "object") throw new Error();
                  setData(normalise(d));
                  flash(`Backup restored: ${Object.keys(d.days).length} days.`);
                } catch {
                  flash("That isn't a backup from this tracker.");
                }
              }}
            />
          </div>
          <p className="mt-2 text-xs text-ink-3">Use a backup to move to another phone or browser. The file isn&apos;t locked, so keep it somewhere private.</p>
        </Row>
        <Row label="Calendar reminders" hint="Your phone's calendar reminds you a day before">
          <div className="grid gap-2">
            <Toggle checked={ics.discreet} onChange={(discreet) => setIcs((x) => ({ ...x, discreet }))} label="Use a discreet event name (“Reminder”)" />
            <Toggle checked={ics.fertile} onChange={(fertile) => setIcs((x) => ({ ...x, fertile }))} label="Add the fertile windows too" />
            <button
              type="button"
              disabled={!st.predictions.length}
              onClick={() => saveBlob(new Blob([toIcs(st, { ...ics, count: 6 })], { type: "text/calendar" }), "period-reminders.ics")}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-line px-4 text-sm text-ink hover:border-ink-3 disabled:opacity-40"
            >
              <CalendarPlus aria-hidden className="size-4" /> Add the next 6 periods to my calendar
            </button>
          </div>
        </Row>
        <Row label="Delete">
          <button
            type="button"
            onClick={() => (confirmWipe ? (onWipe(), setConfirmWipe(false)) : setConfirmWipe(true))}
            onBlur={() => setConfirmWipe(false)}
            className={cn("inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm", confirmWipe ? "border-danger bg-danger text-white" : "border-line text-danger hover:border-danger")}
          >
            <Trash2 aria-hidden className="size-4" /> {confirmWipe ? "Tap again to delete everything" : "Delete all my data"}
          </button>
        </Row>
      </Panel>
    </>
  );
}
