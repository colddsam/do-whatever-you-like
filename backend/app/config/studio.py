from pathlib import Path
from typing import List

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class StudioSettings(BaseSettings):
    """
    The video editor (/tools/video-editor) runs in the browser; this service only proxies a few public
    hosts and, with a free LLM key, plans edits. Nothing here touches media, so it needs no temp files
    and almost no memory (well under the 80 MB the editor's budget allows on the 512 MB instance).
    """

    TEMP_DIR: Path = Path("./temp/studio")
    # Hosts the proxy fetches from: matched exactly or as a parent domain (pexels.com covers
    # videos.pexels.com). Google Fonts plus free stock libraries; never arbitrary sites.
    PROXY_HOSTS: List[str] = [
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "pexels.com",
        "pixabay.com",
        "unsplash.com",
        "wikimedia.org",
        "archive.org",
        "freesound.org",
        "mixkit.co",
        "coverr.co",
    ]
    PROXY_MAX_MB: int = 200
    PROXY_TIMEOUT: int = 25
    PROXY_MAX_REDIRECTS: int = 5

    # AI Director: a free Gemini key (https://aistudio.google.com/apikey) or Groq key
    # (https://console.groq.com). An existing translator/transcriber Groq key is reused if set.
    GEMINI_API_KEY: str = Field(default="", validation_alias=AliasChoices("STUDIO_GEMINI_API_KEY", "GEMINI_API_KEY"))
    # The "-latest" aliases follow Google's current models (older names get retired for new keys);
    # Flash-Lite answers in ~2 s, plenty for turning a request into a short JSON list.
    GEMINI_MODEL: str = Field(default="gemini-flash-lite-latest", validation_alias=AliasChoices("STUDIO_GEMINI_MODEL"))
    GROQ_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("STUDIO_GROQ_API_KEY", "TRANSLATE_GROQ_API_KEY", "TRANSCRIBE_GROQ_API_KEY", "GROQ_API_KEY"),
    )
    GROQ_MODEL: str = Field(default="llama-3.3-70b-versatile", validation_alias=AliasChoices("STUDIO_GROQ_MODEL"))
    # Per model call: up to three Gemini models then Groq must fit in the editor's 45 s wait.
    DIRECTOR_TIMEOUT: int = 12
    DIRECTOR_MAX_OPS: int = 30
    DIRECTOR_MAX_TIMELINE_CHARS: int = 60_000
    # Text-to-speech through Microsoft Edge's free online voices (the same engine the translator
    # dubs with). Nothing is stored: the MP3 and its word timings go straight back to the browser.
    TTS_MAX_CHARS: int = 2500
    TTS_TIMEOUT: int = 40
    TTS_MAX_MB: int = 8
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="STUDIO_", env_file=".env", env_file_encoding="utf-8", extra="ignore", populate_by_name=True)


settings = StudioSettings()
