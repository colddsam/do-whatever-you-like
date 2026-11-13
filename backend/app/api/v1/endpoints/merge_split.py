"""
Merge and split PDF, Word, PowerPoint, Excel/CSV, audio and video files.

POST /merge-split/inspect — one `file` → what it holds (pages, slides, headings, sheets and columns, length)
POST /merge-split/split   — one `file` + `plan` (JSON, see SplitPlan) → a ZIP of the parts
POST /merge-split/merge   — `files` (2+, one kind) + `options` (JSON, see MergeOptions) → one file
"""

import json
import mimetypes
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.merge_split import settings
from app.core.utils import cleanup_folder
from app.schemas.merge_split import InspectResponse, MergeOptions, SplitPlan
from app.services.merge_split import merge_split_service

router = APIRouter(prefix="/merge-split", tags=["Merge and split"])


def _respond(path: Path, info: dict, job_dir: Path, background_tasks: BackgroundTasks) -> FileResponse:
    background_tasks.add_task(cleanup_folder, job_dir)
    return FileResponse(
        path=path,
        filename=path.name,
        media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        headers={"X-Convert-Info": json.dumps(info, ensure_ascii=True)},
    )


@router.post("/inspect", response_model=InspectResponse, summary="What a file holds: pages, slides, headings, sheets or length")
async def inspect(request: Request, file: UploadFile = File(...)):
    family = merge_split_service.family(file.filename)
    job_dir = settings.TEMP_DIR / f"msi_{uuid.uuid4().hex}"
    try:
        saved = await run_in_threadpool(merge_split_service.save_uploads, [(file.file, file.filename or "file")], job_dir)
        return await merge_split_service.inspect(job_dir, saved[0], family, request)
    finally:
        cleanup_folder(job_dir)
        await file.close()


@router.post("/split", response_class=FileResponse, summary="Split one file into parts (a ZIP)")
async def split(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    plan: str = Form(..., max_length=2000, description="JSON: how to split (see SplitPlan)"),
):
    family = merge_split_service.family(file.filename)
    parsed = merge_split_service.parse(plan, SplitPlan)
    job_dir = settings.TEMP_DIR / f"mss_{uuid.uuid4().hex}"
    try:
        saved = await run_in_threadpool(merge_split_service.save_uploads, [(file.file, file.filename or "file")], job_dir)
        out, info = await merge_split_service.split(job_dir, saved[0], family, parsed, request)
        return _respond(out, info, job_dir, background_tasks)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()


@router.post("/merge", response_class=FileResponse, summary="Merge 2 or more files of one kind, in the order sent")
async def merge(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    options: Optional[str] = Form(default=None, max_length=1000, description="JSON: how to merge (see MergeOptions)"),
):
    family = merge_split_service.merge_family([f.filename for f in files])
    parsed = merge_split_service.parse(options, MergeOptions)
    job_dir = settings.TEMP_DIR / f"msm_{uuid.uuid4().hex}"
    try:
        saved = await run_in_threadpool(merge_split_service.save_uploads, [(f.file, f.filename or "file") for f in files], job_dir)
        out, info = await merge_split_service.merge(job_dir, saved, family, parsed, request)
        return _respond(out, info, job_dir, background_tasks)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        for f in files:
            await f.close()
