"""Predicting how big a download will be, before anything is downloaded."""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)


def _bytes_from_tbr(fmt: Dict[str, Any], duration: Optional[float]) -> Optional[int]:
    """yt-dlp's tbr is in KBit/s; size ≈ tbr × duration."""
    tbr = fmt.get("tbr")
    if tbr and duration:
        return int(tbr * 1000 / 8 * duration)
    return None


def estimate_ydl_entry_size(ydl: Any, entry: Dict[str, Any], format_spec: str) -> Tuple[Optional[int], bool]:
    """
    Size of what `format_spec` would download for one extracted entry.

    Uses yt-dlp's own format selector, so the estimate is for the exact streams the download
    step picks (e.g. best video + best audio, merged), not the preview's progressive stream.
    Returns (bytes or None, exact). `exact` is False when any part is approximated.
    """
    formats = [f for f in (entry.get("formats") or []) if f.get("url")]
    duration = entry.get("duration")
    try:
        if formats:
            selector = ydl.build_format_selector(format_spec)
            selected = ydl._select_formats(formats, selector)
        else:
            selected = [entry]
    except Exception as exc:  
        logger.debug("Format selection for size estimate failed: %s", exc)
        return None, False
    if not selected:
        return None, False

    chosen = selected[0]
    parts = chosen.get("requested_formats") or [chosen]
    total = 0
    exact = True
    for part in parts:
        size = part.get("filesize")
        if not size:
            exact = False
            size = part.get("filesize_approx") or _bytes_from_tbr(part, duration)
        if not size:
            return None, False
        total += int(size)
    return total, exact


def sum_estimates(estimates: Iterable[Tuple[Optional[int], bool]]) -> Tuple[Optional[int], bool]:
    """Adds per-item estimates; unknown if any item is unknown."""
    total = 0
    exact = True
    for size, item_exact in estimates:
        if size is None:
            return None, False
        total += size
        exact = exact and item_exact
    return total, exact


def remote_sizes(
    session: requests.Session,
    urls: List[str],
    timeout: float = 6.0,
) -> List[Optional[int]]:
    """
    Content-Length of each URL, fetched in parallel. Tries HEAD first, then a one-byte
    ranged GET (whose Content-Range carries the full size). None where the size is unknown.
    Callers must only pass URLs they already trust (SSRF).
    """

    def one(url: str) -> Optional[int]:
        try:
            r = session.head(url, timeout=timeout, allow_redirects=False)
            if r.ok and r.headers.get("Content-Length", "").isdigit():
                return int(r.headers["Content-Length"])
            with session.get(
                url, headers={"Range": "bytes=0-0"}, timeout=timeout, stream=True, allow_redirects=False
            ) as g:
                total = (g.headers.get("Content-Range") or "").rpartition("/")[2]
                if g.status_code == 206 and total.isdigit():
                    return int(total)
                if g.ok and g.headers.get("Content-Length", "").isdigit():
                    return int(g.headers["Content-Length"])
        except Exception as exc:
            logger.debug("Size probe failed for a media URL: %s", exc)
        return None

    if not urls:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(urls))) as pool:
        return list(pool.map(one, urls))
