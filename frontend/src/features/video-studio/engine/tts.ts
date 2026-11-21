import { BASE_TEXT_STYLE, CAPTION_STYLES } from "../constants";
import { frameRound, rt } from "../lib/time";
import * as TL from "../lib/timeline";
import { useStudio } from "../store/studio-store";
import type { CaptionStyleId, Clip, WordTiming } from "../types";
import { addGeneratedFile } from "./clip-tools";

/**
 * Text to speech (CapCut's "Text to speech", Clipchamp's AI voice-overs): the text goes to the
 * site's backend, which asks Microsoft Edge's free online voices for an MP3 plus each word's timing.
 * The MP3 becomes a sound clip at the playhead; the timings can become karaoke-ready captions.
 */

export type Voice = { id: string; label: string; lang: string };

export const VOICES: Voice[] = [
  { id: "en-US-AriaNeural", label: "Aria · US English, female", lang: "English" },
  { id: "en-US-GuyNeural", label: "Guy · US English, male", lang: "English" },
  { id: "en-US-JennyNeural", label: "Jenny · US English, female", lang: "English" },
  { id: "en-US-ChristopherNeural", label: "Christopher · US English, male", lang: "English" },
  { id: "en-US-EmmaMultilingualNeural", label: "Emma · multilingual, female", lang: "English" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew · multilingual, male", lang: "English" },
  { id: "en-GB-SoniaNeural", label: "Sonia · British, female", lang: "English" },
  { id: "en-GB-RyanNeural", label: "Ryan · British, male", lang: "English" },
  { id: "en-AU-NatashaNeural", label: "Natasha · Australian, female", lang: "English" },
  { id: "en-IN-NeerjaNeural", label: "Neerja · Indian English, female", lang: "English" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat · Indian English, male", lang: "English" },
  { id: "hi-IN-SwaraNeural", label: "Swara · Hindi, female", lang: "Hindi" },
  { id: "hi-IN-MadhurNeural", label: "Madhur · Hindi, male", lang: "Hindi" },
  { id: "bn-IN-TanishaaNeural", label: "Tanishaa · Bengali, female", lang: "Bengali" },
  { id: "bn-IN-BashkarNeural", label: "Bashkar · Bengali, male", lang: "Bengali" },
  { id: "ta-IN-PallaviNeural", label: "Pallavi · Tamil, female", lang: "Tamil" },
  { id: "te-IN-ShrutiNeural", label: "Shruti · Telugu, female", lang: "Telugu" },
  { id: "mr-IN-AarohiNeural", label: "Aarohi · Marathi, female", lang: "Marathi" },
  { id: "es-ES-ElviraNeural", label: "Elvira · Spanish, female", lang: "Spanish" },
  { id: "es-MX-JorgeNeural", label: "Jorge · Mexican Spanish, male", lang: "Spanish" },
  { id: "fr-FR-DeniseNeural", label: "Denise · French, female", lang: "French" },
  { id: "fr-FR-HenriNeural", label: "Henri · French, male", lang: "French" },
  { id: "de-DE-KatjaNeural", label: "Katja · German, female", lang: "German" },
  { id: "de-DE-ConradNeural", label: "Conrad · German, male", lang: "German" },
  { id: "pt-BR-FranciscaNeural", label: "Francisca · Brazilian, female", lang: "Portuguese" },
  { id: "it-IT-ElsaNeural", label: "Elsa · Italian, female", lang: "Italian" },
  { id: "ar-SA-ZariyahNeural", label: "Zariyah · Arabic, female", lang: "Arabic" },
  { id: "ja-JP-NanamiNeural", label: "Nanami · Japanese, female", lang: "Japanese" },
  { id: "ko-KR-SunHiNeural", label: "SunHi · Korean, female", lang: "Korean" },
  { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao · Chinese, female", lang: "Chinese" },
];

export async function speak(text: string, voice: string, rate = 0, pitch = 0): Promise<{ file: File; words: WordTiming[] }> {
  const res = await fetch("/api/tools/studio/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, rate, pitch }),
    signal: AbortSignal.timeout(70_000),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
    throw new Error(j?.detail || j?.error || "The voice service didn't answer. Try again in a moment.");
  }
  const j = (await res.json()) as { audio: string; mime: string; words: WordTiming[] };
  const bin = Uint8Array.from(atob(j.audio), (ch) => ch.charCodeAt(0));
  const name = `${text.trim().slice(0, 32).replace(/[\\/:*?"<>|]+/g, " ")}… (voice-over).mp3`;
  return { file: new File([bin], name, { type: j.mime || "audio/mpeg" }), words: j.words ?? [] };
}

/** Speaks `text`, places it at the playhead on a sound track, and optionally captions it from the word timings. */
export async function addVoiceover(text: string, voice: string, opts: { rate?: number; pitch?: number; captions?: CaptionStyleId | null } = {}) {
  const { file, words } = await speak(text, voice, opts.rate ?? 0, opts.pitch ?? 0);
  const asset = await addGeneratedFile(file);
  const st = useStudio.getState();
  const at = frameRound(st.playhead, st.project.settings.fps);
  st.placeMedia(asset.id, at);
  if (!opts.captions || !words.length) return;
  // Lines of up to 5 words (or a pause), each with its words' timing for karaoke styles.
  const lines: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (cur.length >= 5 || w.start - last.end > 0.6 || /[.!?…,]$/.test(last.text))) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  const style = { ...BASE_TEXT_STYLE, ...CAPTION_STYLES[opts.captions].style };
  useStudio.getState().commit((p) => {
    let next = p;
    let trackId = next.tracks.find((t) => t.kind === "overlay" && t.name === "Captions")?.id;
    if (!trackId) {
      [next, trackId] = TL.addTrack(next, "overlay");
      next = TL.updateTrack(next, trackId, { name: "Captions" });
    }
    const y = next.settings.height > next.settings.width ? 0.7 : 0.82;
    const clips: Clip[] = lines.map((line, i) => {
      const start = rt(at + line[0].start);
      const nextStart = lines[i + 1] ? at + lines[i + 1][0].start : Infinity;
      const end = Math.min(nextStart, at + line[line.length - 1].end + 0.15);
      return TL.newClip(next, {
        trackId: trackId!,
        kind: "text",
        name: line.map((w) => w.text).join(" ").slice(0, 40),
        start,
        duration: rt(Math.max(0.2, end - start)),
        transform: TL.baseTransform(next, y),
        text: { text: line.map((w) => w.text).join(" "), style, words: line.map((w) => ({ text: w.text, start: rt(at + w.start - start), end: rt(at + w.end - start) })) },
      });
    });
    return TL.placeClips(next, clips);
  });
}
