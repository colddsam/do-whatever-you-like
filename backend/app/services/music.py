"""
The music studio's AI composer (/tools/music-studio). A free LLM (Groq, else Gemini) plans a song:
title, tempo, key, sections with Roman-numeral chords, energy, and lyrics. The browser then writes
every note, synthesises every instrument and sings the lyrics, so nothing here handles audio.

Every field the model returns is checked against fixed lists and ranges before it leaves: an odd
answer degrades to sensible defaults rather than breaking the studio.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.config.music import settings
from app.exceptions.music import InvalidMusicInputError, MusicProcessingError, MusicUnavailableError

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Shared with the browser (src/features/music-studio/constants.ts): keep the ids in step.
GENRES = [
    "pop", "hiphop", "trap", "lofi", "house", "edm", "rock", "cinematic", "ambient", "rnb",
    "jazz", "reggaeton", "synthwave", "funk", "piano", "afrobeats", "folk", "bollywood",
]
SECTIONS = {"intro", "verse", "prechorus", "chorus", "bridge", "drop", "breakdown", "outro"}
KITS = {"kit-808", "kit-acoustic", "kit-lofi", "kit-house", "kit-trap", "kit-rock", "kit-electro"}
BASSES = {"sub-bass", "synth-bass", "finger-bass", "acid-bass", "808-bass"}
CHORD_INST = {"piano", "epiano", "organ", "strings", "pad", "pluck", "guitar", "synth-stab", "harp", "marimba", "choir", "brass"}
LEAD_INST = {"lead", "saw-lead", "square-lead", "flute", "bell", "pluck", "piano", "guitar", "marimba", "sitar", "brass", "arp-synth", "epiano"}
PAD_INST = {"pad", "strings", "choir", "organ"}
KEYS = {"C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"}
VOCALS = {"sung", "rap", "none"}
# I, bVII, iv7, V/sus4, ii°, IVmaj7, vi9… (the browser's parser accepts the same shapes).
CHORD_RE = re.compile(r"^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|dim|\+|aug)?(maj7|m7|7|sus2|sus4|add9|9)?$")

GENRE_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "pop": {"bpm": 112, "drums": "kit-808", "bass": "synth-bass", "chords": "piano", "lead": "pluck", "pad": "pad"},
    "hiphop": {"bpm": 90, "drums": "kit-808", "bass": "808-bass", "chords": "epiano", "lead": "bell", "pad": None},
    "trap": {"bpm": 140, "drums": "kit-trap", "bass": "808-bass", "chords": "pad", "lead": "bell", "pad": "choir"},
    "lofi": {"bpm": 78, "drums": "kit-lofi", "bass": "finger-bass", "chords": "epiano", "lead": "flute", "pad": None},
    "house": {"bpm": 124, "drums": "kit-house", "bass": "synth-bass", "chords": "synth-stab", "lead": "pluck", "pad": "pad"},
    "edm": {"bpm": 128, "drums": "kit-electro", "bass": "synth-bass", "chords": "synth-stab", "lead": "saw-lead", "pad": "pad"},
    "rock": {"bpm": 120, "drums": "kit-rock", "bass": "finger-bass", "chords": "guitar", "lead": "guitar", "pad": "organ"},
    "cinematic": {"bpm": 84, "drums": "kit-acoustic", "bass": "sub-bass", "chords": "strings", "lead": "brass", "pad": "choir"},
    "ambient": {"bpm": 70, "drums": "kit-lofi", "bass": "sub-bass", "chords": "pad", "lead": "bell", "pad": "strings"},
    "rnb": {"bpm": 96, "drums": "kit-808", "bass": "sub-bass", "chords": "epiano", "lead": "epiano", "pad": "pad"},
    "jazz": {"bpm": 104, "drums": "kit-acoustic", "bass": "finger-bass", "chords": "piano", "lead": "brass", "pad": None},
    "reggaeton": {"bpm": 94, "drums": "kit-808", "bass": "808-bass", "chords": "pluck", "lead": "square-lead", "pad": "pad"},
    "synthwave": {"bpm": 100, "drums": "kit-electro", "bass": "synth-bass", "chords": "pad", "lead": "saw-lead", "pad": "strings"},
    "funk": {"bpm": 108, "drums": "kit-acoustic", "bass": "finger-bass", "chords": "guitar", "lead": "brass", "pad": "organ"},
    "piano": {"bpm": 76, "drums": "kit-lofi", "bass": "sub-bass", "chords": "piano", "lead": "piano", "pad": "strings"},
    "afrobeats": {"bpm": 104, "drums": "kit-808", "bass": "synth-bass", "chords": "marimba", "lead": "pluck", "pad": "pad"},
    "folk": {"bpm": 96, "drums": "kit-acoustic", "bass": "finger-bass", "chords": "guitar", "lead": "flute", "pad": "strings"},
    "bollywood": {"bpm": 100, "drums": "kit-808", "bass": "synth-bass", "chords": "strings", "lead": "sitar", "pad": "pad"},
}

COMPOSE_SYSTEM = """You are a hit songwriter and arranger. Plan ONE complete song as a JSON object with exactly these keys:
{
 "title": string (2-6 words),
 "genre": one of GENRES,
 "mood": string (1-3 words),
 "bpm": integer 60-180,
 "key": one of C C# D Eb E F F# G Ab A Bb B,
 "mode": "major" or "minor",
 "vocal": "sung" | "rap" | "none",
 "instruments": {"drums": KIT, "bass": BASS, "chords": CHORD_INSTRUMENT, "lead": LEAD_INSTRUMENT, "pad": PAD_INSTRUMENT or null},
 "sections": [ {"name": SECTION, "bars": 4|8|16, "chords": [Roman numerals], "energy": 1-5, "lyrics": [lines]} ]
}
GENRES: %s
KIT: kit-808 kit-acoustic kit-lofi kit-house kit-trap kit-rock kit-electro
BASS: sub-bass synth-bass finger-bass acid-bass 808-bass
CHORD_INSTRUMENT: piano epiano organ strings pad pluck guitar synth-stab harp marimba choir brass
LEAD_INSTRUMENT: lead saw-lead square-lead flute bell pluck piano guitar marimba sitar brass arp-synth epiano
PAD_INSTRUMENT: pad strings choir organ
SECTION: intro verse prechorus chorus bridge drop breakdown outro
Rules:
- chords: Roman numerals relative to the key, one chord per bar, a 2-, 4- or 8-chord loop that repeats to fill the bars (e.g. ["vi","IV","I","V"]). Lower case = minor. Allowed suffixes: 7 maj7 m7 sus2 sus4 add9 9, prefixes b or #, and ° for diminished.
- Fit the target length: total bars * 4 * 60 / bpm should be close to the target seconds.
- Typical shape: intro, verse, (prechorus), chorus, verse, chorus, bridge, chorus, outro. Electronic genres may use drop/breakdown.
- energy: intro/outro 1-2, verse 2-3, chorus/drop 4-5.
- lyrics: only in vocal sections (verse, prechorus, chorus, bridge), exactly one line per 2 bars, 4-9 words a line, singable, rhyming in pairs, in the requested language (native script). The chorus repeats the same hook lines every time. Intro, outro, drop and breakdown have [] lyrics. If vocal is "none", every lyrics list is [].
- Original lyrics only; never quote existing songs.
Answer with JSON only."""

LYRICS_SYSTEM = """You are a songwriter. Write original, singable song lyrics as JSON:
{"title": string, "sections": [{"name": SECTION, "lines": [string, ...]}]}
SECTION is one of intro verse prechorus chorus bridge outro. Verses 4-8 lines, choruses 4 lines with a memorable repeated hook,
bridge 2-4 lines. 4-9 words a line, rhyming in pairs, vivid and specific imagery, in the requested language (native script).
Never quote existing songs. Answer with JSON only."""


class MusicService:
    @staticmethod
    def engine() -> Optional[str]:
        if settings.GROQ_API_KEY.strip():
            return "groq"
        if settings.GEMINI_API_KEY.strip():
            return "gemini"
        return None

    def capabilities(self) -> Dict[str, Any]:
        return {"ai": self.engine(), "tts": True, "genres": GENRES}

    # ---- providers -------------------------------------------------------------------------

    @staticmethod
    def _groq(system: str, user: str, temperature: float) -> str:
        key = settings.GROQ_API_KEY.strip()
        last: Optional[Exception] = None
        for model in [m.strip() for m in settings.GROQ_MODELS.split(",") if m.strip()]:
            try:
                resp = requests.post(
                    GROQ_URL,
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "temperature": temperature,
                        "max_tokens": 6000,
                        "response_format": {"type": "json_object"},
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                        # Reasoning models think before answering; a song plan needs little of it.
                        **({"reasoning_effort": "low"} if "gpt-oss" in model else {}),
                    },
                    timeout=settings.AI_TIMEOUT,
                )
            except requests.RequestException as exc:  # one model stuck: the next may answer
                last = exc
                continue
            # 429 = this model's free quota is used up for now; 404 = retired; 400 = bad JSON this time.
            if resp.status_code >= 400:
                last = RuntimeError(f"groq {model} answered {resp.status_code}")
                continue
            return str(resp.json()["choices"][0]["message"]["content"])
        raise last or RuntimeError("no groq model answered")

    @staticmethod
    def _gemini(system: str, user: str, temperature: float) -> str:
        key = settings.GEMINI_API_KEY.strip()
        last: Optional[Exception] = None
        for model in [m.strip() for m in settings.GEMINI_MODELS.split(",") if m.strip()]:
            try:
                resp = requests.post(
                    GEMINI_URL.format(model=model),
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json={
                        "systemInstruction": {"parts": [{"text": system}]},
                        "contents": [{"role": "user", "parts": [{"text": user}]}],
                        "generationConfig": {"temperature": temperature, "responseMimeType": "application/json", "maxOutputTokens": 3500},
                    },
                    timeout=settings.AI_TIMEOUT,
                )
            except requests.RequestException as exc:
                last = exc
                continue
            if resp.status_code >= 400:
                last = RuntimeError(f"gemini {model} answered {resp.status_code}")
                continue
            parts = resp.json()["candidates"][0]["content"]["parts"]
            return "".join(str(p.get("text", "")) for p in parts)
        raise last or RuntimeError("no gemini model answered")

    def _ask(self, system: str, user: str, temperature: float = 0.9) -> Tuple[Dict[str, Any], str]:
        chain = []
        if settings.GROQ_API_KEY.strip():
            chain.append("groq")
        if settings.GEMINI_API_KEY.strip():
            chain.append("gemini")
        if not chain:
            raise MusicUnavailableError("No AI key is set up on this server, so the studio's built-in composer is used instead.")
        for name in chain:
            try:
                raw = self._groq(system, user, temperature) if name == "groq" else self._gemini(system, user, temperature)
                return self._json(raw), name
            except MusicProcessingError as exc:
                logger.warning("music %s gave unusable JSON: %s", name, exc.detail)
            except Exception as exc:  # quota, network or provider error: try the next provider
                logger.warning("music %s failed: %s", name, exc)
        raise MusicUnavailableError()

    @staticmethod
    def _json(raw: str) -> Dict[str, Any]:
        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`")
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise MusicProcessingError("The AI's answer wasn't a song plan.")
        try:
            data = json.loads(text[start : end + 1])
        except ValueError as exc:
            raise MusicProcessingError("The AI's answer wasn't a song plan.") from exc
        if not isinstance(data, dict):
            raise MusicProcessingError("The AI's answer wasn't a song plan.")
        return data

    # ---- sanitising ------------------------------------------------------------------------

    @staticmethod
    def _text(value: Any, limit: int, fallback: str = "") -> str:
        if not isinstance(value, str):
            return fallback
        # No control characters or markup in anything the page will display or speak.
        clean = re.sub(r"[\x00-\x1f<>]", " ", value)
        clean = re.sub(r"\s+", " ", clean).strip()
        return clean[:limit] or fallback

    def _lines(self, value: Any, limit: int) -> List[str]:
        if not isinstance(value, list):
            return []
        out = [self._text(v, settings.MAX_LINE_CHARS) for v in value[:limit]]
        return [line for line in out if line]

    @staticmethod
    def _chords(value: Any) -> List[str]:
        out: List[str] = []
        if isinstance(value, list):
            for c in value[:16]:
                token = str(c).strip().replace("dim", "°").replace("aug", "+")
                if CHORD_RE.match(token):
                    out.append(token)
        return out

    @staticmethod
    def _norm_genre(value: Any) -> str:
        g = re.sub(r"[^a-z]", "", str(value or "").lower())
        aliases = {"hiphop": "hiphop", "rap": "hiphop", "lofihiphop": "lofi", "electronic": "edm", "dance": "edm", "classical": "piano", "orchestral": "cinematic", "soul": "rnb", "country": "folk", "acoustic": "folk", "indian": "bollywood", "latin": "reggaeton", "retrowave": "synthwave", "disco": "funk", "techno": "house"}
        g = aliases.get(g, g)
        return g if g in GENRES else "pop"

    def _plan(self, data: Dict[str, Any], seconds: int, vocals: bool, genre_hint: Optional[str]) -> Dict[str, Any]:
        genre = self._norm_genre(data.get("genre") or genre_hint)
        defaults = GENRE_DEFAULTS[genre]
        try:
            bpm = int(round(float(data.get("bpm", defaults["bpm"]))))
        except (TypeError, ValueError):
            bpm = defaults["bpm"]
        bpm = max(60, min(180, bpm))
        key = str(data.get("key", "C")).strip()
        key = key if key in KEYS else "C"
        mode = "minor" if str(data.get("mode", "")).lower().startswith("min") else "major"
        vocal = str(data.get("vocal", "sung")).lower()
        vocal = vocal if vocal in VOCALS else "sung"
        if not vocals:
            vocal = "none"

        inst_raw = data.get("instruments") if isinstance(data.get("instruments"), dict) else {}

        def pick(name: str, allowed: set, default: Optional[str]) -> Optional[str]:
            v = inst_raw.get(name)
            return v if isinstance(v, str) and v in allowed else default

        instruments = {
            "drums": pick("drums", KITS, defaults["drums"]),
            "bass": pick("bass", BASSES, defaults["bass"]),
            "chords": pick("chords", CHORD_INST, defaults["chords"]),
            "lead": pick("lead", LEAD_INST, defaults["lead"]),
            "pad": pick("pad", PAD_INST, defaults["pad"]) if inst_raw.get("pad") is not None else defaults["pad"],
        }

        sections: List[Dict[str, Any]] = []
        raw_sections = data.get("sections") if isinstance(data.get("sections"), list) else []
        total = 0
        for s in raw_sections[: settings.MAX_SECTIONS]:
            if not isinstance(s, dict):
                continue
            name = re.sub(r"[^a-z]", "", str(s.get("name", "verse")).lower())
            name = "prechorus" if name.startswith("pre") else name
            name = name if name in SECTIONS else "verse"
            try:
                bars = int(s.get("bars", 8))
            except (TypeError, ValueError):
                bars = 8
            bars = 4 if bars <= 5 else 8 if bars <= 11 else 16
            if total + bars > settings.MAX_BARS:
                break
            chords = self._chords(s.get("chords")) or (["i", "VI", "III", "VII"] if mode == "minor" else ["I", "V", "vi", "IV"])
            try:
                energy = max(1, min(5, int(s.get("energy", 3))))
            except (TypeError, ValueError):
                energy = 3
            singing = vocal != "none" and name in {"verse", "prechorus", "chorus", "bridge"}
            lyrics = self._lines(s.get("lyrics"), bars // 2 + 2) if singing else []
            sections.append({"name": name, "bars": bars, "chords": chords, "energy": energy, "lyrics": lyrics})
            total += bars
        if not sections:
            raise MusicProcessingError("The AI's song had no sections. Try again.")

        # Fit the asked-for length: trim from the end (keeping the outro) when the model overshot,
        # or repeat its verse and chorus before the outro when it came up short.
        target_bars = max(8, round(seconds * bpm / 240))
        while len(sections) > 3 and total - sections[-2]["bars"] >= target_bars * 1.2:
            removed = sections.pop(-2)
            total -= removed["bars"]
        repeatable = [s for s in sections if s["name"] in {"verse", "chorus", "drop"}] or sections[1:2] or sections[:1]
        outro_at = len(sections) - 1 if sections[-1]["name"] == "outro" and len(sections) > 1 else len(sections)
        i = 0
        while total < target_bars * 0.85 and total < settings.MAX_BARS and len(sections) < settings.MAX_SECTIONS + 6:
            extra = dict(repeatable[i % len(repeatable)])
            if total + extra["bars"] > settings.MAX_BARS:
                break
            sections.insert(outro_at, extra)
            outro_at += 1
            total += extra["bars"]
            i += 1

        return {
            "title": self._text(data.get("title"), 60, "Untitled song"),
            "genre": genre,
            "mood": self._text(data.get("mood"), 40, "uplifting"),
            "bpm": bpm,
            "key": key,
            "mode": mode,
            "vocal": vocal,
            "instruments": instruments,
            "sections": sections,
        }

    # ---- public ----------------------------------------------------------------------------

    def compose(self, prompt: str, genre: Optional[str], mood: Optional[str], language: str, seconds: int, vocals: bool, lyrics: Optional[str]) -> Dict[str, Any]:
        # An unknown genre is a hint, not an error: the model picks the closest and _plan maps it.
        user = {
            "request": prompt.strip(),
            "genre": genre or "choose the best fit",
            "mood": mood or "choose the best fit",
            "language": language,
            "target_seconds": seconds,
            "vocals": vocals,
        }
        if lyrics and lyrics.strip():
            user["use_these_lyrics"] = lyrics.strip()[:4000]
            user["note"] = "Arrange the song around these lyrics: split them into sections, keep the words, one line per 2 bars."
        data, engine = self._ask(COMPOSE_SYSTEM % " ".join(GENRES), json.dumps(user, ensure_ascii=False))
        plan = self._plan(data, seconds, vocals, genre)
        plan["engine"] = engine
        return plan

    def lyrics(self, topic: str, genre: Optional[str], mood: Optional[str], language: str, structure: str) -> Dict[str, Any]:
        parts = [p.strip().lower() for p in structure.split(",") if p.strip()]
        if not parts or len(parts) > 12:
            raise InvalidMusicInputError("Give a structure like verse,chorus,verse,chorus.")
        user = json.dumps({"topic": topic.strip(), "genre": genre or "pop", "mood": mood or "any", "language": language, "structure": parts}, ensure_ascii=False)
        data, engine = self._ask(LYRICS_SYSTEM, user)
        sections = []
        for s in (data.get("sections") if isinstance(data.get("sections"), list) else [])[:12]:
            if not isinstance(s, dict):
                continue
            name = re.sub(r"[^a-z]", "", str(s.get("name", "verse")).lower())
            name = "prechorus" if name.startswith("pre") else name
            lines = self._lines(s.get("lines"), 12)
            if lines:
                sections.append({"name": name if name in SECTIONS else "verse", "lines": lines})
        if not sections:
            raise MusicProcessingError("The AI didn't write any lyrics. Try again.")
        return {"title": self._text(data.get("title"), 60, "Untitled"), "sections": sections, "engine": engine}


music_service = MusicService()
