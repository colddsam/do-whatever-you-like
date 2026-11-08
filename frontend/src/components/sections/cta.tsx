"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { Container, SignalDot } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";

export function Cta() {
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    // TODO: wire to the backend once a request endpoint exists.
    setSent(true);
  };

  return (
    <section id="request" aria-labelledby="cta-title" className="border-t border-line">
      <Container className="py-20 md:py-28">
        <Reveal>
          <div className="rounded-lg border border-line bg-surface p-6 sm:p-10 md:p-14">
            <p className="label-mono flex items-center gap-2 text-ink-2">
              <SignalDot pulse /> Request a tool
            </p>
            <h2 id="cta-title" className="text-display mt-6 max-w-[14ch] text-balance">
              Got something to get <span className="serif-em text-accent">done?</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-2">
              Describe the task in a sentence. If enough people need it, it becomes the next tool on
              Do-Whatever.
            </p>

            <form onSubmit={onSubmit} className="mt-10 max-w-2xl">
              <label htmlFor="request-input" className="sr-only">
                Describe the task you want done
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="request-input"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={sent}
                  placeholder="e.g. Convert HEIC photos to JPG in bulk"
                  className="h-12 flex-1 rounded-md border border-line bg-paper px-4 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={sent}
                  className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-colors hover:bg-ink/85 disabled:cursor-default disabled:bg-success"
                >
                  {sent ? (
                    <>
                      <Check aria-hidden className="size-4" /> Noted
                    </>
                  ) : (
                    <>
                      Send request
                      <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </div>
              <AnimatePresence>
                {sent && (
                  <motion.p
                    role="status"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 text-sm text-success"
                  >
                    Thanks! Your request has been added to the list.
                  </motion.p>
                )}
              </AnimatePresence>
            </form>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
