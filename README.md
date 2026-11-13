# SocialHub (kinetiK) — Multi-Platform Media, Document & Utility Toolkit

A full-stack, security-hardened media extraction, document processing, file conversion, and utility platform built with **Next.js 16 (App Router + Turbopack)** on the frontend and a modular **FastAPI** service layer on the backend.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Security, Isolation & Hardening](#security-isolation--hardening)
- [Getting Started](#getting-started)
  - [Quick Start (Windows PowerShell)](#quick-start-windows-powershell)
  - [1. Backend Setup (FastAPI)](#1-backend-setup-fastapi)
  - [2. Frontend Setup (Next.js)](#2-frontend-setup-nextjs)
- [Environment Variables](#environment-variables)
  - [Backend (`backend/.env`)](#backend-backendenv)
  - [Frontend (`frontend/.env.local`)](#frontend-frontendenvlocal)
- [Cookie Configuration (Optional — Age-Gated / Carousel Media)](#cookie-configuration-optional--age-gated--carousel-media)
- [API Reference](#api-reference)
- [Protocol for Adding New Tools & Endpoints](#protocol-for-adding-new-tools--endpoints)
- [Postman Collection Generator](#postman-collection-generator)

---

## Overview

**SocialHub (kinetiK)** provides a unified web workspace for downloading public social media content (YouTube, Instagram, Facebook), extracting audio from video files, merging/splitting/compressing PDFs with real-time size previews, and generating custom-styled QR codes—all without storing user files permanently on disk.

Every job runs inside an isolated, per-request temporary directory (`temp/<service>/<job_id>`) that is automatically purged via FastAPI `BackgroundTasks` immediately after the response stream finishes.

---

## Features

### Live Tools
- **YouTube Video & Shorts Downloader (`/api/v1/youtube`)**
  - Supports standard videos (`/watch?v=...`), YouTube Shorts (`/shorts/...`), `youtu.be` shortlinks, and raw 11-character video IDs up to 1 hour.
  - Predicts exact/approximate download size before saving and merges best MP4 video + M4A audio streams via bundled `static-ffmpeg`.
- **Instagram Downloader (`/api/v1/instagram`)**
  - Supports Reels (`/reel/...`), Posts (`/p/...`), TV (`/tv/...`), bare shortcodes, and multi-item Carousels.
  - Probes CDN byte sizes in parallel (`HEAD` / ranged `GET`) for instant size previews and packages carousels into a single `.zip` archive.
- **Facebook Downloader (`/api/v1/facebook`)**
  - Supports Facebook Watch videos, Reels (`/reel/...`), `fb.watch` shortlinks, and `/share/...` redirect links.
  - Pre-validates and resolves share redirects hop-by-hop with strict SSRF protection.
- **PDF Toolkit (`/api/v1/pdf`)**
  - **Upload Once & Reuse (`/upload`)**: Caches uploaded PDFs under a 32-char hex token (30-minute sliding TTL) for instant estimates and actions without re-uploading.
  - **Merge (`/merge`, `/merge/estimate`)**: Combines 2+ PDFs in custom order and previews the exact merged byte size.
  - **Split (`/split`, `/split/estimate`)**: Extracts custom page ranges (`1-3, 5`) or individual pages (returned as a single PDF or `.zip`), with per-part page and size breakdowns.
  - **Compress (`/compress`, `/compress/estimate`)**: Compresses PDFs by a target strength (`1–95%`) using `PyMuPDF` image DPI downsampling, recompression, and metadata scrubbing, with multi-strength tile sampling so the UI slider predicts output size in real time.
  - Executes inside a dedicated `ProcessPoolExecutor` with parent-process watchdog and client-disconnect cancellation so heavy C-level PDF operations never block web workers.
- **QR Code Generator (`/api/v1/qrcode`)**
  - Encodes 9 content types: **URL**, **Text**, **Wi-Fi**, **vCard Contact**, **Email**, **SMS**, **Phone**, **Geo Location**, and **Calendar Event (`VEVENT`)**.
  - Customizes module shapes (`square`, `gapped`, `circle`, `rounded`, `vertical_bars`, `horizontal_bars`), finder eye shapes (`square`, `rounded`, `circle`), custom foreground/background/eye colors, transparent backgrounds, and gradients (`radial`, `square`, `horizontal`, `vertical`).
  - Supports center logo overlays (`/generate-with-logo`) with automatic Error Correction `H` promotion, rounded corners, and background padding, exporting to **PNG**, **SVG**, **WebP**, **JPEG**, or **300 DPI PDF**.
- **Universal Converter (`/api/v1/universal`)** — any file to any format it can sensibly become
  - **112 formats in 15 families, 1,827 conversions**: documents (PDF, DOCX, DOC, ODT, RTF, TXT), markup (Markdown, HTML, LaTeX, reStructuredText, Org, AsciiDoc, Textile, MediaWiki, Typst, Jupyter), ebooks (EPUB, FB2), spreadsheets (XLSX, XLS, ODS, XLSM), data (CSV, TSV, JSON, JSON Lines, XML, YAML, TOML, SQL), presentations (PPTX, PPT, ODP, PPSX), drawings (ODG), images (JPG, PNG, WebP, GIF, BMP, TIFF, ICO, AVIF, HEIC, PSD, SVG, camera RAW), audio (MP3, WAV, OGG, FLAC, M4A, AAC, Opus, WMA, AIFF, AC-3, AMR…), video (MP4, MKV, WebM, MOV, AVI, WMV, FLV, M4V, MPEG, 3GP, AVCHD, OGV), subtitles (SRT, VTT, ASS), fonts (TTF, OTF, WOFF, WOFF2), archives (ZIP, 7z, TAR, TAR.GZ/BZ2/XZ, GZ), email (EML), and source code & config files in 23 languages and formats (Python, JS/TS, Java, Go, Rust, C/C++, SQL, INI…).
  - A **conversion graph** (`services/universal/graph.py`) treats each engine (LibreOffice, Pandoc, FFmpeg, Pillow, PyMuPDF, pdf2docx, Tesseract, Chromium, fontTools, py7zr, built-in data/text readers) as edges and plans the cheapest sensible route of up to 3 steps (e.g. `PDF → DOCX → Markdown`). Engines missing on a server are left out, so it never offers a conversion it can't run.
  - Every job runs in its **own child process** (`app/core/isolation.py` → `python -m app.core.job_worker`), killed with everything it started on timeout or client cancel: a crash or memory spike in one conversion cannot affect the server or any other tool. The universal converter, compressor and merge/split share one "heavy" lane (`JOBS_HEAVY_CONCURRENCY`, 1 on Render); icon packs use a light lane of their own.
  - Optional `options` (JSON) fine-tune the result: PDF→JPG/PNG resolution, pages or "the pictures inside", PDF→Excel sheet per table or page, spreadsheet→PDF one page per sheet, audio bitrate. The site's PDF to Word/Excel/PowerPoint/JPG, Word/PowerPoint/Excel to PDF and Video to MP3 pages are presets of this one converter.
  - Hardened against hostile files: Pandoc `--sandbox`, FFmpeg restricted to local files with playlist/concat demuxers refused, YAML alias bombs and XML entities refused, SVG references stripped, archive path traversal/symlinks/zip bombs blocked, CSV formula injection neutralised in Excel output.
  - Verify everything end to end: `backend/scripts/check_universal.py` builds a real sample of every format and runs and validates every offered conversion. After changing formats or routes, run `backend/scripts/export_universal_formats.py` to refresh the copy the frontend ships with.
- **Compress (`/api/v1/compress`)** — any file smaller, 1 to 20 at once, Light / Recommended / Strong
  - PDF (the Compress PDF engine), JPG/PNG/GIF/WebP/SVG (the Compress image engine), HEIC/AVIF/TIFF in their own format, BMP/PSD/RAW to JPG or PNG; DOCX/XLSX/PPTX/ODF/EPUB re-encode the pictures inside and re-zip at full strength; MP3/M4A/AAC/OGG/Opus/WMA at a lower bitrate, WAV/AIFF/FLAC to FLAC or MP3; video to H.264; fonts to WOFF2; ZIP/GZ/TAR repacked; JSON minified; anything else zipped.
  - Each file is compressed on its own: one that fails is reported in `X-Convert-Info` and the rest still come back. A result that isn't smaller is replaced by the original.
- **Merge & split (`/api/v1/merge-split`)** — Word, PowerPoint, Excel/CSV, PDF, audio and video
  - Merge: Word via docxcompose (styles, numbering, pictures kept); PowerPoint by copying each slide with its layout, master, theme, media and notes (every deck keeps its design); spreadsheets as sheets side by side (with formatting) or rows stacked by column name; audio joined; video joined by stream copy when clips match, re-encoded otherwise.
  - Split: Word at headings, page/section breaks or Word's recorded pages; PowerPoint and PDF each / every N / typed ranges; Excel by sheet, every N rows or a column's values; audio and video every N minutes, in equal parts or at typed times (no re-encoding). `/inspect` tells the UI what a file holds.
  - DOC, ODT, RTF, PPT, ODP, XLS and ODS are opened with LibreOffice first.
- **Icon maker (`/api/v1/icon`)** — one picture → `favicon.ico`, PNG favicons, Apple touch, PWA (incl. maskable) icons and `site.webmanifest` with the HTML to paste; Windows `app.ico` (16–256) and Store tiles; macOS `app.icns` and `AppIcon.iconset`; an Xcode-ready iOS `AppIcon.appiconset`; Android mipmaps (legacy, round, adaptive) and the Play Store icon; desktop PNGs 16–1024. Or a single `.ico` with the sizes picked. Square, rounded or round, with padding and a background colour.
  - Verify merge/split, compress and icons end to end: `backend/scripts/check_file_tools.py` (each job through the real isolated worker, every result opened by an independent reader, merged Office files round-tripped through LibreOffice).

### Planned / Expandable Tool Categories
- **Images**: Image Studio (Resize, Convert between PNG/JPG/WebP, Background Removal).
- **Text**: Writing Helper (Summarise, Rewrite, Fix Grammar).
- **Developers**: Developer Utilities (Format & Validate JSON, Base64 Encode/Decode, SHA-256/MD5 Hashing).

---

## System Architecture

The project uses a **Backend-for-Frontend (BFF)** proxy pattern so browser clients never communicate directly with the FastAPI backend and never see the backend authentication token:

```text
┌──────────────────────────┐
│   Browser Client (UI)    │
│  React 19 + Next.js 16   │
└────────────┬─────────────┘
             │  POST /api/tools/...
             ▼
┌──────────────────────────┐
│   Next.js BFF Route      │  ◄── Reads BACKEND_URL & BACKEND_TOKEN (server-only)
│  src/app/api/tools/...   │  ◄── Attaches Authorization: Bearer <BACKEND_TOKEN>
└────────────┬─────────────┘  ◄── Streams binary uploads/responses (zero RAM buffering)
             │  POST /api/v1/...
             ▼
┌──────────────────────────┐
│     FastAPI Backend      │  ◄── Timing-safe Bearer token verification (secrets.compare_digest)
│   backend/app/main.py    │  ◄── Per-service routers, schemas, configs, & custom exceptions
└────────────┬─────────────┘  ◄── Threadpool / ProcessPool execution + BackgroundTasks cleanup
             │
     ┌───────┴───────┬───────────────┬───────────────┬───────────────┬───────────────┐
     ▼               ▼               ▼               ▼               ▼               ▼
┌──────────┐   ┌──────────┐    ┌──────────┐   ┌────────────┐   ┌──────────┐   ┌──────────┐
│Instagram │   │ Facebook │    │ YouTube  │   │Video2Audio │   │   PDF    │   │ QR Code  │
│ Service  │   │ Service  │    │ Service  │   │  Service   │   │ Service  │   │ Service  │
└──────────┘   └──────────┘    └──────────┘   └────────────┘   └──────────┘   └──────────┘
```

---

## Project Structure

```text
do-whatever-you-want/
├── README.md
├── start-dev.ps1                    # Launches backend (4 workers) + frontend dev servers
├── stop-dev.ps1                     # Stops background dev server processes via .dev-pids
├── backend/
│   ├── .env                         # Backend secrets & service settings
│   ├── requirements.txt             # Python dependencies
│   ├── generate_postman.py          # Generates Postman v2.1 collection JSON from OpenAPI
│   └── app/
│       ├── main.py                  # FastAPI app factory, CORS, security headers, & global auth
│       ├── auth/
│       │   └── authorization.py     # Global Bearer token authentication dependency
│       ├── core/
│       │   ├── config.py            # Global settings (HEADER_TOKEN, timeouts, size/duration caps)
│       │   ├── lifespan.py          # Startup/shutdown hooks (FFmpeg, temp dirs, PDF process pool)
│       │   ├── media_size.py        # Pre-download size estimators (yt-dlp & parallel HTTP probes)
│       │   └── utils.py             # cleanup_folder() & cleanup_file() helpers
│       ├── config/                  # Per-service Pydantic settings (instagram, facebook, youtube, pdf, qrcode, universal, compress, merge_split, icon…)
│       ├── schemas/                 # Request/Response Pydantic models (common, instagram, facebook, youtube, qrcode)
│       ├── exceptions/              # Domain-specific exception classes inheriting from AppBaseException
│       ├── services/                # Core extraction, conversion, PDF, and QR business logic
│       │   ├── instagram.py
│       │   ├── facebook.py
│       │   ├── youtube.py
│       │   ├── Video2Audio.py
│       │   ├── pdf.py
│       │   ├── pdf_pool.py          # Isolated ProcessPoolExecutor for GIL-bound PyMuPDF tasks
│       │   ├── qrcode.py
│       │   └── ffmpeg_service.py
│       └── api/
│           └── v1/
│               ├── router.py        # Aggregates all v1 endpoint routers
│               └── endpoints/       # Route controllers (health, instagram, facebook, youtube, pdf, qrcode, universal, compress, merge_split, icon…)
└── frontend/
    ├── .env.local                   # Server-only BACKEND_URL and BACKEND_TOKEN
    ├── package.json
    └── src/
        ├── app/
        │   ├── page.tsx             # Landing page
        │   ├── tools/
        │   │   ├── page.tsx         # All tools directory
        │   │   └── [id]/page.tsx    # Dynamic tool workspace page
        │   └── api/
        │       └── tools/           # Next.js BFF proxy route handlers
        │           ├── [platform]/[action]/route.ts
        │           ├── compress/route.ts
        │           ├── pdf/[action]/route.ts
        │           └── qrcode/generate/route.ts
        ├── components/
        │   └── tools/               # Interactive playgrounds (downloader, convert, pdf, qr, audio-preview)
        └── lib/
            ├── backend.ts           # Shared BFF proxy helpers (backendConfig, proxyUpload, passFile, upstreamError)
            ├── media.ts             # Client helper for link extract & streaming download
            ├── files.ts             # Client helper for file uploads & XHR progress tracking
            ├── pdf.ts               # Client helper for PDF token uploads, estimates, and actions
            ├── qrcode.ts            # Client helper & presets for QR generation
            └── tools.ts             # Central declarative registry of all tools
```

---

## Tech Stack

### Backend
- **Framework**: FastAPI (`>=0.115.0`), Uvicorn (`standard`)
- **Validation & Settings**: Pydantic v2 & `pydantic-settings`
- **Media & Document Engines**: `yt-dlp`, `instaloader`, `ffmpeg-python`, `static-ffmpeg`, `PyMuPDF` (`pymupdf`), `qrcode[pil]`, `Pillow`
- **HTTP Client**: `requests`

### Frontend
- **Framework**: Next.js `16.4.5` (App Router, Turbopack, React `19.3.0`, TypeScript `5`)
- **Styling & Animation**: Tailwind CSS v4, `motion`, `lenis`, `three`, `lucide-react`

---

## Security, Isolation & Hardening

1. **Timing-Safe Bearer Authentication**: Every `/api/v1/*` route requires `Authorization: Bearer <HEADER_TOKEN>`, verified in [`authorization.py`](./backend/app/auth/authorization.py) using `secrets.compare_digest` to prevent timing side-channel attacks.
2. **Server-Only Token Isolation (BFF)**: `BACKEND_TOKEN` lives exclusively in Next.js server memory (`frontend/.env.local` without `NEXT_PUBLIC_`), never exposed to client JavaScript or browser network tabs.
3. **SSRF & Open-Redirect Prevention**:
   - Strict hostname allowlists for Instagram (`.fbcdn.net`, `.cdninstagram.com`), Facebook (`facebook.com`, `fb.watch`), and YouTube (`youtube.com`, `youtu.be`).
   - Hop-by-hop redirect resolution for `fb.watch` and `/share/` links that blocks `/l.php`, `/flx/warn`, and off-domain redirects.
   - Extractor locking (`allowed_extractors`) in `yt-dlp` so arbitrary URLs cannot trigger generic scraping.
4. **Fault Isolation & Non-Blocking Concurrency**:
   - Network and subprocess tasks run in Starlette's threadpool (`run_in_threadpool`).
   - Heavy C-bound PDF jobs (`PyMuPDF`) run in a dedicated `ProcessPoolExecutor` (`pdf_pool.py`) with a parent-alive watchdog and client-disconnect cancellation (`499 Client Closed Request`), preventing worker freezes.
5. **Denial-of-Service (DoS) & Disk Exhaustion Guards**:
   - Rejects live streams (`is_live` / `is_upcoming`) and videos exceeding `MAX_VIDEO_DURATION_SECONDS` (default 3600 seconds / 1 hour).
   - Caps single-file downloads and uploads to `MAX_DOWNLOAD_SIZE_MB` (default 150 MB) and QR logos to `QRCODE_MAX_LOGO_SIZE_MB` (default 10 MB).
   - Ephemeral per-request job directories (`temp/<service>/<uuid>`) are deleted immediately after streaming completes or on exception.
6. **Sanitized Error Responses**: Internal stack traces and upstream errors are logged server-side while returning clean, user-safe HTTP status codes (`400`, `410`, `422`, `502`).

---

## Getting Started

### Prerequisites
- **Python** `3.11+`
- **Node.js** `20+` and `npm`

### Quick Start (Windows PowerShell)
Once `backend/venv`, `frontend/node_modules`, and `.env` files are configured, you can start and stop both servers from the repository root:

```powershell
# Start FastAPI (port 8000, 4 workers) and Next.js (port 3000)
.\start-dev.ps1

# Stop both servers and close their terminal windows
.\stop-dev.ps1
```

---

### 1. Backend Setup (FastAPI)

```powershell
cd backend

# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

Create `backend/.env` (see [Environment Variables](#backend-backendenv) below), then start the server:

```powershell
# Development (with auto-reload)
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Production (multi-worker behind reverse proxy)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers
```

Once running in debug mode (`DEBUG=true`), interactive docs are available at:
- **Swagger UI**: `http://127.0.0.1:8000/docs`
- **ReDoc**: `http://127.0.0.1:8000/redoc`

---

### 2. Frontend Setup (Next.js)

```powershell
cd frontend

# Install dependencies
npm install

# Run development server (Turbopack)
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Global Core Settings (app/core/config.py)
APP_NAME="SocialHub Multi-Service API"
APP_VERSION="1.0.0"
DEBUG=false
HEADER_TOKEN="replace-with-a-strong-random-secret-token"
ALLOWED_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]

# Resource & Safety Limits
TEMP_ROOT_DIR="./temp"
REQUEST_TIMEOUT=25
MAX_DOWNLOAD_SIZE_MB=150
MAX_VIDEO_DURATION_SECONDS=3600

# Optional Per-Service Cookie Paths (Netscape format)
INSTAGRAM_COOKIE_FILE_PATH="cookies_instagram.txt"
FACEBOOK_COOKIE_FILE_PATH="cookies_facebook.txt"
YOUTUBE_COOKIE_FILE_PATH=""

# Optional PDF & QR Service Settings
PDF_CACHE_TTL_SECONDS=1800
PDF_PROCESS_WORKERS=1
QRCODE_MAX_DATA_LENGTH=4096
QRCODE_MAX_LOGO_SIZE_MB=10
```

### Frontend (`frontend/.env.local`)

```env
BACKEND_URL=http://127.0.0.1:8000
BACKEND_TOKEN=replace-with-a-strong-random-secret-token
```

> **Important**: `BACKEND_TOKEN` in `frontend/.env.local` must match `HEADER_TOKEN` in `backend/.env`. Do **not** prefix these variables with `NEXT_PUBLIC_`.

---

## Cookie Configuration (Optional — Age-Gated / Carousel Media)

Public standard videos on YouTube, Facebook, and Instagram work without cookies. However, **cookies are required** when:
- Extracting **Instagram photo posts or multi-item carousels** (Instagram restricts its `/api/v1/media/{id}/info/` endpoint to authenticated sessions).
- Extracting **age-restricted (18+) or sensitive content** on Instagram, Facebook, or YouTube.
- Bypassing datacenter IP bot challenges on cloud VPS hosts.

### How to Export Cookies Safely
1. **Always use a dedicated secondary/burner account** (never use your personal account).
2. Open an **Incognito / Private browsing window** and log in to the platform.
3. Use a browser extension such as **Get cookies.txt LOCALLY** to export cookies in **Netscape HTTP Cookie File** format.
4. **Close the Incognito window without clicking "Log Out"** (clicking Log Out immediately invalidates the `sessionid` / `xs` token on the server).
5. Save the file as `backend/cookies_instagram.txt` or `backend/cookies_facebook.txt` (or configure `*_COOKIE_FILE_PATH` in `backend/.env`).

---

## API Reference

All endpoints are prefixed with `/api/v1` and require the header:
```http
Authorization: Bearer <HEADER_TOKEN>
```

| Method | Endpoint | Description | Request Body / Form | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Service health and version check | — | `200 OK` JSON status |
| `POST` | `/api/v1/instagram/extract` | Fetch Instagram post/reel/carousel metadata & size | `{"url_or_shortcode": "..."}` | `200 OK` JSON metadata & direct URLs |
| `POST` | `/api/v1/instagram/download` | Download Instagram media to client | `{"url_or_shortcode": "..."}` | Binary stream (`.mp4`, `.jpg`, or `.zip`) |
| `POST` | `/api/v1/facebook/extract` | Fetch Facebook video/reel metadata & estimated size | `{"url": "https://www.facebook.com/reel/..."}` | `200 OK` JSON metadata & stream info |
| `POST` | `/api/v1/facebook/download` | Download Facebook video/reel to client | `{"url": "https://www.facebook.com/reel/..."}` | Binary `.mp4` (or `.zip`) stream |
| `POST` | `/api/v1/youtube/extract` | Fetch YouTube video/Short metadata & estimated size | `{"url": "https://www.youtube.com/watch?v=..."}` | `200 OK` JSON metadata (`is_short`, `view_count`, etc.) |
| `POST` | `/api/v1/youtube/download` | Download YouTube video/Short to client | `{"url": "https://youtu.be/..."}` | Binary `.mp4` stream |
| `POST` | `/api/v1/pdf/upload` | Cache a PDF and return a reusable token + page count | `multipart/form-data` (`file`) | `200 OK` JSON (`token`, `filename`, `size`, `page_count`) |
| `POST` | `/api/v1/pdf/merge` | Merge 2+ PDFs (via uploaded `files` or `tokens`) | `multipart/form-data` (`files` or `tokens`) | Binary `.pdf` stream |
| `POST` | `/api/v1/pdf/merge/estimate` | Estimate merged PDF byte size from tokens | `multipart/form-data` (`tokens`) | `200 OK` JSON (`output`, `total_size`) |
| `POST` | `/api/v1/pdf/split` | Split PDF by `page_ranges` (`1-3, 5`) or all pages | `multipart/form-data` (`file`/`token`, `page_ranges`) | Binary `.pdf` (single part) or `.zip` (multiple parts) |
| `POST` | `/api/v1/pdf/split/estimate` | Preview parts, page ranges, and byte sizes for a split | `multipart/form-data` (`token`, `page_ranges`) | `200 OK` JSON (`output`, `total_size`, `parts`) |
| `POST` | `/api/v1/pdf/compress` | Compress PDF by `compression_percentage` (`1–95`) | `multipart/form-data` (`file`/`token`, `compression_percentage`) | Binary `.pdf` stream |
| `POST` | `/api/v1/pdf/compress/estimate` | Sample compressed sizes across strength percentages | `multipart/form-data` (`token`, `percentages`) | `200 OK` JSON (`original_size`, `exact`, `samples`) |
| `POST` | `/api/v1/qrcode/generate` | Generate customized QR code (JSON payload, no logo) | `application/json` (`QRCodeGenerateRequest`) | Binary `.png`, `.svg`, `.webp`, `.jpeg`, or `.pdf` |
| `POST` | `/api/v1/qrcode/generate-with-logo` | Generate customized QR code with optional center logo | `multipart/form-data` (style fields + optional `logo` file) | Binary `.png`, `.webp`, `.jpeg`, or `.pdf` |
| `GET` | `/api/v1/universal/formats` | Every format, and every route this server can run | — | `200 OK` JSON (`categories`, `formats`, `routes`, `engines`, `max_mb`) |
| `POST` | `/api/v1/universal/convert` | Convert any supported file to a target format | `multipart/form-data` (`file`, `target`, optional `source`, optional `options` JSON) | Binary file (or `.zip` for multi-page results) + `X-Convert-Info` JSON header (route, notes) |
| `POST` | `/api/v1/compress` | Compress 1–20 files of any kind | `multipart/form-data` (`files`, `level`: light/recommended/strong) | The file, or a `.zip` of several + `X-Convert-Info` (sizes before/after per file) |
| `POST` | `/api/v1/merge-split/inspect` | What a file holds: pages, slides, headings, sheets/columns, length | `multipart/form-data` (`file`) | `200 OK` JSON |
| `POST` | `/api/v1/merge-split/split` | Split one file into parts | `multipart/form-data` (`file`, `plan` JSON) | `.zip` of parts + `X-Convert-Info` |
| `POST` | `/api/v1/merge-split/merge` | Merge 2–20 files of one kind, in order | `multipart/form-data` (`files`, optional `options` JSON) | The merged file + `X-Convert-Info` |
| `POST` | `/api/v1/icon` | Icons for web, Windows, macOS, iOS, Android, desktop | `multipart/form-data` (`file`, `options` JSON) | `.zip` of icon packs, or one `.ico` |

---

## Protocol for Adding New Tools & Endpoints

Adding a new feature follows a standard 4-step protocol across the stack:

1. **Backend Service & Endpoint (`backend/app/`)**:
   - Add config in `app/config/<tool>.py`, register `TEMP_DIR` in `app/core/lifespan.py`, add exceptions in `app/exceptions/<tool>.py`, schemas in `app/schemas/<tool>.py`, and service logic in `app/services/<tool>.py`.
   - Create the router in `app/api/v1/endpoints/<tool>.py` and include it in `app/api/v1/router.py`.
2. **Frontend BFF Proxy (`frontend/src/app/api/tools/`)**:
   - **Social link downloader** (`/extract` + `/download`): Add the platform ID to `PLATFORMS` in `frontend/src/app/api/tools/[platform]/[action]/route.ts`.
   - **File converter / custom route**: Create `frontend/src/app/api/tools/<tool>/route.ts` using `backendConfig()`, `notConfigured()`, `proxyUpload()`, `upstreamError()`, and `passFile()` from `frontend/src/lib/backend.ts`.
3. **Tool Registry (`frontend/src/lib/tools.ts`)**:
   - Change `status: "soon"` to `status: "live"` and attach the `downloader` (`kind: "link"`) or `converter` (`kind: "file"`) configuration object.
4. **Custom Workspace UI (Optional — `frontend/src/components/tools/playground.tsx`)**:
   - Link downloaders and single-file converters work automatically with `DownloaderPlayground` and `ConvertPlayground`.
   - For bespoke UIs (e.g., `pdf`, `qr`, `text`, or multi-file tools), map the tool in `byKind` or `byId` inside `playground.tsx`.

---

## Postman Collection Generator

To regenerate `backend/postman_collection.json` for testing all API routes in Postman:

```powershell
cd backend
.\venv\Scripts\python.exe generate_postman.py
```

Import the generated `backend/postman_collection.json` file into Postman and verify the collection variables `base_url` (`http://127.0.0.1:8000`) and `bearer_token` (automatically populated from `HEADER_TOKEN` in `backend/.env`).
