"""
Font checker: everything about a font file (inspect.py, fontTools + OTS) and the fonts inside
documents (documents.py). Jobs run in a child process of their own, in the light lane.
"""

import logging
from pathlib import Path
from typing import BinaryIO, Optional

from fastapi import Request

from app.config.fonts import settings
from app.core.isolation import light_lane, run_isolated
from app.exceptions.fonts import FontsProcessingError, FontsUnavailableError, InvalidFontsInputError

logger = logging.getLogger(__name__)

ERRORS = (InvalidFontsInputError, FontsProcessingError, FontsUnavailableError)
FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2", ".ttc", ".otc"}
DOC_EXTS = {".pdf", ".docx", ".docm", ".dotx", ".pptx", ".ppsx", ".pptm", ".xlsx", ".xlsm", ".odt", ".ods", ".odp", ".odg", ".epub", ".html", ".htm", ".xhtml", ".css", ".svg"}


class FontsService:
    CHUNK_SIZE = 1024 * 64

    @staticmethod
    def kind(filename: Optional[str]) -> str:
        ext = Path(filename or "").suffix.lower()
        if ext in FONT_EXTS:
            return "font"
        if ext in DOC_EXTS:
            return "document"
        raise InvalidFontsInputError("Add a font (TTF, OTF, WOFF, WOFF2, TTC) or a document (PDF, Word, PowerPoint, Excel, EPUB, HTML…).")

    def save_upload(self, file_obj: BinaryIO, dest: Path) -> None:
        limit = settings.MAX_MB * 1024 * 1024 if dest.suffix.lower() in FONT_EXTS else 150 * 1024 * 1024
        total = 0
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(dest, "wb") as out:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    total += len(chunk)
                    if total > limit:
                        raise InvalidFontsInputError(f"That file is over {limit // (1024 * 1024)} MB.")
                    out.write(chunk)
        except InvalidFontsInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save upload: %s", exc)
            raise FontsProcessingError("Could not save the uploaded file.")
        if total == 0:
            raise InvalidFontsInputError("That file is empty.")

    async def run(self, job_dir: Path, entry: str, payload: dict, request: Optional[Request]) -> dict:
        payload = {**payload, "work": str((job_dir / "work").resolve())}
        (job_dir / "work").mkdir(parents=True, exist_ok=True)
        return await run_isolated(
            job_dir, f"app.services.fonts.worker:{entry}", payload, lane=light_lane, timeout=settings.TIMEOUT_SECONDS,
            errors=ERRORS, request=request, too_long="That file took too long to read. Try a smaller one.",
        )


fonts_service = FontsService()
