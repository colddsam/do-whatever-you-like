from pydantic_settings import BaseSettings, SettingsConfigDict


class ApiClientSettings(BaseSettings):
    """Limits for the API client's request relay (the Postman-style tool). Nothing is written to disk."""

    CONNECT_TIMEOUT: float = 8.0
    # Upper bound for a request's own timeout; the Next.js route gives up at 60 s.
    MAX_TIMEOUT_MS: int = 55_000
    DEFAULT_TIMEOUT_MS: int = 30_000
    MAX_REDIRECTS: int = 20
    # Bodies travel base64 inside JSON through a serverless route (4.5 MB cap on Vercel), so keep them small.
    MAX_BODY_BYTES: int = 3 * 1024 * 1024
    MAX_RESPONSE_BYTES: int = 3 * 1024 * 1024
    # Server-sent event streams never end: capture this long, then hand back what arrived.
    STREAM_SECONDS: float = 12.0
    MAX_GRPC_MESSAGES: int = 500
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_prefix="APICLIENT_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = ApiClientSettings()
