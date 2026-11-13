from pydantic_settings import BaseSettings, SettingsConfigDict


class JobsSettings(BaseSettings):
    """
    Isolated jobs: the universal converter, compressor, merge/split and icon maker each run a job in
    a short-lived child process (see app/core/isolation.py), so a crash, hang or memory spike ends
    with that process and never reaches the web worker or another tool.
    """

    # Heavy lane (LibreOffice, FFmpeg, Pandoc…): jobs that may run at once across those tools.
    # Shared, because they compete for the same memory. Use 1 on a 512 MB instance.
    HEAVY_CONCURRENCY: int = 2
    # Light lane (Pillow-only work such as icon packs): quick jobs that shouldn't queue behind a video.
    LIGHT_CONCURRENCY: int = 2
    # How long a request waits for a free slot before it's told the server is busy.
    QUEUE_WAIT_SECONDS: int = 120

    model_config = SettingsConfigDict(env_prefix="JOBS_", env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = JobsSettings()
