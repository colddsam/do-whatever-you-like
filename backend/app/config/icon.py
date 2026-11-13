from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class IconSettings(BaseSettings):
    TEMP_DIR: Path = Path("./temp/icon")
    # The source picture is scaled down to this before anything else (icons top out at 1024 px).
    WORK_SIZE: int = 2048
    # Hard ceiling for one job; the worker is killed after this.
    TIMEOUT_SECONDS: int = 180
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="ICON_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = IconSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
