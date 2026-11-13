"""
Icon maker.

POST /icon — `file` (a picture) + `options` (JSON, see IconOptions) → a ZIP of icon packs
(web, Windows, macOS, iOS, Android, desktop), or a single .ico file.
"""

import json
import mimetypes
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.icon import settings
from app.core.utils import cleanup_folder
from app.services.icon import icon_service

router = APIRouter(prefix="/icon", tags=["Icon maker"])


@router.post("", response_class=FileResponse, summary="Icons for websites, Windows, macOS, iOS, Android and desktop apps")
async def make_icons(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    options: Optional[str] = Form(default=None, max_length=1000, description="JSON: packs, shape, padding, background (see IconOptions)"),
):
    icon_service.validate(file.filename)
    parsed = icon_service.parse(options)
    job_dir = settings.TEMP_DIR / f"ico_{uuid.uuid4().hex}"
    try:
        name = Path(file.filename or "icon.png").name
        src = job_dir / f"source{Path(name).suffix.lower()}"
        await run_in_threadpool(icon_service.save_upload, file.file, src)
        out, info = await icon_service.make(job_dir, src, name, parsed, request)
        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(
            path=out,
            filename=out.name,
            media_type=mimetypes.guess_type(out.name)[0] or "application/octet-stream",
            headers={"X-Convert-Info": json.dumps(info, ensure_ascii=True)},
        )
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()
