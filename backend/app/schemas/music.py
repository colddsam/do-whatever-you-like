from typing import List, Optional

from pydantic import BaseModel, Field


class ComposeRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=600, examples=["An upbeat summer pop song about road trips with friends"])
    genre: Optional[str] = Field(None, max_length=24, examples=["pop"])
    mood: Optional[str] = Field(None, max_length=40, examples=["happy"])
    language: str = Field("English", min_length=2, max_length=24)
    seconds: int = Field(120, ge=15, le=420, description="Target length of the song.")
    vocals: bool = True
    # The user's own lyrics: the AI arranges the song around them instead of writing new ones.
    lyrics: Optional[str] = Field(None, max_length=4000)


class LyricsRequest(BaseModel):
    topic: str = Field(..., min_length=2, max_length=400, examples=["Missing home on a rainy night"])
    genre: Optional[str] = Field(None, max_length=24)
    mood: Optional[str] = Field(None, max_length=40)
    language: str = Field("English", min_length=2, max_length=24)
    structure: str = Field("verse,chorus,verse,chorus,bridge,chorus", max_length=120)


class SongSection(BaseModel):
    name: str
    bars: int
    chords: List[str]
    energy: int
    lyrics: List[str] = []


class SongInstruments(BaseModel):
    drums: str
    bass: str
    chords: str
    lead: str
    pad: Optional[str] = None


class SongPlan(BaseModel):
    title: str
    genre: str
    mood: str
    bpm: int
    key: str
    mode: str
    vocal: str = Field(..., examples=["sung", "rap", "none"])
    instruments: SongInstruments
    sections: List[SongSection]
    engine: str = Field(..., examples=["groq", "gemini"])


class LyricsSection(BaseModel):
    name: str
    lines: List[str]


class LyricsResponse(BaseModel):
    title: str
    sections: List[LyricsSection]
    engine: str


class MusicCapabilities(BaseModel):
    ai: Optional[str] = Field(None, examples=["groq"])
    tts: bool = True
    genres: List[str]
