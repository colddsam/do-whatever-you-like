import { FX_PRESETS, MASTER_PRESETS } from "../constants";
import { addTrack, emptyProject, makeClip, makeEffect, makeTrack, newNote, putClips } from "../lib/project";
import { keyIndex, lineWords, parseRoman, rng, syllables, voice, type Rng } from "../lib/theory";
import type { Clip, Note, Project, SongPlan, SongSection, Track } from "../types";

/**
 * The composer. A SongPlan (from the AI, or from `localPlan` with no AI at all) becomes a full
 * arrangement: drums, bass, chords, pad, arpeggio and a melody that follows the lyrics one note
 * per syllable. Everything is seeded, so the same plan and seed always make the same song.
 */

type Style = {
  bpm: [number, number];
  mode: "major" | "minor" | "either";
  drums: string;
  bass: "root8" | "whole" | "808" | "offbeat" | "walking" | "funk" | "groove" | "afro";
  chords: "block" | "half" | "pop8" | "stab" | "strum" | "arp" | "lofi" | "comp" | "afro";
  groove: keyof typeof GROOVES;
  swing: number;
  arp: boolean;
  electronic: boolean;
  instruments: SongPlan["instruments"];
};

export const STYLES: Record<string, Style> = {
  pop: { bpm: [100, 124], mode: "either", drums: "kit-808", bass: "groove", chords: "pop8", groove: "pop", swing: 0, arp: false, electronic: false, instruments: { drums: "kit-808", bass: "synth-bass", chords: "piano", lead: "pluck", pad: "pad" } },
  hiphop: { bpm: [84, 96], mode: "minor", drums: "kit-808", bass: "808", chords: "lofi", groove: "boombap", swing: 0.25, arp: false, electronic: false, instruments: { drums: "kit-808", bass: "808-bass", chords: "epiano", lead: "bell", pad: null } },
  trap: { bpm: [130, 150], mode: "minor", drums: "kit-trap", bass: "808", chords: "block", groove: "trap", swing: 0, arp: false, electronic: true, instruments: { drums: "kit-trap", bass: "808-bass", chords: "pad", lead: "bell", pad: "choir" } },
  lofi: { bpm: [70, 86], mode: "minor", drums: "kit-lofi", bass: "whole", chords: "lofi", groove: "lofi", swing: 0.4, arp: false, electronic: false, instruments: { drums: "kit-lofi", bass: "finger-bass", chords: "epiano", lead: "flute", pad: null } },
  house: { bpm: [120, 126], mode: "either", drums: "kit-house", bass: "offbeat", chords: "stab", groove: "house", swing: 0.1, arp: false, electronic: true, instruments: { drums: "kit-house", bass: "synth-bass", chords: "synth-stab", lead: "pluck", pad: "pad" } },
  edm: { bpm: [124, 130], mode: "either", drums: "kit-electro", bass: "offbeat", chords: "stab", groove: "house", swing: 0, arp: true, electronic: true, instruments: { drums: "kit-electro", bass: "synth-bass", chords: "synth-stab", lead: "saw-lead", pad: "pad" } },
  rock: { bpm: [110, 140], mode: "either", drums: "kit-rock", bass: "root8", chords: "strum", groove: "rock", swing: 0, arp: false, electronic: false, instruments: { drums: "kit-rock", bass: "finger-bass", chords: "guitar", lead: "guitar", pad: "organ" } },
  cinematic: { bpm: [70, 96], mode: "minor", drums: "kit-acoustic", bass: "whole", chords: "block", groove: "cinematic", swing: 0, arp: false, electronic: false, instruments: { drums: "kit-acoustic", bass: "sub-bass", chords: "strings", lead: "brass", pad: "choir" } },
  ambient: { bpm: [60, 80], mode: "major", drums: "kit-lofi", bass: "whole", chords: "block", groove: "ambient", swing: 0, arp: false, electronic: false, instruments: { drums: "kit-lofi", bass: "sub-bass", chords: "pad", lead: "bell", pad: "strings" } },
  rnb: { bpm: [86, 100], mode: "either", drums: "kit-808", bass: "groove", chords: "lofi", groove: "rnb", swing: 0.2, arp: false, electronic: false, instruments: { drums: "kit-808", bass: "sub-bass", chords: "epiano", lead: "epiano", pad: "pad" } },
  jazz: { bpm: [96, 132], mode: "major", drums: "kit-acoustic", bass: "walking", chords: "comp", groove: "jazz", swing: 0.45, arp: false, electronic: false, instruments: { drums: "kit-acoustic", bass: "finger-bass", chords: "piano", lead: "brass", pad: null } },
  reggaeton: { bpm: [90, 98], mode: "minor", drums: "kit-808", bass: "808", chords: "afro", groove: "dembow", swing: 0, arp: false, electronic: true, instruments: { drums: "kit-808", bass: "808-bass", chords: "pluck", lead: "square-lead", pad: "pad" } },
  synthwave: { bpm: [92, 110], mode: "minor", drums: "kit-electro", bass: "root8", chords: "block", groove: "synthwave", swing: 0, arp: true, electronic: true, instruments: { drums: "kit-electro", bass: "synth-bass", chords: "pad", lead: "saw-lead", pad: "strings" } },
  funk: { bpm: [100, 116], mode: "either", drums: "kit-acoustic", bass: "funk", chords: "stab", groove: "funk", swing: 0.15, arp: false, electronic: false, instruments: { drums: "kit-acoustic", bass: "finger-bass", chords: "guitar", lead: "brass", pad: "organ" } },
  piano: { bpm: [66, 88], mode: "either", drums: "kit-lofi", bass: "whole", chords: "arp", groove: "none", swing: 0, arp: false, electronic: false, instruments: { drums: "kit-lofi", bass: "sub-bass", chords: "piano", lead: "piano", pad: "strings" } },
  afrobeats: { bpm: [100, 112], mode: "either", drums: "kit-808", bass: "afro", chords: "afro", groove: "afro", swing: 0.15, arp: false, electronic: false, instruments: { drums: "kit-808", bass: "synth-bass", chords: "marimba", lead: "pluck", pad: "pad" } },
  folk: { bpm: [88, 108], mode: "major", drums: "kit-acoustic", bass: "root8", chords: "strum", groove: "folk", swing: 0.1, arp: false, electronic: false, instruments: { drums: "kit-acoustic", bass: "finger-bass", chords: "guitar", lead: "flute", pad: "strings" } },
  bollywood: { bpm: [94, 110], mode: "either", drums: "kit-808", bass: "groove", chords: "strum", groove: "dholak", swing: 0.1, arp: false, electronic: false, instruments: { drums: "kit-808", bass: "synth-bass", chords: "strings", lead: "sitar", pad: "pad" } },
};

export const styleOf = (genre: string) => STYLES[genre] ?? STYLES.pop;

/** 16-step grooves per bar: x = accent, o = ghost, . = rest. */
const GROOVES = {
  pop: { 36: "x.......x.x.....", 38: "....x.......x...", 42: "x.x.x.x.x.x.x.x.", 46: "" },
  boombap: { 36: "x.....x...x.....", 38: "....x.......x...", 42: "x.x.x.x.x.x.x.x.", 46: "" },
  trap: { 36: "x.......x.....x.", 38: "........x.......", 42: "xxxxxxxxxxxxxxxx", 46: "" },
  lofi: { 36: "x......x..x.....", 38: "....x.......x...", 42: "x.o.x.o.x.o.x.o.", 46: "" },
  house: { 36: "x...x...x...x...", 39: "....x.......x...", 46: "..x...x...x...x.", 42: "" },
  rock: { 36: "x.....x.x.......", 38: "....x.......x...", 42: "x.x.x.x.x.x.x.x.", 46: "" },
  cinematic: { 36: "x...............", 45: "x.....x.x.......", 48: "........x...x...", 38: "" },
  ambient: { 36: "x...............", 70: "..o...o...o...o.", 42: "" },
  rnb: { 36: "x......x.x......", 38: "....x.......x...", 42: "x.xox.x.x.xox.x.", 46: "" },
  jazz: { 51: "x..x.x..x..x.x..", 42: "....x.......x...", 36: "x.........o.....", 38: "" },
  dembow: { 36: "x...x...x...x...", 38: "...x..x....x..x.", 42: "x.x.x.x.x.x.x.x.", 46: "" },
  synthwave: { 36: "x...x...x...x...", 38: "....x.......x...", 42: "x.x.x.x.x.x.x.x.", 46: "" },
  funk: { 36: "x..x..x...x..x..", 38: "....x..o.o..x...", 42: "xxxxxxxxxxxxxxxx", 46: "" },
  afro: { 36: "x..x..x...x.x...", 37: "...x..x....x..x.", 70: "xoxoxoxoxoxoxoxo", 42: "" },
  folk: { 36: "x.......x.......", 38: "....x.......x...", 70: "x.x.x.x.x.x.x.x.", 42: "" },
  dholak: { 36: "x..x..x.x..x..x.", 45: "..x.....x.x.....", 39: "....x.......x...", 70: "x.x.x.x.x.x.x.x." },
  none: {},
} as const;

const PROGRESSIONS = {
  major: [
    ["I", "V", "vi", "IV"],
    ["I", "vi", "IV", "V"],
    ["vi", "IV", "I", "V"],
    ["I", "IV", "vi", "V"],
    ["IV", "I", "V", "vi"],
    ["I", "iii", "IV", "V"],
    ["I", "V", "IV", "IV"],
  ],
  minor: [
    ["i", "VI", "III", "VII"],
    ["i", "iv", "VI", "V"],
    ["i", "VII", "VI", "VII"],
    ["i", "VI", "iv", "V"],
    ["i", "III", "VII", "iv"],
    ["i", "iv", "v", "i"],
  ],
  jazz: [
    ["IVmaj7", "iii7", "ii7", "V7"],
    ["Imaj7", "vi7", "ii7", "V7"],
    ["ii7", "V7", "Imaj7", "Imaj7"],
  ],
  lofi: [
    ["ivm7", "VIImaj7", "IIImaj7", "VImaj7"],
    ["i7", "iv7", "VIImaj7", "IIImaj7"],
    ["VImaj7", "v7", "i7", "i7"],
  ],
  trap: [
    ["i", "VI", "i", "VII"],
    ["i", "i", "VI", "VI"],
    ["i", "iv", "i", "VI"],
  ],
};

const MINOR_MOODS = new Set(["sad", "dark", "mysterious", "angry", "epic"]);
const MAJOR_MOODS = new Set(["happy", "energetic", "hopeful", "romantic"]);

export type LocalPlanOptions = {
  genre: string;
  mood?: string;
  seconds: number;
  vocal?: SongPlan["vocal"];
  lyrics?: { name: string; lines: string[] }[];
  title?: string;
  seed: number;
  bpm?: number;
  key?: string;
  mode?: "major" | "minor";
  energy?: number;
};

const SECTION_ENERGY: Record<string, number> = { intro: 2, verse: 3, prechorus: 3, chorus: 4, bridge: 3, drop: 5, breakdown: 2, outro: 2 };
const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** Plans a song without any AI: structure fitted to the length, chords from the genre and mood. */
export function localPlan(o: LocalPlanOptions): SongPlan {
  const r = rng(o.seed);
  const style = styleOf(o.genre);
  const mood = (o.mood ?? "").toLowerCase();
  const mode = o.mode ?? (MINOR_MOODS.has(mood) ? "minor" : MAJOR_MOODS.has(mood) ? "major" : style.mode === "either" ? r.pick(["major", "minor"] as const) : style.mode);
  let bpm = o.bpm ?? r.int(style.bpm[0], style.bpm[1]);
  if (!o.bpm && (mood === "calm" || mood === "sad" || mood === "dreamy")) bpm = Math.round(bpm * 0.92);
  if (!o.bpm && (mood === "energetic" || mood === "angry")) bpm = Math.round(bpm * 1.06);
  const targetBars = Math.max(4, Math.round((o.seconds * bpm) / 240));
  const vocal = o.vocal ?? "none";
  const pool = o.genre === "jazz" ? PROGRESSIONS.jazz : o.genre === "lofi" && mode === "minor" ? PROGRESSIONS.lofi : o.genre === "trap" && mode === "minor" ? PROGRESSIONS.trap : PROGRESSIONS[mode];
  const verseProg = r.pick(pool);
  let chorusProg = r.pick(pool);
  if (chorusProg === verseProg && pool.length > 1) chorusProg = pool[(pool.indexOf(verseProg) + 1) % pool.length];
  const bridgeProg = mode === "major" ? r.pick([["vi", "IV", "ii", "V"], ["IV", "V", "iii", "vi"]]) : r.pick([["VI", "VII", "i", "i"], ["iv", "VI", "VII", "V"]]);

  // Section shapes: songs with vocals vs. electronic builds vs. short beds.
  let shape: [string, number][];
  if (targetBars <= 8) shape = [["chorus", targetBars]];
  else if (targetBars <= 16) shape = [["intro", 4], ["chorus", targetBars - 8], ["outro", 4]];
  else if (style.electronic && vocal === "none") shape = [["intro", 8], ["verse", 8], ["drop", 16], ["breakdown", 8], ["verse", 8], ["drop", 16], ["outro", 8]];
  else shape = [["intro", 4], ["verse", 8], ["prechorus", 4], ["chorus", 8], ["verse", 8], ["prechorus", 4], ["chorus", 8], ["bridge", 8], ["chorus", 8], ["chorus", 8], ["outro", 4]];
  // Fit: drop sections from the middle (keeping the ends) or repeat the core until it fits.
  const total = () => shape.reduce((a, s) => a + s[1], 0);
  while (total() > targetBars && shape.length > 2) {
    const i = shape.findIndex((s, k) => k > 0 && k < shape.length - 1 && (s[0] === "prechorus" || s[0] === "breakdown"));
    shape.splice(i >= 0 ? i : Math.floor(shape.length / 2), 1);
  }
  if (total() > targetBars) shape[shape.length - 1][1] = Math.max(4, shape[shape.length - 1][1] - (total() - targetBars));
  const core = shape.filter((s) => s[0] === "verse" || s[0] === "chorus" || s[0] === "drop");
  let guard = 0;
  while (total() + 8 <= targetBars && guard++ < 40) shape.splice(shape.length - 1, 0, [...(core[guard % Math.max(1, core.length)] ?? ["chorus", 8])] as [string, number]);
  if (total() < targetBars) shape[shape.length - 1][1] += targetBars - total();

  const lyricPool = o.lyrics?.length ? o.lyrics : vocal !== "none" ? templateLyrics(mood || "happy", r) : [];
  const byName = (name: string) => lyricPool.filter((l) => l.name === name || (name === "prechorus" && l.name === "verse"));
  const used = new Map<string, number>();
  const sections: SongSection[] = shape.map(([name, bars]) => {
    const chords = name === "chorus" || name === "drop" ? chorusProg : name === "bridge" || name === "breakdown" ? bridgeProg : verseProg;
    let lyrics: string[] = [];
    if (vocal !== "none" && ["verse", "prechorus", "chorus", "bridge"].includes(name)) {
      const options = byName(name);
      if (options.length) {
        // Choruses repeat the same words; verses take the next verse each time.
        const k = name === "chorus" ? 0 : (used.get(name) ?? 0);
        used.set(name, k + 1);
        lyrics = options[k % options.length].lines.slice(0, Math.ceil(bars / 2));
      }
    }
    const energy = Math.max(1, Math.min(5, (SECTION_ENERGY[name] ?? 3) + (o.energy ? o.energy - 3 : 0)));
    return { name, bars, chords, energy, lyrics };
  });

  return {
    title: o.title ?? `${cap(mood || style.groove)} ${cap(o.genre)}`,
    genre: o.genre in STYLES ? o.genre : "pop",
    mood: mood || "uplifting",
    bpm,
    key: o.key ?? r.pick(KEYS),
    mode,
    vocal,
    instruments: { ...style.instruments },
    sections,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A small offline lyric bank so vocals still work with no AI available. */
function templateLyrics(mood: string, r: Rng) {
  const happy = {
    verse: [
      ["Woke up with the sunlight on my face", "Every little worry left without a trace", "Calling up my friends to meet me down the road", "Turn the music up and let the good times flow"],
      ["City lights are dancing in the summer heat", "Every heart is beating to the same old beat", "We don't need a reason, we don't need a plan", "Holding on together, doing all we can"],
    ],
    chorus: [["We are alive tonight", "Shining so bright, hold on tight", "Nothing can bring us down", "We own this town tonight"]],
    bridge: [["When the morning comes we'll still be here", "Singing out the words for all to hear"]],
  };
  const sad = {
    verse: [
      ["Rain against the window, empty coffee cup", "Counting all the reasons that I gave you up", "Pictures on the table fading into grey", "Words I should have told you on the final day"],
      ["Streetlights in the distance flicker on and off", "Every little memory is a heavy cost", "I keep walking slowly down the same old street", "Looking for your shadow where we used to meet"],
    ],
    chorus: [["Where did you go", "I'm still here waiting in the cold", "Say that you know", "I never wanted to let you go"]],
    bridge: [["Maybe in another life we'll find the way", "Maybe there's a reason that you couldn't stay"]],
  };
  const bank = MINOR_MOODS.has(mood) || mood === "calm" || mood === "dreamy" ? sad : happy;
  const verses = [...bank.verse].sort(() => r.next() - 0.5);
  return [
    ...verses.map((lines) => ({ name: "verse", lines })),
    { name: "chorus", lines: bank.chorus[0] },
    { name: "bridge", lines: bank.bridge[0] },
  ];
}

// ---------------------------------------------------------------------------------------------
// Realisation

type Ctx = { plan: SongPlan; style: Style; keyRoot: number; r: Rng; humanize: boolean };

const hv = (c: Ctx, v: number) => Math.max(0.05, Math.min(1, v + (c.humanize ? (c.r.next() - 0.5) * 0.12 : 0)));
const ht = (c: Ctx, t: number) => Math.max(0, t + (c.humanize ? (c.r.next() - 0.5) * 0.02 : 0));

function chordAt(c: Ctx, sec: SongSection, bar: number) {
  const tok = sec.chords[bar % Math.max(1, sec.chords.length)] ?? "I";
  return parseRoman(tok, c.keyRoot, c.plan.mode);
}

export function drumNotes(c: Ctx, sec: SongSection, nextName: string | null, isFirst: boolean): Note[] {
  const g = GROOVES[c.style.groove] as Record<string, string>;
  const notes: Note[] = [];
  const e = sec.energy;
  if (c.style.groove === "none" || (e <= 1 && sec.name !== "intro")) return notes;
  for (let bar = 0; bar < sec.bars; bar++) {
    const lastBar = bar === sec.bars - 1;
    const building = c.style.electronic && nextName === "drop" && sec.name !== "drop";
    for (const [pitchStr, pattern] of Object.entries(g)) {
      const pitch = Number(pitchStr);
      if (!pattern) continue;
      // Low energy: only the pulse (kick, hats); the backbeat arrives at energy 2.
      if (e <= 1 && pitch !== 42 && pitch !== 70) continue;
      if (e === 2 && sec.name === "intro" && (pitch === 38 || pitch === 39)) continue;
      if (building && bar >= sec.bars - 4 && (pitch === 38 || pitch === 39)) continue;
      for (let s = 0; s < 16; s++) {
        const ch = pattern[s];
        if (ch === "." || !ch) continue;
        // Trap hats: busier with energy; drop every other 16th at low energy.
        if (pitch === 42 && c.style.groove === "trap" && e < 4 && s % 2 === 1) continue;
        const vel = ch === "x" ? 0.85 : 0.45;
        notes.push(newNote({ pitch, start: ht(c, bar * 4 + s * 0.25), length: 0.25, velocity: hv(c, vel * (0.75 + e * 0.05)) }));
      }
    }
    // Trap hi-hat rolls at the end of every second bar.
    if (c.style.groove === "trap" && e >= 3 && bar % 2 === 1) {
      for (let k = 0; k < 6; k++) notes.push(newNote({ pitch: 42, start: bar * 4 + 3 + k / 6, length: 1 / 6, velocity: 0.5 + k * 0.06 }));
    }
    // Open hats on the off-beats when the energy is up.
    if (e >= 4 && !("46" in g && g[46]) && c.style.groove !== "jazz" && c.style.groove !== "cinematic") {
      for (let b = 0; b < 4; b++) notes.push(newNote({ pitch: 46, start: bar * 4 + b + 0.5, length: 0.5, velocity: hv(c, 0.4) }));
    }
    // EDM build: a snare roll that doubles in speed over the last bars before the drop.
    if (building && bar >= sec.bars - 4) {
      const k = bar - (sec.bars - 4);
      const step = k < 2 ? 0.5 : k < 3 ? 0.25 : 0.125;
      for (let t = 0; t < 4; t += step) notes.push(newNote({ pitch: 38, start: bar * 4 + t, length: step, velocity: 0.35 + 0.15 * k + (t / 4) * 0.15 }));
    }
    // A fill into the next big section.
    if (lastBar && !building && e >= 3 && (nextName === "chorus" || nextName === "drop") && c.style.groove !== "ambient") {
      for (const [t, p] of [[3, 48], [3.25, 48], [3.5, 45], [3.75, 45]] as const) notes.push(newNote({ pitch: c.style.groove === "trap" || c.style.electronic ? 38 : p, start: bar * 4 + t, length: 0.25, velocity: 0.75 }));
    }
  }
  if ((sec.name === "chorus" || sec.name === "drop" || (sec.name !== "intro" && isFirst)) && e >= 3 && c.style.groove !== "ambient") notes.push(newNote({ pitch: 49, start: 0, length: 1, velocity: 0.8 }));
  return notes;
}

function bassNotes(c: Ctx, sec: SongSection, drums: Note[]): Note[] {
  const out: Note[] = [];
  if (sec.energy <= 1) return out;
  const style = sec.energy <= 2 && c.style.bass !== "808" ? "whole" : c.style.bass;
  const kicks = drums.filter((n) => n.pitch === 36).map((n) => n.start);
  for (let bar = 0; bar < sec.bars; bar++) {
    const ch = chordAt(c, sec, bar);
    const next = chordAt(c, sec, bar + 1);
    let root = 28 + ((ch.root + 12 - 4) % 12); // E1..D#2
    if (root < 31) root += 12;
    const fifth = root + 7;
    const oct = root + 12;
    const add = (t: number, len: number, p: number, v = 0.85) => out.push(newNote({ pitch: p, start: ht(c, bar * 4 + t), length: len, velocity: hv(c, v) }));
    switch (style) {
      case "whole":
        add(0, 3.9, root, 0.8);
        break;
      case "root8":
        for (let k = 0; k < 8; k++) add(k * 0.5, 0.45, k === 7 && sec.energy >= 4 ? fifth : root, k % 2 ? 0.7 : 0.85);
        break;
      case "offbeat":
        for (let b = 0; b < 4; b++) add(b + 0.5, 0.4, b === 3 && bar % 2 ? oct : root, 0.85);
        break;
      case "808": {
        // The 808 follows the kick, each note ringing until the next one.
        const ks = kicks.filter((k) => k >= bar * 4 && k < bar * 4 + 4).map((k) => k - bar * 4);
        const hits = ks.length ? ks : [0];
        hits.forEach((t, i) => {
          const end = hits[i + 1] ?? 4;
          add(t, Math.max(0.25, end - t - 0.05), i === hits.length - 1 && hits.length > 2 && c.r.chance(0.3) ? fifth : root, 0.9);
        });
        break;
      }
      case "walking": {
        // Quarter notes: root, chord tones, then a chromatic step into the next chord.
        const target = 28 + ((next.root + 12 - 4) % 12);
        const tones = [root, root + (ch.tones[1] - ch.root), fifth];
        add(0, 0.9, tones[0], 0.85);
        add(1, 0.9, tones[1], 0.7);
        add(2, 0.9, tones[2], 0.75);
        add(3, 0.9, target + (target > tones[2] ? -1 : 1), 0.7);
        break;
      }
      case "funk":
        [
          [0, 0.4, root],
          [0.75, 0.2, oct],
          [1.5, 0.25, root],
          [2, 0.4, fifth],
          [2.75, 0.2, oct],
          [3.25, 0.2, root],
          [3.5, 0.4, fifth - 2],
        ].forEach(([t, l, p]) => add(t, l, p, 0.85));
        break;
      case "afro":
        [
          [0, 0.7, root],
          [0.75, 0.5, root],
          [1.5, 0.4, fifth],
          [2.5, 0.7, root],
          [3.25, 0.5, oct],
        ].forEach(([t, l, p]) => add(t, l, p, 0.85));
        break;
      default:
        // "groove": pop's syncopated root-fifth.
        [
          [0, 1.4, root],
          [1.5, 0.45, root],
          [2, 0.9, fifth],
          [3, 0.45, root],
          [3.5, 0.45, oct],
        ].forEach(([t, l, p]) => add(t, l, p, 0.85));
    }
  }
  return out;
}

const CHORD_CENTER: Record<string, number> = { guitar: 55, "synth-stab": 63, marimba: 66, harp: 62, pluck: 64, choir: 62, strings: 60, brass: 60 };

function chordNotes(c: Ctx, sec: SongSection, instrument: string, kind: Style["chords"], centerShift = 0): Note[] {
  const out: Note[] = [];
  const e = sec.energy;
  const rhythm = e <= 1 ? "block" : e === 2 && kind !== "arp" && kind !== "strum" ? "half" : kind;
  const center = (CHORD_CENTER[instrument] ?? 60) + centerShift;
  let prev: number[] | undefined;
  for (let bar = 0; bar < sec.bars; bar++) {
    const ch = chordAt(c, sec, bar);
    const v = voice(ch, center, prev);
    prev = v;
    const b0 = bar * 4;
    const vel = 0.55 + e * 0.06;
    const hit = (t: number, len: number, notes: number[], vv = vel, spread = 0) =>
      notes.forEach((p, i) => out.push(newNote({ pitch: p, start: ht(c, b0 + t + i * spread), length: Math.max(0.1, len - i * spread), velocity: hv(c, vv) })));
    switch (rhythm) {
      case "block":
        hit(0, 4, v, vel * 0.9);
        break;
      case "half":
        hit(0, 2, v);
        hit(2, 2, v, vel * 0.85);
        break;
      case "pop8":
        // Syncopated pop piano: 1, &2, &3 (with the bass note), and 4.
        hit(0, 1.4, [v[0] - 12, ...v]);
        hit(1.5, 1, v, vel * 0.8);
        hit(2.5, 1, v, vel * 0.85);
        hit(3.5, 0.5, v, vel * 0.75);
        break;
      case "stab":
        for (let b = 0; b < 4; b++) hit(b + 0.5, 0.35, v, vel * (b % 2 ? 0.8 : 0.95));
        break;
      case "strum":
        // Down, down-up, up-down-up: the classic campfire strum, low to high on downstrokes.
        for (const [t, down] of [[0, true], [1, true], [1.5, false], [2.5, false], [3, true], [3.5, false]] as const) {
          const notes = down ? [v[0] - 12, ...v] : [...v].reverse();
          hit(t, t === 0 ? 1 : 0.5, notes, vel * (down ? 0.9 : 0.65), 0.015);
        }
        break;
      case "arp": {
        const tones = [...v, v[0] + 12, v[1] + 12];
        const order = [0, 1, 2, 3, 4, 3, 2, 1];
        order.forEach((k, i) => hit(i * 0.5, 0.9, [tones[k]], vel * (i === 0 ? 0.95 : 0.7)));
        hit(0, 4, [v[0] - 12], vel * 0.8);
        break;
      }
      case "lofi":
        // Lazy, slightly late chords with a re-hit before the bar ends.
        hit(0.05, 2.4, v, vel * 0.8, 0.02);
        hit(2.55, 1.4, v, vel * 0.65, 0.02);
        break;
      case "comp":
        hit(0, 0.6, v, vel * 0.8);
        hit(1.5, 0.45, v, vel * 0.7);
        hit(2.75, 0.8, v, vel * 0.75);
        break;
      case "afro":
        [0, 0.75, 1.5, 2.5, 3.25].forEach((t, i) => hit(t, 0.4, i % 2 ? v.slice(1) : v, vel * (i === 0 ? 0.9 : 0.7)));
        break;
    }
  }
  return out;
}

function padNotes(c: Ctx, sec: SongSection): Note[] {
  if (sec.energy < 2 && sec.name !== "intro" && sec.name !== "outro") return [];
  const out: Note[] = [];
  let prev: number[] | undefined;
  for (let bar = 0; bar < sec.bars; bar += 2) {
    const ch = chordAt(c, sec, bar);
    const v = voice(ch, 66, prev);
    prev = v;
    const len = Math.min(2, sec.bars - bar) * 4;
    // Pads change chord with the bar, so hold each for one bar when the progression is per-bar.
    const sameNext = sec.chords[(bar + 1) % sec.chords.length] === sec.chords[bar % sec.chords.length];
    for (const p of v) out.push(newNote({ pitch: p, start: bar * 4, length: sameNext ? len : 4, velocity: 0.5 + sec.energy * 0.05 }));
    if (!sameNext && bar + 1 < sec.bars) {
      const v2 = voice(chordAt(c, sec, bar + 1), 66, v);
      for (const p of v2) out.push(newNote({ pitch: p, start: bar * 4 + 4, length: 4, velocity: 0.5 + sec.energy * 0.05 }));
    }
  }
  return out;
}

function arpNotes(c: Ctx, sec: SongSection): Note[] {
  if (sec.energy < 3) return [];
  const out: Note[] = [];
  for (let bar = 0; bar < sec.bars; bar++) {
    const v = voice(chordAt(c, sec, bar), 72);
    const tones = [v[0], v[1], v[2], v[0] + 12];
    for (let s = 0; s < 16; s++) out.push(newNote({ pitch: tones[[0, 1, 2, 3, 2, 1][s % 6]], start: bar * 4 + s * 0.25, length: 0.22, velocity: s % 4 === 0 ? 0.75 : 0.55 }));
  }
  return out;
}

/** Scale degrees near a centre pitch (for melodies). */
function scalePitches(c: Ctx, lo: number, hi: number) {
  const steps = c.plan.mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) if (steps.includes((((p - c.keyRoot) % 12) + 12) % 12)) out.push(p);
  return out;
}

function nearestIn(list: number[], p: number) {
  return list.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a), list[0]);
}

/**
 * Melody for a section. With lyrics: one note per syllable, each line fitted into two bars
 * leaving a breath at the end. Without: motif-based phrases. Strong beats land on chord tones.
 */
function melodyNotes(c: Ctx, sec: SongSection, center: number, cache: Map<string, Note[]>): { notes: Note[]; syllableMap: { line: number; notes: Note[] }[] } {
  const scale = scalePitches(c, center - 10, center + 12);
  const lift = sec.name === "chorus" || sec.name === "drop" ? 3 : sec.name === "bridge" ? 1 : 0;
  const out: Note[] = [];
  const syllableMap: { line: number; notes: Note[] }[] = [];
  const lines = sec.lyrics;
  const phrases = Math.ceil(sec.bars / 2);
  for (let ph = 0; ph < phrases; ph++) {
    const line = lines[ph];
    const t0 = ph * 8;
    const key = `${sec.name}:${line ?? `inst${ph % 4}`}`;
    const cached = cache.get(key);
    if (cached) {
      const copy = cached.map((n) => newNote({ ...n, start: n.start + t0 }));
      out.push(...copy);
      if (line) syllableMap.push({ line: ph, notes: copy });
      continue;
    }
    let count: number;
    // Two bars hold at most 26 sixteenth-note syllables; a longer line shares notes (see vocals.ts).
    if (line) count = Math.min(26, Math.max(1, lineWords(line).reduce((a, w) => a + syllables(w), 0)));
    else if (sec.name === "intro" || sec.name === "outro" || sec.energy <= 2) count = c.r.int(3, 5);
    else count = c.r.int(5, 9);
    // Rhythm: onsets on an 8th grid inside 6.5 beats; long last note.
    const slots = Math.max(count, Math.min(26, count > 13 ? 26 : 13));
    const grid = slots > 13 ? 0.25 : 0.5;
    const span = slots * grid;
    const pickup = line && c.r.chance(0.35) ? grid : 0;
    const onsets: number[] = [];
    for (let k = 0; k < count; k++) onsets.push(pickup + Math.round(((k * (span - pickup)) / count) / grid) * grid);
    // Musical rhythm: push some notes together to make long-short patterns.
    for (let k = 1; k < onsets.length - 1; k++) if (c.r.chance(0.3) && onsets[k] - onsets[k - 1] > grid) onsets[k] -= grid;
    // Rounding can land two syllables on one slot: keep every onset after the last.
    for (let k = 1; k < onsets.length; k++) if (onsets[k] <= onsets[k - 1]) onsets[k] = onsets[k - 1] + grid / 2;
    const notes: Note[] = [];
    let p = nearestIn(scale, center + lift + (c.r.next() - 0.5) * 4);
    const peakAt = Math.floor(count * (0.4 + c.r.next() * 0.3));
    onsets.forEach((t, k) => {
      const bar = Math.floor((t0 + t) / 4);
      const ch = chordAt(c, sec, bar);
      const strong = (t % 1) === 0;
      // Arch: drift up towards the peak, then come home.
      const dir = k < peakAt ? 1 : -1;
      const step = c.r.chance(0.7) ? 1 : 2;
      const idx = scale.indexOf(p);
      let cand = scale[Math.max(0, Math.min(scale.length - 1, idx + dir * step * (c.r.chance(0.2) ? 0 : 1)))];
      if (strong || k === count - 1) {
        // Land on the nearest chord tone.
        const tones = scale.filter((s) => ch.tones.some((t2) => ((t2 - s) % 12 + 12) % 12 === 0));
        if (tones.length) cand = nearestIn(tones, cand);
      }
      p = Math.max(center - 9, Math.min(center + 10, cand));
      const nextT = onsets[k + 1] ?? 7.5;
      const length = k === count - 1 ? Math.max(grid, 7.5 - t) : Math.max(grid * 0.9, nextT - t - 0.05);
      notes.push(newNote({ pitch: p, start: t, length, velocity: strong ? 0.85 : 0.7 }));
    });
    cache.set(key, notes);
    const placed = notes.map((n) => newNote({ ...n, start: n.start + t0 }));
    out.push(...placed);
    if (line) syllableMap.push({ line: ph, notes: placed });
  }
  return { notes: out, syllableMap };
}

export type Realized = {
  project: Project;
  /** For the singer: each vocal line's notes in song beats. */
  vocalLines: { section: number; text: string; notes: Note[]; start: number }[];
  melodyTrack: string;
  /** Section starts (beats) where a riser/impact suits (the AI pipeline adds sound effects there). */
  hits: { beat: number; kind: "riser" | "impact" }[];
};

const MELODY_CENTER: Record<string, number> = { bell: 79, flute: 76, "saw-lead": 74, "square-lead": 74, brass: 70, sitar: 69, guitar: 67, piano: 72, epiano: 72, marimba: 76, pluck: 74, lead: 74, kalimba: 76 };

/**
 * Turns a plan into a project. `singerCenter` is the MIDI note the vocal melody sits around
 * (lower for male voices); the lead instrument doubles the tune in instrumental sections.
 */
export function realize(plan: SongPlan, seed: number, opts: { singerCenter?: number; name?: string } = {}): Realized {
  const style = styleOf(plan.genre);
  const c: Ctx = { plan, style, keyRoot: keyIndex(plan.key), r: rng(seed), humanize: !style.electronic };
  let p = emptyProject(opts.name ?? plan.title);
  p = { ...p, bpm: plan.bpm, keyRoot: c.keyRoot, scale: plan.mode, sig: 4, lyrics: plan.sections.filter((s) => s.lyrics.length).map((s) => `[${s.name}]\n${s.lyrics.join("\n")}`).join("\n\n") };
  const inst = plan.instruments;
  const sungMelody = plan.vocal !== "none";

  const mk = (kind: Track["kind"], o: Partial<Track>) => {
    const t = makeTrack(p, kind, o);
    p = addTrack(p, t);
    return t;
  };
  const drums = style.groove !== "none" ? mk("drums", { name: "Drums", instrument: inst.drums, volume: 0.7, fx: [makeEffect("compressor", { threshold: -14, ratio: 3, attack: 0.005, makeup: 2 })] }) : null;
  const bass = mk("instrument", { name: "Bass", instrument: inst.bass, volume: 0.9, fx: [makeEffect("eq", { lowCut: 28, low: 1, mid: -1, midFreq: 400, high: -3 })] });
  const chords = mk("instrument", { name: "Chords", instrument: inst.chords, volume: 0.55, pan: -0.15, fx: [makeEffect("reverb", { mix: 0.18, size: 2 })] });
  const pad = inst.pad ? mk("instrument", { name: "Pad", instrument: inst.pad, volume: 0.36, pan: 0.1, fx: [makeEffect("reverb", { mix: 0.35, size: 3.5 }), makeEffect("width", { width: 1.5 })] }) : null;
  const arp = style.arp ? mk("instrument", { name: "Arp", instrument: "arp-synth", volume: 0.38, pan: 0.25, fx: [makeEffect("delay", { beats: 0.75, feedback: 0.35, mix: 0.25, pingpong: 1 })] }) : null;
  const melody = mk("instrument", {
    name: sungMelody ? "Vocal melody" : "Lead",
    instrument: inst.lead,
    volume: sungMelody ? 0.55 : 0.85,
    pan: 0.12,
    fx: [makeEffect("delay", { beats: 0.75, feedback: 0.25, mix: 0.16 }), makeEffect("reverb", { mix: 0.2, size: 2.2 })],
  });

  const clips: Clip[] = [];
  const vocalLines: Realized["vocalLines"] = [];
  const hits: Realized["hits"] = [];
  const cache = new Map<string, Note[]>();
  const leadCenter = MELODY_CENTER[inst.lead] ?? 72;
  let at = 0;
  plan.sections.forEach((sec, i) => {
    const len = sec.bars * 4;
    const next = plan.sections[i + 1]?.name ?? null;
    const label = cap(sec.name === "prechorus" ? "pre-chorus" : sec.name);
    p = { ...p, markers: [...p.markers, { id: `m${i}`, beat: at, name: label }] };
    const add = (track: Track | null, notes: Note[], extra: Partial<Clip> = {}) => {
      if (!track || !notes.length) return;
      clips.push(makeClip(track.id, { name: label, start: at, length: len, notes, ...extra }));
    };
    const drumN = drums ? drumNotes(c, sec, next, i === 0) : [];
    add(drums, drumN, { swing: style.swing });
    add(bass, bassNotes(c, sec, drumN));
    add(chords, chordNotes(c, sec, inst.chords, style.chords));
    if (pad) add(pad, padNotes(c, sec));
    if (arp) add(arp, arpNotes(c, sec));
    const singing = sungMelody && sec.lyrics.length > 0;
    const center = singing ? (opts.singerCenter ?? 64) : leadCenter;
    if (singing || sec.energy >= 3 || sec.name === "intro" || sec.name === "outro") {
      const { notes, syllableMap } = melodyNotes(c, singing ? sec : { ...sec, lyrics: [] }, center, cache);
      // The guide melody sits an octave up when it's only a reference for the singer.
      add(melody, notes);
      for (const s of syllableMap) vocalLines.push({ section: i, text: sec.lyrics[s.line], notes: s.notes.map((n) => ({ ...n, start: n.start + at })), start: at + s.line * 8 });
    }
    if ((sec.name === "chorus" || sec.name === "drop") && i > 0 && sec.energy > plan.sections[i - 1].energy) {
      hits.push({ beat: at - 8, kind: "riser" });
      hits.push({ beat: at, kind: "impact" });
    }
    at += len;
  });
  p = putClips(p, clips);
  const master = MASTER_PRESETS[0];
  p = { ...p, master: { volume: 0.9, fx: master.chain.map((f) => makeEffect(f.type, f.params)) } };
  p = { ...p, loop: { on: false, start: 0, end: Math.min(at, 32) } };
  return { project: p, vocalLines, melodyTrack: melody.id, hits };
}

/** A vocal chain for the singer track (pop-star preset). */
export const vocalFx = () => FX_PRESETS.find((f) => f.id === "pop-vocal")!.chain.map((f) => makeEffect(f.type, f.params));

// ---------------------------------------------------------------------------------------------
// Loops for the library

export type LoopKind = "drums" | "bass" | "chords" | "melody" | "arp";

export function makeLoop(kind: LoopKind, genre: string, keyRoot: number, mode: "major" | "minor", seed: number): { notes: Note[]; bars: number; instrument: string; trackKind: Track["kind"] } {
  const style = styleOf(genre);
  const plan: SongPlan = { title: "", genre, mood: "", bpm: 120, key: KEYS[keyRoot], mode, vocal: "none", instruments: style.instruments, sections: [] };
  const c: Ctx = { plan, style, keyRoot, r: rng(seed), humanize: !style.electronic };
  const pool = genre === "jazz" ? PROGRESSIONS.jazz : PROGRESSIONS[mode];
  const sec: SongSection = { name: "chorus", bars: 4, chords: c.r.pick(pool), energy: 4, lyrics: [] };
  if (kind === "drums") return { notes: drumNotes(c, { ...sec, bars: 2, energy: 3 }, null, false).filter((n) => n.pitch !== 49), bars: 2, instrument: style.instruments.drums, trackKind: "drums" };
  if (kind === "bass") return { notes: bassNotes(c, sec, drumNotes(c, sec, null, false)), bars: 4, instrument: style.instruments.bass, trackKind: "instrument" };
  if (kind === "chords") return { notes: chordNotes(c, sec, style.instruments.chords, style.chords), bars: 4, instrument: style.instruments.chords, trackKind: "instrument" };
  if (kind === "arp") return { notes: arpNotes(c, sec), bars: 4, instrument: "arp-synth", trackKind: "instrument" };
  return { notes: melodyNotes(c, sec, MELODY_CENTER[style.instruments.lead] ?? 72, new Map()).notes, bars: 4, instrument: style.instruments.lead, trackKind: "instrument" };
}
