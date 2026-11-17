"""
Turns an unexpected exception into a plain JSON 500 *inside* the CORS middleware.

Starlette answers unhandled exceptions in ServerErrorMiddleware, which sits outside every user
middleware, CORS included. That 500 carries no Access-Control-Allow-Origin, so a browser uploading
straight to this service sees only a network error ("upload interrupted") instead of a message it
can show. Caught here, the response passes back out through CORS like any other.
"""

import json
import logging

logger = logging.getLogger(__name__)


class CatchAllMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            logger.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:
                # Headers are already out (e.g. a background task failed after the response): nothing to fix.
                raise
            body = json.dumps({"detail": "Something went wrong on our side. Please try again."}).encode()
            await send({
                "type": "http.response.start",
                "status": 500,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            })
            await send({"type": "http.response.body", "body": body})
