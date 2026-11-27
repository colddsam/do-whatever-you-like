"""
The song finder (/tools/song-finder): what song is this, from lyrics typed, sung or hummed.

GET  /songid/capabilities  what works on this server (needs a free Groq or Gemini key)
POST /songid/lyrics        {"text": "..."} → verified matches with lyrics, cover and preview
POST /songid/audio         a short clip (+ the notes the browser found in it) → matches
GET  /songid/video         ?title=&artist= → the song's YouTube video id, for an embed

Nothing heavy runs here: speech and the guesses come from free APIs, and the clip is deleted as
soon as the answer is sent.
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, Query, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config.songid import settings
from app.core.utils import cleanup_folder
from app.exceptions.base import AppBaseException
from app.exceptions.songid import SongIdProcessingError, SongIdUnavailableError
from app.schemas.songid import LyricsSearchRequest, SongIdCapabilities, SongSearchResponse, SongVideo
from app.services.songid import songid_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/songid", tags=["Song finder"])


@router.get("/capabilities", response_model=SongIdCapabilities, summary="What the song finder can do on this server")
async def capabilities():
    return songid_service.capabilities()


@router.post("/lyrics", response_model=SongSearchResponse, summary="Find a song from lyrics you remember")
async def search_lyrics(req: LyricsSearchRequest):
    text = songid_service.validate_text(req.text)
    try:
        matches = await run_in_threadpool(songid_service.search_text, text)
    except AppBaseException:
        raise
    except Exception as exc:
        logger.error("songid lyrics search failed: %s", exc)
        raise SongIdProcessingError()
    return {
        "input": "text",
        "kind": "words",
        "heard": None,
        "matches": matches,
        "message": None if matches else "No song matched those words. Try another line, or check the spelling.",
    }


@router.post("/audio", response_model=SongSearchResponse, summary="Find a song from a clip of singing, humming or music")
async def search_audio(
    file: UploadFile = File(..., description="A short recording (a few seconds is enough)."),
    notes: Optional[str] = Form(None, description='The tune the browser heard: JSON [{"m": MIDI pitch, "d": seconds}].'),
):
    ext = songid_service.validate_filename(file.filename)
    parsed = songid_service.parse_notes(notes)
    caps = songid_service.capabilities()
    if not caps["melody"]:
        raise SongIdUnavailableError("The song finder isn't set up on this server yet.")
    job_dir = settings.TEMP_DIR / f"sid_{uuid.uuid4().hex}"
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        source = await run_in_threadpool(songid_service.save_upload, file.file, job_dir / f"input{ext}")
        clip = job_dir / "clip.flac"
        await run_in_threadpool(songid_service.to_clip, source, clip)
        result = await run_in_threadpool(songid_service.search_audio, clip, parsed)
    except AppBaseException:
        raise
    except Exception as exc:
        logger.error("songid audio search failed: %s", exc)
        raise SongIdProcessingError()
    finally:
        await file.close()
        cleanup_folder(job_dir)  # Small and done with: removed before the answer goes out.

    message = None
    if not result["matches"]:
        if result["kind"] == "words":
            message = "We heard the words but couldn't match a song. Try another line, or type what you heard."
        elif result["kind"] == "melody":
            message = "We couldn't recognise that tune. Humming works best for well-known melodies; singing a few words works much better."
        else:
            message = "We couldn't hear a tune or words. Get closer to the microphone and try again for 5–10 seconds."
    return {"input": "audio", **result, "message": message}


@router.get("/video", response_model=SongVideo, summary="The song's video on YouTube")
async def video(
    title: str = Query(..., min_length=1, max_length=160),
    artist: str = Query("", max_length=160),
):
    try:
        return await run_in_threadpool(songid_service.video, title.strip(), artist.strip())
    except Exception as exc:
        logger.info("songid video failed: %s", exc)
        return {}
