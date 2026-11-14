"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Filter,
  Globe2,
  Link2,
  MessageSquareText,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  Users,
  Check,
  Copy,
} from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import {
  SAMPLE_CHATS,
  analyzeWhatsappChat,
  decodeChatBytes,
  extractChatTextFromZip,
  formatWhatsappCsv,
  formatWhatsappHtmlReport,
  formatWhatsappJson,
  formatWhatsappTextSummary,
  parseWhatsappChat,
  type ChatAnalysis,
  type ChatMessage,
  type DateOrder,
  type ParsedChat,
  type TimelinePoint,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Notice, Panel, Toggle } from "../pdf/kit";

type TabId = "overview" | "people" | "timing" | "language" | "messages";
type TimelineGrain = "auto" | "daily" | "weekly" | "monthly";
type MsgKindFilter = "all" | "media" | "links" | "questions" | "edited" | "deleted" | "system";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People" },
  { id: "timing", label: "Timing" },
  { id: "language", label: "Words & emojis" },
  { id: "messages", label: "Messages & export" },
];

const SENDER_COLORS = ["#EB4A10", "#0F8B8D", "#15140F", "#B7791F"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const PAGE_SIZE = 50;
const noop = () => () => {};

function fmtMinutes(min: number | null): string {
  if (min === null) return "—";
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function WhatsappAnalyzer({ toolId }: { toolId: string }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const tool = getTool(toolId)!;
  const [step, setStep] = useState(0);

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer="Analyzed locally in your browser. Zero uploads, zero AI server calls, 100% free — your chat never leaves this device."
    >
      {mounted ? <Analyzer onStep={setStep} /> : <div className="m-4 h-96 animate-pulse rounded-md bg-paper-2" />}
    </Workbench>
  );
}

function Analyzer({ onStep }: { onStep: (s: number) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rawText, setRawText] = useState<string>("");
  const [sourceName, setSourceName] = useState<string>("");
  const [archiveCount, setArchiveCount] = useState<number | undefined>(undefined);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Parsing / analysis options
  const [dateOrder, setDateOrder] = useState<DateOrder>("auto");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
  const [includeSystem, setIncludeSystem] = useState(true);
  const [hideStopwords, setHideStopwords] = useState(true);

  // UI view state
  const [tab, setTab] = useState<TabId>("overview");
  const [grain, setGrain] = useState<TimelineGrain>("auto");
  const [searchQuery, setSearchQuery] = useState("");
  const [msgKind, setMsgKind] = useState<MsgKindFilter>("all");
  const [newestFirst, setNewestFirst] = useState(false);
  const [page, setPage] = useState(0);
  const [copiedSummary, setCopiedSummary] = useState(false);

  const parsed: ParsedChat | null = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseWhatsappChat(rawText, { dateOrder, archiveEntriesCount: archiveCount });
  }, [rawText, dateOrder, archiveCount]);

  const analysis: ChatAnalysis | null = useMemo(() => {
    if (!parsed || parsed.messages.length === 0) return null;
    return analyzeWhatsappChat(parsed, {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      senders: selectedSenders.length > 0 ? selectedSenders : undefined,
      includeSystem,
      hideStopwords,
    });
  }, [parsed, fromDate, toDate, selectedSenders, includeSystem, hideStopwords]);

  const loadChat = (text: string, name: string, entriesCount?: number) => {
    setError(null);
    const check = parseWhatsappChat(text, { dateOrder: "auto", archiveEntriesCount: entriesCount });
    if (check.messages.length === 0) {
      setError(
        "No WhatsApp messages could be recognized in that input. Make sure it is a WhatsApp 'Export Chat' .txt or .zip file (or paste lines starting with WhatsApp date & time headers).",
      );
      return;
    }
    setRawText(text);
    setSourceName(name);
    setArchiveCount(entriesCount);
    setDateOrder("auto");
    setFromDate("");
    setToDate("");
    setSelectedSenders([]);
    setIncludeSystem(true);
    setSearchQuery("");
    setMsgKind("all");
    setPage(0);
    setTab("overview");
    setPasteMode(false);
    onStep(1);
  };

  const handleFile = async (file: File) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const lower = file.name.toLowerCase();
      const buf = new Uint8Array(await file.arrayBuffer());
      if (lower.endsWith(".zip")) {
        const extracted = extractChatTextFromZip(buf);
        loadChat(extracted.text, `${file.name} · ${extracted.fileName}`, extracted.archiveEntriesCount);
      } else if (lower.endsWith(".txt") || file.type.startsWith("text/")) {
        const text = decodeChatBytes(buf);
        loadChat(text, `${file.name} (${formatBytes(file.size)})`);
      } else {
        setError(`Unsupported file "${file.name}". Upload a WhatsApp exported .txt or .zip archive.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setRawText("");
    setSourceName("");
    setArchiveCount(undefined);
    setError(null);
    setFromDate("");
    setToDate("");
    setSelectedSenders([]);
    setSearchQuery("");
    onStep(0);
  };

  const toggleSender = (sender: string) => {
    setPage(0);
    setSelectedSenders((prev) => (prev.includes(sender) ? prev.filter((s) => s !== sender) : [...prev, sender]));
  };

  const resetFilters = () => {
    setFromDate("");
    setToDate("");
    setSelectedSenders([]);
    setIncludeSystem(true);
    setPage(0);
  };

  const jumpToSearch = (term: string) => {
    setSearchQuery(term);
    setMsgKind("all");
    setPage(0);
    setTab("messages");
    onStep(2);
  };

  const handleExport = (kind: "json" | "csv" | "html") => {
    if (!parsed || !analysis) return;
    const base = (sourceName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40) || "whatsapp-chat").replace(/^-|-$/g, "");
    if (kind === "json") {
      saveBlob(new Blob([formatWhatsappJson(parsed, analysis)], { type: "application/json;charset=utf-8" }), `${base}-report.json`);
    } else if (kind === "csv") {
      saveBlob(new Blob([formatWhatsappCsv(analysis)], { type: "text/csv;charset=utf-8" }), `${base}-stats.csv`);
    } else {
      saveBlob(new Blob([formatWhatsappHtmlReport(sourceName || "WhatsApp Chat", analysis)], { type: "text/html;charset=utf-8" }), `${base}-summary.html`);
    }
    onStep(2);
  };

  const handleCopySummary = async () => {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(formatWhatsappTextSummary(analysis));
      setCopiedSummary(true);
      onStep(2);
      setTimeout(() => setCopiedSummary(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const filtersActive = Boolean(fromDate || toDate || selectedSenders.length > 0 || !includeSystem);

  if (!parsed || !analysis) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        {error && <Notice tone="danger">{error}</Notice>}

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            {!pasteMode ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition-colors",
                  dragActive ? "border-accent bg-accent/5" : "border-line bg-paper/60 hover:border-ink-3",
                )}
              >
                <span className="flex size-12 items-center justify-center rounded-full border border-line bg-surface text-ink">
                  {busy ? <FileArchive className="size-5 animate-pulse" /> : <Upload className="size-5" />}
                </span>
                <p className="mt-4 text-base font-medium text-ink">
                  Drop your exported WhatsApp <span className="font-mono">.txt</span> or <span className="font-mono">.zip</span> here
                </p>
                <p className="mt-1.5 max-w-md text-sm text-ink-2">
                  Works with iOS, Android &amp; Desktop exports in any language (Hindi, Arabic, Spanish, Chinese, English, RTL/LTR &amp; emojis).
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.zip,text/plain,application/zip"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper transition-colors hover:bg-ink/90"
                  >
                    <Upload aria-hidden className="size-4" />
                    Choose .txt or .zip file
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasteMode(true)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
                  >
                    <FileText aria-hidden className="size-4" />
                    Paste chat text
                  </button>
                </div>
              </div>
            ) : (
              <Panel className="space-y-3 bg-paper/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="wa-paste-input" className="text-sm font-medium text-ink">
                    Paste WhatsApp exported lines
                  </label>
                  <button
                    type="button"
                    onClick={() => setPasteMode(false)}
                    className="text-xs font-medium text-ink-2 underline decoration-line underline-offset-4 hover:text-ink"
                  >
                    Back to file upload
                  </button>
                </div>
                <textarea
                  id="wa-paste-input"
                  value={pasteDraft}
                  onChange={(e) => setPasteDraft(e.target.value)}
                  rows={8}
                  dir="auto"
                  placeholder="02/11/2026, 09:14 - Maya: Morning everyone!&#10;[10/11/2026, 9:05:12 AM] Aarav: नमस्ते दोस्तों!"
                  className="w-full rounded-md border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-3">Nothing is sent to any server — parsed directly in browser memory.</span>
                  <button
                    type="button"
                    disabled={!pasteDraft.trim()}
                    onClick={() => loadChat(pasteDraft, "Pasted WhatsApp chat")}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-paper transition-colors hover:bg-ink/90 disabled:opacity-40"
                  >
                    <Sparkles aria-hidden className="size-4" />
                    Analyze pasted chat
                  </button>
                </div>
              </Panel>
            )}

            <div className="space-y-2">
              <p className="label-mono text-ink-3">Try a sample export</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {SAMPLE_CHATS.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => loadChat(sample.text, sample.label)}
                    className="flex flex-col items-start rounded-md border border-line bg-surface p-3.5 text-left transition-colors hover:border-ink-3"
                  >
                    <span className="text-sm font-medium text-ink">{sample.label}</span>
                    <span className="mt-1 text-xs leading-relaxed text-ink-2">{sample.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 lg:col-span-5">
            <Panel className="space-y-3.5 bg-paper/50">
              <div className="flex items-center gap-2">
                <Globe2 aria-hidden className="size-4 text-accent" />
                <h2 className="text-sm font-semibold text-ink">How to export from WhatsApp</h2>
              </div>
              <dl className="space-y-3 text-sm">
                <div className="border-t border-line pt-2.5">
                  <dt className="font-medium text-ink">iPhone (iOS)</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-2">
                    Open the chat → tap the contact or group name → scroll down → <strong className="font-medium text-ink">Export Chat</strong> → choose <strong className="font-medium text-ink">Without Media</strong> (faster) or <strong className="font-medium text-ink">Attach Media</strong> (.zip).
                  </dd>
                </div>
                <div className="border-t border-line pt-2.5">
                  <dt className="font-medium text-ink">Android</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-2">
                    Open the chat → tap <strong className="font-medium text-ink">⋮</strong> (menu) → <strong className="font-medium text-ink">More</strong> → <strong className="font-medium text-ink">Export chat</strong> → <strong className="font-medium text-ink">Without media</strong> (.txt) or <strong className="font-medium text-ink">Include media</strong> (.zip).
                  </dd>
                </div>
                <div className="border-t border-line pt-2.5">
                  <dt className="font-medium text-ink">Every language &amp; format supported</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-2">
                    Automatically handles 12h/24h clocks, DMY/MDY/YMD date order, localized digits, AM/PM tokens, ZIP archives, edited/deleted markers, and non-Latin scripts.
                  </dd>
                </div>
              </dl>
            </Panel>

            <Notice tone="info">
              Free &amp; local by design: ZIP unpacking and analytics run inside your browser tab with zero server cost or data retention.
            </Notice>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* Top Source & Format Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-semibold text-ink">{sourceName || "WhatsApp chat"}</span>
            <span className="label-mono rounded-full border border-line bg-paper px-2.5 py-0.5 text-ink-2">
              {parsed.exportStyle === "ios-bracket" ? "iOS / bracketed" : parsed.exportStyle === "android-dash" ? "Android dashed" : "Mixed format"}
            </span>
            <span className="label-mono rounded-full border border-line bg-paper px-2.5 py-0.5 text-ink-2">
              {parsed.dateOrder.toUpperCase()}
            </span>
            {parsed.archiveEntriesCount ? (
              <span className="label-mono rounded-full border border-line bg-paper px-2.5 py-0.5 text-ink-2">
                {parsed.archiveEntriesCount} archive items
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-ink-2">
            {parsed.messages.length.toLocaleString()} parsed events · {parsed.minDate} to {parsed.maxDate} · {parsed.senders.length} participants
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <span>Date order</span>
            <select
              aria-label="Date order"
              value={dateOrder}
              onChange={(e) => {
                setDateOrder(e.target.value as DateOrder);
                setFromDate("");
                setToDate("");
              }}
              className="h-9 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink focus:border-ink focus:outline-none"
            >
              <option value="auto">Auto ({parsed.dateOrder.toUpperCase()})</option>
              <option value="dmy">DD/MM/YYYY</option>
              <option value="mdy">MM/DD/YYYY</option>
              <option value="ymd">YYYY-MM-DD</option>
            </select>
          </label>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-xs font-medium text-ink transition-colors hover:border-ink-3"
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Load another chat
          </button>
        </div>
      </div>

      {parsed.ambiguousDateOrder && dateOrder === "auto" && (
        <Notice tone="warning">
          All day numbers in this export are 12 or under, so DMY and MDY are both valid. Switch <strong>Date order</strong> above if months and days look swapped.
        </Notice>
      )}

      {/* Filter Bar */}
      <Panel className="space-y-3 bg-paper/45">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
              <Filter aria-hidden className="size-3.5 text-ink-3" />
              Filters
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span>From</span>
              <input
                type="date"
                value={fromDate}
                min={parsed.minDate}
                max={toDate || parsed.maxDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(0);
                }}
                className="h-9 rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-ink focus:outline-none"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span>To</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || parsed.minDate}
                max={parsed.maxDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(0);
                }}
                className="h-9 rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-ink focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              checked={includeSystem}
              onChange={(v) => {
                setIncludeSystem(v);
                setPage(0);
              }}
              label="Include system notices"
            />
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-8 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {parsed.senders.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
            <span className="mr-1 text-xs text-ink-3">People:</span>
            <button
              type="button"
              onClick={() => {
                setSelectedSenders([]);
                setPage(0);
              }}
              className={cn(
                "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                selectedSenders.length === 0 ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3",
              )}
            >
              All ({parsed.senders.length})
            </button>
            {parsed.senders.slice(0, 24).map((sender) => {
              const active = selectedSenders.includes(sender);
              return (
                <button
                  key={sender}
                  type="button"
                  onClick={() => toggleSender(sender)}
                  className={cn(
                    "min-h-8 max-w-[14rem] truncate rounded-full border px-3 text-xs font-medium transition-colors",
                    active ? "border-accent bg-accent text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  {sender}
                </button>
              );
            })}
            {parsed.senders.length > 24 && (
              <span className="text-xs text-ink-3">+{parsed.senders.length - 24} more in People tab</span>
            )}
          </div>
        )}
      </Panel>

      {/* Navigation Tabs */}
      <div role="tablist" aria-label="Chat analysis sections" className="flex gap-1.5 overflow-x-auto border-b border-line pb-2">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => {
                setTab(t.id);
                onStep(t.id === "messages" ? 2 : 1);
              }}
              className={cn(
                "min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors",
                active ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {t.label}
              {t.id === "people" && <span className="ml-1.5 font-mono text-xs opacity-75">{analysis.participantCount}</span>}
              {t.id === "messages" && <span className="ml-1.5 font-mono text-xs opacity-75">{analysis.totalMessages.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <OverviewTab
          analysis={analysis}
          grain={grain}
          onGrain={setGrain}
          onSelectSenderTab={() => setTab("people")}
        />
      )}
      {tab === "people" && <PeopleTab analysis={analysis} />}
      {tab === "timing" && <TimingTab analysis={analysis} />}
      {tab === "language" && (
        <LanguageTab
          analysis={analysis}
          hideStopwords={hideStopwords}
          onHideStopwords={setHideStopwords}
          onSearchTerm={jumpToSearch}
        />
      )}
      {tab === "messages" && (
        <MessagesTab
          analysis={analysis}
          searchQuery={searchQuery}
          onSearchQuery={(q) => {
            setSearchQuery(q);
            setPage(0);
          }}
          msgKind={msgKind}
          onMsgKind={(k) => {
            setMsgKind(k);
            setPage(0);
          }}
          newestFirst={newestFirst}
          onNewestFirst={(v) => {
            setNewestFirst(v);
            setPage(0);
          }}
          page={page}
          onPage={setPage}
          copiedSummary={copiedSummary}
          onCopySummary={handleCopySummary}
          onExport={handleExport}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-paper/55 p-3.5">
      <p className="label-mono text-ink-3">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-ink-2">{hint}</p>}
    </div>
  );
}

function OverviewTab({
  analysis,
  grain,
  onGrain,
  onSelectSenderTab,
}: {
  analysis: ChatAnalysis;
  grain: TimelineGrain;
  onGrain: (g: TimelineGrain) => void;
  onSelectSenderTab: () => void;
}) {
  const effectiveGrain: Exclude<TimelineGrain, "auto"> =
    grain === "auto"
      ? analysis.daily.length <= 45
        ? "daily"
        : analysis.weekly.length <= 52
          ? "weekly"
          : "monthly"
      : grain;

  const series: TimelinePoint[] =
    effectiveGrain === "daily" ? analysis.daily : effectiveGrain === "weekly" ? analysis.weekly : analysis.monthly;

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const topSeriesSenders = useMemo(() => analysis.senders.slice(0, 3).map((s) => s.sender), [analysis.senders]);
  const maxVal = useMemo(() => Math.max(1, ...series.map((p) => p.count)), [series]);
  const activePoint = hoveredIdx !== null && series[hoveredIdx] ? series[hoveredIdx] : series[series.length - 1] ?? null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Messages"
          value={analysis.userMessages.toLocaleString()}
          hint={`${analysis.avgPerActiveDay}/active day`}
        />
        <KpiCard
          label="Words"
          value={analysis.totalWords.toLocaleString()}
          hint={analysis.userMessages ? `${(analysis.totalWords / analysis.userMessages).toFixed(1)} per msg` : "—"}
        />
        <KpiCard
          label="Participants"
          value={String(analysis.participantCount)}
          hint={`${analysis.activeDays} active / ${analysis.calendarSpanDays}d`}
        />
        <KpiCard
          label="Media & files"
          value={analysis.totalMedia.toLocaleString()}
          hint={`${analysis.totalLinks} link${analysis.totalLinks === 1 ? "" : "s"} · ${analysis.totalQuestions} question${analysis.totalQuestions === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Emojis"
          value={analysis.totalEmojis.toLocaleString()}
          hint={`${analysis.uniqueEmojis} unique emojis`}
        />
        <KpiCard
          label="Best streak"
          value={`${analysis.longestStreakDays}d`}
          hint={analysis.longestStreakRange ? `${analysis.longestStreakRange[0]}` : "—"}
        />
      </div>

      {/* Activity Timeline */}
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Message volume over time</h3>
            <p className="text-xs text-ink-2">
              {activePoint
                ? `${activePoint.label}: ${activePoint.count.toLocaleString()} messages, ${activePoint.words.toLocaleString()} words`
                : "Hover or tap any bar to inspect"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-paper p-0.5">
            {(["auto", "daily", "weekly", "monthly"] as TimelineGrain[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  onGrain(g);
                  setHoveredIdx(null);
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
                  grain === g ? "bg-ink text-paper" : "text-ink-2 hover:text-ink",
                )}
              >
                {g === "auto" ? `Auto (${effectiveGrain})` : g}
              </button>
            ))}
          </div>
        </div>

        {series.length > 0 ? (
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[300px]">
              <div className="flex h-44 items-end gap-1 border-b border-line pb-2">
                {series.map((pt, idx) => {
                  const pct = Math.max(4, Math.round((pt.count / maxVal) * 100));
                  const isSel = hoveredIdx === idx;
                  return (
                    <button
                      key={pt.key}
                      type="button"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onFocus={() => setHoveredIdx(idx)}
                      onClick={() => setHoveredIdx(idx)}
                      aria-label={`${pt.label}: ${pt.count} messages`}
                      className="group relative flex h-full min-w-[6px] flex-1 flex-col items-center justify-end focus:outline-none"
                    >
                      <span
                        style={{ height: `${pct}%` }}
                        className={cn(
                          "w-full max-w-8 rounded-t-xs transition-colors",
                          isSel ? "bg-ink" : "bg-accent/85 group-hover:bg-accent",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-xs text-ink-3">
                <span>{series[0]?.label}</span>
                {series.length > 2 && <span>{series[Math.floor(series.length / 2)]?.label}</span>}
                <span>{series[series.length - 1]?.label}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-3">No activity data in the selected range.</p>
        )}

        {/* Top contributors share strip */}
        {analysis.senders.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">Share by participant</span>
              <button type="button" onClick={onSelectSenderTab} className="font-medium text-accent hover:underline">
                Full breakdown →
              </button>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper-2">
              {analysis.senders.slice(0, 4).map((s, idx) => (
                <div
                  key={s.sender}
                  style={{
                    width: `${Math.max(1, s.share * 100)}%`,
                    backgroundColor: SENDER_COLORS[idx % SENDER_COLORS.length],
                  }}
                  title={`${s.sender}: ${(s.share * 100).toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
              {topSeriesSenders.map((name, idx) => {
                const stat = analysis.senders.find((s) => s.sender === name);
                if (!stat) return null;
                return (
                  <span key={name} className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: SENDER_COLORS[idx % SENDER_COLORS.length] }} />
                    <span className="font-medium text-ink">{name}</span>
                    <span className="font-mono tabular-nums text-ink-3">{(stat.share * 100).toFixed(1)}%</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      {/* Highlights Row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-line bg-surface p-3.5">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Calendar aria-hidden className="size-3.5" />
            <span>Busiest day</span>
          </div>
          <p className="mt-1.5 font-mono text-sm font-semibold text-ink">
            {analysis.peakDay ? `${analysis.peakDay.date} (${analysis.peakDay.count.toLocaleString()})` : "—"}
          </p>
        </div>
        <div className="rounded-md border border-line bg-surface p-3.5">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Clock aria-hidden className="size-3.5" />
            <span>Peak hour &amp; day</span>
          </div>
          <p className="mt-1.5 font-mono text-sm font-semibold text-ink">
            {analysis.peakHour ? `${fmtHour(analysis.peakHour.hour)}` : "—"} · {analysis.peakWeekday?.name ?? "—"}
          </p>
        </div>
        <div className="rounded-md border border-line bg-surface p-3.5">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Users aria-hidden className="size-3.5" />
            <span>Longest quiet gap</span>
          </div>
          <p className="mt-1.5 font-mono text-sm font-semibold text-ink">
            {analysis.longestSilenceHours >= 48
              ? `${Math.round(analysis.longestSilenceHours / 24)} days`
              : `${analysis.longestSilenceHours} hours`}
          </p>
        </div>
        <div className="rounded-md border border-line bg-surface p-3.5">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <MessageSquareText aria-hidden className="size-3.5" />
            <span>Edited &amp; deleted</span>
          </div>
          <p className="mt-1.5 font-mono text-sm font-semibold text-ink">
            {analysis.totalEdited} edited · {analysis.totalDeleted} deleted
          </p>
        </div>
      </div>
    </div>
  );
}

function PeopleTab({ analysis }: { analysis: ChatAnalysis }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? analysis.senders : analysis.senders.slice(0, 25);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-paper/60 label-mono text-ink-3">
              <th className="px-4 py-3 font-medium">Participant</th>
              <th className="px-3 py-3 text-right font-medium">Messages</th>
              <th className="px-3 py-3 text-right font-medium">Words (avg)</th>
              <th className="px-3 py-3 text-right font-medium">Media</th>
              <th className="px-3 py-3 text-right font-medium">Links</th>
              <th className="px-3 py-3 text-right font-medium">Questions</th>
              <th className="px-3 py-3 text-right font-medium">Starters</th>
              <th className="px-3 py-3 text-right font-medium">Bursts (max)</th>
              <th className="px-3 py-3 text-right font-medium">Median reply</th>
              <th className="px-4 py-3 text-right font-medium">Top emojis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((s) => (
              <tr key={s.sender} className="hover:bg-paper/40">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{s.sender}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(s.share * 100)}%` }} />
                    </div>
                    <span className="font-mono text-xs tabular-nums text-ink-3">{(s.share * 100).toFixed(1)}%</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">{s.messages.toLocaleString()}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-2">
                  {s.words.toLocaleString()} <span className="text-ink-3">({s.avgWords})</span>
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-2">{s.media}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-2">{s.links}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-2">{s.questions}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-2">{s.starters}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-2">
                  {s.bursts} <span className="text-ink-3">({s.maxBurst})</span>
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">{fmtMinutes(s.medianReplyMin)}</td>
                <td className="px-4 py-3 text-right text-base">
                  {s.topEmojis.length > 0 ? s.topEmojis.slice(0, 3).map((e) => e.emoji).join(" ") : <span className="text-xs text-ink-3">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {analysis.senders.length > 25 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-medium text-ink hover:border-ink-3"
        >
          Show all {analysis.senders.length} participants
        </button>
      )}
    </div>
  );
}

function TimingTab({ analysis }: { analysis: ChatAnalysis }) {
  const [cellInfo, setCellInfo] = useState<{ day: number; hour: number; count: number } | null>(null);
  const maxCell = useMemo(
    () => Math.max(1, ...analysis.heatmap.flat()),
    [analysis.heatmap],
  );

  return (
    <div className="space-y-5">
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">Day × Hour activity heatmap</h3>
            <p className="text-xs text-ink-2">
              {cellInfo
                ? `${WEEKDAYS[cellInfo.day]} ${fmtHour(cellInfo.hour)}–${String(cellInfo.hour).padStart(2, "0")}:59 → ${cellInfo.count.toLocaleString()} messages`
                : "Hover or tap any slot to see exact activity volume."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <span>Less</span>
            <span className="flex gap-1">
              {[0.08, 0.28, 0.52, 0.78, 1].map((op) => (
                <span
                  key={op}
                  className="size-3.5 rounded-xs border border-line/60"
                  style={{ backgroundColor: `rgba(235, 74, 16, ${op})` }}
                />
              ))}
            </span>
            <span>More</span>
          </div>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="min-w-[620px] space-y-1">
            <div className="grid grid-cols-[3rem_repeat(24,minmax(0,1fr))] gap-1">
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="text-center font-mono text-xs text-ink-3">
                  {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                </span>
              ))}
            </div>
            {analysis.heatmap.map((row, dayIdx) => (
              <div key={WEEKDAYS[dayIdx]} className="grid grid-cols-[3rem_repeat(24,minmax(0,1fr))] items-center gap-1">
                <span className="font-mono text-xs font-medium text-ink-2">{WEEKDAYS[dayIdx]}</span>
                {row.map((count, hrIdx) => {
                  const alpha = count === 0 ? 0 : Math.max(0.14, count / maxCell);
                  return (
                    <button
                      key={hrIdx}
                      type="button"
                      onMouseEnter={() => setCellInfo({ day: dayIdx, hour: hrIdx, count })}
                      onClick={() => setCellInfo({ day: dayIdx, hour: hrIdx, count })}
                      aria-label={`${WEEKDAYS[dayIdx]} ${fmtHour(hrIdx)}: ${count} messages`}
                      className="h-6 rounded-xs border border-line/60 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ink"
                      style={{
                        backgroundColor: count === 0 ? "#F3F0E8" : `rgba(235, 74, 16, ${alpha.toFixed(2)})`,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Time of day breakdown</h3>
          <div className="space-y-2.5">
            {analysis.dayBuckets.map((b) => (
              <div key={b.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-ink">
                    {b.label} <span className="font-mono text-ink-3">({b.range})</span>
                  </span>
                  <span className="font-mono tabular-nums text-ink-2">
                    {b.count.toLocaleString()} ({(b.share * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-paper-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(b.share * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Weekday vs weekend</h3>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-md border border-line bg-paper/55 p-3">
              <p className="label-mono text-ink-3">Mon – Fri</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink">
                {((1 - analysis.weekendShare) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="rounded-md border border-line bg-paper/55 p-3">
              <p className="label-mono text-ink-3">Sat – Sun</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-accent">
                {(analysis.weekendShare * 100).toFixed(1)}%
              </p>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-ink-2">
            Most active day is <strong className="text-ink">{analysis.peakWeekday?.name ?? "—"}</strong>{" "}
            {analysis.peakWeekday ? `(${analysis.peakWeekday.count.toLocaleString()} msgs)` : ""} and peak hour is{" "}
            <strong className="text-ink">{analysis.peakHour ? fmtHour(analysis.peakHour.hour) : "—"}</strong>.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function LanguageTab({
  analysis,
  hideStopwords,
  onHideStopwords,
  onSearchTerm,
}: {
  analysis: ChatAnalysis;
  hideStopwords: boolean;
  onHideStopwords: (v: boolean) => void;
  onSearchTerm: (term: string) => void;
}) {
  const maxWord = analysis.topWords[0]?.count ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle
          checked={hideStopwords}
          onChange={onHideStopwords}
          label="Hide common filler words (multilingual)"
        />
        <span className="text-xs text-ink-3">Click any emoji, word, or phrase to search matching messages.</span>
      </div>

      {/* Top Emojis */}
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">
          Top emojis <span className="font-mono text-xs font-normal text-ink-3">({analysis.totalEmojis.toLocaleString()} used)</span>
        </h3>
        {analysis.topEmojis.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {analysis.topEmojis.slice(0, 24).map((e) => (
              <button
                key={e.emoji}
                type="button"
                onClick={() => onSearchTerm(e.emoji)}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm transition-colors hover:border-ink-3"
              >
                <span className="text-lg leading-none">{e.emoji}</span>
                <span className="font-mono text-xs tabular-nums text-ink-2">{e.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3">No emojis found in this slice.</p>
        )}
      </Panel>

      {/* Top Words & Bigrams */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Top words (any script)</h3>
          {analysis.topWords.length > 0 ? (
            <div className="space-y-2">
              {analysis.topWords.slice(0, 18).map((w) => (
                <button
                  key={w.word}
                  type="button"
                  onClick={() => onSearchTerm(w.word)}
                  className="flex w-full items-center gap-3 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-paper"
                >
                  <span dir="auto" className="w-28 shrink-0 truncate text-sm font-medium text-ink">
                    {w.word}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(4, Math.round((w.count / maxWord) * 100))}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-ink-2">{w.count}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-3">Not enough words yet.</p>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Recurring phrases</h3>
            {analysis.topBigrams.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {analysis.topBigrams.slice(0, 16).map((b) => (
                  <button
                    key={b.phrase}
                    type="button"
                    onClick={() => onSearchTerm(b.phrase)}
                    dir="auto"
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs text-ink hover:border-ink-3"
                  >
                    <span>{b.phrase}</span>
                    <span className="font-mono text-ink-3">×{b.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-3">Repeated two-word phrases appear automatically in larger chats.</p>
            )}
          </Panel>

          <Panel className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Shared domains &amp; media</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="label-mono flex items-center gap-1 text-ink-3">
                  <Link2 aria-hidden className="size-3.5" />
                  Top domains
                </p>
                {analysis.topDomains.length > 0 ? (
                  analysis.topDomains.slice(0, 6).map((d) => (
                    <button
                      key={d.domain}
                      type="button"
                      onClick={() => onSearchTerm(d.domain)}
                      className="flex w-full items-center justify-between text-xs text-ink-2 hover:text-ink"
                    >
                      <span className="truncate font-mono">{d.domain}</span>
                      <span className="ml-2 font-mono tabular-nums text-ink-3">{d.count}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-ink-3">No links shared</p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="label-mono text-ink-3">Media breakdown</p>
                {analysis.mediaByKind.length > 0 ? (
                  analysis.mediaByKind.map((mk) => (
                    <div key={mk.kind} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-ink-2">{mk.kind}</span>
                      <span className="font-mono tabular-nums text-ink">{mk.count}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-ink-3">No media placeholders</p>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function highlightText(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-xs bg-accent/20 px-0.5 text-ink">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function MessagesTab({
  analysis,
  searchQuery,
  onSearchQuery,
  msgKind,
  onMsgKind,
  newestFirst,
  onNewestFirst,
  page,
  onPage,
  copiedSummary,
  onCopySummary,
  onExport,
}: {
  analysis: ChatAnalysis;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  msgKind: MsgKindFilter;
  onMsgKind: (k: MsgKindFilter) => void;
  newestFirst: boolean;
  onNewestFirst: (v: boolean) => void;
  page: number;
  onPage: (p: number) => void;
  copiedSummary: boolean;
  onCopySummary: () => void;
  onExport: (k: "json" | "csv" | "html") => void;
}) {
  const matches: ChatMessage[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = analysis.filteredMessages.filter((m) => {
      if (msgKind === "media" && !m.isMedia) return false;
      if (msgKind === "links" && m.urls.length === 0) return false;
      if (msgKind === "questions" && !m.isQuestion) return false;
      if (msgKind === "edited" && !m.isEdited) return false;
      if (msgKind === "deleted" && !m.isDeleted) return false;
      if (msgKind === "system" && !m.isSystem) return false;
      if (q) {
        const inBody = m.body.toLowerCase().includes(q);
        const inSender = (m.sender ?? "").toLowerCase().includes(q);
        if (!inBody && !inSender) return false;
      }
      return true;
    });
    return newestFirst ? [...list].reverse() : list;
  }, [analysis.filteredMessages, msgKind, searchQuery, newestFirst]);

  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageSlice = matches.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Export bar */}
      <Panel className="flex flex-wrap items-center justify-between gap-3 bg-paper/50">
        <div>
          <p className="text-sm font-semibold text-ink">Export report &amp; metrics</p>
          <p className="text-xs text-ink-2">Download filtered statistics or copy a quick summary — all generated locally.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onExport("csv")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-xs font-medium text-ink hover:border-ink-3"
          >
            <FileSpreadsheet aria-hidden className="size-3.5" />
            CSV (Excel)
          </button>
          <button
            type="button"
            onClick={() => onExport("json")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-xs font-medium text-ink hover:border-ink-3"
          >
            <Download aria-hidden className="size-3.5" />
            JSON
          </button>
          <button
            type="button"
            onClick={() => onExport("html")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-xs font-medium text-ink hover:border-ink-3"
          >
            <FileText aria-hidden className="size-3.5" />
            HTML report
          </button>
          <button
            type="button"
            onClick={onCopySummary}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
              copiedSummary ? "border-success/50 bg-success/10 text-success" : "border-ink bg-ink text-paper hover:bg-ink/90",
            )}
          >
            {copiedSummary ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
            {copiedSummary ? "Copied" : "Copy summary"}
          </button>
        </div>
      </Panel>

      {/* Search & message filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            dir="auto"
            placeholder="Search any word, sender, emoji, or link…"
            className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-4 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => onNewestFirst(!newestFirst)}
          className="h-10 rounded-full border border-line bg-surface px-4 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
        >
          {newestFirst ? "Newest first" : "Oldest first"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", "All"],
            ["media", "Media"],
            ["links", "Links"],
            ["questions", "Questions"],
            ["edited", "Edited"],
            ["deleted", "Deleted"],
            ["system", "System"],
          ] as [MsgKindFilter, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onMsgKind(k)}
            className={cn(
              "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors",
              msgKind === k ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Results list */}
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {pageSlice.length > 0 ? (
          pageSlice.map((m) => (
            <div key={m.index} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("font-semibold", m.isSystem ? "italic text-ink-3" : "text-ink")}>
                    {m.isSystem ? "System notice" : m.sender}
                  </span>
                  {m.isMedia && (
                    <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-ink-2">
                      {m.mediaKind ?? "media"}
                    </span>
                  )}
                  {m.isEdited && (
                    <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-ink-2">edited</span>
                  )}
                  {m.isDeleted && (
                    <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-ink-2">deleted</span>
                  )}
                </div>
                <span className="font-mono tabular-nums text-ink-3">
                  {m.dateKey} {String(m.hour).padStart(2, "0")}:{String(m.minute).padStart(2, "0")}
                </span>
              </div>
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2">
                {highlightText(m.cleanBody || m.body, searchQuery)}
              </p>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-ink-3">No messages match this search or filter.</p>
        )}
      </div>

      {matches.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
          <span className="font-mono tabular-nums">
            Showing {safePage * PAGE_SIZE + 1}–{Math.min(matches.length, (safePage + 1) * PAGE_SIZE)} of{" "}
            {matches.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => onPage(Math.max(0, safePage - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink disabled:opacity-40"
            >
              <ChevronLeft aria-hidden className="size-3.5" />
              Prev
            </button>
            <span className="font-mono tabular-nums px-2">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage + 1 >= totalPages}
              onClick={() => onPage(Math.min(totalPages - 1, safePage + 1))}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink disabled:opacity-40"
            >
              Next
              <ChevronRight aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
