"""
Merge and split for every format where it makes sense: PDF, Word, PowerPoint, Excel/CSV, audio and video.

- common.py — families, part choosing and naming
- pdf.py, word.py, slides.py, sheets.py, media.py — one engine per family
- worker.py — the entry points; app/core/isolation.py runs each job in a child process of its own
"""

import json
import logging
from pathlib import Path
from typing import BinaryIO, List, Optional, Tuple

from fastapi import Request
from pydantic import ValidationError

from app.config.merge_split import settings
from app.core.config import app_settings
from app.core.isolation import heavy_lane, run_isolated
from app.exceptions.merge_split import InvalidMergeSplitInputError, MergeSplitProcessingError, MergeSplitUnavailableError
from app.schemas.merge_split import MergeOptions, SplitPlan
from app.services.merge_split.common import FAMILIES, NOUNS, family_of

logger = logging.getLogger(__name__)

ERRORS = (InvalidMergeSplitInputError, MergeSplitProcessingError, MergeSplitUnavailableError)
ENTRY = "app.services.merge_split.worker:"
INSPECT_TIMEOUT = 180


class MergeSplitService:
    CHUNK_SIZE = 1024 * 64

    @staticmethod
    def family(filename: Optional[str]) -> str:
        fam = family_of(filename)
        if not fam:
            ext = Path(filename or "").suffix.upper()[1:] or "That kind of"
            raise InvalidMergeSplitInputError(
                f"{ext} files can't be merged or split. Use PDF, Word, PowerPoint, Excel, CSV, audio or video files."
            )
        return fam

    def merge_family(self, filenames: List[Optional[str]]) -> str:
        if len(filenames) < 2:
            raise InvalidMergeSplitInputError("Add at least two files to merge.")
        if len(filenames) > settings.MAX_FILES:
            raise InvalidMergeSplitInputError(f"Merge up to {settings.MAX_FILES} files at a time.")
        families = {self.family(n) for n in filenames}
        if len(families) > 1:
            raise InvalidMergeSplitInputError("Those files are of different kinds. Merge PDFs with PDFs, Word with Word, and so on.")
        return families.pop()

    @staticmethod
    def parse(raw: Optional[str], model):
        try:
            return model.model_validate(json.loads(raw or "{}")).model_dump(exclude_none=True)
        except (ValueError, ValidationError):
            raise InvalidMergeSplitInputError("Those options aren't valid.")

    @staticmethod
    def merged_ext(family: str, names: List[str], options: dict) -> str:
        first = Path(names[0]).suffix.lower().lstrip(".")
        if family == "pdf":
            return "pdf"
        if family == "word":
            return "docx"
        if family == "slides":
            return "pptx"
        if family == "sheet":
            return "csv" if options.get("mode") == "stack" and options.get("output") == "csv" else "xlsx"
        if family == "audio":
            out = options.get("output")
            if out in ("mp3", "m4a", "wav", "flac", "ogg", "opus"):
                return out
            return first if first in ("mp3", "m4a", "wav", "flac", "ogg", "opus") else "mp3"
        return "mkv" if first == "mkv" else "mp4"

    def save_uploads(self, files: List[Tuple[BinaryIO, str]], job_dir: Path) -> List[dict]:
        """Saves each upload as in<i><ext>; the total is capped by MAX_DOWNLOAD_SIZE_MB."""
        limit = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        total = 0
        saved = []
        job_dir.mkdir(parents=True, exist_ok=True)
        for i, (file_obj, name) in enumerate(files):
            # Kept under its own name (in a folder per file), so messages name the file the person sent.
            clean = "".join(ch for ch in Path(name).name if ch not in '\\/:*?"<>|' and ord(ch) >= 32)[-150:].strip(" .") or f"file{i}"
            dest = job_dir / "in" / str(i) / clean
            dest.parent.mkdir(parents=True, exist_ok=True)
            size = 0
            try:
                with open(dest, "wb") as out:
                    while chunk := file_obj.read(self.CHUNK_SIZE):
                        size += len(chunk)
                        total += len(chunk)
                        if total > limit:
                            raise InvalidMergeSplitInputError(f"Together the files are over {app_settings.MAX_DOWNLOAD_SIZE_MB} MB.")
                        out.write(chunk)
            except InvalidMergeSplitInputError:
                raise
            except Exception as exc:
                logger.error("Failed to save upload: %s", exc)
                raise MergeSplitProcessingError("Could not save the uploaded files.")
            if size == 0:
                raise InvalidMergeSplitInputError(f"'{Path(name).name}' is empty.")
            saved.append({"path": str(dest.resolve()), "name": Path(name).name})
        return saved

    async def _run(self, job_dir: Path, entry: str, payload: dict, request: Optional[Request], timeout: int) -> dict:
        return await run_isolated(
            job_dir, ENTRY + entry, payload, lane=heavy_lane, timeout=timeout, errors=ERRORS, request=request,
            busy="The server is busy with other files. Try again in a minute.",
            too_long="That took too long and was stopped. Try smaller files.",
        )

    async def inspect(self, job_dir: Path, saved: dict, family: str, request: Optional[Request]) -> dict:
        payload = {"input": saved["path"], "name": saved["name"], "family": family, "work": str((job_dir / "work").resolve())}
        result = await self._run(job_dir, "inspect", payload, request, INSPECT_TIMEOUT)
        return result["info"]

    async def split(self, job_dir: Path, saved: dict, family: str, plan: dict, request: Optional[Request]) -> Tuple[Path, dict]:
        payload = {"input": saved["path"], "name": saved["name"], "family": family, "plan": plan, "work": str((job_dir / "work").resolve())}
        result = await self._run(job_dir, "split", payload, request, settings.TIMEOUT_SECONDS)
        return Path(result["path"]), {"family": family, "parts": result.get("parts"), "notes": result.get("notes") or []}

    async def merge(self, job_dir: Path, saved: List[dict], family: str, options: dict, request: Optional[Request]) -> Tuple[Path, dict]:
        ext = self.merged_ext(family, [s["name"] for s in saved], options)
        payload = {"inputs": saved, "family": family, "options": options, "ext": ext, "work": str((job_dir / "work").resolve())}
        result = await self._run(job_dir, "merge", payload, request, settings.TIMEOUT_SECONDS)
        return Path(result["path"]), {"family": family, "parts": result.get("parts"), "notes": result.get("notes") or []}


merge_split_service = MergeSplitService()

__all__ = ["merge_split_service", "FAMILIES", "NOUNS", "MergeOptions", "SplitPlan"]
