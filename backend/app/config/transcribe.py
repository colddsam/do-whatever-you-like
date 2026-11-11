from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class TranscribeSettings(BaseSettings):
    APP_NAME: str = "Speech to Text Service"
    TEMP_DIR: Path = Path("./temp/transcribe")
    MAX_FILE_MB: int = 150
    MAX_DURATION_SECONDS: int = 3 * 60 * 60

    # "local" runs Whisper on this machine (faster-whisper), "groq" sends the audio to Groq's free
    # Whisper API, "auto" picks Groq when GROQ_API_KEY is set and local otherwise.
    ENGINE: Literal["auto", "local", "groq"] = "auto"

    # Local engine. Bigger models are more accurate and slower: tiny < base < small < medium < large-v3.
    # "small" is the best fit for a desktop CPU; use "base" on a 512 MB instance.
    MODEL: str = "small"
    COMPUTE_TYPE: str = "int8"
    MODEL_DIR: Path = Path("./models/whisper")
    CPU_THREADS: int = 0  # 0 = all cores
    BEAM_SIZE: int = 5

    # Groq engine (https://console.groq.com, free tier). Audio is sent in chunks under its upload cap.
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "whisper-large-v3"
    GROQ_CHUNK_SECONDS: int = 600
    GROQ_TIMEOUT_SECONDS: int = 300

    # How many transcriptions one web worker runs at once; the rest wait their turn.
    CONCURRENCY: int = 1
    # Empty lines sent while nothing new has been recognised, so proxies keep the stream open.
    HEARTBEAT_SECONDS: int = 10
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="TRANSCRIBE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = TranscribeSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
