from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class SongIdSettings(BaseSettings):
    """
    The song finder (/tools/song-finder): name a song from lyrics you type, sing or hum.

    Nothing heavy runs here. Free services do the work: Groq's Whisper hears the words, a free LLM
    (Groq, then Gemini) suggests songs, and every suggestion is checked against the real catalogue
    (iTunes Search, no key) and real lyrics (LRCLIB, no key) before it is shown. The browser finds
    the notes of a hummed tune itself, so this server only ever sees a short clip and some JSON.
    It fits Render's free 512 MB plan and keeps nothing.
    """

    TEMP_DIR: Path = Path("./temp/songid")

    # Any Groq key already set for the translator, transcriber, music studio or video editor is reused.
    GROQ_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SONGID_GROQ_API_KEY", "MUSIC_GROQ_API_KEY", "STUDIO_GROQ_API_KEY", "TRANSLATE_GROQ_API_KEY", "TRANSCRIBE_GROQ_API_KEY", "GROQ_API_KEY",
        ),
    )
    GROQ_MODELS: str = Field(default="openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b", validation_alias=AliasChoices("SONGID_GROQ_MODELS"))
    GROQ_WHISPER_MODEL: str = Field(default="whisper-large-v3", validation_alias=AliasChoices("SONGID_GROQ_WHISPER_MODEL"))
    GEMINI_API_KEY: str = Field(
        default="", validation_alias=AliasChoices("SONGID_GEMINI_API_KEY", "MUSIC_GEMINI_API_KEY", "STUDIO_GEMINI_API_KEY", "GEMINI_API_KEY"),
    )
    GEMINI_MODELS: str = Field(default="gemini-flash-lite-latest,gemini-flash-latest", validation_alias=AliasChoices("SONGID_GEMINI_MODELS"))
    # Gemini can listen to a hummed clip. The lite model guesses confidently and wrongly, so only
    # the full model is asked, and only as an extra opinion when no words were heard.
    GEMINI_AUDIO_MODELS: str = Field(default="gemini-flash-latest", validation_alias=AliasChoices("SONGID_GEMINI_AUDIO_MODELS"))

    MAX_FILE_MB: int = 10
    # Longer clips are cut: a chorus line is plenty, and it keeps the free Whisper quota.
    MAX_CLIP_SECONDS: int = 30
    MIN_CLIP_SECONDS: float = 1.5
    MAX_CANDIDATES: int = 5
    AI_TIMEOUT: int = 15
    AUDIO_AI_TIMEOUT: int = 20
    LOOKUP_TIMEOUT: int = 8
    WHISPER_TIMEOUT: int = 40
    # Where iTunes looks songs up first; "US" has the widest catalogue, "IN" is tried when it misses.
    ITUNES_COUNTRIES: str = "US,IN,GB"
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="SONGID_", env_file=".env", env_file_encoding="utf-8", extra="ignore", populate_by_name=True)


settings = SongIdSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
