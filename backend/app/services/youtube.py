import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse
import yt_dlp

from app.config.youtube import settings
from app.core.config import app_settings
from app.core.media_size import estimate_ydl_entry_size, sum_estimates
from app.exceptions.youtube import InvalidYoutubeURLError, YoutubeExtractionError

logger = logging.getLogger(__name__)


class YoutubeDownloaderService:
    # Shared by the download and the size estimate, so the preview's size is for what gets saved.
    DOWNLOAD_FORMAT = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best"
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    )
    ALLOWED_HOSTS = {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    }
    VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
    PATH_VIDEO_PATTERN = re.compile(r"^/(?:shorts|embed|v)/([A-Za-z0-9_-]{11})(?:[/?#].*)?$")
    SHORTLINK_PATTERN = re.compile(r"^/([A-Za-z0-9_-]{11})(?:[/?#].*)?$")

    @classmethod
    def _is_allowed_youtube_host(cls, hostname: str) -> bool:
        return hostname.lower() in cls.ALLOWED_HOSTS

    @classmethod
    def validate_url(cls, raw_url: str) -> str:
        clean_input = raw_url.strip()
        if len(clean_input) > 512:
            raise InvalidYoutubeURLError("URL exceeds maximum allowed length.")

        if cls.VIDEO_ID_PATTERN.match(clean_input):
            return f"https://www.youtube.com/watch?v={clean_input}"

        if not clean_input.startswith(("http://", "https://")):
            clean_input = f"https://{clean_input}"

        try:
            parsed = urlparse(clean_input)
        except Exception:
            raise InvalidYoutubeURLError("Malformed YouTube URL.")

        hostname = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not cls._is_allowed_youtube_host(hostname):
            raise InvalidYoutubeURLError(
                "URL must belong to an official YouTube domain (youtube.com or youtu.be)."
            )


        if hostname in {"youtu.be", "www.youtu.be"}:
            match = cls.SHORTLINK_PATTERN.match(parsed.path or "")
            if not match:
                raise InvalidYoutubeURLError("Invalid youtu.be video link.")
            video_id = match.group(1)
            return f"https://www.youtube.com/watch?v={video_id}"

        if parsed.path == "/watch":
            video_ids = parse_qs(parsed.query).get("v") or []
            if not video_ids or not cls.VIDEO_ID_PATTERN.match(video_ids[0]):
                raise InvalidYoutubeURLError("Missing or invalid YouTube video ID ('v' parameter).")
            return f"https://www.youtube.com/watch?v={video_ids[0]}"

        path_match = cls.PATH_VIDEO_PATTERN.match(parsed.path or "")
        if path_match:
            video_id = path_match.group(1)
            if (parsed.path or "").startswith("/shorts/"):
                return f"https://www.youtube.com/shorts/{video_id}"
            return f"https://www.youtube.com/watch?v={video_id}"

        raise InvalidYoutubeURLError(
            "URL must point to a valid YouTube video (/watch?v=...) or Short (/shorts/...)."
        )

    @staticmethod
    def _safety_match_filter(info_dict: Dict[str, Any], *, incomplete: bool = False) -> str | None:
        """Prevent infinite live-stream downloads and excessively long video DoS."""
        if info_dict.get("is_live") or info_dict.get("live_status") in {"is_live", "is_upcoming"}:
            return "Live streams are not supported for downloading."
        duration = info_dict.get("duration")
        if duration and duration > app_settings.MAX_VIDEO_DURATION_SECONDS:
            return f"Video duration exceeds maximum limit of {app_settings.MAX_VIDEO_DURATION_SECONDS} seconds."
        return None

    @classmethod
    def _get_base_ydl_opts(cls) -> Dict[str, Any]:
        opts: Dict[str, Any] = {
            "quiet": not settings.DEBUG,
            "no_warnings": True,
            "user_agent": cls.USER_AGENT,
            "socket_timeout": app_settings.REQUEST_TIMEOUT,
            "extract_flat": False,
            "noplaylist": True,
            "playlist_items": "1",
            "allowed_extractors": ["youtube"],
            "match_filter": cls._safety_match_filter,
        }
        if settings.COOKIE_FILE_PATH and os.path.exists(settings.COOKIE_FILE_PATH):
            opts["cookiefile"] = str(settings.COOKIE_FILE_PATH)
        return opts

    @staticmethod
    def _parse_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
        formats = [f for f in (entry.get("formats") or []) if f.get("url")]

        progressive_mp4 = [
            f
            for f in formats
            if f.get("vcodec") not in (None, "none")
            and f.get("acodec") not in (None, "none")
            and f.get("ext") == "mp4"
        ]
        progressive_any = [
            f
            for f in formats
            if f.get("vcodec") not in (None, "none")
            and f.get("acodec") not in (None, "none")
        ]
        video_only = [f for f in formats if f.get("vcodec") not in (None, "none")]

        candidate_list = progressive_mp4 or progressive_any or video_only or formats
        best_fmt = candidate_list[-1] if candidate_list else {}
        download_url = best_fmt.get("url") or entry.get("url") or ""

        width = best_fmt.get("width") or entry.get("width")
        height = best_fmt.get("height") or entry.get("height")
        resolution = best_fmt.get("resolution") or (
            f"{width}x{height}" if width and height else None
        )

        return {
            "id": str(entry.get("id") or uuid.uuid4().hex[:11]),
            "type": "video",
            "url": download_url,
            "ext": best_fmt.get("ext") or entry.get("ext") or "mp4",
            "format_id": best_fmt.get("format_id"),
            "resolution": resolution,
            "width": width,
            "height": height,
            "fps": best_fmt.get("fps") or entry.get("fps"),
        }

    def fetch_media_metadata(self, url: str) -> Dict[str, Any]:
        valid_url = self.validate_url(url)
        opts = {
            **self._get_base_ydl_opts(),
            "skip_download": True,
        }

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(valid_url, download=False)
                entries_for_size = [e for e in (info or {}).get("entries") or [] if e] or [info or {}]
                estimated_size, size_exact = sum_estimates(
                    estimate_ydl_entry_size(ydl, e, self.DOWNLOAD_FORMAT) for e in entries_for_size
                )
        except Exception as exc:
            logger.error("Failed to extract YouTube metadata for %s: %s", valid_url, exc)
            raise YoutubeExtractionError(
                "Could not extract media from the provided YouTube URL. Ensure the video or Short is public."
            )

        if not info:
            raise YoutubeExtractionError("No extractable media found at the provided YouTube URL.")

        if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
            raise YoutubeExtractionError("Live streams are not supported.")

        duration = info.get("duration")
        if duration and duration > app_settings.MAX_VIDEO_DURATION_SECONDS:
            raise YoutubeExtractionError(
                f"Video exceeds maximum allowed duration ({app_settings.MAX_VIDEO_DURATION_SECONDS}s)."
            )

        entries = info.get("entries")
        if entries:
            items = [self._parse_entry(e) for e in entries if e]
        else:
            items = [self._parse_entry(info)]

        items = [item for item in items if item.get("url")]
        if not items:
            raise YoutubeExtractionError("No downloadable video streams found for this YouTube video.")

        aspect_ratio = info.get("aspect_ratio")
        is_short = (
            "/shorts/" in valid_url.lower()
            or "/shorts/" in (info.get("webpage_url") or "").lower()
            or bool(aspect_ratio and aspect_ratio < 1.0 and duration and duration <= 180)
        )

        return {
            "id": str(info.get("id") or items[0]["id"]),
            "title": info.get("title"),
            "uploader": info.get("uploader") or info.get("channel"),
            "duration": duration,
            "view_count": info.get("view_count"),
            "thumbnail": info.get("thumbnail"),
            "is_short": is_short,
            "estimated_size": estimated_size,
            "size_is_exact": size_exact,
            "items": items,
        }

    def download_to_disk(self, url: str, target_dir: Path) -> List[Path]:
        valid_url = self.validate_url(url)
        target_dir.mkdir(parents=True, exist_ok=True)
        output_template = str(target_dir / "yt_%(id)s.%(ext)s")

        opts = {
            **self._get_base_ydl_opts(),
            "outtmpl": output_template,
            "format": self.DOWNLOAD_FORMAT,
            "merge_output_format": "mp4",
            "max_filesize": app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024,
        }

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([valid_url])
        except Exception as exc:
            logger.error("Failed to download YouTube media for %s: %s", valid_url, exc)
            raise YoutubeExtractionError(
                "Failed to download video from YouTube. Ensure the video is public, not a live stream, and within size limits."
            )

        saved_files = [
            f
            for f in target_dir.iterdir()
            if f.is_file() and f.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}
        ]
        if not saved_files:
            raise YoutubeExtractionError("Downloaded YouTube media file could not be located on disk.")

        return saved_files


yt_service = YoutubeDownloaderService()
