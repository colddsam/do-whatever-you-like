"""
Runs one job in a child process of its own:

    python -m app.core.job_worker <job_dir>/job.json

job.json names an entry point ("package.module:function") and its payload. The function runs in the
child, returns a dict (usually {"path": ..., "notes": [...]}) and may raise AppBaseException
subclasses; the child writes the outcome to result.json. The web process only waits: on timeout or
when the person cancels, the child is killed together with everything it started (LibreOffice,
FFmpeg…). So one bad file can never block, crash or slow another request beyond its queue slot.
"""

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple, Type

from fastapi import Request

from app.config.jobs import settings
from app.exceptions.base import AppBaseException
from app.services.pdf_pool import ClientDisconnected

logger = logging.getLogger(__name__)

# The folder that holds the `app` package, so `python -m app.core.job_worker` resolves.
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Lane:
    """A queue of slots. Tools that compete for the same memory share a lane."""

    def __init__(self, name: str, size: int) -> None:
        self.name = name
        self.size = max(1, size)
        self._slots: Optional[asyncio.Semaphore] = None

    def semaphore(self) -> asyncio.Semaphore:
        # Created lazily, inside the running event loop.
        if self._slots is None:
            self._slots = asyncio.Semaphore(self.size)
        return self._slots


heavy_lane = Lane("heavy", settings.HEAVY_CONCURRENCY)
light_lane = Lane("light", settings.LIGHT_CONCURRENCY)

# (bad input → 400, processing failed → 422, unavailable → 503) for the tool that's asking.
Errors = Tuple[Type[AppBaseException], Type[AppBaseException], Type[AppBaseException]]


async def run_isolated(
    job_dir: Path,
    entry: str,
    payload: dict,
    *,
    lane: Lane,
    timeout: int,
    errors: Errors,
    request: Optional[Request] = None,
    busy: str = "The server is busy with other files. Try again in a minute.",
    too_long: str = "That took too long and was stopped. Try a smaller file.",
) -> dict:
    invalid, failed, unavailable = errors
    job_dir.mkdir(parents=True, exist_ok=True)
    job = {"entry": entry, "payload": payload, "result": str((job_dir / "result.json").resolve())}
    (job_dir / "job.json").write_text(json.dumps(job), encoding="utf-8")

    slots = lane.semaphore()
    try:
        await asyncio.wait_for(slots.acquire(), timeout=settings.QUEUE_WAIT_SECONDS)
    except asyncio.TimeoutError:
        raise unavailable(busy)
    try:
        await _run_child(job_dir, timeout, request, failed, unavailable, too_long)
    finally:
        slots.release()

    result_file = job_dir / "result.json"
    if not result_file.is_file():
        log = job_dir / "worker.log"
        logger.error("Job %s ended without a result: %s", entry, log.read_text(encoding="utf-8", errors="replace")[-1500:] if log.exists() else "")
        raise failed("The job stopped unexpectedly (the file may be too big for this server). Try a smaller file.")
    result = json.loads(result_file.read_text(encoding="utf-8"))
    if not result.get("ok"):
        status = int(result.get("status") or 422)
        detail = str(result.get("detail") or "That file couldn't be processed.")
        if status == 503:
            raise unavailable(detail)
        if 400 <= status < 422:
            raise invalid(detail)
        raise failed(detail)
    return result


async def _run_child(job_dir: Path, timeout: int, request: Optional[Request], failed, unavailable, too_long: str) -> None:
    log = open(job_dir / "worker.log", "wb")
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        # Its own process group, so killing it also kills the LibreOffice/FFmpeg it started.
        kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.core.job_worker", str((job_dir / "job.json").resolve())],
            cwd=str(BACKEND_ROOT),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            **kwargs,
        )
    except OSError as exc:
        log.close()
        logger.error("Couldn't start a job worker: %s", exc)
        raise unavailable("The server couldn't start the job. Try again in a minute.")
    deadline = time.monotonic() + timeout
    try:
        while proc.poll() is None:
            if time.monotonic() > deadline:
                kill_tree(proc)
                raise failed(too_long)
            if request is not None and await request.is_disconnected():
                kill_tree(proc)
                raise ClientDisconnected()
            await asyncio.sleep(0.25)
    except asyncio.CancelledError:
        kill_tree(proc)
        raise
    finally:
        log.close()


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                capture_output=True,
                timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except Exception as exc:
        logger.warning("Couldn't stop worker %s cleanly: %s", proc.pid, exc)
        proc.kill()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
