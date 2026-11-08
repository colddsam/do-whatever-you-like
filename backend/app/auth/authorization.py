import secrets
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import app_settings

security_scheme = HTTPBearer(auto_error=True)


def verify_global_api_key(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
) -> None:
    """Constant-time verification of the Bearer API token to prevent timing attacks."""
    expected_token = app_settings.HEADER_TOKEN
    provided_token = credentials.credentials or ""

    if not expected_token or not secrets.compare_digest(
        provided_token.encode("utf-8"),
        expected_token.encode("utf-8"),
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API Key",
            headers={"WWW-Authenticate": "Bearer"},
        )
