from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class YoutubeSettings(BaseSettings):
    APP_NAME: str = "YouTube Media Service"
    TEMP_DIR: Path = Path("./temp/youtube")
    COOKIE_FILE_PATH: Path | None = None
    # Long videos are fine as long as the chosen quality fits the size cap (a 2.5-hour talk is
    # ~140 MB as audio or at 144p). Live streams are always refused.
    MAX_DURATION_SECONDS: int = 4 * 3600
    # Per download. Files are streamed to disk and back, never held in memory, so this is about
    # disk, bandwidth and time on a small instance, not RAM.
    MAX_DOWNLOAD_MB: int = 500
    # Highest quality offered. Above 1080p the files get huge for little gain on most screens.
    MAX_HEIGHT: int = 1080
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="YOUTUBE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = YoutubeSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)

