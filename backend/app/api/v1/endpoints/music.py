"""
The music studio's AI helpers (/tools/music-studio). Everything audible is made in the browser;
these endpoints only return small JSON plans written by a free LLM.

GET  /music/capabilities  which AI is available (groq, gemini or null) and the genre ids
POST /music/compose       a description → a song plan (tempo, key, sections, chords, lyrics)
POST /music/lyrics        a topic → original lyrics by section

Vocals reuse POST /studio/tts (free Edge voices with word timings).
"""

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app.schemas.music import ComposeRequest, LyricsRequest, LyricsResponse, MusicCapabilities, SongPlan
from app.services.music import music_service

router = APIRouter(prefix="/music", tags=["Music studio"])


@router.get("/capabilities", response_model=MusicCapabilities, summary="What the music studio's AI helpers can do")
async def capabilities():
    return music_service.capabilities()


@router.post("/compose", response_model=SongPlan, summary="Plan a full song (structure, chords, lyrics) from a description")
async def compose(req: ComposeRequest):
    return await run_in_threadpool(music_service.compose, req.prompt, req.genre, req.mood, req.language, req.seconds, req.vocals, req.lyrics)


@router.post("/lyrics", response_model=LyricsResponse, summary="Write original lyrics for a topic")
async def lyrics(req: LyricsRequest):
    return await run_in_threadpool(music_service.lyrics, req.topic, req.genre, req.mood, req.language, req.structure)
