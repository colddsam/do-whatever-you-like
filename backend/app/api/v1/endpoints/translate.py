"""
Translator endpoints:
  GET  /translate/capabilities        — Supported languages, TTS support, and upload caps
  POST /translate/text                — Translate text or SRT/VTT subtitle text synchronously
  POST /translate/batch               — Translate an ordered list of cues/lines 1:1 (subtitles & transcripts)
  POST /translate/media               — Translate an audio or video file (streams NDJSON progress + transcripts)
  GET  /translate/result/{token}      — Download the translated audio or video file
"""

import asyncio
import json
import logging
import queue
import time
import uuid
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.config.translate import settings
from app.core.utils import cleanup_folder
from app.exceptions.translate import TranslatorUnavailableError
from app.schemas.translate import (
    BatchTranslateRequest,
    BatchTranslateResponse,
    TextTranslateRequest,
    TextTranslateResponse,
    TranslateCapabilities,
)
from app.services.translate import translate_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/translate", tags=["Translate"])

# One heavy media dubbing job per worker; extra requests queue gently.
_slots = asyncio.Semaphore(max(1, settings.CONCURRENCY))


def _line(event: dict) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")


@router.get("/capabilities", response_model=TranslateCapabilities, summary="Languages and engines ready for translation")
async def capabilities():
    return translate_service.capabilities()


@router.post("/text", response_model=TextTranslateResponse, summary="Translate plain text or subtitle text")
async def translate_text(req: TextTranslateRequest):
    return await run_in_threadpool(translate_service.translate_text, req.text, req.source, req.target, req.mode)


@router.post("/batch", response_model=BatchTranslateResponse, summary="Translate an ordered list of text lines or subtitle cues")
async def translate_batch(req: BatchTranslateRequest):
    return await run_in_threadpool(translate_service.translate_batch, req.texts, req.source, req.target)


@router.post(
    "/media",
    summary="Translate an audio or video recording (streams NDJSON progress and returns transcript + dubbed file token)",
    response_class=StreamingResponse,
)
async def translate_media(
    request: Request,
    file: UploadFile = File(..., description="Audio or video file"),
    source_language: str = Form("auto", description="Source language code or 'auto' to detect it"),
    target_language: str = Form(..., description="Target language code"),
    voice_gender: str = Form("female", description="Spoken voice style: 'female' or 'male'"),
    timing: str = Form("timed", description="'timed' syncs to the recording; 'fluent' reads straight through"),
    keep_background: bool = Form(False, description="Blend original sound quietly under the translated voice"),
    include_subtitles: bool = Form(True, description="For video files, embed translated captions as a soft subtitle track"),
):
    ext, src, dst = translate_service.validate_media_upload(
        file.filename, source_language, target_language, voice_gender, timing
    )
    speech_engine = translate_service.speech_engine()
    if speech_engine == "none":
        raise TranslatorUnavailableError("Speech recognition isn't set up on this server yet.")

    job_dir = settings.TEMP_DIR / f"tr_{uuid.uuid4().hex}"
    original_name = Path(file.filename or f"media{ext}").name
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        saved = job_dir / f"source{ext}"
        await run_in_threadpool(translate_service.save_upload, file.file, saved)
        await run_in_threadpool(translate_service.probe_upload, saved)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()

    return StreamingResponse(
        _media_events(
            request=request,
            source=saved,
            original_name=original_name,
            job_dir=job_dir,
            source_lang=src,
            target_lang=dst,
            voice_gender=voice_gender,
            timing=timing,
            keep_background=keep_background,
            include_subtitles=include_subtitles,
            speech_engine=speech_engine,
        ),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


async def _media_events(
    *,
    request: Request,
    source: Path,
    original_name: str,
    job_dir: Path,
    source_lang: str,
    target_lang: str,
    voice_gender: str,
    timing: str,
    keep_background: bool,
    include_subtitles: bool,
    speech_engine: str,
) -> AsyncIterator[bytes]:
    started = time.monotonic()
    proc = None
    token = ""
    completed = False
    try:
        if _slots.locked():
            yield _line({"type": "status", "stage": "queued"})
        async with _slots:
            if await request.is_disconnected():
                return
            proc, events, token = await run_in_threadpool(
                translate_service.start_media,
                source,
                original_name,
                job_dir,
                source_lang,
                target_lang,
                voice_gender,
                timing,
                keep_background,
                include_subtitles,
                speech_engine,
            )
            last = checked = time.monotonic()
            done_payload = None
            failed = False
            while True:
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
                        logger.error("Translate media process exited with %s", proc.exitcode)
                        yield _line({"type": "error", "detail": "The translation worker stopped. Try a shorter recording."})
                        return
                    if time.monotonic() - last >= settings.HEARTBEAT_SECONDS:
                        last = time.monotonic()
                        yield _line({"type": "ping"})
                    continue
                kind = event.get("type")
                if kind == "_end":
                    break
                if kind == "_done_file":
                    done_payload = event
                    continue
                if kind == "error":
                    failed = True
                last = time.monotonic()
                yield _line(event)

            if not failed and done_payload:
                await run_in_threadpool(translate_service.finalize_result, token, done_payload)
                completed = True
                yield _line({
                    "type": "done",
                    "source_text": done_payload["source_text"],
                    "translated_text": done_payload["translated_text"],
                    "detected_language": done_payload["detected_language"],
                    "detected_language_name": done_payload["detected_language_name"],
                    "target_language": done_payload["target_language"],
                    "target_language_name": done_payload["target_language_name"],
                    "media_kind": done_payload["media_kind"],
                    "segments": done_payload["segments"],
                    "result_token": token,
                    "result_name": done_payload["result_name"],
                    "result_type": done_payload["result_type"],
                    "result_size": done_payload["result_size"],
                    "duration": done_payload["duration"],
                    "provider": done_payload["provider"],
                    "tts_engine": done_payload["tts_engine"],
                    "elapsed": round(time.monotonic() - started, 1),
                })
    finally:
        if proc is not None and proc.is_alive():
            proc.terminate()
            proc.join(5)
        if token and not completed:
            translate_service.discard_result(token)
        cleanup_folder(job_dir)


@router.get("/result/{token}", response_class=FileResponse, summary="Download a translated audio or video file")
async def download_result(token: str):
    path, meta = await run_in_threadpool(translate_service.resolve_result, token)
    return FileResponse(path=path, filename=meta["name"], media_type=meta["type"])
