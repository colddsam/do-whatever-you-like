"""
PDF tools: page numbers, watermark, crop, edit & sign, redact, protect, unlock, repair, OCR,
PDF ↔ images, PDF/A and compare.

PDF inputs come as a token from /pdf/upload (the workspace uploads each PDF once) or as a `file`.
Unlock and repair take a `file` only: locked and broken PDFs can't be registered as uploads.
"""

import json
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.api.v1.endpoints.pdf import _resolve_single, _stem
from app.config.pdf import settings
from app.core.utils import cleanup_folder
from app.exceptions.pdf import InvalidPDFInputError
from app.schemas.pdf_tools import Box, EditOp, RedactArea, RedactSearch
from app.services.pdf import pdf_service
from app.services.pdf_pool import run_pdf
from app.services.pdf_tools import IMAGE_EXTENSIONS, pdf_tools_service

router = APIRouter(prefix="/pdf", tags=["PDF tools"])

PDF_MEDIA = "application/pdf"


def _json(raw: Optional[str], what: str, default: Any) -> Any:
    if raw is None or not raw.strip():
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise InvalidPDFInputError(f"`{what}` must be valid JSON.")


def _validation_message(exc: ValidationError) -> str:
    first = exc.errors()[0] if exc.errors() else {}
    return str(first.get("msg", "Invalid options.")).removeprefix("Value error, ")


def _validated(model, items: Any, what: str) -> List[Dict[str, Any]]:
    """Validates here, in the web worker, so bad input is a clean 400 before any work is queued."""
    if not isinstance(items, list):
        raise InvalidPDFInputError(f"`{what}` must be a list.")
    try:
        return [model.model_validate(item).model_dump() for item in items]
    except ValidationError as exc:
        raise InvalidPDFInputError(_validation_message(exc))


async def _pdf_job(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile],
    token: Optional[str],
    prefix: str,
    suffix: str,
    method: str,
    build_args: Callable[[Path, Path, str, Path], tuple],
    *,
    extra_uploads: Optional[List[UploadFile]] = None,
    media_type: str = PDF_MEDIA,
    ext: str = ".pdf",
) -> FileResponse:
    """
    The shape every one-PDF-in, one-file-out tool shares: resolve the input, run the method in the
    process pool, stream the file back and clean up the job folder afterwards (or right away on error).
    """
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"{prefix}_{request_id}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        input_path, display_name = await _resolve_single(file, token, job_dir, request_id)
        output_path = job_dir / f"{_stem(display_name)}_{suffix}{ext}"
        try:
            args = build_args(input_path, output_path, display_name, job_dir)
        except ValidationError as exc:
            raise InvalidPDFInputError(_validation_message(exc))
        info = await run_pdf(method, *args, request=request)
        background_tasks.add_task(cleanup_folder, job_dir)
        # Tools that report what they did (OCR: pages read) send it along as a header.
        headers = {"X-Pdf-Info": json.dumps(info)} if isinstance(info, dict) else None
        return FileResponse(path=output_path, filename=output_path.name, media_type=media_type, headers=headers)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()
        for upload in extra_uploads or []:
            await upload.close()


async def _save_image(upload: UploadFile, target_dir: Path, index: int) -> Path:
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        raise InvalidPDFInputError(
            f"'{upload.filename or 'That file'}' isn't an image we can use. Try JPG, PNG, WebP, GIF, BMP or TIFF."
        )
    target = target_dir / f"image_{index}{ext}"
    await run_in_threadpool(pdf_service.save_upload_to_disk, upload.file, target)
    return target


# ---------- page numbers ----------


@router.post("/page-numbers", response_class=FileResponse, summary="Add page numbers")
async def page_numbers(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    position: str = Form(default="bc", description="tl, tc, tr, bl, bc or br"),
    style: str = Form(default="n", description="n · n_of · page_n · page_n_of"),
    start: int = Form(default=1, ge=0, le=100000, description="Number on the first numbered page"),
    pages: Optional[str] = Form(default=None, max_length=2000, description="Pages to number, e.g. '2-10'. Empty: all"),
    font_size: float = Form(default=11, ge=6, le=48),
    margin: str = Form(default="small", description="small or large"),
    color: str = Form(default="#000000", pattern=r"^#[0-9a-fA-F]{6}$"),
):
    return await _pdf_job(
        request, background_tasks, file, token, "pdf_numbers", "numbered", "tools.page_numbers",
        lambda src, out, name, _: (src, out, position, style, start, pages, font_size, margin, color, name),
    )


# ---------- watermark ----------


@router.post("/watermark", response_class=FileResponse, summary="Stamp text or an image over (or under) pages")
async def watermark(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    image: Optional[UploadFile] = File(default=None, description="Image watermark (mode=image)"),
    mode: str = Form(default="text", pattern="^(text|image)$"),
    text: str = Form(default="", max_length=200),
    font: str = Form(default="sans", pattern="^(sans|serif|mono)$"),
    font_size: float = Form(default=48, ge=8, le=200),
    bold: bool = Form(default=True),
    color: str = Form(default="#C2410C", pattern=r"^#[0-9a-fA-F]{6}$"),
    opacity: float = Form(default=0.3, ge=0.05, le=1),
    rotation: int = Form(default=45, ge=-180, le=180),
    position: str = Form(default="mc", description="tl tc tr ml mc mr bl bc br, or tile"),
    layer: str = Form(default="over", pattern="^(over|under)$"),
    pages: Optional[str] = Form(default=None, max_length=2000),
    image_scale: float = Form(default=0.4, ge=0.05, le=1),
):
    image_path: Dict[str, Path] = {}

    def args(src: Path, out: Path, name: str, job_dir: Path) -> tuple:
        return (src, out, mode, text, font, font_size, bold, color, opacity, rotation, position, layer, pages,
                image_path.get("p"), image_scale, name)

    if mode == "image":
        if image is None:
            raise InvalidPDFInputError("Add the image to use as a watermark.")
        holder = settings.TEMP_DIR / f"pdf_wmimg_{uuid.uuid4().hex}"
        holder.mkdir(parents=True, exist_ok=True)
        try:
            image_path["p"] = await _save_image(image, holder, 0)
            background_tasks.add_task(cleanup_folder, holder)
        except Exception:
            cleanup_folder(holder)
            raise
    try:
        return await _pdf_job(
            request, background_tasks, file, token, "pdf_watermark", "watermarked", "tools.watermark", args,
            extra_uploads=[image] if image else None,
        )
    except Exception:
        if "p" in image_path:
            cleanup_folder(image_path["p"].parent)
        raise


# ---------- crop ----------


@router.post("/crop", response_class=FileResponse, summary="Crop pages to a box")
async def crop(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    box: str = Form(..., description='JSON {"x0":0.1,"y0":0.1,"x1":0.9,"y1":0.9}: fractions of the page as seen'),
    pages: Optional[str] = Form(default=None, max_length=2000),
):
    try:
        parsed = Box.model_validate(_json(box, "box", None))
    except ValidationError as exc:
        raise InvalidPDFInputError(_validation_message(exc))
    return await _pdf_job(
        request, background_tasks, file, token, "pdf_crop", "cropped", "tools.crop",
        lambda src, out, name, _: (src, out, parsed, pages, name),
    )


# ---------- edit & sign ----------


@router.post("/edit", response_class=FileResponse, summary="Add text, images, shapes, drawings and signatures to pages")
async def edit(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    ops: str = Form(..., max_length=2_000_000, description="JSON list of EditOp (see app/schemas/pdf_tools.py)"),
    images: Optional[List[UploadFile]] = File(default=None, description="Images referenced by index from `ops`"),
    suffix: str = Form(default="edited", pattern="^(edited|signed)$"),
):
    images = images or []
    if len(images) > 50:
        raise InvalidPDFInputError("Up to 50 images at a time.")
    op_list = _validated(EditOp, _json(ops, "ops", []), "ops")
    if not op_list:
        raise InvalidPDFInputError("Add something to the pages first.")
    holder = settings.TEMP_DIR / f"pdf_editimg_{uuid.uuid4().hex}"
    try:
        holder.mkdir(parents=True, exist_ok=True)
        saved = [await _save_image(img, holder, i) for i, img in enumerate(images)]
        background_tasks.add_task(cleanup_folder, holder)
    except Exception:
        cleanup_folder(holder)
        for img in images:
            await img.close()
        raise
    try:
        return await _pdf_job(
            request, background_tasks, file, token, "pdf_edit", suffix, "tools.edit",
            lambda src, out, name, _: (src, out, op_list, saved, name),
            extra_uploads=images,
        )
    except Exception:
        cleanup_folder(holder)
        raise


# ---------- redact ----------


@router.post("/redact/find", summary="Find text to redact: words, phrases or kinds of detail (emails, phones…)")
async def redact_find(
    request: Request,
    token: str = Form(...),
    search: str = Form(..., max_length=20000, description='JSON {"terms":[{"text":"…"}],"presets":["email"]}'),
) -> Dict[str, Any]:
    path, meta = await run_in_threadpool(pdf_service.resolve_token, token)
    try:
        query = RedactSearch.model_validate(_json(search, "search", {})).model_dump()
    except ValidationError as exc:
        raise InvalidPDFInputError(_validation_message(exc))
    return await run_pdf("tools.redact_find", path, query, meta["filename"], request=request)


@router.post("/redact", response_class=FileResponse, summary="Permanently black out areas (text, images and drawings under them are removed)")
async def redact(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    areas: str = Form(..., max_length=2_000_000, description='JSON list of {"page":1,"box":{…}}'),
    clean_metadata: bool = Form(default=True, description="Also remove author, title and other hidden details"),
):
    area_list = _validated(RedactArea, _json(areas, "areas", []), "areas")
    return await _pdf_job(
        request, background_tasks, file, token, "pdf_redact", "redacted", "tools.redact",
        lambda src, out, name, _: (src, out, area_list, clean_metadata, name),
    )


# ---------- protect / unlock / repair ----------


@router.post("/protect", response_class=FileResponse, summary="Encrypt with a password (AES-256)")
async def protect(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    password: str = Form(..., min_length=1, max_length=128),
    owner_password: str = Form(default="", max_length=128),
    allow_print: bool = Form(default=True),
    allow_copy: bool = Form(default=False),
    allow_edit: bool = Form(default=False),
):
    return await _pdf_job(
        request, background_tasks, file, token, "pdf_protect", "protected", "tools.protect",
        lambda src, out, name, _: (src, out, password, owner_password, allow_print, allow_copy, allow_edit, name),
    )


async def _raw_pdf_job(file: UploadFile, prefix: str) -> tuple:
    pdf_service.validate_filename(file.filename)
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"{prefix}_{request_id}"
    job_dir.mkdir(parents=True, exist_ok=True)
    src = job_dir / "input.pdf"
    await run_in_threadpool(pdf_service.save_upload_to_disk, file.file, src)
    return job_dir, src, Path(file.filename or "document.pdf").name


@router.post("/unlock", response_class=FileResponse, summary="Remove a PDF's password and restrictions")
async def unlock(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    password: str = Form(default="", max_length=128),
):
    job_dir: Optional[Path] = None
    try:
        job_dir, src, name = await _raw_pdf_job(file, "pdf_unlock")
        out = job_dir / f"{_stem(name)}_unlocked.pdf"
        await run_pdf("tools.unlock", src, out, password, name, request=request)
        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(path=out, filename=out.name, media_type=PDF_MEDIA)
    except Exception:
        if job_dir:
            cleanup_folder(job_dir)
        raise
    finally:
        await file.close()


@router.post("/repair", response_class=FileResponse, summary="Rebuild a damaged PDF and keep every page that can be read")
async def repair(request: Request, background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    job_dir: Optional[Path] = None
    try:
        job_dir, src, name = await _raw_pdf_job(file, "pdf_repair")
        out = job_dir / f"{_stem(name)}_repaired.pdf"
        info = await run_pdf("tools.repair", src, out, name, request=request)
        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(
            path=out, filename=out.name, media_type=PDF_MEDIA, headers={"X-Pdf-Info": json.dumps(info)},
        )
    except Exception:
        if job_dir:
            cleanup_folder(job_dir)
        raise
    finally:
        await file.close()


# ---------- OCR ----------


@router.get("/ocr/languages", summary="Languages text recognition can read on this server")
async def ocr_languages() -> Dict[str, Any]:
    langs = await run_in_threadpool(pdf_tools_service.ocr_languages)
    return {"available": bool(langs), "languages": langs}


@router.post("/ocr", response_class=FileResponse, summary="Make scanned pages searchable and selectable")
async def ocr(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    languages: Optional[List[str]] = Form(default=None, description="Tesseract codes, e.g. eng, fra, hin. Up to 5"),
    force: bool = Form(default=False, description="Also read pages that already have text"),
):
    return await _pdf_job(
        request, background_tasks, file, token, "pdf_ocr", "ocr", "tools.ocr",
        lambda src, out, name, _: (src, out, languages or ["eng"], force, name),
    )


# ---------- images → PDF ----------


@router.post("/from-images", response_class=FileResponse, summary="Images (or phone scans) to one PDF, in order")
async def from_images(
    request: Request,
    background_tasks: BackgroundTasks,
    images: List[UploadFile] = File(..., description="JPG, PNG, WebP, GIF, BMP or TIFF, in page order"),
    page_size: str = Form(default="a4", description="fit, a4, letter, legal or a3"),
    orientation: str = Form(default="auto", pattern="^(auto|portrait|landscape)$"),
    margin: str = Form(default="small", pattern="^(none|small|large)$"),
    enhance: bool = Form(default=False, description="Scan look: greyscale with stronger contrast"),
    ocr: bool = Form(default=False, description="Also recognise the text, so the PDF can be searched and copied from"),
    languages: Optional[List[str]] = Form(default=None, description="OCR languages (Tesseract codes, e.g. eng, hin). Up to 5"),
):
    if len(images) > settings.IMAGES_MAX_FILES:
        raise InvalidPDFInputError(f"Up to {settings.IMAGES_MAX_FILES} images at a time.")
    job_dir = settings.TEMP_DIR / f"pdf_fromimg_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        saved = [await _save_image(img, job_dir, i) for i, img in enumerate(images)]
        names = [Path(img.filename or f"image {i + 1}").name for i, img in enumerate(images)]
        out = job_dir / f"{_stem(names[0]) if len(names) == 1 else 'images'}{'_scan' if enhance else ''}.pdf"
        await run_pdf("tools.from_images", saved, names, out, page_size, orientation, margin, enhance, request=request)
        headers = {}
        if ocr:
            # Scans become searchable in the same request (the OCR PDF tool's own engine).
            searchable = job_dir / f"{out.stem}_ocr.pdf"
            report = await run_pdf("tools.ocr", out, searchable, languages or ["eng"], False, out.name, request=request)
            searchable.replace(out)
            headers["X-PDF-Info"] = json.dumps(report, ensure_ascii=True, default=str)
        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(path=out, filename=out.name, media_type=PDF_MEDIA, headers=headers)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        for img in images:
            await img.close()


# ---------- PDF/A ----------


@router.post("/pdfa", response_class=FileResponse, summary="Convert to PDF/A for long-term archiving")
async def to_pdfa(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    token: Optional[str] = Form(default=None),
    level: int = Form(default=2, ge=1, le=3, description="1, 2 or 3 (the 'b' conformance level)"),
):
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"pdf_pdfa_{request_id}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        src, name = await _resolve_single(file, token, job_dir, request_id)
        out = job_dir / f"{_stem(name)}_pdfa.pdf"
        await run_in_threadpool(pdf_tools_service.to_pdfa, src, out, level, job_dir / "work", name)
        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(path=out, filename=out.name, media_type=PDF_MEDIA)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()


# ---------- compare ----------


@router.post("/compare", summary="What changed between two versions: every insertion, deletion and edit, with where it is")
async def compare(
    request: Request,
    token_old: str = Form(..., description="Token of the original (from /pdf/upload)"),
    token_new: str = Form(..., description="Token of the changed version"),
) -> Dict[str, Any]:
    (pa, ma), (pb, mb) = await run_in_threadpool(lambda: (pdf_service.resolve_token(token_old), pdf_service.resolve_token(token_new)))
    return await run_pdf("tools.compare", pa, pb, ma["filename"], mb["filename"], request=request)


@router.post("/compare/report", response_class=FileResponse, status_code=status.HTTP_200_OK, summary="Side-by-side PDF with every change marked")
async def compare_report(
    request: Request,
    background_tasks: BackgroundTasks,
    token_old: str = Form(...),
    token_new: str = Form(...),
):
    (pa, ma), (pb, mb) = await run_in_threadpool(lambda: (pdf_service.resolve_token(token_old), pdf_service.resolve_token(token_new)))
    job_dir = settings.TEMP_DIR / f"pdf_compare_{uuid.uuid4().hex}"
    try:
        out = job_dir / f"{_stem(mb['filename'])}_comparison.pdf"
        await run_pdf("tools.compare_report", pa, pb, ma["filename"], mb["filename"], out, request=request)
        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(path=out, filename=out.name, media_type=PDF_MEDIA)
    except Exception:
        cleanup_folder(job_dir)
        raise
