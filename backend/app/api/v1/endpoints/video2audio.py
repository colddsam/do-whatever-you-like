import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, File, UploadFile, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.video2audio import settings
from app.core.utils import cleanup_folder
from app.services.Video2Audio import v2a_service

router = APIRouter(prefix="/video2audio", tags=["Video2Audio"])


@router.post(
    "/extract",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Extract MP3 audio from an uploaded video file",
)
async def extract_audio_from_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Video file to extract audio from"),
):
    ext = v2a_service.validate_filename(file.filename)
    original_stem = Path(file.filename or "audio").stem or "audio"
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"v2a_{request_id}"

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        video_path = job_dir / f"v2a_{request_id}{ext}"

        await run_in_threadpool(v2a_service.save_upload_to_disk, file.file, video_path)
        audio_path = await run_in_threadpool(
            v2a_service.extract_audio_to_disk, video_path, job_dir
        )

        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(
            path=audio_path,
            filename=f"{original_stem}.mp3",
            media_type="audio/mpeg",
        )
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()

