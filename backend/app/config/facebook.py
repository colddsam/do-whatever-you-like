from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class FacebookSettings(BaseSettings):
    APP_NAME: str = "Facebook Media Service"
    TEMP_DIR: Path = Path("./temp/facebook")
    COOKIE_FILE_PATH: Path | None = Path("cookies_facebook.txt")
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="FACEBOOK_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = FacebookSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
