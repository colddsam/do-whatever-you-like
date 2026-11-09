from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Video2AudioSettings(BaseSettings):
    APP_NAME: str = "Video to Audio Service"
    TEMP_DIR: Path = Path("./temp/video2audio")
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="VIDEO2AUDIO_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Video2AudioSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)

