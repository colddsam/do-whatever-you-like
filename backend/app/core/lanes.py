"""
Shared concurrency lanes across all heavy endpoints (Universal converter, Whisper transcription,
media dubbing, Chromium HTML capture, PDF/ONNX worker pool).

Kept in its own module so both `isolation.py` subprocess workers and `pdf_pool.py` / streaming
endpoints share the exact same heavy gate without circular imports.
"""

import asyncio
from typing import Optional


class Lane:
    """A queue of slots. Tools that compete for the same memory share a lane."""

    def __init__(self, name: str, size: int) -> None:
        self.name = name
        self.size = max(1, size)
        self._slots: Optional[asyncio.Semaphore] = None

    def semaphore(self) -> asyncio.Semaphore:
        # Created lazily inside the running event loop.
        if self._slots is None:
            self._slots = asyncio.Semaphore(self.size)
        return self._slots


def _make_lanes():
    from app.config.jobs import settings

    return Lane("heavy", settings.HEAVY_CONCURRENCY), Lane("light", settings.LIGHT_CONCURRENCY)


heavy_lane, light_lane = _make_lanes()
