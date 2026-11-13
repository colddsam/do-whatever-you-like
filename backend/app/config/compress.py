from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class CompressSettings(BaseSettings):
    TEMP_DIR: Path = Path("./temp/compress")
    # Files per job (their total size is capped by MAX_DOWNLOAD_SIZE_MB).
    MAX_FILES: int = 20
    # Hard ceiling for one job; the worker is killed after this.
    TIMEOUT_SECONDS: int = 900
    # Re-encoding video is slow on small CPUs; longer videos are refused.
    VIDEO_MAX_SECONDS: int = 1800
    AUDIO_MAX_SECONDS: int = 6 * 3600
    # Office files, EPUBs and archives: refuse "zip bombs" before they fill the disk.
    ZIP_MAX_ENTRIES: int = 20_000
    ZIP_MAX_UNPACKED_MB: int = 1500
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="COMPRESS_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = CompressSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
