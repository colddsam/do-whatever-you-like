"""
Icon maker: one picture → icons for websites, Windows, macOS, iOS, Android and desktop apps.
engine.py draws them; it runs in a child process of its own (app/core/isolation.py), in the light
lane, so a quick icon job never waits behind a long video.
"""

import json
import logging
from pathlib import Path
from typing import BinaryIO, Optional, Tuple

from fastapi import Request
from pydantic import ValidationError

from app.config.icon import settings
from app.core.config import app_settings
from app.core.isolation import light_lane, run_isolated
from app.exceptions.icon import IconProcessingError, IconUnavailableError, InvalidIconInputError
from app.schemas.icon import IconOptions

logger = logging.getLogger(__name__)

ERRORS = (InvalidIconInputError, IconProcessingError, IconUnavailableError)
PICTURES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg", ".heic", ".heif", ".avif", ".psd", ".ico"}


class IconService:
    CHUNK_SIZE = 1024 * 64

    @staticmethod
    def validate(filename: Optional[str]) -> None:
        if Path(filename or "").suffix.lower() not in PICTURES:
            raise InvalidIconInputError("Use a picture: PNG, SVG, JPG, WebP, HEIC, GIF, BMP, TIFF, AVIF, PSD or ICO.")

    @staticmethod
    def parse(raw: Optional[str]) -> dict:
        try:
            return IconOptions.model_validate(json.loads(raw or "{}")).model_dump()
        except (ValueError, ValidationError):
            raise InvalidIconInputError("Those icon options aren't valid.")

    def save_upload(self, file_obj: BinaryIO, dest: Path) -> None:
        limit = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        total = 0
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(dest, "wb") as out:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    total += len(chunk)
                    if total > limit:
                        raise InvalidIconInputError(f"That picture is over {app_settings.MAX_DOWNLOAD_SIZE_MB} MB.")
                    out.write(chunk)
        except InvalidIconInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save upload: %s", exc)
            raise IconProcessingError("Could not save the uploaded picture.")
        if total == 0:
            raise InvalidIconInputError("That picture is empty.")

    async def make(self, job_dir: Path, src: Path, name: str, options: dict, request: Optional[Request]) -> Tuple[Path, dict]:
        payload = {"input": str(src.resolve()), "name": name, "options": options, "work": str((job_dir / "work").resolve())}
        result = await run_isolated(
            job_dir, "app.services.icon.engine:make", payload, lane=light_lane, timeout=settings.TIMEOUT_SECONDS,
            errors=ERRORS, request=request, too_long="That picture took too long to draw. Try a smaller one.",
        )
        return Path(result["path"]), {"notes": result.get("notes") or [], "files": result.get("files")}


icon_service = IconService()
