from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class QRCodeSettings(BaseSettings):
    APP_NAME: str = "QR Code Generator Service"
    TEMP_DIR: Path = Path("./temp/qrcode")
    MAX_DATA_LENGTH: int = 4096
    MAX_LOGO_SIZE_MB: int = 10
    DEBUG: bool = False

    model_config = SettingsConfigDict(
        env_prefix="QRCODE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = QRCodeSettings()
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)

