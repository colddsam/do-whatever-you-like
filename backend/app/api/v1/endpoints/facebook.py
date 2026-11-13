import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.facebook import settings
from app.core.utils import cleanup_file, cleanup_folder
from app.exceptions.facebook import FacebookExtractionError
from app.schemas.facebook import FacebookDownloadRequest, FacebookMediaResponse
from app.services.facebook import fb_service
from app.services.audio_extract import MEDIA_TYPES as AUDIO_MEDIA_TYPES, AudioExtractError, files_to_audio

router = APIRouter(prefix="/facebook", tags=["Facebook"])


@router.post(
    "/extract",
    response_model=FacebookMediaResponse,
    status_code=status.HTTP_200_OK,
    summary="Get direct Facebook video or reel URLs and metadata without saving to disk",
)
async def extract_facebook_metadata(payload: FacebookDownloadRequest):
    valid_url = fb_service.validate_url(payload.url)
    result = await run_in_threadpool(fb_service.fetch_media_metadata, valid_url)
    return result


@router.post(
    "/download",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Download public Facebook video or reel directly as an MP4 file",
)
async def download_facebook_media(
    payload: FacebookDownloadRequest,
    background_tasks: BackgroundTasks,
):
    valid_url = fb_service.validate_url(payload.url)
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"fb_{request_id}"
    zip_path: Path | None = None

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        files = await run_in_threadpool(fb_service.download_to_disk, valid_url, job_dir, bool(payload.audio))
        if payload.audio:
            try:
                files = await run_in_threadpool(files_to_audio, files, payload.audio)
            except AudioExtractError as exc:
                raise FacebookExtractionError(str(exc))
            # Photos and the source videos go; only the audio files are sent (or zipped).
            keep = set(files)
            for leftover in job_dir.iterdir():
                if leftover.is_file() and leftover not in keep:
                    leftover.unlink(missing_ok=True)

        if not files:
            cleanup_folder(job_dir)
            raise FacebookExtractionError("No downloadable Facebook video files found.")

        if len(files) == 1:
            target_file = files[0]
            background_tasks.add_task(cleanup_folder, job_dir)
            return FileResponse(
                path=target_file,
                filename=target_file.name,
                media_type=AUDIO_MEDIA_TYPES.get(target_file.suffix.lower(), "video/mp4"),
            )

        zip_base = settings.TEMP_DIR / f"fb_{request_id}_archive"
        zip_path = Path(shutil.make_archive(str(zip_base), "zip", job_dir))

        def full_cleanup() -> None:
            cleanup_folder(job_dir)
            if zip_path is not None:
                cleanup_file(zip_path)

        background_tasks.add_task(full_cleanup)
        return FileResponse(
            path=zip_path,
            filename=f"facebook_{request_id[:8]}.zip",
            media_type="application/zip",
        )
    except Exception:
        cleanup_folder(job_dir)
        if zip_path is not None:
            cleanup_file(zip_path)
        raise

