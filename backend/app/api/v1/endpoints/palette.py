"""
Colour picker.

POST /palette/extract — `file` (PDF, Office, image formats browsers can't open, video, SVG, HTML, CSS, EPUB…)
→ JSON: `pages` (PNG pictures, base64, for the eyedropper), `declared` (exact colours the file declares,
with how often), `theme` (Office theme colours in order), `notes`.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config.palette import settings
from app.core.utils import cleanup_folder
from app.services.palette import palette_service

router = APIRouter(prefix="/palette", tags=["Colour picker"])


@router.post("/extract", summary="Pictures and exact colours of any file, for picking colours")
async def extract(request: Request, file: UploadFile = File(...)):
    job_dir = settings.TEMP_DIR / f"pal_{uuid.uuid4().hex}"
    try:
        name = Path(file.filename or "file").name
        src = job_dir / f"source{Path(name).suffix.lower()}"
        await run_in_threadpool(palette_service.save_upload, file.file, src)
        return await palette_service.extract(job_dir, src, name, request)
    finally:
        cleanup_folder(job_dir)
        await file.close()
