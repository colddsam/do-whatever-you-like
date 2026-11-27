"""
The song finder: lyrics typed, sung or hummed in, the song (and its lyrics, a preview and its video) out.

How a search runs:
1. Words. Typed text is used as is; a clip goes to Groq's free Whisper, and what it hears is used.
2. Candidates. A free LLM (Groq, then Gemini) names the songs those words most likely come from.
   It is good with half-remembered and misheard lines in any language, but it can invent songs.
3. Proof. Each candidate is looked up in Apple's catalogue (iTunes Search: cover, album, preview)
   and in LRCLIB (real lyrics). Songs that exist nowhere are dropped; songs whose lyrics contain
   the words are marked verified and ranked first, with the matching line picked out.
4. Tunes. When a clip has no words, the browser has already found the notes (pitch tracking runs on
   the device). The LLM names the melody from its intervals and rhythm, and Gemini, when set up,
   listens to the clip too. Only fairly sure answers are shown: humming is best-effort.

Every call has a timeout, every provider can fail on its own without failing the search, and
answers are cached in memory for a while so repeat searches don't spend the free quotas.
"""

import base64
import json
import logging
import re
import shutil
import subprocess
import threading
import time
import unicodedata
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, BinaryIO, Callable, Dict, List, Optional, Tuple

import requests

from app.config.songid import settings
from app.exceptions.songid import InvalidSongClipError, InvalidSongQueryError, SongIdProcessingError, SongIdUnavailableError
from app.services.ffmpeg_service import init_ffmpeg

logger = logging.getLogger(__name__)

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_AUDIO_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
ITUNES_URL = "https://itunes.apple.com/search"
LRCLIB_URL = "https://lrclib.net/api/search"
# LRCLIB asks clients to say who they are.
USER_AGENT = "DoWhateverYouLike-SongFinder/1.0 (+https://do-whatever-you-like.colddsam.com)"

# What a browser recorder or an uploaded clip can be.
ALLOWED_EXTENSIONS = {".webm", ".weba", ".ogg", ".oga", ".opus", ".wav", ".mp3", ".m4a", ".mp4", ".aac", ".flac", ".3gp", ".amr", ".mov", ".mkv"}
CHUNK_SIZE = 64 * 1024
MAX_NOTES = 400

# Whisper "hears" these in silence, humming or music without words.
_HALLUCINATIONS = {
    "thank you", "thanks for watching", "thank you for watching", "you", "bye", "subscribe", "please subscribe",
    "music", "mm", "mmm", "hmm", "la la la", "oh", "ah", "uh", "um", "na na na", "da da da", "doo doo doo",
}
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

LYRICS_PROMPT = (
    "You identify songs from lyric fragments that someone remembers, mishears, misspells or transliterates, in any language "
    "(English, Hindi/Bollywood, Spanish, K-pop, Arabic, Punjabi, Tamil, Telugu, Bengali, French, Portuguese and more). "
    "The fragment may also be a song title or a description. Think about famous and less famous songs alike. "
    'Reply with JSON only: {"candidates":[{"title":"","artist":"","confidence":0.0}]}. '
    "List up to 5 real, commercially released songs, best first, with the original performer as artist "
    "(no 'feat.' credits). Confidence is 0 to 1; be honest and use low values when unsure. Never invent a song."
)
MELODY_PROMPT = (
    "You are a music expert naming a song from a tune someone hummed or whistled. You get the pitches as note names "
    "(the person may hum in any key, slightly out of tune), the intervals between consecutive notes in semitones "
    "(the most reliable part) and note lengths relative to the shortest note. Match the interval pattern and rhythm "
    "against melodies you know well: pop, rock, film and TV themes, Bollywood, K-pop, classical, folk, nursery rhymes, "
    "anthems and holiday songs. Reply with JSON only: "
    '{"candidates":[{"title":"","artist":"","confidence":0.0}]} with up to 5 songs, best first. '
    "Confidence is 0 to 1; if the pattern doesn't clearly match a melody you know, give low confidence."
)
AUDIO_PROMPT = (
    "Someone hummed, whistled, sang or played this short clip to find out what song it is. Identify the song. "
    'Reply with JSON only: {"candidates":[{"title":"","artist":"","confidence":0.0}]} with up to 3 real songs, best first. '
    "Confidence is 0 to 1. If you can't recognise it, return an empty list rather than guess."
)


# ---------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------


class _TTLCache:
    """A tiny thread-safe LRU with expiry, so repeat searches don't spend the free quotas."""

    def __init__(self, size: int, ttl: float):
        self.size, self.ttl = size, ttl
        self._data: "OrderedDict[str, Tuple[float, Any]]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Any:
        with self._lock:
            hit = self._data.get(key)
            if not hit:
                return None
            if time.monotonic() - hit[0] > self.ttl:
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return hit[1]

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.monotonic(), value)
            self._data.move_to_end(key)
            while len(self._data) > self.size:
                self._data.popitem(last=False)


def normalize(text: str) -> str:
    """Lower case, accents and punctuation gone, any script kept (Devanagari, Hangul, Arabic…)."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower().replace("’", "'").replace("'", "")
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text.replace("_", " ")).strip()


def _cjk(ch: str) -> bool:
    return any(start <= ord(ch) <= end for start, end in ((0x3040, 0x30FF), (0x3400, 0x9FFF), (0xAC00, 0xD7AF), (0x0E00, 0x0E7F)))


def tokens(text: str) -> List[str]:
    """Words; scripts written without spaces (Chinese, Japanese, Thai) become single characters."""
    out: List[str] = []
    for word in normalize(text).split():
        if any(_cjk(c) for c in word):
            out.extend(c for c in word if c.strip())
        else:
            out.append(word)
    return out


def _latin_share(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    return sum(c.isascii() for c in letters) / len(letters) if letters else 1.0


def _same_word(a: str, b: str) -> bool:
    if a == b:
        return True
    # Misheard or misspelt words ("loose" for "lose", "dont" for "don't") still count.
    return len(a) >= 4 and len(b) >= 4 and abs(len(a) - len(b)) <= 2 and SequenceMatcher(None, a, b).ratio() >= 0.8


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


_TITLE_NOISE = re.compile(r"\s*[\(\[][^)\]]*(feat|ft\.|with|remaster|version|edit|live|mix|from|soundtrack|ost)[^)\]]*[\)\]]|\s+-\s+.*(remaster|version|edit|live|mix).*$", re.I)


def clean_title(title: str) -> str:
    return _TITLE_NOISE.sub("", title or "").strip()


_SPELLINGS = [("ee", "i"), ("oo", "u"), ("aa", "a"), ("ii", "i"), ("uu", "u"), ("ph", "f"), ("w", "v"), ("z", "j"), ("q", "k"), ("ck", "k")]


def _key(word: str) -> str:
    """
    A spelling-proof form of a word written in Latin letters. Romanised Hindi, Urdu and Punjabi
    have no fixed spelling (haseen/hasin, zindagi/jindagi, dil/dill), so both sides are compared
    by sound: long vowels shortened, doubled letters merged, a few look-alike consonants joined.
    """
    if not word.isascii():
        return word
    for a, b in _SPELLINGS:
        word = word.replace(a, b)
    return re.sub(r"(.)\1+", r"\1", word)


def match_tokens(text: str) -> List[str]:
    return [_key(t) for t in tokens(text)]


def _join_compounds(seq: List[str], other: set) -> List[str]:
    """
    Two neighbouring words that the other side writes as one ("dil nasheen" / "dilnasheen",
    "ba khuda" / "bakhuda", "any more" / "anymore") become that one word.
    """
    out, i = [], 0
    while i < len(seq):
        if i + 1 < len(seq) and seq[i] + seq[i + 1] in other and not (seq[i] in other and seq[i + 1] in other):
            out.append(seq[i] + seq[i + 1])
            i += 2
        else:
            out.append(seq[i])
            i += 1
    return out


def lyric_match(query: str, lyrics: str) -> Tuple[float, Optional[str]]:
    """
    How much of the query appears in the lyrics (0–1), and the line it matches best.

    A query of several lines (a pasted verse) is scored line by line, each line once however often
    it repeats, because the end of one line and the start of the next aren't next to each other
    in the song. The result is the length-weighted average, or nearly the best single line's
    score when one long line clearly matches.
    """
    seen, qlines = set(), []
    for ln in (query or "").splitlines():
        key = " ".join(match_tokens(ln))
        if key and key not in seen:
            seen.add(key)
            qlines.append(ln)
    if len(qlines) <= 1:
        return _match_one(query, lyrics)
    parts = [(len(match_tokens(ln)), *_match_one(ln, lyrics)) for ln in qlines]
    total = sum(n for n, _, _ in parts)
    average = sum(n * sc for n, sc, _ in parts) / total
    n_best, best_score, _ = max(parts, key=lambda x: (x[1] * min(1.0, x[0] / 5), x[0]))
    score = max(average, best_score * 0.9 if n_best >= 5 else 0.0)
    lines_hit = [(sc, line) for n, sc, line in parts if line]
    return round(score, 3), (max(lines_hit)[1] if lines_hit else None)


def _match_one(query: str, lyrics: str) -> Tuple[float, Optional[str]]:
    """
    One line against the lyrics. Half the score is words found anywhere, half is words found next
    to each other, so a real line scores high and a pile of common words ("love", "baby") doesn't.
    """
    q = match_tokens(query)
    lines = [ln.strip() for ln in (lyrics or "").splitlines() if ln.strip()]
    if not q or not lines:
        return 0.0, None
    words = match_tokens(" ".join(lines))
    # Compounds written apart on one side and together on the other are lined up both ways.
    words = _join_compounds(words, set(q))
    q = _join_compounds(q, set(words))
    vocab = set(words)

    def found(w: str) -> bool:
        return w in vocab or (len(w) >= 4 and any(_same_word(w, v) for v in vocab if v[:1] == w[:1]))

    hit = [found(w) for w in q]
    coverage = sum(hit) / len(q)
    if len(q) == 1:
        pairs = 1.0 if hit[0] else 0.0
    else:
        pair_set = set(zip(words, words[1:]))

        def pair_found(a: str, b: str) -> bool:
            return (a, b) in pair_set or any(_same_word(a, x) and _same_word(b, y) for x, y in pair_set if x[:1] == a[:1] and y[:1] == b[:1])

        pairs = sum(1 for a, b in zip(q, q[1:]) if pair_found(a, b)) / (len(q) - 1)
    score = round(0.5 * coverage + 0.5 * pairs, 3)

    # The line to highlight: the one holding most of the query, earliest on a tie. A query that
    # runs across two lines lights up the line holding more of it, never a neighbour.
    qset = set(q)

    def overlap(line_tokens: List[str]) -> float:
        return sum(1 for w in qset if w in line_tokens or any(_same_word(w, x) for x in line_tokens)) / len(qset)

    per_line = [overlap(_join_compounds(match_tokens(line), qset)) for line in lines]
    best, best_line = 0.0, None
    for i, line in enumerate(lines):
        own = per_line[i]
        if own > best + 1e-9:
            best, best_line = own, line
        if i + 1 < len(lines):
            joined = overlap(_join_compounds(match_tokens(f"{line} {lines[i + 1]}"), qset)) - 0.05
            if joined > best + 1e-9:
                best, best_line = joined, line if own >= per_line[i + 1] else lines[i + 1]
    norm_q, norm_l = " ".join(q), " ".join(words)
    if len(q) >= 3 and norm_q in norm_l:
        score = 1.0  # The exact words, in order.
    return score, (best_line if best >= 0.34 else None)


# Words too common to be a title on their own (English, and romanised Hindi, Urdu and Punjabi).
_COMMON = set(
    "the a an and or but to of in on at for with from by is are was were be been am i im you your youre me my mine we our "
    "us he she it they them this that these those so oh yeah baby love no not do dont just all can cause like when what "
    "where how why its got get there here now never ever up down out one more time know want need go let make feel say "
    "take come see way only still every mera meri mere tera teri tere tu tum tumhe tujhe mujhe main mai hum hai hain ho "
    "hoon tha thi na nahi ko ki ka ke se mein ye yeh woh wo jo bhi to hi koi kya kyun aur ab jab tab dil pyar ishq "
    "jaan sanam yaar re haan ve ni da di de nu".split()
)


def title_phrases(text: str, limit: int = 6) -> List[str]:
    """Phrases from remembered lyrics most likely to be a song's title, best first."""
    lines = [" ".join(tokens(ln)) for ln in (text or "").splitlines()]
    lines = [ln for ln in lines if ln]
    words = tokens(text)
    phrases: List[str] = []

    def add(p: str) -> None:
        p = p.strip()
        if p and len(p) >= 4 and p not in phrases and not all(w in _COMMON for w in p.split()):
            phrases.append(p)

    # The hook: a line that repeats is very often the title (or opens with it).
    counts: Dict[str, int] = {}
    for ln in lines:
        counts[ln] = counts.get(ln, 0) + 1
    for ln, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        if n > 1:
            parts = ln.split()
            add(" ".join(parts[:2]))
            add(" ".join(parts[:4]))
    # Words that repeat, then rare (long, uncommon) words.
    freq: Dict[str, int] = {}
    for w in words:
        if w not in _COMMON and len(w) >= 4:
            freq[w] = freq.get(w, 0) + 1
    for w, _ in sorted(freq.items(), key=lambda kv: (-kv[1], -len(kv[0])))[:3]:
        add(w)
    # The opening words, and the first two distinctive words together.
    add(" ".join(words[:2]))
    add(" ".join(words[:3]))
    rare = [w for w in words if w not in _COMMON and len(w) >= 4]
    if len(rare) >= 2:
        add(f"{rare[0]} {rare[1]}")
    phrases = phrases[:limit]
    # Romanised words are spelt many ways and the database only matches a title as written, so the
    # two rarest words are also tried with their long-vowel spellings (hasin → haseen, dur → door).
    for w in sorted({w for w in rare}, key=len, reverse=True)[:2]:
        for variant in _respellings(w):
            if variant not in phrases:
                phrases.append(variant)
    return phrases[: limit + 3]


def _respellings(word: str) -> List[str]:
    out = []
    i = word.rfind("i")
    if 0 < i < len(word) - 1 and word[i - 1] != "e" and word[i + 1] != "e":
        out.append(word[:i] + "ee" + word[i + 1 :])
    if "ee" in word:
        out.append(word.replace("ee", "i"))
    u = word.rfind("u")
    if 0 < u < len(word) - 1 and word[u - 1] != "o":
        out.append(word[:u] + "oo" + word[u + 1 :])
    return out[:2]


_NOT_ORIGINAL = re.compile(r"\b(tribute|salute to|karaoke|in the style of|originally performed|made famous|cover|instrumental|piano version|lullaby|8d|slowed|sped up|nightcore)\b", re.I)


def _reupload(title: str, artist: str) -> bool:
    """Lyric channels' re-posts, covers, tributes, karaoke and medleys: not the song itself."""
    a = normalize(artist)
    if a in {"7clouds", "taazi music", "lyrics", "lyric video"} or "lyrics" in a or (" - " in title and len(title) > 40):
        return True
    return bool(_NOT_ORIGINAL.search(title) or _NOT_ORIGINAL.search(artist)) or " / " in title


def _generic_artist(artist: str) -> bool:
    a = normalize(artist)
    return a in {"various artists", "various", "karaoke", "the karaoke channel"} or "karaoke" in a or "tribute" in a


def _note_name(midi: float) -> str:
    m = int(round(midi))
    return f"{_NOTE_NAMES[m % 12]}{m // 12 - 1}"


def describe_melody(notes: List[Dict[str, float]]) -> Optional[str]:
    """Notes from the browser ({m: MIDI pitch, d: seconds}) as text an LLM can reason about."""
    clean = [(float(n["m"]), float(n["d"])) for n in notes if 30 <= float(n.get("m", 0)) <= 100 and 0.05 <= float(n.get("d", 0)) <= 6]
    if len(clean) < 5:
        return None
    clean = clean[:60]
    shortest = sorted(d for _, d in clean)[max(0, len(clean) // 5)] or 0.1
    names = " ".join(_note_name(m) for m, _ in clean)
    steps = " ".join(f"{int(round(b - a)):+d}" for (a, _), (b, _) in zip(clean, clean[1:]))
    lengths = " ".join(f"{max(0.25, round(d / shortest * 4) / 4):g}" for _, d in clean)
    return f"Notes: {names}\nIntervals (semitones): {steps}\nRelative lengths: {lengths}"


# ---------------------------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------------------------


class SongIdService:
    def __init__(self) -> None:
        self._http = requests.Session()
        self._http.headers.update({"User-Agent": USER_AGENT})
        self._answers = _TTLCache(256, 6 * 3600)
        self._lookups = _TTLCache(1024, 24 * 3600)
        self._videos = _TTLCache(512, 24 * 3600)
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="songid")

    # ---- what works ----------------------------------------------------------------------

    @staticmethod
    def _groq_key() -> str:
        return settings.GROQ_API_KEY.strip()

    @staticmethod
    def _gemini_key() -> str:
        return settings.GEMINI_API_KEY.strip()

    def capabilities(self) -> Dict[str, Any]:
        llm = bool(self._groq_key() or self._gemini_key())
        return {
            "lyrics": llm,
            "audio": bool(self._groq_key()) and llm,
            "melody": llm,
            "max_clip_seconds": settings.MAX_CLIP_SECONDS,
            "max_file_mb": settings.MAX_FILE_MB,
        }

    # ---- validation ----------------------------------------------------------------------

    @staticmethod
    def validate_text(text: str) -> str:
        lines = [re.sub(r"[ \t\u00a0]+", " ", ln).strip() for ln in (text or "").splitlines()]
        clean = "\n".join(ln for ln in lines if ln)
        if len(tokens(clean)) < 1 or len(normalize(clean)) < 2:
            raise InvalidSongQueryError("Type a few words of the song.")
        return clean[:600]

    @staticmethod
    def validate_filename(filename: Optional[str]) -> str:
        ext = Path(filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise InvalidSongClipError("That isn't an audio recording we can read. Use MP3, M4A, WAV, OGG or WebM.")
        return ext

    @staticmethod
    def parse_notes(raw: Optional[str]) -> List[Dict[str, float]]:
        if not raw:
            return []
        if len(raw) > 20_000:
            raise InvalidSongQueryError("Too many notes were sent.")
        try:
            data = json.loads(raw)
        except ValueError:
            raise InvalidSongQueryError("The tune's notes weren't readable.")
        if not isinstance(data, list):
            raise InvalidSongQueryError("The tune's notes weren't readable.")
        out = []
        for n in data[:MAX_NOTES]:
            if isinstance(n, dict) and isinstance(n.get("m"), (int, float)) and isinstance(n.get("d"), (int, float)):
                out.append({"m": float(n["m"]), "d": float(n["d"])})
        return out

    def save_upload(self, file_obj: BinaryIO, destination: Path) -> Path:
        limit = settings.MAX_FILE_MB * 1024 * 1024
        total = 0
        with open(destination, "wb") as out:
            while chunk := file_obj.read(CHUNK_SIZE):
                total += len(chunk)
                if total > limit:
                    raise InvalidSongClipError(f"That clip is over {settings.MAX_FILE_MB} MB. A few seconds of singing is plenty.")
                out.write(chunk)
        if total == 0:
            raise InvalidSongClipError("The recording was empty. Check your microphone and try again.")
        return destination

    # ---- LLM providers --------------------------------------------------------------------

    def _groq_chat(self, system: str, user: str) -> str:
        last: Optional[Exception] = None
        for model in [m.strip() for m in settings.GROQ_MODELS.split(",") if m.strip()]:
            try:
                resp = self._http.post(
                    GROQ_CHAT_URL,
                    headers={"Authorization": f"Bearer {self._groq_key()}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "temperature": 0.2,
                        "max_tokens": 1500,
                        "response_format": {"type": "json_object"},
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                        **({"reasoning_effort": "low"} if "gpt-oss" in model else {}),
                    },
                    timeout=settings.AI_TIMEOUT,
                )
            except requests.RequestException as exc:
                last = exc
                continue
            # 429: this model's free quota is spent for now; 404: retired; 400: bad JSON this time.
            if resp.status_code >= 400:
                last = RuntimeError(f"groq {model} answered {resp.status_code}")
                continue
            return str(resp.json()["choices"][0]["message"]["content"])
        raise last or RuntimeError("no groq model answered")

    def _gemini(self, parts: List[Dict[str, Any]], system: Optional[str], models: str, timeout: int) -> str:
        last: Optional[Exception] = None
        for model in [m.strip() for m in models.split(",") if m.strip()]:
            body: Dict[str, Any] = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "maxOutputTokens": 1200},
            }
            if system:
                body["systemInstruction"] = {"parts": [{"text": system}]}
            try:
                resp = self._http.post(
                    GEMINI_URL.format(model=model),
                    headers={"x-goog-api-key": self._gemini_key(), "Content-Type": "application/json"},
                    json=body,
                    timeout=timeout,
                )
            except requests.RequestException as exc:
                last = exc
                continue
            if resp.status_code >= 400:
                last = RuntimeError(f"gemini {model} answered {resp.status_code}")
                continue
            try:
                return "".join(str(p.get("text", "")) for p in resp.json()["candidates"][0]["content"]["parts"])
            except (KeyError, IndexError, ValueError) as exc:
                last = exc
        raise last or RuntimeError("no gemini model answered")

    @staticmethod
    def _candidates(raw: str) -> List[Dict[str, Any]]:
        text = raw.strip()
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return []
        try:
            data = json.loads(text[start : end + 1])
        except ValueError:
            return []
        out, seen = [], set()
        for c in (data.get("candidates") if isinstance(data, dict) else None) or []:
            if not isinstance(c, dict):
                continue
            title, artist = str(c.get("title") or "").strip()[:160], str(c.get("artist") or "").strip()[:160]
            if not title:
                continue
            key = (normalize(clean_title(title)), normalize(artist))
            if key in seen:
                continue
            seen.add(key)
            try:
                conf = max(0.0, min(1.0, float(c.get("confidence", 0.5))))
            except (TypeError, ValueError):
                conf = 0.5
            out.append({"title": title, "artist": artist, "confidence": conf})
        return out[: settings.MAX_CANDIDATES]

    def _ask(self, system: str, user: str) -> List[Dict[str, Any]]:
        """Groq first (fast), Gemini if Groq has nothing; an empty list if neither can answer."""
        cache_key = f"{hash(system)}|{user}"
        cached = self._answers.get(cache_key)
        if cached is not None:
            return cached
        providers: List[Tuple[str, Callable[[], str]]] = []
        if self._groq_key():
            providers.append(("groq", lambda: self._groq_chat(system, user)))
        if self._gemini_key():
            providers.append(("gemini", lambda: self._gemini([{"text": user}], system, settings.GEMINI_MODELS, settings.AI_TIMEOUT)))
        if not providers:
            raise SongIdUnavailableError("The song finder isn't set up on this server yet.")
        failures = 0
        for name, call in providers:
            try:
                found = self._candidates(call())
            except Exception as exc:  # quota, network or provider error: the next provider may answer
                failures += 1
                logger.warning("songid %s failed: %s", name, exc)
                continue
            if found:
                self._answers.put(cache_key, found)
                return found
        if failures == len(providers):
            raise SongIdUnavailableError()
        return []

    # ---- catalogue and lyrics ------------------------------------------------------------

    def _get_json(self, url: str, params: Dict[str, Any]) -> Any:
        resp = self._http.get(url, params=params, timeout=settings.LOOKUP_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def _itunes(self, title: str, artist: str) -> Optional[Dict[str, Any]]:
        """The release that best fits the title and artist, from Apple's free search API."""
        want_title, want_artist = clean_title(title), artist
        best, best_score = None, 0.0
        for country in [c.strip() for c in settings.ITUNES_COUNTRIES.split(",") if c.strip()]:
            try:
                data = self._get_json(ITUNES_URL, {"term": f"{want_title} {want_artist}"[:200], "entity": "song", "limit": 10, "country": country})
            except Exception as exc:
                logger.info("itunes lookup failed (%s): %s", country, exc)
                continue
            for r in data.get("results") or []:
                t = _similar(clean_title(r.get("trackName", "")), want_title)
                if t < 0.6:
                    continue  # A longer, different title that merely contains the word is another song.
                a = _similar(r.get("artistName", ""), want_artist) if want_artist else 0.6
                # The artist may be credited with others ("Luis Fonsi & Daddy Yankee").
                if want_artist and normalize(want_artist).split(" ")[0] in normalize(r.get("artistName", "")):
                    a = max(a, 0.85)
                score = 0.6 * t + 0.4 * a
                if score > best_score:
                    best, best_score = r, score
            if best_score >= 0.8:
                break
        if not best or best_score < 0.62:
            return None
        art = best.get("artworkUrl100") or ""
        year = None
        if str(best.get("releaseDate", ""))[:4].isdigit():
            year = int(str(best["releaseDate"])[:4])
        return {
            "title": best.get("trackName") or title,
            "artist": best.get("artistName") or artist,
            "album": best.get("collectionName"),
            "year": year,
            "genre": best.get("primaryGenreName"),
            "duration_seconds": int(best["trackTimeMillis"] / 1000) if best.get("trackTimeMillis") else None,
            "artwork": art.replace("100x100bb", "600x600bb") if art else None,
            "preview_url": best.get("previewUrl"),
            "apple_url": best.get("trackViewUrl"),
            "fit": best_score,
        }

    def _lrclib(self, title: str, artist: str, duration: Optional[int]) -> Optional[Dict[str, Any]]:
        want = clean_title(title)
        params = {"track_name": want}
        if artist:
            params["artist_name"] = artist
        try:
            rows = self._get_json(LRCLIB_URL, params)
            if not rows and artist:
                rows = self._get_json(LRCLIB_URL, {"q": f"{want} {artist}"})
        except Exception as exc:
            logger.info("lrclib lookup failed: %s", exc)
            return None
        best, best_score = None, 0.0
        for r in rows or []:
            if r.get("instrumental") or not (r.get("plainLyrics") or r.get("syncedLyrics")):
                continue
            score = 0.6 * _similar(clean_title(r.get("trackName", "")), want) + 0.4 * (_similar(r.get("artistName", ""), artist) if artist else 0.6)
            if duration and r.get("duration"):
                score -= min(0.2, abs(float(r["duration"]) - duration) / 300)
            if r.get("syncedLyrics"):
                score += 0.02
            if score > best_score:
                best, best_score = r, score
        if not best or best_score < 0.55:
            return None
        plain = best.get("plainLyrics") or re.sub(r"^\[[^\]]*\]\s?", "", best.get("syncedLyrics") or "", flags=re.M)
        return {"lyrics": plain.strip() or None, "synced_lyrics": best.get("syncedLyrics") or None}

    def _resolve(self, cand: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """A candidate with its real release details and lyrics, or None if it can't be found anywhere."""
        key = f"{normalize(clean_title(cand['title']))}|{normalize(cand['artist'])}"
        cached = self._lookups.get(key)
        if cached is not None:
            return cached or None
        meta = self._itunes(cand["title"], cand["artist"])
        title = meta["title"] if meta else cand["title"]
        artist = meta["artist"] if meta else cand["artist"]
        words = self._lrclib(title, artist, meta.get("duration_seconds") if meta else None)
        if not words and meta and (normalize(clean_title(title)) != normalize(clean_title(cand["title"])) or normalize(artist) != normalize(cand["artist"])):
            words = self._lrclib(cand["title"], cand["artist"], meta.get("duration_seconds"))
        if not meta and not words:
            self._lookups.put(key, {})  # Not in the catalogue nor in any lyrics: most likely invented.
            return None
        song = {"title": clean_title(title) or title, "artist": artist, **{k: v for k, v in (meta or {}).items() if k not in ("title", "artist", "fit")}}
        song.update(words or {})
        self._lookups.put(key, song)
        return song

    def _verify(self, cands: List[Dict[str, Any]], query: Optional[str], source: str) -> List[Dict[str, Any]]:
        if not cands:
            return []
        futures = [(c, self._pool.submit(self._resolve, c)) for c in cands]
        out: List[Dict[str, Any]] = []
        for cand, fut in futures:
            try:
                song = fut.result(timeout=settings.LOOKUP_TIMEOUT * 3)
            except Exception as exc:
                logger.info("songid lookup failed for %s: %s", cand.get("title"), exc)
                continue
            if not song:
                continue
            conf, verified, line = cand["confidence"], False, None
            if query and song.get("lyrics"):
                score, line = lyric_match(query, song["lyrics"])
                comparable = abs(_latin_share(query) - _latin_share(song["lyrics"])) < 0.5
                q_len = len(tokens(query))
                # One or two words ("love") are in thousands of songs: never proof on their own.
                if q_len >= 3 and (score >= 0.55 or (score >= 0.4 and q_len >= 6)):
                    verified = True
                    conf = max(conf, min(0.99, 0.55 + score * 0.45))
                elif comparable and q_len >= 6 and score < 0.2:
                    continue  # A whole line was given and this song's lyrics don't have it: a wrong guess.
                elif comparable and q_len >= 4 and score < 0.2:
                    # The words are clearly not in this song's lyrics: keep it, but well below the rest.
                    conf *= 0.35
                    line = None
                elif not comparable:
                    line = None  # Typed in Latin letters, lyrics in another script: can't compare.
            lyric = score if query and song.get("lyrics") else 0.0
            out.append({**song, "confidence": round(conf, 3), "verified": verified, "matched_line": line, "source": source,
                        "_lyric": lyric if verified else 0.0, "_ai": True})
        # The same release reached through two spellings: keep the stronger one.
        unique: Dict[str, Dict[str, Any]] = {}
        for s in out:
            k = f"{normalize(s['title'])}|{normalize(s['artist'])}"
            if k not in unique or s["confidence"] > unique[k]["confidence"]:
                unique[k] = s
        ranked = sorted(unique.values(), key=lambda s: (s["verified"], s["confidence"]), reverse=True)
        # A compilation ("Various Artists") or karaoke copy of a song already listed adds nothing.
        titles = {normalize(s["title"]) for s in ranked if not _generic_artist(s["artist"])}
        return [s for s in ranked if not (_generic_artist(s["artist"]) and normalize(s["title"]) in titles)]

    # ---- searches ------------------------------------------------------------------------

    def _lrclib_query(self, term: str) -> List[Dict[str, Any]]:
        key = f"q|{term}"
        cached = self._lookups.get(key)
        if cached is not None:
            return cached
        try:
            rows = self._get_json(LRCLIB_URL, {"q": term}) or []
        except Exception as exc:
            logger.info("lrclib search failed for %r: %s", term, exc)
            return []
        self._lookups.put(key, rows)
        return rows

    def search_lyrics_db(self, text: str) -> List[Dict[str, Any]]:
        """
        Songs found in LRCLIB without the AI. Its search only matches titles, artists and albums, so
        it is asked for the phrases most likely to be a title (the repeated hook, rare words, the
        opening words), and a song it returns is kept only if its real lyrics hold the query.
        This finds the songs the AI doesn't know: new, indie and regional releases.
        """
        if len(tokens(text)) < 3:
            return []
        rows: Dict[Any, Dict[str, Any]] = {}
        futures = [self._pool.submit(self._lrclib_query, term) for term in title_phrases(text)]
        for fut in futures:
            try:
                for r in fut.result(timeout=settings.LOOKUP_TIMEOUT + 4):
                    if r.get("plainLyrics") or r.get("syncedLyrics"):
                        rows[r.get("id") or (r.get("trackName"), r.get("artistName"))] = r
            except Exception as exc:
                logger.info("lrclib phrase search failed: %s", exc)
        found: Dict[str, Dict[str, Any]] = {}
        for r in rows.values():
            plain = r.get("plainLyrics") or re.sub(r"^\[[^\]]*\]\s?", "", r.get("syncedLyrics") or "", flags=re.M)
            score, line = lyric_match(text, plain)
            # Found by its title, not named by the AI: the lyrics have to make the case on their own.
            if score < 0.6:
                continue
            title, artist = clean_title(r.get("trackName") or ""), r.get("artistName") or ""
            if not title or _reupload(title, artist) or _generic_artist(artist) or normalize(artist) == normalize(title):
                continue
            k = f"{normalize(title)}|{normalize(artist)}"
            if k not in found or score > found[k]["score"]:
                found[k] = {
                    "title": title, "artist": artist, "album": r.get("albumName"), "lyrics": plain.strip() or None,
                    "synced_lyrics": r.get("syncedLyrics") or None, "score": score, "line": line,
                    "duration_seconds": int(r["duration"]) if r.get("duration") else None,
                }
        best = sorted(found.values(), key=lambda f: f["score"], reverse=True)[: settings.MAX_CANDIDATES]
        # Cover, album, year and the preview come from Apple's catalogue, looked up in parallel.
        metas = [self._pool.submit(self._itunes, f["title"], f["artist"]) for f in best]
        out = []
        for f, fut in zip(best, metas):
            try:
                meta = fut.result(timeout=settings.LOOKUP_TIMEOUT * 3) or {}
            except Exception:
                meta = {}
            song = {k: v for k, v in meta.items() if k not in ("title", "artist", "fit")}
            song.update({"title": f["title"], "artist": f["artist"], "lyrics": f["lyrics"], "synced_lyrics": f["synced_lyrics"]})
            song["album"] = song.get("album") or f["album"]
            song["duration_seconds"] = song.get("duration_seconds") or f["duration_seconds"]
            out.append({
                **song, "confidence": round(min(0.99, 0.55 + f["score"] * 0.45), 3), "verified": True,
                "matched_line": f["line"], "source": "lyrics", "_lyric": f["score"], "_ai": False,
            })
        return out

    def search_text(self, text: str, source: str = "lyrics") -> List[Dict[str, Any]]:
        # The AI (knows famous songs, even from misheard words) and the lyrics database (knows songs the
        # AI has never heard of, from the exact words) search side by side; every answer is proven.
        db_job = self._pool.submit(self.search_lyrics_db, text)
        ai_error: Optional[Exception] = None
        try:
            matches = self._verify(self._ask(LYRICS_PROMPT, f'Lyrics or title: "{text}"'), text, source)
        except SongIdUnavailableError as exc:
            matches, ai_error = [], exc
        try:
            from_db = db_job.result(timeout=settings.LOOKUP_TIMEOUT * 4)
        except Exception as exc:
            logger.info("songid lyrics-database search failed: %s", exc)
            from_db = []
        if ai_error and not from_db:
            raise ai_error
        merged: Dict[str, Dict[str, Any]] = {}
        for m in from_db + matches:
            if m["source"] == "lyrics":
                m = {**m, "source": source}
            first_artist = normalize(m["artist"]).split(" ")[0] if m["artist"] else ""
            k = f"{normalize(clean_title(m['title']))}|{first_artist}"
            if k not in merged or (m["verified"], m["confidence"]) > (merged[k]["verified"], merged[k]["confidence"]):
                merged[k] = m
        # Proven songs first, the ones whose lyrics hold the words best first; on a tie, the one the
        # AI also named (the well-known original rather than a cover).
        ranked = sorted(merged.values(), key=lambda m: (m["verified"], round(m.get("_lyric", 0.0), 1) + (0.2 if m.get("_ai") else 0.0), m["confidence"]), reverse=True)
        if any(m["verified"] for m in ranked):
            top = max(m.get("_lyric", 0.0) for m in ranked)
            ai_proved = any(m["verified"] and m.get("_ai") for m in ranked)

            def keep(m: Dict[str, Any]) -> bool:
                if not m["verified"]:
                    return m["confidence"] >= 0.6
                # With a proven, AI-named answer, database finds must hold the words just as well.
                margin = 0.1 if ai_proved and not m.get("_ai") else 0.2
                return m.get("_lyric", 0.0) >= top - margin

            # Proven answers exist: unproven guesses, and songs that hold the words much less well, only confuse.
            ranked = [m for m in ranked if keep(m)]
        # One entry per song title: covers of the song already listed add nothing.
        out, titles = [], set()
        for m in ranked:
            t = normalize(clean_title(m["title"]))
            if m["verified"] and t in titles and not m.get("_ai"):
                continue
            titles.add(t)
            out.append({k: v for k, v in m.items() if not k.startswith("_")})
        return [m for m in out if m["verified"] or m["confidence"] >= 0.2]

    def search_melody(self, notes: List[Dict[str, float]], clip: Optional[Path]) -> List[Dict[str, Any]]:
        described = describe_melody(notes)
        by_notes = self._pool.submit(self._ask, MELODY_PROMPT, described) if described else None
        by_ear = self._pool.submit(self._listen, clip) if clip and self._gemini_key() else None
        cands: List[Dict[str, Any]] = []
        if by_notes:
            try:
                cands.extend(by_notes.result(timeout=settings.AI_TIMEOUT * 2))
            except Exception as exc:
                logger.info("songid melody guess failed: %s", exc)
        if by_ear:
            # Gemini's free audio model is often slow or busy. When the notes already named the tune
            # with confidence, it gets a few seconds to agree; otherwise its full allowance.
            sure = any(c["confidence"] >= 0.75 for c in cands)
            try:
                cands.extend(by_ear.result(timeout=4 if sure else settings.AUDIO_AI_TIMEOUT + 2))
            except Exception as exc:
                logger.info("songid listening guess failed or was too slow: %s", exc)
        if not cands:
            return []
        # When both the note reading and the listening model name the same song, that's real evidence.
        merged: Dict[str, Dict[str, Any]] = {}
        for c in cands:
            k = normalize(clean_title(c["title"]))
            if k in merged:
                merged[k]["confidence"] = min(0.95, max(merged[k]["confidence"], c["confidence"]) + 0.2)
            else:
                merged[k] = dict(c)
        sure = [c for c in sorted(merged.values(), key=lambda c: c["confidence"], reverse=True) if c["confidence"] >= 0.5][:3]
        matches = self._verify(sure, None, "melody")
        for m in matches:
            m["confidence"] = round(min(m["confidence"], 0.9), 3)  # A tune alone is never proof.
        return matches

    def _listen(self, clip: Path) -> List[Dict[str, Any]]:
        data = base64.b64encode(clip.read_bytes()).decode()
        raw = self._gemini(
            [{"text": AUDIO_PROMPT}, {"inline_data": {"mime_type": "audio/flac", "data": data}}],
            None,
            settings.GEMINI_AUDIO_MODELS,
            settings.AUDIO_AI_TIMEOUT,
        )
        return self._candidates(raw)

    # ---- audio ---------------------------------------------------------------------------

    @staticmethod
    def to_clip(source: Path, clip: Path) -> float:
        """Any recording to a short 16 kHz mono FLAC (small for Whisper and Gemini). Returns its length."""
        init_ffmpeg()
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        try:
            proc = subprocess.run(
                [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-sn", "-dn",
                 "-t", str(settings.MAX_CLIP_SECONDS), "-ac", "1", "-ar", "16000", "-c:a", "flac", str(clip)],
                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60,
            )
        except subprocess.TimeoutExpired:
            raise InvalidSongClipError("Reading that recording took too long. Try a shorter clip.")
        if proc.returncode != 0 or not clip.is_file() or clip.stat().st_size == 0:
            logger.info("songid ffmpeg failed: %s", (proc.stderr or "")[-300:])
            raise InvalidSongClipError("We couldn't hear anything in that recording. Try recording again.")
        duration = 0.0
        try:
            probe = subprocess.run(
                [shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(clip)],
                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20,
            )
            duration = float((probe.stdout or "0").strip() or 0)
        except (subprocess.TimeoutExpired, ValueError):
            pass
        if duration and duration < settings.MIN_CLIP_SECONDS:
            raise InvalidSongClipError("That recording is too short. Sing or hum for at least 2 seconds.")
        return duration

    def hear(self, clip: Path) -> Tuple[str, Optional[str]]:
        """The words Whisper hears, or '' when it's only a tune (or Whisper isn't available)."""
        if not self._groq_key():
            return "", None
        for attempt in range(2):
            try:
                with open(clip, "rb") as fh:
                    resp = self._http.post(
                        GROQ_AUDIO_URL,
                        headers={"Authorization": f"Bearer {self._groq_key()}"},
                        data={"model": settings.GROQ_WHISPER_MODEL, "response_format": "verbose_json", "temperature": "0"},
                        files={"file": (clip.name, fh, "audio/flac")},
                        timeout=settings.WHISPER_TIMEOUT,
                    )
            except requests.RequestException as exc:
                logger.warning("songid whisper failed: %s", exc)
                continue
            if resp.status_code == 200:
                return self._words(resp.json())
            if resp.status_code == 429 and attempt == 0:
                time.sleep(min(5.0, float(resp.headers.get("retry-after") or 2)))
                continue
            logger.warning("songid whisper answered %s: %s", resp.status_code, resp.text[:200])
            break
        return "", None

    @staticmethod
    def _words(result: Dict[str, Any]) -> Tuple[str, Optional[str]]:
        kept = []
        for seg in result.get("segments") or [{"text": result.get("text", ""), "no_speech_prob": 0}]:
            text = re.sub(r"[♪♫🎵🎶*]+", " ", str(seg.get("text", ""))).strip()
            # Whisper fills humming and pauses with stock phrases; its own doubt says when.
            if not text or float(seg.get("no_speech_prob") or 0) > 0.7:
                continue
            if normalize(text) in _HALLUCINATIONS:
                continue
            kept.append(text)
        text = re.sub(r"\s+", " ", " ".join(kept)).strip()
        words = [w for w in tokens(text) if w not in {"la", "na", "da", "mm", "hmm", "oh", "ah", "ooh", "doo", "dum"}]
        if len(words) < 3:
            return "", result.get("language")
        return text[:600], result.get("language")

    def search_audio(self, clip: Path, notes: List[Dict[str, float]]) -> Dict[str, Any]:
        heard, _language = self.hear(clip)
        if heard:
            try:
                matches = self.search_text(heard, "audio")
            except SongIdUnavailableError:
                raise
            except Exception as exc:
                logger.warning("songid text search failed: %s", exc)
                matches = []
            if matches and matches[0]["verified"]:
                return {"kind": "words", "heard": heard, "matches": matches}
            # Words were heard but didn't settle it: the tune may.
            tune = self.search_melody(notes, clip) if (notes or self._gemini_key()) else []
            combined = matches + [t for t in tune if all(normalize(t["title"]) != normalize(m["title"]) for m in matches)]
            return {"kind": "words", "heard": heard, "matches": combined}
        tune = self.search_melody(notes, clip)
        return {"kind": "melody" if tune or describe_melody(notes) else "none", "heard": None, "matches": tune}

    # ---- video ---------------------------------------------------------------------------

    def video(self, title: str, artist: str) -> Dict[str, Any]:
        """The song's video on YouTube (an embeddable id), found by a metadata-only search."""
        key = f"{normalize(title)}|{normalize(artist)}"
        cached = self._videos.get(key)
        if cached is not None:
            return cached
        import yt_dlp  # Imported here: only this lookup needs it.

        opts = {
            "quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True, "noplaylist": True,
            "socket_timeout": settings.LOOKUP_TIMEOUT, "allowed_extractors": ["youtube.*"],
        }
        query = f"ytsearch5:{artist} {clean_title(title)} official".strip()
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(query, download=False) or {}
        except Exception as exc:
            logger.info("songid video search failed: %s", exc)
            return {}  # Not cached: YouTube may only be busy.
        best, best_score = None, -1.0
        want = normalize(clean_title(title))
        for i, e in enumerate(info.get("entries") or []):
            vid = str(e.get("id") or "")
            name = normalize(e.get("title") or "")
            if not re.fullmatch(r"[\w-]{11}", vid) or "/shorts/" in str(e.get("url") or ""):
                continue
            score = 1.0 - i * 0.08
            score += 0.6 if want and want in name else 0.0
            score += 0.3 if normalize(artist).split(" ")[0] in name or normalize(artist) in normalize(e.get("channel") or "") else 0.0
            score += 0.25 if "official" in name else 0.0
            score -= 0.4 if any(w in name for w in ("cover", "karaoke", "reaction", "8d", "slowed", "reverb", "nightcore", "instrumental")) else 0.0
            dur = e.get("duration") or 0
            score -= 0.5 if dur and (dur < 60 or dur > 900) else 0.0
            if score > best_score:
                best, best_score = e, score
        if not best:
            self._videos.put(key, {})
            return {}
        found = {
            "id": best.get("id"),
            "title": best.get("title"),
            "channel": best.get("channel") or best.get("uploader"),
            "duration_seconds": int(best["duration"]) if best.get("duration") else None,
        }
        self._videos.put(key, found)
        return found


songid_service = SongIdService()
