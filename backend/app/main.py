from fastapi import FastAPI, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_v1_router
from app.core.config import app_settings
from app.core.lifespan import lifespan
from app.auth.authorization import verify_global_api_key
from app.core.limits import BodySizeLimitMiddleware


def create_app() -> FastAPI:
    """Application factory for creating and configuring the FastAPI instance."""
    application = FastAPI(
        title=app_settings.APP_NAME,
        version=app_settings.APP_VERSION,
        lifespan=lifespan,
        docs_url="/docs" if app_settings.DEBUG else None,
        redoc_url="/redoc" if app_settings.DEBUG else None,
        openapi_url="/openapi.json" if app_settings.DEBUG else None,
        dependencies=[Depends(verify_global_api_key)],
    )

    # Oversized bodies are refused before they're read. Added before CORS, so CORS wraps it and the
    # browser can read the 413 when it uploads straight to this service.
    application.add_middleware(BodySizeLimitMiddleware)

    allow_wildcard = "*" in app_settings.ALLOWED_ORIGINS
    application.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.ALLOWED_ORIGINS,
        allow_credentials=not allow_wildcard,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Upload-Ticket"],
        # Read by the browser when it talks to this service directly (see auth/authorization.py).
        expose_headers=["Content-Disposition", "Content-Length", "X-Pdf-Info", "X-Image-Info", "X-Convert-Info"],
    )

    @application.middleware("http")
    async def add_security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    application.include_router(api_v1_router, prefix=app_settings.API_V1_PREFIX)

    return application


app = create_app()
