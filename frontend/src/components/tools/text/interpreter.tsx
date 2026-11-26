"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftRight,
  BookOpenText,
  Captions,
  Download,
  Expand,
  FlipVertical2,
  Keyboard,
  Loader2,
  MessagesSquare,
  Mic,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { saveBlob } from "@/lib/files";
import { PHRASEBOOK } from "@/lib/phrasebook";
import { getTool, stepsFor } from "@/lib/tools";
import { FALLBACK_LANGUAGES, isRtlLanguage, languageLabel, loadCapabilities, translateBatch, type TranslateLanguage } from "@/lib/translate";
import { browserRecognitionSupported, listenBrowser, microphoneSupported, recordUtterance, transcribeClip, type ListenSession } from "@/lib/speech-input";
import { loadGlossary, loadRecentLanguages, lookupInsights, rememberLanguage, smartTranslate, speak, stopSpeaking, type VoiceGender } from "@/lib/translate-extras";
import { cn } from "@/lib/utils";
import { Notice, Toggle } from "../pdf/kit";
import { Workbench } from "../workbench";
import { btn, bx, CopyButton, LanguagePicker } from "./translator/shared";

type Mode = "conversation" | "captions" | "phrasebook";
type Side = "a" | "b";

type Turn = {
  id: string;
  side: Side;
  at: number;
  original: string;
  translated: string;
  from: string;
  to: string;
  pending?: boolean;
  error?: string;
};

type Caption = { id: string; at: number; original: string; translations: Record<string, string> };

const PREFS_KEY = "dwyl.interpreter.prefs.v1";
type Prefs = { a?: string; b?: string; autoSpeak?: boolean; handsFree?: boolean; faceToFace?: boolean; genderA?: VoiceGender; genderB?: VoiceGender; rate?: number; size?: number; capTargets?: string[] };

const noop = () => () => {};
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}

export function InterpreterTool({ toolId }: { toolId: string }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <div aria-hidden className="h-[720px] animate-pulse rounded-lg border border-line bg-surface" />;
  return <Interpreter toolId={toolId} prefs={readPrefs()} />;
}

function Interpreter({ toolId, prefs }: { toolId: string; prefs: Prefs }) {
  const tool = getTool(toolId)!;
  const steps = stepsFor(tool);
  const [languages, setLanguages] = useState<TranslateLanguage[]>(FALLBACK_LANGUAGES);
  const [mode, setMode] = useState<Mode>("conversation");
  const [langA, setLangA] = useState(prefs.a ?? (typeof navigator !== "undefined" && navigator.language?.startsWith("hi") ? "hi" : "en"));
  const [langB, setLangB] = useState(prefs.b ?? "es");
  const [recents, setRecents] = useState<string[]>(loadRecentLanguages);
  const [autoSpeak, setAutoSpeak] = useState(prefs.autoSpeak ?? true);
  const [handsFree, setHandsFree] = useState(prefs.handsFree ?? false);
  const [faceToFace, setFaceToFace] = useState(prefs.faceToFace ?? false);
  const [genderA, setGenderA] = useState<VoiceGender>(prefs.genderA ?? "female");
  const [genderB, setGenderB] = useState<VoiceGender>(prefs.genderB ?? "male");
  const [rate, setRate] = useState(prefs.rate ?? 0);
  const [size, setSize] = useState(prefs.size ?? 18);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    loadCapabilities(ctrl.signal)
      .then((c) => c.languages?.length && setLanguages(c.languages))
      .catch(() => {});
    return () => {
      ctrl.abort();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    try {
      const prev = readPrefs();
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, a: langA, b: langB, autoSpeak, handsFree, faceToFace, genderA, genderB, rate, size }));
    } catch {
      // ignore
    }
  }, [langA, langB, autoSpeak, handsFree, faceToFace, genderA, genderB, rate, size]);

  const pickA = (c: string) => {
    setLangA(c);
    setRecents(rememberLanguage(c));
  };
  const pickB = (c: string) => {
    setLangB(c);
    setRecents(rememberLanguage(c));
  };

  const isRtl = useCallback((c: string) => isRtlLanguage(c, languages), [languages]);
  const engine = browserRecognitionSupported() ? "browser" : microphoneSupported() ? "server" : "none";

  return (
    <Workbench
      steps={steps}
      current={1}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {engine === "browser"
              ? "Speech is recognised by your browser; only the words are sent for translation."
              : engine === "server"
                ? "This browser has no built-in recogniser, so each phrase is transcribed by our free Whisper server and deleted."
                : "This browser can't use a microphone here: type instead, it still translates and speaks."}
          </span>
          <span className="font-mono text-xs text-ink-3">{languages.length} languages · natural voices</span>
        </div>
      }
    >
      <div className="border-b border-line bg-paper/60 px-3 py-2.5 sm:px-6">
        <div role="tablist" aria-label="Interpreter mode" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
          {(
            [
              { id: "conversation", label: "Conversation", hint: "two people, two languages", icon: MessagesSquare },
              { id: "captions", label: "Live captions", hint: "lectures, meetings, TV", icon: Captions },
              { id: "phrasebook", label: "Phrasebook", hint: "tap to say it", icon: BookOpenText },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => {
                stopSpeaking();
                setMode(m.id);
              }}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-sm border px-3 py-2 text-sm font-medium transition-colors",
                mode === m.id ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              <m.icon aria-hidden className="size-4" />
              {m.label}
              <span className={cn("hidden text-xs lg:inline", mode === m.id ? "text-paper/70" : "text-ink-3")}>· {m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {error && (
          <Notice tone="danger" className="mb-4">
            {error}{" "}
            <button type="button" className="underline" onClick={() => setError(null)}>
              Dismiss
            </button>
          </Notice>
        )}
        {mode === "conversation" && (
          <Conversation
            langA={langA}
            langB={langB}
            setLangA={pickA}
            setLangB={pickB}
            languages={languages}
            recents={recents}
            autoSpeak={autoSpeak}
            setAutoSpeak={setAutoSpeak}
            handsFree={handsFree}
            setHandsFree={setHandsFree}
            faceToFace={faceToFace}
            setFaceToFace={setFaceToFace}
            genderA={genderA}
            genderB={genderB}
            setGenderA={setGenderA}
            setGenderB={setGenderB}
            rate={rate}
            setRate={setRate}
            size={size}
            setSize={setSize}
            isRtl={isRtl}
            onError={setError}
          />
        )}
        {mode === "captions" && (
          <LiveCaptions
            initialSource={langA}
            initialTargets={prefs.capTargets?.length ? prefs.capTargets : [langB]}
            languages={languages}
            recents={recents}
            isRtl={isRtl}
            rate={rate}
            gender={genderB}
            onError={setError}
          />
        )}
        {mode === "phrasebook" && (
          <Phrasebook langA={langA} langB={langB} setLangA={pickA} setLangB={pickB} languages={languages} recents={recents} isRtl={isRtl} gender={genderB} rate={rate} onError={setError} />
        )}
      </div>
    </Workbench>
  );
}

// ======================================================================= conversation

type ConversationProps = {
  langA: string;
  langB: string;
  setLangA: (c: string) => void;
  setLangB: (c: string) => void;
  languages: TranslateLanguage[];
  recents: string[];
  autoSpeak: boolean;
  setAutoSpeak: (v: boolean) => void;
  handsFree: boolean;
  setHandsFree: (v: boolean) => void;
  faceToFace: boolean;
  setFaceToFace: (v: boolean) => void;
  genderA: VoiceGender;
  genderB: VoiceGender;
  setGenderA: (g: VoiceGender) => void;
  setGenderB: (g: VoiceGender) => void;
  rate: number;
  setRate: (r: number) => void;
  size: number;
  setSize: (n: number) => void;
  isRtl: (c: string) => boolean;
  onError: (m: string | null) => void;
};

type ListenState = { side: Side; phase: "listening" | "transcribing"; interim: string; level: number } | null;

function Conversation(p: ConversationProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listen, setListen] = useState<ListenState>(null);
  const [typing, setTyping] = useState<Side | null>(null);
  const [draft, setDraft] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [show, setShow] = useState<Turn | null>(null);
  const sessionRef = useRef<ListenSession | null>(null);
  const recordStop = useRef<{ stop?: () => void }>({});
  const abortRef = useRef<AbortController | null>(null);
  const handsFreeRef = useRef(p.handsFree);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    handsFreeRef.current = p.handsFree;
  }, [p.handsFree]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(
    () => () => {
      sessionRef.current?.abort();
      abortRef.current?.abort();
      stopSpeaking();
    },
    [],
  );

  const langOf = (side: Side) => (side === "a" ? p.langA : p.langB);
  const otherOf = (side: Side): Side => (side === "a" ? "b" : "a");
  const genderOf = (side: Side) => (side === "a" ? p.genderA : p.genderB);

  // Kept in a ref so the listen → translate → speak → listen loop always calls the latest version.
  const startListeningRef = useRef<(side: Side) => void>(() => {});

  const process = useCallback(
    async (side: Side, text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const from = langOf(side);
      const to = langOf(otherOf(side));
      const id = uid();
      setTurns((t) => [...t, { id, side, at: Date.now(), original: clean, translated: "", from, to, pending: true }]);
      try {
        const res = await smartTranslate({ text: clean, source: from, target: to, glossary: loadGlossary() });
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, translated: res.translated_text, pending: false } : x)));
        if (p.autoSpeak) {
          setSpeakingId(id);
          await speak(res.translated_text, to, { gender: genderOf(otherOf(side)), rate: p.rate });
          setSpeakingId((s) => (s === id ? null : s));
        }
        if (handsFreeRef.current) setTimeout(() => startListeningRef.current(otherOf(side)), 250);
      } catch (e) {
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, pending: false, error: e instanceof Error ? e.message : "Translation failed." } : x)));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.langA, p.langB, p.autoSpeak, p.genderA, p.genderB, p.rate],
  );

  const stopListening = () => {
    sessionRef.current?.stop();
    recordStop.current.stop?.();
  };

  const startListening = useCallback(
    async (side: Side) => {
      p.onError(null);
      stopSpeaking();
      sessionRef.current?.abort();
      const lang = langOf(side);
      if (browserRecognitionSupported()) {
        let finalText = "";
        setListen({ side, phase: "listening", interim: "", level: 0 });
        try {
          sessionRef.current = listenBrowser({
            lang,
            continuous: false,
            onInterim: (t) => setListen((l) => (l && l.side === side ? { ...l, interim: t } : l)),
            onFinal: (t) => {
              finalText = `${finalText} ${t}`.trim();
            },
            onEnd: () => {
              setListen((l) => (l?.side === side ? null : l));
              if (finalText) process(side, finalText);
            },
            onError: (m) => p.onError(m),
          });
        } catch (e) {
          setListen(null);
          p.onError(e instanceof Error ? e.message : "Couldn't start the microphone.");
        }
        return;
      }
      if (!microphoneSupported()) {
        p.onError("This browser can't use the microphone. Type your sentence with the keyboard button instead.");
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setListen({ side, phase: "listening", interim: "", level: 0 });
      try {
        const blob = await recordUtterance({
          onLevel: (level) => setListen((l) => (l && l.side === side ? { ...l, level } : l)),
          silenceMs: 1300,
          maxSeconds: 40,
          signal: ctrl.signal,
          stopRef: recordStop.current,
        });
        setListen({ side, phase: "transcribing", interim: "", level: 0 });
        const { text } = await transcribeClip(blob, lang, ctrl.signal);
        setListen(null);
        if (text) process(side, text);
        else if (handsFreeRef.current) startListeningRef.current(side);
      } catch (e) {
        setListen(null);
        if (!(e instanceof DOMException && e.name === "AbortError")) p.onError(e instanceof Error ? e.message : "Recording failed.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.langA, p.langB, process],
  );

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const replay = async (t: Turn) => {
    setSpeakingId(t.id);
    await speak(t.translated, t.to, { gender: genderOf(otherOf(t.side)), rate: p.rate });
    setSpeakingId((s) => (s === t.id ? null : s));
  };

  const exportAs = (kind: "txt" | "srt" | "json") => {
    if (!turns.length) return;
    const t0 = turns[0].at;
    let body = "";
    if (kind === "json") body = JSON.stringify(turns.map((t) => ({ side: t.side, at: new Date(t.at).toISOString(), from: t.from, to: t.to, original: t.original, translated: t.translated })), null, 2);
    else if (kind === "srt")
      body = turns
        .map((t, i) => {
          const s = (t.at - t0) / 1000;
          const e = i + 1 < turns.length ? (turns[i + 1].at - t0) / 1000 : s + 4;
          return `${i + 1}\n${srtTime(s * 1000)} --> ${srtTime(Math.max(e, s + 1) * 1000)}\n${t.original}\n${t.translated}`;
        })
        .join("\n\n");
    else
      body = turns
        .map((t) => `[${new Date(t.at).toLocaleTimeString()}] ${t.side === "a" ? "Person A" : "Person B"} (${t.from} → ${t.to})\n${t.original}\n→ ${t.translated}`)
        .join("\n\n");
    saveBlob(new Blob([body], { type: kind === "json" ? "application/json" : "text/plain;charset=utf-8" }), `conversation.${kind}`);
  };

  const sendTyped = () => {
    if (!typing || !draft.trim()) return;
    process(typing, draft);
    setDraft("");
  };

  // A render function, not a component: it must not remount while words stream in.
  const renderPad = (side: Side, flipped?: boolean) => {
    const lang = langOf(side);
    const active = listen?.side === side;
    const last = [...turns].reverse().find((t) => !t.pending);
    // What this person should read: the latest line, in their own language.
    const readOut = last ? (last.side === side ? last.original : last.translated) : "";
    return (
      <div className={cn("flex min-w-0 flex-col gap-3 rounded-md border border-line bg-paper/40 p-3 sm:p-4", flipped && "rotate-180")}>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <LanguagePicker label={side === "a" ? "Person A speaks" : "Person B speaks"} align={side === "b" && !p.faceToFace ? "end" : "start"} value={lang} onChange={side === "a" ? p.setLangA : p.setLangB} languages={p.languages} recents={p.recents} compact />
          </div>
          <div className="flex gap-1">
            {(["female", "male"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => (side === "a" ? p.setGenderA(g) : p.setGenderB(g))}
                aria-pressed={genderOf(side) === g}
                title={`${g === "female" ? "Female" : "Male"} voice for ${languageLabel(lang, p.languages)}`}
                className={cn(bx(genderOf(side) === g ? "on" : "idle"), "h-9")}
              >
                {g === "female" ? "♀" : "♂"}
              </button>
            ))}
          </div>
        </div>
        {p.faceToFace && readOut && (
          <p className="min-h-12 rounded-sm bg-surface px-3 py-2 text-ink" style={{ fontSize: p.size + 2 }} dir={p.isRtl(lang) ? "rtl" : "auto"}>
            {readOut}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (active ? stopListening() : startListening(side))}
            disabled={Boolean(listen) && !active}
            aria-label={active ? "Stop listening" : `Speak ${languageLabel(lang, p.languages)}`}
            className={cn(
              "relative flex size-16 shrink-0 items-center justify-center rounded-full text-paper shadow-float transition-transform active:scale-95 disabled:opacity-40 sm:size-20",
              active ? "bg-accent" : side === "a" ? "bg-ink" : "bg-ink-2",
            )}
          >
            {active && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/40" />}
            {active && listen?.phase === "transcribing" ? <Loader2 className="size-7 animate-spin" /> : active ? <Square className="size-7" /> : <Mic className="size-7 sm:size-8" />}
          </button>
          <div className="min-w-0 flex-1 text-sm">
            {active ? (
              <p className="text-ink" dir="auto">
                {listen?.phase === "transcribing" ? "Writing it down…" : listen?.interim || `Listening in ${languageLabel(lang, p.languages)}…`}
              </p>
            ) : (
              <p className="text-ink-3">Tap and speak {languageLabel(lang, p.languages)}</p>
            )}
            {active && listen?.phase === "listening" && engineIsServer() && (
              <span aria-hidden className="mt-1.5 block h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-paper-2">
                <span className="block h-full bg-accent transition-[width]" style={{ width: `${Math.round((listen?.level ?? 0) * 100)}%` }} />
              </span>
            )}
          </div>
          <button type="button" className={cn(btn, "h-10")} onClick={() => setTyping(typing === side ? null : side)} aria-label="Type instead">
            <Keyboard aria-hidden className="size-4" />
          </button>
        </div>
        {typing === side && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendTyped();
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Type in ${languageLabel(lang, p.languages)}…`}
              dir={p.isRtl(lang) ? "rtl" : "auto"}
              className="h-10 min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 text-sm outline-none focus:border-ink"
            />
            <button type="submit" disabled={!draft.trim()} className="inline-flex h-10 items-center gap-1.5 rounded-sm bg-ink px-3 text-sm text-paper disabled:opacity-40">
              <Send aria-hidden className="size-4" />
            </button>
          </form>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Toggle checked={p.autoSpeak} onChange={p.setAutoSpeak} label="Speak translations aloud" />
        <Toggle checked={p.handsFree} onChange={p.setHandsFree} label="Hands-free turns" description="After each translation, the mic opens for the other person." />
        <Toggle checked={p.faceToFace} onChange={p.setFaceToFace} label={<span className="inline-flex items-center gap-1"><FlipVertical2 aria-hidden className="size-3.5" /> Face-to-face</span>} description="For a phone on the table: Person B's side is upside down." />
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={btn} aria-label="Smaller text" onClick={() => p.setSize(Math.max(13, p.size - 2))}>
            <Minus aria-hidden className="size-3.5" />
          </button>
          <button type="button" className={btn} aria-label="Larger text" onClick={() => p.setSize(Math.min(34, p.size + 2))}>
            <Plus aria-hidden className="size-3.5" />
          </button>
          <label className="ml-2 hidden items-center gap-1.5 text-xs text-ink-3 sm:flex">
            Speed
            <input type="range" min={-40} max={50} step={10} value={p.rate} onChange={(e) => p.setRate(Number(e.target.value))} className="w-20 accent-ink" aria-label="Voice speed" />
          </label>
        </div>
      </div>

      <div className={cn("grid gap-3", p.faceToFace ? "grid-cols-1" : "md:grid-cols-[1fr_auto_1fr]")}>
        {p.faceToFace ? renderPad("b", true) : renderPad("a")}
        {!p.faceToFace && (
          <button
            type="button"
            aria-label="Swap languages"
            onClick={() => {
              const a = p.langA;
              p.setLangA(p.langB);
              p.setLangB(a);
            }}
            className="mx-auto inline-flex size-10 items-center justify-center self-center rounded-full border border-line bg-paper text-ink hover:border-ink-3"
          >
            <ArrowLeftRight aria-hidden className="size-4 md:rotate-0" />
          </button>
        )}
        {p.faceToFace ? renderPad("a") : renderPad("b")}
      </div>

      {/* Transcript */}
      <div className="rounded-md border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2">
          <span className="label-mono text-ink-3">Conversation ({turns.length})</span>
          <div className="flex items-center gap-1.5">
            <button type="button" className={btn} disabled={!turns.length} onClick={() => exportAs("txt")}>
              <Download aria-hidden className="size-3.5" /> TXT
            </button>
            <button type="button" className={btn} disabled={!turns.length} onClick={() => exportAs("srt")}>SRT</button>
            <button type="button" className={btn} disabled={!turns.length} onClick={() => exportAs("json")}>JSON</button>
            <button type="button" className={btn} disabled={!turns.length} onClick={() => setTurns([])} aria-label="Clear conversation">
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
        <div ref={listRef} className="max-h-[52vh] min-h-40 space-y-3 overflow-y-auto p-3 sm:p-4">
          {turns.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-3">
              Tap a microphone and speak. Each line is translated for the other person{p.autoSpeak ? " and read aloud" : ""}.
            </p>
          )}
          {turns.map((t) => (
            <div key={t.id} className={cn("flex", t.side === "a" ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[92%] rounded-lg border px-3.5 py-2.5 sm:max-w-[75%]", t.side === "a" ? "rounded-bl-sm border-line bg-surface" : "rounded-br-sm border-ink/20 bg-paper-2")}>
                <p className="text-ink-2" style={{ fontSize: Math.max(12, p.size - 3) }} dir={p.isRtl(t.from) ? "rtl" : "auto"}>
                  {t.original}
                </p>
                <p className="mt-1 font-medium text-ink" style={{ fontSize: p.size }} dir={p.isRtl(t.to) ? "rtl" : "auto"}>
                  {t.pending ? <span className="inline-flex items-center gap-1.5 text-ink-3"><Loader2 aria-hidden className="size-3.5 animate-spin" /> translating…</span> : t.error ? <span className="text-danger">{t.error}</span> : t.translated}
                </p>
                {!t.pending && !t.error && (
                  <div className="mt-1.5 flex items-center gap-1 text-ink-3">
                    <span className="mr-auto font-mono text-[11px]">
                      {languageLabel(t.from, p.languages)} → {languageLabel(t.to, p.languages)}
                    </span>
                    <button type="button" className="rounded-sm p-1 hover:text-ink" aria-label="Play again" onClick={() => (speakingId === t.id ? (stopSpeaking(), setSpeakingId(null)) : replay(t))}>
                      {speakingId === t.id ? <Square className="size-3.5 text-accent" /> : <Volume2 className="size-3.5" />}
                    </button>
                    <CopyButton text={t.translated} iconOnly label="Copy translation" ghost />
                    <button type="button" className="rounded-sm p-1 hover:text-ink" aria-label="Show full screen" onClick={() => setShow(t)}>
                      <Expand className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {show && <ShowCard text={show.translated} sub={show.original} lang={show.to} rtl={p.isRtl(show.to)} onClose={() => setShow(null)} onSpeak={() => replay(show)} />}
    </div>
  );
}

/** Milliseconds to "HH:MM:SS,mmm". */
function srtTime(ms: number): string {
  const s = Math.max(0, ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const milli = Math.round((s % 1) * 1000) % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function engineIsServer() {
  return !browserRecognitionSupported();
}

/** Big text to show someone across a counter: full screen, tap to close. */
function ShowCard({ text, sub, lang, rtl, onClose, onSpeak }: { text: string; sub?: string; lang: string; rtl: boolean; onClose: () => void; onSpeak?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const len = text.length;
  const fontSize = len < 20 ? "clamp(40px, 11vw, 120px)" : len < 60 ? "clamp(30px, 7vw, 80px)" : len < 160 ? "clamp(24px, 5vw, 56px)" : "clamp(18px, 3.4vw, 38px)";
  return (
    <div role="dialog" aria-modal="true" aria-label="Translation shown full screen" lang={lang} className="fixed inset-0 z-[70] flex flex-col bg-ink text-paper">
      <div className="flex items-center justify-end gap-2 p-3">
        {onSpeak && (
          <button type="button" onClick={onSpeak} className="inline-flex items-center gap-1.5 rounded-sm border border-paper/30 px-3 py-2 text-sm">
            <Volume2 className="size-4" /> Speak
          </button>
        )}
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-sm border border-paper/30 px-3 py-2 text-sm" aria-label="Close">
          <X className="size-4" /> Close
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 pb-10 text-center">
        <p className="max-w-[22ch] font-semibold leading-tight" style={{ fontSize }} dir={rtl ? "rtl" : "auto"}>
          {text}
        </p>
        {sub && <p className="max-w-3xl text-base text-paper/60 sm:text-lg" dir="auto">{sub}</p>}
      </div>
    </div>
  );
}

// ======================================================================= live captions

function LiveCaptions({
  initialSource,
  initialTargets,
  languages,
  recents,
  isRtl,
  rate,
  gender,
  onError,
}: {
  initialSource: string;
  initialTargets: string[];
  languages: TranslateLanguage[];
  recents: string[];
  isRtl: (c: string) => boolean;
  rate: number;
  gender: VoiceGender;
  onError: (m: string | null) => void;
}) {
  const [source, setSource] = useState(initialSource);
  const [targets, setTargets] = useState<string[]>(initialTargets.slice(0, 3));
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [interim, setInterim] = useState("");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [speakOut, setSpeakOut] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [size, setSize] = useState(26);
  const [adding, setAdding] = useState(false);
  const sessionRef = useRef<ListenSession | null>(null);
  const runningRef = useRef(false);
  const startedAt = useRef(0);
  const speakQueue = useRef<Promise<unknown>>(Promise.resolve());
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const prev = readPrefs();
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, capTargets: targets }));
    } catch {
      // ignore
    }
  }, [targets]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [captions, interim]);

  useEffect(
    () => () => {
      runningRef.current = false;
      sessionRef.current?.abort();
      stopSpeaking();
    },
    [],
  );

  const addLine = useCallback(
    async (text: string) => {
      const id = uid();
      const line: Caption = { id, at: Date.now(), original: text, translations: {} };
      setCaptions((c) => [...c.slice(-300), line]);
      const glossary = loadGlossary();
      await Promise.all(
        targets.map(async (tl) => {
          try {
            const r = await smartTranslate({ text, source, target: tl, glossary });
            setCaptions((c) => c.map((x) => (x.id === id ? { ...x, translations: { ...x.translations, [tl]: r.translated_text } } : x)));
            if (speakOut && tl === targets[0]) {
              speakQueue.current = speakQueue.current.then(() => speak(r.translated_text, tl, { gender, rate: rate + 10 }));
            }
          } catch {
            setCaptions((c) => c.map((x) => (x.id === id ? { ...x, translations: { ...x.translations, [tl]: "⚠︎" } } : x)));
          }
        }),
      );
    },
    [targets, source, speakOut, gender, rate],
  );
  const addLineRef = useRef(addLine);
  useEffect(() => {
    addLineRef.current = addLine;
  }, [addLine]);

  const serverLoop = async () => {
    while (runningRef.current) {
      try {
        const blob = await recordUtterance({ silenceMs: 900, maxSeconds: 14 });
        if (!runningRef.current) break;
        if (blob.size < 2000) continue;
        const { text } = await transcribeClip(blob, source);
        if (text) addLineRef.current(text);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Recording stopped.");
        break;
      }
    }
    setRunning(false);
  };

  const start = () => {
    onError(null);
    if (!targets.length) {
      onError("Add at least one language to translate into.");
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setPaused(false);
    if (!startedAt.current) startedAt.current = Date.now();
    if (browserRecognitionSupported()) {
      try {
        sessionRef.current = listenBrowser({
          lang: source,
          continuous: true,
          onInterim: setInterim,
          onFinal: (t) => addLineRef.current(t),
          onEnd: () => {
            setInterim("");
            if (!runningRef.current) setRunning(false);
          },
          onError: (m) => onError(m),
        });
      } catch (e) {
        runningRef.current = false;
        setRunning(false);
        onError(e instanceof Error ? e.message : "Couldn't start listening.");
      }
    } else if (microphoneSupported()) {
      serverLoop();
    } else {
      runningRef.current = false;
      setRunning(false);
      onError("This browser can't use the microphone.");
    }
  };

  const stop = (pause = false) => {
    runningRef.current = false;
    sessionRef.current?.stop();
    setRunning(false);
    setPaused(pause);
    setInterim("");
  };

  const exportAs = (kind: "txt" | "srt" | "bilingual") => {
    if (!captions.length) return;
    const t0 = startedAt.current || captions[0].at;
    const fmt = srtTime;
    let body: string;
    if (kind === "srt") {
      body = captions
        .map((c, i) => `${i + 1}\n${fmt(c.at - t0)} --> ${fmt((captions[i + 1]?.at ?? c.at + 4000) - t0)}\n${c.translations[targets[0]] ?? c.original}`)
        .join("\n\n");
    } else if (kind === "bilingual") {
      body = captions.map((c) => [c.original, ...targets.map((t) => `[${t}] ${c.translations[t] ?? ""}`)].join("\n")).join("\n\n");
    } else body = captions.map((c) => c.original).join("\n");
    saveBlob(new Blob([body], { type: "text/plain;charset=utf-8" }), `live-captions.${kind === "srt" ? "srt" : "txt"}`);
  };

  const recent = captions.slice(-8);

  const captionView = (big: boolean) => (
    <div ref={big ? undefined : boxRef} className={cn("overflow-y-auto", big ? "flex flex-1 flex-col justify-end gap-6 p-6 sm:p-10" : "max-h-[55vh] min-h-56 space-y-4 p-4")}>
      {captions.length === 0 && !interim && (
        <p className={cn("text-center", big ? "text-paper/50" : "py-10 text-sm text-ink-3")}>
          {running ? "Listening… start talking." : `Press Start and speak ${languageLabel(source, languages)}; translations appear here live.`}
        </p>
      )}
      {(big ? recent.slice(-3) : captions).map((c) => (
        <div key={c.id} className="space-y-1">
          <p className={cn(big ? "text-paper/55" : "text-sm text-ink-3")} style={big ? { fontSize: size * 0.55 } : undefined} dir={isRtl(source) ? "rtl" : "auto"}>
            {c.original}
          </p>
          {targets.map((t) => (
            <p key={t} className={cn("font-medium", big ? "text-paper" : "text-ink")} style={{ fontSize: big ? (t === targets[0] ? size * 1.25 : size * 0.75) : t === targets[0] ? size * 0.7 : size * 0.55 }} dir={isRtl(t) ? "rtl" : "auto"}>
              {targets.length > 1 && <span className={cn("mr-2 font-mono text-[11px] uppercase", big ? "text-paper/40" : "text-ink-3")}>{t}</span>}
              {c.translations[t] ?? <span className="opacity-50">…</span>}
            </p>
          ))}
        </div>
      ))}
      {interim && (
        <p className={cn("italic", big ? "text-paper/50" : "text-sm text-ink-3")} style={big ? { fontSize: size * 0.6 } : undefined}>
          {interim}…
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,260px)_1fr]">
        <LanguagePicker label="Speaker's language" value={source} onChange={setSource} languages={languages} recents={recents} disabled={running} />
        <div className="min-w-0">
          <span className="label-mono block text-ink-3">Translate into (up to 3)</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {targets.map((t) => (
              <span key={t} className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line bg-surface pl-3 pr-1 text-sm">
                {languageLabel(t, languages)}
                <button type="button" aria-label={`Remove ${languageLabel(t, languages)}`} onClick={() => setTargets((l) => l.filter((x) => x !== t))} className="rounded-sm p-1 text-ink-3 hover:text-ink">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            {targets.length < 3 &&
              (adding ? (
                <div className="w-60">
                  <LanguagePicker
                    label="Add"
                    value=""
                    defaultOpen
                    onDismiss={() => setAdding(false)}
                    onChange={(c) => {
                      setAdding(false);
                      if (c && c !== source && !targets.includes(c)) setTargets((l) => [...l, c].slice(0, 3));
                    }}
                    languages={languages.filter((l) => l.code !== source && !targets.includes(l.code))}
                    recents={recents}
                    compact
                  />
                </div>
              ) : (
                <button type="button" className={cn(btn, "h-10")} onClick={() => setAdding(true)}>
                  <Plus aria-hidden className="size-3.5" /> Add
                </button>
              ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {running ? (
          <>
            <button type="button" onClick={() => stop(true)} className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-paper">
              <Pause aria-hidden className="size-4" /> Pause
            </button>
            <span className="inline-flex items-center gap-2 text-sm text-ink-2">
              <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger" /> Live
            </span>
          </>
        ) : (
          <button type="button" onClick={start} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper">
            <Play aria-hidden className="size-4" /> {paused || captions.length ? "Resume" : "Start live captions"}
          </button>
        )}
        <button type="button" className={bx("idle", "lg")} onClick={() => setFullscreen(true)}>
          <Expand aria-hidden className="size-4" /> Full screen
        </button>
        <Toggle checked={speakOut} onChange={setSpeakOut} label="Read the first language aloud" />
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={btn} aria-label="Smaller captions" onClick={() => setSize((s) => Math.max(16, s - 3))}>
            <Minus aria-hidden className="size-3.5" />
          </button>
          <button type="button" className={btn} aria-label="Larger captions" onClick={() => setSize((s) => Math.min(48, s + 3))}>
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="rounded-md border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2">
          <span className="label-mono text-ink-3">Captions ({captions.length})</span>
          <div className="flex gap-1.5">
            <button type="button" className={btn} disabled={!captions.length} onClick={() => exportAs("srt")}>
              <Download aria-hidden className="size-3.5" /> SRT
            </button>
            <button type="button" className={btn} disabled={!captions.length} onClick={() => exportAs("bilingual")}>All languages</button>
            <button type="button" className={btn} disabled={!captions.length} onClick={() => exportAs("txt")}>Original</button>
            <button type="button" className={btn} disabled={!captions.length || running} onClick={() => { setCaptions([]); startedAt.current = 0; }} aria-label="Clear captions">
              <RotateCcw aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
        {captionView(false)}
      </div>

      {fullscreen && (
        <div role="dialog" aria-modal="true" aria-label="Live captions full screen" className="fixed inset-0 z-[70] flex flex-col bg-ink">
          <div className="flex items-center justify-between gap-2 p-3">
            <span className="inline-flex items-center gap-2 text-sm text-paper/70">
              {running && <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger" />}
              {languageLabel(source, languages)} → {targets.map((t) => languageLabel(t, languages)).join(", ")}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => (running ? stop(true) : start())} className="inline-flex items-center gap-1.5 rounded-sm border border-paper/30 px-3 py-2 text-sm text-paper">
                {running ? <Pause className="size-4" /> : <Play className="size-4" />} {running ? "Pause" : "Start"}
              </button>
              <button type="button" onClick={() => setFullscreen(false)} className="inline-flex items-center gap-1.5 rounded-sm border border-paper/30 px-3 py-2 text-sm text-paper" aria-label="Exit full screen">
                <X className="size-4" />
              </button>
            </div>
          </div>
          {captionView(true)}
        </div>
      )}
    </div>
  );
}

// ======================================================================= phrasebook

function Phrasebook({
  langA,
  langB,
  setLangA,
  setLangB,
  languages,
  recents,
  isRtl,
  gender,
  rate,
  onError,
}: {
  langA: string;
  langB: string;
  setLangA: (c: string) => void;
  setLangB: (c: string) => void;
  languages: TranslateLanguage[];
  recents: string[];
  isRtl: (c: string) => boolean;
  gender: VoiceGender;
  rate: number;
  onError: (m: string | null) => void;
}) {
  const [cat, setCat] = useState(PHRASEBOOK[0].id);
  const [data, setData] = useState<Record<string, { mine: string[]; theirs: string[] }>>({});
  const [romanized, setRomanized] = useState<Record<string, string>>({});
  const [show, setShow] = useState<{ text: string; sub: string } | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const key = `${cat}|${langA}|${langB}`;
  const phrases = useMemo(() => PHRASEBOOK.find((c) => c.id === cat)?.phrases ?? [], [cat]);
  const entry = data[key];

  useEffect(() => {
    if (data[key]) return;
    const ctrl = new AbortController();
    const mineP = langA === "en" ? Promise.resolve(phrases) : translateBatch({ texts: phrases, source: "en", target: langA, signal: ctrl.signal }).then((r) => r.translated_texts);
    const theirsP = langB === "en" ? Promise.resolve(phrases) : translateBatch({ texts: phrases, source: "en", target: langB, signal: ctrl.signal }).then((r) => r.translated_texts);
    Promise.all([mineP, theirsP])
      .then(([mine, theirs]) => setData((d) => ({ ...d, [key]: { mine, theirs } })))
      .catch((e) => !(e instanceof DOMException && e.name === "AbortError") && onError(e instanceof Error ? e.message : "Couldn't load phrases."));
    return () => ctrl.abort();
  }, [key, data, langA, langB, phrases, onError]);

  const say = async (i: number) => {
    if (!entry) return;
    setSpeakingIdx(i);
    await speak(entry.theirs[i], langB, { gender, rate });
    setSpeakingIdx((s) => (s === i ? null : s));
    const k = `${langB}|${entry.theirs[i]}`;
    if (!(k in romanized)) {
      lookupInsights(entry.theirs[i], langB, langA)
        .then((ins) => setRomanized((r) => ({ ...r, [k]: ins.source_romanization })))
        .catch(() => setRomanized((r) => ({ ...r, [k]: "" })));
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <LanguagePicker label="I speak" value={langA} onChange={setLangA} languages={languages} recents={recents} />
        <button type="button" aria-label="Swap languages" onClick={() => { setLangA(langB); setLangB(langA); }} className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-paper hover:border-ink-3">
          <ArrowLeftRight aria-hidden className="size-4" />
        </button>
        <LanguagePicker label="They speak" align="end" value={langB} onChange={setLangB} languages={languages} recents={recents} />
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {PHRASEBOOK.map((c) => (
          <button key={c.id} type="button" onClick={() => setCat(c.id)} className={cn(bx(cat === c.id ? "on" : "idle", "md"), "shrink-0")}>
            {c.label}
          </button>
        ))}
      </div>
      {!entry ? (
        <p className="flex items-center gap-2 py-8 text-sm text-ink-3">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Translating phrases into {languageLabel(langB, languages)}…
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {phrases.map((_, i) => {
            const rk = `${langB}|${entry.theirs[i]}`;
            return (
              <li key={i} className="flex items-start gap-2 rounded-md border border-line bg-surface p-3">
                <button type="button" onClick={() => say(i)} className="min-w-0 flex-1 text-left" aria-label={`Say: ${entry.theirs[i]}`}>
                  <span className="block text-xs text-ink-3" dir={isRtl(langA) ? "rtl" : "auto"}>{entry.mine[i]}</span>
                  <span className="mt-0.5 block text-base font-medium text-ink" dir={isRtl(langB) ? "rtl" : "auto"}>{entry.theirs[i]}</span>
                  {romanized[rk] && <span className="mt-0.5 block text-xs italic text-ink-3">{romanized[rk]}</span>}
                </button>
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" className={btn} onClick={() => (speakingIdx === i ? (stopSpeaking(), setSpeakingIdx(null)) : say(i))} aria-label="Speak">
                    {speakingIdx === i ? <Square className="size-3.5 text-accent" /> : <Volume2 className="size-3.5" />}
                  </button>
                  <button type="button" className={btn} onClick={() => setShow({ text: entry.theirs[i], sub: entry.mine[i] })} aria-label="Show full screen">
                    <Expand className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {show && <ShowCard text={show.text} sub={show.sub} lang={langB} rtl={isRtl(langB)} onClose={() => setShow(null)} onSpeak={() => speak(show.text, langB, { gender, rate })} />}
    </div>
  );
}
