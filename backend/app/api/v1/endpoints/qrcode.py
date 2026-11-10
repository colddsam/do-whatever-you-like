import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.config.qrcode import settings
from app.core.utils import cleanup_folder
from app.exceptions.qrcode import InvalidQRCodeInputError
from app.schemas.qrcode import (
    ColorMaskStyle,
    ContentType,
    ErrorCorrectionLevel,
    EyeStyle,
    ModuleStyle,
    OutputFormat,
    QRCodeGenerateRequest,
)
from app.services.qrcode import qrcode_service

router = APIRouter(prefix="/qrcode", tags=["QRCode"])


@router.post(
    "/generate",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a customizable QR code from text, URL, Wi-Fi, vCard, Email, SMS, Phone, Geo, or Event",
)
async def generate_qrcode(
    request: QRCodeGenerateRequest,
    background_tasks: BackgroundTasks,
):
    qrcode_service.build_payload(request)
    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"qr_{request_id}"

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        output_path, media_type = await run_in_threadpool(
            qrcode_service.generate_qr_to_disk,
            request,
            job_dir,
        )

        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(
            path=output_path,
            filename=output_path.name,
            media_type=media_type,
        )
    except Exception:
        cleanup_folder(job_dir)
        raise


@router.post(
    "/generate-with-logo",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a customizable QR code with an optional center logo image upload",
)
async def generate_qrcode_with_logo(
    background_tasks: BackgroundTasks,
    content_type: ContentType = Form(default="text", description="Payload type: text, url, wifi, vcard, email, sms, phone, geo, event"),
    data: Optional[str] = Form(default=None, description="Raw text/URL/phone string, or JSON string for structured types (wifi/vcard/email/sms/geo/event)"),
    error_correction: ErrorCorrectionLevel = Form(default="H", description="Error correction level (promoted to H when logo is provided)"),
    box_size: int = Form(default=12, ge=4, le=40, description="Pixel size of each QR module (4-40)"),
    border: int = Form(default=4, ge=0, le=20, description="Border thickness in modules (0-20)"),
    module_style: ModuleStyle = Form(default="square", description="Module shape: square, gapped, circle, rounded, vertical_bars, horizontal_bars"),
    eye_style: EyeStyle = Form(default="square", description="Corner finder pattern shape: square, rounded, circle"),
    color_mask: ColorMaskStyle = Form(default="solid", description="Fill style: solid, radial_gradient, square_gradient, horizontal_gradient, vertical_gradient"),
    fill_color: str = Form(default="#000000", description="Foreground color (#RRGGBB or CSS color name)"),
    gradient_color: Optional[str] = Form(default=None, description="Secondary gradient color (#RRGGBB)"),
    back_color: str = Form(default="#FFFFFF", description="Background color (#RRGGBB, CSS name, or 'transparent')"),
    eye_color: Optional[str] = Form(default=None, description="Optional custom color (#RRGGBB) for the three corner eyes"),
    output_format: OutputFormat = Form(default="png", description="Output format: png, webp, jpeg, pdf, or svg (svg only without logo)"),
    logo_size_ratio: float = Form(default=0.22, ge=0.10, le=0.30, description="Logo size relative to QR code dimensions (0.10 to 0.30)"),
    logo_border: bool = Form(default=True, description="Draw a clean background pad around the center logo"),
    logo_corner_radius: int = Form(default=8, ge=0, le=60, description="Corner radius in pixels for the center logo"),
    logo: Optional[UploadFile] = File(default=None, description="Optional center logo image (.png, .jpg, .jpeg, .webp)"),
):
    structured_kwargs = {}
    raw_data = data
    if content_type in ("wifi", "vcard", "email", "sms", "geo", "event"):
        if not data:
            raise InvalidQRCodeInputError(
                f"Pass a JSON string in 'data' containing the '{content_type}' fields."
            )
        try:
            structured_kwargs[content_type] = json.loads(data)
            raw_data = None
        except json.JSONDecodeError:
            raise InvalidQRCodeInputError(f"Field 'data' must be valid JSON when content_type is '{content_type}'.")

    try:
        qr_req = QRCodeGenerateRequest(
            content_type=content_type,
            data=raw_data,
            error_correction=error_correction,
            box_size=box_size,
            border=border,
            module_style=module_style,
            eye_style=eye_style,
            color_mask=color_mask,
            fill_color=fill_color,
            gradient_color=gradient_color,
            back_color=back_color,
            eye_color=eye_color,
            output_format=output_format,
            **structured_kwargs,
        )
    except ValidationError as exc:
        first_err = exc.errors()[0] if exc.errors() else {"msg": "Invalid parameters"}
        loc = ".".join(str(p) for p in first_err.get("loc", []))
        raise InvalidQRCodeInputError(f"Invalid parameter '{loc}': {first_err.get('msg')}")

    qrcode_service.build_payload(qr_req)

    logo_ext: Optional[str] = None
    if logo is not None and logo.filename:
        logo_ext = qrcode_service.validate_logo_filename(logo.filename)

    request_id = uuid.uuid4().hex
    job_dir = settings.TEMP_DIR / f"qr_{request_id}"

    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        logo_path: Optional[Path] = None
        if logo is not None and logo_ext is not None:
            logo_path = job_dir / f"logo_{request_id}{logo_ext}"
            await run_in_threadpool(qrcode_service.save_upload_to_disk, logo.file, logo_path)

        output_path, media_type = await run_in_threadpool(
            qrcode_service.generate_qr_to_disk,
            qr_req,
            job_dir,
            logo_path,
            logo_size_ratio,
            logo_border,
            logo_corner_radius,
        )

        background_tasks.add_task(cleanup_folder, job_dir)
        return FileResponse(
            path=output_path,
            filename=output_path.name,
            media_type=media_type,
        )
    except Exception:
        cleanup_folder(job_dir)
        raise
    finally:
        if logo is not None:
            await logo.close()

