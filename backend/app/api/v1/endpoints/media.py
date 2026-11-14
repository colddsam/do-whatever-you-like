"""
Audio and video edits.

POST /media/trim  — `file` + `start`, `end` (seconds) + `exact` (re-encode for frame-exact video cuts)
POST /media/sound — `file` + `mode` (volume | normalize | mute) + `gain_db` (for volume, -30 to 30)
POST /media/denoise — `file` + `strength` (light | medium | strong) + `voice` + `hum` (auto | off | 50 | 60)
                      + `clicks`, and optionally `noise_start` / `noise_end` (a noise-only part, seconds)
Each returns the edited file, with X-Convert-Info (JSON notes).
"""

import json
import mimetypes
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.media import settings
from app.core.utils import cleanup_folder
from app.services.media import media_service

router = APIRouter(prefix="/media", tags=["Audio & video"])


def _reply(out, info):
    return FileResponse(path=out, filename=out.name, media_type=mimetypes.guess_type(out.name)[0] or "application/octet-stream", headers={"X-Convert-Info": json.dumps(info, ensure_ascii=True)})


@router.post("/trim", response_class=FileResponse, summary="Cut a part out of an audio or video file")
async def trim(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    start: float = Form(..., ge=0),
    end: float = Form(..., gt=0),
    exact: bool = Form(default=False),
):
    media_service.validate_trim(start, end)
    job_dir = settings.TEMP_DIR / f"trim_{uuid.uuid4().hex}"
    try:
        saved = await run_in_threadpool(media_service.save_upload, file.file, file.filename, job_dir)
        out, info = await media_service.trim(job_dir, saved, start, end, exact, request)
        background_tasks.add_task(cleanup_folder, job_dir)
        return _reply(out, info)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()


@router.post("/sound", response_class=FileResponse, summary="Change the volume, normalise loudness, or mute a video")
async def sound(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mode: str = Form(..., pattern="^(volume|normalize|mute)$"),
    gain_db: float = Form(default=0),
):
    media_service.validate_sound(mode, gain_db)
    job_dir = settings.TEMP_DIR / f"snd_{uuid.uuid4().hex}"
    try:
        saved = await run_in_threadpool(media_service.save_upload, file.file, file.filename, job_dir)
        out, info = await media_service.sound(job_dir, saved, mode, gain_db, request)
        background_tasks.add_task(cleanup_folder, job_dir)
        return _reply(out, info)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()


@router.post("/denoise", response_class=FileResponse, summary="Remove background noise, hiss and hum from audio or video")
async def denoise(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    strength: str = Form(default="medium", pattern="^(light|medium|strong)$"),
    voice: bool = Form(default=True),
    hum: str = Form(default="auto", pattern="^(auto|off|50|60)$"),
    clicks: bool = Form(default=False),
    noise_start: Optional[float] = Form(default=None, ge=0),
    noise_end: Optional[float] = Form(default=None, gt=0),
):
    media_service.validate_denoise(strength, hum, noise_start, noise_end)
    job_dir = settings.TEMP_DIR / f"dn_{uuid.uuid4().hex}"
    try:
        saved = await run_in_threadpool(media_service.save_upload, file.file, file.filename, job_dir)
        opts = {"strength": strength, "voice": voice, "hum": hum, "clicks": clicks, "noise_start": noise_start, "noise_end": noise_end}
        out, info = await media_service.denoise(job_dir, saved, opts, request)
        background_tasks.add_task(cleanup_folder, job_dir)
        return _reply(out, info)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()
