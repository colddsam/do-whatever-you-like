"use client";

import { Loader2 } from "lucide-react";
import { DEFAULT_PROTECT_PATTERNS, type Insights, type VoiceGender } from "@/lib/translate-extras";
import { cn } from "@/lib/utils";
import { SpeakButton } from "./shared";

/** Dictionary-style details for short text: alternatives, meanings by part of speech, definitions, examples, synonyms. */
export function InsightsPanel({
  insights,
  busy,
  targetLang,
  isRtl,
  onUseAlternative,
  voiceGender,
}: {
  insights: Insights | null;
  busy: boolean;
  targetLang: string;
  isRtl: boolean;
  onUseAlternative: (from: string, to: string) => void;
  voiceGender: VoiceGender;
}) {
  if (busy && !insights) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-line px-3.5 py-3 text-sm text-ink-3">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Looking up meanings and alternatives…
      </p>
    );
  }
  if (!insights) return null;
  // Hide alternatives that would break a link, email or {placeholder} the main translation kept.
  const keeps = (src: string) => DEFAULT_PROTECT_PATTERNS.flatMap((re) => src.match(new RegExp(re.source, "g")) ?? []);
  const alts = insights.alternatives
    .map((a) => {
      const tokens = keeps(a.source);
      return { ...a, options: a.options.filter((o) => tokens.every((t) => o.includes(t))) };
    })
    .filter((a) => a.options.length > 1);
  return (
    <section aria-label="Word details" className="grid gap-4 rounded-md border border-line bg-paper/30 p-3.5 md:grid-cols-2">
      {alts.length > 0 && (
        <div className="md:col-span-2">
          <h3 className="label-mono mb-2 text-ink-3">Other ways to say it · tap to use</h3>
          <div className="space-y-2">
            {alts.slice(0, 6).map((a, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-1.5">
                {alts.length > 1 && <span className="mr-1 text-xs text-ink-3">{a.source}:</span>}
                {a.options.map((o, j) => (
                  <button
                    key={o + j}
                    type="button"
                    dir={isRtl ? "rtl" : "auto"}
                    onClick={() => onUseAlternative(a.options[0], o)}
                    className={cn(
                      "rounded-sm border px-2 py-1 text-sm transition-colors",
                      j === 0 ? "border-ink/40 bg-surface text-ink" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {insights.dictionary.length > 0 && (
        <div className="min-w-0">
          <h3 className="label-mono mb-2 text-ink-3">Translations of “{insights.text.length > 40 ? insights.text.slice(0, 40) + "…" : insights.text}”</h3>
          <div className="space-y-3">
            {insights.dictionary.map((g, i) => (
              <div key={i}>
                <p className="text-xs font-medium capitalize text-accent">{g.pos}</p>
                <ul className="mt-1 divide-y divide-line/70">
                  {g.entries.map((e, j) => {
                    const pct = Math.round(Math.min(1, Math.sqrt(e.score) * 1.4) * 100);
                    return (
                      <li key={j} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1" dir={isRtl ? "rtl" : "auto"}>
                          <span className="font-medium text-ink">{e.word}</span>
                          {e.reverse.length > 0 && <span className="ml-2 text-xs text-ink-3">{e.reverse.slice(0, 4).join(", ")}</span>}
                        </span>
                        <span aria-label={`Common: ${pct}%`} title="How common this translation is" className="hidden h-1 w-12 shrink-0 overflow-hidden rounded-full bg-paper-2 sm:block">
                          <span className="block h-full bg-ink-3" style={{ width: `${Math.max(8, pct)}%` }} />
                        </span>
                        <SpeakButton text={e.word} lang={targetLang} gender={voiceGender} iconOnly label={`Listen to ${e.word}`} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {(insights.definitions.length > 0 || insights.synonyms.length > 0 || insights.examples.length > 0) && (
        <div className="min-w-0 space-y-3">
          {insights.definitions.length > 0 && (
            <div>
              <h3 className="label-mono mb-2 text-ink-3">Definitions</h3>
              {insights.definitions.map((d, i) => (
                <div key={i} className="mb-2">
                  <p className="text-xs font-medium capitalize text-accent">{d.pos}</p>
                  <ol className="ml-4 list-decimal space-y-1 text-sm text-ink">
                    {d.items.map((it, j) => (
                      <li key={j}>
                        {it.gloss}
                        {it.example && <span className="block text-xs italic text-ink-3">“{it.example}”</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
          {insights.synonyms.length > 0 && (
            <div>
              <h3 className="label-mono mb-1.5 text-ink-3">Synonyms</h3>
              {insights.synonyms.map((s, i) => (
                <p key={i} className="text-sm text-ink-2">
                  {s.pos && <span className="mr-1.5 text-xs capitalize text-accent">{s.pos}</span>}
                  {s.words.join(", ")}
                </p>
              ))}
            </div>
          )}
          {insights.examples.length > 0 && (
            <div>
              <h3 className="label-mono mb-1.5 text-ink-3">Examples</h3>
              <ul className="space-y-1 text-sm italic text-ink-2">
                {insights.examples.slice(0, 4).map((e, i) => (
                  <li key={i}>“{e}”</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
