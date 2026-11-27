from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class LyricsSearchRequest(BaseModel):
    text: str = Field(..., max_length=600, description="Lyrics you remember, even half-right.", examples=["is this the real life is this just fantasy"])


class SongMatch(BaseModel):
    title: str
    artist: str
    album: Optional[str] = None
    year: Optional[int] = None
    genre: Optional[str] = None
    duration_seconds: Optional[int] = None
    artwork: Optional[str] = Field(None, description="Cover art (600×600) from Apple's catalogue.")
    preview_url: Optional[str] = Field(None, description="A 30-second preview clip from Apple Music.")
    apple_url: Optional[str] = None
    lyrics: Optional[str] = Field(None, description="Plain lyrics from LRCLIB, when it has them.")
    synced_lyrics: Optional[str] = Field(None, description="Time-stamped LRC lyrics, when available.")
    matched_line: Optional[str] = Field(None, description="The line of the lyrics closest to what you gave.")
    confidence: float = Field(..., ge=0, le=1)
    verified: bool = Field(False, description="True when the song's real lyrics contain what was typed or heard.")
    source: Literal["lyrics", "melody", "audio"] = "lyrics"


class SongSearchResponse(BaseModel):
    input: Literal["text", "audio"]
    # words: lyrics were typed or heard; melody: only a tune was heard; none: nothing usable.
    kind: Literal["words", "melody", "none"]
    heard: Optional[str] = Field(None, description="What speech recognition heard in the clip.")
    matches: List[SongMatch] = []
    message: Optional[str] = None


class SongVideo(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    channel: Optional[str] = None
    duration_seconds: Optional[int] = None


class SongIdCapabilities(BaseModel):
    lyrics: bool
    audio: bool
    melody: bool
    max_clip_seconds: int
    max_file_mb: int
