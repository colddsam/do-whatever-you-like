"use client";

import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { getStudio, useStudio, type BottomTab } from "../store";
import { Keys } from "./keys";
import { LyricsPanel } from "./lyrics";
import { Mixer } from "./mixer";
import { PianoRoll } from "./piano-roll";
import { StepSequencer } from "./step-seq";
import { WaveEditor } from "./wave-editor";

export const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
  { id: "editor", label: "Editor" },
  { id: "mixer", label: "Mixer" },
  { id: "keys", label: "Keys" },
  { id: "lyrics", label: "Lyrics" },
];

/** The editor for the open clip: piano roll, step sequencer or audio editor. */
export function ClipEditor() {
  const { clip, track, selected } = useStudio(
    useShallow((s) => {
      const clip = s.editorClip ? s.project.clips[s.editorClip] : undefined;
      return { clip, track: clip ? s.project.tracks.find((t) => t.id === clip.trackId) : undefined, selected: s.selectedClips[0] };
    }),
  );
  if (!clip || !track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="max-w-sm text-[13px] text-paper-dim">Double-click a clip (or select it and tap below) to edit it here: notes in the piano roll, beats in the step sequencer, audio in the audio editor. Double-click an empty instrument or drum lane to start a new clip.</p>
        {selected && (
          <button type="button" onClick={() => getStudio().openEditor(selected)} className="h-8 rounded-md bg-paper px-3 text-[13px] font-medium text-ink">
            Edit the selected clip
          </button>
        )}
      </div>
    );
  }
  if (clip.assetId) return <WaveEditor key={clip.id} clip={clip} />;
  if (track.kind === "drums") return <StepSequencer key={clip.id} clip={clip} track={track} />;
  return <PianoRoll key={clip.id} clip={clip} track={track} />;
}

export function BottomDock({ tabs = true }: { tabs?: boolean }) {
  const tab = useStudio((s) => s.bottomTab);
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      {tabs && (
        <div role="tablist" aria-label="Bottom panel" className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line-dark bg-ink-raised px-1.5">
          {BOTTOM_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => getStudio().set({ bottomTab: t.id })}
              className={cn("relative h-7 rounded-sm px-3 text-[12px] font-medium transition-colors", tab === t.id ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {tab === "editor" && <ClipEditor />}
        {tab === "mixer" && <Mixer />}
        {tab === "keys" && <Keys />}
        {tab === "lyrics" && <LyricsPanel />}
      </div>
    </div>
  );
}
