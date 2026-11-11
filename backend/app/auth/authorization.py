import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import app_settings

security_scheme = HTTPBearer(auto_error=False)

TICKET_HEADER = "x-upload-ticket"


def _unauthorized(detail: str = "Invalid or missing API Key") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _check_ticket(ticket: str, request: Request) -> None:
    """
    Upload tickets let the browser send big files straight to this service. Hosted frontends
    (Vercel) cap a proxied request at 4.5 MB and 300 s, so the frontend signs a short-lived
    ticket for one endpoint with the shared HEADER_TOKEN instead of forwarding the bytes.
    A ticket is `base64url(json{p: path, e: expiry, m: max bytes}).hex(hmac_sha256)`.
    """
    body, _, sig = ticket.partition(".")
    expected = hmac.new(app_settings.HEADER_TOKEN.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not body or not hmac.compare_digest(sig.encode(), expected.encode()):
        raise _unauthorized()
    try:
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        path, expires, max_bytes = str(claims["p"]), float(claims["e"]), int(claims["m"])
    except (ValueError, KeyError, TypeError):
        raise _unauthorized()
    if expires < time.time():
        raise _unauthorized("This upload link expired. Try again.")
    if path != request.url.path:
        raise _unauthorized()
    if request.method == "POST":
        length = request.headers.get("content-length", "")
        if not length.isdigit():
            raise HTTPException(status.HTTP_411_LENGTH_REQUIRED, detail="Send the file with its size.")
        if int(length) > max_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="That file is too big for this tool.")


def verify_global_api_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
) -> None:
    """Constant-time check of the Bearer API token, or of a signed upload ticket from the frontend."""
    expected_token = app_settings.HEADER_TOKEN
    if credentials is not None:
        provided_token = credentials.credentials or ""
        if expected_token and secrets.compare_digest(provided_token.encode("utf-8"), expected_token.encode("utf-8")):
            return
        raise _unauthorized()

    ticket = request.headers.get(TICKET_HEADER)
    if ticket and expected_token:
        _check_ticket(ticket, request)
        return
    raise _unauthorized()
