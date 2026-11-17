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

    # Upscaling runs Real-ESRGAN tile by tile. Time grows with the pixels the network sees (~36 s per
    # megapixel on one full core, whether the result is 2x or 4x), memory with the size of the result.
    # A bigger image is first reduced to MAX_INPUT_PIXELS for the network and the result is resized
    # to what was asked for, so 2x and 4x always work; MAX_OUTPUT_PIXELS caps the result itself.
    UPSCALE_MAX_INPUT_PIXELS: int = 4_000_000
    UPSCALE_MAX_OUTPUT_PIXELS: int = 16_000_000
    UPSCALE_TILE: int = 192
    ONNX_THREADS: int = 0  # 0 = the CPUs this container may use (its cgroup quota), at most 4

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
