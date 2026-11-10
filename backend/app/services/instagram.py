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

    def _load_netscape_cookies(self, cookie_path: Path):
        if not cookie_path.exists():
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
    def _parse_media_node(node: Dict[str, Any]) -> Dict[str, Any]:
        video_versions = node.get("video_versions") or []
        if video_versions:
            best_video = max(
                video_versions,
                key=lambda v: (v.get("width") or 0) * (v.get("height") or 0),
            )
            return {
                "type": "video",
                "url": best_video.get("url", ""),
                "width": best_video.get("width"),
                "height": best_video.get("height"),
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
        return {
            "type": "image",
            "url": best_image.get("url", ""),
            "width": best_image.get("width"),
            "height": best_image.get("height"),
        }

    def _fetch_product_info(self, shortcode: str) -> Dict[str, Any]:
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

    def fetch_media_metadata(self, url_or_shortcode: str) -> Dict[str, Any]:
        shortcode = self.extract_shortcode(url_or_shortcode=url_or_shortcode)
        product_info = self._fetch_product_info(shortcode)

        carousel_media = product_info.get("carousel_media") or []
        is_carousel = bool(carousel_media)
        nodes = carousel_media if is_carousel else [product_info]

        media_items: List[Dict[str, Any]] = [
            self._parse_media_node(node) for node in nodes
        ]

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

        return {
            "shortcode": shortcode,
            "title": caption_text[:120] if caption_text else "",
            "owner_username": owner_username,
            "is_carousel": is_carousel,
            "media_count": len(media_items),
            "estimated_size": estimated_size,
            "size_is_exact": estimated_size is not None,
            "items": media_items,
        }

    def download_to_disk(self, url_or_shortcode: str, target_dir: Path) -> List[Path]:
        target_dir.mkdir(parents=True, exist_ok=True)
        metadata = self.fetch_media_metadata(url_or_shortcode)
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
