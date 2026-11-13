"""
Compress any file.

POST /compress — `files` (1 to 20, any kind) + `level` (light | recommended | strong).
One file comes back as itself; several come back in one ZIP. X-Convert-Info lists every file's
size before and after, what was done, and any file that couldn't be compressed (the rest still are).
"""

import json
import mimetypes
import uuid
from typing import List

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.compress import settings
from app.core.utils import cleanup_folder
from app.services.compress import compress_service

router = APIRouter(prefix="/compress", tags=["Compress"])


@router.post("", response_class=FileResponse, summary="Make any file smaller (PDF, Office, images, audio, video, fonts, archives…)")
async def compress(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    level: str = Form(default="recommended", pattern="^(light|recommended|strong)$"),
):
    compress_service.validate([f.filename for f in files], level)
    job_dir = settings.TEMP_DIR / f"cmp_{uuid.uuid4().hex}"
    try:
        saved = await run_in_threadpool(compress_service.save_uploads, [(f.file, f.filename or "file") for f in files], job_dir)
        out, info = await compress_service.compress(job_dir, saved, level, request)
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
        for f in files:
            await f.close()
