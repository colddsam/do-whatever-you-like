"""
Font checker.

POST /fonts/inspect   — `file` (TTF, OTF, WOFF, WOFF2, TTC/OTC) + optional `index` (face in a collection)
                        → JSON report (names, metrics, features, axes, coverage, checks incl. the browsers'
                        sanitizer) and, for WOFF2/collections, the face as plain sfnt (base64) for drawing glyphs.
POST /fonts/document  — `file` (PDF, DOCX, PPTX, XLSX, ODF, EPUB, HTML, CSS, SVG) → fonts used, embedded or not,
                        and embedded font files recovered (base64).
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config.fonts import settings
from app.core.utils import cleanup_folder
from app.exceptions.fonts import InvalidFontsInputError
from app.services.fonts import fonts_service

router = APIRouter(prefix="/fonts", tags=["Fonts"])


async def _job(request: Request, file: UploadFile, entry: str, want: str, extra: dict):
    kind = fonts_service.kind(file.filename)
    if kind != want:
        raise InvalidFontsInputError("Add a font file here." if want == "font" else "Add a document here (PDF, Word, PowerPoint, Excel, EPUB, HTML…).")
    job_dir = settings.TEMP_DIR / f"fnt_{uuid.uuid4().hex}"
    try:
        name = Path(file.filename or "font").name
        src = job_dir / f"source{Path(name).suffix.lower()}"
        await run_in_threadpool(fonts_service.save_upload, file.file, src)
        result = await fonts_service.run(job_dir, entry, {"input": str(src.resolve()), "name": name, **extra}, request)
        result.pop("ok", None)
        return result
    finally:
        cleanup_folder(job_dir)
        await file.close()


@router.post("/inspect", summary="Everything about a font, and whether browsers accept it")
async def inspect(request: Request, file: UploadFile = File(...), index: int = Form(default=0, ge=0, le=255)):
    return await _job(request, file, "inspect", "font", {"index": index})


@router.post("/document", summary="Fonts a document uses, embedded or not, with the embedded files")
async def document(request: Request, file: UploadFile = File(...)):
    return await _job(request, file, "document", "document", {})
