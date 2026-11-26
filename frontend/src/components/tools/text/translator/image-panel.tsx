"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, Download, Eye, EyeOff, Loader2, RotateCcw, ScanText } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { languageLabel, type TranslateLanguage } from "@/lib/translate";
import { loadGlossary, smartTranslateBatch, type VoiceGender } from "@/lib/translate-extras";
import { disposeOcr, loadImageForOcr, paintTranslation, recognizeImage, tesseractLangFor, type OcrParagraph } from "@/lib/translate-image";
import { cn } from "@/lib/utils";
import { FileDrop } from "../../file-drop";
import { Chips, Notice, Slider, Toggle } from "../../pdf/kit";
import { btn, bx, CopyButton, LanguagePicker, primaryBtn, ProgressBar, SpeakButton } from "./shared";

type Phase = "idle" | "ocr" | "translating" | "done";

export function ImagePanel({
  source,
  target,
  languages,
  isRtl,
  recents,
  voiceGender,
}: {
  source: string;
  target: string;
  languages: TranslateLanguage[];
  isRtl: (code: string) => boolean;
  recents: string[];
  voiceGender: VoiceGender;
}) {
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [name, setName] = useState("picture");
  // Follows the "From" language until a language is picked here.
  const [ocrChoice, setOcrLang] = useState<string | null>(null);
  const ocrLang = ocrChoice ?? (source !== "auto" && tesseractLangFor(source) ? source : "en");
  const [paras, setParas] = useState<OcrParagraph[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ p: number; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"translated" | "original" | "split">("translated");
  const [showBoxes, setShowBoxes] = useState(false);
  const [opacity, setOpacity] = useState(96);
  const [detected, setDetected] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const origRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => void disposeOcr(), []);

  const accept = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(file.name)) {
      setError("That isn't a picture. Try a PNG, JPG or WebP.");
      return;
    }
    try {
      const canvas = await loadImageForOcr(file);
      setImage(canvas);
      setName(file.name.replace(/\.[^.]+$/, "") || "picture");
      setParas([]);
      setPhase("idle");
      setDetected(null);
    } catch {
      setError("That picture couldn't be opened (HEIC works in Safari only). Try a JPG or PNG.");
    }
  };

  // Paste a screenshot straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        accept(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const pasteButton = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await it.getType(type);
          await accept(new File([blob], "pasted.png", { type }));
          return;
        }
      }
      setError("There's no picture on the clipboard.");
    } catch {
      setError("The browser didn't allow reading the clipboard. Press Ctrl/Cmd + V on this page instead.");
    }
  };

  const run = async () => {
    if (!image) return;
    setError(null);
    setPhase("ocr");
    setProgress({ p: 0, status: "Loading the text reader…" });
    try {
      const found = await recognizeImage(image, ocrLang === "en" ? ["en"] : [ocrLang, "en"], (p, status) => setProgress({ p, status }));
      if (!found.length) {
        setPhase("idle");
        setError(`No readable ${languageLabel(ocrLang, languages)} text was found. If the picture is in another language or script, pick it under “Text in the picture”.`);
        return;
      }
      setPhase("translating");
      const res = await smartTranslateBatch(found.map((p) => p.text), source === "auto" ? "auto" : source, target, { glossary: loadGlossary() });
      setDetected(res.detected_language);
      const withT = found.map((p, i) => ({ ...p, translated: res.translated_texts[i] }));
      setParas(withT);
      setPhase("done");
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "The picture couldn't be read.");
    } finally {
      setProgress(null);
    }
  };

  const paint = useCallback(() => {
    if (!image) return;
    if (origRef.current) {
      origRef.current.width = image.width;
      origRef.current.height = image.height;
      origRef.current.getContext("2d")!.drawImage(image, 0, 0);
    }
    if (canvasRef.current) {
      if (phase === "done") paintTranslation(canvasRef.current, image, paras, { rtl: isRtl(target), patchOpacity: opacity / 100, showBoxes });
      else {
        canvasRef.current.width = image.width;
        canvasRef.current.height = image.height;
        canvasRef.current.getContext("2d")!.drawImage(image, 0, 0);
      }
    }
  }, [image, paras, phase, opacity, showBoxes, isRtl, target]);

  useEffect(() => {
    paint();
  }, [paint, view]);

  const download = () => {
    canvasRef.current?.toBlob((b) => b && saveBlob(b, `${name}.${target}.png`), "image/png");
  };

  const allSource = paras.map((p) => p.text).join("\n\n");
  const allTranslated = paras.map((p) => p.translated ?? "").join("\n\n");

  return (
    <div className="space-y-4">
      {!image ? (
        <>
          <FileDrop accept="image/*" title="Drop a photo, screenshot, sign or menu" formats="JPG · PNG · WebP · GIF · BMP · or paste a screenshot (Ctrl/⌘ + V)" error={error} onFile={accept} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => cameraRef.current?.click()}>
              <Camera aria-hidden className="size-3.5" /> Take a photo
            </button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) accept(f); }} />
            <button type="button" className={btn} onClick={pasteButton}>
              <ClipboardPaste aria-hidden className="size-3.5" /> Paste picture
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,280px)_1fr]">
            <LanguagePicker
              label="Text in the picture"
              value={ocrLang}
              onChange={setOcrLang}
              languages={languages.filter((l) => tesseractLangFor(l.code))}
              recents={recents}
              disabled={phase === "ocr" || phase === "translating"}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryBtn} onClick={run} disabled={phase === "ocr" || phase === "translating"}>
                {phase === "ocr" || phase === "translating" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ScanText aria-hidden className="size-4" />}
                {phase === "done" ? "Read & translate again" : `Translate picture to ${languageLabel(target, languages)}`}
              </button>
              <button type="button" className={bx("idle", "lg")} onClick={() => { setImage(null); setParas([]); setPhase("idle"); setError(null); }}>
                <RotateCcw aria-hidden className="size-4" /> Another picture
              </button>
            </div>
          </div>

          {progress && <ProgressBar value={phase === "ocr" && progress.status.includes("recogniz") ? progress.p : null} label={phase === "translating" ? "Translating the text…" : progress.status ? progress.status.replace(/^\w/, (c) => c.toUpperCase()) + "…" : "Reading…"} />}
          {error && <Notice tone="danger">{error}</Notice>}

          {phase === "done" && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <Chips
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: "translated", label: "Translated" },
                  { value: "original", label: "Original" },
                  { value: "split", label: "Side by side" },
                ]}
              />
              <Toggle checked={showBoxes} onChange={setShowBoxes} label={<span className="inline-flex items-center gap-1">{showBoxes ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5" />} Outline text areas</span>} />
              <div className="w-full sm:w-56">
                <Slider label="Cover original" value={opacity} min={40} max={100} onChange={setOpacity} format={(v) => `${v}%`} />
              </div>
              <button type="button" className={cn(btn, "ml-auto")} onClick={download}>
                <Download aria-hidden className="size-3.5" /> Download PNG
              </button>
            </div>
          )}

          <div className={cn("grid gap-3", view === "split" && phase === "done" ? "md:grid-cols-2" : "grid-cols-1")}>
            <div className={cn("overflow-hidden rounded-md border border-line bg-paper-2", !(view === "original" || view === "split") || phase !== "done" ? "hidden" : "")}>
              <canvas ref={origRef} className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full" aria-label="Original picture" />
            </div>
            <div className={cn("overflow-hidden rounded-md border border-line bg-paper-2", view === "original" && phase === "done" && "hidden")}>
              <canvas ref={canvasRef} className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full" aria-label="Translated picture" />
            </div>
          </div>

          {phase === "done" && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-line">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="label-mono text-ink-3">Text found · {languageLabel(detected ?? ocrLang, languages)}</span>
                  <CopyButton text={allSource} iconOnly label="Copy text found" />
                </div>
                <p className="max-h-64 overflow-y-auto whitespace-pre-wrap p-3 text-sm text-ink-2" dir="auto">{allSource}</p>
              </div>
              <div className="rounded-md border border-line">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="label-mono text-ink-3">Translation · {languageLabel(target, languages)}</span>
                  <div className="flex gap-1">
                    <SpeakButton text={allTranslated} lang={target} gender={voiceGender} iconOnly />
                    <CopyButton text={allTranslated} iconOnly label="Copy translation" />
                  </div>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto p-3">
                  {paras.map((p, i) => (
                    <textarea
                      key={p.id}
                      aria-label={`Translation ${i + 1}`}
                      value={p.translated ?? ""}
                      dir={isRtl(target) ? "rtl" : "auto"}
                      rows={Math.min(4, Math.max(1, Math.ceil((p.translated ?? "").length / 60)))}
                      onChange={(e) => setParas((ps) => ps.map((x) => (x.id === p.id ? { ...x, translated: e.target.value } : x)))}
                      className="w-full resize-y rounded-sm border border-transparent bg-transparent p-1 text-sm text-ink outline-none hover:border-line focus:border-ink"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          {phase === "done" && <p className="text-xs text-ink-3">Fix any line on the right and the picture updates. The text is read on your device; only the words are sent for translation.</p>}
        </>
      )}
    </div>
  );
}
