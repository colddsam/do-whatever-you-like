from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class MusicSettings(BaseSettings):
    """
    The music studio (/tools/music-studio) makes and mixes every sound in the browser. This service
    only asks a free LLM to plan a song (structure, chords, lyrics) or write lyrics, and returns
    small JSON. It stores nothing and touches no audio, so it needs no temp directory and adds
    almost nothing to the 512 MB Render budget. Vocals reuse the studio's free Edge-TTS endpoint.
    """

    # Groq first (fast, generous free tier: https://console.groq.com); any Groq key already set for
    # the translator, transcriber or video editor is reused. Gemini is the fallback.
    GROQ_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("MUSIC_GROQ_API_KEY", "STUDIO_GROQ_API_KEY", "TRANSLATE_GROQ_API_KEY", "TRANSCRIBE_GROQ_API_KEY", "GROQ_API_KEY"),
    )
    # Tried in order: when one model's daily quota runs out (429) or Groq retires it (404), the next
    # answers. Groq retired the Llama 3.x models in 2026; these are the free ones it serves now.
    GROQ_MODELS: str = Field(default="openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b", validation_alias=AliasChoices("MUSIC_GROQ_MODELS"))
    GEMINI_API_KEY: str = Field(default="", validation_alias=AliasChoices("MUSIC_GEMINI_API_KEY", "STUDIO_GEMINI_API_KEY", "GEMINI_API_KEY"))
    GEMINI_MODELS: str = Field(default="gemini-flash-lite-latest,gemini-flash-latest", validation_alias=AliasChoices("MUSIC_GEMINI_MODELS"))
    # Per model call; the browser waits up to 55 s for the whole chain.
    AI_TIMEOUT: int = 18
    MAX_BARS: int = 160
    MAX_SECTIONS: int = 14
    MAX_LINE_CHARS: int = 90
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="MUSIC_", env_file=".env", env_file_encoding="utf-8", extra="ignore", populate_by_name=True)


settings = MusicSettings()
