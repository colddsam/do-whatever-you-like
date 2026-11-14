"""
Speech to text with Whisper.

Two engines, picked by TRANSCRIBE_ENGINE:
- local: faster-whisper (CTranslate2) on this machine. Free and private; speed depends on the CPU.
- groq:  Groq's free Whisper large-v3 API. Much faster on small servers (Render's free plan has
         0.1 CPU), but the audio leaves this server, and the UI says so.

A job runs in its own spawned process: Whisper keeps every core busy for minutes and loads a model
of hundreds of MB, so it must not share a process with the web worker. The process reports what
it recognises through a queue, segment by segment, and is killed if the person leaves.
"""

import json
import logging
import multiprocessing
import os
import re
import shutil
import subprocess
import threading
import time
from importlib.util import find_spec
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional

from app.config.transcribe import settings
from app.exceptions.transcribe import InvalidAudioFileError, TranscriberUnavailableError, TranscriptionError
from app.services.ffmpeg_service import init_ffmpeg

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {
    # audio
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma", ".amr", ".aiff", ".aif", ".weba",
    # video (the sound track is used)
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".3gp", ".mpeg", ".mpg",
}

# Every language Whisper was trained on (faster_whisper.tokenizer._LANGUAGE_CODES).
WHISPER_LANGUAGES = tuple(
    "af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu ha haw he hi hr ht hu "
    "hy id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro "
    "ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo zh yue".split()
)

PROMPT_MAX_CHARS = 400
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def _binary(name: str) -> str:
    init_ffmpeg()  # static_ffmpeg puts ffmpeg and ffprobe on PATH
    return shutil.which(name) or name


def _run(cmd: List[str], timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _fmt_minutes(seconds: int) -> str:
    hours, minutes = divmod(seconds // 60, 60)
    return f"{hours} h {minutes:02d} min" if hours else f"{minutes} minutes"


class TranscribeService:
    CHUNK_SIZE = 1024 * 64

    # ---------- validation ----------

    @staticmethod
    def validate_filename(filename: Optional[str]) -> str:
        if not filename:
            raise InvalidAudioFileError("The file has no name.")
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise InvalidAudioFileError(
                f"{ext.lstrip('.').upper() or 'That'} files can't be transcribed. Use an audio or video file like MP3, WAV, M4A or MP4."
            )
        return ext

    @staticmethod
    def validate_language(code: Optional[str]) -> Optional[str]:
        """None means 'detect it'."""
        code = (code or "").strip().lower()
        if code in ("", "auto"):
            return None
        if code not in WHISPER_LANGUAGES:
            raise InvalidAudioFileError("Pick a language from the list, or let it be detected.")
        return code

    @staticmethod
    def clean_prompt(text: Optional[str]) -> str:
        """Names and terms the speaker uses. Whisper reads them as earlier context, which steers its spelling."""
        text = re.sub(r"\s+", " ", text or "").strip()
        if len(text) > PROMPT_MAX_CHARS:
            raise InvalidAudioFileError(f"Keep the expected words under {PROMPT_MAX_CHARS} characters.")
        return text

    def save_upload(self, file_obj: BinaryIO, destination: Path) -> Path:
        max_bytes = settings.MAX_FILE_MB * 1024 * 1024
        total = 0
        try:
            with open(destination, "wb") as out:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    total += len(chunk)
                    if total > max_bytes:
                        raise InvalidAudioFileError(f"That file is over {settings.MAX_FILE_MB} MB.")
                    out.write(chunk)
        except InvalidAudioFileError:
            raise
        except Exception as exc:
            logger.error("Saving the audio upload failed: %s", exc)
            raise TranscriptionError("We couldn't receive that file. Try again.")
        if total == 0:
            raise InvalidAudioFileError("That file is empty.")
        return destination

    def probe(self, path: Path) -> Optional[float]:
        """
        Checks the file has a sound track and isn't too long. Returns its length, or None when the
        container doesn't say (browser recordings in WebM often don't); the worker measures it then.
        """
        try:
            proc = _run(
                [_binary("ffprobe"), "-v", "error", "-select_streams", "a",
                 "-show_entries", "stream=codec_type:format=duration", "-of", "json", str(path)],
                timeout=60,
            )
            data = json.loads(proc.stdout or b"{}")
        except (subprocess.TimeoutExpired, ValueError, OSError) as exc:
            logger.error("ffprobe failed: %s", exc)
            raise InvalidAudioFileError("We couldn't read that file. Is it a working audio or video file?")
        if proc.returncode != 0 and not data:
            raise InvalidAudioFileError("We couldn't read that file. Is it a working audio or video file?")
        if not data.get("streams"):
            raise InvalidAudioFileError("That file has no sound in it.")
        try:
            duration = float(data.get("format", {}).get("duration"))
        except (TypeError, ValueError):
            return None
        self.check_duration(duration)
        return duration

    @staticmethod
    def check_duration(duration: float) -> None:
        if duration > settings.MAX_DURATION_SECONDS:
            raise InvalidAudioFileError(
                f"That recording is {_fmt_minutes(int(duration))} long. The limit is {_fmt_minutes(settings.MAX_DURATION_SECONDS)}."
            )

    # ---------- engines ----------

    @staticmethod
    def local_installed() -> bool:
        return find_spec("faster_whisper") is not None

    def engine(self) -> str:
        if settings.ENGINE == "groq":
            return "groq" if settings.GROQ_API_KEY else "none"
        if settings.ENGINE == "local":
            return "local" if self.local_installed() else "none"
        if settings.GROQ_API_KEY:
            return "groq"
        return "local" if self.local_installed() else "none"

    def capabilities(self) -> Dict[str, Any]:
        engine = self.engine()
        return {
            "available": engine != "none",
            "engine": engine,
            "model": settings.GROQ_MODEL if engine == "groq" else settings.MODEL,
            "private": engine != "groq",
            "languages": list(WHISPER_LANGUAGES),
            "extensions": sorted(ALLOWED_EXTENSIONS),
            "max_file_mb": settings.MAX_FILE_MB,
            "max_duration_seconds": settings.MAX_DURATION_SECONDS,
        }

    def start(self, source: Path, job_dir: Path, language: Optional[str], prompt: str, engine: str):
        """Starts the job's own process. Returns (process, queue); the queue ends with {"type": "_end"}."""
        if engine == "none":
            raise TranscriberUnavailableError()
        ctx = multiprocessing.get_context("spawn")
        events = ctx.Queue()
        proc = ctx.Process(
            target=run_job,
            args=(events, str(source), str(job_dir), language, prompt, engine),
            daemon=True,
            name="transcribe",
        )
        proc.start()
        return proc, events


transcribe_service = TranscribeService()


# ---------------------------------------------------------------------------------------------
# Everything below runs inside the job's process.
# ---------------------------------------------------------------------------------------------


def _exit_with_parent() -> None:
    """If the web worker dies (or is killed), don't leave Whisper running on its own."""
    parent = multiprocessing.parent_process()
    if parent is None:
        return

    def watch() -> None:
        while parent.is_alive():
            time.sleep(2)
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def run_job(events, source: str, job_dir: str, language: Optional[str], prompt: str, engine: str) -> None:
    _exit_with_parent()
    put = events.put
    try:
        put({"type": "status", "stage": "preparing"})
        pcm = Path(job_dir) / "speech.pcm"
        duration = _to_pcm(Path(source), pcm)
        if engine == "groq":
            _transcribe_groq(put, pcm, duration, language, prompt, Path(job_dir))
        else:
            _transcribe_local(put, pcm, duration, language, prompt)
    except (InvalidAudioFileError, TranscriptionError, TranscriberUnavailableError) as exc:
        put({"type": "error", "detail": exc.detail})
    except MemoryError:
        put({"type": "error", "detail": "The server ran out of memory. Try a shorter recording."})
    except Exception as exc:
        logger.exception("Transcription failed: %s", exc)
        put({"type": "error", "detail": "The audio couldn't be transcribed. Try again, or try another file."})
    finally:
        put({"type": "_end"})
        events.close()
        events.join_thread()


# Raw 16 kHz mono 16-bit samples: what Whisper listens to. Kept headerless, so its length is exact
# and it can be handed to Whisper as an array (faster-whisper's own decoder breaks on newer PyAV).
PCM_INPUT = ["-f", "s16le", "-ar", "16000", "-ac", "1"]
PCM_BYTES_PER_SECOND = 16000 * 2


def _to_pcm(source: Path, pcm: Path, *, keep_source: bool = False) -> float:
    """Decodes any audio or video to raw PCM. Also gives the true length (recordings may not state it)."""
    try:
        proc = _run(
            [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
             "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-f", "s16le", str(pcm)],
            timeout=30 * 60,
        )
    except subprocess.TimeoutExpired:
        raise TranscriptionError("Reading that file took too long. Try a shorter recording.")
    if proc.returncode != 0 or not pcm.is_file() or pcm.stat().st_size == 0:
        logger.error("ffmpeg could not decode %s: %s", source.name, proc.stderr[-400:])
        raise InvalidAudioFileError("We couldn't read the sound in that file. Is it a working audio or video file?")
    if not keep_source:
        try:
            source.unlink()  # The upload isn't needed any more; free the disk.
        except OSError:
            pass
    duration = pcm.stat().st_size / PCM_BYTES_PER_SECOND
    if duration < 0.3:
        raise InvalidAudioFileError("That recording is too short to transcribe.")
    TranscribeService.check_duration(duration)
    return duration


def _segment(put, index: int, start: float, end: float, text: str) -> None:
    put({"type": "segment", "id": index, "start": round(start, 2), "end": round(end, 2), "text": text})
    put({"type": "progress", "done": round(end, 2)})


def _transcribe_local(put, pcm: Path, duration: float, language: Optional[str], prompt: str) -> None:
    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except ImportError:
        raise TranscriberUnavailableError()

    put({"type": "status", "stage": "loading"})
    settings.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    try:
        model = WhisperModel(
            settings.MODEL,
            device="cpu",
            compute_type=settings.COMPUTE_TYPE,
            cpu_threads=settings.CPU_THREADS,
            download_root=str(settings.MODEL_DIR),
        )
    except Exception as exc:
        logger.error("Loading Whisper model %r failed: %s", settings.MODEL, exc)
        raise TranscriberUnavailableError("The speech model couldn't be loaded on this server.")

    put({"type": "status", "stage": "transcribing"})
    audio = np.fromfile(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    segments, info = model.transcribe(
        audio,
        language=language,
        beam_size=settings.BEAM_SIZE,
        # Voice activity detection skips silence and music, where Whisper otherwise invents text.
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        initial_prompt=prompt or None,
        condition_on_previous_text=True,
        # Judge the language from more than the first 30 s (intros are often music or silence).
        language_detection_segments=3,
    )
    put({
        "type": "info",
        "language": info.language,
        "language_probability": round(float(info.language_probability), 3) if not language else None,
        "duration": round(duration, 2),
        "engine": "local",
        "model": settings.MODEL,
    })
    index = 0
    for seg in segments:
        text = seg.text.strip()
        if text:
            _segment(put, index, seg.start, seg.end, text)
            index += 1
    put({"type": "progress", "done": round(duration, 2)})


# ---------- Groq ----------


def _silences(pcm: Path) -> List[float]:
    """Midpoints of the pauses, so chunks can be cut between words rather than through them."""
    try:
        proc = _run(
            [_binary("ffmpeg"), "-nostdin", "-hide_banner", *PCM_INPUT, "-i", str(pcm),
             "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"],
            timeout=10 * 60,
        )
    except subprocess.TimeoutExpired:
        return []
    text = proc.stderr.decode("utf-8", errors="ignore")
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", text)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", text)]
    return [(a + b) / 2 for a, b in zip(starts, ends)]


def _chunk_bounds(duration: float, size: int, pauses: List[float]) -> List[float]:
    bounds = [0.0]
    while duration - bounds[-1] > size:
        target = bounds[-1] + size
        # The latest pause in the last minute before the target, if any.
        near = [p for p in pauses if target - 60 <= p <= target]
        bounds.append(max(near) if near else target)
    bounds.append(duration)
    return bounds


def _groq_request(path: Path, language: Optional[str], prompt: str) -> Dict[str, Any]:
    import requests

    data = {"model": settings.GROQ_MODEL, "response_format": "verbose_json", "temperature": "0"}
    if language:
        data["language"] = language
    if prompt:
        data["prompt"] = prompt
    for attempt in range(4):
        with open(path, "rb") as fh:
            try:
                resp = requests.post(
                    GROQ_URL,
                    headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                    data=data,
                    files={"file": (path.name, fh, "audio/flac")},
                    timeout=settings.GROQ_TIMEOUT_SECONDS,
                )
            except requests.RequestException as exc:
                logger.error("Groq request failed: %s", exc)
                if attempt == 3:
                    raise TranscriptionError("The speech service couldn't be reached. Try again in a minute.")
                time.sleep(2 * (attempt + 1))
                continue
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in (401, 403):
            logger.error("Groq rejected the API key (%s).", resp.status_code)
            raise TranscriberUnavailableError("Speech to text isn't set up correctly on this server.")
        if resp.status_code == 429 or resp.status_code >= 500:
            wait = float(resp.headers.get("retry-after") or 0) or 5 * (attempt + 1)
            if attempt < 3 and wait <= 60:
                time.sleep(wait)
                continue
            raise TranscriptionError("The speech service is busy right now. Try again in a few minutes.")
        logger.error("Groq answered %s: %s", resp.status_code, resp.text[:400])
        raise TranscriptionError("The speech service couldn't read that audio.")
    raise TranscriptionError("The speech service is busy right now. Try again in a few minutes.")


def _transcribe_groq(put, pcm: Path, duration: float, language: Optional[str], prompt: str, job_dir: Path) -> None:
    put({"type": "status", "stage": "transcribing"})
    size = max(60, settings.GROQ_CHUNK_SECONDS)
    bounds = _chunk_bounds(duration, size, _silences(pcm) if duration > size else [])
    index = 0
    tail = ""
    sent_info = False
    for n in range(len(bounds) - 1):
        start, end = bounds[n], bounds[n + 1]
        part = job_dir / f"part{n}.flac"
        proc = _run(
            [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
             *PCM_INPUT, "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", str(pcm), "-c:a", "flac", str(part)],
            timeout=10 * 60,
        )
        if proc.returncode != 0 or not part.is_file():
            raise TranscriptionError("The audio couldn't be prepared. Try another file.")
        # Each chunk hears the end of the previous one as context, so sentences carry across the cut.
        result = _groq_request(part, language, " ".join(filter(None, [prompt, tail]))[-PROMPT_MAX_CHARS * 2:])
        part.unlink(missing_ok=True)
        if not sent_info:
            put({
                "type": "info",
                "language": language or str(result.get("language") or "").lower(),
                "language_probability": None,
                "duration": round(duration, 2),
                "engine": "groq",
                "model": settings.GROQ_MODEL,
            })
            sent_info = True
        for seg in result.get("segments") or []:
            text = str(seg.get("text") or "").strip()
            # Whisper's own rule for "nobody is speaking here": skip what it made up over silence.
            if not text or (float(seg.get("no_speech_prob") or 0) > 0.6 and float(seg.get("avg_logprob") or 0) < -1):
                continue
            seg_end = min(end, start + float(seg.get("end") or 0))
            _segment(put, index, start + float(seg.get("start") or 0), seg_end, text)
            index += 1
            tail = text
        put({"type": "progress", "done": round(end, 2)})
