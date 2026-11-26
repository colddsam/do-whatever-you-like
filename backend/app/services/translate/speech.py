"""
Read text aloud for the translator and interpreter: Edge's free neural voices first, then Google's
keyless TTS, then espeak-ng. Returns audio bytes; the only file written is a per-request temp file
for the fallbacks, removed straight away.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Tuple

from app.config.translate import settings
from app.exceptions.translate import InvalidTranslateInputError, TranslationError
from app.services.translate.dubber import _pick_edge_voice, _synthesize_espeak, _synthesize_gtts
from app.services.translate.languages import BY_CODE, normalize_code

logger = logging.getLogger(__name__)


async def _edge_bytes(text: str, voice: str, rate: int) -> bytes:
    import edge_tts

    out = bytearray()
    comm = edge_tts.Communicate(text, voice, rate=f"{rate:+d}%")
    async for part in comm.stream():
        if part.get("type") == "audio" and part.get("data"):
            out.extend(part["data"])
    return bytes(out)


def speak_sync(text: str, language: str, gender: str = "female", rate: int = 0) -> Tuple[bytes, str, str]:
    """Returns (audio bytes, mime type, engine)."""
    clean = " ".join((text or "").split())
    if not clean:
        raise InvalidTranslateInputError("There's nothing to read aloud.")
    clean = clean[: settings.SPEAK_MAX_CHARS]
    code = normalize_code(language)
    if code not in BY_CODE:
        raise InvalidTranslateInputError("Pick a supported language to read aloud.")
    gender = gender if gender in ("female", "male") else "female"
    rate = max(-50, min(100, int(rate)))

    voice = _pick_edge_voice(code, gender)
    if voice:
        try:
            data = asyncio.run(_edge_bytes(clean, voice, rate))
            if len(data) > 256:
                return data, "audio/mpeg", f"edge:{voice}"
        except Exception as exc:
            logger.debug("edge-tts speak failed (%s): %s", voice, exc)

    with tempfile.TemporaryDirectory(prefix="speak_") as tmp:
        mp3 = Path(tmp) / "speech.mp3"
        if _synthesize_gtts(clean, code, mp3):
            return mp3.read_bytes(), "audio/mpeg", "google"
        wav = Path(tmp) / "speech.wav"
        if _synthesize_espeak(clean, code, wav):
            return wav.read_bytes(), "audio/wav", "espeak"
    raise TranslationError("No voice is available for that language right now.")
