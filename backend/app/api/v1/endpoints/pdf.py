import asyncio
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, BackgroundTasks, File, Form, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.config.pdf import settings
from app.core.utils import cleanup_file, cleanup_folder
from app.exceptions.pdf import InvalidPDFInputError
from app.services.pdf import pdf_service
from app.services.pdf_pool import run_pdf

router = APIRouter(prefix="/pdf", tags=["PDF"])


async def _resolve_single(
    file: Optional[UploadFile], token: Optional[str], job_dir: Path, request_id: str
) -> Tuple[Path, str]:
    """The input PDF for split/compress, from an upload or a token, plus its display name."""
    if token:
        path, meta = await run_in_threadpool(pdf_service.resolve_token, token)
        return path, meta["filename"]
    if file is None or not file.filename:
        raise InvalidPDFInputError("Upload a PDF as `file`, or pass a `token` from /pdf/upload.")
    pdf_service.validate_filename(file.filename)
    input_path = job_dir / f"input_{request_id}.pdf"
    await run_in_threadpool(pdf_service.save_upload_to_disk, file.file, input_path)
    return input_path, Path(file.filename).name


def _resolve_tokens(tokens: List[str]) -> Tuple[List[Path], List[str]]:
    paths: List[Path] = []
    names: List[str] = []
    for token in tokens:
        path, meta = pdf_service.resolve_token(token)
        paths.append(path)
        names.append(meta["filename"])
    return paths, names


def _stem(name: str) -> str:
    return Path(name or "document").stem or "document"


@router.post(
    "/upload",
    status_code=status.HTTP_200_OK,
    summary="Upload a PDF once and get a token to reuse for estimates and actions",
)
async def upload_pdf(file: UploadFile = File(..., description="PDF file to keep for later requests")) -> Dict[str, Any]:
    pdf_service.validate_filename(file.filename)
    try:
        token = await run_in_threadpool(pdf_service.cache_save, file.file)
    finally:
        await file.close()
    try:
        return await run_in_threadpool(pdf_service.cache_register, token, file.filename or "document.pdf")
    except Exception:
        pdf_service.discard_cached(token)
        raise


@router.post(
    "/merge",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Merge multiple PDFs (uploaded files or tokens) into a single PDF",
)
async def merge_pdfs(
    request: Request,
    background_tasks: BackgroundTasks,
    files: Optional[List[UploadFile]] = File(default=None, description="Two or more PDF files to merge in order"),
    tokens: Optional[List[str]] = Form(default=None, description="Or: two or more tokens from /pdf/upload, in order"),
):
    files = files or []
    tokens = [t for t in (tokens or []) if t]
    if len(files) + len(tokens) < 2:
        raise InvalidPDFInputError("Please upload at least 2 PDF files to merge.")
    if files and tokens:
        raise InvalidPDFInputError("Send either files or tokens, not both.")

    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"pdf_merge_{request_id}"

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        if tokens:
            saved_paths, display_names = await run_in_threadpool(_resolve_tokens, tokens)
        else:
            saved_paths = []
            for idx, upload in enumerate(files, start=1):
                pdf_service.validate_filename(upload.filename)
                input_path = job_dir / f"input_{idx}_{request_id}.pdf"
                await run_in_threadpool(pdf_service.save_upload_to_disk, upload.file, input_path)
                saved_paths.append(input_path)
            display_names = [Path(u.filename or f"file {i}").name for i, u in enumerate(files, start=1)]

        output_path = job_dir / f"{_stem(display_names[0])}_merged.pdf"
        await run_pdf("merge_pdfs", saved_paths, output_path, display_names, request=request)

        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(path=output_path, filename=output_path.name, media_type="application/pdf")
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        for upload in files:
            await upload.close()


@router.post(
    "/merge/estimate",
    status_code=status.HTTP_200_OK,
    summary="Size of the merged PDF for these uploaded tokens, without returning it",
)
async def estimate_merge(
    request: Request,
    tokens: List[str] = Form(..., description="Two or more tokens from /pdf/upload, in order"),
) -> Dict[str, Any]:
    tokens = [t for t in tokens if t]
    if len(tokens) < 2:
        raise InvalidPDFInputError("Please upload at least 2 PDF files to merge.")
    paths, names = await run_in_threadpool(_resolve_tokens, tokens)
    work_dir = settings.TEMP_DIR / f"pdf_estimate_{uuid.uuid4().hex}"
    size = await run_pdf("estimate_merge", paths, names, work_dir, request=request)
    return {"output": "pdf", "total_size": size}


@router.post(
    "/split",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Split a PDF by page ranges (e.g. '1-3, 5') or into individual pages",
)
async def split_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None, description="PDF file to split"),
    token: Optional[str] = Form(default=None, description="Or: a token from /pdf/upload"),
    page_ranges: Optional[str] = Form(
        default=None,
        description="Optional comma-separated parts; '+' joins ranges into one part (e.g. '1-3, 5' or "
        "'1-3+5, 4'). Leave empty to split all pages into a ZIP.",
    ),
):
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"pdf_split_{request_id}"
    zip_path: Path | None = None

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        input_path, display_name = await _resolve_single(file, token, job_dir, request_id)
        original_stem = _stem(display_name)
        output_dir = job_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        split_files = await run_pdf("split_pdf", input_path, output_dir, page_ranges, display_name, request=request)

        if len(split_files) == 1:
            target_file = split_files[0]
            background_tasks.add_task(cleanup_folder, job_dir)
            return FileResponse(
                path=target_file,
                filename=f"{original_stem}_{target_file.name}",
                media_type="application/pdf",
            )

        zip_base = settings.TEMP_DIR / f"pdf_split_{request_id}_archive"
        zip_path = Path(shutil.make_archive(str(zip_base), "zip", output_dir))

        def full_cleanup() -> None:
            cleanup_folder(job_dir)
            if zip_path is not None:
                cleanup_file(zip_path)

        background_tasks.add_task(full_cleanup)
        return FileResponse(path=zip_path, filename=f"{original_stem}_split.zip", media_type="application/zip")
    except Exception:
        cleanup_folder(job_dir)
        if zip_path is not None:
            cleanup_file(zip_path)
        raise
    finally:
        if file is not None:
            await file.close()


@router.post(
    "/split/estimate",
    status_code=status.HTTP_200_OK,
    summary="The parts (pages and sizes) a split would produce, without returning them",
)
async def estimate_split(
    request: Request,
    token: str = Form(..., description="A token from /pdf/upload"),
    page_ranges: Optional[str] = Form(default=None, description="Same as /pdf/split"),
) -> Dict[str, Any]:
    path, meta = await run_in_threadpool(pdf_service.resolve_token, token)
    work_dir = settings.TEMP_DIR / f"pdf_estimate_{uuid.uuid4().hex}"
    return await run_pdf("estimate_split", path, page_ranges, meta["filename"], work_dir, request=request)


@router.post(
    "/organize",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Reorder, rotate and remove pages (e.g. '3, 1:90, 2')",
)
async def organize_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None, description="PDF file to rearrange"),
    token: Optional[str] = Form(default=None, description="Or: a token from /pdf/upload"),
    page_order: str = Form(
        ...,
        max_length=60_000,
        description="Pages in their new order, comma-separated; ':90', ':180' or ':270' turns one "
        "clockwise. Pages left out are removed. Example: '3, 1:90, 2'.",
    ),
):
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"pdf_organize_{request_id}"

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        input_path, display_name = await _resolve_single(file, token, job_dir, request_id)
        output_path = job_dir / f"{_stem(display_name)}_organized.pdf"
        await run_pdf("organize_pdf", input_path, output_path, page_order, display_name, request=request)

        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(path=output_path, filename=output_path.name, media_type="application/pdf")
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()


@router.post(
    "/organize/estimate",
    status_code=status.HTTP_200_OK,
    summary="Size of the rearranged PDF, without returning it",
)
async def estimate_organize(
    request: Request,
    token: str = Form(..., description="A token from /pdf/upload"),
    page_order: str = Form(..., max_length=60_000, description="Same as /pdf/organize"),
) -> Dict[str, Any]:
    path, meta = await run_in_threadpool(pdf_service.resolve_token, token)
    work_dir = settings.TEMP_DIR / f"pdf_estimate_{uuid.uuid4().hex}"
    size = await run_pdf("estimate_organize", path, page_order, meta["filename"], work_dir, request=request)
    return {"output": "pdf", "total_size": size}


@router.get(
    "/thumbnail",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="One page of an uploaded PDF as a PNG thumbnail",
)
async def page_thumbnail(
    request: Request,
    token: str = Query(..., description="A token from /pdf/upload"),
    page: int = Query(..., ge=1, description="1-based page number"),
    width: int = Query(default=160, ge=1, le=2000, description="Width in pixels (snapped to 64-480)"),
):
    path, _ = await run_in_threadpool(pdf_service.resolve_token, token)
    width = pdf_service.clamp_thumbnail_width(width)
    thumb = pdf_service.thumbnail_path(token, page, width)
    if not await run_in_threadpool(thumb.is_file):
        await run_pdf("render_thumbnail", path, page, width, thumb, request=request)
    # Rendered once per (token, page, width) and kept beside the upload; the Next proxy decides
    # how long the browser may cache it (the API itself always answers no-store).
    return FileResponse(path=thumb, media_type="image/png")


@router.post(
    "/compress",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Compress a PDF by a target percentage (1-95)",
)
async def compress_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None, description="PDF file to compress"),
    token: Optional[str] = Form(default=None, description="Or: a token from /pdf/upload"),
    compression_percentage: int = Form(
        default=50,
        ge=1,
        le=95,
        description="Compression strength percentage from 1 (light) to 95 (maximum)",
    ),
):
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"pdf_compress_{request_id}"

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        input_path, display_name = await _resolve_single(file, token, job_dir, request_id)
        output_path = job_dir / f"{_stem(display_name)}_compressed.pdf"

        await run_pdf(
            "compress_pdf", input_path, output_path, compression_percentage, display_name, request=request
        )

        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(path=output_path, filename=output_path.name, media_type="application/pdf")
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if file is not None:
            await file.close()


@router.post(
    "/compress/estimate",
    status_code=status.HTTP_200_OK,
    summary="Compressed size at several strengths, so a UI can predict any strength",
)
async def estimate_compression(
    request: Request,
    token: str = Form(..., description="A token from /pdf/upload"),
    percentages: Optional[List[int]] = Form(
        default=None, description="Strengths to measure (1-95, up to 10). Defaults to a spread for interpolation."
    ),
) -> Dict[str, Any]:
    strengths = sorted(set(percentages or pdf_service.ESTIMATE_STRENGTHS))
    if len(strengths) > pdf_service.ESTIMATE_MAX_STRENGTHS or any(not (1 <= p <= 95) for p in strengths):
        raise InvalidPDFInputError(
            f"Pass up to {pdf_service.ESTIMATE_MAX_STRENGTHS} strengths, each between 1 and 95."
        )
    path, meta = await run_in_threadpool(pdf_service.resolve_token, token)
    name = meta["filename"]
    work_dir = settings.TEMP_DIR / f"pdf_estimate_{uuid.uuid4().hex}"
    try:
        plan = await run_pdf("prepare_compression_sample", path, name, work_dir, request=request)
        if plan["strength_independent"]:
            size = await run_pdf("compressed_size", plan, strengths[0], name, work_dir, request=request)
            sizes = [size] * len(strengths)
        else:
            sizes = await asyncio.gather(
                *(run_pdf("compressed_size", plan, p, name, work_dir, request=request) for p in strengths)
            )
    finally:
        await run_in_threadpool(cleanup_folder, work_dir)

    original = plan["original_size"]
    samples = [{"percentage": p, "size": size} for p, size in zip(strengths, sizes)]
    return {"original_size": original, "exact": plan["exact"], "samples": samples}
