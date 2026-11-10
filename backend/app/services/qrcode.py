import logging
from pathlib import Path
from typing import BinaryIO, Optional, Tuple
from urllib.parse import quote
import xml.etree.ElementTree as ET

import qrcode
import qrcode.constants
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.colormasks import (
    HorizontalGradiantColorMask,
    RadialGradiantColorMask,
    SolidFillColorMask,
    SquareGradiantColorMask,
    VerticalGradiantColorMask,
)
from qrcode.image.styles.moduledrawers.pil import (
    CircleModuleDrawer,
    GappedSquareModuleDrawer,
    HorizontalBarsDrawer,
    RoundedModuleDrawer,
    SquareModuleDrawer,
    VerticalBarsDrawer,
)
from qrcode.image.styles.moduledrawers.svg import (
    SvgPathCircleDrawer,
    SvgPathSquareDrawer,
)
import qrcode.image.svg
from PIL import Image, ImageColor, ImageDraw

from app.config.qrcode import settings
from app.exceptions.qrcode import InvalidQRCodeInputError, QRCodeGenerationError
from app.schemas.qrcode import QRCodeGenerateRequest

logger = logging.getLogger(__name__)


class QRCodeService:
    ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
    CHUNK_SIZE = 1024 * 64
    SVG_NS = "http://www.w3.org/2000/svg"

    ERROR_CORRECTION_MAP = {
        "L": qrcode.constants.ERROR_CORRECT_L,
        "M": qrcode.constants.ERROR_CORRECT_M,
        "Q": qrcode.constants.ERROR_CORRECT_Q,
        "H": qrcode.constants.ERROR_CORRECT_H,
    }

    MEDIA_TYPE_MAP = {
        "png": "image/png",
        "svg": "image/svg+xml",
        "webp": "image/webp",
        "jpeg": "image/jpeg",
        "pdf": "application/pdf",
    }

    @classmethod
    def validate_logo_filename(cls, filename: Optional[str]) -> str:
        if not filename:
            raise InvalidQRCodeInputError("Logo filename is missing.")
        ext = Path(filename).suffix.lower()
        if ext not in cls.ALLOWED_LOGO_EXTENSIONS:
            allowed = ", ".join(sorted(cls.ALLOWED_LOGO_EXTENSIONS))
            raise InvalidQRCodeInputError(
                f"Unsupported logo image format '{ext or 'unknown'}'. Allowed formats: {allowed}."
            )
        return ext

    @staticmethod
    def parse_rgb(color_str: str, field_name: str = "color") -> Tuple[int, int, int]:
        cleaned = (color_str or "").strip()
        if not cleaned:
            raise InvalidQRCodeInputError(f"Missing color value for '{field_name}'.")
        try:
            rgb = ImageColor.getrgb(cleaned)
            return (int(rgb[0]), int(rgb[1]), int(rgb[2]))
        except ValueError:
            raise InvalidQRCodeInputError(
                f"Invalid color '{color_str}' for '{field_name}'. Use hex (#RRGGBB) or a standard CSS color name."
            )

    @staticmethod
    def _escape_wifi(val: str) -> str:
        for ch in ("\\", ";", ",", ":", '"'):
            val = val.replace(ch, f"\\{ch}")
        return val

    @classmethod
    def build_payload(cls, req: QRCodeGenerateRequest) -> str:
        ct = req.content_type

        if ct in ("text", "url"):
            data = (req.data or "").strip()
            if not data:
                raise InvalidQRCodeInputError(f"Field 'data' is required when content_type is '{ct}'.")
            payload = data

        elif ct == "phone":
            phone = (req.data or "").strip()
            if not phone:
                raise InvalidQRCodeInputError("Field 'data' (phone number) is required when content_type is 'phone'.")
            payload = phone if phone.lower().startswith("tel:") else f"tel:{phone}"

        elif ct == "wifi":
            if not req.wifi:
                raise InvalidQRCodeInputError("Field 'wifi' object is required when content_type is 'wifi'.")
            ssid = cls._escape_wifi(req.wifi.ssid)
            pwd = cls._escape_wifi(req.wifi.password or "")
            hidden = "true" if req.wifi.hidden else "false"
            payload = f"WIFI:T:{req.wifi.encryption};S:{ssid};P:{pwd};H:{hidden};;"

        elif ct == "vcard":
            if not req.vcard:
                raise InvalidQRCodeInputError("Field 'vcard' object is required when content_type is 'vcard'.")
            v = req.vcard
            full_name = f"{v.first_name} {v.last_name or ''}".strip()
            lines = [
                "BEGIN:VCARD",
                "VERSION:3.0",
                f"N:{v.last_name or ''};{v.first_name};;;",
                f"FN:{full_name}",
            ]
            if v.organization:
                lines.append(f"ORG:{v.organization}")
            if v.title:
                lines.append(f"TITLE:{v.title}")
            if v.phone:
                lines.append(f"TEL;TYPE=CELL:{v.phone}")
            if v.email:
                lines.append(f"EMAIL:{v.email}")
            if v.website:
                lines.append(f"URL:{v.website}")
            if v.address:
                lines.append(f"ADR;TYPE=WORK:;;{v.address};;;;")
            lines.append("END:VCARD")
            payload = "\n".join(lines)

        elif ct == "email":
            if not req.email:
                raise InvalidQRCodeInputError("Field 'email' object is required when content_type is 'email'.")
            params = []
            if req.email.subject:
                params.append(f"subject={quote(req.email.subject)}")
            if req.email.body:
                params.append(f"body={quote(req.email.body)}")
            query_str = f"?{'&'.join(params)}" if params else ""
            payload = f"mailto:{req.email.email.strip()}{query_str}"

        elif ct == "sms":
            if not req.sms:
                raise InvalidQRCodeInputError("Field 'sms' object is required when content_type is 'sms'.")
            msg = req.sms.message or ""
            payload = f"SMSTO:{req.sms.phone.strip()}:{msg}"

        elif ct == "geo":
            if not req.geo:
                raise InvalidQRCodeInputError("Field 'geo' object is required when content_type is 'geo'.")
            base = f"geo:{req.geo.latitude},{req.geo.longitude}"
            payload = f"{base}?q={quote(req.geo.query)}" if req.geo.query else base

        elif ct == "event":
            if not req.event:
                raise InvalidQRCodeInputError("Field 'event' object is required when content_type is 'event'.")
            ev = req.event
            lines = [
                "BEGIN:VEVENT",
                f"SUMMARY:{ev.title}",
                f"DTSTART:{ev.start_time}",
                f"DTEND:{ev.end_time}",
            ]
            if ev.location:
                lines.append(f"LOCATION:{ev.location}")
            if ev.description:
                lines.append(f"DESCRIPTION:{ev.description}")
            lines.append("END:VEVENT")
            payload = "\n".join(lines)

        else:
            raise InvalidQRCodeInputError(f"Unsupported content_type '{ct}'.")

        if len(payload) > settings.MAX_DATA_LENGTH:
            raise InvalidQRCodeInputError(
                f"Encoded QR payload length ({len(payload)} chars) exceeds maximum allowed ({settings.MAX_DATA_LENGTH})."
            )
        return payload

    def save_upload_to_disk(self, file_obj: BinaryIO, destination: Path) -> Path:
        max_bytes = settings.MAX_LOGO_SIZE_MB * 1024 * 1024
        total_bytes = 0

        try:
            with open(destination, "wb") as buffer:
                while True:
                    chunk = file_obj.read(self.CHUNK_SIZE)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise InvalidQRCodeInputError(
                            f"Logo file exceeds maximum allowed size ({settings.MAX_LOGO_SIZE_MB} MB)."
                        )
                    buffer.write(chunk)
        except InvalidQRCodeInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save uploaded logo file: %s", exc)
            raise QRCodeGenerationError("Could not process the uploaded logo file.")

        if total_bytes == 0:
            raise InvalidQRCodeInputError("Uploaded logo file is empty.")

        return destination

    @staticmethod
    def _get_pil_module_drawer(style: str):
        drawers = {
            "square": SquareModuleDrawer,
            "gapped": GappedSquareModuleDrawer,
            "circle": CircleModuleDrawer,
            "rounded": RoundedModuleDrawer,
            "vertical_bars": VerticalBarsDrawer,
            "horizontal_bars": HorizontalBarsDrawer,
        }
        drawer_cls = drawers.get(style, SquareModuleDrawer)
        return drawer_cls()

    @staticmethod
    def _get_pil_eye_drawer(style: str):
        drawers = {
            "square": SquareModuleDrawer,
            "rounded": RoundedModuleDrawer,
            "circle": CircleModuleDrawer,
        }
        drawer_cls = drawers.get(style, SquareModuleDrawer)
        return drawer_cls()

    @classmethod
    def _get_color_mask(
        cls,
        mask_style: str,
        fill_rgb: Tuple[int, int, int],
        back_rgb: Tuple[int, int, int],
        grad_rgb: Tuple[int, int, int],
    ):
        # qrcode PIL color masks crash if back_color exactly equals fill_color
        safe_back = back_rgb
        if safe_back == fill_rgb or safe_back == grad_rgb:
            safe_back = (
                (back_rgb[0] + 1) % 256,
                back_rgb[1],
                back_rgb[2],
            )

        if mask_style == "radial_gradient":
            return RadialGradiantColorMask(
                back_color=safe_back, center_color=fill_rgb, edge_color=grad_rgb
            )
        if mask_style == "square_gradient":
            return SquareGradiantColorMask(
                back_color=safe_back, center_color=fill_rgb, edge_color=grad_rgb
            )
        if mask_style == "horizontal_gradient":
            return HorizontalGradiantColorMask(
                back_color=safe_back, left_color=fill_rgb, right_color=grad_rgb
            )
        if mask_style == "vertical_gradient":
            return VerticalGradiantColorMask(
                back_color=safe_back, top_color=fill_rgb, bottom_color=grad_rgb
            )
        return SolidFillColorMask(back_color=safe_back, front_color=fill_rgb)

    @staticmethod
    def _apply_custom_eye_color(
        img: Image.Image,
        modules_count: int,
        border: int,
        box_size: int,
        eye_rgb: Tuple[int, int, int],
        back_rgb: Tuple[int, int, int],
    ) -> Image.Image:
        """Recolors the three 7x7 finder patterns (eyes) while preserving anti-aliased edges."""
        rgba = img.convert("RGBA")
        pixels = rgba.load()
        if pixels is None:
            return rgba

        eye_boxes = [
            (border, border),
            (border + modules_count - 7, border),
            (border, border + modules_count - 7),
        ]

        for mod_x, mod_y in eye_boxes:
            x0 = mod_x * box_size
            y0 = mod_y * box_size
            x1 = min(rgba.width, (mod_x + 7) * box_size)
            y1 = min(rgba.height, (mod_y + 7) * box_size)
            for py in range(y0, y1):
                for px in range(x0, x1):
                    r, g, b, a = pixels[px, py]
                    if a > 0 and (r, g, b) != back_rgb:
                        # Blend proportionally based on distance from background color
                        dist = abs(r - back_rgb[0]) + abs(g - back_rgb[1]) + abs(b - back_rgb[2])
                        if dist > 45:
                            pixels[px, py] = (eye_rgb[0], eye_rgb[1], eye_rgb[2], a)
        return rgba

    @staticmethod
    def _make_background_transparent(
        img: Image.Image, back_rgb: Tuple[int, int, int]
    ) -> Image.Image:
        rgba = img.convert("RGBA")
        pixels = rgba.load()
        if pixels is None:
            return rgba
        for py in range(rgba.height):
            for px in range(rgba.width):
                r, g, b, a = pixels[px, py]
                if abs(r - back_rgb[0]) <= 6 and abs(g - back_rgb[1]) <= 6 and abs(b - back_rgb[2]) <= 6:
                    pixels[px, py] = (r, g, b, 0)
        return rgba

    @staticmethod
    def _overlay_logo(
        qr_img: Image.Image,
        logo_path: Path,
        logo_size_ratio: float,
        logo_border: bool,
        logo_corner_radius: int,
        back_rgb: Tuple[int, int, int],
        transparent_bg: bool,
    ) -> Image.Image:
        try:
            logo = Image.open(logo_path).convert("RGBA")
        except Exception as exc:
            logger.error("Invalid logo image uploaded: %s", exc)
            raise InvalidQRCodeInputError("Uploaded logo is not a valid image file.")

        base = qr_img.convert("RGBA")
        qr_w, qr_h = base.size
        target_max = max(16, int(min(qr_w, qr_h) * logo_size_ratio))
        logo.thumbnail((target_max, target_max), Image.Resampling.LANCZOS)
        lw, lh = logo.size

        if logo_corner_radius > 0:
            radius = min(logo_corner_radius, lw // 2, lh // 2)
            mask = Image.new("L", (lw, lh), 0)
            draw = ImageDraw.Draw(mask)
            draw.rounded_rectangle((0, 0, lw, lh), radius=radius, fill=255)
            alpha = logo.getchannel("A")
            combined_alpha = Image.frombytes(
                "L",
                (lw, lh),
                bytes(min(a, m) for a, m in zip(alpha.tobytes(), mask.tobytes())),
            )
            logo.putalpha(combined_alpha)

        pad = max(4, int(min(lw, lh) * 0.12)) if logo_border else 0
        box_w, box_h = lw + pad * 2, lh + pad * 2
        pos_x = (qr_w - box_w) // 2
        pos_y = (qr_h - box_h) // 2

        if logo_border:
            pad_layer = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
            pad_draw = ImageDraw.Draw(pad_layer)
            pad_color = (255, 255, 255, 255) if transparent_bg else (*back_rgb, 255)
            pad_radius = min(logo_corner_radius + pad, box_w // 2, box_h // 2) if logo_corner_radius > 0 else 6
            pad_draw.rounded_rectangle((0, 0, box_w - 1, box_h - 1), radius=pad_radius, fill=pad_color)
            base.alpha_composite(pad_layer, dest=(pos_x, pos_y))

        base.alpha_composite(logo, dest=(pos_x + pad, pos_y + pad))
        return base

    def generate_qr_to_disk(
        self,
        req: QRCodeGenerateRequest,
        target_dir: Path,
        logo_path: Optional[Path] = None,
        logo_size_ratio: float = 0.22,
        logo_border: bool = True,
        logo_corner_radius: int = 8,
    ) -> Tuple[Path, str]:
        payload = self.build_payload(req)
        output_format = req.output_format.lower()

        if logo_path is not None and output_format == "svg":
            raise InvalidQRCodeInputError(
                "Center logo overlay is supported for raster/document formats (png, webp, jpeg, pdf), not svg."
            )

        transparent_bg = req.back_color.strip().lower() == "transparent"
        if transparent_bg and output_format in ("jpeg", "pdf"):
            raise InvalidQRCodeInputError(
                f"Transparent background is not supported for '{output_format}' format. Use png, webp, or svg."
            )

        fill_rgb = self.parse_rgb(req.fill_color, "fill_color")
        back_rgb = (255, 255, 255) if transparent_bg else self.parse_rgb(req.back_color, "back_color")
        grad_rgb = (
            self.parse_rgb(req.gradient_color, "gradient_color")
            if req.gradient_color
            else fill_rgb
        )
        eye_rgb = self.parse_rgb(req.eye_color, "eye_color") if req.eye_color else None

        if not transparent_bg and fill_rgb == back_rgb and req.color_mask == "solid":
            raise InvalidQRCodeInputError(
                "Foreground 'fill_color' and background 'back_color' cannot be identical."
            )

        # Promote error correction to H when overlaying a center logo so QR stays scannable
        ec_key = "H" if logo_path is not None else req.error_correction
        error_correction = self.ERROR_CORRECTION_MAP.get(ec_key, qrcode.constants.ERROR_CORRECT_M)

        target_dir.mkdir(parents=True, exist_ok=True)
        output_path = target_dir / f"qrcode.{output_format}"

        try:
            qr = qrcode.QRCode(
                version=None,
                error_correction=error_correction,
                box_size=req.box_size,
                border=req.border,
            )
            qr.add_data(payload)
            qr.make(fit=True)

            if output_format == "svg":
                svg_drawer = (
                    SvgPathCircleDrawer()
                    if req.module_style in ("circle", "rounded")
                    else SvgPathSquareDrawer()
                )
                svg_img = qr.make_image(
                    image_factory=qrcode.image.svg.SvgPathImage,
                    module_drawer=svg_drawer,
                )
                svg_img.save(str(output_path))
                # Customize SVG fill and background colors
                # Write <svg> rather than <svg:svg> so the file opens cleanly everywhere.
                ET.register_namespace("", self.SVG_NS)
                tree = ET.parse(str(output_path))
                root = tree.getroot()
                # Elements without children are falsy, so `find() or find()` would skip a match.
                path_el = root.find(f".//{{{self.SVG_NS}}}path")
                if path_el is None:
                    path_el = root.find(".//path")
                if path_el is not None:
                    path_el.set("fill", req.fill_color.strip())
                if not transparent_bg:
                    bg_rect = ET.Element(
                        f"{{{self.SVG_NS}}}rect",
                        attrib={
                            "width": "100%",
                            "height": "100%",
                            "fill": req.back_color.strip(),
                        },
                    )
                    root.insert(0, bg_rect)
                tree.write(str(output_path), encoding="utf-8", xml_declaration=True)
                return output_path, self.MEDIA_TYPE_MAP["svg"]

            # Raster & PDF generation via StyledPilImage
            module_drawer = self._get_pil_module_drawer(req.module_style)
            eye_drawer = self._get_pil_eye_drawer(req.eye_style)
            color_mask = self._get_color_mask(req.color_mask, fill_rgb, back_rgb, grad_rgb)

            pil_wrapper = qr.make_image(
                image_factory=StyledPilImage,
                module_drawer=module_drawer,
                eye_drawer=eye_drawer,
                color_mask=color_mask,
            )
            img: Image.Image = pil_wrapper.get_image()

            if eye_rgb is not None:
                img = self._apply_custom_eye_color(
                    img,
                    modules_count=qr.modules_count,
                    border=req.border,
                    box_size=req.box_size,
                    eye_rgb=eye_rgb,
                    back_rgb=color_mask.back_color,
                )

            if transparent_bg:
                img = self._make_background_transparent(img, color_mask.back_color)

            if logo_path is not None:
                img = self._overlay_logo(
                    img,
                    logo_path=logo_path,
                    logo_size_ratio=logo_size_ratio,
                    logo_border=logo_border,
                    logo_corner_radius=logo_corner_radius,
                    back_rgb=back_rgb,
                    transparent_bg=transparent_bg,
                )

            if output_format == "png":
                img.save(str(output_path), format="PNG", optimize=True)
            elif output_format == "webp":
                img.save(str(output_path), format="WEBP", quality=95)
            elif output_format == "jpeg":
                rgb_img = img.convert("RGB")
                rgb_img.save(str(output_path), format="JPEG", quality=95)
            elif output_format == "pdf":
                rgb_img = img.convert("RGB")
                rgb_img.save(str(output_path), format="PDF", resolution=300.0)
            else:
                raise InvalidQRCodeInputError(f"Unsupported output format '{output_format}'.")

        except InvalidQRCodeInputError:
            raise
        except Exception as exc:
            logger.error("Unexpected error generating QR code: %s", exc)
            raise QRCodeGenerationError("Failed to generate the customized QR code.")

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise QRCodeGenerationError("Generated QR code file is empty or missing.")

        return output_path, self.MEDIA_TYPE_MAP[output_format]


qrcode_service = QRCodeService()
