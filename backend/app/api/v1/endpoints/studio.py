"""
Helpers for the browser video editor (/tools/video-editor). The editor works on the user's device;
these endpoints never receive media.

GET  /studio/proxy?url=…   an allowlisted public file (Google Fonts, free stock media), streamed
GET  /studio/capabilities  which free AI engine the AI Director has (gemini, groq or null)
POST /studio/director      a plain-language request + timeline summary → timeline operations
POST /studio/tts           text → speech (MP3, base64) with word timings, via Edge's free voices
"""

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.schemas.studio import DirectorRequest, DirectorResponse, StudioCapabilities, TtsRequest, TtsResponse
from app.services.studio import studio_service

router = APIRouter(prefix="/studio", tags=["Video studio"])


@router.get("/proxy", summary="Fetch an allowlisted public font or stock-media file")
async def proxy(url: str = Query(..., min_length=8, max_length=2048)):
    resp, ctype, length = await run_in_threadpool(studio_service.open_proxy, url)
    headers = {"Content-Length": str(length)} if length else {}
    # A sync generator: Starlette iterates it in a worker thread, so the event loop stays free.
    return StreamingResponse(studio_service.stream(resp), media_type=ctype, headers=headers)


@router.get("/capabilities", response_model=StudioCapabilities, summary="What the editor's server helpers can do")
async def capabilities():
    return studio_service.capabilities()


@router.post("/director", response_model=DirectorResponse, summary="Turn a request into timeline operations")
async def director(req: DirectorRequest):
    return await run_in_threadpool(studio_service.plan, req.prompt, req.timeline)


@router.post("/tts", response_model=TtsResponse, summary="Text to speech with word timings (free Edge voices)")
async def tts(req: TtsRequest):
    return await run_in_threadpool(studio_service.tts, req.text, req.voice, req.rate, req.pitch)
