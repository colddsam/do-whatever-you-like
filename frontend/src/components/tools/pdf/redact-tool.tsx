"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { postFormJson } from "@/lib/files";
import { cn } from "@/lib/utils";
import { Notice, Panel, Row, TextField, Toggle } from "./kit";
import { EditableBox, fractionAt, normalize, PageNav, PageView, type Box } from "./page-stage";
import { messageOf, nextId, plural } from "./parts";
import { PdfTask, type TaskContext } from "./task";

type Area = { id: string; page: number; box: Box; found?: string };
type Match = { page: number; text: string; box: Box };

const PRESETS = [
  { id: "email", label: "Email addresses" },
  { id: "phone", label: "Phone numbers" },
  { id: "card", label: "Card numbers" },
  { id: "date", label: "Dates" },
  { id: "url", label: "Web links" },
  { id: "ssn", label: "US SSNs" },
  { id: "iban", label: "IBANs" },
] as const;

/** Redact PDF: find details to hide (or draw boxes), check every one on the page, then black them out for good. */
export function RedactTool({ toolId }: { toolId: string }) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [clean, setClean] = useState(true);
  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint="/api/tools/pdf/redact"
      dropTitle="Drop the PDF to redact"
      label={`Black out ${plural(areas.length, "area")}`}
      working="Redacting…"
      invalid={() => (areas.length ? null : "Find something to hide, or draw a box on a page.")}
      fields={() => [
        ["areas", JSON.stringify(areas.map((a) => ({ page: a.page, box: a.box })))],
        ["clean_metadata", String(clean)],
      ]}
      backLabel="Mark more"
      resultNote="What was under each box is gone from the file, not just covered: it can't be selected, copied or searched."
      options={(ctx) => <Redactor ctx={ctx} areas={areas} setAreas={setAreas} clean={clean} setClean={setClean} />}
    />
  );
}

function Redactor({
  ctx,
  areas,
  setAreas,
  clean,
  setClean,
}: {
  ctx: TaskContext;
  areas: Area[];
  setAreas: React.Dispatch<React.SetStateAction<Area[]>>;
  clean: boolean;
  setClean: (v: boolean) => void;
}) {
  const doc = ctx.doc!;
  const total = doc.upload.pages;
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [terms, setTerms] = useState<string[]>([]);
  const [presets, setPresets] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const current = Math.min(page, total);
  const size = doc.upload.sizes?.[current - 1];
  const marked = useMemo(() => new Set(areas.map((a) => a.page)), [areas]);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    areas.forEach((a) => m.set(a.found ?? "Drawn by hand", (m.get(a.found ?? "Drawn by hand") ?? 0) + 1));
    return [...m.entries()];
  }, [areas]);

  const addTerm = () => {
    const t = term.trim();
    if (t && !terms.includes(t)) setTerms((v) => [...v, t]);
    setTerm("");
  };

  const find = async () => {
    const list = term.trim() && !terms.includes(term.trim()) ? [...terms, term.trim()] : terms;
    if (term.trim()) addTerm();
    if (!list.length && !presets.length) return;
    setSearching(true);
    setSearchNote(null);
    const form = new FormData();
    form.append("token", doc.upload.token);
    form.append("search", JSON.stringify({ terms: list.map((text) => ({ text })), presets }));
    try {
      const res = await postFormJson<{ matches: Match[]; truncated: boolean }>("/api/tools/pdf/redact-find", form);
      const label = (m: Match) => {
        const preset = PRESETS.find((p) => p.id === m.text);
        return preset ? preset.label : m.text;
      };
      setAreas((prev) => {
        const key = (a: { page: number; box: Box }) => `${a.page}:${a.box.x0.toFixed(4)}:${a.box.y0.toFixed(4)}`;
        const seen = new Set(prev.map(key));
        const fresh = res.matches.filter((m) => !seen.has(key(m))).map((m) => ({ id: nextId(), page: m.page, box: m.box, found: label(m) }));
        return [...prev, ...fresh];
      });
      const pagesHit = new Set(res.matches.map((m) => m.page));
      setSearchNote(
        res.matches.length
          ? {
              tone: "info",
              text: `Found ${plural(res.matches.length, "match", "matches")} on ${plural(pagesHit.size, "page")}${res.truncated ? " (the first 2,000)" : ""}. Check each one on the pages: to leave one visible, click its box and press Delete.`,
            }
          : { tone: "info", text: "Nothing found. Scanned pages have no text to search: draw boxes on them instead." },
      );
      if (res.matches.length) setPage(Math.min(...res.matches.map((m) => m.page)));
    } catch (e) {
      setSearchNote({ tone: "danger", text: messageOf(e) });
    } finally {
      setSearching(false);
    }
  };

  const remove = (id: string) => {
    setAreas((v) => v.filter((a) => a.id !== id));
    setSelected(null);
  };

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px] md:items-start">
      <div className="space-y-2">
        <p className="text-xs text-ink-3">Drag on the page to cover an area by hand. Click a box to select it; Delete removes it.</p>
        <div className="mx-auto w-full max-w-[560px]">
          <PageView
            token={doc.upload.token}
            page={current}
            size={size}
            overlayClassName="cursor-crosshair touch-none"
            overlayProps={{
              onKeyDown: (e) => {
                if ((e.key === "Delete" || e.key === "Backspace") && selected) {
                  e.preventDefault();
                  remove(selected);
                }
              },
              onPointerDown: (e) => {
                if (ctx.locked || e.button !== 0) return;
                setSelected(null);
                const stage = e.currentTarget;
                const a = fractionAt(stage, e.clientX, e.clientY);
                stage.setPointerCapture(e.pointerId);
                let last: Box | null = null;
                const moveFn = (ev: PointerEvent) => {
                  last = normalize(a, fractionAt(stage, ev.clientX, ev.clientY));
                  setDraft(last);
                };
                const upFn = () => {
                  stage.removeEventListener("pointermove", moveFn);
                  stage.removeEventListener("pointerup", upFn);
                  setDraft(null);
                  const b = last as Box | null;
                  if (b && b.x1 - b.x0 > 0.01 && b.y1 - b.y0 > 0.005) {
                    const id = nextId();
                    setAreas((v) => [...v, { id, page: current, box: b }]);
                    setSelected(id);
                  }
                };
                stage.addEventListener("pointermove", moveFn);
                stage.addEventListener("pointerup", upFn);
              },
            }}
          >
            {() => (
              <>
                {areas
                  .filter((a) => a.page === current)
                  .map((a) => (
                    <EditableBox
                      key={a.id}
                      box={a.box}
                      selected={selected === a.id}
                      onSelect={() => setSelected(a.id)}
                      onChange={(box) => setAreas((v) => v.map((x) => (x.id === a.id ? { ...x, box } : x)))}
                      minSize={0.005}
                      label={`Redaction${a.found ? ` (${a.found})` : ""} on page ${current}. Delete removes it.`}
                      className="bg-ink/80"
                    >
                      {selected === a.id && (
                        <button
                          type="button"
                          aria-label="Remove this redaction"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => remove(a.id)}
                          className="absolute -right-3 -top-3 z-20 inline-flex size-6 items-center justify-center rounded-full border border-ink bg-surface text-ink"
                        >
                          <X aria-hidden className="size-3.5" />
                        </button>
                      )}
                    </EditableBox>
                  ))}
                {draft && <div className="pointer-events-none absolute bg-ink/60 ring-1 ring-ink" style={{ left: `${draft.x0 * 100}%`, top: `${draft.y0 * 100}%`, width: `${(draft.x1 - draft.x0) * 100}%`, height: `${(draft.y1 - draft.y0) * 100}%` }} />}
              </>
            )}
          </PageView>
        </div>
        <div className="mx-auto max-w-[560px]">
          <PageNav page={current} pages={total} onChange={(p) => (setPage(p), setSelected(null))} marked={marked} disabled={ctx.locked} />
        </div>
      </div>

      <Panel className="md:sticky md:top-24">
        <Row label="Find text">
          <div className="flex gap-1.5">
            <div className="min-w-0 flex-1">
              <TextField value={term} onChange={setTerm} label="Word or phrase to find" placeholder="A name, a number…" disabled={ctx.locked} maxLength={200} />
            </div>
            <button
              type="button"
              onClick={addTerm}
              disabled={ctx.locked || !term.trim()}
              aria-label="Add to the search"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:border-ink-3 disabled:opacity-40"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </div>
          {terms.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {terms.map((t) => (
                <button key={t} type="button" onClick={() => setTerms((v) => v.filter((x) => x !== t))} className="inline-flex h-8 items-center gap-1 rounded-sm border border-ink bg-ink px-2.5 text-[13px] text-paper" aria-label={`Remove ${t}`}>
                  {t} <X aria-hidden className="size-3 text-paper-dim" />
                </button>
              ))}
            </div>
          )}
        </Row>
        <Row label="Or find every">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const on = presets.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  disabled={ctx.locked}
                  onClick={() => setPresets((v) => (on ? v.filter((x) => x !== p.id) : [...v, p.id]))}
                  className={cn("inline-flex h-8 items-center rounded-sm border px-2.5 text-[13px] transition-colors", on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink")}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={find}
            disabled={ctx.locked || searching || (!terms.length && !term.trim() && !presets.length)}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-ink bg-surface text-sm font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
          >
            {searching ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Search aria-hidden className="size-4" />}
            {searching ? "Searching…" : "Find and mark"}
          </button>
          {searchNote && (
            <Notice tone={searchNote.tone} className="mt-2.5">
              {searchNote.text}
            </Notice>
          )}
        </Row>
        <Row label="Marked" hint={areas.length ? plural(areas.length, "box", "boxes") : undefined}>
          {groups.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {groups.map(([label, count]) => (
                <li key={label} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{label}</span>
                  <span className="font-mono text-xs text-ink-3">{count}</span>
                  <button
                    type="button"
                    disabled={ctx.locked}
                    onClick={() => setAreas((v) => v.filter((a) => (a.found ?? "Drawn by hand") !== label))}
                    aria-label={`Unmark ${label}`}
                    className="inline-flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-paper-2 hover:text-ink"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-3">Nothing yet.</p>
          )}
        </Row>
        <Row label="Also">
          <Toggle checked={clean} onChange={setClean} disabled={ctx.locked} label="Remove hidden details" description="Author, title, attachments, scripts and other data that travels inside the file." />
        </Row>
      </Panel>
    </div>
  );
}
