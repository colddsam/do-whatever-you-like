from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class PaletteSettings(BaseSettings):
    TEMP_DIR: Path = Path("./temp/palette")
    # Pages rendered for picking colours, and their longest side in pixels.
    MAX_PAGES: int = 12
    PAGE_PIXELS: int = 1400
    TIMEOUT_SECONDS: int = 300
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="PALETTE_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = PaletteSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
