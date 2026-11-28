# Security Policy

Thank you for helping keep **Do-Whatever-You-Like** and its users safe. We take security vulnerabilities seriously and appreciate responsible disclosure.

---

## Supported Versions

Only the active production branch (`main`) and the live deployment at [do-whatever-you-like.colddsam.com](https://do-whatever-you-like.colddsam.com) receive security updates.

| Version / Branch | Supported | Notes |
| :--- | :---: | :--- |
| `main` (live production) | ✅ | Continuously deployed to Vercel (frontend) and Render (backend) |
| Older commits / forks | ❌ | Update to the latest `main` before reporting |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, pull requests, or discussions.**

### Preferred Channels

1. **GitHub Private Vulnerability Reporting (Recommended):**
   Submit a private advisory directly at [github.com/colddsam/do-whatever-you-like/security/advisories/new](https://github.com/colddsam/do-whatever-you-like/security/advisories/new).
2. **Email:**
   Send details to **contact@colddsam.com** with the subject prefix `[SECURITY]`.

### What to Include

To help us reproduce and fix the issue quickly, please include:

- The affected component, route, or tool (e.g., `/api/v1/...`, `/api/tools/...`, or a specific `/tools/<id>` page).
- Clear step-by-step reproduction instructions or a minimal proof of concept (PoC).
- Potential impact (e.g., SSRF, arbitrary file read, XSS, auth bypass, RCE).
- Any sample payload or sanitized file (avoid sending real sensitive/private user data).
- Suggested remediation or patch ideas, if you have them.

### Response & Disclosure Timeline

| Stage | Target SLA |
| :--- | :--- |
| Initial acknowledgment | Within **48 hours** |
| Triage & severity assessment | Within **5 business days** |
| Status updates | Every **7 days** while a fix is in progress |
| Coordinated public disclosure | Upon fix deployment (up to **90 days** from report) |

---

## Scope

### In Scope

- Authentication or authorization bypasses (`HEADER_TOKEN`, signed `X-Upload-Ticket` verification).
- Server-Side Request Forgery (SSRF) or internal network probing via downloader, HTML-to-PDF/Image, thumbnail resolver, or developer network tools.
- Upload guard bypasses (`backend/app/core/file_guard.py`) allowing disguised executables or unsupported payloads into processing engines.
- Command injection, path traversal, or arbitrary file read/write inside isolated job wrappers (FFmpeg, LibreOffice, Tesseract, Ghostscript, Pandoc, Chromium, yt-dlp, PyMuPDF).
- Cross-Site Scripting (XSS), CSRF, or Content Security Policy (CSP) bypasses on `do-whatever-you-like.colddsam.com`.
- Cross-request data or temporary file leakage between jobs.

### Out of Scope

- Volumetric Denial of Service (DoS / DDoS), load testing, or resource-exhaustion attacks against the free-tier hosting infrastructure (Render `512 MB RAM` / Vercel Hobby).
- Rate limiting, blocks, or availability changes enforced by third-party platforms (YouTube, Instagram, Facebook, Groq, Frankfurter).
- Automated vulnerability scanner output without a verified, reproducible security impact.
- Self-XSS, clickjacking on non-sensitive static views, or missing headers on endpoints that do not expose risk.
- Social engineering, phishing, or attacks targeting maintainers' personal accounts.

---

## Security Architecture & Controls

Do-Whatever-You-Like is designed around **privacy by default** and **defense in depth**:

- **Client-Side Execution First:** Most utilities (developer tools, document/Office/CSV/PDF viewers, WhatsApp chat analyzer, period tracker, chart/flowchart makers, archive inspector, metadata remover) run strictly in browser memory and WebAssembly so user files never leave the device.
- **Secret & Token Isolation:** The backend API secret (`HEADER_TOKEN`) is stored only on the Next.js server proxy (`/api/tools/*`) and is never exposed to the browser. Direct large-file uploads use short-lived, scope-bound signed tickets (`X-Upload-Ticket`). Interactive API docs (`/docs`, `/redoc`, `/openapi.json`) are disabled when `DEBUG=false`.
- **Upload Guard & Size Caps:** Incoming files are validated both client-side (`frontend/src/lib/file-sniff.ts`) and server-side by inspecting magic bytes, container layouts, and text structure (`backend/app/core/file_guard.py`) before any parser opens them. Oversized payloads are rejected up front by `BodySizeLimitMiddleware` (`backend/app/core/limits.py`).
- **Process Isolation, Concurrency Lanes & Ephemeral Storage:** Server jobs execute in dedicated per-request temporary directories and isolated child processes with strict timeouts (`backend/app/core/isolation.py`), serialized behind shared heavy/light concurrency lanes (`backend/app/core/lanes.py`), and cleaned up immediately after the response completes.
- **SSRF & Redirect Validation:** Media downloaders restrict inputs to known platform hosts, while network devtools, HTML capture, and server-side thumbnail fetching (`backend/app/core/media_thumbnail.py`, `backend/app/services/devtools.py`) validate public IP resolution and block private/loopback/link-local ranges across redirects.
- **Hardened HTTP Headers:**
  - **Frontend (`frontend/next.config.ts`):** `Content-Security-Policy` (`frame-ancestors 'self'; base-uri 'self'; object-src 'self' blob:`), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and restrictive `Permissions-Policy`.
  - **Backend (`backend/app/main.py`):** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store`.

---

## Self-Hosting Security Checklist

If you deploy or run your own instance of Do-Whatever-You-Like:

1. **Generate a strong `HEADER_TOKEN`** (at least 32 random bytes) and set the exact same value as `BACKEND_TOKEN` in `frontend/.env.local` (or Vercel environment variables).
2. **Never expose secrets publicly:** Do not prefix `BACKEND_TOKEN` or API keys with `NEXT_PUBLIC_`.
3. **Keep `DEBUG=false` in production** so `/docs`, `/redoc`, and `/openapi.json` remain disabled.
4. **Restrict `ALLOWED_ORIGINS`** in `backend/.env` to your exact frontend origin(s) rather than `*`.
5. **Protect cookie files:** If using `cookies_instagram.txt`, use a dedicated spare account, keep the file git-ignored, and store it as a Secret File in production (e.g., `/etc/secrets/cookies_instagram.txt` on Render).
6. **Keep dependencies patched:** Regularly run `npm audit` in `frontend/` and keep `backend/requirements.txt` (especially `yt-dlp`, `instaloader`, `fastapi`, and `pymupdf`) up to date.

---

## Safe Harbor

We support good-faith security research. If you make a genuine effort to comply with this policy — avoiding privacy violations, data destruction, and service disruption on free-tier infrastructure — we will not pursue legal action against you for responsible vulnerability research and disclosure.
