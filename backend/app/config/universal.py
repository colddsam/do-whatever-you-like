from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class UniversalSettings(BaseSettings):
    APP_NAME: str = "Universal File Converter"
    TEMP_DIR: Path = Path("./temp/universal")
    # Every conversion runs in its own short-lived child process (app/core/isolation.py), in the
    # shared heavy lane (JOBS_HEAVY_CONCURRENCY), so a crash, hang or memory spike in one never
    # reaches the web worker or another tool.
    # Hard ceiling for one whole conversion (every step). The worker is killed after this.
    TIMEOUT_SECONDS: int = 900
    # Ceilings for single steps inside the worker.
    PANDOC_TIMEOUT_SECONDS: int = 120
    MEDIA_TIMEOUT_SECONDS: int = 840
    # Re-encoding video is slow on small CPUs; longer videos are refused (stream copies are not capped).
    VIDEO_MAX_SECONDS: int = 1800
    AUDIO_MAX_SECONDS: int = 3 * 3600
    GIF_MAX_SECONDS: int = 30
    # Archives: refuse "zip bombs" before they fill the disk.
    ARCHIVE_MAX_FILES: int = 5000
    ARCHIVE_MAX_UNPACKED_MB: int = 600
    # Spreadsheet/data conversions.
    DATA_MAX_ROWS: int = 1_000_000
    # PDF pages drawn as pictures.
    PDF_IMAGE_DPI: int = 150
    PDF_IMAGE_MAX_PAGES: int = 200
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="UNIVERSAL_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = UniversalSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
