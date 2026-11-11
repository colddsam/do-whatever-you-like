"""
Speech to text: an audio or video file in, the words spoken in it out, with timings.

The answer streams as NDJSON (see app/schemas/transcribe.py) so people watch the transcript
grow instead of staring at a spinner for minutes, and a closed tab stops the work at once.
"""

import asyncio
import json
import logging
import queue
import time
import uuid
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.config.transcribe import settings
from app.core.utils import cleanup_folder
from app.exceptions.transcribe import TranscriberUnavailableError
from app.schemas.transcribe import TranscribeCapabilities
from app.services.transcribe import transcribe_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcribe", tags=["Transcribe"])

# Jobs beyond this wait their turn (per web worker); each one uses every core it can get.
_slots = asyncio.Semaphore(max(1, settings.CONCURRENCY))


def _line(event: dict) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")


@router.get("/capabilities", response_model=TranscribeCapabilities, summary="Which speech engine this server uses")
async def capabilities():
    return transcribe_service.capabilities()


@router.post(
    "",
    summary="Transcribe an audio or video file (streams NDJSON events)",
    response_class=StreamingResponse,
)
async def transcribe(
    request: Request,
    file: UploadFile = File(..., description="Audio or video file"),
    language: str = Form("auto", description="ISO 639-1 code, or 'auto' to detect it"),
    prompt: str = Form("", max_length=2000, description="Names and terms the speaker uses, to spell them right"),
):
    ext = transcribe_service.validate_filename(file.filename)
    lang = transcribe_service.validate_language(language)
    hint = transcribe_service.clean_prompt(prompt)
    engine = transcribe_service.engine()
    if engine == "none":
        raise TranscriberUnavailableError()

    job_dir = settings.TEMP_DIR / f"stt_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        source = job_dir / f"source{ext}"
        await run_in_threadpool(transcribe_service.save_upload, file.file, source)
        await run_in_threadpool(transcribe_service.probe, source)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()

    return StreamingResponse(
        _events(request, source, job_dir, lang, hint, engine),
        media_type="application/x-ndjson",
        # Tell buffering proxies (nginx-style) to pass each line on as it's written.
        headers={"X-Accel-Buffering": "no"},
    )


async def _events(
    request: Request, source: Path, job_dir: Path, language: Optional[str], prompt: str, engine: str
) -> AsyncIterator[bytes]:
    started = time.monotonic()
    proc = None
    try:
        if _slots.locked():
            yield _line({"type": "status", "stage": "queued"})
        async with _slots:
            if await request.is_disconnected():
                return
            proc, events = await run_in_threadpool(transcribe_service.start, source, job_dir, language, prompt, engine)
            last = checked = time.monotonic()
            segments = 0
            failed = False
            while True:
                # A busy stream never runs out of lines to send, so look for a closed tab on a timer too.
                if time.monotonic() - checked >= 1:
                    checked = time.monotonic()
                    if await request.is_disconnected():
                        return
                try:
                    event = await run_in_threadpool(events.get, True, 1.0)
                except queue.Empty:
                    if await request.is_disconnected():
                        return
                    if not proc.is_alive():
                        # Killed from outside, most likely out of memory.
                        logger.error("Transcription process exited with %s", proc.exitcode)
                        yield _line({"type": "error", "detail": "The speech engine stopped. Try a shorter recording."})
                        return
                    if time.monotonic() - last >= settings.HEARTBEAT_SECONDS:
                        last = time.monotonic()
                        yield _line({"type": "ping"})
                    continue
                kind = event.get("type")
                if kind == "_end":
                    break
                if kind == "segment":
                    segments += 1
                elif kind == "error":
                    failed = True
                last = time.monotonic()
                yield _line(event)
            if not failed:
                yield _line({"type": "done", "segments": segments, "elapsed": round(time.monotonic() - started, 1)})
    finally:
        # Runs when the stream ends, fails, or the client goes away (the generator is closed or
        # cancelled). Kept synchronous: awaiting here could be cancelled again before it finishes.
        if proc is not None and proc.is_alive():
            proc.terminate()
            proc.join(5)
        cleanup_folder(job_dir)
