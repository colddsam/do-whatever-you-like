"""
Compress anything: PDFs, pictures, Office files, EPUBs, audio, video, fonts, archives, JSON — and
anything else into a ZIP. engines.py holds one compressor per kind of file; worker.py runs a job
in a child process of its own (app/core/isolation.py).
"""

import logging
from pathlib import Path
from typing import BinaryIO, List, Optional, Tuple

from fastapi import Request

from app.config.compress import settings
from app.core.config import app_settings
from app.core.isolation import heavy_lane, run_isolated
from app.exceptions.compress import CompressProcessingError, CompressUnavailableError, InvalidCompressInputError

logger = logging.getLogger(__name__)

ERRORS = (InvalidCompressInputError, CompressProcessingError, CompressUnavailableError)
LEVELS = ("light", "recommended", "strong")


class CompressService:
    CHUNK_SIZE = 1024 * 64

    @staticmethod
    def validate(names: List[Optional[str]], level: str) -> None:
        if level not in LEVELS:
            raise InvalidCompressInputError("Pick Light, Recommended or Strong.")
        if not names:
            raise InvalidCompressInputError("Add a file to compress.")
        if len(names) > settings.MAX_FILES:
            raise InvalidCompressInputError(f"Compress up to {settings.MAX_FILES} files at a time.")

    def save_uploads(self, files: List[Tuple[BinaryIO, str]], job_dir: Path) -> List[dict]:
        limit = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        total = 0
        saved = []
        job_dir.mkdir(parents=True, exist_ok=True)
        for i, (file_obj, name) in enumerate(files):
            clean = Path(name or f"file{i}").name[:180] or f"file{i}"
            dest = job_dir / "in" / f"{i}" / clean
            dest.parent.mkdir(parents=True, exist_ok=True)
            size = 0
            try:
                with open(dest, "wb") as out:
                    while chunk := file_obj.read(self.CHUNK_SIZE):
                        size += len(chunk)
                        total += len(chunk)
                        if total > limit:
                            raise InvalidCompressInputError(f"Together the files are over {app_settings.MAX_DOWNLOAD_SIZE_MB} MB.")
                        out.write(chunk)
            except InvalidCompressInputError:
                raise
            except Exception as exc:
                logger.error("Failed to save upload: %s", exc)
                raise CompressProcessingError("Could not save the uploaded files.")
            if size == 0:
                raise InvalidCompressInputError(f"'{clean}' is empty.")
            saved.append({"path": str(dest.resolve()), "name": clean})
        return saved

    async def compress(self, job_dir: Path, saved: List[dict], level: str, request: Optional[Request]) -> Tuple[Path, dict]:
        payload = {"inputs": saved, "level": level, "work": str((job_dir / "work").resolve())}
        result = await run_isolated(
            job_dir, "app.services.compress.worker:compress", payload, lane=heavy_lane, timeout=settings.TIMEOUT_SECONDS,
            errors=ERRORS, request=request, busy="The compressor is busy with other files. Try again in a minute.",
            too_long="That took too long and was stopped. Try fewer or smaller files.",
        )
        files = result.get("files") or []
        before = sum(f["before"] for f in files if "after" in f)
        after = sum(f["after"] for f in files if "after" in f)
        return Path(result["path"]), {"level": level, "files": files, "before": before, "after": after}


compress_service = CompressService()
