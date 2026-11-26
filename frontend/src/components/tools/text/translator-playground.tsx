"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeftRight, FileAudio, FileText, FileType2, FileVideo, Globe2, ImageIcon, MessagesSquare, Settings2 } from "lucide-react";
import { getTool, stepsFor } from "@/lib/tools";
import { FALLBACK_LANGUAGES, isRtlLanguage, languageLabel, loadCapabilities, type TranslateCapabilities } from "@/lib/translate";
import { loadRecentLanguages, rememberLanguage, stopSpeaking, type VoiceGender } from "@/lib/translate-extras";
import { cn } from "@/lib/utils";
import { Chip } from "../pdf/parts";
import { Workbench } from "../workbench";
import { DocumentPanel } from "./translator/document-panel";
import { ImagePanel } from "./translator/image-panel";
import { MediaPanel } from "./translator/media-panel";
import { LanguagePicker } from "./translator/shared";
import { TextPanel } from "./translator/text-panel";

type Mode = "text" | "documents" | "images" | "audio" | "video";

const MODES: { id: Mode; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "text", label: "Text", hint: "type, paste or speak", icon: FileText },
  { id: "documents", label: "Documents", hint: "Word, PPT, Excel, PDF…", icon: FileType2 },
  { id: "images", label: "Images", hint: "photos & screenshots", icon: ImageIcon },
  { id: "audio", label: "Audio", hint: "dub voice notes", icon: FileAudio },
  { id: "video", label: "Video", hint: "dub + subtitles", icon: FileVideo },
];

const PREFS_KEY = "dwyl.translator.prefs.v1";

type Prefs = { source?: string; target?: string; gender?: VoiceGender; rate?: number };
type Start = { prefs: Prefs; sl: string | null; tl: string | null; mode: Mode | null; text: string | null };

function readStart(): Start {
  let prefs: Prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs;
  } catch {
    // ignore
  }
  const q = new URLSearchParams(window.location.search);
  const mode = q.get("mode") as Mode | null;
  return { prefs, sl: q.get("sl"), tl: q.get("tl"), mode: mode && MODES.some((m) => m.id === mode) ? mode : null, text: q.get("text") ?? q.get("q") };
}

const noop = () => () => {};

/** Preferences, recents and shared links live in the browser, so the workspace renders client-side only. */
export function TranslatorPlayground({ toolId }: { toolId: string }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <div aria-hidden className="h-[720px] animate-pulse rounded-lg border border-line bg-surface" />;
  return <Translator toolId={toolId} start={readStart()} />;
}

/**
 * The translator: one language bar shared by five workspaces. Text (live, with dictionary,
 * tones, glossary, back-translation check and more), documents (layout kept), pictures (OCR
 * overlay), and audio/video dubbing. The live interpreter is its own tool (/tools/interpreter).
 */
function Translator({ toolId, start }: { toolId: string; start: Start }) {
  const tool = getTool(toolId)!;
  const steps = stepsFor(tool);
  const [mode, setMode] = useState<Mode>(start.mode ?? "text");
  const [caps, setCaps] = useState<TranslateCapabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [source, setSourceRaw] = useState(start.sl ?? start.prefs.source ?? "auto");
  const [target, setTargetRaw] = useState(start.tl ?? start.prefs.target ?? "hi");
  const [recents, setRecents] = useState<string[]>(loadRecentLanguages);
  const [detected, setDetected] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [voiceGender, setVoiceGender] = useState<VoiceGender>(start.prefs.gender ?? "female");
  const [voiceRate, setVoiceRate] = useState(typeof start.prefs.rate === "number" ? start.prefs.rate : 0);
  const swapHandler = useRef<(() => void) | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressStep, setProgressStep] = useState(0);

  const languages = useMemo(() => (caps?.languages?.length ? caps.languages : FALLBACK_LANGUAGES), [caps]);
  const isRtl = useCallback((code: string) => isRtlLanguage(code, languages), [languages]);

  useEffect(() => {
    const ctrl = new AbortController();
    loadCapabilities(ctrl.signal)
      .then((d) => {
        setCaps(d);
        setCapsError(null);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setCapsError(e instanceof Error ? e.message : "Couldn't reach the translator.");
      });
    return () => {
      ctrl.abort();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ source, target, gender: voiceGender, rate: voiceRate }));
    } catch {
      // ignore
    }
  }, [source, target, voiceGender, voiceRate]);

  const setSource = (c: string) => {
    setSourceRaw(c);
    setRecents(rememberLanguage(c));
  };
  const setTarget = (c: string) => {
    setTargetRaw(c);
    setRecents(rememberLanguage(c));
  };

  const swap = () => {
    const from = source === "auto" ? detected : source;
    if (from && from !== target) {
      setSourceRaw(target);
      setTargetRaw(from);
    } else {
      setSourceRaw(target);
      setTargetRaw(target === "en" ? "hi" : "en");
    }
    swapHandler.current?.();
  };

  // Ctrl/Cmd + Shift + S swaps languages from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        swap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const locked = mediaBusy;
  const quick = ["en", "hi", "es", "fr", "ar", "bn", "de", "ja", "zh", "pt", "ru"].filter((c) => languages.some((l) => l.code === c));

  return (
    <Workbench
      steps={steps}
      current={progressStep}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Free multi-engine translation in {languages.length} languages · nothing is stored on our servers · history and glossary stay in this browser.</span>
          <span className="font-mono text-xs text-ink-3">Ctrl/⌘ + Shift + S swaps · Ctrl/⌘ + Enter translates</span>
        </div>
      }
    >
      {/* Mode tabs */}
      <div className="border-b border-line bg-paper/60 px-3 py-2.5 sm:px-6">
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="What to translate" className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {MODES.map((m) => {
              const Icon = m.icon;
              const sel = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  disabled={locked && !sel}
                  onClick={() => {
                    stopSpeaking();
                    setMode(m.id);
                    setProgressStep(0);
                  }}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-sm border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
                    sel ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {m.label}
                  <span className={cn("hidden text-xs xl:inline", sel ? "text-paper/70" : "text-ink-3")}>· {m.hint}</span>
                </button>
              );
            })}
            <Link
              href="/tools/interpreter"
              className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-dashed border-line px-3 py-2 text-sm font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              <MessagesSquare className="size-4 text-accent" aria-hidden /> Live interpreter
            </Link>
          </div>
          <span className="label-mono hidden shrink-0 items-center gap-1.5 text-ink-3 md:inline-flex">
            <Globe2 className="size-3.5 text-accent" aria-hidden />
            {languages.length}
          </span>
        </div>
      </div>

      {/* Language bar */}
      <div className="border-b border-line bg-surface px-4 py-4 sm:px-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:gap-3">
          <LanguagePicker
            label="From"
            value={source}
            onChange={setSource}
            languages={languages}
            allowAuto
            recents={recents}
            disabled={locked}
            detectedName={source === "auto" && detected ? languageLabel(detected, languages) : undefined}
          />
          <button
            type="button"
            onClick={swap}
            disabled={locked}
            title="Swap languages (Ctrl/⌘ + Shift + S)"
            aria-label="Swap languages"
            className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-paper text-ink transition-colors hover:border-ink-3 disabled:opacity-40"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
          </button>
          <LanguagePicker label="To" align="end" value={target} onChange={setTarget} languages={languages} recents={recents} disabled={locked} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {quick.map((code) => (
              <span key={code} className="shrink-0">
                <Chip selected={target === code} disabled={locked} onClick={() => setTarget(code)}>
                  {languageLabel(code, languages)}
                </Chip>
              </span>
            ))}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              <Settings2 aria-hidden className="size-3.5" /> Voice
            </button>
            {settingsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-64 space-y-3 rounded-md border border-line bg-surface p-3 shadow-float">
                <div>
                  <p className="label-mono mb-1.5 text-ink-3">Read-aloud voice</p>
                  <div className="flex gap-1.5">
                    {(["female", "male"] as const).map((g) => (
                      <Chip key={g} selected={voiceGender === g} onClick={() => setVoiceGender(g)}>
                        {g === "female" ? "Female" : "Male"}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label-mono mb-1.5 flex justify-between text-ink-3" htmlFor="voice-rate">
                    Speed <span>{voiceRate > 0 ? `+${voiceRate}` : voiceRate}%</span>
                  </label>
                  <input id="voice-rate" type="range" min={-50} max={60} step={10} value={voiceRate} onChange={(e) => setVoiceRate(Number(e.target.value))} className="w-full accent-ink" />
                </div>
                <p className="text-xs text-ink-3">Natural neural voices for ~90 languages; your browser’s voice is used if one isn’t available.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {mode === "text" && (
          <TextPanel
            source={source}
            target={target}
            setSource={setSource}
            setTarget={setTarget}
            languages={languages}
            caps={caps}
            recents={recents}
            swapHandler={swapHandler}
            initialText={start.text}
            onDetected={(c) => {
              setDetected(c);
              setProgressStep(c || source !== "auto" ? 3 : 1);
            }}
            isRtl={isRtl}
            voiceGender={voiceGender}
            voiceRate={voiceRate}
          />
        )}
        {mode === "documents" && <DocumentPanel source={source} target={target} languages={languages} isRtl={isRtl} />}
        {mode === "images" && <ImagePanel source={source} target={target} languages={languages} isRtl={isRtl} recents={recents} voiceGender={voiceGender} />}
        {(mode === "audio" || mode === "video") && (
          <MediaPanel
            mode={mode}
            setMode={setMode}
            sourceLang={source}
            targetLang={target}
            languages={languages}
            caps={caps}
            capsError={capsError}
            onBusy={setMediaBusy}
            onDetected={setDetected}
          />
        )}
      </div>
    </Workbench>
  );
}
