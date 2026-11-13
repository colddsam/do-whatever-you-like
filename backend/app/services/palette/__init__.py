"""
Colour picker backend: pictures and declared colours of files the browser can't read itself
(engine.py). Jobs run in a child process of their own, in the heavy lane (LibreOffice, FFmpeg).
"""

import logging
from pathlib import Path
from typing import BinaryIO, Optional

from fastapi import Request

from app.config.palette import settings
from app.core.config import app_settings
from app.core.isolation import heavy_lane, run_isolated
from app.exceptions.palette import InvalidPaletteInputError, PaletteProcessingError, PaletteUnavailableError

logger = logging.getLogger(__name__)
ERRORS = (InvalidPaletteInputError, PaletteProcessingError, PaletteUnavailableError)


class PaletteService:
    CHUNK_SIZE = 1024 * 64

    def save_upload(self, file_obj: BinaryIO, dest: Path) -> None:
        limit = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        total = 0
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(dest, "wb") as out:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    total += len(chunk)
                    if total > limit:
                        raise InvalidPaletteInputError(f"That file is over {app_settings.MAX_DOWNLOAD_SIZE_MB} MB.")
                    out.write(chunk)
        except InvalidPaletteInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save upload: %s", exc)
            raise PaletteProcessingError("Could not save the uploaded file.")
        if total == 0:
            raise InvalidPaletteInputError("That file is empty.")

    async def extract(self, job_dir: Path, src: Path, name: str, request: Optional[Request]) -> dict:
        payload = {"input": str(src.resolve()), "name": name, "work": str((job_dir / "work").resolve())}
        result = await run_isolated(
            job_dir, "app.services.palette.engine:extract", payload, lane=heavy_lane, timeout=settings.TIMEOUT_SECONDS,
            errors=ERRORS, request=request, too_long="That file took too long to open. Try a smaller one.",
        )
        result.pop("ok", None)
        return result


palette_service = PaletteService()
