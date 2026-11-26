from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class TranslateSettings(BaseSettings):
    APP_NAME: str = "Translator Service"
    TEMP_DIR: Path = Path("./temp/translate")
    MAX_FILE_MB: int = 150
    AUDIO_MAX_SECONDS: int = 30 * 60
    VIDEO_MAX_SECONDS: int = 10 * 60
    MAX_TEXT_CHARS: int = 25_000
    MAX_BATCH_ITEMS: int = 500
    MAX_BATCH_CHARS: int = 60_000

    CONCURRENCY: int = 1
    HEARTBEAT_SECONDS: int = 10
    REQUEST_TIMEOUT: int = 20
    RESULT_TTL_SECONDS: int = 20 * 60
    MAX_CACHE_BYTES: int = 350 * 1024 * 1024

    # Optional free-tier boosters; everything still works without any key or email.
    MYMEMORY_EMAIL: str = ""
    LIBRETRANSLATE_URL: str = ""
    LIBRETRANSLATE_API_KEY: str = ""
    # Reuses whichever Groq key the other tools were given.
    GROQ_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("TRANSLATE_GROQ_API_KEY", "STUDIO_GROQ_API_KEY", "MUSIC_GROQ_API_KEY", "TRANSCRIBE_GROQ_API_KEY", "GROQ_API_KEY"),
    )
    # Groq retired Llama 3.x; gpt-oss models are the free ones now. Tried in order until one answers.
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    GROQ_FALLBACK_MODELS: str = "openai/gpt-oss-120b,qwen/qwen3.8-27b"
    # Longest text the dictionary / alternatives / romanisation panel looks up.
    INSIGHTS_MAX_CHARS: int = 600
    # Longest text read aloud in one /translate/speak request.
    SPEAK_MAX_CHARS: int = 2000

    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="TRANSLATE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = TranslateSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
