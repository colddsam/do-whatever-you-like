import base64
import logging
import subprocess
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests

from app.services.ffmpeg_service import init_ffmpeg

logger = logging.getLogger(__name__)

MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
MAX_REDIRECT_HOPS = 3
MIN_IMAGE_BYTES = 200


def is_trusted_media_host(url: str, allowed_suffixes: Tuple[str, ...]) -> bool:
    """Enforce HTTPS and restrict remote fetches to an explicit CDN hostname allowlist (SSRF protection)."""
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme != "https":
            return False
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False
        return any(
            hostname == suffix.lstrip(".") or hostname.endswith(suffix)
            for suffix in allowed_suffixes
        )
    except Exception:
        return False


def _sniff_image_mime(data: bytes, content_type: str = "") -> Optional[str]:
    """Verify image payload using file signatures before base64 encoding."""
    if len(data) < MIN_IMAGE_BYTES:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:4] in (b"GIF8",):
        return "image/gif"
    ct = content_type.split(";")[0].strip().lower()
    if ct in {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}:
        return "image/jpeg" if ct == "image/jpg" else ct
    return None


def collect_ydl_thumbnails(info: Dict[str, Any], youtube_id: Optional[str] = None) -> List[str]:
    """
    Collect candidate thumbnail URLs from a yt-dlp info dictionary in priority order.
    Prefers high-resolution JPEG/PNG URLs and includes guaranteed YouTube i.ytimg.com fallbacks.
    """
    raw: List[str] = []

    def add_url(candidate: Any) -> None:
        if isinstance(candidate, str):
            trimmed = candidate.strip()
            if trimmed.startswith("https://") and trimmed not in raw:
                raw.append(trimmed)

    def collect_from_dict(d: Dict[str, Any]) -> None:
        top = d.get("thumbnail")
        thumbs = d.get("thumbnails") or []
        non_webp: List[str] = []
        webp_urls: List[str] = []
        for entry in reversed(thumbs):
            if not isinstance(entry, dict):
                continue
            u = entry.get("url")
            if not isinstance(u, str) or not u.startswith("https://"):
                continue
            path_lower = urlparse(u).path.lower()
            if path_lower.endswith(".webp") or "/vi_webp/" in path_lower:
                webp_urls.append(u)
            else:
                non_webp.append(u)

        # If yt-dlp picked a .webp thumbnail (common on YouTube Shorts where maxresdefault.webp 404s),
        # try JPEG candidates first when available, then the top-level thumbnail, then webp candidates.
        for u in non_webp:
            add_url(u)
        add_url(top)
        for u in webp_urls:
            add_url(u)

    collect_from_dict(info)

    entries = info.get("entries") or []
    for entry in entries:
        if isinstance(entry, dict):
            collect_from_dict(entry)
            break

    if youtube_id:
        for variant in ("maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg", "mqdefault.jpg"):
            add_url(f"https://i.ytimg.com/vi/{youtube_id}/{variant}")

    return raw


def _fetch_single_image(
    url: str,
    allowed_suffixes: Tuple[str, ...],
    session: requests.Session,
    timeout: float,
    max_bytes: int,
) -> Optional[str]:
    current_url = url
    for _ in range(MAX_REDIRECT_HOPS + 1):
        if not is_trusted_media_host(current_url, allowed_suffixes):
            return None
        try:
            with session.get(
                current_url,
                stream=True,
                timeout=timeout,
                allow_redirects=False,
            ) as resp:
                if resp.status_code in {301, 302, 303, 307, 308}:
                    location = resp.headers.get("Location")
                    if not location:
                        return None
                    current_url = urljoin(current_url, location)
                    continue
                if resp.status_code != 200:
                    return None

                content_length = resp.headers.get("Content-Length")
                if content_length and content_length.isdigit() and int(content_length) > max_bytes:
                    return None

                chunks = bytearray()
                for chunk in resp.iter_content(chunk_size=16384):
                    if not chunk:
                        continue
                    chunks.extend(chunk)
                    if len(chunks) > max_bytes:
                        return None

                raw_bytes = bytes(chunks)
                mime = _sniff_image_mime(raw_bytes, resp.headers.get("Content-Type", ""))
                if not mime:
                    return None
                encoded = base64.b64encode(raw_bytes).decode("ascii")
                return f"data:{mime};base64,{encoded}"
        except Exception as exc:
            logger.debug("Thumbnail fetch failed for %s: %s", current_url, exc)
            return None
    return None


def fetch_thumbnail_data_url(
    candidates: Iterable[str],
    allowed_suffixes: Tuple[str, ...],
    user_agent: str,
    referer: Optional[str] = None,
    timeout: float = 5.0,
    max_bytes: int = MAX_THUMBNAIL_BYTES,
) -> Optional[str]:
    """Fetch the first valid thumbnail candidate server-side and return a data URI."""
    headers = {
        "User-Agent": user_agent,
        "Accept": "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer

    with requests.Session() as session:
        session.headers.update(headers)
        for url in candidates:
            if not url or not is_trusted_media_host(url, allowed_suffixes):
                continue
            data_url = _fetch_single_image(url, allowed_suffixes, session, timeout, max_bytes)
            if data_url:
                return data_url
    return None


def extract_video_frame_data_url(
    video_url: Optional[str],
    allowed_suffixes: Tuple[str, ...],
    user_agent: str,
    referer: Optional[str] = None,
    timeout: float = 8.0,
) -> Optional[str]:
    """Fallback: grab a single scaled JPEG frame from the remote video stream using ffmpeg."""
    if not video_url or not is_trusted_media_host(video_url, allowed_suffixes):
        return None
    try:
        init_ffmpeg()
        cmd = [
            "ffmpeg",
            "-loglevel",
            "error",
            "-user_agent",
            user_agent,
        ]
        if referer:
            cmd.extend(["-headers", f"Referer: {referer}\r\n"])
        cmd.extend(
            [
                "-ss",
                "00:00:00.1",
                "-i",
                video_url,
                "-frames:v",
                "1",
                "-vf",
                "scale='min(640,iw)':-2",
                "-q:v",
                "5",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "pipe:1",
            ]
        )
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout and proc.stdout[:3] == b"\xff\xd8\xff" and len(proc.stdout) >= MIN_IMAGE_BYTES:
            encoded = base64.b64encode(proc.stdout).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}"
    except Exception as exc:
        logger.debug("ffmpeg frame extraction skipped for %s: %s", video_url, exc)
    return None


def resolve_media_thumbnail(
    candidates: Iterable[str],
    allowed_suffixes: Tuple[str, ...],
    user_agent: str,
    video_url: Optional[str] = None,
    referer: Optional[str] = None,
) -> Optional[str]:
    """
    Resolve a browser-safe thumbnail (preferring a data URI so Meta CORP / 404s never break <img>):
    1. Fetch the first working candidate image server-side.
    2. If all image candidates fail or are absent, extract one frame from video_url with ffmpeg.
    3. Fall back to the first trusted candidate URL if frame extraction also fails.
    """
    candidate_list = [u for u in candidates if isinstance(u, str) and is_trusted_media_host(u, allowed_suffixes)]
    data_url = fetch_thumbnail_data_url(
        candidate_list,
        allowed_suffixes=allowed_suffixes,
        user_agent=user_agent,
        referer=referer,
    )
    if data_url:
        return data_url

    frame_url = extract_video_frame_data_url(
        video_url,
        allowed_suffixes=allowed_suffixes,
        user_agent=user_agent,
        referer=referer,
    )
    if frame_url:
        return frame_url

    return candidate_list[0] if candidate_list else None
