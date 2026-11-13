"""
Request size limits, enforced before a single byte of the body is parsed.

Without this, Starlette reads (and spools to disk) a multipart body of any size before the endpoint
gets a chance to say it's too big, so one oversized upload costs the server its whole length in
bandwidth and disk. Here a declared Content-Length over the limit is refused at once, and a body
that doesn't declare its length is counted as it streams and cut off at the limit.
"""

import json

from app.core.config import app_settings

MB = 1024 * 1024


class _TooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    def __init__(self, app, multipart_mb: int | None = None, other_mb: int = 6):
        self.app = app
        # Every tool caps a request's files at MAX_DOWNLOAD_SIZE_MB in total; allow a little for the form.
        self.multipart = (multipart_mb or app_settings.MAX_DOWNLOAD_SIZE_MB + 5) * MB
        self.other = other_mb * MB

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        is_multipart = headers.get(b"content-type", b"").lower().startswith(b"multipart/")
        limit = self.multipart if is_multipart else self.other
        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    return await self._refuse(send, limit)
            except ValueError:
                return await self._refuse(send, limit, status=400, detail="Invalid Content-Length.")

        seen = 0
        started = False

        async def counting_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise _TooLarge()
            return message

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _TooLarge:
            if not started:
                await self._refuse(send, limit)

    @staticmethod
    async def _refuse(send, limit: int, status: int = 413, detail: str | None = None):
        body = json.dumps({"detail": detail or f"That upload is over the {limit // MB} MB limit."}).encode()
        await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"connection", b"close")]})
        await send({"type": "http.response.body", "body": body})
