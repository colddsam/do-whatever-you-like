from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class LanguageItem(BaseModel):
    code: str
    name: str
    native_name: str
    rtl: bool = False
    tts_supported: bool = False
    speech_input: bool = False


class TranslateCapabilities(BaseModel):
    available: bool
    speech_available: bool
    speech_engine: Literal["local", "groq", "none"]
    tts_available: bool
    languages: List[LanguageItem]
    extensions: List[str]
    max_file_mb: int
    max_audio_seconds: int
    max_video_seconds: int
    max_text_chars: int
    llm_available: bool = False
    styles: List[str] = ["default"]
    insights_max_chars: int = 600
    speak_max_chars: int = 2000


class TextTranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=25_000, description="Text or SRT/VTT subtitle text to translate.")
    source: str = Field("auto", max_length=16, description="Source language code, or 'auto' to detect it.")
    target: str = Field(..., min_length=2, max_length=16, description="Target language code.")
    mode: Literal["text", "subtitles"] = Field(
        "text",
        description="Use 'subtitles' to preserve SRT/VTT timestamps when translating caption files.",
    )
    style: Literal["default", "formal", "casual", "simple", "natural"] = Field(
        "default",
        description="Tone of the translation. Anything but 'default' needs a Groq key on the server; without one it's ignored.",
    )


class TextTranslateResponse(BaseModel):
    source_text: str
    translated_text: str
    detected_language: str
    detected_language_name: str
    target_language: str
    target_language_name: str
    provider: str
    chars: int
    mode: Literal["text", "subtitles"] = "text"
    style: str = "default"


class DetectRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class DetectCandidate(BaseModel):
    code: str
    name: str
    confidence: float


class DetectResponse(BaseModel):
    language: str
    language_name: str
    confidence: float
    candidates: List[DetectCandidate]


class InsightsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    source: str = Field("auto", max_length=16)
    target: str = Field(..., min_length=2, max_length=16)


class InsightsAlternative(BaseModel):
    source: str
    options: List[str]


class InsightsDictEntry(BaseModel):
    word: str
    reverse: List[str]
    score: float = 0.0


class InsightsDictGroup(BaseModel):
    pos: str
    base: str = ""
    entries: List[InsightsDictEntry]


class InsightsDefinitionItem(BaseModel):
    gloss: str
    example: str = ""


class InsightsDefinition(BaseModel):
    pos: str
    items: List[InsightsDefinitionItem]


class InsightsSynonyms(BaseModel):
    pos: str
    words: List[str]


class InsightsResponse(BaseModel):
    text: str
    translation: str
    detected_language: str
    confidence: float
    source_romanization: str = ""
    target_romanization: str = ""
    alternatives: List[InsightsAlternative] = []
    dictionary: List[InsightsDictGroup] = []
    definitions: List[InsightsDefinition] = []
    examples: List[str] = []
    synonyms: List[InsightsSynonyms] = []
    did_you_mean: str = ""


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    language: str = Field(..., min_length=2, max_length=16)
    gender: Literal["female", "male"] = "female"
    rate: int = Field(0, ge=-50, le=100, description="Speaking rate change in percent.")


class BatchTranslateRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=500, description="Lines or subtitle cues to translate in order.")
    source: str = Field("auto", max_length=16, description="Source language code, or 'auto'.")
    target: str = Field(..., min_length=2, max_length=16, description="Target language code.")


class BatchTranslateResponse(BaseModel):
    source_texts: List[str]
    translated_texts: List[str]
    detected_language: str
    detected_language_name: str
    target_language: str
    target_language_name: str
    provider: str


class MediaSegmentPair(BaseModel):
    id: int
    start: float
    end: float
    source: str
    translated: str


"""
POST /translate/media streams NDJSON events as the audio or video is worked through:

  {"type": "status", "stage": "queued" | "preparing" | "loading" | "transcribing" | "translating" | "synthesizing" | "muxing"}
  {"type": "info", "language": "en", "target": "hi", "duration": 24.5, "media_kind": "video", "speech_engine": "local"}
  {"type": "segment", "id": 0, "start": 0.0, "end": 4.2, "source": "Hello.", "translated": "नमस्ते।"}
  {"type": "progress", "done": 12.0, "total": 24.5}
  {"type": "ping"}
  {"type": "done", "source_text": "...", "translated_text": "...", "detected_language": "en",
   "detected_language_name": "English", "target_language": "hi", "target_language_name": "Hindi",
   "media_kind": "video", "segments": [...], "result_token": "...", "result_name": "...",
   "result_type": "video/mp4", "result_size": 123456, "duration": 24.5, "elapsed": 12.3,
   "provider": "google_web", "tts_engine": "edge-tts"}
  {"type": "error", "detail": "..."}
"""
