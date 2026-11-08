from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class YoutubeSettings(BaseSettings):
    APP_NAME: str = "YouTube Media Service"
    TEMP_DIR: Path = Path("./temp/youtube")
    COOKIE_FILE_PATH: Path | None = None
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="YOUTUBE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = YoutubeSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)

