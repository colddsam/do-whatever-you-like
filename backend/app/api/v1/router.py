from fastapi import APIRouter
from app.api.v1.endpoints import convert, facebook, health, instagram, pdf, pdf_tools, qrcode, video2audio, youtube

api_v1_router = APIRouter()


api_v1_router.include_router(health.router)
api_v1_router.include_router(instagram.router)
api_v1_router.include_router(facebook.router)
api_v1_router.include_router(youtube.router)
api_v1_router.include_router(video2audio.router)
api_v1_router.include_router(pdf.router)
api_v1_router.include_router(pdf_tools.router)
api_v1_router.include_router(convert.router)
api_v1_router.include_router(qrcode.router)


