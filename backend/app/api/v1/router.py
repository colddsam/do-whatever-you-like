from fastapi import APIRouter
from app.api.v1.endpoints import (
    compress, convert, facebook, health, icon, image, instagram, merge_split, pdf, pdf_tools, qrcode, transcribe, universal, youtube,
)

api_v1_router = APIRouter()


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
