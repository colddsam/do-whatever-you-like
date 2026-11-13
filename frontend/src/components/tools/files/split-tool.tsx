"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { listZip, outOfBounds, parseRanges } from "@/lib/pdf";
import { postFormJson, saveBlob, uploadForm } from "@/lib/files";
import { ACCEPT_ALL, clock, FAMILIES, familyOf, MAX_MB, mediaDuration, parseClock, parseJobInfo, type Family, type JobInfo } from "@/lib/file-tools";
import { getTool, stepsFor } from "@/lib/tools";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row } from "../pdf/kit";
import { isAbort, isZip, Measuring, messageOf, plural, RetryLink, swap } from "../pdf/parts";
import { FileRow, ResultPanel, type TaskResult } from "../pdf/task";
import { CountField, LineField } from "./kit";
import { FamilyStrip } from "./merge-tool";

const ENDPOINT = "/api/tools/merge-split/split";
const INSPECT = "/api/tools/merge-split/inspect";
const MAX_PARTS = 200;

type Sheet = { name: string; rows: number; columns: string[] };
type Info = {
  family: Family;
  units: number;
  titles?: string[];
  headings?: Record<string, number>;
  breaks?: number;
  pages?: number;
  sheets?: Sheet[];
  text?: boolean;
  duration?: number | null;
};

type Plan = {
  by: string;
  mode: "each" | "every" | "ranges";
  n: number;
  ranges: string;
  level: 1 | 2 | 3;
  sheet: string;
  column: number;
  minutes: number;
  parts: number;
  times: string;
};

const START: Plan = { by: "", mode: "each", n: 2, ranges: "", level: 1, sheet: "", column: 0, minutes: 5, parts: 2, times: "" };

/** What a unit is called, for each family (and Word's split kinds). */
const UNIT: Partial<Record<Family, string>> = { pdf: "page", slides: "slide" };

export function SplitFilesTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [reading, setReading] = useState<"idle" | "busy" | string>("idle");
  const [plan, setPlan] = useState<Plan>(START);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<(TaskResult & { meta: JobInfo }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const readRef = useRef<AbortController | null>(null);

  useEffect(() => () => (abortRef.current?.abort(), readRef.current?.abort()), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const family = file ? familyOf(file.name) : null;
  const busy = isBusy(job);

  const read = useCallback(async (f: File) => {
    const fam = familyOf(f.name)!;
    readRef.current?.abort();
    const ctrl = new AbortController();
    readRef.current = ctrl;
    setInfo(null);
    setReading("busy");
    try {
      let next: Info;
      if (fam === "audio" || fam === "video") {
        const d = await mediaDuration(f, fam);
        next = { family: fam, units: d ?? 0, duration: d };
      } else {
        const form = new FormData();
        form.append("file", f, f.name);
        next = await postFormJson<Info>(INSPECT, form, { signal: ctrl.signal });
      }
      if (ctrl.signal.aborted) return;
      setInfo(next);
      setPlan({ ...START, by: defaultBy(next), sheet: next.sheets?.[0]?.name ?? "", n: fam === "sheet" ? 1000 : 2 });
      setReading("idle");
    } catch (e) {
      if (isAbort(e) || ctrl.signal.aborted) return;
      setReading(messageOf(e));
    }
  }, []);

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };
  const choose = (f: File) => {
    if (f.size === 0) return setRejected("That file is empty.");
    if (f.size > MAX_MB * 1024 * 1024) return setRejected(`That file is over ${MAX_MB} MB.`);
    if (!familyOf(f.name)) return setRejected("That kind of file can't be split. Use Word, PowerPoint, Excel, CSV, PDF, audio or video.");
    reset();
    setRejected(null);
    setFile(f);
    void read(f);
  };
  const clear = () => {
    reset();
    readRef.current?.abort();
    setFile(null);
    setInfo(null);
    setReading("idle");
  };

  const estimate = info ? partsFor(info, plan) : { count: null, error: null };

  const start = async () => {
    if (!file || !info || estimate.error) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("plan", JSON.stringify(planFor(info, plan)));
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await uploadForm(ENDPOINT, form, {
        signal: ctrl.signal,
        fallbackName: "parts.zip",
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      const parts = isZip(out) ? await listZip(out.blob).catch(() => null) : null;
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, parts, meta: parseJobInfo(out.info) });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const step = !file ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const set = (patch: Partial<Plan>) => (reset(), setPlan((p) => ({ ...p, ...patch })));

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Your file is split on our server and deleted as soon as the parts are sent. Nothing is kept, and it&apos;s free.</>}
    >
      <div className="space-y-3 p-3 sm:p-4">
        {!file ? (
          <>
            <FileDrop
              accept={ACCEPT_ALL}
              title="Drop the file to split"
              formats={`Word, PowerPoint, Excel, CSV, PDF, audio or video · up to ${MAX_MB} MB`}
              error={rejected}
              onFile={choose}
            />
            <FamilyStrip />
          </>
        ) : (
          <FileRow file={file} noun={family ? FAMILIES[family].one : "file"} locked={busy} accept={ACCEPT_ALL} onReplace={choose} onClear={clear} />
        )}
        {file && rejected && (
          <p role="alert" className="px-1 text-sm text-danger">
            {rejected}
          </p>
        )}

        {file && family && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  backLabel="Split differently"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                  note={result.meta.notes.join(" ") || undefined}
                />
              </motion.div>
            ) : reading === "busy" ? (
              <motion.div key="reading" {...swap} className="rounded-md border border-dashed border-line px-4 py-5">
                <Measuring />
                <p className="mt-2 text-sm text-ink-2">
                  Reading your {FAMILIES[family].one}
                  {family === "word" || family === "slides" || family === "sheet" ? ": its pages, headings and sheets" : ""}…
                </p>
              </motion.div>
            ) : reading !== "idle" ? (
              <motion.div key="failed" {...swap}>
                <Notice tone="danger">
                  {reading}
                  <RetryLink onRetry={() => void read(file)} />
                </Notice>
              </motion.div>
            ) : info ? (
              <motion.div key="options" {...swap} className="space-y-3">
                <Options info={info} plan={plan} set={set} disabled={busy} />
                <ProgressButton
                  job={job}
                  disabled={Boolean(estimate.error)}
                  label={estimate.count ? `Split into ${plural(estimate.count, "part")}` : "Split the file"}
                  working="Splitting…"
                  hint={estimate.error ?? summary(info, plan, estimate.count)}
                  workingHint={family === "word" || family === "slides" || family === "sheet" ? "Older formats are opened in LibreOffice first; that takes a few seconds." : undefined}
                  onStart={start}
                  onCancel={() => abortRef.current?.abort()}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        )}
      </div>
    </Workbench>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Choosing the parts                                                                              */
/* ---------------------------------------------------------------------------------------------- */

function defaultBy(info: Info): string {
  if (info.family === "word") {
    if (info.headings?.["1"]) return "headings";
    if (info.breaks) return "breaks";
    if (info.pages) return "pages";
    return "headings";
  }
  if (info.family === "sheet") return (info.sheets?.length ?? 0) > 1 ? "sheets" : "rows";
  if (info.family === "audio" || info.family === "video") return "every";
  return "";
}

/** How many units the paged modes count: pages, slides, Word's sections or pages. */
function unitsFor(info: Info, plan: Plan): number {
  if (info.family === "word") return plan.by === "pages" ? (info.pages ?? 0) : (info.breaks ?? 0);
  return info.units;
}

function pagedCount(units: number, plan: Plan, noun: string): { count: number | null; error: string | null } {
  if (plan.mode === "each") return units > 1 ? { count: units, error: null } : { count: null, error: `There's only one ${noun}.` };
  if (plan.mode === "every") {
    const c = Math.ceil(units / Math.max(1, plan.n));
    return c > 1 ? { count: c, error: null } : { count: null, error: `With ${plan.n} per part, everything stays in one part.` };
  }
  if (!plan.ranges.trim()) return { count: null, error: `Type the ${noun}s for each part, like 1-3, 4-6.` };
  const parsed = parseRanges(plan.ranges.replace(/\+/g, ","));
  if (parsed.error) return { count: null, error: parsed.error };
  const bad = outOfBounds(parsed.parts, units);
  if (bad) return { count: null, error: bad.replace(/page/g, noun) };
  return { count: plan.ranges.split(",").filter((p) => p.trim()).length, error: null };
}

function partsFor(info: Info, plan: Plan): { count: number | null; error: string | null } {
  let r: { count: number | null; error: string | null };
  switch (info.family) {
    case "pdf":
    case "slides":
      r = pagedCount(info.units, plan, UNIT[info.family]!);
      break;
    case "word":
      if (plan.by === "headings") {
        const c = info.headings?.[String(plan.level)] ?? 0;
        r = c ? { count: c, error: null } : { count: null, error: `No level-${plan.level} headings to split at.` };
      } else r = pagedCount(unitsFor(info, plan), plan, plan.by === "pages" ? "page" : "section");
      break;
    case "sheet": {
      const sheet = info.sheets?.find((s) => s.name === plan.sheet) ?? info.sheets?.[0];
      if (plan.by === "sheets") r = { count: info.sheets?.length ?? null, error: null };
      else if (plan.by === "rows") {
        const c = Math.ceil((sheet?.rows ?? 0) / Math.max(1, plan.n));
        r = c > 1 ? { count: c, error: null } : { count: null, error: `That sheet has ${sheet?.rows ?? 0} rows, so it would stay in one part.` };
      } else r = { count: null, error: sheet?.columns.length ? null : "That sheet has no columns." };
      break;
    }
    default: {
      const d = info.duration ?? null;
      if (plan.by === "every") {
        if (plan.minutes <= 0) r = { count: null, error: "Say how long each part should be." };
        else r = { count: d ? Math.ceil(d / (plan.minutes * 60)) : null, error: d && d <= plan.minutes * 60 ? `It's ${clock(d)} long, so it would stay in one part.` : null };
      } else if (plan.by === "parts") r = { count: plan.parts, error: plan.parts < 2 ? "Split into at least 2 parts." : null };
      else {
        const pieces = plan.times.split(",").map((t) => t.trim()).filter(Boolean);
        const bad = pieces.find((t) => parseClock(t) === null);
        const outside = d ? pieces.map(parseClock).find((t) => t !== null && (t <= 0 || t >= d)) : undefined;
        r = !pieces.length
          ? { count: null, error: "Type the times to cut at, like 1:30, 4:00." }
          : bad
            ? { count: null, error: `“${bad}” isn't a time. Write times like 1:30 or 1:02:00.` }
            : outside !== undefined
              ? { count: null, error: `${clock(outside!)} is outside the file (${clock(d!)}).` }
              : { count: new Set(pieces.map(parseClock)).size + 1, error: null };
      }
    }
  }
  if (r.count && r.count > MAX_PARTS) return { count: r.count, error: `That makes ${r.count} parts; the most is ${MAX_PARTS}. Put more in each part.` };
  return r;
}

/** The plan as the backend's SplitPlan (backend/app/schemas/merge_split.py). */
function planFor(info: Info, plan: Plan): Record<string, unknown> {
  const paged = { mode: plan.mode, ...(plan.mode === "every" ? { n: plan.n } : {}), ...(plan.mode === "ranges" ? { ranges: plan.ranges.trim() } : {}) };
  switch (info.family) {
    case "pdf":
    case "slides":
      return paged;
    case "word":
      return plan.by === "headings" ? { by: "headings", level: plan.level } : { by: plan.by, ...paged };
    case "sheet":
      return plan.by === "sheets"
        ? { by: "sheets" }
        : plan.by === "rows"
          ? { by: "rows", n: plan.n, sheet: plan.sheet || undefined }
          : { by: "column", column: plan.column, sheet: plan.sheet || undefined };
    default:
      return plan.by === "every" ? { by: "every", seconds: plan.minutes * 60 } : plan.by === "parts" ? { by: "parts", n: plan.parts } : { by: "times", times: plan.times };
  }
}

function summary(info: Info, plan: Plan, count: number | null): string {
  const n = count ? plural(count, "part") : "A part per value";
  if (info.family === "sheet" && plan.by === "column") {
    const sheet = info.sheets?.find((s) => s.name === plan.sheet) ?? info.sheets?.[0];
    return `A part for each value in “${sheet?.columns[plan.column] || `column ${plan.column + 1}`}”, headings repeated in each. All parts come in one ZIP.`;
  }
  return `${n}, in one ZIP.`;
}

function Options({ info, plan, set, disabled }: { info: Info; plan: Plan; set: (p: Partial<Plan>) => void; disabled: boolean }) {
  const fam = info.family;
  return (
    <Panel>
      {fam === "pdf" && <Paged units={info.units} noun="page" plan={plan} set={set} disabled={disabled} />}
      {fam === "slides" && (
        <>
          <Paged units={info.units} noun="slide" plan={plan} set={set} disabled={disabled} />
          {info.titles?.length ? <Contents label="Slides" items={info.titles} /> : null}
        </>
      )}
      {fam === "word" && <WordOptions info={info} plan={plan} set={set} disabled={disabled} />}
      {fam === "sheet" && <SheetOptions info={info} plan={plan} set={set} disabled={disabled} />}
      {(fam === "audio" || fam === "video") && <MediaOptions info={info} plan={plan} set={set} disabled={disabled} />}
    </Panel>
  );
}

function Paged({ units, noun, plan, set, disabled }: { units: number; noun: string; plan: Plan; set: (p: Partial<Plan>) => void; disabled: boolean }) {
  return (
    <Row label="Parts" hint={plural(units, noun)}>
      <Chips
        value={plan.mode}
        onChange={(v) => set({ mode: v })}
        disabled={disabled}
        options={[
          { value: "each", label: `Every ${noun} on its own` },
          { value: "every", label: `Every few ${noun}s` },
          { value: "ranges", label: "Ranges I type" },
        ]}
      />
      {plan.mode === "every" && (
        <div className="mt-2.5">
          <CountField value={plan.n} onChange={(n) => set({ n })} max={Math.max(1, units)} unit={`${noun}s per part`} label={`${noun}s per part`} disabled={disabled} />
        </div>
      )}
      {plan.mode === "ranges" && (
        <div className="mt-2.5">
          <LineField
            value={plan.ranges}
            onChange={(ranges) => set({ ranges })}
            placeholder={units > 3 ? `1-${Math.min(3, units - 1)}, ${Math.min(4, units)}-${units}` : "1, 2"}
            label={`${noun}s for each part`}
            hint={`Commas separate parts; + joins ranges into one part (1-3+5). ${noun[0].toUpperCase() + noun.slice(1)}s 1 to ${units}.`}
            disabled={disabled}
          />
        </div>
      )}
    </Row>
  );
}

function WordOptions({ info, plan, set, disabled }: { info: Info; plan: Plan; set: (p: Partial<Plan>) => void; disabled: boolean }) {
  const h = info.headings ?? {};
  return (
    <>
      <Row label="Split at">
        <Chips
          value={plan.by}
          onChange={(by) => set({ by, mode: "each" })}
          disabled={disabled}
          options={[
            { value: "headings", label: "Headings", disabled: !h["1"] && !h["2"] && !h["3"], title: "Chapters and sections, as the document's heading styles mark them" },
            { value: "breaks", label: "Page breaks", disabled: !info.breaks, title: info.breaks ? undefined : "This document has no page or section breaks" },
            { value: "pages", label: "Pages", disabled: !info.pages, title: info.pages ? "As Word last laid the pages out" : "Word didn't record pages in this file" },
          ]}
        />
      </Row>
      {plan.by === "headings" && (
        <Row label="Level">
          <Chips
            value={plan.level}
            onChange={(level) => set({ level })}
            disabled={disabled}
            options={([1, 2, 3] as const).map((l) => ({ value: l, label: `${l === 1 ? "Heading 1" : `Headings 1–${l}`} · ${h[String(l)] ? plural(h[String(l)], "part") : "none"}`, disabled: !h[String(l)] }))}
          />
          {plan.level === 1 && info.titles?.length ? <Contents label="Parts" items={info.titles} /> : null}
        </Row>
      )}
      {plan.by === "breaks" && <Paged units={info.breaks ?? 0} noun="section" plan={plan} set={set} disabled={disabled} />}
      {plan.by === "pages" && <Paged units={info.pages ?? 0} noun="page" plan={plan} set={set} disabled={disabled} />}
    </>
  );
}

function SheetOptions({ info, plan, set, disabled }: { info: Info; plan: Plan; set: (p: Partial<Plan>) => void; disabled: boolean }) {
  const sheets = info.sheets ?? [];
  const sheet = sheets.find((s) => s.name === plan.sheet) ?? sheets[0];
  return (
    <>
      <Row label="Split by">
        <Chips
          value={plan.by}
          onChange={(by) => set({ by })}
          disabled={disabled}
          options={[
            { value: "sheets", label: "Each sheet", disabled: sheets.length < 2, title: sheets.length < 2 ? "There's only one sheet" : undefined },
            { value: "rows", label: "Every N rows" },
            { value: "column", label: "A column's values" },
          ]}
        />
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          {plan.by === "sheets"
            ? `${plural(sheets.length, "workbook")}, one per sheet, with its formatting.`
            : plan.by === "rows"
              ? "The heading row is repeated at the top of every part."
              : "One file per value (per region, per customer…), heading row in each."}
        </p>
      </Row>
      {plan.by !== "sheets" && sheets.length > 1 && (
        <Row label="Sheet">
          <Select value={sheet?.name ?? ""} onChange={(v) => set({ sheet: v, column: 0 })} disabled={disabled} label="Sheet">
            {sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} · {s.rows.toLocaleString("en")} rows
              </option>
            ))}
          </Select>
        </Row>
      )}
      {plan.by === "rows" && (
        <Row label="Rows per part" hint={`${(sheet?.rows ?? 0).toLocaleString("en")} rows`}>
          <CountField value={plan.n} onChange={(n) => set({ n })} unit="rows per part" label="Rows per part" disabled={disabled} />
        </Row>
      )}
      {plan.by === "column" && (
        <Row label="Column">
          <Select value={String(plan.column)} onChange={(v) => set({ column: Number(v) })} disabled={disabled} label="Column">
            {(sheet?.columns ?? []).map((c, i) => (
              <option key={i} value={i}>
                {c || `Column ${i + 1}`}
              </option>
            ))}
          </Select>
        </Row>
      )}
    </>
  );
}

function MediaOptions({ info, plan, set, disabled }: { info: Info; plan: Plan; set: (p: Partial<Plan>) => void; disabled: boolean }) {
  const d = info.duration ?? null;
  return (
    <Row label="Parts" hint={d ? `${clock(d)} long` : undefined}>
      <Chips
        value={plan.by}
        onChange={(by) => set({ by })}
        disabled={disabled}
        options={[
          { value: "every", label: "Every few minutes" },
          { value: "parts", label: "Equal parts" },
          { value: "times", label: "At times I type" },
        ]}
      />
      <div className="mt-2.5">
        {plan.by === "every" && <CountField value={plan.minutes} onChange={(minutes) => set({ minutes })} unit="minutes per part" label="Minutes per part" disabled={disabled} />}
        {plan.by === "parts" && <CountField value={plan.parts} onChange={(parts) => set({ parts })} min={2} max={MAX_PARTS} unit="parts" label="Number of parts" disabled={disabled} />}
        {plan.by === "times" && (
          <LineField
            value={plan.times}
            onChange={(times) => set({ times })}
            placeholder={d && d > 60 ? `${clock(d / 3)}, ${clock((2 * d) / 3)}` : "0:30, 1:00"}
            label="Times to cut at"
            hint="Commas between times, like 1:30, 4:00 or 1:02:00."
            disabled={disabled}
          />
        )}
      </div>
      <p className="mt-2.5 text-xs text-ink-3">Cut without re-encoding, so it&apos;s quick and the quality is untouched.</p>
    </Row>
  );
}

function Select({ value, onChange, disabled, label, children }: { value: string; onChange: (v: string) => void; disabled: boolean; label: string; children: React.ReactNode }) {
  return (
    <span className="relative block w-full sm:max-w-sm">
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full appearance-none rounded-md border border-line bg-surface pl-3 pr-9 text-sm text-ink focus:border-ink focus:outline-none focus:ring-4 focus:ring-accent/15"
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

/** Slide titles or chapter names, so ranges can be typed knowing what's where. */
function Contents({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="label-mono text-ink-3">{label}</p>
      <ol className="mt-1.5 max-h-48 overflow-y-auto overscroll-contain rounded-sm border border-line" data-lenis-prevent>
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 border-b border-line px-2.5 py-1.5 text-[13px] last:border-b-0">
            <span className="w-6 shrink-0 font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0 truncate text-ink-2">{t || <span className="text-ink-3">Untitled</span>}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
