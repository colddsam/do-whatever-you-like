"""
Runs PyMuPDF work in separate processes.

PyMuPDF holds the GIL inside long C calls (rewriting the images of a 4 MB scan blocks for ~10 s).
Run in a thread, that freezes the worker's event loop: every other request stalls, and under
`uvicorn --workers N` the supervisor's health check times out and kills the worker mid-request.
A process pool keeps the web workers responsive no matter how heavy the PDF is.
"""

import asyncio
import logging
import multiprocessing
import os
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any, Optional

from fastapi import Request

from app.config.pdf import settings
from app.exceptions.base import AppBaseException
from app.exceptions.pdf import PDFProcessingError

logger = logging.getLogger(__name__)

_pool: Optional[ProcessPoolExecutor] = None


class ClientDisconnected(AppBaseException):
    def __init__(self) -> None:
        super().__init__(detail="Client closed the request.", status_code=499)


def _exit_with_parent() -> None:
    """
    Pool initializer. If the web worker that owns this pool dies (uvicorn kills hung workers with
    TerminateProcess on Windows), its pool processes would otherwise live on as orphans holding
    memory. Watch the parent and leave as soon as it's gone.
    """
    parent = multiprocessing.parent_process()
    if parent is None:
        return

    def watch() -> None:
        while parent.is_alive():
            time.sleep(2)
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(
            max_workers=settings.PROCESS_WORKERS,
            mp_context=multiprocessing.get_context("spawn"),
            initializer=_exit_with_parent,

        )
    return _pool


def warm_pool() -> None:
    """
    Starts the pool's process at boot, without waiting for it, so the first PDF request doesn't
    pay for spawning it (importing PyMuPDF and the app takes seconds on a busy machine).
    """
    try:
        _get_pool().submit(os.getpid)
    except Exception as exc:
        logger.warning("Couldn't pre-start the PDF process pool: %s", exc)


def shutdown_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.shutdown(wait=False, cancel_futures=True)
        _pool = None


def _invoke(method: str, args: tuple) -> tuple:
    """Runs in the child process. App errors travel back as plain data (they don't pickle cleanly)."""
    from app.services.pdf import pdf_service

    try:
        return ("ok", getattr(pdf_service, method)(*args))
    except AppBaseException as exc:
        return ("error", exc.status_code, exc.detail)


async def run_pdf(method: str, *args: Any, request: Optional[Request] = None) -> Any:
    """
    Calls `pdf_service.<method>(*args)` in the process pool.

    With `request`, gives up as soon as the client disconnects (a moved slider, a closed tab):
    work that hasn't started yet is cancelled, so abandoned estimates don't queue up.
    """
    loop = asyncio.get_running_loop()
    try:
        fut = loop.run_in_executor(_get_pool(), _invoke, method, args)
        if request is not None:
            while True:
                done, _ = await asyncio.wait({fut}, timeout=0.25)
                if done:
                    break
                if await request.is_disconnected():
                    fut.cancel()
                    raise ClientDisconnected()
        result = await fut
    except BrokenProcessPool:
        logger.error("PDF worker process died while running %s", method)
        shutdown_pool()
        raise PDFProcessingError("The PDF couldn't be processed. It may be damaged.")

    if result[0] == "error":
        raise AppBaseException(detail=result[2], status_code=result[1])
    return result[1]
