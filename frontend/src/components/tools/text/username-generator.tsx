"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  AtSign,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  HelpCircle,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { saveBlob } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import {
  ALL_SERVICES,
  MAIL_SERVICES,
  SOCIAL_PLATFORMS,
  formatServiceHandle,
  formatServiceUrl,
  generateClosestAlternatives,
  generateUsernames,
  SERVICE_MAP,
  validateHandleForService,
  type AvailabilityStatus,
  type SeparatorStyle,
  type ServiceCheckResult,
  type UsernameStyle,
} from "@/lib/username";
import { cn } from "@/lib/utils";
import { Chips, Panel, Row, Slider } from "../pdf/kit";
import { CopyButton } from "../dev/parts";
import { Workbench } from "../workbench";
import { triggerHaptic } from "@/lib/haptics";

const EASE = [0.22, 1, 0.36, 1] as const;

const STYLE_OPTIONS: { value: UsernameStyle; label: string }[] = [
  { value: "all", label: "All styles" },
  { value: "clean", label: "Clean" },
  { value: "professional", label: "Professional" },
  { value: "developer", label: "Developer" },
  { value: "creative", label: "Creative" },
  { value: "short", label: "Short" },
];

const SEPARATOR_OPTIONS: { value: SeparatorStyle; label: string }[] = [
  { value: "mixed", label: "Mixed" },
  { value: "none", label: "None" },
  { value: "dot", label: "Dot ." },
  { value: "underscore", label: "Underscore _" },
  { value: "hyphen", label: "Hyphen -" },
];

type BatchAlternativeSummary = {
  username: string;
  availableCount: number;
  occupiedCount: number;
  validCount: number;
  results: ServiceCheckResult[];
};

function sanitizeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function StatusBadge({ status }: { status: AvailabilityStatus }) {
  if (status === "available") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-success/30 bg-success/10 px-2 py-0.5 font-mono text-[11px] font-medium text-success">
        <CheckCircle2 aria-hidden className="size-3" />
        Available
      </span>
    );
  }
  if (status === "occupied") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[11px] font-medium text-danger">
        <AlertCircle aria-hidden className="size-3" />
        Occupied
      </span>
    );
  }
  if (status === "unclaimed_registry") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-accent/35 bg-accent/10 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
        <HelpCircle aria-hidden className="size-3" />
        Valid · Verify
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-line bg-paper px-2 py-0.5 font-mono text-[11px] font-medium text-ink-3">
        Rule blocked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-warning/35 bg-warning/10 px-2 py-0.5 font-mono text-[11px] font-medium text-warning">
      <HelpCircle aria-hidden className="size-3" />
      Verify link
    </span>
  );
}

export function UsernameGeneratorTool({ toolId }: { toolId: string }) {
  const toolSteps = useMemo(() => stepsFor(getTool(toolId ?? "username-generator")!), [toolId]);
  const [nameInput, setNameInput] = useState("Samrat Studio");
  const [keywordsInput, setKeywordsInput] = useState("dev, labs");
  const [style, setStyle] = useState<UsernameStyle>("all");
  const [separator, setSeparator] = useState<SeparatorStyle>("mixed");
  const [numberSuffix, setNumberSuffix] = useState("");
  const [maxLength, setMaxLength] = useState(20);
  const [categoryFilter, setCategoryFilter] = useState<string>("All");

  // Service toggles (pre-selected sensible defaults for social + mail + domain mail)
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    () => new Set(ALL_SERVICES.filter((s) => s.defaultEnabled).map((s) => s.id)),
  );

  // Wake the backend silently on mount so cookie-free Instagram (Instaloader) & Facebook (yt-dlp) probes respond faster.
  useEffect(() => {
    fetch("/api/tools/wake").catch(() => {});
  }, []);

  // Availability check state
  const [targetHandle, setTargetHandle] = useState("samratstudio");
  const [targetManuallyEdited, setTargetManuallyEdited] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkingClosest, setCheckingClosest] = useState(false);
  const [checkingBatch, setCheckingBatch] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkedForHandle, setCheckedForHandle] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<ServiceCheckResult[]>([]);
  const [closestAlternatives, setClosestAlternatives] = useState<BatchAlternativeSummary[]>([]);
  const [candidateScores, setCandidateScores] = useState<Record<string, { available: number; occupied: number; checked: number }>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedServiceIds = useMemo(
    () => ALL_SERVICES.filter((s) => selectedServices.has(s.id)).map((s) => s.id),
    [selectedServices],
  );

  const keywordList = useMemo(
    () => keywordsInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    [keywordsInput],
  );

  const suggestions = useMemo(
    () =>
      generateUsernames({
        name: nameInput,
        keywords: keywordsInput,
        style,
        separator,
        numberSuffix,
        maxLength,
      }),
    [nameInput, keywordsInput, style, separator, numberSuffix, maxLength],
  );

  const visibleSuggestions = useMemo(() => {
    if (categoryFilter === "All") return suggestions;
    return suggestions.filter((s) => s.category === categoryFilter);
  }, [suggestions, categoryFilter]);

  const effectiveTargetHandle = useMemo(() => {
    if (targetManuallyEdited) return sanitizeHandle(targetHandle);
    const firstSuggestion = suggestions[0]?.username;
    const raw = sanitizeHandle(nameInput);
    return raw || firstSuggestion || sanitizeHandle(targetHandle);
  }, [targetManuallyEdited, targetHandle, nameInput, suggestions]);

  const occupiedResults = useMemo(
    () => checkResults.filter((r) => r.status === "occupied"),
    [checkResults],
  );
  const availableResults = useMemo(
    () => checkResults.filter((r) => r.status === "available"),
    [checkResults],
  );

  const toggleService = (id: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyPreset = (preset: "default" | "social" | "dev" | "mail" | "all" | "none") => {
    if (preset === "default") {
      setSelectedServices(new Set(ALL_SERVICES.filter((s) => s.defaultEnabled).map((s) => s.id)));
    } else if (preset === "social") {
      setSelectedServices(
        new Set(SOCIAL_PLATFORMS.filter((s) => s.category === "Social" || s.category === "Creator" || s.category === "Community").map((s) => s.id)),
      );
    } else if (preset === "dev") {
      setSelectedServices(new Set(SOCIAL_PLATFORMS.filter((s) => s.category === "Developer").map((s) => s.id)));
    } else if (preset === "mail") {
      setSelectedServices(new Set(MAIL_SERVICES.map((s) => s.id)));
    } else if (preset === "all") {
      setSelectedServices(new Set(ALL_SERVICES.map((s) => s.id)));
    } else {
      setSelectedServices(new Set());
    }
  };

  const toggleFavorite = (u: string) => {
    setFavorites((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [u, ...prev].slice(0, 30)));
  };

  const copyQuick = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      triggerHaptic("success");
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1300);
    } catch {
      // Ignore clipboard permission failure cleanly.
    }
  };

  const runBatchProbe = async (usernames: string[], services: string[]): Promise<Record<string, ServiceCheckResult[]>> => {
    const res = await fetch("/api/tools/username-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames, services }),
    });
    const data = (await res.json().catch(() => null)) as { results?: Record<string, ServiceCheckResult[]>; detail?: string } | null;
    if (!res.ok || !data?.results) {
      throw new Error(data?.detail || "Availability check failed.");
    }
    return data.results;
  };

  const checkClosestForOccupied = async (occupiedHandle: string, services: string[]) => {
    const altCandidates = generateClosestAlternatives(occupiedHandle, nameInput, keywordList, 6);
    if (altCandidates.length === 0) return;

    setCheckingClosest(true);
    try {
      const resultsByAlt = await runBatchProbe(altCandidates, services);
      const summaries: BatchAlternativeSummary[] = altCandidates
        .map((alt) => {
          const list = resultsByAlt[alt] ?? [];
          return {
            username: alt,
            availableCount: list.filter((r) => r.status === "available").length,
            occupiedCount: list.filter((r) => r.status === "occupied").length,
            validCount: list.filter((r) => r.status !== "invalid").length,
            results: list,
          };
        })
        .sort((a, b) => {
          if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
          return a.occupiedCount - b.occupiedCount;
        });
      setClosestAlternatives(summaries);
    } catch {
      // Closest lookup failing silently shouldn't wipe primary check results.
    } finally {
      setCheckingClosest(false);
    }
  };

  const handleCheckHandle = async (handleToCheck?: string) => {
    const clean = sanitizeHandle(handleToCheck ?? effectiveTargetHandle);
    if (!clean) {
      setCheckError("Enter a name or handle first.");
      return;
    }
    if (selectedServiceIds.length === 0) {
      setCheckError("Toggle on at least one social media or mail service to check.");
      return;
    }

    if (handleToCheck) {
      setTargetHandle(clean);
      setTargetManuallyEdited(true);
    }

    setCheckError(null);
    setChecking(true);
    setClosestAlternatives([]);

    try {
      const map = await runBatchProbe([clean], selectedServiceIds);
      const list = map[clean] ?? [];
      setCheckedForHandle(clean);
      setCheckResults(list);
      setCandidateScores((prev) => ({
        ...prev,
        [clean]: {
          available: list.filter((r) => r.status === "available").length,
          occupied: list.filter((r) => r.status === "occupied").length,
          checked: list.length,
        },
      }));

      // Automatically suggest and verify closest alternatives when any service is occupied!
      if (list.some((r) => r.status === "occupied")) {
        void checkClosestForOccupied(clean, selectedServiceIds);
      }
    } catch (e) {
      setCheckError((e as Error).message || "Could not complete availability check.");
    } finally {
      setChecking(false);
    }
  };

  const handleCheckTopSuggestions = async () => {
    if (selectedServiceIds.length === 0) {
      setCheckError("Toggle on at least one social platform or mail service first.");
      return;
    }
    const top = visibleSuggestions.slice(0, 6).map((s) => s.username);
    if (top.length === 0) return;

    setCheckingBatch(true);
    setCheckError(null);
    try {
      const map = await runBatchProbe(top, selectedServiceIds);
      setCandidateScores((prev) => {
        const next = { ...prev };
        for (const u of top) {
          const list = map[u] ?? [];
          next[u] = {
            available: list.filter((r) => r.status === "available").length,
            occupied: list.filter((r) => r.status === "occupied").length,
            checked: list.length,
          };
        }
        return next;
      });
    } catch (e) {
      setCheckError((e as Error).message || "Batch scan failed.");
    } finally {
      setCheckingBatch(false);
    }
  };

  const exportReport = (format: "csv" | "json") => {
    const payload = {
      name: nameInput,
      checkedHandle: checkedForHandle,
      selectedServices: selectedServiceIds,
      availability: checkResults,
      closestAlternatives: closestAlternatives.map((c) => ({
        username: c.username,
        available: c.availableCount,
        occupied: c.occupiedCount,
      })),
      shortlist: favorites,
      suggestions: visibleSuggestions.slice(0, 20),
    };

    if (format === "json") {
      saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "username-report.json");
      return;
    }

    const lines = ["Handle,Service,Category,Address,Status,Detail"];
    for (const r of checkResults) {
      const svc = SERVICE_MAP.get(r.serviceId);
      const addr = svc ? formatServiceHandle(svc, r.username) : r.username;
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      lines.push([r.username, svc?.name ?? r.serviceId, svc?.category ?? "", addr, r.status, r.detail].map(esc).join(","));
    }
    saveBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), "username-availability.csv");
  };

  const categories = ["All", "Exact & Clean", "Short & Initials", "Role & Niche", "Prefixed", "Suffixed", "Creative"];
  const step = checkResults.length > 0 ? 2 : nameInput.trim() ? 1 : 0;

  return (
    <Workbench
      steps={toolSteps}
      current={step}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Live checks use public unauthenticated endpoints & DNS-over-HTTPS at $0 cost. Platforms with strict bot firewalls show a 1-click verify link alongside syntax checks.
          </span>
          <span className="font-mono text-[11px] text-ink-2">
            {selectedServiceIds.length} of {ALL_SERVICES.length} services toggled on
          </span>
        </div>
      }
    >
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-12">
        {/* Left column: Inputs + Service Toggles */}
        <div className="space-y-5 lg:col-span-5">
          <Panel>
            <Row
              label="Name, Brand or Idea"
              hint="Updates suggestions live"
              htmlFor="ug-name-input"
            >
              <input
                id="ug-name-input"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Aarav Mehta, Acme Studio, Pixel Forge"
                className="h-10 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-ink"
              />
            </Row>

            <Row
              label="Keywords / Niche"
              hint="Comma or space separated"
              htmlFor="ug-keywords-input"
            >
              <input
                id="ug-keywords-input"
                type="text"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                placeholder="e.g. dev, ai, design, music"
                className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-ink"
              />
            </Row>

            <Row label="Style">
              <Chips value={style} options={STYLE_OPTIONS} onChange={setStyle} label="Username style" />
            </Row>

            <Row label="Separator">
              <Chips value={separator} options={SEPARATOR_OPTIONS} onChange={setSeparator} label="Word separator" />
            </Row>

            <div className="grid grid-cols-2 gap-3 pt-3.5">
              <div>
                <label htmlFor="ug-num" className="label-mono block text-ink-3">
                  Lucky digits
                </label>
                <input
                  id="ug-num"
                  type="text"
                  maxLength={6}
                  value={numberSuffix}
                  onChange={(e) => setNumberSuffix(e.target.value)}
                  placeholder="e.g. 99, 07, 26"
                  className="mt-1.5 h-9 w-full rounded-md border border-line bg-paper px-2.5 font-mono text-sm text-ink outline-none focus:border-ink"
                />
              </div>
              <div>
                <span className="label-mono block text-ink-3">Max length</span>
                <div className="mt-1">
                  <Slider value={maxLength} min={10} max={30} onChange={setMaxLength} label="Maximum username length" />
                </div>
              </div>
            </div>
          </Panel>

          {/* Social & Mail Service Toggles */}
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <p className="label-mono text-ink">Toggle Social & Mail Services</p>
                <p className="mt-0.5 text-xs text-ink-3">Choose which platforms & emails to check</p>
              </div>
              <span className="font-mono text-xs text-ink-2">{selectedServiceIds.length} active</span>
            </div>

            {/* Quick Presets */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(
                [
                  ["default", "Default"],
                  ["social", "Social"],
                  ["dev", "Dev Stack"],
                  ["mail", "Mail & Domains"],
                  ["all", "Select All"],
                  ["none", "Clear"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className="rounded-sm border border-line bg-paper px-2 py-1 font-mono text-[11px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Social Platforms */}
            <div className="mt-4">
              <p className="label-mono mb-2 flex items-center gap-1.5 text-ink-3">
                <Globe aria-hidden className="size-3.5" />
                Social, Creator & Developer ({SOCIAL_PLATFORMS.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SOCIAL_PLATFORMS.map((svc) => {
                  const active = selectedServices.has(svc.id);
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => toggleService(svc.id)}
                      aria-pressed={active}
                      title={`${svc.name} · ${svc.ruleSummary}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs transition-colors",
                        active
                          ? "border-ink bg-ink text-paper"
                          : "border-line bg-paper text-ink-2 hover:border-ink-3 hover:text-ink",
                      )}
                    >
                      <span>{svc.name}</span>
                      {svc.directProbe && (
                        <span
                          aria-hidden
                          className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-ink-3/50")}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mail & Domain Services */}
            <div className="mt-4 border-t border-line pt-3.5">
              <p className="label-mono mb-2 flex items-center gap-1.5 text-ink-3">
                <Mail aria-hidden className="size-3.5" />
                Mail & Custom Domain Email ({MAIL_SERVICES.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MAIL_SERVICES.map((svc) => {
                  const active = selectedServices.has(svc.id);
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => toggleService(svc.id)}
                      aria-pressed={active}
                      title={`${svc.name} · ${svc.ruleSummary}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs transition-colors",
                        active
                          ? "border-ink bg-ink text-paper"
                          : "border-line bg-paper text-ink-2 hover:border-ink-3 hover:text-ink",
                      )}
                    >
                      <span>{svc.name}</span>
                      {svc.directProbe && (
                        <span
                          aria-hidden
                          className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-ink-3/50")}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-ink-3">
                Green dot = live lookup across X, Reddit, TikTok, Instagram (cookie-free Instaloader) &amp; Facebook (cookie-free yt-dlp). Webmail validates strict syntax and checks public key registries.
              </p>
            </div>
          </Panel>
        </div>

        {/* Right column: Availability Checker + Closest Available Suggestions + Generated Ideas */}
        <div className="space-y-5 lg:col-span-7">
          {/* Direct Handle Checker Bar */}
          <div className="rounded-lg border border-line bg-paper/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="ug-check-handle" className="label-mono flex items-center gap-1.5 text-ink">
                <AtSign aria-hidden className="size-3.5 text-accent" />
                Check Social & Mail Availability
              </label>
              {checkResults.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => exportReport("csv")}
                    className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                  >
                    <Download aria-hidden className="size-3" /> CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => exportReport("json")}
                    className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                  >
                    <Download aria-hidden className="size-3" /> JSON
                  </button>
                </div>
              )}
            </div>

            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-ink-3">
                  @
                </span>
                <input
                  id="ug-check-handle"
                  type="text"
                  value={effectiveTargetHandle}
                  onChange={(e) => {
                    setTargetHandle(e.target.value);
                    setTargetManuallyEdited(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCheckHandle();
                    }
                  }}
                  placeholder="Enter exact handle to verify..."
                  className="h-10 w-full rounded-md border border-line bg-surface pl-7 pr-3 font-mono text-sm text-ink outline-none focus:border-ink"
                />
              </div>
              <button
                type="button"
                disabled={checking || !effectiveTargetHandle}
                onClick={() => void handleCheckHandle()}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:pointer-events-none disabled:opacity-50"
              >
                {checking ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Search aria-hidden className="size-4" />}
                {checking ? "Checking…" : "Check availability"}
              </button>
            </div>

            {checkError && (
              <p className="mt-2.5 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {checkError}
              </p>
            )}

            {/* Live Rule Pre-Check Strip before clicking Check */}
            {effectiveTargetHandle && checkedForHandle !== effectiveTargetHandle && selectedServiceIds.length > 0 && (
              <p className="mt-2.5 text-xs text-ink-3">
                Passes syntax rules on{" "}
                <span className="font-mono font-medium text-ink">
                  {selectedServiceIds.filter((id) => validateHandleForService(effectiveTargetHandle, id).valid).length}/{selectedServiceIds.length}
                </span>{" "}
                toggled services. Click <span className="font-medium text-ink">Check availability</span> for live lookup.
              </p>
            )}

            {/* Availability Matrix Results */}
            <AnimatePresence>
              {checkResults.length > 0 && checkedForHandle && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="mt-4 space-y-4"
                >
                  {/* Summary metrics */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-mono font-semibold text-ink">@{checkedForHandle}</span>
                      <span className="text-success">{availableResults.length} available</span>
                      <span className={occupiedResults.length > 0 ? "font-medium text-danger" : "text-ink-3"}>
                        {occupiedResults.length} occupied
                      </span>
                    </div>
                    <CopyButton text={`@${checkedForHandle}`} label="Copy @handle" />
                  </div>

                  {/* Closest Available Username Recommendations whenever any toggled service is Occupied */}
                  {(occupiedResults.length > 0 || checkingClosest) && (
                    <div className="rounded-md border border-accent/35 bg-accent/5 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Sparkles aria-hidden className="size-4 shrink-0 text-accent" />
                          <p className="text-sm font-semibold text-ink">
                            @{checkedForHandle} is occupied on {occupiedResults.length} {occupiedResults.length === 1 ? "service" : "services"} — closest alternatives:
                          </p>
                        </div>
                        {checkingClosest && (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-accent">
                            <Loader2 aria-hidden className="size-3 animate-spin" />
                            Scanning…
                          </span>
                        )}
                      </div>

                      {closestAlternatives.length > 0 && (
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {closestAlternatives.map((alt) => (
                            <div
                              key={alt.username}
                              className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-mono text-sm font-medium text-ink">@{alt.username}</p>
                                <p className="mt-0.5 text-[11px] text-ink-3">
                                  <span className="font-medium text-success">{alt.availableCount} free</span>
                                  {" · "}
                                  <span className={alt.occupiedCount > 0 ? "text-danger" : "text-ink-3"}>
                                    {alt.occupiedCount} taken
                                  </span>
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleCheckHandle(alt.username)}
                                  className="rounded-sm border border-line bg-paper px-2 py-1 text-xs font-medium text-ink hover:border-ink-3"
                                >
                                  Inspect
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void copyQuick(alt.username, `alt-${alt.username}`)}
                                  aria-label={`Copy ${alt.username}`}
                                  className="inline-flex size-7 items-center justify-center rounded-sm border border-line bg-paper text-ink-2 hover:text-ink"
                                >
                                  {copiedId === `alt-${alt.username}` ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Per-Service Availability Grid */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {checkResults.map((res) => {
                      const svc = SERVICE_MAP.get(res.serviceId);
                      if (!svc) return null;
                      const formattedHandle = formatServiceHandle(svc, res.username);
                      const href = res.url || formatServiceUrl(svc, res.username);
                      return (
                        <div
                          key={res.serviceId}
                          className="flex items-start justify-between gap-2.5 rounded-md border border-line bg-surface p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-ink">{svc.name}</span>
                              <span className="label-mono text-[10px] text-ink-3">{svc.category}</span>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-xs text-ink-2" title={formattedHandle}>
                              {formattedHandle}
                            </p>
                            <p className="mt-1 text-[11px] leading-snug text-ink-3">{res.detail}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <StatusBadge status={res.status} />
                            {href && (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-2 hover:text-ink"
                              >
                                Open <ExternalLink aria-hidden className="size-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Shortlist / Favorites */}
          {favorites.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="label-mono flex items-center gap-1.5 text-ink">
                  <Star aria-hidden className="size-3.5 fill-accent text-accent" />
                  Shortlisted Handles ({favorites.length})
                </p>
                <div className="flex items-center gap-2">
                  <CopyButton text={favorites.join("\n")} label="Copy list" />
                  <button
                    type="button"
                    onClick={() => setFavorites([])}
                    className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-line bg-paper px-2 text-xs text-ink-3 hover:text-danger"
                  >
                    <Trash2 aria-hidden className="size-3.5" /> Clear
                  </button>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {favorites.map((fav) => (
                  <div
                    key={fav}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper pl-3 pr-1.5 py-1"
                  >
                    <button
                      type="button"
                      onClick={() => void handleCheckHandle(fav)}
                      className="font-mono text-xs font-medium text-ink hover:underline"
                    >
                      @{fav}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(fav)}
                      aria-label={`Remove ${fav} from shortlist`}
                      className="rounded-full p-0.5 text-ink-3 hover:text-danger"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested Usernames Grid */}
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <p className="label-mono text-ink">
                  Generated Username Ideas ({visibleSuggestions.length})
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  Tailored to <span className="font-medium text-ink">{nameInput.trim() || "your input"}</span> · click Check to verify live
                </p>
              </div>
              <button
                type="button"
                disabled={checkingBatch || visibleSuggestions.length === 0}
                onClick={() => void handleCheckTopSuggestions()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-paper px-3 text-xs font-medium text-ink transition-colors hover:border-ink-3 disabled:opacity-50"
              >
                {checkingBatch ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden className="size-3.5" />
                )}
                {checkingBatch ? "Scanning top 6…" : "Scan top 6 availability"}
              </button>
            </div>

            {/* Category filter chips */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    categoryFilter === cat
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-paper text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visibleSuggestions.map((item) => {
                const scan = candidateScores[item.username];
                const fav = favorites.includes(item.username);
                const validSelected = selectedServiceIds.filter(
                  (id) => validateHandleForService(item.username, id).valid,
                ).length;

                return (
                  <div
                    key={item.username}
                    className="group flex items-center justify-between gap-2 rounded-md border border-line bg-paper/50 px-3 py-2.5 transition-colors hover:border-ink-3 hover:bg-surface"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-sm font-medium text-ink">{item.username}</span>
                        <span className="rounded-sm bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
                          {item.score}%
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                        <span>{item.category}</span>
                        <span>·</span>
                        <span>
                          Fits {validSelected}/{selectedServiceIds.length} selected
                        </span>
                        {scan && (
                          <>
                            <span>·</span>
                            <span className={scan.occupied === 0 ? "font-medium text-success" : "font-medium text-danger"}>
                              {scan.available} free / {scan.occupied} taken
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.username)}
                        aria-label={fav ? `Unstar ${item.username}` : `Star ${item.username}`}
                        className="inline-flex size-7 items-center justify-center rounded-sm border border-line bg-surface text-ink-3 transition-colors hover:text-accent"
                      >
                        <Star aria-hidden className={cn("size-3.5", fav && "fill-accent text-accent")} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyQuick(item.username, `cand-${item.username}`)}
                        aria-label={`Copy ${item.username}`}
                        className="inline-flex size-7 items-center justify-center rounded-sm border border-line bg-surface text-ink-2 hover:text-ink"
                      >
                        {copiedId === `cand-${item.username}` ? (
                          <Check aria-hidden className="size-3.5 text-success" />
                        ) : (
                          <Copy aria-hidden className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCheckHandle(item.username)}
                        className="inline-flex h-7 items-center rounded-sm border border-ink bg-ink px-2 text-xs font-medium text-paper transition-colors hover:bg-ink/85"
                      >
                        Check
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Workbench>
  );
}
