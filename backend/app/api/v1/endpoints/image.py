"""
Image tools (the iLoveIMG set): compress, resize, crop, convert to/from JPG (and animated GIF), rotate,
watermark, blur faces, remove background, upscale, and HTML to image. Meme generator and photo editor
run in the browser (canvas), so they need no endpoint.

Every tool takes one or more `files`, runs in the process pool and answers with the image, or a ZIP
when there are several. An `X-Image-Info` header describes each result (name, sizes before and after,
pixel size), so the page can show exact numbers before anything is downloaded.
"""

import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.config.image import settings
from app.core.config import app_settings
from app.core.utils import cleanup_folder
from app.exceptions.image import ImageProcessingError, InvalidImageError
from app.exceptions.pdf import PDFProcessingError
from app.schemas.image import Area, Capabilities, FaceDetection, WatermarkOptions
from app.services.image import image_service, json_info
from app.services.pdf_pool import run_pdf

router = APIRouter(prefix="/image", tags=["Image tools"])

MEDIA = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".zip": "application/zip"}


def _json(raw: Optional[str], what: str) -> Any:
    try:
        return json.loads(raw or "")
    except json.JSONDecodeError:
        raise InvalidImageError(f"`{what}` must be valid JSON.")


def _message(exc: ValidationError) -> str:
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", ()))
    return f"{where}: {first.get('msg', 'invalid value')}".strip(": ")


async def _save(files: List[UploadFile], tool: str, job_dir: Path, limit: Optional[int] = None) -> List[Tuple[str, str]]:
    """Validates names and counts first, then saves each upload in chunks within one shared size budget."""
    limit = limit or settings.MAX_FILES
    files = [f for f in files if f is not None and f.filename]
    if not files:
        raise InvalidImageError("Add an image.")
    if len(files) > limit:
        raise InvalidImageError(f"Up to {limit} images at a time, please.")
    for f in files:
        image_service.validate_filename(f.filename, tool)
    budget = [app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024]
    items = []
    for i, f in enumerate(files):
        name = Path(f.filename).name
        path = job_dir / "in" / f"{i:03d}{Path(name).suffix.lower()}"
        path.parent.mkdir(parents=True, exist_ok=True)
        await run_in_threadpool(image_service.save_upload, f.file, path, budget)
        items.append((str(path), name))
    return items


async def _run(request: Request, method: str, *args) -> Dict[str, Any]:
    try:
        return await run_pdf(f"image.{method}", *args, request=request)
    except PDFProcessingError:
        # The pool process died: almost always memory, on an image too big for this server.
        raise ImageProcessingError("That was too much for the server. Try a smaller image, or fewer at once.")


def _respond(result: Dict[str, Any], out_dir: Path, job_dir: Path, zip_stem: str, background_tasks: BackgroundTasks) -> FileResponse:
    files = result["files"]
    background_tasks.add_task(cleanup_folder, job_dir)
    headers = {"X-Image-Info": json_info(result)}
    if len(files) == 1:
        path = out_dir / files[0]["name"]
        return FileResponse(path, filename=path.name, media_type=MEDIA.get(path.suffix.lower(), "application/octet-stream"), headers=headers)
    archive = shutil.make_archive(str(job_dir / zip_stem), "zip", root_dir=out_dir)
    return FileResponse(archive, filename=f"{zip_stem}.zip", media_type="application/zip", headers=headers)


async def _batch(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile],
    tool: str,
    method: str,
    zip_stem: str,
    *args,
    limit: Optional[int] = None,
    extra: Optional[UploadFile] = None,
) -> FileResponse:
    job_dir = settings.TEMP_DIR / f"img_{tool}_{uuid.uuid4().hex}"
    out_dir = job_dir / "out"
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        items = await _save(files, tool, job_dir, limit)
        extra_path = None
        if extra is not None and extra.filename:
            image_service.validate_filename(extra.filename, "mark")
            extra_path = job_dir / f"mark{Path(extra.filename).suffix.lower()}"
            await run_in_threadpool(image_service.save_upload, extra.file, extra_path, [20 * 1024 * 1024])
        call_args = (items, str(out_dir), *args) + ((str(extra_path) if extra_path else None,) if tool == "watermark" else ())
        result = await _run(request, method, *call_args)
        return _respond(result, out_dir, job_dir, zip_stem, background_tasks)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        for f in files:
            if f is not None:
                await f.close()
        if extra is not None:
            await extra.close()


async def _single(
    request: Request, background_tasks: BackgroundTasks, file: UploadFile, tool: str, method: str, *args
) -> FileResponse:
    job_dir = settings.TEMP_DIR / f"img_{tool}_{uuid.uuid4().hex}"
    out_dir = job_dir / "out"
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        (path, name), = await _save([file], tool, job_dir, 1)
        result = await _run(request, method, path, name, str(out_dir), *args)
        return _respond(result, out_dir, job_dir, Path(name).stem, background_tasks)
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        await file.close()


# ---------------------------------------------------------------------------------------------


@router.get("/capabilities", response_model=Capabilities, summary="Which image formats and AI tools this server has")
async def capabilities():
    return await run_in_threadpool(image_service.capabilities)


@router.post("/compress", response_class=FileResponse, summary="Compress JPG, PNG, WebP, GIF and SVG images")
async def compress(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    level: str = Form("recommended", pattern="^(light|recommended|strong)$"),
    keep_metadata: bool = Form(False, description="Keep EXIF (camera, date, GPS). Off strips it."),
):
    return await _batch(request, background_tasks, files, "compress", "compress", "compressed", level, keep_metadata)


@router.post("/resize", response_class=FileResponse, summary="Resize images by pixels or percentage")
async def resize(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    mode: str = Form("pixels", pattern="^(pixels|percent)$"),
    width: Optional[int] = Form(None, ge=1, le=30000),
    height: Optional[int] = Form(None, ge=1, le=30000),
    percent: Optional[float] = Form(None, gt=0, le=1000),
    keep_ratio: bool = Form(True),
    no_enlarge: bool = Form(False),
):
    if mode == "pixels" and not (width or height):
        raise InvalidImageError("Give a width, a height, or both.")
    if mode == "percent" and not percent:
        raise InvalidImageError("Give a percentage.")
    return await _batch(request, background_tasks, files, "resize", "resize", "resized", mode, width, height, percent, keep_ratio, no_enlarge)


@router.post("/crop", response_class=FileResponse, summary="Crop one image to a rectangle (pixels, as seen)")
async def crop(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    x: int = Form(..., ge=0),
    y: int = Form(..., ge=0),
    width: int = Form(..., ge=1),
    height: int = Form(..., ge=1),
):
    return await _single(request, background_tasks, file, "crop", "crop", x, y, width, height)


@router.post("/convert", response_class=FileResponse, summary="Convert images (incl. HEIC, RAW, PSD, SVG, TIFF) to JPG, PNG, WebP or GIF")
async def convert(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    target: str = Form("jpg", pattern="^(jpg|png|webp|gif)$"),
    quality: str = Form("recommended", pattern="^(recommended|high)$"),
    background: str = Form("#ffffff", pattern=r"^#[0-9a-fA-F]{6}$", description="Fills transparency in JPG"),
):
    return await _batch(request, background_tasks, files, "convert", "convert", "converted", target, quality, background)


@router.post("/gif", response_class=FileResponse, summary="Several images → one animated GIF")
async def animated_gif(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    seconds: float = Form(0.5, ge=0.05, le=20),
    loop: bool = Form(True),
    fit: str = Form("contain", pattern="^(contain|cover)$"),
    background: str = Form("#ffffff", pattern=r"^#[0-9a-fA-F]{6}$"),
    name: str = Form("animation", max_length=80),
):
    return await _batch(request, background_tasks, files, "gif", "animated_gif", "animation", seconds, loop, fit, background, name)


@router.post("/rotate", response_class=FileResponse, summary="Rotate and flip images (pixel-exact)")
async def rotate(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    turns: str = Form(..., description='JSON list, one per file: {"angle": 0|90|180|270, "flip_h": bool, "flip_v": bool}'),
):
    raw = _json(turns, "turns")
    if not isinstance(raw, list) or len(raw) != len([f for f in files if f and f.filename]):
        raise InvalidImageError("Send one rotation per image.")
    clean = []
    for t in raw:
        if not isinstance(t, dict) or int(t.get("angle", 0)) % 90 != 0:
            raise InvalidImageError("Rotations are quarter turns: 0, 90, 180 or 270.")
        clean.append({"angle": int(t.get("angle", 0)) % 360, "flip_h": bool(t.get("flip_h")), "flip_v": bool(t.get("flip_v"))})
    return await _batch(request, background_tasks, files, "rotate", "rotate", "rotated", clean)


@router.post("/watermark", response_class=FileResponse, summary="Stamp text or an image over images")
async def watermark(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    options: str = Form(..., description="JSON WatermarkOptions"),
    mark: Optional[UploadFile] = File(None, description="The image to stamp (kind=image)"),
):
    try:
        opts = WatermarkOptions.model_validate(_json(options, "options")).model_dump()
    except ValidationError as exc:
        raise InvalidImageError(_message(exc))
    if opts["kind"] == "text" and not (opts.get("text") and opts["text"]["text"].strip()):
        raise InvalidImageError("Type the watermark text.")
    if opts["kind"] == "image" and not (mark and mark.filename):
        raise InvalidImageError("Add the image to stamp.")
    return await _batch(request, background_tasks, files, "watermark", "watermark", "watermarked", opts, extra=mark)


@router.post("/faces", response_model=FaceDetection, summary="Find faces (boxes as fractions of the image)")
async def faces(
    request: Request,
    file: UploadFile = File(...),
    sensitivity: str = Form("recommended", pattern="^(low|recommended|high)$"),
):
    job_dir = settings.TEMP_DIR / f"img_faces_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        (path, name), = await _save([file], "blur", job_dir, 1)
        return await _run(request, "detect_faces", path, name, sensitivity)
    finally:
        await file.close()
        cleanup_folder(job_dir)


@router.post("/blur", response_class=FileResponse, summary="Blur or pixelate areas (faces, plates, text)")
async def blur(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    areas: str = Form(..., description="JSON list of {x, y, w, h} in fractions of the image"),
    mode: str = Form("blur", pattern="^(blur|pixelate)$"),
    strength: int = Form(60, ge=1, le=100),
    shape: str = Form("ellipse", pattern="^(rect|ellipse)$"),
):
    raw = _json(areas, "areas")
    if not isinstance(raw, list) or not raw:
        raise InvalidImageError("Mark at least one area to blur.")
    if len(raw) > 500:
        raise InvalidImageError("Up to 500 areas, please.")
    try:
        clean = [Area.model_validate(a).model_dump() for a in raw]
    except ValidationError as exc:
        raise InvalidImageError(_message(exc))
    return await _single(request, background_tasks, file, "blur", "blur", clean, mode, strength, shape)


@router.post("/remove-background", response_class=FileResponse, summary="Cut out the subject (transparent, colour or blurred background)")
async def remove_background(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    background: str = Form("transparent", pattern="^(transparent|color|blur)$"),
    color: str = Form("#ffffff", pattern=r"^#[0-9a-fA-F]{6}$"),
):
    return await _batch(
        request, background_tasks, files, "background", "remove_background", "cutouts", background, color, limit=settings.BACKGROUND_MAX_FILES
    )


@router.post("/upscale", response_class=FileResponse, summary="Enlarge an image 2× or 4× with Real-ESRGAN")
async def upscale(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    factor: int = Form(2, ge=2, le=4),
):
    if factor not in (2, 4):
        raise InvalidImageError("Pick 2× or 4×.")
    return await _single(request, background_tasks, file, "upscale", "upscale", factor)


@router.post("/html", response_class=FileResponse, summary="Capture a web page (url), pasted HTML or an .html file as an image")
async def html_to_image(
    background_tasks: BackgroundTasks,
    url: Optional[str] = Form(None, max_length=2048),
    html: Optional[str] = Form(None, max_length=2_000_000),
    file: Optional[UploadFile] = File(None),
    screen: str = Form("desktop", pattern="^(mobile|tablet|laptop|desktop|hd)$"),
    full_page: bool = Form(True),
    block_ads: bool = Form(True),
    remove_popups: bool = Form(True),
    format: str = Form("jpg", pattern="^(jpg|png|webp)$"),
):
    from urllib.parse import urlparse

    from app.services.convert import convert_service
    from app.services.image_web import html_to_image as capture

    given = [bool(url and url.strip()), bool(html and html.strip()), bool(file and file.filename)]
    if sum(given) != 1:
        raise InvalidImageError("Send a web address, some HTML, or an .html file (one of them).")
    job_dir = settings.TEMP_DIR / f"img_html_{uuid.uuid4().hex}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        name = "page"
        if url and url.strip():
            try:
                url = await run_in_threadpool(convert_service.check_public_url, url)
            except Exception as exc:
                raise InvalidImageError(getattr(exc, "detail", "That address isn't allowed."))
            name = (urlparse(url).hostname or "page").removeprefix("www.")
        elif file is not None and file.filename:
            if Path(file.filename).suffix.lower() not in (".html", ".htm"):
                raise InvalidImageError("Upload an .html file.")
            target = job_dir / "page.html"
            await run_in_threadpool(image_service.save_upload, file.file, target, [settings.HTML_MAX_MB * 1024 * 1024])
            html = target.read_text(encoding="utf-8", errors="replace")
            name = Path(file.filename).stem or "page"
        out = job_dir / f"{name}.{format}"
        info = await run_in_threadpool(capture, out, url, html, screen, full_page, block_ads, remove_popups, format)
        background_tasks.add_task(cleanup_folder, job_dir)
        result = {"files": [{"name": out.name, "source": name, "before": None, "after": out.stat().st_size, **info}]}
        return FileResponse(out, filename=out.name, media_type=MEDIA[out.suffix], headers={"X-Image-Info": json_info(result)})
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()
