import shutil
from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.core.config import app_settings
from app.config.instagram import settings as instagram_settings
from app.config.facebook import settings as facebook_settings
from app.config.youtube import settings as youtube_settings
from app.services.ffmpeg_service import init_ffmpeg


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle hooks."""
    init_ffmpeg()
    app_settings.TEMP_ROOT_DIR.mkdir(parents=True, exist_ok=True)
    instagram_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    facebook_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    youtube_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    yield
    if instagram_settings.TEMP_DIR.exists():
        shutil.rmtree(instagram_settings.TEMP_DIR, ignore_errors=True)
    if facebook_settings.TEMP_DIR.exists():
        shutil.rmtree(facebook_settings.TEMP_DIR, ignore_errors=True)
    if youtube_settings.TEMP_DIR.exists():
        shutil.rmtree(youtube_settings.TEMP_DIR, ignore_errors=True)
