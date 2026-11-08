from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class InstagramSettings(BaseSettings):
    APP_NAME: str = "Instagram Media Service"
    TEMP_DIR: Path = Path("./temp/instagram")
    COOKIE_FILE_PATH: Path = Path("cookies_instagram.txt")
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="INSTAGRAM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = InstagramSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
