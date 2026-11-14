"""
Audio and video edits: trim (cut a part out, without re-encoding unless asked), sound (volume,
loudness normalising, mute) and denoise (learn the noise from a quiet moment and remove it, plus mains hum). worker.py runs each job in a child process of its own
(app/core/isolation.py), so a stuck FFmpeg can never hold up the server.
"""

import logging
from pathlib import Path
from typing import BinaryIO, Dict, Optional, Tuple

from fastapi import Request

from app.config.media import settings
from app.core.config import app_settings
from app.core.isolation import heavy_lane, light_lane, run_isolated
from app.exceptions.media import InvalidMediaInputError, MediaProcessingError, MediaUnavailableError

logger = logging.getLogger(__name__)

ERRORS = (InvalidMediaInputError, MediaProcessingError, MediaUnavailableError)
MODES = ("volume", "normalize", "mute")
STRENGTHS = ("light", "medium", "strong")
HUM = ("auto", "off", "50", "60")


class MediaService:
    CHUNK_SIZE = 1024 * 64

    def save_upload(self, file_obj: BinaryIO, name: Optional[str], job_dir: Path) -> Dict[str, str]:
        limit = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        clean = Path(name or "media").name[:180] or "media"
        dest = job_dir / "in" / clean
        dest.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        try:
            with open(dest, "wb") as out:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    size += len(chunk)
                    if size > limit:
                        raise InvalidMediaInputError(f"That file is over {app_settings.MAX_DOWNLOAD_SIZE_MB} MB.")
                    out.write(chunk)
        except InvalidMediaInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save upload: %s", exc)
            raise MediaProcessingError("Could not save the uploaded file.")
        if size == 0:
            raise InvalidMediaInputError("That file is empty.")
        return {"path": str(dest.resolve()), "name": clean}

    @staticmethod
    def validate_trim(start: float, end: float) -> None:
        if start < 0 or end <= start:
            raise InvalidMediaInputError("The end has to come after the start.")

    @staticmethod
    def validate_sound(mode: str, gain_db: float) -> None:
        if mode not in MODES:
            raise InvalidMediaInputError("Pick volume, normalize or mute.")
        if mode == "volume" and not -30 <= gain_db <= 30:
            raise InvalidMediaInputError("Volume changes go from -30 dB to +30 dB.")

    @staticmethod
    def validate_denoise(strength: str, hum: str, noise_start: Optional[float], noise_end: Optional[float]) -> None:
        if strength not in STRENGTHS:
            raise InvalidMediaInputError("Pick light, medium or strong.")
        if hum not in HUM:
            raise InvalidMediaInputError("Hum removal is auto, off, 50 or 60.")
        if (noise_start is None) != (noise_end is None):
            raise InvalidMediaInputError("Give both the start and the end of the noise-only part, or neither.")
        if noise_start is not None and (noise_start < 0 or noise_end <= noise_start):
            raise InvalidMediaInputError("The noise-only part has to end after it starts.")

    async def _run(self, job_dir: Path, entry: str, payload: dict, heavy: bool, request: Optional[Request]) -> Tuple[Path, dict]:
        result = await run_isolated(
            job_dir, entry, {**payload, "work": str((job_dir / "work").resolve())}, lane=heavy_lane if heavy else light_lane,
            timeout=settings.TIMEOUT_SECONDS, errors=ERRORS, request=request,
            busy="The media tools are busy with another file. Try again in a minute.",
            too_long="That took too long and was stopped. Try a shorter file.",
        )
        return Path(result["path"]), {k: v for k, v in result.items() if k != "path"}

    async def trim(self, job_dir: Path, saved: dict, start: float, end: float, exact: bool, request: Optional[Request]):
        return await self._run(job_dir, "app.services.media.worker:trim", {**saved, "start": start, "end": end, "exact": exact}, exact, request)

    async def sound(self, job_dir: Path, saved: dict, mode: str, gain_db: float, request: Optional[Request]):
        return await self._run(job_dir, "app.services.media.worker:sound", {**saved, "mode": mode, "gain_db": gain_db}, mode != "mute", request)


    async def denoise(self, job_dir: Path, saved: dict, opts: dict, request: Optional[Request]):
        return await self._run(job_dir, "app.services.media.worker:denoise", {**saved, **opts}, True, request)


media_service = MediaService()
