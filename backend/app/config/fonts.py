from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class FontsSettings(BaseSettings):
    TEMP_DIR: Path = Path("./temp/fonts")
    # Fonts bigger than this aren't inspected (CJK families can be 20+ MB; that's fine).
    MAX_MB: int = 60
    # Decompressed fonts larger than this aren't sent back for glyph outlines (the preview still works).
    MAX_SFNT_MB: int = 16
    TIMEOUT_SECONDS: int = 180
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="FONTS_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = FontsSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
