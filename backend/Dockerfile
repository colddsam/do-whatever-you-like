# Backend image for Render (free plan: 512 MB RAM, 0.1 CPU) or any Docker host.
# The PDF and conversion tools need system programs a plain Python runtime doesn't have:
# LibreOffice (Office <-> PDF), Tesseract (OCR), Ghostscript (PDF/A) and Chromium (web page -> PDF).
FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    # glibc gives each thread its own malloc arena; capping them keeps a small instance's memory flat.
    MALLOC_ARENA_MAX=2 \
    # One web worker and one PDF process: what fits in 512 MB alongside LibreOffice or Chromium.
    PDF_PROCESS_WORKERS=1 \
    CONVERT_OFFICE_CONCURRENCY=1 \
    CONVERT_OFFICE_PROFILE_DIR=/tmp/dw_lo \
    # Speech to text without a Groq key runs Whisper here; "base" is the largest that fits 512 MB.
    TRANSCRIBE_MODEL=base \
    TRANSCRIBE_MODEL_DIR=/app/models/whisper \
    HF_HUB_DISABLE_TELEMETRY=1 \
    # Image tools: the cut-out model lives here; Real-ESRGAN and YuNet ship inside app/assets/ml.
    IMAGE_MODEL_DIR=/app/models/image

# The -nogui LibreOffice packages skip the desktop (~300 MB less). Draw carries the PDF import
# that PDF -> PowerPoint uses. Carlito/Caladea/Liberation match the metrics of Office's fonts,
# so converted documents keep their line breaks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libatomic1 libglib2.0-0 \
        libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui \
        tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa tesseract-ocr-fra tesseract-ocr-deu \
        tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-rus tesseract-ocr-ara tesseract-ocr-hin \
        tesseract-ocr-ben tesseract-ocr-chi-sim tesseract-ocr-jpn \
        ghostscript \
        fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt \
    # Headless Chromium plus the libraries it needs; the "shell" build is ~100 MB smaller.
    && playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    # Fetch ffmpeg now, not at every cold start.
    && python -c "import static_ffmpeg; static_ffmpeg.add_paths()" \
    # Bake the Whisper model into the image, so the first transcription doesn't download it.
    && python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8', download_root='/app/models/whisper')" \
    # And the background-removal model (U2-Net "silueta", 44 MB), checked against its pinned SHA-256.
    && python -c "import hashlib, os, urllib.request; os.makedirs('/app/models/image', exist_ok=True); d = urllib.request.urlopen('https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx', timeout=120).read(); assert hashlib.sha256(d).hexdigest() == '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb'; open('/app/models/image/silueta.onnx', 'wb').write(d)"

COPY app ./app

RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/temp /tmp/dw_lo \
    && chown -R app:app /app /tmp/dw_lo "$(python -c 'import static_ffmpeg, os; print(os.path.dirname(static_ffmpeg.__file__))')" \
    && chmod -R a+rX /opt/playwright
USER app

# Render sets PORT (10000 by default). One worker: the free instance has 0.1 CPU and 512 MB.
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --proxy-headers --forwarded-allow-ips '*'"]
