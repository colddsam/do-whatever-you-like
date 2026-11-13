import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urljoin, urlparse
import requests
import yt_dlp

from app.config.facebook import settings
from app.core.config import app_settings
from app.core.utils import writable_cookie_copy
from app.core.media_size import estimate_ydl_entry_size, sum_estimates
from app.exceptions.facebook import FacebookExtractionError, InvalidFacebookURLError
from app.services.ffmpeg_service import init_ffmpeg

logger = logging.getLogger(__name__)


class FacebookDownloaderService:
    DOWNLOAD_FORMAT = "bestvideo+bestaudio/best"
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    )
    ALLOWED_HOSTS = {
        "facebook.com",
        "www.facebook.com",
        "m.facebook.com",
        "web.facebook.com",
        "fb.watch",
        "www.fb.watch",
        "fb.gg",
    }
    BLOCKED_REDIRECT_PATHS = ("/flx/warn", "/l.php")
    MAX_REDIRECT_HOPS = 5

    @classmethod
    def _is_allowed_facebook_host(cls, hostname: str) -> bool:
        host = hostname.lower()
        if host == "l.facebook.com":
            return False
        return host in cls.ALLOWED_HOSTS or host.endswith(".facebook.com")

    @classmethod
    def validate_url(cls, raw_url: str) -> str:
        clean_url = raw_url.strip()
        if len(clean_url) > 512:
            raise InvalidFacebookURLError("URL exceeds maximum allowed length.")

        if not clean_url.startswith(("http://", "https://")):
            clean_url = f"https://{clean_url}"

        try:
            parsed = urlparse(clean_url)
        except Exception:
            raise InvalidFacebookURLError("Malformed Facebook URL.")

        hostname = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not cls._is_allowed_facebook_host(hostname):
            raise InvalidFacebookURLError(
                "URL must belong to an official Facebook domain (facebook.com or fb.watch)."
            )

        if not parsed.path or parsed.path == "/":
            raise InvalidFacebookURLError("Facebook URL must point to a specific video or reel.")

        if any(parsed.path.startswith(blocked) for blocked in cls.BLOCKED_REDIRECT_PATHS):
            raise InvalidFacebookURLError("External Facebook redirect links are not permitted.")

        if hostname in {"fb.watch", "www.fb.watch"} or parsed.path.startswith("/share/"):
            clean_url = cls._resolve_share_redirect(clean_url)

        return clean_url

    @classmethod
    def _resolve_share_redirect(cls, url: str) -> str:
        """
        Safely resolve fb.watch or /share/ redirects hop-by-hop (SSRF protection)
        so requests never follow a redirect to a non-Facebook or internal host.
        """
        current_url = url
        try:
            with requests.Session() as session:
                session.headers.update(
                    {
                        "User-Agent": cls.USER_AGENT,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Sec-Fetch-Mode": "navigate",
                    }
                )
                for _ in range(cls.MAX_REDIRECT_HOPS):
                    resp = session.head(
                        current_url,
                        allow_redirects=False,
                        timeout=app_settings.REQUEST_TIMEOUT,
                    )
                    if resp.status_code not in {301, 302, 303, 307, 308}:
                        with session.get(
                            current_url,
                            allow_redirects=False,
                            stream=True,
                            timeout=app_settings.REQUEST_TIMEOUT,
                        ) as get_resp:
                            resp = get_resp
                    if resp.status_code not in {301, 302, 303, 307, 308}:
                        break

                    location = resp.headers.get("Location")
                    if not location:
                        break

                    next_url = urljoin(current_url, location)
                    parsed = urlparse(next_url)
                    if (
                        parsed.scheme not in {"http", "https"}
                        or not cls._is_allowed_facebook_host(parsed.hostname or "")
                        or any(
                            parsed.path.startswith(b) for b in cls.BLOCKED_REDIRECT_PATHS
                        )
                    ):
                        raise InvalidFacebookURLError(
                            "Redirect target is outside allowed Facebook domains."
                        )
                    current_url = next_url
        except InvalidFacebookURLError:
            raise
        except Exception as exc:
            logger.debug("Share URL pre-resolution skipped for %s: %s", url, exc)

        return current_url

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
            "playlist_items": "1-10",
            "allowed_extractors": ["facebook", "facebook:reel", "facebook:ads"],
            "match_filter": cls._safety_match_filter,
        }
        cookie_file = writable_cookie_copy(settings.COOKIE_FILE_PATH, settings.TEMP_DIR)
        if cookie_file:
            opts["cookiefile"] = cookie_file
        return opts

    @staticmethod
    def _parse_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
        formats = [f for f in (entry.get("formats") or []) if f.get("url")]

        progressive_formats = [
            f
            for f in formats
            if f.get("vcodec") not in (None, "none")
            and f.get("acodec") not in (None, "none")
        ]
        candidate_list = progressive_formats or [
            f for f in formats if f.get("vcodec") not in (None, "none")
        ] or formats

        best_fmt = candidate_list[-1] if candidate_list else {}
        download_url = best_fmt.get("url") or entry.get("url") or ""

        return {
            "id": str(entry.get("id") or uuid.uuid4().hex[:12]),
            "type": "video",
            "url": download_url,
            "ext": best_fmt.get("ext") or entry.get("ext") or "mp4",
            "format_id": best_fmt.get("format_id"),
            "width": best_fmt.get("width") or entry.get("width"),
            "height": best_fmt.get("height") or entry.get("height"),
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
            logger.error("Failed to extract Facebook metadata for %s: %s", valid_url, exc)
            raise FacebookExtractionError(
                "Could not extract media from the provided Facebook URL. Ensure the video or reel is public."
            )

        if not info:
            raise FacebookExtractionError("No extractable media found at the provided Facebook URL.")

        entries = info.get("entries")
        if entries:
            items = [self._parse_entry(e) for e in entries if e]
        else:
            items = [self._parse_entry(info)]

        items = [item for item in items if item.get("url")]
        if not items:
            raise FacebookExtractionError("No downloadable video streams found for this Facebook post.")

        return {
            "id": str(info.get("id") or items[0]["id"]),
            "title": info.get("title") or info.get("description"),
            "uploader": info.get("uploader"),
            "duration": info.get("duration"),
            "thumbnail": info.get("thumbnail"),
            "estimated_size": estimated_size,
            "size_is_exact": size_exact,
            "items": items,
        }

    def download_to_disk(self, url: str, target_dir: Path, audio_only: bool = False) -> List[Path]:
        init_ffmpeg()
        valid_url = self.validate_url(url)
        target_dir.mkdir(parents=True, exist_ok=True)
        output_template = str(target_dir / "fb_%(id)s.%(ext)s")

        opts = {
            **self._get_base_ydl_opts(),
            "outtmpl": output_template,
            # Audio only: Facebook serves sound as its own stream, so there's no need to fetch the video.
            "format": "ba[ext=m4a]/ba/b" if audio_only else self.DOWNLOAD_FORMAT,
            "merge_output_format": "mp4",
            "max_filesize": app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024,
        }

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([valid_url])
        except Exception as exc:
            logger.error("Failed to download Facebook media for %s: %s", valid_url, exc)
            raise FacebookExtractionError(
                "Failed to download video from Facebook. Ensure the post is public and within size limits."
            )

        saved_files = [
            f
            for f in target_dir.iterdir()
            if f.is_file() and f.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".m4a", ".opus", ".ogg", ".aac"}
        ]
        if not saved_files:
            raise FacebookExtractionError("Downloaded Facebook media file could not be located on disk.")

        return saved_files


fb_service = FacebookDownloaderService()
