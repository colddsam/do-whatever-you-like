import logging
from pathlib import Path
from typing import BinaryIO
import ffmpeg

from app.core.config import app_settings
from app.exceptions.video2audio import AudioExtractionError, InvalidVideoFileError
from app.services.ffmpeg_service import init_ffmpeg

logger = logging.getLogger(__name__)


class Video2AudioService:
    ALLOWED_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4v"}
    CHUNK_SIZE = 1024 * 64

    @classmethod
    def validate_filename(cls, filename: str | None) -> str:
        if not filename:
            raise InvalidVideoFileError("Video filename is missing.")

        ext = Path(filename).suffix.lower()
        if ext not in cls.ALLOWED_EXTENSIONS:
            allowed = ", ".join(sorted(cls.ALLOWED_EXTENSIONS))
            raise InvalidVideoFileError(
                f"Unsupported video format '{ext or 'unknown'}'. Allowed formats: {allowed}."
            )
        return ext

    def save_upload_to_disk(self, file_obj: BinaryIO, destination: Path) -> Path:
        max_bytes = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        total_bytes = 0

        try:
            with open(destination, "wb") as buffer:
                while True:
                    chunk = file_obj.read(self.CHUNK_SIZE)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise InvalidVideoFileError(
                            f"Video file exceeds maximum allowed size ({app_settings.MAX_DOWNLOAD_SIZE_MB} MB)."
                        )
                    buffer.write(chunk)
        except InvalidVideoFileError:
            raise
        except Exception as exc:
            logger.error("Failed to save uploaded video file: %s", exc)
            raise AudioExtractionError("Could not process the uploaded video file.")

        if total_bytes == 0:
            raise InvalidVideoFileError("Uploaded video file is empty.")

        return destination

    def extract_audio_to_disk(self, video_path: Path, target_dir: Path) -> Path:
        init_ffmpeg()
        target_dir.mkdir(parents=True, exist_ok=True)
        output_path = target_dir / f"{video_path.stem}.mp3"

        try:
            (
                ffmpeg.input(str(video_path))
                .output(
                    str(output_path),
                    vn=None,
                    acodec="libmp3lame",
                    audio_bitrate="192k",
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
        except ffmpeg.Error as exc:
            stderr_msg = (
                exc.stderr.decode("utf-8", errors="ignore") if exc.stderr else str(exc)
            )
            logger.error("FFmpeg audio extraction failed for %s: %s", video_path.name, stderr_msg)
            raise AudioExtractionError(
                "Could not extract audio from the provided video. Ensure the file is valid and contains an audio track."
            )
        except Exception as exc:
            logger.error("Unexpected error extracting audio for %s: %s", video_path.name, exc)
            raise AudioExtractionError("Failed to extract audio from video.")

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise AudioExtractionError("Extracted audio file could not be generated.")

        return output_path


v2a_service = Video2AudioService()

