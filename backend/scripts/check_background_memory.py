"""
Remove-background memory check, in-process through the ASGI app (the real endpoint and process pool).

Sends the same photo several times in a row and reports the peak memory of the web process and of
the pool process, sampled every 20 ms. On Render's free plan both must fit in 512 MB together.
Without a photo, a 2000 x 2667 test image is made up.

    python scripts/check_background_memory.py [photo.jpg] [--runs 3] [--background transparent|color|blur]

Inside the production image, with the same memory cap as Render:

    docker build -t dw-api backend
    docker run --rm --memory=512m -e HEADER_TOKEN=x dw-api python scripts/check_background_memory.py
"""

import argparse
import asyncio
import io
import sys
import threading
import time
import uuid
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[1]
BUDGET_MB = 512


def photo_bytes(path: str | None) -> bytes:
    if path:
        return Path(path).read_bytes()
    import numpy as np
    from PIL import Image, ImageDraw

    rng = np.random.default_rng(0)
    img = Image.fromarray((rng.random((333, 250, 3)) * 80 + 100).astype("uint8")).resize((2000, 2667), Image.Resampling.BICUBIC)
    ImageDraw.Draw(img).ellipse((500, 700, 1500, 2100), fill=(200, 60, 40))  # something to cut out
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def multipart(data: bytes, background: str) -> tuple[bytes, str]:
    b = uuid.uuid4().hex
    body = (
        f'--{b}\r\nContent-Disposition: form-data; name="background"\r\n\r\n{background}\r\n'
        f'--{b}\r\nContent-Disposition: form-data; name="files"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'
    ).encode() + data + f"\r\n--{b}--\r\n".encode()
    return body, f"multipart/form-data; boundary={b}"


async def post(app, token: str, path: str, body: bytes, content_type: str) -> tuple[int, int]:
    headers = [(b"content-type", content_type.encode()), (b"content-length", str(len(body)).encode()), (b"authorization", f"Bearer {token}".encode())]
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "path": path, "raw_path": path.encode(),
             "query_string": b"", "headers": headers, "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 8000), "scheme": "http"}
    sent, status, size, done = False, 0, 0, asyncio.Event()

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        await done.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        nonlocal status, size
        if message["type"] == "http.response.start":
            status = message["status"]
        elif message["type"] == "http.response.body":
            size += len(message.get("body", b""))
            if not message.get("more_body"):
                done.set()

    await app(scope, receive, send)
    return status, size


def main() -> int:
    sys.path.insert(0, str(ROOT))
    from app.core.config import app_settings
    from app.main import app
    from app.services.pdf_pool import shutdown_pool

    parser = argparse.ArgumentParser()
    parser.add_argument("photo", nargs="?")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--background", default="transparent", choices=["transparent", "color", "blur"])
    args = parser.parse_args()
    body, content_type = multipart(photo_bytes(args.photo), args.background)

    peak = {"web": 0, "pool": 0, "total": 0}

    def sample() -> None:
        me = psutil.Process()
        while True:
            try:
                web = me.memory_info().rss
                pool = sum(c.memory_info().rss for c in me.children(recursive=True))
                peak["web"], peak["pool"], peak["total"] = max(peak["web"], web), max(peak["pool"], pool), max(peak["total"], web + pool)
            except psutil.Error:
                pass
            time.sleep(0.02)

    threading.Thread(target=sample, daemon=True).start()
    ok = True
    for i in range(args.runs):
        t = time.time()
        status, size = asyncio.run(post(app, app_settings.HEADER_TOKEN, "/api/v1/image/remove-background", body, content_type))
        print(f"run {i + 1}: HTTP {status}, {size} bytes, {time.time() - t:.1f}s")
        ok &= status == 200
    shutdown_pool()
    mb = {k: v >> 20 for k, v in peak.items()}
    print(f"peak: web {mb['web']} MB, pool {mb['pool']} MB, together {mb['total']} MB (budget {BUDGET_MB} MB)")
    ok &= mb["total"] < BUDGET_MB
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":  # the pool spawns processes that re-import this file
    sys.exit(main())
