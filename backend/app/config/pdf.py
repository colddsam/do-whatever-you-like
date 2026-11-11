from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class PDFSettings(BaseSettings):
    APP_NAME: str = "PDF Processing Service"
    TEMP_DIR: Path = Path("./temp/pdf")
    CACHE_TTL_SECONDS: int = 30 * 60
    PROCESS_WORKERS: int = 1
    ESTIMATE_EXACT_PIXELS: int = 4_000_000
    # Cap on pages a split/organize request may produce (duplicates count), so a crafted
    # spec like '1-999+1-999+…' can't balloon one job.
    MAX_OUTPUT_PAGES: int = 5000
    THUMBNAIL_MIN_WIDTH: int = 64
    THUMBNAIL_MAX_WIDTH: int = 1000
    # PDF tools (app/services/pdf_tools.py)
    OCR_MAX_PAGES: int = 300
    OCR_DPI: int = 300
    TESSDATA_DIR: Path | None = None  # Found automatically when unset (TESSDATA_PREFIX or the usual install paths).
    GHOSTSCRIPT_PATH: Path | None = None  # Found automatically when unset (PATH or Program Files).
    IMAGES_MAX_FILES: int = 100
    COMPARE_MAX_PAGES: int = 300
    COMPARE_MAX_CHANGES: int = 500
    EDIT_MAX_OPS: int = 500
    SUBPROCESS_TIMEOUT_SECONDS: int = 300
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="PDF_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = PDFSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)

