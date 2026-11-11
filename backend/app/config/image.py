from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class ImageSettings(BaseSettings):
    APP_NAME: str = "Image Tools Service"
    TEMP_DIR: Path = Path("./temp/image")
    # Batch limits (the whole request is also capped by MAX_DOWNLOAD_SIZE_MB).
    MAX_FILES: int = 30
    # Largest image (in pixels) any tool opens. An RGBA image takes 4 bytes per pixel in memory,
    # so lower this on small instances (Render's free plan: ~25 MP).
    MAX_PIXELS: int = 60_000_000

    # Downloaded models (background removal) live here; bundled ones ship in app/assets/ml.
    MODEL_DIR: Path = Path("./models/image")
    BACKGROUND_MODEL_URL: str = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx"
    BACKGROUND_MODEL_SHA256: str = "75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb"
    BACKGROUND_MAX_FILES: int = 10

    # Upscaling runs Real-ESRGAN tile by tile; the result's size is what costs memory and time.
    UPSCALE_MAX_OUTPUT_PIXELS: int = 16_000_000
    UPSCALE_TILE: int = 192
    ONNX_THREADS: int = 0  # 0 = all cores

    HTML_TIMEOUT_SECONDS: int = 45
    HTML_MAX_HEIGHT: int = 16_000
    HTML_MAX_MB: int = 10
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="IMAGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = ImageSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
