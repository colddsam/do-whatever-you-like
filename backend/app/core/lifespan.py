import asyncio
import shutil
from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.core.config import app_settings
from app.config.instagram import settings as instagram_settings
from app.config.facebook import settings as facebook_settings
from app.config.youtube import settings as youtube_settings
from app.config.video2audio import settings as video2audio_settings
from app.config.pdf import settings as pdf_settings
from app.config.qrcode import settings as qrcode_settings
from app.config.convert import settings as convert_settings
from app.services.pdf import pdf_service
from app.services.pdf_pool import shutdown_pool, warm_pool
from app.services.ffmpeg_service import init_ffmpeg


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle hooks."""
    init_ffmpeg()
    app_settings.TEMP_ROOT_DIR.mkdir(parents=True, exist_ok=True)
    instagram_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    facebook_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    youtube_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    video2audio_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    pdf_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    qrcode_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    convert_settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
    pdf_service.purge_stale()
    asyncio.get_running_loop().call_later(5, warm_pool)
    yield
    if instagram_settings.TEMP_DIR.exists():
        shutil.rmtree(instagram_settings.TEMP_DIR, ignore_errors=True)
    if facebook_settings.TEMP_DIR.exists():
        shutil.rmtree(facebook_settings.TEMP_DIR, ignore_errors=True)
    if youtube_settings.TEMP_DIR.exists():
        shutil.rmtree(youtube_settings.TEMP_DIR, ignore_errors=True)
    if video2audio_settings.TEMP_DIR.exists():
        shutil.rmtree(video2audio_settings.TEMP_DIR, ignore_errors=True)
    if qrcode_settings.TEMP_DIR.exists():
        shutil.rmtree(qrcode_settings.TEMP_DIR, ignore_errors=True)
    if convert_settings.TEMP_DIR.exists():
        shutil.rmtree(convert_settings.TEMP_DIR, ignore_errors=True)
    pdf_service.purge_stale()
    shutdown_pool()
