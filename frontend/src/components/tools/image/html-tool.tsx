"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe } from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import { IMAGE_API, parseImageInfo, useImageCapabilities } from "@/lib/image";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Toggle } from "../pdf/kit";
import { isAbort, messageOf, swap } from "../pdf/parts";
import { ResultPanel, type ImageResult } from "./task";

const SCREENS = [
  { value: "mobile", label: "Phone", px: 375 },
  { value: "tablet", label: "Tablet", px: 768 },
  { value: "laptop", label: "Laptop", px: 1280 },
  { value: "desktop", label: "Desktop", px: 1440 },
  { value: "hd", label: "Full HD", px: 1920 },
] as const;
type Screen = (typeof SCREENS)[number]["value"];

/** A web page, or HTML you paste, captured as an image by a real browser on our server. */
export function HtmlToImageTool({ toolId, band }: { toolId: string; band?: React.ReactNode }) {
  const tool = getTool(toolId)!;
  const caps = useImageCapabilities();
  const [source, setSource] = useState<"url" | "html">("url");
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [screen, setScreen] = useState<Screen>("desktop");
  const [fullPage, setFullPage] = useState(true);
  const [blockAds, setBlockAds] = useState(true);
  const [popups, setPopups] = useState(true);
  const [format, setFormat] = useState<"jpg" | "png" | "webp">("jpg");
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<ImageResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const busy = isBusy(job);
  const value = source === "url" ? url.trim() : html.trim();
  const problem =
    source === "url"
      ? !value
        ? "Paste the address of a public web page."
        : !/^(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(value)
          ? "That doesn't look like a web address."
          : null
      : !value
        ? "Paste some HTML."
        : null;
  const unavailable = caps ? !caps.web : false;

  const start = async () => {
    if (problem) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ kind: "processing" });
    const form = new FormData();
    form.append(source, value);
    form.append("screen", screen);
    form.append("full_page", String(fullPage));
    form.append("block_ads", String(blockAds));
    form.append("remove_popups", String(popups));
    form.append("format", format);
    try {
      const out = await uploadForm(IMAGE_API("html"), form, { signal: ctrl.signal, fallbackName: `page.${format}`, onProcessing: () => setJob({ kind: "processing" }) });
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, files: parseImageInfo(out.info) });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted || isAbort(e)) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const step = !value ? 0 : !result ? 1 : result.saved ? 3 : 2;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Pages are opened by a browser on our server. Private and local addresses are blocked. Capture pages you have the right to use.</>}
    >
      {band}
      <div aria-live="polite" className="space-y-3 p-3 sm:p-4">
        {unavailable && <Notice tone="warning">Web page capture isn&apos;t set up on this server yet (it needs Playwright&apos;s Chromium).</Notice>}
        <div className="rounded-md border border-line bg-paper p-3">
          <Chips
            label="What to capture"
            value={source}
            onChange={setSource}
            disabled={busy}
            options={[
              { value: "url", label: "A web page" },
              { value: "html", label: "Paste HTML" },
            ]}
          />
          <div className="mt-3">
            {source === "url" ? (
              <label className="flex h-12 items-center gap-2.5 rounded-md border border-line bg-surface px-3.5 transition-[border-color,box-shadow] focus-within:border-ink focus-within:ring-4 focus-within:ring-accent/15">
                <Globe aria-hidden className="size-4 shrink-0 text-ink-3" />
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !problem && !busy && start()}
                  placeholder="https://example.com"
                  aria-label="Web page address"
                  disabled={busy}
                  spellCheck={false}
                  className="h-full min-w-0 flex-1 bg-transparent font-mono text-[14px] text-ink outline-none placeholder:text-ink-3"
                />
              </label>
            ) : (
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                rows={7}
                placeholder={"<h1>Hello</h1>\n<p>Styles in <style> tags work too.</p>"}
                aria-label="HTML to capture"
                disabled={busy}
                spellCheck={false}
                className="w-full resize-y rounded-md border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15"
              />
            )}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {result ? (
            <motion.div key="result" {...swap}>
              <ResultPanel
                result={result}
                before={null}
                onSave={() => {
                  saveBlob(result.blob, result.name);
                  setResult({ ...result, saved: true });
                }}
                onBack={() => {
                  setResult(null);
                  setJob({ kind: "ready" });
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="options" {...swap} className="space-y-3">
              <Panel>
                <Row label="Screen" hint={`${SCREENS.find((s) => s.value === screen)!.px} px wide`}>
                  <Chips label="Screen" value={screen} onChange={setScreen} disabled={busy} options={SCREENS.map(({ value, label }) => ({ value, label }))} />
                </Row>
                <Row label="Capture">
                  <div className="space-y-2.5">
                    <Toggle checked={fullPage} onChange={setFullPage} disabled={busy} label="The whole page" description={fullPage ? "Top to bottom, up to 16,000 px." : "Just what fits on one screen."} />
                    <Toggle checked={blockAds} onChange={setBlockAds} disabled={busy} label="Block ads" />
                    <Toggle checked={popups} onChange={setPopups} disabled={busy} label="Hide cookie banners and pop-ups" />
                  </div>
                </Row>
                <Row label="Format">
                  <Chips
                    label="Format"
                    value={format}
                    onChange={setFormat}
                    disabled={busy}
                    options={[
                      { value: "jpg", label: "JPG" },
                      { value: "png", label: "PNG" },
                      { value: "webp", label: "WebP" },
                    ]}
                  />
                  <p className={cn("mt-2 text-xs text-ink-3")}>{format === "png" ? "Sharpest text, biggest file." : format === "webp" ? "Small and sharp; most apps open it." : "Small, opens everywhere."}</p>
                </Row>
              </Panel>
              <ProgressButton
                job={job}
                label="Capture the page"
                working="Opening the page…"
                disabled={Boolean(problem) || unavailable}
                hint={problem ?? "A real browser loads the page, then takes the picture. It usually takes 5 to 20 seconds."}
                workingHint="Loading the page and everything on it. Long pages take a little longer."
                onStart={start}
                onCancel={() => abortRef.current?.abort()}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Workbench>
  );
}
