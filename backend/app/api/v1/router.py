from fastapi import APIRouter
from app.api.v1.endpoints import facebook, health, instagram, pdf, video2audio, youtube

api_v1_router = APIRouter()


api_v1_router.include_router(health.router)
api_v1_router.include_router(instagram.router)
api_v1_router.include_router(facebook.router)
api_v1_router.include_router(youtube.router)
api_v1_router.include_router(video2audio.router)
api_v1_router.include_router(pdf.router)


