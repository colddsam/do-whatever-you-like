"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe, Link2 } from "lucide-react";
import { checkFile, saveBlob, uploadForm } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Toggle } from "./kit";
import { messageOf, swap } from "./parts";
import { FileRow, ResultPanel, useCapability, type TaskResult } from "./task";

/** Browser-side check; the server re-checks and also refuses private and internal addresses. */
function checkUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Paste the address of a web page.";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "Use a web address that starts with http:// or https://.";
    if (!u.hostname.includes(".") || u.hostname === "localhost") return "Use a public web address, like example.com.";
    return null;
  } catch {
    return "That doesn't look like a web address.";
  }
}

export function HtmlToPdfTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const available = useCapability("web");
  const [source, setSource] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState("a4");
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState("small");
  const [background, setBackground] = useState(true);
  const [screen, setScreen] = useState(true);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<TaskResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);
  const busy = isBusy(job);

  const urlError = source === "url" ? checkUrl(url) : null;
  const hasInput = source === "url" ? !urlError : Boolean(file);
  const step = !hasInput ? 0 : !result ? 1 : result.saved ? 3 : 2;

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };

  const start = async () => {
    if (!hasInput || available === false) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    if (source === "url") form.append("url", url.trim());
    else if (file) form.append("file", file, file.name);
    form.append("page_size", pageSize);
    form.append("landscape", String(landscape));
    form.append("margin", margin);
    form.append("background", String(background));
    form.append("screen", String(screen));
    setJob({ kind: "processing" });
    try {
      const out = await uploadForm("/api/tools/convert/html-to-pdf", form, { signal: ctrl.signal, fallbackName: "page.pdf" });
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, parts: null });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>The page is opened by our server in a private browser, printed and closed. Nothing is kept.</>}
    >
      <div className="border-b border-line bg-paper/60 p-2 sm:px-3">
        <Chips
          value={source}
          onChange={(v) => {
            reset();
            setSource(v);
          }}
          disabled={busy}
          label="What to convert"
          options={[
            { value: "url", label: <span className="inline-flex items-center gap-1.5"><Link2 aria-hidden className="size-4" /> Web address</span> },
            { value: "file", label: <span className="inline-flex items-center gap-1.5"><Globe aria-hidden className="size-4" /> HTML file</span> },
          ]}
        />
      </div>
      <div className="space-y-3 p-3 sm:p-4">
        {available === false && (
          <Notice tone="warning">Web page conversion isn&apos;t set up on this server yet. It needs Playwright&apos;s Chromium installed next to the backend.</Notice>
        )}
        {source === "url" ? (
          <div>
            <label htmlFor="html-url" className="label-mono text-ink-3">
              Web address
            </label>
            <input
              id="html-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (result) reset();
              }}
              onBlur={() => setTouched(true)}
              placeholder="https://example.com/article"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              disabled={busy}
              aria-invalid={touched && Boolean(urlError)}
              className="mt-2 h-12 w-full rounded-md border border-line bg-surface px-3.5 font-mono text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15"
            />
            <p className={touched && urlError && url ? "mt-1.5 text-xs text-danger" : "mt-1.5 text-xs text-ink-3"}>
              {touched && urlError && url ? urlError : "Public pages only. Pages behind a login print as their login screen."}
            </p>
          </div>
        ) : !file ? (
          <FileDrop
            accept={tool.accept?.types ?? ".html,.htm"}
            title="Drop an HTML file"
            formats="HTML or HTM · up to 10 MB"
            error={rejected}
            onFile={(f) => {
              const problem = checkFile(f, [".html", ".htm"], 10);
              setRejected(problem);
              if (!problem) {
                reset();
                setFile(f);
              }
            }}
          />
        ) : (
          <FileRow file={file} noun="HTML file" locked={busy} accept=".html,.htm" onReplace={(f) => (reset(), setFile(f))} onClear={() => (reset(), setFile(null))} />
        )}

        {hasInput && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  backLabel="Change paper"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                  note="Links in the page stay clickable in the PDF."
                />
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="space-y-3">
                <Panel>
                  <Row label="Paper">
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      <Chips value={pageSize} onChange={setPageSize} disabled={busy} options={[{ value: "a4", label: "A4" }, { value: "letter", label: "Letter" }, { value: "legal", label: "Legal" }, { value: "a3", label: "A3" }]} />
                      <Chips value={landscape ? "l" : "p"} onChange={(v) => setLandscape(v === "l")} disabled={busy} options={[{ value: "p", label: "Portrait" }, { value: "l", label: "Landscape" }]} />
                    </div>
                  </Row>
                  <Row label="Margin">
                    <Chips value={margin} onChange={setMargin} disabled={busy} options={[{ value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "large", label: "Large" }]} />
                  </Row>
                  <Row label="Look">
                    <div className="space-y-3">
                      <Toggle checked={screen} onChange={setScreen} disabled={busy} label="Look like the screen" description="Off: use the page's own print layout, if it has one (often plainer)." />
                      <Toggle checked={background} onChange={setBackground} disabled={busy} label="Print backgrounds" description="Background colours and images, as you see them in the browser." />
                    </div>
                  </Row>
                </Panel>
                <ProgressButton
                  job={job}
                  disabled={!hasInput || available === false}
                  label="Make the PDF"
                  working="Opening the page…"
                  hint="Long pages become several PDF pages."
                  onStart={start}
                  onCancel={() => abortRef.current?.abort()}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </Workbench>
  );
}
