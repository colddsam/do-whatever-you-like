"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, TextField, Toggle } from "../pdf/kit";
import { CopyButton } from "../dev/parts";

const EXAMPLES: [string, string][] = [
  ["*/5 * * * *", "Every 5 minutes"],
  ["0 * * * *", "Hourly"],
  ["0 9 * * 1-5", "Weekdays 9:00"],
  ["30 2 * * *", "Nightly 2:30"],
  ["0 0 1 * *", "Monthly"],
  ["0 0 * * 0", "Sundays"],
  ["0 */6 * * *", "Every 6 hours"],
  ["0 12 1 1 *", "1 Jan noon"],
];
const FIELDS = [
  { name: "Minute", range: "0–59" },
  { name: "Hour", range: "0–23" },
  { name: "Day of month", range: "1–31" },
  { name: "Month", range: "1–12 or JAN–DEC" },
  { name: "Day of week", range: "0–6 (Sun=0) or SUN–SAT" },
];
const MACROS: Record<string, string> = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };

type Result = { text: string; next: Date[]; at?: number; error?: string };

export function CronEngine() {
  const [expr, setExpr] = useState("0 9 * * 1-5");
  const [h24, setH24] = useState(true);
  const [zone, setZone] = useState<"local" | "UTC">("local");
  const [result, setResult] = useState<Result | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const source = MACROS[expr.trim().toLowerCase()] ?? expr.trim();
    void Promise.all([import("cronstrue"), import("cron-parser")]).then(([cs, cp]) => {
      if (!live) return;
      try {
        const text = cs.default.toString(source, { use24HourTimeFormat: h24, verbose: true, throwExceptionOnParseError: true });
        const it = cp.CronExpressionParser.parse(source, { currentDate: new Date(), tz: zone === "UTC" ? "UTC" : undefined });
        const next = it.take(8).map((d) => d.toDate());
        setResult({ text, next, at: Date.now() });
      } catch (e) {
        setResult({ text: "", next: [], error: String((e as Error)?.message ?? e).replace(/^Error:\s*/, "") });
      }
    });
    return () => {
      live = false;
    };
  }, [expr, h24, zone]);

  const parts = expr.trim().split(/\s+/);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: !h24, timeZone: zone === "UTC" ? "UTC" : undefined }).format(d);
  const rel = (d: Date) => {
    const m = Math.round((d.getTime() - (result?.at ?? d.getTime())) / 60000);
    if (m < 60) return `in ${m} min`;
    if (m < 1440) return `in ${Math.round(m / 60)} h`;
    return `in ${Math.round(m / 1440)} days`;
  };
  return (
    <>
      <div className="grid gap-2">
        <TextField label="Cron expression" value={expr} onChange={setExpr} mono placeholder="*/15 * * * *" invalid={!!result?.error} />
        <div className="grid grid-cols-5 gap-1 font-mono text-[12px]" aria-hidden>
          {FIELDS.map((f, i) => (
            <button key={f.name} type="button" onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)} className={cn("rounded-[6px] px-1 py-1.5 text-center transition-colors", focus === i ? "bg-ink text-paper" : "bg-paper-2 text-ink-2")}>
              <span className="block truncate text-[13px] font-semibold">{parts.length === 5 || parts.length === 6 ? parts[parts.length === 6 ? i + 1 : i] ?? "?" : "·"}</span>
              <span className="block truncate text-[10px] uppercase tracking-wide opacity-70">{f.name}</span>
            </button>
          ))}
        </div>
        {focus !== null && <p className="text-xs text-ink-3">{FIELDS[focus].name}: {FIELDS[focus].range}. Use * for any, a,b for a list, a-b for a range, */n for every n.</p>}
      </div>
      {result?.error ? (
        <Notice tone="warning">{result.error}</Notice>
      ) : result ? (
        <>
          <motion.div key={result.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface px-5 py-5">
            <p className="text-2xl font-semibold tracking-tight text-ink">“{result.text}”</p>
            <CopyButton text={result.text} />
          </motion.div>
          <div>
            <p className="label-mono mb-2 text-ink-3">Next runs ({zone === "UTC" ? "UTC" : "your time"})</p>
            <ol className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
              {result.next.map((d, i) => (
                <li key={d.getTime()} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="font-mono text-ink">
                    <span className="mr-3 text-ink-3">{i + 1}</span>
                    {fmt(d)}
                  </span>
                  <span className="text-xs text-ink-3">{rel(d)}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : null}
      <Panel>
        <Row label="Examples">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map(([e, label]) => (
              <button key={e} type="button" onClick={() => setExpr(e)} className={cn("rounded-[8px] px-2.5 py-1.5 text-left text-xs transition-colors", expr === e ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink")}>
                <span className="block font-mono">{e}</span>
                <span className="block opacity-70">{label}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Show times">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Chips value={zone} options={[{ value: "local", label: "My time zone" }, { value: "UTC", label: "UTC (most servers)" }]} onChange={setZone} label="Time zone" />
            <Toggle checked={h24} onChange={setH24} label="24-hour clock" />
          </div>
        </Row>
      </Panel>
      <Notice>Standard 5-field cron (crontab, Kubernetes, GitHub Actions), a 6-field form with seconds first, and macros like @daily. Servers usually run cron in UTC.</Notice>
    </>
  );
}
