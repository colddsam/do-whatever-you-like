# SocialHub (kinetiK) — Multi-Platform Media & Utility Toolkit

A full-stack, security-hardened media extraction, conversion, and developer utility platform built with **Next.js 16 (App Router + Turbopack)** on the frontend and a modular **FastAPI** service layer on the backend.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Security & Hardening](#security--hardening)
- [Getting Started](#getting-started)
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

**SocialHub** provides a unified web workspace for downloading public social media content (Instagram, Facebook, YouTube) and transforming media files (such as extracting MP3 audio from video files), without storing user files permanently on disk.

All media jobs run inside isolated, per-request temporary directories (`temp/<service>/<job_id>`) that are automatically purged via FastAPI `BackgroundTasks` immediately after the response stream finishes.

---

## Features

### Live Tools
- **Instagram Downloader (`/api/v1/instagram`)**
  - Supports Reels (`/reel/...`), Posts (`/p/...`), TV (`/tv/...`), and multi-item Carousels.
  - Dual-engine extraction (`yt-dlp` primary + `Instaloader` private mobile API fallback for photo posts and mixed photo/video carousels).
  - Automatically packages multi-item carousels into a single `.zip` archive or streams single items directly.
- **Facebook Downloader (`/api/v1/facebook`)**
  - Supports Facebook Watch videos, Reels (`/reel/...`), `fb.watch` shortlinks, and `/share/r/...` / `/share/v/...` redirect links.
  - Pre-validates and resolves share redirects hop-by-hop with SSRF protection.
- **YouTube Video & Shorts Downloader (`/api/v1/youtube`)**
  - Supports standard videos (`/watch?v=...`), YouTube Shorts (`/shorts/...`), `youtu.be` shortlinks, and raw 11-character video IDs.
  - Automatically merges best MP4 video + M4A audio streams via bundled `static-ffmpeg`.
- **Video to Audio Converter (`/api/v1/video2audio`)**
  - Accepts uploaded video files (`.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`, `.flv`, `.m4v`) and extracts `192kbps` MP3 audio streams on the fly.

### Planned / Expandable Tool Categories
- **Social**: TikTok, X (Twitter), Pinterest, Reddit, LinkedIn, SoundCloud, Twitch Clips, Vimeo.
- **File & Media**: Audio Trimmer, Video Compressor, Image Converter, PDF Toolkit, Archive Extractor.
- **Text & Dev**: JSON Studio, Regex Lab, Diff Checker, Markdown Preview, Base64/JWT Inspector.
- **Generate**: QR Studio, Color Palette Generator, Password/Key Generator.

---

## System Architecture

The project uses a **Backend-for-Frontend (BFF)** proxy pattern so browser clients never communicate directly with the FastAPI backend and never see the backend authentication token:

```
┌──────────────────────────┐
│   Browser Client (UI)    │
│  React 19 + Next.js 16   │
└────────────┬─────────────┘
             │  POST /api/tools/...
             ▼
┌──────────────────────────┐
│   Next.js BFF Route      │  ◄── Reads BACKEND_URL & BACKEND_TOKEN (server-only)
│  src/app/api/tools/...   │  ◄── Attaches Authorization: Bearer <BACKEND_TOKEN>
└────────────┬─────────────┘  ◄── Streams binary response via passFile() (zero RAM buffering)
             │  POST /api/v1/...
             ▼
┌──────────────────────────┐
│     FastAPI Backend      │  ◄── Timing-safe Bearer token verification (secrets.compare_digest)
│   backend/app/main.py    │  ◄── Per-service routers, schemas, configs, & custom exceptions
└────────────┬─────────────┘  ◄── Non-blocking threadpool execution + BackgroundTasks cleanup
             │
     ┌───────┴────────┬────────────────┬────────────────┐
     ▼                ▼                ▼                ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐
│Instagram │    │ Facebook │    │ YouTube  │    │ Video2Audio  │
│ Service  │    │ Service  │    │ Service  │    │   Service    │
└──────────┘    └──────────┘    └──────────┘    └──────────────┘
```

---

## Project Structure

```text
socialhub/
├── README.md
├── backend/
│   ├── .env                         # Backend secrets & service settings
│   ├── requirements.txt             # Python dependencies
│   ├── generate_postman.py          # Generates Postman v2.1 collection JSON
│   └── app/
│       ├── main.py                  # FastAPI app initialization, CORS, & exception handlers
│       ├── auth/
│       │   └── authorization.py     # Global Bearer token authentication dependency
│       ├── core/
│       │   ├── config.py            # Global settings (HEADER_TOKEN, timeouts, size/duration caps)
│       │   ├── lifespan.py          # Startup/shutdown hooks (FFmpeg init & temp dir cleanup)
│       │   └── utils.py             # Background directory cleanup utilities
│       ├── config/                  # Per-service Pydantic settings (instagram, facebook, youtube, video2audio)
│       ├── schemas/                 # Request/Response Pydantic models with URL validation
│       ├── exceptions/              # Domain-specific exception classes
│       ├── services/                # Core extraction/conversion business logic
│       │   ├── instagram.py
│       │   ├── facebook.py
│       │   ├── youtube.py
│       │   ├── Video2Audio.py
│       │   └── ffmpeg_service.py
│       └── api/
│           └── v1/
│               ├── router.py        # Aggregates all v1 endpoint routers
│               └── endpoints/       # Route controllers (health, instagram, facebook, youtube, video2audio)
└── frontend/
    ├── .env.local                   # Server-only BACKEND_URL and BACKEND_TOKEN
    ├── package.json
    └── src/
        ├── app/
        │   ├── page.tsx             # Landing page
        │   ├── tools/
        │   │   ├── page.tsx         # All tools directory
        │   │   └── [id]/page.tsx    # Dynamic tool workspace page (with Suspense streaming)
        │   └── api/
        │       └── tools/           # Next.js BFF proxy route handlers
        │           ├── [platform]/[action]/route.ts
        │           └── video2audio/extract/route.ts
        ├── components/
        │   └── tools/               # Interactive playgrounds (DownloaderPlayground, ConvertPlayground)
        └── lib/
            ├── backend.ts           # Shared BFF proxy helpers (backendConfig, passFile, upstreamError)
            ├── downloader.ts        # Client helper for link extract & streaming download with progress
            ├── files.ts             # Client helper for file uploads & XHR progress tracking
            └── tools.ts             # Central declarative registry of all tools
```

---

## Tech Stack

### Backend
- **Framework**: FastAPI (`>=0.115.0`), Uvicorn (`standard`)
- **Validation & Settings**: Pydantic v2 & `pydantic-settings`
- **Media Engines**: `yt-dlp`, `instaloader`, `ffmpeg-python`, `static-ffmpeg`
- **HTTP Client**: `requests`

### Frontend
- **Framework**: Next.js `16.4.5` (App Router, Turbopack, React `19.3.0`, TypeScript `5`)
- **Styling & Animation**: Tailwind CSS v4, `motion`, `lenis`, `three`, `lucide-react`

---

## Security & Hardening

1. **Timing-Safe Bearer Authentication**: Every `/api/v1/*` route requires `Authorization: Bearer <HEADER_TOKEN>`, verified in [`authorization.py`](./backend/app/auth/authorization.py) using `secrets.compare_digest` to prevent timing side-channel attacks.
2. **Server-Only Token Isolation (BFF)**: `BACKEND_TOKEN` lives exclusively in Next.js server memory (`frontend/.env.local` without `NEXT_PUBLIC_`), never exposed to client JavaScript or browser network tabs.
3. **SSRF & Open-Redirect Prevention**:
   - Strict hostname allowlists for Instagram, Facebook, and YouTube.
   - Hop-by-hop redirect resolution for `fb.watch` and `/share/` links that blocks `/l.php`, `/flx/warn`, and off-domain redirects.
   - Extractor locking (`allowed_extractors`) in `yt-dlp` so arbitrary URLs cannot trigger generic scraping.
4. **Denial-of-Service (DoS) & Disk Exhaustion Guards**:
   - Rejects live streams (`is_live` / `is_upcoming`) and videos exceeding `MAX_VIDEO_DURATION_SECONDS` (default 30 minutes).
   - Caps single-file downloads and uploads to `MAX_DOWNLOAD_SIZE_MB` (default 150 MB) and carousel item counts (`MAX_CAROUSEL_ITEMS`).
   - Ephemeral per-request job directories (`temp/<service>/<uuid>`) are deleted immediately after streaming completes.
5. **Sanitized Error Responses**: Internal stack traces and upstream authentication failures are logged server-side while returning clean, user-safe HTTP status codes (`400`, `422`, `502`).

---

## Getting Started

### Prerequisites
- **Python** `3.11+`
- **Node.js** `20+` and `npm`

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

Once running in debug mode (`DEBUG=true`), interactive Swagger docs are available at:
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
# Global Core Settings
APP_TITLE="Social Media Downloader API"
APP_VERSION="1.0.0"
DEBUG=false
HEADER_TOKEN="replace-with-a-strong-random-secret-token"
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]

# Resource & Safety Limits
TEMP_ROOT_DIR="./temp"
MAX_DOWNLOAD_SIZE_MB=150
MAX_VIDEO_DURATION_SECONDS=1800
MAX_CAROUSEL_ITEMS=20
REQUEST_TIMEOUT=20

# Optional Per-Service Cookie Paths (Netscape format)
INSTAGRAM_COOKIE_FILE_PATH="./cookies.txt"
FACEBOOK_COOKIE_FILE_PATH="./fb_cookies.txt"
YOUTUBE_COOKIE_FILE_PATH="./yt_cookies.txt"
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
- Extracting **Instagram photo posts or multi-item carousels** (Instagram restricts its `/api/v1/media/{id}/info/` endpoint to logged-in sessions).
- Extracting **age-restricted (18+) or sensitive content** on Instagram, Facebook, or YouTube.
- Bypassing datacenter IP bot challenges on cloud VPS hosts.

### How to Export Cookies Safely
1. **Always use a dedicated secondary/burner account** (never use your personal account).
2. Open an **Incognito / Private browsing window** and log in to the platform.
3. Use a browser extension such as **Get cookies.txt LOCALLY** to export cookies in **Netscape HTTP Cookie File** format.
4. **Close the Incognito window without clicking "Log Out"** (clicking Log Out immediately invalidates the `sessionid` / `xs` token on the server).
5. Point `INSTAGRAM_COOKIE_FILE_PATH`, `FACEBOOK_COOKIE_FILE_PATH`, or `YOUTUBE_COOKIE_FILE_PATH` in `backend/.env` to the exported file.

---

## API Reference

All endpoints are prefixed with `/api/v1` and require the header:
```http
Authorization: Bearer <HEADER_TOKEN>
```

| Method | Endpoint | Description | Request Body / Form | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Service health check | — | `200 OK` JSON status |
| `POST` | `/api/v1/instagram/extract` | Fetch Instagram post/reel/carousel metadata | `{"url": "https://www.instagram.com/reel/..."}` | `200 OK` JSON metadata & direct URLs |
| `POST` | `/api/v1/instagram/download` | Download Instagram media to client | `{"url": "https://www.instagram.com/p/..."}` | Binary stream (`.mp4`, `.jpg`, or `.zip` for carousels) |
| `POST` | `/api/v1/facebook/extract` | Fetch Facebook video/reel metadata | `{"url": "https://www.facebook.com/reel/..."}` | `200 OK` JSON metadata & stream info |
| `POST` | `/api/v1/facebook/download` | Download Facebook video/reel to client | `{"url": "https://www.facebook.com/share/r/..."}` | Binary `.mp4` stream |
| `POST` | `/api/v1/youtube/extract` | Fetch YouTube video/Short metadata | `{"url": "https://www.youtube.com/watch?v=..."}` | `200 OK` JSON metadata (`is_short`, `view_count`, etc.) |
| `POST` | `/api/v1/youtube/download` | Download YouTube video/Short to client | `{"url": "https://youtu.be/..."}` | Binary `.mp4` stream |
| `POST` | `/api/v1/video2audio/extract` | Extract MP3 audio from uploaded video | `multipart/form-data` (`file`: video file) | Binary `.mp3` (`audio/mpeg`) stream |

---

## Protocol for Adding New Tools & Endpoints

Adding a new feature follows a standard 4-step protocol across the stack:

1. **Backend Service & Endpoint (`backend/app/`)**:
   - Add config in `app/config/<tool>.py`, exceptions in `app/exceptions/<tool>.py`, schemas in `app/schemas/<tool>.py`, and service logic in `app/services/<tool>.py`.
   - Create the router in `app/api/v1/endpoints/<tool>.py` and include it in `app/api/v1/router.py`.
2. **Frontend BFF Proxy (`frontend/src/app/api/tools/`)**:
   - **Social link downloader** (`/extract` + `/download`): Add the platform ID to `PLATFORMS` in `frontend/src/app/api/tools/[platform]/[action]/route.ts`.
   - **File converter / custom route**: Create `frontend/src/app/api/tools/<tool>/route.ts` using `backendConfig()`, `notConfigured()`, `upstreamError()`, and `passFile()` from `frontend/src/lib/backend.ts`.
3. **Tool Registry (`frontend/src/lib/tools.ts`)**:
   - Change `status: "soon"` to `status: "live"` and attach the `downloader` (`kind: "link"`) or `converter` (`kind: "file"`) configuration object.
4. **Custom Workspace UI (Optional — `frontend/src/components/tools/playground.tsx`)**:
   - Link downloaders and single-file converters work automatically with `DownloaderPlayground` and `ConvertPlayground`.
   - For bespoke UIs (e.g., `text`, `generate`, or multi-file tools), map the tool in `byKind` or `byId` inside `playground.tsx`.

---

## Postman Collection Generator

To regenerate `backend/postman_collection.json` for testing all API routes in Postman:

```powershell
cd backend
python generate_postman.py
```

Import the generated `backend/postman_collection.json` file into Postman and set the collection variables `base_url` (`http://127.0.0.1:8000`) and `bearer_token` (your `HEADER_TOKEN`).

