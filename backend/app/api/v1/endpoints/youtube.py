import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.youtube import settings
from app.core.utils import cleanup_file, cleanup_folder
from app.exceptions.youtube import YoutubeExtractionError
from app.schemas.youtube import YoutubeDownloadRequest, YoutubeMediaResponse
from app.services.youtube import yt_service

router = APIRouter(prefix="/youtube", tags=["YouTube"])


@router.post(
    "/extract",
    response_model=YoutubeMediaResponse,
    status_code=status.HTTP_200_OK,
    summary="Get direct YouTube video or Shorts URLs and metadata without saving to disk",
)
async def extract_youtube_metadata(payload: YoutubeDownloadRequest):
    valid_url = yt_service.validate_url(payload.url)
    result = await run_in_threadpool(yt_service.fetch_media_metadata, valid_url)
    return result


@router.post(
    "/download",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Download public YouTube video or Short directly as an MP4 file",
)
async def download_youtube_media(
    payload: YoutubeDownloadRequest,
    background_tasks: BackgroundTasks,
):
    valid_url = yt_service.validate_url(payload.url)
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"yt_{request_id}"
    zip_path: Path | None = None

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        files = await run_in_threadpool(yt_service.download_to_disk, valid_url, job_dir)

        if not files:
            cleanup_folder(job_dir)
            raise YoutubeExtractionError("No downloadable YouTube video files found.")

        if len(files) == 1:
            target_file = files[0]
            background_tasks.add_task(cleanup_folder, job_dir)
            return FileResponse(
                path=target_file,
                filename=target_file.name,
                media_type="video/mp4",
            )

        zip_base = settings.TEMP_DIR / f"yt_{request_id}_archive"
        zip_path = Path(shutil.make_archive(str(zip_base), "zip", job_dir))

        def full_cleanup() -> None:
            cleanup_folder(job_dir)
            if zip_path is not None:
                cleanup_file(zip_path)

        background_tasks.add_task(full_cleanup)
        return FileResponse(
            path=zip_path,
            filename=f"youtube_{request_id[:8]}.zip",
            media_type="application/zip",
        )
    except Exception:
        cleanup_folder(job_dir)
        if zip_path is not None:
            cleanup_file(zip_path)
        raise

