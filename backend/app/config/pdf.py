from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class PDFSettings(BaseSettings):
    APP_NAME: str = "PDF Processing Service"
    TEMP_DIR: Path = Path("./temp/pdf")
    CACHE_TTL_SECONDS: int = 30 * 60
    PROCESS_WORKERS: int = 1
    ESTIMATE_EXACT_PIXELS: int = 4_000_000
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="PDF_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = PDFSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)

