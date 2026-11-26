"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ClipboardPaste,
  Download,
  History,
  Languages,
  Link2,
  Loader2,
  Mic,
  MicOff,
  Minus,
  Plus,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
  Subtitles,
  Upload,
  X,
} from "lucide-react";
import { checkFile, FileToolError, saveBlob } from "@/lib/files";
import {
  languageLabel,
  looksLikeSubtitleText,
  MAX_TEXT_CHARS,
  TEXT_FILE_EXTENSIONS,
  type TranslateCapabilities,
  type TranslateLanguage,
} from "@/lib/translate";
import {
  hasInsights,
  INSIGHTS_MAX_CHARS,
  loadGlossary,
  loadHistory,
  lookupInsights,
  pushHistory,
  roundTripScore,
  saveGlossary,
  saveHistory,
  scoreLabel,
  smartTranslate,
  smartTranslateBatch,
  splitSentences,
  STYLE_LABELS,
  type GlossaryRule,
  type HistoryItem,
  type Insights,
  type TranslateStyle,
  type VoiceGender,
} from "@/lib/translate-extras";
import { browserRecognitionSupported, listenBrowser, microphoneSupported, recordUtterance, transcribeClip, type ListenSession } from "@/lib/speech-input";
import { cn } from "@/lib/utils";
import { Notice, Toggle } from "../../pdf/kit";
import { btn, bx, CopyButton, LanguagePicker, primaryBtn, SpeakButton } from "./shared";
import { GlossaryDialog } from "./glossary-dialog";
import { HistoryDrawer } from "./history-drawer";
import { InsightsPanel } from "./insights-panel";

const SAMPLE_TEXT =
  "Hello! Welcome to Do-Whatever-You-Like. Paste a message, an email or a whole article here and it's translated as you type — free, with no sign-up. Visit https://do-whatever-you-like.colddsam.com for 100+ other tools.";

const AUTO_MAX = 5000;
const FONT_SIZES = [13, 15, 17, 20, 24];

type Result = {
  translated: string;
  edited: string | null;
  detected: string;
  detectedName: string;
  target: string;
  provider: string;
  protectedCount: number;
  style: string;
  input: string;
};

/** `forKey` is the translation the text belongs to; while it differs from the current one, it's loading. */
type Extra = { code: string; text: string; forKey: string; error?: string };
type BackCheck = { text: string; score: number } | { busy: true } | { error: string };

export type TextPanelProps = {
  source: string;
  target: string;
  setSource: (c: string) => void;
  setTarget: (c: string) => void;
  languages: TranslateLanguage[];
  caps: TranslateCapabilities | null;
  recents: string[];
  /** The shell calls this when the languages are swapped: the translation becomes the new input. */
  swapHandler: React.MutableRefObject<(() => void) | null>;
  initialText: string | null;
  onDetected: (code: string | null) => void;
  isRtl: (code: string) => boolean;
  voiceGender: VoiceGender;
  voiceRate: number;
};

export function TextPanel(p: TextPanelProps) {
  const { source, target, languages, caps } = p;
  const [input, setInput] = useState(() => (p.initialText ?? "").slice(0, MAX_TEXT_CHARS));
  const [subtitles, setSubtitles] = useState(false);
  const [auto, setAuto] = useState(true);
  const [style, setStyle] = useState<TranslateStyle>("default");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fontIdx, setFontIdx] = useState(1);
  const [view, setView] = useState<"text" | "sentences">("text");
  const [sentences, setSentences] = useState<{ src: string; out: string }[] | null>(null);
  const [sentBusy, setSentBusy] = useState(false);
  const [hoverSent, setHoverSent] = useState<number | null>(null);
  const [insightsState, setInsightsState] = useState<{ key: string; data: Insights | null } | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [addingExtra, setAddingExtra] = useState(false);
  const [backCheck, setBackCheck] = useState<BackCheck | null>(null);
  const [glossary, setGlossary] = useState<GlossaryRule[]>(loadGlossary);
  const [protect, setProtect] = useState(true);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [listening, setListening] = useState<"off" | "browser" | "recording" | "transcribing">("off");
  const [interim, setInterim] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);

  const ctrlRef = useRef<AbortController | null>(null);
  const insightsCtrl = useRef<AbortController | null>(null);
  const listenRef = useRef<ListenSession | null>(null);
  const recordStop = useRef<{ stop?: () => void }>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastRun = useRef("");

  useEffect(
    () => () => {
      ctrlRef.current?.abort();
      insightsCtrl.current?.abort();
      listenRef.current?.abort();
    },
    [],
  );

  const effectiveGlossary = useMemo(() => glossary, [glossary]);
  const output = result ? result.edited ?? result.translated : "";

  const run = useCallback(
    async (opts: { text?: string; force?: boolean } = {}) => {
      const text = opts.text ?? input;
      if (!text.trim()) {
        setResult(null);
        setError(null);
        return;
      }
      if (text.length > MAX_TEXT_CHARS) {
        setError(`Keep text under ${MAX_TEXT_CHARS.toLocaleString()} characters, or use the Documents tab for whole files.`);
        return;
      }
      const key = `${source}|${target}|${style}|${subtitles}|${protect}|${JSON.stringify(effectiveGlossary)}|${text}`;
      if (!opts.force && key === lastRun.current) return;
      lastRun.current = key;
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setBusy(true);
      setError(null);
      setBackCheck(null);
      setSentences(null);
      try {
        const res = await smartTranslate({
          text,
          source,
          target,
          mode: subtitles ? "subtitles" : "text",
          style,
          glossary: effectiveGlossary,
          protectPatterns: protect,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        setResult({
          translated: res.translated_text,
          edited: null,
          detected: res.detected_language,
          detectedName: res.detected_language_name,
          target: res.target_language,
          provider: res.provider,
          protectedCount: res.protected_count,
          style: res.style ?? "default",
          input: text,
        });
        p.onDetected(source === "auto" ? res.detected_language : null);
        if (view === "sentences") loadSentences(text, res.detected_language, res.target_language);
        setHistory((h) => {
          const next = pushHistory(h, { source, target, detected: res.detected_language, input: text, output: res.translated_text });
          saveHistory(next);
          return next;
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        lastRun.current = "";
        setError(e instanceof FileToolError || e instanceof Error ? e.message : "Translation failed.");
      } finally {
        if (ctrlRef.current === ctrl) setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, source, target, style, subtitles, protect, effectiveGlossary, view],
  );

  // Translate as you type.
  useEffect(() => {
    if (!auto || !input.trim() || input.length > AUTO_MAX) return;
    const t = setTimeout(() => run(), 650);
    return () => clearTimeout(t);
  }, [auto, input, run]);

  // Word panel for short text: loaded after each translation; "busy" until its answer matches.
  const insightsKey = result && result.input.length <= INSIGHTS_MAX_CHARS && !subtitles ? `${result.detected}|${result.target}|${result.input}` : "";
  const insights = insightsState && insightsState.key === insightsKey ? insightsState.data : null;
  const insightsBusy = Boolean(insightsKey) && insightsState?.key !== insightsKey;
  useEffect(() => {
    if (!insightsKey || !result) return;
    insightsCtrl.current?.abort();
    const ctrl = new AbortController();
    insightsCtrl.current = ctrl;
    lookupInsights(result.input, source === "auto" ? result.detected : source, result.target, ctrl.signal)
      .then((i) => !ctrl.signal.aborted && setInsightsState({ key: insightsKey, data: i }))
      .catch(() => !ctrl.signal.aborted && setInsightsState({ key: insightsKey, data: null }));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightsKey]);

  // Extra target languages follow the main translation.
  const extrasKey = result ? `${result.detected}|${style}|${subtitles}|${result.input}` : "";
  const extraCodes = extras.map((x) => x.code).join(",");
  useEffect(() => {
    if (!result || !extrasKey) return;
    const ctrl = new AbortController();
    for (const code of extraCodes.split(",").filter(Boolean)) {
      smartTranslate({ text: result.input, source, target: code, style, glossary: effectiveGlossary, protectPatterns: protect, signal: ctrl.signal, mode: subtitles ? "subtitles" : "text" })
        .then((r) => setExtras((list) => list.map((x) => (x.code === code ? { ...x, text: r.translated_text, forKey: extrasKey, error: undefined } : x))))
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setExtras((list) => list.map((x) => (x.code === code ? { ...x, forKey: extrasKey, error: e instanceof Error ? e.message : "Failed" } : x)));
        });
    }
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extrasKey, extraCodes]);

  // The shell asks to swap: the translation becomes the new input.
  const swapHandler = p.swapHandler;
  useEffect(() => {
    swapHandler.current = () => {
      if (!output) return;
      setInput(output);
      setResult(null);
      setSentences(null);
      lastRun.current = "";
    };
    return () => {
      swapHandler.current = null;
    };
  }, [output, swapHandler]);

  // Re-run when the language pair or options change (after this render, like typing does).
  useEffect(() => {
    if (!input.trim() || !(result || auto) || input.length > AUTO_MAX) return;
    const t = setTimeout(() => run(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, target, style, subtitles, protect, glossary]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "c" && output) {
        e.preventDefault();
        navigator.clipboard?.writeText(output).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [output]);

  const onInput = (val: string) => {
    setInput(val);
    setError(null);
    if (looksLikeSubtitleText(val) && !subtitles) setSubtitles(true);
    if (!val.trim()) {
      setResult(null);
      p.onDetected(null);
    }
  };

  const openFile = async (file: File) => {
    const problem = checkFile(file, [...TEXT_FILE_EXTENSIONS, ".csv", ".json", ".html", ".htm"], 2);
    if (problem) {
      setError(`${problem} For Word, PowerPoint, Excel or PDF files, use the Documents tab.`);
      return;
    }
    const content = await file.text();
    onInput(content.slice(0, MAX_TEXT_CHARS));
    const lower = file.name.toLowerCase();
    setSubtitles(lower.endsWith(".srt") || lower.endsWith(".vtt") || looksLikeSubtitleText(content));
    if (content.length > MAX_TEXT_CHARS) setError(`Only the first ${MAX_TEXT_CHARS.toLocaleString()} characters were loaded. Use the Documents tab for the whole file.`);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onInput((input ? input + "\n" : "") + text);
    } catch {
      setError("The browser didn't allow reading the clipboard. Press Ctrl/Cmd + V in the box instead.");
    }
  };

  // ---------- dictation ----------
  const browserLang = typeof navigator !== "undefined" ? navigator.language?.split("-")[0] : "";
  const dictationLang = source === "auto" ? (result?.detected && result.detected !== "auto" ? result.detected : browserLang || "en") : source;

  const startDictation = async () => {
    setError(null);
    if (browserRecognitionSupported()) {
      const base = input && !input.endsWith(" ") && !input.endsWith("\n") ? input + " " : input;
      let acc = base;
      setListening("browser");
      try {
        listenRef.current = listenBrowser({
          lang: dictationLang,
          continuous: true,
          onInterim: (t) => setInterim(t),
          onFinal: (t) => {
            acc = `${acc}${t} `;
            setInput(acc);
          },
          onEnd: () => {
            setListening("off");
            setInterim("");
          },
          onError: (m) => setError(m),
        });
      } catch (e) {
        setListening("off");
        setError(e instanceof Error ? e.message : "Couldn't start the microphone.");
      }
      return;
    }
    if (!microphoneSupported()) {
      setError("This browser can't use the microphone. Try Chrome, Edge or Safari.");
      return;
    }
    try {
      setListening("recording");
      const blob = await recordUtterance({ onLevel: setMicLevel, silenceMs: 1800, maxSeconds: 60, stopRef: recordStop.current });
      setListening("transcribing");
      const { text } = await transcribeClip(blob, source);
      if (text) onInput((input ? input.trimEnd() + " " : "") + text);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Couldn't record from the microphone.");
    } finally {
      setListening("off");
      setMicLevel(0);
    }
  };

  const stopDictation = () => {
    listenRef.current?.stop();
    recordStop.current.stop?.();
  };

  // ---------- sentences ----------
  async function loadSentences(text: string, from: string, to: string) {
    setSentBusy(true);
    setSentences(null);
    try {
      const parts = splitSentences(text);
      const res = await smartTranslateBatch(parts.map((s) => s.trim()), source === "auto" ? from : source, to, { glossary: effectiveGlossary });
      setSentences(parts.map((s, i) => ({ src: s, out: res.translated_texts[i] ?? "" })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't line up the sentences.");
      setView("text");
    } finally {
      setSentBusy(false);
    }
  }
  const chooseView = (v: "text" | "sentences") => {
    setView(v);
    if (v === "sentences" && result && !sentences && !sentBusy) loadSentences(result.input, result.detected, result.target);
  };

  // ---------- quality check ----------
  const runBackCheck = async () => {
    if (!result || !output.trim()) return;
    setBackCheck({ busy: true });
    try {
      const back = await smartTranslate({ text: output, source: result.target, target: source === "auto" ? result.detected : source, protectPatterns: protect });
      setBackCheck({ text: back.translated_text, score: roundTripScore(result.input, back.translated_text) });
    } catch (e) {
      setBackCheck({ error: e instanceof Error ? e.message : "The check failed." });
    }
  };

  // ---------- extras ----------
  const addExtra = (code: string) => {
    setAddingExtra(false);
    if (!code || code === target || extras.some((x) => x.code === code) || extras.length >= 6) return;
    setExtras((l) => [...l, { code, text: "", forKey: "" }]);
  };

  // ---------- share / download / star ----------
  const share = async () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("sl", source);
    url.searchParams.set("tl", target);
    url.searchParams.set("text", input.slice(0, 1500));
    const href = url.toString();
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ title: "Translation", text: output ? `${input}\n\n→ ${output}` : input, url: href });
        return;
      }
    } catch {
      // cancelled share sheet: fall back to copying
    }
    await navigator.clipboard?.writeText(href).catch(() => {});
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1800);
  };

  const download = (kind: "txt" | "srt" | "bilingual" | "json") => {
    if (!result) return;
    const tag = result.target;
    if (kind === "json") {
      const data = { source_language: source === "auto" ? result.detected : source, target_language: tag, source: result.input, translation: output, alternatives: extras.map((x) => ({ language: x.code, translation: x.text })) };
      saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `translation-${tag}.json`);
    } else if (kind === "bilingual") {
      const pairs = sentences ?? [{ src: result.input, out: output }];
      const body = pairs.map((s) => `${s.src.trim()}\n${s.out.trim()}`).join("\n\n");
      saveBlob(new Blob([body], { type: "text/plain;charset=utf-8" }), `translation-${tag}-bilingual.txt`);
    } else {
      saveBlob(new Blob([output], { type: "text/plain;charset=utf-8" }), `translation-${tag}.${kind}`);
    }
  };

  const currentStar = useMemo(() => history.find((h) => h.input === result?.input && h.target === result?.target), [history, result]);
  const toggleStar = () => {
    if (!result) return;
    setHistory((h) => {
      const base = currentStar ? h : pushHistory(h, { source, target, detected: result.detected, input: result.input, output });
      const next = base.map((i) => (i.input === result.input && i.target === result.target ? { ...i, starred: !i.starred, output } : i));
      saveHistory(next);
      return next;
    });
  };

  const applyAlternative = (from: string, to: string) => {
    if (!result) return;
    const cur = output;
    const next = cur.includes(from) ? cur.replace(from, to) : to;
    setResult({ ...result, edited: next });
  };

  const fontSize = FONT_SIZES[fontIdx];
  const srcRtl = p.isRtl(source === "auto" ? result?.detected ?? "" : source);
  const tgtRtl = p.isRtl(target);
  const tooLongForAuto = input.length > AUTO_MAX;
  const styles = (caps?.styles ?? ["default"]) as TranslateStyle[];
  const detectedSuggest = source !== "auto" && result && result.detected && result.detected !== source && result.detected !== "auto" ? result.detected : null;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onInput(SAMPLE_TEXT)} className={btn}>
          <Sparkles aria-hidden className="size-3.5 text-accent" /> Sample
        </button>
        <button type="button" onClick={paste} className={btn}>
          <ClipboardPaste aria-hidden className="size-3.5" /> Paste
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className={btn}>
          <Upload aria-hidden className="size-3.5" /> Open file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.srt,.vtt,.csv,.json,.html,.htm,text/plain"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) openFile(f);
          }}
        />
        <button type="button" onClick={() => setGlossaryOpen(true)} className={btn} title="Terms to keep or always translate a certain way">
          <BookOpen aria-hidden className="size-3.5" /> Glossary{glossary.length ? ` (${glossary.length})` : ""}
        </button>
        <button type="button" onClick={() => setHistoryOpen(true)} className={btn}>
          <History aria-hidden className="size-3.5" /> History{history.length ? ` (${history.length})` : ""}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <span className="label-mono mr-1 hidden text-ink-3 sm:inline">Text size</span>
          <button type="button" aria-label="Smaller text" className={btn} disabled={fontIdx === 0} onClick={() => setFontIdx((i) => Math.max(0, i - 1))}>
            <Minus aria-hidden className="size-3.5" />
          </button>
          <button type="button" aria-label="Larger text" className={btn} disabled={fontIdx === FONT_SIZES.length - 1} onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}>
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Toggle checked={auto} onChange={setAuto} label="Translate as I type" />
        <Toggle checked={subtitles} onChange={setSubtitles} label={<span className="inline-flex items-center gap-1"><Subtitles aria-hidden className="size-3.5" /> Keep SRT/VTT timings</span>} />
        <Toggle checked={protect} onChange={setProtect} label={<span className="inline-flex items-center gap-1"><ShieldCheck aria-hidden className="size-3.5" /> Keep links, emails & {"{placeholders}"}</span>} />
      </div>

      {styles.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-mono mr-1 text-ink-3">Tone</span>
          {styles.map((s) => (
            <button key={s} type="button" onClick={() => setStyle(s)} className={bx(style === s ? "on" : "idle")}>
              {STYLE_LABELS[s] ?? s}
            </button>
          ))}
        </div>
      )}

      {error && <Notice tone="danger">{error}</Notice>}
      {detectedSuggest && (
        <Notice>
          This looks like <strong>{languageLabel(detectedSuggest, languages)}</strong>, not {languageLabel(source, languages)}.{" "}
          <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => p.setSource(detectedSuggest)}>
            Translate from {languageLabel(detectedSuggest, languages)}
          </button>
        </Notice>
      )}
      {insights?.did_you_mean && (
        <Notice>
          Did you mean{" "}
          <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => onInput(insights.did_you_mean)}>
            {insights.did_you_mean}
          </button>
          ?
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Source */}
        <div className="flex min-w-0 flex-col rounded-md border border-line bg-paper/50">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span className="label-mono text-ink-2">
              {source === "auto" ? (result?.detectedName ? `Detected · ${result.detectedName}` : "Source") : languageLabel(source, languages)}
            </span>
            <div className="flex items-center gap-1.5">
              {listening === "off" ? (
                <button type="button" onClick={startDictation} className={btn} title="Speak instead of typing">
                  <Mic aria-hidden className="size-3.5" /> <span className="hidden sm:inline">Speak</span>
                </button>
              ) : (
                <button type="button" onClick={stopDictation} disabled={listening === "transcribing"} className={bx("accent")}>
                  {listening === "transcribing" ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <MicOff aria-hidden className="size-3.5 text-accent" />}
                  {listening === "transcribing" ? "Writing…" : "Stop"}
                  {listening === "recording" && <span aria-hidden className="ml-1 h-2 w-8 overflow-hidden rounded-full bg-paper-2"><span className="block h-full bg-accent" style={{ width: `${Math.round(micLevel * 100)}%` }} /></span>}
                </button>
              )}
              <SpeakButton text={input} lang={source === "auto" ? result?.detected ?? "" : source} gender={p.voiceGender} rate={p.voiceRate} iconOnly />
              <CopyButton text={input} label="Copy source" iconOnly />
              {input && (
                <button
                  type="button"
                  aria-label="Clear"
                  title="Clear"
                  onClick={() => {
                    onInput("");
                    setExtras((l) => l.map((x) => ({ ...x, text: "", forKey: "" })));
                    lastRun.current = "";
                  }}
                  className={btn}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          <textarea
            aria-label="Text to translate"
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                run({ force: true });
              }
            }}
            dir={srcRtl ? "rtl" : "auto"}
            spellCheck
            maxLength={MAX_TEXT_CHARS + 500}
            placeholder="Type, paste, drop a file or tap Speak…"
            style={{ fontSize }}
            className="min-h-[220px] w-full flex-1 resize-y bg-transparent p-3.5 leading-relaxed text-ink outline-none placeholder:text-ink-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const f = e.dataTransfer.files?.[0];
              if (f) {
                e.preventDefault();
                openFile(f);
              }
            }}
          />
          {interim && <p className="border-t border-dashed border-line px-3.5 py-2 text-sm italic text-ink-3">{interim}…</p>}
          {insights?.source_romanization && <p className="border-t border-line px-3.5 py-2 text-xs text-ink-3">{insights.source_romanization}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-xs text-ink-3">
            <span className={cn(input.length > MAX_TEXT_CHARS && "text-danger")}>
              {input.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()}
              {input.trim() && ` · ${input.trim().split(/\s+/).length.toLocaleString()} words`}
            </span>
            <span className="hidden sm:inline">Ctrl/⌘ + Enter to translate</span>
          </div>
        </div>

        {/* Output */}
        <div className="flex min-w-0 flex-col rounded-md border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="label-mono text-ink-2">{languageLabel(target, languages)}</span>
              {result?.edited !== null && result && <span className="rounded-sm bg-accent/10 px-1.5 py-0.5 text-[11px] text-ink">edited</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <div role="tablist" aria-label="View" className="mr-1 hidden rounded-sm border border-line p-0.5 sm:inline-flex">
                {(["text", "sentences"] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} disabled={!result} onClick={() => chooseView(v)} className={cn("rounded-[4px] px-2 py-1 text-xs", view === v ? "bg-ink text-paper" : "text-ink-2 hover:text-ink disabled:opacity-40")}>
                    {v === "text" ? "Text" : "Sentences"}
                  </button>
                ))}
              </div>
              <SpeakButton text={output} lang={target} gender={p.voiceGender} rate={p.voiceRate} iconOnly />
              <CopyButton text={output} label="Copy translation" iconOnly />
              <button type="button" onClick={toggleStar} disabled={!result} className={bx(currentStar?.starred ? "accent" : "idle")} title={currentStar?.starred ? "Remove from phrasebook" : "Save to phrasebook"} aria-label="Save to phrasebook">
                <Star aria-hidden className={cn("size-3.5", currentStar?.starred && "fill-accent text-accent")} />
              </button>
            </div>
          </div>
          {view === "sentences" && result ? (
            <div className="min-h-[220px] flex-1 overflow-auto p-2" style={{ fontSize }}>
              {sentBusy || !sentences ? (
                <p className="flex items-center gap-2 p-2 text-sm text-ink-3">
                  <Loader2 aria-hidden className="size-4 animate-spin" /> Lining up sentences…
                </p>
              ) : (
                <ol className="space-y-1">
                  {sentences.map((s, i) =>
                    s.src.trim() ? (
                      <li
                        key={i}
                        onMouseEnter={() => setHoverSent(i)}
                        onMouseLeave={() => setHoverSent(null)}
                        className={cn("grid gap-1 rounded-sm px-2 py-1.5 sm:grid-cols-2 sm:gap-3", hoverSent === i ? "bg-accent/10" : "odd:bg-paper/60")}
                      >
                        <span className="text-ink-2" dir={srcRtl ? "rtl" : "auto"}>{s.src.trim()}</span>
                        <span className="text-ink" dir={tgtRtl ? "rtl" : "auto"}>{s.out}</span>
                      </li>
                    ) : null,
                  )}
                </ol>
              )}
            </div>
          ) : (
            <textarea
              aria-label="Translation (you can edit it)"
              value={busy && !result ? "" : output}
              readOnly={!result}
              onChange={(e) => result && setResult({ ...result, edited: e.target.value })}
              dir={tgtRtl ? "rtl" : "auto"}
              placeholder={busy ? "Translating…" : "Translation"}
              style={{ fontSize }}
              className={cn("min-h-[220px] w-full flex-1 resize-y bg-transparent p-3.5 leading-relaxed text-ink outline-none placeholder:text-ink-3", busy && "opacity-60")}
            />
          )}
          {insights?.target_romanization && view === "text" && <p className="border-t border-line px-3.5 py-2 text-xs text-ink-3">{insights.target_romanization}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              {result
                ? `${output.length.toLocaleString()} chars${result.protectedCount ? ` · ${result.protectedCount} kept as-is` : ""}${result.style !== "default" ? ` · ${STYLE_LABELS[result.style as TranslateStyle] ?? result.style} tone` : ""}`
                : busy
                  ? "Translating…"
                  : "Edit the translation freely; your edits are what you copy and save."}
            </span>
            {result && (
              <div className="flex flex-wrap items-center gap-2.5">
                <button type="button" onClick={() => download(subtitles ? "srt" : "txt")} className="inline-flex items-center gap-1 font-medium text-ink hover:text-accent">
                  <Download aria-hidden className="size-3.5" /> .{subtitles ? "srt" : "txt"}
                </button>
                <button type="button" onClick={() => download("bilingual")} className="font-medium text-ink hover:text-accent">Bilingual</button>
                <button type="button" onClick={() => download("json")} className="font-medium text-ink hover:text-accent">JSON</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => run({ force: true })} disabled={busy || !input.trim()} className={primaryBtn}>
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Languages aria-hidden className="size-4" />}
          {busy ? "Translating…" : `Translate to ${languageLabel(target, languages)}`}
        </button>
        {tooLongForAuto && auto && <span className="text-xs text-ink-3">Long text: press Translate (live translation stops after {AUTO_MAX.toLocaleString()} characters).</span>}
        {result && (
          <>
            <button type="button" onClick={runBackCheck} className={bx("idle", "lg")} title="Translate it back and compare, to catch meaning that got lost">
              <RefreshCcw aria-hidden className="size-4" /> Check meaning
            </button>
            <button type="button" onClick={share} className={bx("idle", "lg")}>
              <Link2 aria-hidden className="size-4" /> {shareCopied ? "Link copied" : "Share"}
            </button>
            {result.edited !== null && (
              <button type="button" onClick={() => setResult({ ...result, edited: null })} className={bx("idle", "lg")}>
                <RotateCcw aria-hidden className="size-4" /> Undo edits
              </button>
            )}
          </>
        )}
      </div>

      {/* Round-trip check */}
      {backCheck && (
        <div className="rounded-md border border-line bg-paper/40 p-3.5">
          {"busy" in backCheck ? (
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Translating it back to compare…
            </p>
          ) : "error" in backCheck ? (
            <p className="text-sm text-danger">{backCheck.error}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="label-mono text-ink-3">Round-trip check</span>
                <span
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs font-medium",
                    scoreLabel(backCheck.score).tone === "success" && "bg-success/10 text-success",
                    scoreLabel(backCheck.score).tone === "warning" && "bg-warning/10 text-warning",
                    scoreLabel(backCheck.score).tone === "danger" && "bg-danger/10 text-danger",
                  )}
                >
                  {backCheck.score}% · {scoreLabel(backCheck.score).label}
                </span>
                <button type="button" onClick={() => setBackCheck(null)} className="ml-auto text-xs text-ink-3 hover:text-ink">Close</button>
              </div>
              <p className="text-xs text-ink-3">Your translation, translated back into {languageLabel(source === "auto" ? result?.detected ?? "en" : source, languages)}:</p>
              <p className="text-sm text-ink" dir="auto">{backCheck.text}</p>
            </div>
          )}
        </div>
      )}

      {/* More languages at once */}
      <div className="rounded-md border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
          <span className="label-mono text-ink-3">Also translate into ({extras.length}/6)</span>
          {addingExtra ? (
            <div className="w-full sm:w-72">
              <LanguagePicker label="Add a language" align="end" value="" defaultOpen onDismiss={() => setAddingExtra(false)} onChange={addExtra} languages={languages.filter((l) => l.code !== target && !extras.some((x) => x.code === l.code))} recents={p.recents} compact />
            </div>
          ) : (
            <button type="button" onClick={() => setAddingExtra(true)} disabled={extras.length >= 6} className={btn}>
              <Plus aria-hidden className="size-3.5" /> Add language
            </button>
          )}
        </div>
        {extras.length > 0 && (
          <div className="grid grid-cols-1 gap-2 border-t border-line p-2.5 md:grid-cols-2 xl:grid-cols-3">
            {extras.map((x) => (
              <div key={x.code} className="flex min-w-0 flex-col rounded-sm border border-line bg-surface">
                <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5">
                  <span className="label-mono truncate text-ink-2">{languageLabel(x.code, languages)}</span>
                  <div className="flex items-center gap-1">
                    <SpeakButton text={x.text} lang={x.code} gender={p.voiceGender} rate={p.voiceRate} iconOnly />
                    <CopyButton text={x.text} iconOnly label={`Copy ${languageLabel(x.code, languages)}`} />
                    <button type="button" className={btn} aria-label={`Remove ${languageLabel(x.code, languages)}`} onClick={() => setExtras((l) => l.filter((y) => y.code !== x.code))}>
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </div>
                </div>
                <p className="min-h-16 whitespace-pre-wrap break-words p-2.5 text-sm text-ink" dir={p.isRtl(x.code) ? "rtl" : "auto"}>
                  {result && x.forKey !== extrasKey ? <span className="text-ink-3">Translating…</span> : x.error ? <span className="text-danger">{x.error}</span> : x.text || <span className="text-ink-3">Waiting for text…</span>}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Word panel */}
      {(insightsBusy || hasInsights(insights)) && result && (
        <InsightsPanel insights={insights} busy={insightsBusy} targetLang={result.target} isRtl={tgtRtl} onUseAlternative={applyAlternative} voiceGender={p.voiceGender} />
      )}

      <GlossaryDialog
        open={glossaryOpen}
        onClose={() => setGlossaryOpen(false)}
        rules={glossary}
        onChange={(r) => {
          setGlossary(r);
          saveGlossary(r);
          lastRun.current = "";
        }}
        target={target}
        languages={languages}
      />
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        items={history}
        languages={languages}
        onChange={(items) => {
          setHistory(items);
          saveHistory(items);
        }}
        onRestore={(item) => {
          setHistoryOpen(false);
          p.setSource(item.source);
          p.setTarget(item.target);
          setInput(item.input);
          lastRun.current = "";
        }}
      />
    </div>
  );
}
