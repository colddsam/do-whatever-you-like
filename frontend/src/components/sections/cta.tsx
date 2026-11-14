"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Copy, Loader2, Mail, RotateCcw } from "lucide-react";
import { Container, SignalDot } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { CONTACT_EMAIL } from "@/lib/site";

const CATEGORIES = [
  "Any category",
  "Files & PDF",
  "Images",
  "Audio & video",
  "Text & translation",
  "Developer",
  "Everyday utilities",
] as const;

type SubmitStatus = "idle" | "sending" | "sent" | "error";

export function Cta() {
  const [idea, setIdea] = useState("");
  const [category, setCategory] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [mailtoHref, setMailtoHref] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const wokeRef = useRef(false);

  useEffect(() => {
    const syncIdea = () => {
      const params = new URLSearchParams(window.location.search);
      const prefill = (params.get("idea") || params.get("tool") || "").trim().slice(0, 1200);
      if (prefill) setIdea(prefill);
    };
    const raf = requestAnimationFrame(syncIdea);
    window.addEventListener("popstate", syncIdea);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("popstate", syncIdea);
    };
  }, []);

  const wakeBackend = () => {
    if (wokeRef.current) return;
    wokeRef.current = true;
    fetch("/api/tools/wake").catch(() => {});
  };

  const fallbackMailto = () => {
    const trimmed = idea.trim() || "New tool idea";
    const subject = `[Do-Whatever-You-Like] Tool Request: ${trimmed.slice(0, 70)}`;
    const body = [
      "Hi,",
      "",
      "I'd like to request a tool on Do-Whatever-You-Like:",
      "",
      trimmed,
      "",
      category ? `Category: ${category}` : "",
      replyTo.trim() ? `My email: ${replyTo.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return `mailto:${encodeURIComponent(CONTACT_EMAIL)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const copyFallbackMessage = async () => {
    const text = [
      `To: ${CONTACT_EMAIL}`,
      category ? `Category: ${category}` : "",
      replyTo.trim() ? `Reply email: ${replyTo.trim()}` : "",
      "",
      idea.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const resetForm = () => {
    setIdea("");
    setCategory("");
    setReplyTo("");
    setStatus("idle");
    setStatusMessage("");
    setMailtoHref(null);
    setTimeout(() => inputRef.current?.focus(), 20);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;

    const trimmed = idea.trim();
    if (trimmed.length < 3) {
      setStatus("error");
      setStatusMessage("Please write at least 3 characters describing the tool you want.");
      setMailtoHref(null);
      inputRef.current?.focus();
      return;
    }

    setStatus("sending");
    setStatusMessage("");
    setMailtoHref(null);

    try {
      const res = await fetch("/api/tools/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: trimmed,
          category: category || null,
          replyTo: replyTo.trim() || null,
          pageUrl: typeof window !== "undefined" ? window.location.href : null,
          website,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; delivered?: boolean; message?: string; detail?: string; mailto?: string }
        | null;

      if (!res.ok) {
        setStatus("error");
        setStatusMessage(data?.detail || `Could not send automatically right now. You can send directly to ${CONTACT_EMAIL}.`);
        setMailtoHref(data?.mailto || fallbackMailto());
        return;
      }

      setStatus("sent");
      setStatusMessage(data?.message || `Sent! Your tool request is on its way to ${CONTACT_EMAIL}.`);
    } catch {
      setStatus("error");
      setStatusMessage(`Network error while sending. You can email ${CONTACT_EMAIL} directly below.`);
      setMailtoHref(fallbackMailto());
    }
  };

  const locked = status === "sending" || status === "sent";

  return (
    <section id="request" aria-labelledby="cta-title" className="border-t border-line">
      <Container className="py-20 md:py-28">
        <Reveal>
          <div className="rounded-lg border border-line bg-surface p-6 sm:p-10 md:p-14">
            <p className="label-mono flex items-center gap-2 text-ink-2">
              <SignalDot pulse /> Request a tool
            </p>
            <h2 id="cta-title" className="text-display mt-6 max-w-[14ch] text-balance max-sm:text-[2.5rem]">
              Got something to get <span className="serif-em text-accent">done?</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-2">
              Describe the task in a sentence. Your message goes straight to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                {CONTACT_EMAIL}
              </a>{" "}
              — if enough people need it, it becomes the next tool.
            </p>

            <form onSubmit={onSubmit} className="mt-10 max-w-2xl" noValidate>
              {/* Offscreen honeypot to filter automated spam without adding a CAPTCHA. */}
              <input
                type="text"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="sr-only"
              />

              <label htmlFor="request-input" className="sr-only">
                Describe the task you want done
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  ref={inputRef}
                  id="request-input"
                  value={idea}
                  onFocus={wakeBackend}
                  onChange={(e) => {
                    setIdea(e.target.value);
                    if (status === "error") {
                      setStatus("idle");
                      setStatusMessage("");
                    }
                  }}
                  disabled={locked}
                  maxLength={1200}
                  placeholder="e.g. Convert HEIC photos to JPG in bulk"
                  className="h-12 w-full min-w-0 rounded-md border border-line bg-paper px-4 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-60 sm:flex-1"
                />
                <button
                  type="submit"
                  disabled={locked}
                  aria-busy={status === "sending"}
                  className="group inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-colors hover:bg-ink/85 disabled:cursor-default disabled:bg-ink/75 data-[sent=true]:bg-success"
                  data-sent={status === "sent"}
                >
                  {status === "sending" ? (
                    <>
                      <Loader2 aria-hidden className="size-4 animate-spin" /> Sending…
                    </>
                  ) : status === "sent" ? (
                    <>
                      <Check aria-hidden className="size-4" /> Sent
                    </>
                  ) : (
                    <>
                      Send request
                      <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="request-category" className="sr-only">
                    Tool category (optional)
                  </label>
                  <select
                    id="request-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={locked}
                    className="h-10 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-60"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c === "Any category" ? "" : c}>
                        {c === "Any category" ? "Category (optional)" : c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="request-email" className="sr-only">
                    Your email (optional, if you&apos;d like a reply)
                  </label>
                  <input
                    id="request-email"
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    disabled={locked}
                    maxLength={160}
                    placeholder="Your email (optional, for a reply)"
                    className="h-10 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-60"
                  />
                </div>
              </div>

              <AnimatePresence mode="wait">
                {status === "sent" && (
                  <motion.div
                    key="sent-feedback"
                    role="status"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-paper px-4 py-3 text-sm text-success"
                  >
                    <span>{statusMessage}</span>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex items-center gap-1.5 font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                    >
                      <RotateCcw aria-hidden className="size-3.5" />
                      Send another idea
                    </button>
                  </motion.div>
                )}

                {status === "error" && (
                  <motion.div
                    key="error-feedback"
                    role="alert"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-4 rounded-md border border-danger/30 bg-paper px-4 py-3 text-sm text-ink"
                  >
                    <p className="text-danger">{statusMessage}</p>
                    {mailtoHref && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <a
                          href={mailtoHref}
                          className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-ink px-3 text-xs font-medium text-paper transition-colors hover:bg-ink/85"
                        >
                          <Mail aria-hidden className="size-3.5" />
                          Email {CONTACT_EMAIL}
                        </a>
                        <button
                          type="button"
                          onClick={copyFallbackMessage}
                          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:border-ink-3"
                        >
                          {copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
                          {copied ? "Copied" : "Copy message"}
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
