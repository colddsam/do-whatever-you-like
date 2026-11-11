"""
HTML to image: a public web page (or pasted HTML) captured as a picture with headless Chromium.

Reuses the PDF converter's safety rails: every request the page makes is checked against private
addresses (`_guard_request`), and Chromium shares the LibreOffice slots so a small server never
runs two heavy browsers at once. Runs in a thread (Playwright's sync API), not in the PDF pool.
"""

import logging
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from PIL import Image

from app.config.image import settings
from app.exceptions.image import ImageProcessingError, ImageToolUnavailableError, InvalidImageError

logger = logging.getLogger(__name__)

SCREENS = {"mobile": 375, "tablet": 768, "laptop": 1280, "desktop": 1440, "hd": 1920}

# Requests to these hosts are dropped when "block ads" is on.
AD_HOSTS = (
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com", "googletagservices.com",
    "amazon-adsystem.com", "adnxs.com", "taboola.com", "outbrain.com", "criteo.com", "criteo.net", "pubmatic.com",
    "rubiconproject.com", "openx.net", "adsrvr.org", "moatads.com", "scorecardresearch.com", "quantserve.com",
    "media.net", "yieldmo.com", "zedo.com", "smartadserver.com", "teads.tv", "sharethrough.com", "bidswitch.net",
)

# Hides cookie banners, sign-up modals and sticky bars that would cover the capture.
POPUP_SCRIPT = """
() => {
  const vw = innerWidth, vh = innerHeight;
  const hint = /(cookie|consent|gdpr|banner|modal|popup|overlay|newsletter|subscribe|paywall|onetrust|didomi|cmp)/i;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    const big = r.width * r.height > vw * vh * 0.25;
    const named = hint.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : ''));
    if (big || named || parseInt(s.zIndex || '0', 10) > 999) el.style.setProperty('display', 'none', 'important');
  }
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    el.style.setProperty('overflow', 'auto', 'important');
    el.style.setProperty('position', 'static', 'important');
  }
}
"""


def _block_ads(route, request) -> None:
    from app.services.convert import _guard_request

    host = (urlparse(request.url).hostname or "").lower()
    if any(host == h or host.endswith("." + h) for h in AD_HOSTS):
        return route.abort("blockedbyclient")
    return _guard_request(route, request)


def html_to_image(
    out: Path,
    url: Optional[str],
    html: Optional[str],
    screen: str,
    full_page: bool,
    block_ads: bool,
    remove_popups: bool,
    fmt: str,
) -> dict:
    if screen not in SCREENS or fmt not in ("jpg", "png", "webp"):
        raise InvalidImageError("Pick a screen size and a format.")
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise ImageToolUnavailableError("Web page capture isn't available on this server yet.")
    from app.services.convert import _guard_request, _office_slots

    width = SCREENS[screen]
    timeout_ms = settings.HTML_TIMEOUT_SECONDS * 1000
    shot = out.with_suffix(".capture.png")
    if not _office_slots.acquire(timeout=120):
        raise ImageProcessingError("The capture service is busy. Try again in a minute.")
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
            except PlaywrightError as exc:
                logger.error("Chromium failed to start: %s", exc)
                raise ImageToolUnavailableError("Web page capture isn't available on this server yet.")
            try:
                context = browser.new_context(
                    viewport={"width": width, "height": 900},
                    device_scale_factor=1,
                    is_mobile=screen == "mobile",
                    has_touch=screen in ("mobile", "tablet"),
                    accept_downloads=False,
                    service_workers="block",
                )
                context.route("**/*", _block_ads if block_ads else _guard_request)
                page = context.new_page()
                page.set_default_timeout(timeout_ms)
                if url:
                    response = page.goto(url, wait_until="load", timeout=timeout_ms)
                    if response is not None and response.status >= 400:
                        raise InvalidImageError(f"That page answered with an error ({response.status}).")
                else:
                    page.set_content(html or "", wait_until="load", timeout=timeout_ms)
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except PlaywrightError:
                    pass
                if full_page:
                    # Scroll through once so lazy images load, then return to the top.
                    page.evaluate(
                        "async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, %d); y += innerHeight) "
                        "{ scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); }" % settings.HTML_MAX_HEIGHT
                    )
                    page.wait_for_timeout(400)
                if remove_popups:
                    page.evaluate(POPUP_SCRIPT)
                height = int(page.evaluate("Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)"))
                if full_page:
                    clip_h = max(1, min(height, settings.HTML_MAX_HEIGHT))
                    page.set_viewport_size({"width": width, "height": min(clip_h, 900)})
                    page.screenshot(path=str(shot), full_page=True, clip={"x": 0, "y": 0, "width": width, "height": clip_h})
                else:
                    page.screenshot(path=str(shot))
            finally:
                browser.close()
    except (InvalidImageError, ImageToolUnavailableError, ImageProcessingError):
        raise
    except Exception as exc:
        logger.error("HTML to image failed: %s", exc)
        message = str(exc)
        if "Timeout" in message:
            raise ImageProcessingError("That page took too long to load.")
        if "ERR_NAME_NOT_RESOLVED" in message or "ERR_CONNECTION" in message:
            raise InvalidImageError("That page couldn't be reached. Check the address.")
        if "blocked" in message.lower() or "ERR_FAILED" in message:
            raise InvalidImageError("That address isn't allowed. Use a public web page.")
        raise ImageProcessingError("That page couldn't be captured.")
    finally:
        _office_slots.release()

    with Image.open(shot) as img:
        img.load()
        size = img.size
        if fmt == "jpg":
            img.convert("RGB").save(out, "JPEG", quality=90, optimize=True, progressive=True)
        elif fmt == "webp":
            img.save(out, "WEBP", quality=88, method=5)
    # Moved or removed only once Pillow has let go of it (Windows won't touch an open file).
    if fmt == "png":
        shot.replace(out)
    else:
        shot.unlink(missing_ok=True)
    return {"width": size[0], "height": size[1], "truncated": full_page and height > settings.HTML_MAX_HEIGHT}
