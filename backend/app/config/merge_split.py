from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class MergeSplitSettings(BaseSettings):
    TEMP_DIR: Path = Path("./temp/merge_split")
    # Merge: how many files at once (their total size is capped by MAX_DOWNLOAD_SIZE_MB).
    MAX_FILES: int = 20
    # Split: the most parts one file may become.
    MAX_PARTS: int = 200
    # Hard ceiling for one job; the worker is killed after this.
    TIMEOUT_SECONDS: int = 900
    # Merging videos that need re-encoding is slow on small CPUs; longer totals are refused.
    VIDEO_MAX_SECONDS: int = 1800
    AUDIO_MAX_SECONDS: int = 6 * 3600
    # Spreadsheets: rows read when stacking or splitting, and cells copied with their formatting.
    MAX_ROWS: int = 1_000_000
    STYLED_CELLS: int = 2_000_000
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="MERGE_SPLIT_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = MergeSplitSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
