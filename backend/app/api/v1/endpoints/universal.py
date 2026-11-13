"""
Universal converter: any supported file → any format it can become.

GET  /universal/formats  — every format, and every route this server can run (for the picker)
POST /universal/convert  — `file` + `target` (a format id); optional `source` when the name has no known extension,
                           and `options` (JSON) to fine-tune the result: PDF→images DPI/pages, PDF→Excel sheets,
                           spreadsheet→PDF fit, audio bitrate
"""

import json
import mimetypes
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.universal import settings
from app.core.utils import cleanup_folder
from app.schemas.universal import FormatsResponse
from app.services.universal import universal_service

router = APIRouter(prefix="/universal", tags=["Universal converter"])

FORMAT_ID = r"^[a-z0-9]{1,8}(\.[a-z0-9]{1,4})?$"


@router.get("/formats", response_model=FormatsResponse, summary="Every format, and what each can be converted to")
async def formats():
    return await run_in_threadpool(universal_service.formats)


@router.post("/convert", response_class=FileResponse, summary="Convert any supported file to another format")
async def convert(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    target: str = Form(..., pattern=FORMAT_ID, description="Format id to convert to, e.g. pdf, docx, mp3, json"),
    source: Optional[str] = Form(default=None, pattern=FORMAT_ID, description="What the file is, if its name doesn't say"),
    options: Optional[str] = Form(default=None, max_length=1000, description="JSON fine-tuning for the result (see ConvertOptions)"),
):
    # Cheap checks first, before a byte is saved: is the file known, and can it become `target`?
    src_fmt, steps = await run_in_threadpool(universal_service.resolve, file.filename, target, source)
    opts = universal_service.parse_options(options)
    job_dir = settings.TEMP_DIR / f"uni_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        # Saved under its format id, so every engine knows how to read it whatever it was called.
        input_path = job_dir / f"source.{src_fmt}"
        await run_in_threadpool(universal_service.save_upload, file.file, input_path)
        out, info = await universal_service.convert(job_dir, input_path, file.filename or "file", src_fmt, steps, request, opts)
        background_tasks.add_task(cleanup_folder, job_dir)
        media_type = mimetypes.guess_type(out.name)[0] or "application/octet-stream"
        return FileResponse(
            path=out,
            filename=out.name,
            media_type=media_type,
            headers={"X-Convert-Info": json.dumps(info, ensure_ascii=True)},
        )
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()
