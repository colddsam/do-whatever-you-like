"""
Web page → PDF, and which converters this server has. Every format-to-format conversion
(Word/PowerPoint/Excel ↔ PDF and the rest) lives in the universal converter (endpoints/universal.py).
"""

import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.convert import settings
from app.core.utils import cleanup_folder
from app.exceptions.convert import InvalidConvertInputError
from app.services.convert import convert_service
from app.services.pdf_tools import pdf_tools_service

router = APIRouter(prefix="/convert", tags=["Convert"])

MEDIA = {".pdf": "application/pdf"}


def _stem(name: str) -> str:
    return Path(name or "document").stem or "document"


def _respond(path: Path, filename: str, background_tasks: BackgroundTasks, job_dir: Path) -> FileResponse:
    background_tasks.add_task(cleanup_folder, job_dir)
    return FileResponse(path=path, filename=filename, media_type=MEDIA.get(path.suffix.lower(), "application/octet-stream"))


@lru_cache(maxsize=1)
def _chromium_installed() -> bool:
    """Asks Playwright where its Chromium lives (once per process; installs need a restart anyway)."""
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            return Path(p.chromium.executable_path).is_file()
    except Exception:
        return False


@router.get("/capabilities", summary="Which converters this server has installed")
async def capabilities() -> Dict[str, Any]:
    def check() -> Dict[str, Any]:
        return {
            "office": convert_service.soffice() is not None,
            "web": _chromium_installed(),
            "ocr": bool(pdf_tools_service.ocr_languages()),
            "pdfa": pdf_tools_service.ghostscript() is not None,
        }

    return await run_in_threadpool(check)


@router.post("/html-to-pdf", response_class=FileResponse, summary="A public web page (url) or an .html file → PDF")
async def html_to_pdf(
    background_tasks: BackgroundTasks,
    url: Optional[str] = Form(default=None, max_length=2048),
    file: Optional[UploadFile] = File(default=None),
    page_size: str = Form(default="a4", pattern="^(a4|letter|legal|a3)$"),
    landscape: bool = Form(default=False),
    margin: str = Form(default="small", pattern="^(none|small|large)$"),
    background: bool = Form(default=True, description="Print background colours and images"),
    screen: bool = Form(default=True, description="Use the page's screen styles rather than its print styles"),
):
    if bool(url) == bool(file and file.filename):
        raise InvalidConvertInputError("Send a web address or an HTML file (one of the two).")
    job_dir = settings.TEMP_DIR / f"conv_html_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        html_path = None
        if url:
            url = await run_in_threadpool(convert_service.check_public_url, url)
            from urllib.parse import urlparse

            name = (urlparse(url).hostname or "page").removeprefix("www.")
        else:
            convert_service.validate_office(file.filename, "html")
            html_path = job_dir / "page.html"
            await run_in_threadpool(convert_service.save_upload, file.file, html_path, settings.HTML_MAX_MB)
            name = _stem(file.filename)
        out = job_dir / "page.pdf"
        await run_in_threadpool(convert_service.html_to_pdf, out, url, html_path, page_size, landscape, margin, background, screen)
        return _respond(out, f"{name}.pdf", background_tasks, job_dir)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()
