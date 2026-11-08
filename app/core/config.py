from pathlib import Path
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    APP_NAME: str = "SocialHub Multi-Service API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: List[str] = ["*"]
    TEMP_ROOT_DIR: Path = Path("./temp")
    HEADER_TOKEN: str = Field(..., min_length=1)
    REQUEST_TIMEOUT: int = 25
    MAX_DOWNLOAD_SIZE_MB: int = 150

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


app_settings = AppSettings()
app_settings.TEMP_ROOT_DIR.mkdir(parents=True, exist_ok=True)
