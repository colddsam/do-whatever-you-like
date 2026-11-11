from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConvertSettings(BaseSettings):
    APP_NAME: str = "Document Conversion Service"
    TEMP_DIR: Path = Path("./temp/convert")
    # LibreOffice's soffice; found automatically (PATH, Program Files, /usr/bin, /Applications) when unset.
    SOFFICE_PATH: Path | None = None
    # Where per-job LibreOffice profiles go. Keep it short (Windows path limit); default: <system temp>/dw_lo.
    OFFICE_PROFILE_DIR: Path | None = None
    OFFICE_TIMEOUT_SECONDS: int = 180
    # How many heavy converters (LibreOffice, Chromium) may run at once on one web worker.
    # Use 1 on a 512 MB instance.
    OFFICE_CONCURRENCY: int = 2
    HTML_TIMEOUT_SECONDS: int = 45
    HTML_MAX_MB: int = 10
    EXCEL_MAX_PAGES: int = 300
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="CONVERT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = ConvertSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
