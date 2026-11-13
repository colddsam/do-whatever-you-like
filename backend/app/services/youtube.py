import functools
import logging
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse
import yt_dlp

from app.config.youtube import settings
from app.core.config import app_settings
from app.core.utils import writable_cookie_copy
from app.core.media_size import estimate_ydl_entry_size
from app.exceptions.youtube import InvalidYoutubeURLError, YoutubeExtractionError

logger = logging.getLogger(__name__)


class YoutubeDownloaderService:
    # Every download picks a quality first (a height cap, or audio only), so its size is known before
    # it starts. Asking for "best" let 4K streams start downloading, hit the size cap halfway and
    # leave nothing behind.
    AUDIO_FORMAT = "ba[ext=m4a]/ba"
    MEDIA_SUFFIXES = {".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".opus", ".ogg", ".aac"}
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
        if duration and duration > settings.MAX_DURATION_SECONDS:
            return f"Videos up to {settings.MAX_DURATION_SECONDS // 3600} hours can be saved; this one is longer."
        return None

    @staticmethod
    def friendly_error(exc: Exception, fallback: str) -> str:
        """YouTube's own reason, in plain words, instead of one catch-all message."""
        text = str(exc)
        if "confirm you" in text and "not a bot" in text:
            return (
                "YouTube is asking this server to prove it isn't a bot, which it does after many downloads "
                "from one address. Try again in a while; the site owner can add YouTube cookies to avoid it."
            )
        if "Private video" in text:
            return "That video is private."
        if "age" in text.lower() and ("confirm your age" in text or "age-restricted" in text.lower() or "inappropriate" in text):
            return "That video is age-restricted, so YouTube only shows it to signed-in viewers."
        if "Video unavailable" in text or "This video is unavailable" in text or "removed" in text:
            return "That video isn't available: it may have been removed, or it's blocked in the server's country."
        if "members-only" in text.lower() or "join this channel" in text.lower():
            return "That video is for channel members only."
        if "live event" in text.lower() or "is_live" in text:
            return "Live streams can't be saved."
        return fallback

    @staticmethod
    def video_format(height: int) -> str:
        """Best MP4 (H.264 + AAC, plays everywhere) up to `height`, else any codec, else a single file."""
        return f"bv*[height<={height}][ext=mp4]+ba[ext=m4a]/bv*[height<={height}]+ba/b[height<={height}]"

    @staticmethod
    @functools.lru_cache(maxsize=1)
    def _js_runtimes() -> Dict[str, Dict[str, str]]:
        """
        YouTube now needs a JavaScript runtime to unlock its formats (yt-dlp's EJS). Deno comes from
        the `deno` wheel (no system install); Node, if present, is a fallback.
        """
        runtimes: Dict[str, Dict[str, str]] = {}
        try:
            import deno

            runtimes["deno"] = {"path": deno.find_deno_bin()}
        except Exception:  # noqa: BLE001 - the wheel is optional; yt-dlp then looks on PATH
            if shutil.which("deno"):
                runtimes["deno"] = {}
        if shutil.which("node"):
            runtimes["node"] = {}
        return runtimes or {"deno": {}}

    @classmethod
    def _get_base_ydl_opts(cls) -> Dict[str, Any]:
        opts: Dict[str, Any] = {
            "quiet": not settings.DEBUG,
            "no_warnings": True,
            # No user_agent override: yt-dlp pairs each YouTube client with its own headers, and the
            # stream URLs it gets are tied to them. A forced desktop UA got 403s on some formats.
            "socket_timeout": app_settings.REQUEST_TIMEOUT,
            "extract_flat": False,
            "noplaylist": True,
            "playlist_items": "1",
            "allowed_extractors": ["youtube"],
            "match_filter": cls._safety_match_filter,
            "js_runtimes": dict(cls._js_runtimes()),
        }
        cookie_file = writable_cookie_copy(settings.COOKIE_FILE_PATH, settings.TEMP_DIR)
        if cookie_file:
            opts["cookiefile"] = cookie_file
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
                qualities = self.qualities(ydl, info or {})
        except YoutubeExtractionError:
            raise
        except Exception as exc:
            logger.error("Failed to extract YouTube metadata for %s: %s", valid_url, exc)
            raise YoutubeExtractionError(
                self.friendly_error(exc, "Could not extract media from the provided YouTube URL. Ensure the video or Short is public.")
            )

        if not info:
            raise YoutubeExtractionError("No extractable media found at the provided YouTube URL.")

        if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
            raise YoutubeExtractionError("Live streams are not supported.")

        duration = info.get("duration")
        if duration and duration > settings.MAX_DURATION_SECONDS:
            raise YoutubeExtractionError(
                f"Videos up to {settings.MAX_DURATION_SECONDS // 3600} hours can be saved; this one is {duration / 3600:.1f} hours."
            )

        entries = info.get("entries")
        if entries:
            items = [self._parse_entry(e) for e in entries if e]
        else:
            items = [self._parse_entry(info)]

        items = [item for item in items if item.get("url")]
        if not items:
            raise YoutubeExtractionError("No downloadable video streams found for this YouTube video.")

        default = next((q for q in qualities if q["fits"]), None)
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
            "estimated_size": default["size"] if default else None,
            "size_is_exact": bool(default and default["size_is_exact"]),
            "items": items,
            "qualities": qualities,
            "default_quality": default["id"] if default else None,
            "max_download_mb": settings.MAX_DOWNLOAD_MB,
        }

    def qualities(self, ydl: Any, info: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        What can be saved: one entry per distinct video height up to MAX_HEIGHT, best first, then
        audio only. Each has the size yt-dlp's own selector predicts, and whether it fits the cap.
        """
        cap = settings.MAX_DOWNLOAD_MB * 1024 * 1024
        formats = [f for f in (info.get("formats") or []) if f.get("url")]
        heights = sorted(
            {
                int(f["height"])
                for f in formats
                if f.get("height") and f.get("vcodec") not in (None, "none") and int(f["height"]) <= settings.MAX_HEIGHT
            },
            reverse=True,
        )
        out: List[Dict[str, Any]] = []
        for h in heights:
            size, exact = estimate_ydl_entry_size(ydl, info, self.video_format(h))
            out.append({"id": str(h), "label": f"{h}p", "height": h, "ext": "mp4", "size": size, "size_is_exact": exact, "fits": size is None or size <= cap})
        size, exact = estimate_ydl_entry_size(ydl, info, self.AUDIO_FORMAT)
        has_m4a = any(f.get("vcodec") in (None, "none") and f.get("ext") == "m4a" for f in formats)
        out.append({"id": "audio", "label": "Audio only", "height": None, "ext": "m4a" if has_m4a else "webm", "size": size, "size_is_exact": exact, "fits": size is None or size <= cap})
        return out

    def _choose(self, options: List[Dict[str, Any]], quality: str) -> Dict[str, Any]:
        cap_mb = settings.MAX_DOWNLOAD_MB
        if quality == "auto":
            chosen = next((q for q in options if q["fits"]), None)
            if chosen is None:
                raise YoutubeExtractionError(f"Even audio only is over the {cap_mb} MB limit for this video.")
            return chosen
        chosen = next((q for q in options if q["id"] == quality), None)
        if chosen is None and quality.isdigit():
            # A height this video doesn't have: take the best one below it.
            chosen = next((q for q in options if q["height"] and q["height"] <= int(quality)), None)
        if chosen is None:
            raise InvalidYoutubeURLError("That quality isn't available for this video.")
        if not chosen["fits"]:
            raise YoutubeExtractionError(
                f"{chosen['label']} is about {chosen['size'] // (1024 * 1024)} MB, over the {cap_mb} MB limit. Pick a lower quality."
            )
        return chosen

    def download_to_disk(self, url: str, target_dir: Path, quality: str = "auto", max_seconds: int | None = None) -> List[Path]:
        """`max_seconds`: refuse longer videos before fetching anything (MP3 encoding has a length cap)."""
        valid_url = self.validate_url(url)
        target_dir.mkdir(parents=True, exist_ok=True)
        cap_mb = settings.MAX_DOWNLOAD_MB
        opts = {
            **self._get_base_ydl_opts(),
            "outtmpl": str(target_dir / "%(title).80B [%(id)s].%(ext)s"),
            "windowsfilenames": True,
            "merge_output_format": "mp4",
            "max_filesize": cap_mb * 1024 * 1024,
        }

        # Pass 1 reads the video and settles the quality (and so its size) before any bytes move.
        try:
            with yt_dlp.YoutubeDL({**self._get_base_ydl_opts(), "skip_download": True}) as probe:
                info = probe.extract_info(valid_url, download=False)
                if not info:
                    raise YoutubeExtractionError("No extractable media found at the provided YouTube URL.")
                duration = info.get("duration") or 0
                if max_seconds and duration > max_seconds:
                    raise YoutubeExtractionError(
                        f"MP3 is available for videos up to {max_seconds // 60} minutes (this one is {duration / 60:.0f}). "
                        "Choose M4A: it keeps the original sound and has no length limit."
                    )
                chosen = self._choose(self.qualities(probe, info), quality)
        except (YoutubeExtractionError, InvalidYoutubeURLError):
            raise
        except Exception as exc:
            logger.error("Failed to read YouTube video %s: %s", valid_url, exc)
            raise YoutubeExtractionError(self.friendly_error(exc, "Could not read that YouTube video. Make sure it's public and not a live stream."))

        # Pass 2 downloads with a fresh instance that knows the format from the start. YouTube's
        # extractor uses the requested format while it fetches stream URLs (client and PO token),
        # so reusing pass 1's URLs, or switching the format afterwards, gets HTTP 403.
        opts["format"] = self.AUDIO_FORMAT if chosen["id"] == "audio" else self.video_format(int(chosen["id"]))
        # YouTube now and then answers a fresh session's stream URL with HTTP 403; a new session
        # (new URLs) almost always works, so that case gets two more tries.
        for attempt in range(3):
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.extract_info(valid_url, download=True)
                break
            except Exception as exc:
                for leftover in target_dir.iterdir():
                    if leftover.is_file():
                        leftover.unlink(missing_ok=True)
                if "403" in str(exc) and attempt < 2:
                    logger.warning("YouTube refused a stream (403) for %s; retrying with a new session.", valid_url)
                    time.sleep(2 + attempt * 2)
                    continue
                logger.error("Failed to download YouTube media for %s: %s", valid_url, exc)
                raise YoutubeExtractionError("YouTube stopped the download partway. Try again, or pick a lower quality.")

        saved = [f for f in target_dir.iterdir() if f.is_file() and f.suffix.lower() in self.MEDIA_SUFFIXES and ".part" not in f.name]
        if not saved:
            # yt-dlp skips (rather than fails) a file once it passes max_filesize.
            raise YoutubeExtractionError(f"That quality turned out larger than {cap_mb} MB. Pick a lower one.")
        return saved


yt_service = YoutubeDownloaderService()
