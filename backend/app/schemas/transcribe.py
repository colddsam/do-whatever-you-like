from typing import List, Literal

from pydantic import BaseModel, Field


class TranscribeCapabilities(BaseModel):
    available: bool = Field(..., description="Whether a speech engine is ready on this server.")
    engine: Literal["local", "groq", "none"]
    model: str = Field(..., description="The Whisper model that will be used, e.g. 'small' or 'whisper-large-v3'.")
    private: bool = Field(..., description="True when audio never leaves this server.")
    languages: List[str] = Field(..., description="ISO 639-1 codes Whisper can recognise.")
    extensions: List[str]
    max_file_mb: int
    max_duration_seconds: int


"""
POST /transcribe answers with NDJSON: one JSON event per line, as the audio is worked through.

  {"type": "status", "stage": "queued" | "preparing" | "loading" | "transcribing"}
  {"type": "info", "language": "en", "language_probability": 0.98, "duration": 312.4, "engine": "local", "model": "small"}
  {"type": "segment", "id": 0, "start": 0.0, "end": 4.2, "text": "Hello and welcome."}
  {"type": "progress", "done": 120.5}
  {"type": "ping"}
  {"type": "done", "segments": 42, "elapsed": 61.3}
  {"type": "error", "detail": "…"}

Problems found before any audio is processed (bad file, too long) are plain 4xx JSON errors instead.
"""
