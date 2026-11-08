from fastapi import APIRouter
from app.api.v1.endpoints import health, instagram

api_v1_router = APIRouter()

# Register feature routers here.
# Future services (e.g., youtube, tiktok, ai_tools, file_converter)
# only need a new module in `app/api/v1/endpoints/` and one `include_router` line below.
api_v1_router.include_router(health.router)
api_v1_router.include_router(instagram.router)

