"""
Facade for text, batch/subtitle, and audio/video translation.
Keeps heavy Whisper + TTS + FFmpeg media dubbing in an isolated child process and manages a
TTL- and size-bounded result cache so translated audio/video files download cleanly without
consuming ephemeral Render disk.
"""

from __future__ import annotations

import json
import logging
import multiprocessing
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional, Tuple

from app.config.translate import settings
from app.exceptions.translate import (
    InvalidTranslateInputError,
    TranslationError,
    TranslationResultExpiredError,
    TranslatorUnavailableError,
)
from app.services import transcribe as stt
from app.services.translate.dubber import AUDIO_EXT_SET, run_media_job
from app.services.translate.languages import BY_CODE, language_name, normalize_code, serialize_languages
from app.services.translate.providers import (
    translate_batch_sync,
    translate_subtitles_text_sync,
    translate_text_sync,
    validate_pair,
)
from app.services.universal.graph import ffmpeg_path

logger = logging.getLogger(__name__)

TOKEN_RE = re.compile(r"^[a-f0-9]{32}$")
CACHE_DIR = settings.TEMP_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


class TranslateService:
    CHUNK_SIZE = 1024 * 64

    @staticmethod
    def speech_engine() -> str:
        return stt.transcribe_service.engine()

    @staticmethod
    def tts_available() -> bool:
        try:
            import edge_tts  # noqa: F401
            return True
        except ImportError:
            return True  # Google TTS over HTTPS / espeak-ng remain available

    def capabilities(self) -> Dict[str, Any]:
        sp_engine = self.speech_engine()
        return {
            "available": True,
            "speech_available": sp_engine != "none" and ffmpeg_path() is not None,
            "speech_engine": sp_engine,
            "tts_available": self.tts_available(),
            "languages": serialize_languages(),
            "extensions": sorted(stt.ALLOWED_EXTENSIONS),
            "max_file_mb": settings.MAX_FILE_MB,
            "max_audio_seconds": settings.AUDIO_MAX_SECONDS,
            "max_video_seconds": settings.VIDEO_MAX_SECONDS,
            "max_text_chars": settings.MAX_TEXT_CHARS,
        }

    # ---------- Text & Batch ----------

    def translate_text(self, text: str, source: str, target: str, mode: str = "text") -> Dict[str, Any]:
        cleaned = (text or "").strip("\r\n")
        if not cleaned.strip():
            raise InvalidTranslateInputError("Enter or paste some text to translate.")
        if len(cleaned) > settings.MAX_TEXT_CHARS:
            raise InvalidTranslateInputError(f"Keep text under {settings.MAX_TEXT_CHARS:,} characters per request.")
        src, dst = validate_pair(source, target)
        if mode == "subtitles":
            out, detected, provider = translate_subtitles_text_sync(cleaned, src, dst)
        else:
            out, detected, provider = translate_text_sync(cleaned, src, dst)
        return {
            "source_text": cleaned,
            "translated_text": out,
            "detected_language": detected,
            "detected_language_name": language_name(detected),
            "target_language": dst,
            "target_language_name": language_name(dst),
            "provider": provider,
            "chars": len(cleaned),
            "mode": mode,
        }

    def translate_batch(self, texts: List[str], source: str, target: str) -> Dict[str, Any]:
        if not texts:
            raise InvalidTranslateInputError("Send at least one line to translate.")
        if len(texts) > settings.MAX_BATCH_ITEMS:
            raise InvalidTranslateInputError(f"Translate up to {settings.MAX_BATCH_ITEMS} lines at once.")
        total_chars = sum(len(t or "") for t in texts)
        if total_chars > settings.MAX_BATCH_CHARS:
            raise InvalidTranslateInputError("That transcript is too large for a single batch. Split it into smaller parts.")
        src, dst = validate_pair(source, target)
        translated, detected, provider = translate_batch_sync(texts, src, dst)
        return {
            "source_texts": texts,
            "translated_texts": translated,
            "detected_language": detected,
            "detected_language_name": language_name(detected),
            "target_language": dst,
            "target_language_name": language_name(dst),
            "provider": provider,
        }

    # ---------- Media validation & upload ----------

    def validate_media_upload(self, filename: Optional[str], source: str, target: str, gender: str, timing: str) -> Tuple[str, str, str]:
        ext = stt.transcribe_service.validate_filename(filename)
        src = normalize_code(source)
        if src != "auto" and (src not in BY_CODE or not BY_CODE[src].speech_input):
            if src not in BY_CODE:
                raise InvalidTranslateInputError("Pick a supported spoken language, or choose Auto-detect.")
        dst = normalize_code(target)
        if dst == "auto" or dst not in BY_CODE:
            raise InvalidTranslateInputError("Pick a target language.")
        if not BY_CODE[dst].tts_supported:
            raise InvalidTranslateInputError(f"Spoken voice dubbing isn't available for {language_name(dst)} yet. Pick another voice language, or use Text mode.")
        if gender not in ("female", "male"):
            raise InvalidTranslateInputError("Voice style must be female or male.")
        if timing not in ("timed", "fluent"):
            raise InvalidTranslateInputError("Timing must be synced ('timed') or smooth ('fluent').")
        return ext, src, dst

    def save_upload(self, file_obj: BinaryIO, destination: Path) -> Path:
        max_bytes = settings.MAX_FILE_MB * 1024 * 1024
        total = 0
        try:
            with open(destination, "wb") as out:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    total += len(chunk)
                    if total > max_bytes:
                        raise InvalidTranslateInputError(f"That file is over {settings.MAX_FILE_MB} MB.")
                    out.write(chunk)
        except InvalidTranslateInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save translate upload: %s", exc)
            raise TranslationError("We couldn't receive that file. Try again.")
        if total == 0:
            raise InvalidTranslateInputError("That file is empty.")
        return destination

    def probe_upload(self, path: Path) -> None:
        ext = path.suffix.lower()
        dur = stt.transcribe_service.probe(path)
        if dur is None:
            return
        max_sec = settings.AUDIO_MAX_SECONDS if ext in AUDIO_EXT_SET else settings.VIDEO_MAX_SECONDS
        if dur > max_sec:
            mins = max_sec // 60
            kind = "audio" if ext in AUDIO_EXT_SET else "video"
            raise InvalidTranslateInputError(f"That {kind} is over {mins} minutes. Keep {kind} translations up to {mins} minutes.")

    def start_media(
        self,
        source: Path,
        original_name: str,
        job_dir: Path,
        source_lang: str,
        target_lang: str,
        voice_gender: str,
        timing: str,
        keep_background: bool,
        include_subtitles: bool,
        speech_engine: str,
    ):
        if speech_engine == "none":
            raise TranslatorUnavailableError("Speech recognition isn't set up on this server yet.")
        if ffmpeg_path() is None:
            raise TranslatorUnavailableError("FFmpeg isn't installed on this server yet.")

        self.purge_stale()
        token = uuid.uuid4().hex
        result_base = CACHE_DIR / token / "dubbed"
        result_base.parent.mkdir(parents=True, exist_ok=True)

        ctx = multiprocessing.get_context("spawn")
        events = ctx.Queue()
        payload = {
            "source": str(source),
            "stem": Path(original_name or "media").name,
            "job_dir": str(job_dir),
            "result_path": str(result_base),
            "source_lang": source_lang,
            "target_lang": target_lang,
            "voice_gender": voice_gender,
            "timing": timing,
            "keep_background": keep_background,
            "include_subtitles": include_subtitles,
            "speech_engine": speech_engine,
            "max_audio_seconds": settings.AUDIO_MAX_SECONDS,
            "max_video_seconds": settings.VIDEO_MAX_SECONDS,
        }
        proc = ctx.Process(target=run_media_job, args=(events, payload), daemon=True, name="translate-media")
        proc.start()
        return proc, events, token

    # ---------- Result Cache ----------

    def finalize_result(self, token: str, info: Dict[str, Any]) -> Dict[str, Any]:
        result_path = Path(info["result_file"])
        meta_path = CACHE_DIR / token / "meta.json"
        meta = {
            "path": str(result_path),
            "name": info["result_name"],
            "type": info["result_type"],
            "size": int(info["result_size"]),
            "created": time.time(),
        }
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
        self._enforce_cache_budget()
        return meta

    def discard_result(self, token: str) -> None:
        if TOKEN_RE.match(token or ""):
            shutil.rmtree(CACHE_DIR / token, ignore_errors=True)

    def resolve_result(self, token: str) -> Tuple[Path, Dict[str, Any]]:
        self.purge_stale()
        if not TOKEN_RE.match(token or ""):
            raise InvalidTranslateInputError("Invalid download token.")
        meta_path = CACHE_DIR / token / "meta.json"
        if not meta_path.is_file():
            raise TranslationResultExpiredError()
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            file_path = Path(meta["path"])
        except (ValueError, KeyError, OSError):
            raise TranslationResultExpiredError()
        if not file_path.is_file():
            raise TranslationResultExpiredError()
        return file_path, meta

    def purge_stale(self) -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - settings.RESULT_TTL_SECONDS
        for entry in list(CACHE_DIR.iterdir()):
            if not entry.is_dir():
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry, ignore_errors=True)
            except OSError:
                pass

    def _enforce_cache_budget(self) -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        items = []
        total = 0
        for entry in CACHE_DIR.iterdir():
            if not entry.is_dir():
                continue
            try:
                size = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
                total += size
                items.append((entry.stat().st_mtime, size, entry))
            except OSError:
                pass
        if total <= settings.MAX_CACHE_BYTES:
            return
        items.sort(key=lambda x: x[0])
        for _, size, entry in items:
            if total <= settings.MAX_CACHE_BYTES:
                break
            shutil.rmtree(entry, ignore_errors=True)
            total -= size


translate_service = TranslateService()
