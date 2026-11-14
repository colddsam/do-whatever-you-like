from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class MediaSettings(BaseSettings):
    TEMP_DIR: Path = Path("./temp/media")
    # Hard ceiling for one job; the worker is killed after this.
    TIMEOUT_SECONDS: int = 900
    # Exact (re-encoded) cuts and volume changes re-encode, which is slow on a small CPU: the part
    # being re-encoded is capped. Fast cuts (stream copy) and muting have no cap.
    EXACT_TRIM_MAX_SECONDS: int = 180
    VIDEO_REENCODE_MAX_SECONDS: int = 1800
    AUDIO_MAX_SECONDS: int = 6 * 3600
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="MEDIA_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = MediaSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
