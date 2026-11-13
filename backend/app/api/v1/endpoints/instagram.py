import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.instagram import settings
from app.core.utils import cleanup_file, cleanup_folder
from app.exceptions.instagram import MediaExtractionError
from app.schemas.instagram import DownloadRequest, MediaResponse
from app.services.instagram import ig_service
from app.services.audio_extract import MEDIA_TYPES as AUDIO_MEDIA_TYPES, AudioExtractError, files_to_audio

router = APIRouter(prefix="/instagram", tags=["Instagram"])


@router.post(
    "/extract",
    response_model=MediaResponse,
    status_code=status.HTTP_200_OK,
    summary="Get direct Instagram media URLs without saving to disk",
)
async def extract_metadata(payload: DownloadRequest):
    shortcode = ig_service.extract_shortcode(payload.url_or_shortcode)
    result = await run_in_threadpool(ig_service.fetch_media_metadata, shortcode)
    return result


@router.post(
    "/download",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Download Instagram media directly (single file or packaged ZIP for carousels)",
)
async def download_media(payload: DownloadRequest, background_tasks: BackgroundTasks):
    shortcode = ig_service.extract_shortcode(payload.url_or_shortcode)
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"{shortcode}_{request_id}"
    zip_path: Path | None = None

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        files = await run_in_threadpool(ig_service.download_to_disk, shortcode, job_dir)
        if payload.audio:
            try:
                files = await run_in_threadpool(files_to_audio, files, payload.audio)
            except AudioExtractError as exc:
                raise MediaExtractionError(str(exc))
            # Photos and the source videos go; only the audio files are sent (or zipped).
            keep = set(files)
            for leftover in job_dir.iterdir():
                if leftover.is_file() and leftover not in keep:
                    leftover.unlink(missing_ok=True)

        if not files:
            cleanup_folder(job_dir)
            raise MediaExtractionError("No downloadable media files found.")

        if len(files) == 1:
            target_file = files[0]
            background_tasks.add_task(cleanup_folder, job_dir)
            return FileResponse(
                path=target_file,
                filename=target_file.name,
                media_type=AUDIO_MEDIA_TYPES.get(target_file.suffix.lower(), "application/octet-stream"),
            )

        zip_base = settings.TEMP_DIR / f"{shortcode}_{request_id}_archive"
        zip_path = Path(shutil.make_archive(str(zip_base), "zip", job_dir))

        def full_cleanup() -> None:
            cleanup_folder(job_dir)
            if zip_path is not None:
                cleanup_file(zip_path)

        background_tasks.add_task(full_cleanup)
        return FileResponse(
            path=zip_path,
            filename=f"{shortcode}{'-audio' if payload.audio else ''}.zip",
            media_type="application/zip",
        )
    except Exception:
        cleanup_folder(job_dir)
        if zip_path is not None:
            cleanup_file(zip_path)
        raise
