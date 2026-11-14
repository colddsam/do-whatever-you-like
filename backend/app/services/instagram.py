import logging
import re
import http.cookiejar
from pathlib import Path
from typing import List, Dict, Any
from urllib.parse import urlparse
import requests
import instaloader

from app.config.instagram import settings
from app.core.config import app_settings
from app.core.media_size import remote_sizes
from app.core.media_thumbnail import resolve_media_thumbnail
from app.exceptions.instagram import InvalidInstagramURLError, MediaExtractionError

logger = logging.getLogger(__name__)


class InstagramDownloaderService:
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    )
    API_HEADERS = {
        "X-IG-App-ID": "936619743392459",
        "X-ASBD-ID": "359341",
        "X-IG-WWW-Claim": "0",
        "Origin": "https://www.instagram.com",
        "Accept": "*/*",
    }
    ALLOWED_CDN_SUFFIXES = (".fbcdn.net", ".cdninstagram.com")

    def __init__(self):
        self.loader = instaloader.Instaloader(
            download_pictures=True,
            download_videos=True,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            quiet=True,
            user_agent=self.USER_AGENT,
            request_timeout=float(app_settings.REQUEST_TIMEOUT),
        )
        self._load_netscape_cookies(settings.COOKIE_FILE_PATH)

    def _load_netscape_cookies(self, cookie_path: Path | None):
        if not cookie_path or not cookie_path.exists():
            # Instagram's media API answers only signed-in sessions, so without cookies every post
            # fails. Say so once, loudly, rather than per request.
            logger.warning(
                "No Instagram session: INSTAGRAM_COOKIE_FILE_PATH (%s) doesn't exist. Instagram downloads will be refused "
                "until a cookies.txt from a signed-in browser is provided (see README, Cookie Configuration).",
                cookie_path,
            )
            return

        jar = http.cookiejar.MozillaCookieJar(str(cookie_path))
        try:
            jar.load(ignore_discard=True, ignore_expires=True)
            cookie_dict = {cookie.name: cookie.value for cookie in jar}
            if "sessionid" in cookie_dict:
                username = cookie_dict.get("ds_user_id", "user")
                self.loader.context.load_session(username, cookie_dict)
        except Exception as e:
            logger.warning("Failed to load Instagram cookies: %s", e)

    @staticmethod
    def extract_shortcode(url_or_shortcode: str) -> str:
        clean_input = url_or_shortcode.strip()
        if len(clean_input) > 512:
            raise InvalidInstagramURLError("Input exceeds maximum allowed length.")

        pattern = r"^(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{10,39})(?:[\/?#].*)?$"
        match = re.match(pattern, clean_input)
        if match:
            return match.group(1)

        if re.match(r"^[A-Za-z0-9_-]{10,39}$", clean_input):
            return clean_input

        raise InvalidInstagramURLError("Could not extract a valid shortcode from the input.")

    @classmethod
    def _is_trusted_cdn_url(cls, media_url: str) -> bool:
        """Ensure CDN downloads only target HTTPS Meta/Instagram CDN hosts (SSRF protection)."""
        try:
            parsed = urlparse(media_url)
            hostname = (parsed.hostname or "").lower()
            return parsed.scheme == "https" and any(
                hostname.endswith(suffix) for suffix in cls.ALLOWED_CDN_SUFFIXES
            )
        except Exception:
            return False

    @staticmethod
    def _shortcode_to_media_id(shortcode: str) -> int:
        base_shortcode = shortcode[:-28] if len(shortcode) > 28 else shortcode
        return instaloader.Post.shortcode_to_mediaid(base_shortcode)

    @staticmethod
    def _extract_node_thumbnails(node: Dict[str, Any]) -> List[str]:
        urls: List[str] = []

        def push(candidate: Any) -> None:
            if isinstance(candidate, str):
                cleaned = candidate.strip()
                if cleaned.startswith("https://") and cleaned not in urls:
                    urls.append(cleaned)

        image_versions = node.get("image_versions2") or {}
        candidates = sorted(
            image_versions.get("candidates") or [],
            key=lambda c: (c.get("width") or 0) * (c.get("height") or 0),
            reverse=True,
        )
        for cand in candidates:
            if isinstance(cand, dict):
                push(cand.get("url"))

        additional = image_versions.get("additional_candidates") or {}
        if isinstance(additional, dict):
            for key in ("first_frame", "igtv_first_frame", "smart_frame"):
                frame = additional.get(key)
                if isinstance(frame, dict):
                    push(frame.get("url"))

        push(node.get("display_url"))
        push(node.get("thumbnail_src"))
        push(node.get("thumbnail_url"))
        return urls

    @classmethod
    def _parse_media_node(cls, node: Dict[str, Any]) -> Dict[str, Any]:
        thumb_candidates = cls._extract_node_thumbnails(node)
        best_thumb = thumb_candidates[0] if thumb_candidates else None
        video_versions = node.get("video_versions") or []
        if video_versions:
            best_video = max(
                video_versions,
                key=lambda v: (v.get("width") or 0) * (v.get("height") or 0),
            )
            return {
                "type": "video",
                "url": best_video.get("url", ""),
                "thumbnail": best_thumb,
                "thumbnail_candidates": thumb_candidates,
                "width": best_video.get("width"),
                "height": best_video.get("height"),
                "duration": node.get("video_duration"),
            }

        candidates = (node.get("image_versions2") or {}).get("candidates") or []
        best_image = (
            max(
                candidates,
                key=lambda c: (c.get("width") or 0) * (c.get("height") or 0),
            )
            if candidates
            else {}
        )
        img_url = best_image.get("url", "") or (best_thumb or "")
        return {
            "type": "image",
            "url": img_url,
            "thumbnail": best_thumb or (img_url or None),
            "thumbnail_candidates": thumb_candidates,
            "width": best_image.get("width") or node.get("original_width"),
            "height": best_image.get("height") or node.get("original_height"),
            "duration": None,
        }

    NOT_SET_UP = (
        "Instagram downloads aren't set up on this server yet: Instagram only shares posts with a "
        "signed-in session, and none is configured."
    )
    EXPIRED = "The server's Instagram session has expired or was signed out. It needs a fresh cookies file."

    def _fetch_product_info(self, shortcode: str) -> Dict[str, Any]:
        if not self.loader.context.is_logged_in:
            raise MediaExtractionError(self.NOT_SET_UP)
        try:
            media_id = self._shortcode_to_media_id(shortcode)
            url = f"https://www.instagram.com/api/v1/media/{media_id}/info/"
            headers = {
                **self.API_HEADERS,
                "Referer": f"https://www.instagram.com/p/{shortcode}/",
            }
            resp = self.loader.context._session.get(
                url,
                headers=headers,
                timeout=app_settings.REQUEST_TIMEOUT,
            )
            if resp.status_code in (401, 403) or "login" in resp.url.split("?")[0]:
                logger.error("Instagram rejected the session (%s) for %s", resp.status_code, shortcode)
                raise MediaExtractionError(self.EXPIRED)
            if resp.status_code == 404:
                raise MediaExtractionError("That post doesn't exist, or it's private.")
            if resp.status_code == 429:
                raise MediaExtractionError("Instagram is rate-limiting this server. Try again in a few minutes.")
            if resp.status_code != 200:
                try:
                    err_msg = resp.json().get("message", "Upstream error")
                except Exception:
                    err_msg = "Upstream error"
                raise MediaExtractionError(
                    f"Instagram API returned {resp.status_code}: {err_msg}"
                )

            data = resp.json()
            items = data.get("items") or []
            if not items:
                raise MediaExtractionError("No media items found for this post.")
            return items[0]
        except MediaExtractionError:
            raise
        except Exception as exc:
            logger.error("Failed to retrieve Instagram post %s: %s", shortcode, exc)
            raise MediaExtractionError("Failed to retrieve post metadata from Instagram.")

    def fetch_media_metadata(self, url_or_shortcode: str, *, resolve_thumbnail: bool = True) -> Dict[str, Any]:
        shortcode = self.extract_shortcode(url_or_shortcode=url_or_shortcode)
        product_info = self._fetch_product_info(shortcode)

        carousel_media = product_info.get("carousel_media") or []
        is_carousel = bool(carousel_media)
        nodes = carousel_media if is_carousel else [product_info]

        media_items: List[Dict[str, Any]] = [
            self._parse_media_node(node) for node in nodes
        ]

        all_thumb_candidates: List[str] = []
        for item in media_items:
            for cand in item.pop("thumbnail_candidates", []):
                if cand not in all_thumb_candidates:
                    all_thumb_candidates.append(cand)
        for cand in self._extract_node_thumbnails(product_info):
            if cand not in all_thumb_candidates:
                all_thumb_candidates.append(cand)

        caption_dict = product_info.get("caption") or {}
        caption_text = caption_dict.get("text") or ""
        user_dict = product_info.get("user") or {}
        owner_username = user_dict.get("username") or ""
        trusted = [i["url"] for i in media_items if i.get("url") and self._is_trusted_cdn_url(i["url"])]
        with requests.Session() as probe:
            probe.headers.update(
                {"User-Agent": self.USER_AGENT, "Accept": "*/*", "Referer": "https://www.instagram.com/"}
            )
            sizes = dict(zip(trusted, remote_sizes(probe, trusted)))
        for item in media_items:
            item["size"] = sizes.get(item.get("url") or "")
        known = [i["size"] for i in media_items]
        estimated_size = sum(known) if known and all(s is not None for s in known) else None

        first_video_url = next(
            (i["url"] for i in media_items if i.get("type") == "video" and i.get("url")),
            None,
        )
        resolved_thumb = (
            resolve_media_thumbnail(
                all_thumb_candidates,
                allowed_suffixes=self.ALLOWED_CDN_SUFFIXES,
                user_agent=self.USER_AGENT,
                video_url=first_video_url,
                referer="https://www.instagram.com/",
            )
            if resolve_thumbnail
            else (all_thumb_candidates[0] if all_thumb_candidates else None)
        )
        if media_items and resolved_thumb:
            media_items[0]["thumbnail"] = resolved_thumb

        duration = product_info.get("video_duration") or next(
            (i.get("duration") for i in media_items if i.get("duration")),
            None,
        )

        return {
            "shortcode": shortcode,
            "title": caption_text[:120] if caption_text else "",
            "owner_username": owner_username,
            "is_carousel": is_carousel,
            "media_count": len(media_items),
            "thumbnail": resolved_thumb,
            "duration": duration,
            "estimated_size": estimated_size,
            "size_is_exact": estimated_size is not None,
            "items": media_items,
        }

    def download_to_disk(self, url_or_shortcode: str, target_dir: Path) -> List[Path]:
        target_dir.mkdir(parents=True, exist_ok=True)
        metadata = self.fetch_media_metadata(url_or_shortcode, resolve_thumbnail=False)
        shortcode = metadata["shortcode"]
        saved_files: List[Path] = []
        max_bytes = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024

        cdn_headers = {
            "User-Agent": self.USER_AGENT,
            "Accept": "*/*",
            "Referer": "https://www.instagram.com/",
        }

        try:
            with requests.Session() as cdn_session:
                cdn_session.headers.update(cdn_headers)
                for idx, item in enumerate(metadata["items"], start=1):
                    media_url = item.get("url")
                    if not media_url:
                        continue

                    if not self._is_trusted_cdn_url(media_url):
                        raise MediaExtractionError("Untrusted media host detected.")

                    url_ext = Path(urlparse(media_url).path).suffix.lower()
                    if item.get("type") == "video":
                        ext = url_ext if url_ext in {".mp4", ".mov"} else ".mp4"
                    else:
                        ext = url_ext if url_ext in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"

                    file_path = target_dir / f"{shortcode}_{idx}{ext}"

                    with cdn_session.get(
                        media_url,
                        stream=True,
                        timeout=app_settings.REQUEST_TIMEOUT,
                        allow_redirects=False,
                    ) as resp:
                        resp.raise_for_status()
                        downloaded_bytes = 0
                        with open(file_path, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=8192):
                                if chunk:
                                    downloaded_bytes += len(chunk)
                                    if downloaded_bytes > max_bytes:
                                        raise MediaExtractionError(
                                            f"Media file exceeds maximum allowed size ({app_settings.MAX_DOWNLOAD_SIZE_MB} MB)."
                                        )
                                    f.write(chunk)
                    saved_files.append(file_path)
        except MediaExtractionError:
            raise
        except Exception as exc:
            logger.error("Failed downloading media for %s: %s", shortcode, exc)
            raise MediaExtractionError("Failed to download media stream from CDN.")

        return saved_files


ig_service = InstagramDownloaderService()
