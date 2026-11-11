"""
Document conversion: Word/PowerPoint/Excel/HTML → PDF, web page → PDF, and PDF → Word/PowerPoint/Excel.
PDF inputs accept a token from /pdf/upload (or a `file`), like every PDF tool.
"""

import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.convert import settings
from app.core.utils import cleanup_folder
from app.exceptions.convert import InvalidConvertInputError
from app.services.convert import convert_service
from app.services.pdf import pdf_service
from app.services.pdf_pool import run_pdf
from app.services.pdf_tools import pdf_tools_service

router = APIRouter(prefix="/convert", tags=["Convert"])

MEDIA = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _stem(name: str) -> str:
    return Path(name or "document").stem or "document"


async def _pdf_input(file: Optional[UploadFile], token: Optional[str], job_dir: Path) -> tuple:
    if token:
        path, meta = await run_in_threadpool(pdf_service.resolve_token, token)
        return path, meta["filename"]
    if file is None or not file.filename:
        raise InvalidConvertInputError("Upload a PDF as `file`, or pass a `token` from /pdf/upload.")
    pdf_service.validate_filename(file.filename)
    target = job_dir / "input.pdf"
    await run_in_threadpool(pdf_service.save_upload_to_disk, file.file, target)
    return target, Path(file.filename).name


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


@router.post("/office-to-pdf", response_class=FileResponse, summary="Word, PowerPoint, Excel or HTML file → PDF")
async def office_to_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    kind: str = Form(..., pattern="^(word|powerpoint|excel|html)$"),
    one_page_sheets: bool = Form(default=False, description="Excel: each sheet on a single page"),
):
    convert_service.validate_office(file.filename, kind)
    job_dir = settings.TEMP_DIR / f"conv_office_{uuid.uuid4().hex}"
    try:
        name = Path(file.filename or "document").name
        # LibreOffice names its output after the input, so keep a safe, predictable input name.
        src = job_dir / f"document{Path(name).suffix.lower()}"
        await run_in_threadpool(convert_service.save_upload, file.file, src)
        out = await run_in_threadpool(convert_service.office_to_pdf, src, job_dir / "out", kind, one_page_sheets)
        return _respond(out, f"{_stem(name)}.pdf", background_tasks, job_dir)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()


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


@router.post("/pdf-to-word", response_class=FileResponse, summary="PDF → editable Word document (.docx)")
async def pdf_to_word(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
):
    job_dir = settings.TEMP_DIR / f"conv_word_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        src, name = await _pdf_input(file, token, job_dir)
        out = job_dir / "document.docx"
        await run_pdf("convert.pdf_to_word", src, out, request=request)
        return _respond(out, f"{_stem(name)}.docx", background_tasks, job_dir)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()


@router.post("/pdf-to-powerpoint", response_class=FileResponse, summary="PDF → PowerPoint (.pptx), one slide per page")
async def pdf_to_powerpoint(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
):
    job_dir = settings.TEMP_DIR / f"conv_ppt_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        src, name = await _pdf_input(file, token, job_dir)
        # A private copy with a fixed name: LibreOffice names the result after its input.
        local = job_dir / "slides.pdf"
        if src != local:
            await run_in_threadpool(lambda: local.write_bytes(src.read_bytes()))
        out = await run_in_threadpool(convert_service.pdf_to_powerpoint, local, job_dir / "out")
        return _respond(out, f"{_stem(name)}.pptx", background_tasks, job_dir)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()


@router.post("/pdf-to-excel", response_class=FileResponse, summary="PDF tables → Excel workbook (.xlsx)")
async def pdf_to_excel(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    mode: str = Form(default="tables", pattern="^(tables|pages)$", description="A sheet per table, or per page"),
):
    job_dir = settings.TEMP_DIR / f"conv_excel_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        src, name = await _pdf_input(file, token, job_dir)
        out = job_dir / "tables.xlsx"
        await run_pdf("convert.pdf_to_excel", src, out, mode, request=request)
        return _respond(out, f"{_stem(name)}.xlsx", background_tasks, job_dir)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()
