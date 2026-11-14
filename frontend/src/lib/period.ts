/**
 * The period tracker's model, as plain functions (no browser APIs, so it's tested in Node).
 *
 * Days are local calendar dates, "YYYY-MM-DD". A period is a run of days logged with flow light or
 * heavier (spotting alone doesn't start one); a missed day or two inside a run is bridged. Cycle
 * length is the gap between period starts. Predictions use a weighted average of the last six
 * cycles (recent ones count more), fall back to the person's own numbers until there's history,
 * and say how sure they are. Ovulation is estimated as the luteal length (default 14 days) before
 * the next period; the fertile window is the five days before it and the day after.
 */

export type Flow = 0 | 1 | 2 | 3 | 4; // none, spotting, light, medium, heavy
export type DayLog = { flow?: Flow; symptoms?: string[]; mood?: string[]; note?: string; pain?: number; temp?: number };
export type Settings = { cycle: number; period: number; luteal: number; weekStart: 0 | 1; fertile: boolean };
export type PeriodData = { v: 1; settings: Settings; days: Record<string, DayLog>; onboarded: boolean };

export const DEFAULT_SETTINGS: Settings = { cycle: 28, period: 5, luteal: 14, weekStart: 1, fertile: true };
export const emptyData = (): PeriodData => ({ v: 1, settings: { ...DEFAULT_SETTINGS }, days: {}, onboarded: false });

export const FLOWS: { value: Flow; label: string }[] = [
  { value: 0, label: "None" },
  { value: 1, label: "Spotting" },
  { value: 2, label: "Light" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Heavy" },
];
export const SYMPTOMS = ["Cramps", "Headache", "Bloating", "Back pain", "Tender breasts", "Acne", "Tiredness", "Nausea", "Cravings", "Trouble sleeping", "Diarrhoea", "Constipation", "Dizziness", "Hot flushes"];
export const MOODS = ["Happy", "Calm", "Energetic", "Sensitive", "Sad", "Anxious", "Irritable", "Stressed", "Low energy"];

/* ---------- Dates ---------- */

const DAY = 86_400_000;
export const toMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromMs(toMs(iso) + n * DAY);
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
/** Today in the person's own time zone. */
export const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fromMs(toMs(s)) === s;

/* ---------- Periods and cycles ---------- */

export type Period = { start: string; end: string; length: number };
export type Cycle = { start: string; length: number; periodLength: number; counted: boolean };

export function periodsOf(days: Record<string, DayLog>): Period[] {
  const flowDays = Object.keys(days)
    .filter((d) => (days[d].flow ?? 0) >= 2 && isIso(d))
    .sort();
  const out: Period[] = [];
  for (const d of flowDays) {
    const last = out.at(-1);
    if (last && diffDays(last.end, d) <= 3) {
      last.end = d;
      last.length = diffDays(last.start, d) + 1;
    } else out.push({ start: d, end: d, length: 1 });
  }
  return out;
}

export function cyclesOf(periods: Period[]): Cycle[] {
  const cycles: Cycle[] = [];
  for (let i = 0; i < periods.length - 1; i++) {
    cycles.push({ start: periods[i].start, length: diffDays(periods[i].start, periods[i + 1].start), periodLength: periods[i].length, counted: true });
  }
  // A gap far longer than usual is most likely a period that wasn't logged: keep it in the history,
  // leave it out of the averages.
  const lengths = cycles.map((c) => c.length).sort((a, b) => a - b);
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 28;
  for (const c of cycles) c.counted = c.length >= 15 && c.length <= Math.max(60, median * 1.8);
  return cycles;
}

function weighted(values: number[]) {
  const recent = values.slice(-6);
  let sum = 0;
  let w = 0;
  recent.forEach((v, i) => {
    sum += v * (i + 1);
    w += i + 1;
  });
  return w ? sum / w : NaN;
}
function sd(values: number[]) {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

export type Phase = "period" | "follicular" | "fertile" | "ovulation" | "luteal" | "late" | "unknown";
export type Prediction = { start: string; end: string; ovulation: string; fertileStart: string; fertileEnd: string };
export type Notice = { tone: "info" | "warning"; text: string };

export type Stats = {
  periods: Period[];
  cycles: Cycle[];
  cycleAvg: number;
  periodAvg: number;
  cycleSd: number;
  shortest: number | null;
  longest: number | null;
  counted: number;
  fromHistory: boolean;
  confidence: "starting" | "low" | "medium" | "high";
  lastStart: string | null;
  cycleDay: number | null;
  inPeriod: boolean;
  periodDay: number | null;
  late: number;
  nextStart: string | null;
  daysUntilNext: number | null;
  ovulation: string | null;
  fertileStart: string | null;
  fertileEnd: string | null;
  phase: Phase;
  predictions: Prediction[];
  notices: Notice[];
};

export function analyse(data: PeriodData, today: string): Stats {
  const s = data.settings;
  const periods = periodsOf(data.days).filter((p) => p.start <= today);
  const cycles = cyclesOf(periods);
  const counted = cycles.filter((c) => c.counted);
  const lengths = counted.map((c) => c.length);
  const fromHistory = lengths.length >= 2;
  const cycleAvg = Math.round(lengths.length ? (lengths.length >= 2 ? weighted(lengths) : (lengths[0] + s.cycle) / 2) : s.cycle);
  const pl = periods.slice(0, -1).map((p) => p.length).filter((l) => l <= 12);
  const periodAvg = Math.max(1, Math.round(pl.length ? weighted(pl) : s.period));
  const cycleSd = sd(lengths.slice(-6));
  const confidence = lengths.length === 0 ? "starting" : lengths.length < 3 ? "low" : cycleSd > 4 ? "medium" : "high";

  const last = periods.at(-1) ?? null;
  const lastStart = last?.start ?? null;
  const notices: Notice[] = [];
  let cycleDay: number | null = null;
  let inPeriod = false;
  let periodDay: number | null = null;
  let late = 0;
  let nextStart: string | null = null;
  let phase: Phase = "unknown";
  const predictions: Prediction[] = [];
  const luteal = Math.min(Math.max(s.luteal, 9), 17);

  if (lastStart && last) {
    cycleDay = diffDays(lastStart, today) + 1;
    // Still on: logged today or yesterday, unless today is explicitly marked Flow "None".
    inPeriod = diffDays(last.end, today) <= 1 && cycleDay <= 12 && data.days[today]?.flow !== 0;
    periodDay = inPeriod ? cycleDay : null;
    nextStart = addDays(lastStart, cycleAvg);
    if (!inPeriod && nextStart < today) late = diffDays(nextStart, today);
    // Predicted periods: the first one can't be in the past.
    let start = late > 0 ? today : nextStart;
    for (let i = 0; i < 6; i++) {
      const ov = addDays(start, -luteal);
      predictions.push({ start, end: addDays(start, periodAvg - 1), ovulation: ov, fertileStart: addDays(ov, -5), fertileEnd: addDays(ov, 1) });
      start = addDays(start, cycleAvg);
    }
    const cur = { ovulation: addDays(nextStart, -luteal) };
    const fStart = addDays(cur.ovulation, -5);
    const fEnd = addDays(cur.ovulation, 1);
    phase = inPeriod
      ? "period"
      : late > 0
        ? "late"
        : today === cur.ovulation
          ? "ovulation"
          : today >= fStart && today <= fEnd
            ? "fertile"
            : today < fStart
              ? "follicular"
              : "luteal";

    if (late >= 7) notices.push({ tone: "warning", text: `Your period is ${late} days later than expected. Stress, travel, illness, weight changes and pregnancy can all delay it. If you might be pregnant, a home test can tell you; if it keeps happening, talk to a doctor.` });
    else if (late > 0) notices.push({ tone: "info", text: `Your period is ${late} day${late === 1 ? "" : "s"} later than expected. A few days either way is normal.` });
  }
  if (lengths.length >= 3) {
    if (cycleAvg < 21 || cycleAvg > 35) notices.push({ tone: "warning", text: `Your cycles average ${cycleAvg} days. Cycles usually last 21 to 35 days; it's worth mentioning to a doctor.` });
    const spread = Math.max(...lengths.slice(-6)) - Math.min(...lengths.slice(-6));
    if (spread > 9) notices.push({ tone: "info", text: `Your recent cycles vary by ${spread} days, so predictions are less certain. Very irregular cycles are worth mentioning to a doctor.` });
  }
  if (pl.length >= 2 && periodAvg > 7) notices.push({ tone: "warning", text: `Your periods usually last ${periodAvg} days. Periods longer than 7 days, or very heavy ones, are worth talking to a doctor about.` });

  const fertileNow = predictions[0] && nextStart ? { o: addDays(nextStart, -luteal) } : null;
  return {
    periods,
    cycles,
    cycleAvg,
    periodAvg,
    cycleSd,
    shortest: lengths.length ? Math.min(...lengths) : null,
    longest: lengths.length ? Math.max(...lengths) : null,
    counted: lengths.length,
    fromHistory,
    confidence,
    lastStart,
    cycleDay,
    inPeriod,
    periodDay,
    late,
    nextStart: late > 0 ? today : nextStart,
    daysUntilNext: nextStart ? (late > 0 ? 0 : diffDays(today, nextStart)) : null,
    ovulation: fertileNow ? fertileNow.o : null,
    fertileStart: fertileNow ? addDays(fertileNow.o, -5) : null,
    fertileEnd: fertileNow ? addDays(fertileNow.o, 1) : null,
    phase,
    predictions,
    notices,
  };
}

/* ---------- Calendar marks ---------- */

export type Mark = { period?: Flow; predicted?: boolean; fertile?: boolean; ovulation?: boolean; logged?: boolean };

export function marks(data: PeriodData, st: Stats, today: string): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  const m = (d: string) => (out[d] ??= {});
  for (const [d, log] of Object.entries(data.days)) {
    if ((log.flow ?? 0) > 0) m(d).period = log.flow;
    if (log.symptoms?.length || log.mood?.length || log.note) m(d).logged = true;
  }
  // The current period's expected remaining days, if it's still going.
  if (st.inPeriod && st.lastStart) {
    for (let i = 0; i < st.periodAvg; i++) {
      const d = addDays(st.lastStart, i);
      if (d > today && !out[d]?.period) m(d).predicted = true;
    }
  }
  st.predictions.forEach((p, i) => {
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) if (!out[d]?.period) m(d).predicted = true;
    if (data.settings.fertile && (i > 0 || p.fertileEnd >= today || !st.late)) {
      for (let d = p.fertileStart; d <= p.fertileEnd; d = addDays(d, 1)) if (d >= today && !out[d]?.period) m(d).fertile = true;
      if (p.ovulation >= today) m(p.ovulation).ovulation = true;
    }
  });
  // This cycle's own fertile window, when it's still ahead (predictions start with the next period).
  if (data.settings.fertile && st.fertileStart && st.fertileEnd && st.ovulation && !st.late) {
    for (let d = st.fertileStart; d <= st.fertileEnd; d = addDays(d, 1)) if (d >= today && !out[d]?.period) m(d).fertile = true;
    if (st.ovulation >= today) m(st.ovulation).ovulation = true;
  }
  return out;
}

/* ---------- Editing ---------- */

/** Logs a period on each day from `start` to `end` (inclusive), keeping heavier flows already logged. */
export function markRange(days: Record<string, DayLog>, start: string, end: string, flow: Flow = 3): Record<string, DayLog> {
  const [a, b] = start <= end ? [start, end] : [end, start];
  const next = { ...days };
  for (let d = a; d <= b; d = addDays(d, 1)) next[d] = { ...next[d], flow: Math.max(next[d]?.flow ?? 0, flow) as Flow };
  return next;
}

export function setDay(days: Record<string, DayLog>, iso: string, patch: Partial<DayLog>): Record<string, DayLog> {
  const merged: DayLog = { ...days[iso], ...patch };
  const empty = !merged.flow && !merged.symptoms?.length && !merged.mood?.length && !merged.note && merged.pain === undefined && merged.temp === undefined;
  const next = { ...days };
  if (empty) delete next[iso];
  else next[iso] = merged;
  return next;
}

/* ---------- Symptoms ---------- */

export function symptomStats(data: PeriodData, st: Stats) {
  const counts = new Map<string, { n: number; period: number }>();
  for (const [d, log] of Object.entries(data.days)) {
    const inPeriod = st.periods.some((p) => d >= p.start && d <= p.end);
    for (const k of [...(log.symptoms ?? []), ...(log.mood ?? [])]) {
      const c = counts.get(k) ?? { n: 0, period: 0 };
      c.n++;
      if (inPeriod) c.period++;
      counts.set(k, c);
    }
  }
  return [...counts.entries()].map(([name, c]) => ({ name, n: c.n, periodShare: c.n ? c.period / c.n : 0 })).sort((a, b) => b.n - a.n);
}

/* ---------- Calendar file (.ics) ---------- */

export function toIcs(st: Stats, opts: { fertile: boolean; discreet: boolean; count: number }): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const d = (iso: string) => iso.replace(/-/g, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Do-Whatever-You-Like//Period tracker//EN", "CALSCALE:GREGORIAN"];
  const event = (uid: string, start: string, endInclusive: string, title: string, alarm: boolean) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@do-whatever-you-like`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(start)}`, `DTEND;VALUE=DATE:${d(addDays(endInclusive, 1))}`, `SUMMARY:${title}`, "TRANSP:TRANSPARENT");
    if (alarm) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "TRIGGER:-P1D", "END:VALARM");
    lines.push("END:VEVENT");
  };
  st.predictions.slice(0, opts.count).forEach((p, i) => {
    event(`p${i}-${p.start}`, p.start, p.end, opts.discreet ? "Reminder" : "Period expected", true);
    if (opts.fertile) event(`f${i}-${p.fertileStart}`, p.fertileStart, p.fertileEnd, opts.discreet ? "Note" : "Fertile window", false);
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
