from fastapi import APIRouter, status
from app.core.config import app_settings
from app.schemas.common import HealthResponse

router = APIRouter(prefix="/health", tags=["Health"])


@router.get(
    "",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Service health and version check",
)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="healthy",
        service=app_settings.APP_NAME,
        version=app_settings.APP_VERSION,
    )

