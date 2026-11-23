import { FX_PRESETS, MASTER_PRESETS } from "../constants";
import { localPlan, makeLoop, realize } from "../engine/composer";
import type { Project } from "../types";
import { addTrack, emptyProject, makeClip, makeEffect, makeTrack, putClips } from "./project";

/** Starting points: a blank song, a beat, a podcast, an audio story, a songwriter sketch, a demo. */

export type TemplateId = "blank" | "beat" | "podcast" | "story" | "songwriter" | "demo";

export const TEMPLATES: { id: TemplateId; label: string; hint: string }[] = [
  { id: "demo", label: "Demo song", hint: "A finished pop track to explore" },
  { id: "beat", label: "Beat maker", hint: "Drums, 808 and keys on a 4-bar loop" },
  { id: "songwriter", label: "Songwriter", hint: "Vocal, guitar and piano tracks" },
  { id: "podcast", label: "Podcast", hint: "Host, guest, music bed that ducks" },
  { id: "story", label: "Audio story", hint: "Narration, ambience, effects, score" },
  { id: "blank", label: "Blank", hint: "Start from nothing" },
];

const fx = (id: string) => FX_PRESETS.find((f) => f.id === id)!.chain.map((f) => makeEffect(f.type, f.params));

export function fromTemplate(id: TemplateId, seed = Date.now() % 100000): Project {
  let p = emptyProject();
  const add = (kind: Parameters<typeof makeTrack>[1], o: Parameters<typeof makeTrack>[2]) => {
    const t = makeTrack(p, kind, o);
    p = addTrack(p, t);
    return t;
  };
  switch (id) {
    case "demo":
      return { ...realize(localPlan({ genre: "pop", mood: "happy", seconds: 75, seed: 4242, key: "E", bpm: 112 }), 4242).project, name: "Demo song" };
    case "beat": {
      p = { ...p, name: "New beat", bpm: 92, keyRoot: 9, scale: "minor", loop: { on: true, start: 0, end: 16 } };
      const parts = [
        { kind: "drums" as const, loop: "drums" as const, name: "Drums" },
        { kind: "instrument" as const, loop: "bass" as const, name: "808" },
        { kind: "instrument" as const, loop: "chords" as const, name: "Keys" },
      ];
      for (const part of parts) {
        const l = makeLoop(part.loop, "hiphop", 9, "minor", seed);
        const t = add(l.trackKind, { name: part.name, instrument: l.instrument, volume: part.loop === "drums" ? 1.1 : part.loop === "bass" ? 1 : 0.6 });
        const reps = 4 / l.bars;
        const clips = Array.from({ length: reps }, (_, i) => makeClip(t.id, { name: part.name, start: i * l.bars * 4, length: l.bars * 4, notes: l.notes.map((n) => ({ ...n, id: `${n.id}${i}` })), swing: 0.2 }));
        p = putClips(p, clips);
      }
      return p;
    }
    case "songwriter":
      p = { ...p, name: "Song sketch", bpm: 90 };
      add("audio", { name: "Vocal", armed: true, fx: fx("clean-vocal") });
      add("instrument", { name: "Guitar", instrument: "guitar", fx: [makeEffect("reverb", { mix: 0.18, size: 1.8 })] });
      add("instrument", { name: "Piano", instrument: "piano", fx: [makeEffect("reverb", { mix: 0.15, size: 2 })] });
      add("drums", { name: "Drums", instrument: "kit-acoustic" });
      return p;
    case "podcast": {
      p = { ...p, name: "Podcast episode", bpm: 120 };
      const host = add("audio", { name: "Host", armed: true, fx: fx("podcast") });
      add("audio", { name: "Guest", fx: fx("podcast") });
      add("audio", { name: "Music bed", volume: 0.5, duck: { source: host.id, amount: 14 } });
      add("audio", { name: "Sound effects", volume: 0.7 });
      const m = MASTER_PRESETS.find((x) => x.id === "podcast")!;
      return { ...p, master: { volume: 0.9, fx: m.chain.map((f) => makeEffect(f.type, f.params)) } };
    }
    case "story": {
      p = { ...p, name: "Audio story", bpm: 80 };
      const narr = add("audio", { name: "Narration", armed: true, fx: fx("clean-vocal") });
      add("audio", { name: "Ambience", volume: 0.4, fx: [makeEffect("reverb", { mix: 0.3, size: 3 })] });
      add("audio", { name: "Sound effects", volume: 0.7 });
      add("instrument", { name: "Score", instrument: "strings", volume: 0.5, duck: { source: narr.id, amount: 10 }, fx: [makeEffect("reverb", { mix: 0.35, size: 4 })] });
      return p;
    }
    default:
      p = { ...p, name: "Untitled song" };
      add("instrument", { name: "Piano", instrument: "piano" });
      add("drums", { name: "Drums", instrument: "kit-808" });
      add("audio", { name: "Audio 1" });
      return p;
  }
}
