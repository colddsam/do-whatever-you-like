from fastapi import APIRouter, Depends
from app.core.file_guard import guard_uploads
from app.api.v1.endpoints import (
    compress, convert, devtools, facebook, media, fonts, health, icon, image, instagram, merge_split, palette, pdf, pdf_tools, qrcode, transcribe, universal, youtube,
)

# Every uploaded file is checked (type from its bytes, not its name) before any endpoint runs.
api_v1_router = APIRouter(dependencies=[Depends(guard_uploads)])


api_v1_router.include_router(health.router)
api_v1_router.include_router(instagram.router)
api_v1_router.include_router(facebook.router)
api_v1_router.include_router(youtube.router)
api_v1_router.include_router(pdf.router)
api_v1_router.include_router(pdf_tools.router)
api_v1_router.include_router(convert.router)
api_v1_router.include_router(qrcode.router)
api_v1_router.include_router(transcribe.router)
api_v1_router.include_router(image.router)
api_v1_router.include_router(universal.router)
api_v1_router.include_router(compress.router)
api_v1_router.include_router(merge_split.router)
api_v1_router.include_router(icon.router)
api_v1_router.include_router(fonts.router)
api_v1_router.include_router(palette.router)
api_v1_router.include_router(devtools.router)
api_v1_router.include_router(media.router)
