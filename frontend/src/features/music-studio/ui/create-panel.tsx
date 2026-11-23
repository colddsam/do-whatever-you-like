"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Shuffle, Sparkles, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { addMusicGen } from "../actions";
import { GENRES, LANGUAGES, MOODS, SINGER_VOICES } from "../constants";
import { capabilities, generateSong, writeLyrics, type Capabilities } from "../engine/ai";
import { localPlan, realize } from "../engine/composer";
import { analyzeImage, type ImageMood } from "../engine/imagemood";
import { openProject, saveProject } from "../engine/persistence";
import { transport } from "../engine/transport";
import { addTrack, makeClip, putClips } from "../lib/project";
import { getStudio, runJob, useStudio } from "../store";
import type { Project } from "../types";
import { Chips, Field, inputCls, JobLine, Note, Segmented, Select, Slider, TextButton, Toggle } from "./controls";

type Mode = "song" | "instrumental" | "image" | "audio";

const MODES: { value: Mode; label: string }[] = [
  { value: "song", label: "Song" },
  { value: "instrumental", label: "Backing" },
  { value: "image", label: "Image" },
  { value: "audio", label: "AI audio" },
];

const IDEAS = [
  "An upbeat summer pop song about a road trip with best friends",
  "A heartbreak R&B ballad about reading old messages at 2 a.m.",
  "A hype trap anthem about grinding until the dream comes true",
  "A dreamy lo-fi song about rainy evenings and warm coffee",
  "A Bollywood dance number for a wedding sangeet",
  "An epic cinematic theme for a hero's final battle",
  "A cheerful folk song about leaving the city for the mountains",
  "A synthwave night drive through neon streets",
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Replace the open project with a new one (the old one stays saved), then play it. */
async function openAndPlay(p: Project, play: boolean) {
  await transport.stop(true);
  await saveProject(p);
  await openProject(p);
  getStudio().set({ playhead: 0, bottomTab: "editor" });
  if (play) await transport.play(0);
}

export function CreatePanel() {
  const [mode, setMode] = useState<Mode>("song");
  // Lyrics sent from the lyric sheet always open the song maker.
  const draft = useStudio((s) => s.draftLyrics);
  if (draft && mode !== "song") setMode("song");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let alive = true;
    void capabilities().then((c) => alive && setCaps(c));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="space-y-3 p-3">
      <Segmented label="What to make" value={mode} onChange={setMode} options={MODES} />
      {mode === "song" && <SongForm caps={caps} />}
      {mode === "instrumental" && <BackingForm />}
      {mode === "image" && <ImageForm />}
      {mode === "audio" && <AudioForm />}
    </div>
  );
}

function SongForm({ caps }: { caps: Capabilities | null }) {
  const draft = useStudio((s) => s.draftLyrics);
  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(120);
  const [vocals, setVocals] = useState(true);
  const [style, setStyle] = useState<"sung" | "rap">("sung");
  const [language, setLanguage] = useState("English");
  const [voice, setVoice] = useState(SINGER_VOICES[0].id);
  const [harmony, setHarmony] = useState(true);
  const [lyrics, setLyrics] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [play, setPlay] = useState(true);
  const busy = useStudio((s) => Boolean(s.jobs.song || s.jobs.lyrics));
  const [made, setMade] = useState(false);

  // Lyrics sent over from the lyric sheet (adjusting state while rendering, React's pattern).
  const [seenDraft, setSeenDraft] = useState<string | null>(null);
  if (draft && draft !== seenDraft) {
    setSeenDraft(draft);
    setLyrics(draft);
    setVocals(true);
  }
  // Consumed: clear it so the panel's other modes work again.
  useEffect(() => {
    if (draft) getStudio().set({ draftLyrics: null });
  }, [draft]);

  const voices = SINGER_VOICES.filter((v) => v.lang === language);
  const voiceId = voices.some((v) => v.id === voice) ? voice : (voices[0]?.id ?? SINGER_VOICES[0].id);

  const aiReady = Boolean(caps?.ai);

  const make = async (seed = Math.floor(Math.random() * 1e9)) => {
    // Start the sound engine inside the tap, so the song can play as soon as it's ready.
    await transport.ensure().catch(() => undefined);
    await runJob("song", "Starting", async (progress) => {
      const res = await generateSong(
        { prompt, genre, mood: mood?.toLowerCase() ?? null, seconds, vocals, vocalStyle: style, voice: voiceId, language, lyrics, harmony, seed, useAi: useAi && aiReady },
        (f, label) => progress(f, label),
      );
      await openAndPlay(res.project, play);
      setMade(true);
      const how = res.engine === "built-in" ? "the built-in composer" : `AI (${res.engine})`;
      getStudio().notify(`“${res.plan.title}” · ${res.plan.bpm} BPM · ${res.plan.key} ${res.plan.mode}, written by ${how}.`, "success");
      for (const w of res.warnings) getStudio().notify(w, "warning");
    });
  };

  const aiLyrics = async () => {
    if (!aiReady) return getStudio().notify("AI lyrics need the site's AI service; it isn't set up here. Paste your own lyrics, or use the built-in ones.", "info");
    await runJob("lyrics", "Writing lyrics", async () => {
      setLyrics(await writeLyrics(prompt || "a feeling worth singing about", genre, mood, language));
    });
  };

  return (
    <div className="space-y-3">
      <Field label="Describe your song">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 600))} rows={3} placeholder="A dreamy lo-fi song about rainy evenings…" className={cn(inputCls, "resize-none")} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      <button type="button" onClick={() => setPrompt(IDEAS[Math.floor(Math.random() * IDEAS.length)])} className="inline-flex items-center gap-1.5 text-[12px] text-paper-dim hover:text-paper">
        <Shuffle aria-hidden className="size-3.5" />
        Give me an idea
      </button>
      <Field label="Genre (or let the AI choose)">
        <Chips label="Genre" value={genre} allowNone onChange={setGenre} options={GENRES.map((g) => ({ value: g.id, label: g.label }))} />
      </Field>
      <Field label="Mood">
        <Chips label="Mood" value={mood} allowNone onChange={setMood} options={MOODS.map((m) => ({ value: m, label: m }))} />
      </Field>
      <Field label={`Length · ${fmt(seconds)}`}>
        <Slider label="Song length" value={seconds} min={15} max={300} step={5} onChange={setSeconds} />
      </Field>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-paper">Vocals</span>
        <Toggle label="Vocals" checked={vocals} onChange={setVocals} />
      </div>
      {vocals && (
        <div className="space-y-3 rounded-sm border border-line-dark p-2.5">
          <Segmented
            label="Vocal style"
            value={style}
            onChange={setStyle}
            options={[
              { value: "sung", label: "Sung (auto-tuned)" },
              { value: "rap", label: "Rap" },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Language">
              <Select label="Lyrics language" value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l, label: l }))} className="w-full" />
            </Field>
            <Field label="Singer">
              <Select label="Singer voice" value={voiceId} onChange={setVoice} options={voices.map((v) => ({ value: v.id, label: v.label }))} className="w-full" />
            </Field>
          </div>
          {style === "sung" && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-paper-dim">Harmony on the choruses</span>
              <Toggle label="Harmony" checked={harmony} onChange={setHarmony} />
            </div>
          )}
          <Field label="Your lyrics (optional)" hint="Mark parts with [Verse], [Chorus], [Bridge]. Leave empty and the AI writes them.">
            <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value.slice(0, 4000))} rows={4} placeholder={"[Verse]\nFirst line…\n\n[Chorus]\nHook line…"} className={cn(inputCls, "resize-y font-mono text-[12px]")} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <TextButton onClick={() => void aiLyrics()} disabled={busy} className="w-full">
            <Sparkles aria-hidden className="size-3.5" />
            Write lyrics with AI
          </TextButton>
          <JobLine id="lyrics" />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-paper-dim">{caps === null ? "Checking the AI…" : aiReady ? `AI composer: ${caps.ai === "groq" ? "Groq" : "Gemini"} (free)` : "No AI key on this server: built-in composer"}</span>
        <Toggle label="Use AI" checked={useAi && aiReady} onChange={(v) => setUseAi(v)} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-paper-dim">Play when ready</span>
        <Toggle label="Play when ready" checked={play} onChange={setPlay} />
      </div>
      <TextButton tone="primary" className="h-10 w-full sm:h-9" disabled={busy} onClick={() => void make()}>
        <Sparkles aria-hidden className="size-4" />
        Make the song
      </TextButton>
      {made && !busy && (
        <TextButton className="w-full" onClick={() => void make()}>
          <Shuffle aria-hidden className="size-3.5" />
          Make another version
        </TextButton>
      )}
      <JobLine id="song" />
      <Note>
        The song opens as a normal project: every drum, chord and note is editable, and the vocal is a track you can re-record, tune or replace. Singing uses free neural voices that are pitch-corrected to the melody, so it has a stylised, auto-tuned sound.
      </Note>
    </div>
  );
}

function BackingForm() {
  const [genre, setGenre] = useState("lofi");
  const [mood, setMood] = useState<string | null>("Chill");
  const [seconds, setSeconds] = useState(60);
  const [energy, setEnergy] = useState(3);
  const [into, setInto] = useState<"new" | "add">("new");
  const busy = useStudio((s) => Boolean(s.jobs.backing));
  const video = useRef<HTMLInputElement>(null);

  const make = async () => {
    await transport.ensure().catch(() => undefined);
    await runJob("backing", "Composing", async () => {
      const seed = Math.floor(Math.random() * 1e9);
      const plan = localPlan({ genre, mood: mood?.toLowerCase(), seconds, seed, energy });
      const real = realize(plan, seed);
      if (into === "new") {
        await openAndPlay({ ...real.project, name: `${plan.title} (${fmt(seconds)})` }, true);
      } else {
        // Add the parts under the current song, starting at the playhead's bar.
        const st = getStudio();
        const at = Math.floor(st.playhead / st.project.sig) * st.project.sig;
        st.commit((p) => {
          let q = p;
          for (const t of real.project.tracks) {
            const nt = { ...t, name: `${t.name} (${plan.genre})` };
            q = addTrack(q, nt);
            q = putClips(
              q,
              Object.values(real.project.clips)
                .filter((c) => c.trackId === t.id)
                .map((c) => makeClip(nt.id, { ...c, start: c.start + at })),
            );
          }
          return q;
        });
        st.notify(`Added ${real.project.tracks.length} tracks at bar ${at / st.project.sig + 1}. The song's tempo stays at ${st.project.bpm} BPM.`, "success");
      }
    });
  };

  const matchVideo = (f: File) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setSeconds(Math.max(10, Math.min(600, Math.round(v.duration))));
        getStudio().notify(`Length set to the video's ${fmt(v.duration)}.`, "success");
      }
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => getStudio().notify("That video's length couldn't be read.", "warning");
    v.src = URL.createObjectURL(f);
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-paper-dim">Royalty-free background music for videos, podcasts and streams, made on your device in a second. Every track is yours to use anywhere.</p>
      <Field label="Style">
        <Select label="Style" value={genre} onChange={setGenre} options={GENRES.map((g) => ({ value: g.id, label: g.label }))} className="w-full" />
      </Field>
      <Field label="Mood">
        <Chips label="Mood" value={mood} allowNone onChange={setMood} options={MOODS.map((m) => ({ value: m, label: m }))} />
      </Field>
      <Field label={`Exact length · ${fmt(seconds)}`}>
        <Slider label="Length" value={seconds} min={10} max={600} step={1} onChange={setSeconds} />
      </Field>
      <button type="button" onClick={() => video.current?.click()} className="inline-flex items-center gap-1.5 text-[12px] text-paper-dim hover:text-paper">
        <Video aria-hidden className="size-3.5" />
        Match the length of a video
      </button>
      <input ref={video} type="file" accept="video/*,audio/*" hidden onChange={(e) => (e.target.files?.[0] && matchVideo(e.target.files[0]), (e.target.value = ""))} />
      <Field label={`Energy · ${["", "Very calm", "Calm", "Medium", "Lively", "Intense"][energy]}`}>
        <Slider label="Energy" value={energy} min={1} max={5} step={1} onChange={setEnergy} />
      </Field>
      <Segmented
        label="Where"
        value={into}
        onChange={setInto}
        options={[
          { value: "new", label: "New project" },
          { value: "add", label: "Add to this song" },
        ]}
      />
      <TextButton tone="primary" className="h-10 w-full sm:h-9" disabled={busy} onClick={() => void make()}>
        <Sparkles aria-hidden className="size-4" />
        Compose backing track
      </TextButton>
      <JobLine id="backing" />
    </div>
  );
}

function ImageForm() {
  const [mood, setMood] = useState<ImageMood | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(60);
  const busy = useStudio((s) => Boolean(s.jobs.image));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = async (f: File) => {
    if (!f.type.startsWith("image/")) return getStudio().notify("Choose a picture (JPG, PNG, WebP…).", "warning");
    setPreview(URL.createObjectURL(f));
    try {
      setMood(await analyzeImage(f));
    } catch {
      getStudio().notify("That picture couldn't be read.", "warning");
    }
  };

  const make = async () => {
    if (!mood) return;
    await transport.ensure().catch(() => undefined);
    await runJob("image", "Composing from the picture", async () => {
      const plan = localPlan({ genre: mood.genre, mood: mood.mood.toLowerCase(), seconds, seed: mood.seed, bpm: mood.bpm, key: mood.key, mode: mood.mode, energy: mood.energy, title: `${mood.mood} picture` });
      await openAndPlay(realize(plan, mood.seed).project, true);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-paper-dim">Turn a photo or artwork into music. Colour, brightness and contrast set the genre, mood, tempo and key. The picture never leaves your device.</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void pick(f);
        }}
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-line-dark text-[13px] text-paper-dim hover:border-paper-dim hover:text-paper"
      >
        {preview ? (
          // A local object URL preview: next/image can't optimise blob: URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Your picture" className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className="inline-flex items-center gap-2">
            <ImagePlus aria-hidden className="size-4" />
            Choose or drop a picture
          </span>
        )}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && void pick(e.target.files[0]), (e.target.value = ""))} />
      {mood && (
        <div className="space-y-2 rounded-sm border border-line-dark p-2.5">
          <p className="text-[12px] text-paper-dim">{mood.reading}</p>
          <div className="flex gap-1">
            {mood.palette.map((c) => (
              <span key={c} className="h-5 flex-1 rounded-[3px]" style={{ background: c }} />
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            {[
              ["Genre", GENRES.find((g) => g.id === mood.genre)?.label],
              ["Mood", mood.mood],
              ["Tempo", `${mood.bpm} BPM`],
              ["Key", `${mood.key} ${mood.mode}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-paper-dim">{k}</dt>
                <dd className="text-paper">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <Field label={`Length · ${fmt(seconds)}`}>
        <Slider label="Length" value={seconds} min={15} max={300} step={5} onChange={setSeconds} />
      </Field>
      <TextButton tone="primary" className="h-10 w-full sm:h-9" disabled={!mood || busy} onClick={() => void make()}>
        <Sparkles aria-hidden className="size-4" />
        Make music from the picture
      </TextButton>
      <JobLine id="image" />
    </div>
  );
}

const AUDIO_IDEAS = ["lo-fi hip hop beat with vinyl crackle and soft piano", "epic orchestral trailer hit with taiko drums", "80s synthwave with driving bass", "acoustic guitar folk melody, warm and gentle", "deep house groove with a funky bassline", "ambient pad with shimmering bells", "upbeat ukulele jingle for a commercial"];

function AudioForm() {
  const [prompt, setPrompt] = useState(AUDIO_IDEAS[0]);
  const [seconds, setSeconds] = useState(8);
  const busy = useStudio((s) => Boolean(s.jobs.musicgen));
  const lowMemory = typeof navigator !== "undefined" && "deviceMemory" in navigator && (navigator as Navigator & { deviceMemory?: number }).deviceMemory! < 4;

  const make = async () => {
    await transport.ensure().catch(() => undefined);
    await runJob("musicgen", "Loading the music model", async (progress) => {
      const buf = await addMusicGen(prompt, seconds, (f, label) => progress(f, label));
      getStudio().notify(`Made ${buf.duration.toFixed(1)} s of audio. It's on the “AI audio” track at the playhead.`, "success");
      await transport.previewBuffer(buf);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-paper-dim">Text to music with Meta&apos;s MusicGen, running entirely on this device. Great for loops, textures, intros and stingers you can drop into any song.</p>
      <Field label="Describe the sound">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 300))} rows={3} className={cn(inputCls, "resize-none")} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      <div className="flex flex-wrap gap-1">
        {AUDIO_IDEAS.slice(1).map((i) => (
          <button key={i} type="button" onClick={() => setPrompt(i)} className="rounded-sm border border-line-dark px-2 py-1 text-left text-[12px] text-paper-dim hover:text-paper">
            {i}
          </button>
        ))}
      </div>
      <Field label={`Length · ${seconds} s`}>
        <Slider label="Length" value={seconds} min={4} max={30} step={1} onChange={setSeconds} />
      </Field>
      <TextButton tone="primary" className="h-10 w-full sm:h-9" disabled={busy || !prompt.trim()} onClick={() => void make()}>
        <Sparkles aria-hidden className="size-4" />
        Generate on this device
      </TextButton>
      <JobLine id="musicgen" />
      <Note tone={lowMemory ? "warn" : "plain"}>
        The first run downloads the model once (about 450 MB), then it&apos;s cached. It runs on your processor, so it&apos;s slow: expect a few minutes for a 10-second clip on a laptop. Keep this tab open while it works. {lowMemory ? "This device reports little memory: a computer will do better." : "Short clips (4–10 s) are the sweet spot."}
      </Note>
    </div>
  );
}
