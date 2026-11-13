from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class DevtoolsSettings(BaseSettings):
    TEMP_DIR: Path = Path("./temp/devtools")
    # Public resolvers, so answers are the same everywhere (and not the host's internal DNS).
    NAMESERVERS: List[str] = ["1.1.1.1", "8.8.8.8", "9.9.9.9"]
    DNS_TIMEOUT: float = 6.0
    PORT_TIMEOUT: float = 4.0
    HTTP_TIMEOUT: int = 15
    MAX_REDIRECTS: int = 8
    MAX_BODY_BYTES: int = 1024 * 1024
    MAX_RESPONSE_BYTES: int = 1024 * 1024
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="DEVTOOLS_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = DevtoolsSettings()
