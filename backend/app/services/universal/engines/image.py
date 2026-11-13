"""
Pictures: any image the image tools can open (HEIC, RAW, PSD and SVG included) → JPG, PNG, WebP, GIF,
BMP, TIFF, ICO, AVIF or PDF. SVG → PDF stays vector. Text in a picture can be read out (OCR).
"""

import io
from pathlib import Path
from typing import List

from PIL import Image, ImageOps, ImageSequence

from app.exceptions.universal import InvalidUniversalInputError, UniversalConversionError, UniversalUnavailableError
from app.services.image import _animated, _flatten, _frames, open_image, sanitize_svg, save_animation, save_image
from app.services.universal.engines.common import Ctx, ensure, output, read_text

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def _open(src: Path, ctx: Ctx) -> Image.Image:
    # open_image picks its decoder from the extension; job files are named after their format id,
    # and every image id (jpg, heic, raw, svg…) is an extension it knows.
    return open_image(src, f"{ctx.stem}{src.suffix}")


def _pages(img: Image.Image) -> List[Image.Image]:
    """Every page of a multi-page TIFF (or frame of an animation), upright."""
    if getattr(img, "n_frames", 1) <= 1:
        return [img]
    return [ImageOps.exif_transpose(f.copy()) for f in ImageSequence.Iterator(img)]


def convert(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    img = _open(src, ctx)
    out = output(work, ctx, target)
    animated = _animated(img)
    try:
        if animated and target in ("gif", "webp"):
            frames, durations, loop = _frames(img)
            return ensure(save_animation(frames, durations, loop, out, target))
        if target == "pdf":
            pages = [_flatten(p.convert("RGBA")) for p in (_pages(img) if not animated else [img])]
            pages[0].save(out, "PDF", save_all=True, append_images=pages[1:], resolution=150)
            if len(pages) > 1:
                ctx.notes.append(f"All {len(pages)} pages are in the PDF.")
            return ensure(out)
        still = img
        if animated or getattr(img, "n_frames", 1) > 1:
            img.seek(0)
            still = img.copy()
            ctx.notes.append("Only the first frame was kept: this format holds a single picture.")
        if still.mode in ("I", "I;16", "F"):
            still = ImageOps.autocontrast(still.convert("L"))
        if target in ("jpg", "png", "webp", "gif"):
            save_image(still, out, target, quality=90, source=img)
        elif target == "bmp":
            _flatten(still).save(out, "BMP")
        elif target == "tiff":
            keep = still if still.mode in ("RGB", "RGBA", "L", "LA", "CMYK") else still.convert("RGBA")
            keep.save(out, "TIFF", compression="tiff_lzw")
        elif target == "avif":
            rgba = still.convert("RGBA") if still.mode not in ("RGB", "RGBA") else still
            rgba.save(out, "AVIF", quality=80)
        elif target == "ico":
            rgba = still.convert("RGBA")
            side = max(rgba.size)
            square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            square.alpha_composite(rgba, ((side - rgba.width) // 2, (side - rgba.height) // 2))
            sizes = [(s, s) for s in ICO_SIZES if s <= max(side, 16)]
            square.resize((256, 256) if side > 256 else (side, side), Image.Resampling.LANCZOS).save(out, "ICO", sizes=sizes)
            ctx.notes.append(f"Icon sizes inside: {', '.join(str(s[0]) for s in sizes)} px.")
        else:
            raise InvalidUniversalInputError(f"Pictures can't be saved as {target.upper()}.")
    except (InvalidUniversalInputError, UniversalConversionError):
        raise
    except Exception as exc:
        raise UniversalConversionError(f"The picture couldn't be saved as {target.upper()}.") from exc
    return ensure(out)


def svg_to_pdf(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """Vector stays vector. References to outside files are stripped first, as for every SVG we draw."""
    import pymupdf

    clean = work / "clean.svg"
    work.mkdir(parents=True, exist_ok=True)
    clean.write_text(sanitize_svg(read_text(src)), encoding="utf-8")
    out = output(work, ctx, "pdf")
    try:
        with pymupdf.open(str(clean)) as doc:
            out.write_bytes(doc.convert_to_pdf())
    except Exception as exc:
        raise InvalidUniversalInputError("That SVG couldn't be read. Is it a working SVG file?") from exc
    return ensure(out)


def ocr(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """Reads the words in a picture (Tesseract, through MuPDF), in English plus any installed script that's common."""
    import pymupdf

    from app.services.pdf_tools import pdf_tools_service

    folder = pdf_tools_service.tessdata_dir()
    if not folder:
        raise UniversalUnavailableError("Reading text from pictures isn't set up on this server yet.")
    img = _open(src, ctx)
    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    page = _flatten(img.copy().convert("RGBA"))
    # Tesseract reads best at text heights of 20–40 px; very large scans just take longer.
    if max(page.size) > 4000:
        page = ImageOps.contain(page, (4000, 4000), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    page.save(buf, "PNG")
    installed = set(pdf_tools_service.ocr_languages())
    langs = "+".join(l for l in ("eng", "hin", "ben") if l in installed) or next(iter(sorted(installed)), "eng")
    try:
        pix = pymupdf.Pixmap(buf.getvalue())
        with pymupdf.open("pdf", pix.pdfocr_tobytes(language=langs, tessdata=str(folder))) as doc:
            text = "\n".join(p.get_text("text", sort=True) for p in doc).strip()
    except Exception as exc:
        raise UniversalConversionError("The text in this picture couldn't be read.") from exc
    if not text:
        raise InvalidUniversalInputError("No text was found in this picture.")
    out = output(work, ctx, "txt")
    out.write_text(text + "\n", encoding="utf-8")
    ctx.notes.append("Text read by OCR: check names and numbers before relying on them.")
    return out
