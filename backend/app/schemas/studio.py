from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class DirectorRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000, examples=["Cut the pauses and add bold captions"])
    # A summary of the timeline built by the editor: tracks, clips (ids, names, times), selection.
    timeline: Dict[str, Any] = Field(default_factory=dict)


class DirectorResponse(BaseModel):
    # None when no AI key is configured: the editor then uses its built-in command parser.
    ops: Optional[List[Dict[str, Any]]] = None
    engine: str = Field(..., examples=["gemini", "groq", "none"])
    note: Optional[str] = None


class StudioCapabilities(BaseModel):
    director: Optional[str] = Field(None, examples=["gemini"])
    proxy_hosts: List[str]
    proxy_max_mb: int
    tts: bool = True
    tts_max_chars: int = 2500


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2500, examples=["Welcome back to the channel!"])
    voice: str = Field("en-US-AriaNeural", min_length=5, max_length=64, examples=["en-US-AriaNeural"])
    rate: int = Field(0, ge=-50, le=100, description="Speaking rate change in percent.")
    pitch: int = Field(0, ge=-50, le=50, description="Pitch change in hertz.")


class TtsWord(BaseModel):
    text: str
    start: float
    end: float


class TtsResponse(BaseModel):
    audio: str = Field(..., description="Base64-encoded MP3.")
    mime: str = "audio/mpeg"
    voice: str
    words: List[TtsWord]
