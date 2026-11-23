"use client";

import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGES } from "../constants";
import { capabilities, writeLyrics } from "../engine/ai";
import { lineWords, syllables } from "../lib/theory";
import { getStudio, runJob, useStudio } from "../store";
import { inputCls, JobLine, Select, TextButton } from "./controls";

/** The lyric sheet: write (or have the AI write), count syllables, then sing it into a song. */
export function LyricsPanel() {
  const lyrics = useStudio((s) => s.project.lyrics ?? "");
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState("English");
  const busy = useStudio((s) => Boolean(s.jobs.sheet));
  const set = (v: string) => getStudio().live((p) => ({ ...p, lyrics: v.slice(0, 6000) }));

  const write = async () => {
    const caps = await capabilities();
    if (!caps.ai) return getStudio().notify("AI lyrics need the site's AI service, which isn't set up here. You can still write your own.", "info");
    await runJob("sheet", "Writing lyrics", async () => {
      const text = await writeLyrics(topic || "a feeling worth singing about", null, null, language);
      getStudio().commit((p) => ({ ...p, lyrics: text }));
    });
  };

  const lines = lyrics.split("\n");
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="relative min-h-0 flex-1">
          <textarea
            aria-label="Lyric sheet"
            value={lyrics}
            onFocus={() => getStudio().checkpoint()}
            onChange={(e) => set(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={"[Verse]\nWrite a line here…\n\n[Chorus]\nYour hook…"}
            className={cn(inputCls, "h-full min-h-[120px] resize-none pr-12 font-mono text-[13px] leading-6")}
            data-lenis-prevent
          />
        </div>
        <p className="text-[12px] text-paper-dim">
          {lines.filter((l) => l.trim() && !l.trim().startsWith("[")).length} lines · counts on the right show syllables (aim for 6–12 per line so it sings well).
        </p>
      </div>
      <div className="hidden w-14 shrink-0 overflow-hidden border-l border-line-dark py-2 lg:block">
        {lines.slice(0, 200).map((l, i) => {
          const n = l.trim().startsWith("[") ? 0 : lineWords(l).reduce((a, w) => a + syllables(w), 0);
          return (
            <div key={i} className={cn("h-6 text-center font-mono text-[12px] leading-6", n > 14 ? "text-warning" : "text-paper-dim")}>
              {n || ""}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 space-y-2 border-t border-line-dark p-2 lg:w-[260px] lg:border-l lg:border-t-0">
        <input value={topic} onChange={(e) => setTopic(e.target.value.slice(0, 300))} onKeyDown={(e) => e.stopPropagation()} placeholder="What's the song about?" className={inputCls} />
        <Select label="Language" value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l, label: l }))} className="w-full" />
        <TextButton className="w-full" disabled={busy} onClick={() => void write()}>
          <Sparkles aria-hidden className="size-3.5" />
          Write with AI
        </TextButton>
        <JobLine id="sheet" />
        <TextButton
          tone="primary"
          className="w-full"
          disabled={!lyrics.trim()}
          onClick={() => {
            getStudio().set({ draftLyrics: lyrics, leftTab: "create" });
            getStudio().notify("Your lyrics are in Create → Song. Pick a genre and make it.", "info");
          }}
        >
          <Wand2 aria-hidden className="size-3.5" />
          Make a song from these lyrics
        </TextButton>
      </div>
    </div>
  );
}
