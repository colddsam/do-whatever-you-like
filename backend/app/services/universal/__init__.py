"""
The universal converter: any supported file → any format it can sensibly become.

- formats.py — every format, by id and extension
- graph.py — the engines as edges, and the planner that picks a route of up to three steps
- engines/ — the conversions themselves (LibreOffice, Pandoc, FFmpeg, Pillow, PyMuPDF, fontTools…)
- worker.py — runs one job's route; app/core/isolation.py runs it in a child process of its own

The web process only plans, saves the upload and waits: the work happens in a child process that is
killed (with everything it started) on timeout or cancel, so one bad file can't hurt anything else.
"""

import json
import logging
from pathlib import Path
from typing import BinaryIO, List, Optional, Tuple

from fastapi import Request
from pydantic import ValidationError

from app.config.universal import settings
from app.core.config import app_settings
from app.core.isolation import heavy_lane, run_isolated
from app.exceptions.universal import InvalidUniversalInputError, UniversalConversionError, UniversalUnavailableError
from app.schemas.universal import ConvertOptions
from app.services.universal.engines.common import safe_stem
from app.services.universal.formats import FORMATS, detect_format, stem_of
from app.services.universal.graph import Step, capabilities, catalogue, plan_all

logger = logging.getLogger(__name__)

ERRORS = (InvalidUniversalInputError, UniversalConversionError, UniversalUnavailableError)


class UniversalService:
    CHUNK_SIZE = 1024 * 64

    def __init__(self) -> None:
        self._catalogue: Optional[dict] = None

    # ---------- planning ----------

    def formats(self) -> dict:
        """Formats and every route this server can run. Built once (it probes the installed programs)."""
        if self._catalogue is None:
            self._catalogue = {**catalogue(), "max_mb": app_settings.MAX_DOWNLOAD_SIZE_MB}
        return self._catalogue

    @staticmethod
    def resolve(filename: Optional[str], target: str, source: Optional[str] = None) -> Tuple[str, List[Step]]:
        """What the file is, and how to make `target` from it. Raises a 400 with the reason if it can't be done."""
        fmt = source or detect_format(filename)
        if source and source not in FORMATS:
            raise InvalidUniversalInputError("Unknown source format.")
        if not fmt:
            ext = Path(filename or "").suffix.lower()
            raise InvalidUniversalInputError(
                f"We don't know {ext.upper()[1:] + ' ' if ext else 'this kind of '}files yet. Pick what the file is, or request the format."
            )
        if target not in FORMATS:
            raise InvalidUniversalInputError("Unknown target format.")
        if target == fmt:
            raise InvalidUniversalInputError(f"That file is already {FORMATS[fmt].label}.")
        routes = plan_all(fmt, capabilities())
        steps = routes.get(target)
        if not steps:
            raise InvalidUniversalInputError(f"{FORMATS[fmt].label} files can't be turned into {FORMATS[target].label} here.")
        return fmt, steps

    @staticmethod
    def parse_options(raw: Optional[str]) -> dict:
        """Optional fine-tuning for the last step (DPI, pages, sheet layout…). Unknown keys are refused."""
        if not raw:
            return {}
        try:
            return ConvertOptions.model_validate(json.loads(raw)).model_dump(exclude_none=True)
        except (ValueError, ValidationError):
            raise InvalidUniversalInputError("Those conversion options aren't valid.")

    # ---------- upload ----------

    def save_upload(self, file_obj: BinaryIO, destination: Path) -> int:
        limit = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        total = 0
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(destination, "wb") as buffer:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    total += len(chunk)
                    if total > limit:
                        raise InvalidUniversalInputError(f"That file is over {app_settings.MAX_DOWNLOAD_SIZE_MB} MB.")
                    buffer.write(chunk)
        except InvalidUniversalInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save upload: %s", exc)
            raise UniversalConversionError("Could not save the uploaded file.")
        if total == 0:
            raise InvalidUniversalInputError("That file is empty.")
        return total

    # ---------- running ----------

    async def convert(
        self,
        job_dir: Path,
        input_path: Path,
        filename: str,
        source: str,
        steps: List[Step],
        request: Optional[Request] = None,
        options: Optional[dict] = None,
    ) -> Tuple[Path, dict]:
        """Runs the route in a worker process. Returns the result file and what to tell the person."""
        payload = {
            "input": str(input_path.resolve()),
            "source": source,
            "stem": safe_stem(stem_of(filename, source)),
            "steps": [{"source": s.source, "target": s.target, "engine": s.engine} for s in steps],
            "work": str((job_dir / "work").resolve()),
            "options": options or {},
        }
        result = await run_isolated(
            job_dir,
            "app.services.universal.worker:execute",
            payload,
            lane=heavy_lane,
            timeout=settings.TIMEOUT_SECONDS,
            errors=ERRORS,
            request=request,
            busy="The converter is busy with other files. Try again in a minute.",
            too_long="That conversion took too long and was stopped. Try a smaller file.",
        )
        out = Path(result["path"])
        if not out.is_file():
            raise UniversalConversionError("The converted file went missing. Try again.")
        info = {
            "source": source,
            "target": steps[-1].target,
            "steps": [s.as_dict() for s in steps],
            "bundle": out.suffix == ".zip" and not steps[-1].target == "zip",
            "notes": result.get("notes") or [],
        }
        return out, info


universal_service = UniversalService()
