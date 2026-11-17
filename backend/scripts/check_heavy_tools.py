"""
Live health check of every server-heavy tool (AI models, Chromium, LibreOffice, Tesseract,
Ghostscript, FFmpeg, Whisper, PyMuPDF) against a running server, with Render's free-plan limits
in mind: the upscaler must offer 2x and 4x for ordinary photos and stay within its caps.

    cd backend
    # Start a server first, ideally with Render's settings (env vars) and on port 8765:
    #   IMAGE_UPSCALE_MAX_INPUT_PIXELS=500000 IMAGE_UPSCALE_MAX_OUTPUT_PIXELS=12000000 PDF_PROCESS_WORKERS=1
    #   python -m uvicorn app.main:app --port 8765
    python scripts/check_heavy_tools.py [--base http://127.0.0.1:8765]

Exit code 0 only when every check passes (a tool whose system program isn't installed locally,
such as Ghostscript on Windows, is reported as SKIP).
"""

import argparse
import io
import math
import struct
import sys
import time
import wave
from pathlib import Path

import pymupdf as fitz
import requests
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.stdout.reconfigure(encoding="utf-8")
from app.core.config import app_settings

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8765")
BASE = ap.parse_args().base.rstrip("/") + "/api/v1"
H = {"Authorization": f"Bearer {app_settings.HEADER_TOKEN}"}
results = []


def png(w, h, text="Hello 123"):
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    for i in range(0, w, 17):
        d.line([(i, 0), (w - i, h)], fill=(i % 255, 80, 160), width=2)
    d.ellipse([w // 4, h // 4, 3 * w // 4, 3 * h // 4], fill=(220, 60, 40))
    d.text((10, 10), text, fill="black")
    b = io.BytesIO(); img.save(b, "PNG"); return b.getvalue()


def jpg(w, h):
    b = io.BytesIO(); Image.open(io.BytesIO(png(w, h))).save(b, "JPEG", quality=90); return b.getvalue()


def scanned_pdf():
    img = Image.new("RGB", (1240, 1754), "white")
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("app/assets/fonts/NotoSans.ttf", 48)
    except OSError:
        f = None
    d.text((100, 200), "The quick brown fox jumps over the lazy dog", fill="black", font=f)
    b = io.BytesIO(); img.save(b, "PDF", resolution=150); return b.getvalue()


def text_pdf(t):
    doc = fitz.open(); p = doc.new_page(); p.insert_text((72, 72), t); return doc.tobytes()


def wav(seconds=3):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(16000 * seconds)))
    return b.getvalue()


def check(name, method, path, ok=lambda r: True, **kw):
    t = time.time()
    try:
        r = requests.request(method, BASE + path, headers=H, timeout=900, **kw)
        good = r.status_code == 200 and ok(r)
        info = r.headers.get("X-Image-Info", "")[:160] if good else r.text[:300]
    except Exception as e:
        good, info, r = False, repr(e), None
    if not good and r is not None and r.status_code == 422 and "isn't available on this server" in r.text:
        print(f"SKIP {name:34s} (engine not installed here: {r.json().get('detail')})", flush=True)
        return r
    dt = time.time() - t
    results.append((name, good))
    print(f"{'PASS' if good else 'FAIL'} {name:34s} {dt:6.1f}s  {(r.status_code if r is not None else '-')}  {info}", flush=True)
    return r


def img_size(r):
    return Image.open(io.BytesIO(r.content)).size


check("image capabilities", "GET", "/image/capabilities", lambda r: r.json()["upscale"] and r.json()["background"] and r.json()["faces"])
r = check("upscale 4x small (300x200)", "POST", "/image/upscale", lambda r: img_size(r) == (1200, 800), files={"file": ("a.png", png(300, 200))}, data={"factor": "4"})
r = check("upscale 2x small (300x200)", "POST", "/image/upscale", lambda r: img_size(r) == (600, 400), files={"file": ("a.png", png(300, 200))}, data={"factor": "2"})
r = check("upscale 4x big jpg (1600x1200)", "POST", "/image/upscale", lambda r: img_size(r)[0] > 3200, files={"file": ("b.jpg", jpg(1600, 1200))}, data={"factor": "4"})
check("upscale 2x big jpg (1600x1200)", "POST", "/image/upscale", lambda r: img_size(r) == (3200, 2400), files={"file": ("b.jpg", jpg(1600, 1200))}, data={"factor": "2"})
r = requests.post(BASE + "/image/upscale", headers=H, files={"file": ("c.jpg", jpg(4000, 3000))}, data={"factor": "2"}, timeout=120)
results.append(("upscale refuses huge photo w/ 400", r.status_code == 400)); print("    huge:", r.status_code, r.text[:200])
r = requests.post(BASE + "/image/upscale", headers=H, files={"file": ("a.png", png(30, 30))}, data={"factor": "3"}, timeout=60)
results.append(("upscale rejects 3x", r.status_code in (400, 422))); print("    3x:", r.status_code)
check("remove background", "POST", "/image/remove-background", files={"files": ("p.png", png(600, 400))}, data={"background": "transparent"})
check("faces", "POST", "/image/faces", files={"file": ("p.jpg", jpg(640, 480))})
check("image compress", "POST", "/image/compress", files={"files": ("p.jpg", jpg(800, 600))})
check("image html (chromium)", "POST", "/image/html", data={"html": "<h1>Hello</h1>", "screen": "mobile", "full_page": "false"})
check("html -> pdf (chromium)", "POST", "/convert/html-to-pdf", files={"file": ("x.html", b"<html><body><h1>Hi</h1></body></html>", "text/html")})
check("pdf ocr (tesseract)", "POST", "/pdf/ocr", files={"file": ("s.pdf", scanned_pdf(), "application/pdf")}, data={"languages": "eng"})
check("pdf compress", "POST", "/pdf/compress", files={"file": ("s.pdf", scanned_pdf(), "application/pdf")}, data={"compression_percentage": "50"})
check("pdf/a (ghostscript)", "POST", "/pdf/pdfa", files={"file": ("t.pdf", text_pdf("hello"), "application/pdf")})
t1 = requests.post(BASE + "/pdf/upload", headers=H, files={"file": ("a.pdf", text_pdf("hello world one"), "application/pdf")}).json().get("token")
t2 = requests.post(BASE + "/pdf/upload", headers=H, files={"file": ("b.pdf", text_pdf("hello brave world two"), "application/pdf")}).json().get("token")
check("pdf compare", "POST", "/pdf/compare", data={"token_old": t1, "token_new": t2})
check("universal html->docx (libreoffice)", "POST", "/universal/convert", files={"file": ("t.html", b"<p>Hello</p>", "text/html")}, data={"target": "docx"})
check("universal png->webp", "POST", "/universal/convert", files={"file": ("p.png", png(200, 200))}, data={"target": "webp"})
check("universal wav->mp3 (ffmpeg)", "POST", "/universal/convert", files={"file": ("a.wav", wav())}, data={"target": "mp3"})
check("compress any (wav)", "POST", "/compress", files={"files": ("a.wav", wav())})
check("media trim", "POST", "/media/trim", files={"file": ("a.wav", wav())}, data={"start": "0.5", "end": "2"})
check("media denoise", "POST", "/media/denoise", files={"file": ("a.wav", wav())})
check("transcribe (whisper)", "POST", "/transcribe", files={"file": ("a.wav", wav())}, data={"language": "en"})
check("icon pack", "POST", "/icon", files={"file": ("p.png", png(512, 512))})
check("palette", "POST", "/palette/extract", files={"file": ("p.png", png(300, 300))})
check("merge pdfs", "POST", "/merge-split/merge", files=[("files", ("a.pdf", text_pdf("a"), "application/pdf")), ("files", ("b.pdf", text_pdf("b"), "application/pdf"))])
check("translate text", "POST", "/translate/text", lambda r: bool(r.json().get("translated_text")), json={"text": "Hello friend", "source": "en", "target": "es"})
print("\nSUMMARY:", sum(g for _, g in results), "/", len(results), "passed")
for n, g in results:
    if not g:
        print("  FAILED:", n)
sys.exit(0 if all(g for _, g in results) else 1)
