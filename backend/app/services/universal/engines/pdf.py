"""PDF → Word (pdf2docx), Excel (table finder), text, and pages as pictures (PyMuPDF)."""

import io
from pathlib import Path

import pymupdf

from app.config.universal import settings
from app.exceptions.universal import InvalidUniversalInputError, UniversalConversionError
from app.services.convert import convert_service
from app.services.universal.engines.common import Ctx, bundle, ensure, output


def to_word(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    return ensure(convert_service.pdf_to_word(src, output(work, ctx, "docx")))


def to_excel(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    out = output(work, ctx, "xlsx")
    found = convert_service.pdf_to_excel(src, out, ctx.options.get("sheets", "tables"))
    if not found.get("tables"):
        ctx.notes.append("No ruled tables were found, so each page's text was split into columns.")
    return ensure(out)


def to_text(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    convert_service._check_pdf(src)
    out = output(work, ctx, "txt")
    with pymupdf.open(str(src)) as doc:
        pages = [page.get_text("text", sort=True).strip() for page in doc]
    if not any(pages):
        raise InvalidUniversalInputError("This PDF has no text to copy, only pictures of it. Run it through OCR PDF first.")
    out.write_text("\n\n\f".join(pages) + "\n", encoding="utf-8")
    return out


def to_images(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """
    One picture per page; several pages come as a ZIP. As JPG or PNG the person may pick the
    resolution and pages, or ask for the pictures inside the PDF instead (PDF to JPG's options).
    """
    count = convert_service._check_pdf(src)
    opts = ctx.options
    if target in ("jpg", "png") and (opts.get("images") == "extract" or opts.get("dpi") or opts.get("pages")):
        return _chosen_images(src, target, work, ctx, count)
    if count > settings.PDF_IMAGE_MAX_PAGES:
        raise InvalidUniversalInputError(f"Pages become pictures for PDFs of up to {settings.PDF_IMAGE_MAX_PAGES} pages.")
    pages_dir = work / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    width = len(str(count))
    files = []
    try:
        with pymupdf.open(str(src)) as doc:
            for page in doc:
                name = pages_dir / f"{ctx.stem}-{str(page.number + 1).zfill(width)}.{target}"
                if target == "svg":
                    name.write_text(page.get_svg_image(text_as_path=False), encoding="utf-8")
                else:
                    pix = page.get_pixmap(dpi=settings.PDF_IMAGE_DPI, alpha=False)
                    if target == "png":
                        pix.save(str(name))
                    else:
                        from PIL import Image

                        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
                        if target == "jpg":
                            img.save(name, "JPEG", quality=90, optimize=True, progressive=True)
                        else:
                            img.save(name, "WEBP", quality=88, method=4)
                files.append(name)
    except (InvalidUniversalInputError, UniversalConversionError):
        raise
    except Exception:
        raise UniversalConversionError("The pages couldn't be drawn. The PDF may be damaged.")
    if len(files) == 1:
        single = output(work, ctx, target)
        files[0].replace(single)
        return single
    ctx.notes.append(f"{len(files)} pages, one {target.upper()} each, in a ZIP.")
    return bundle(files, work / f"{ctx.stem}-{target}.zip")


def _chosen_images(src: Path, target: str, work: Path, ctx: Ctx, count: int) -> Path:
    from app.services.pdf_tools import pdf_tools_service

    opts = ctx.options
    mode = opts.get("images", "pages")
    pages = (opts.get("pages") or "").strip() or None
    if mode == "pages" and not pages and count > settings.PDF_IMAGE_MAX_PAGES:
        raise InvalidUniversalInputError(f"Pick up to {settings.PDF_IMAGE_MAX_PAGES} pages to turn into pictures.")
    files = pdf_tools_service.to_images(src, work / "pages", mode, target, int(opts.get("dpi") or settings.PDF_IMAGE_DPI), pages, f"{ctx.stem}.pdf")
    if len(files) > settings.PDF_IMAGE_MAX_PAGES * 5:
        raise InvalidUniversalInputError("That's too many pictures for one download. Pick fewer pages.")
    if len(files) == 1:
        single = output(work, ctx, files[0].suffix.lstrip(".") if mode == "extract" else target)
        files[0].replace(single)
        return single
    ctx.notes.append(
        f"{len(files)} pictures from inside the PDF, at their original quality, in a ZIP." if mode == "extract" else f"{len(files)} pages, one {target.upper()} each, in a ZIP."
    )
    return bundle(files, work / f"{ctx.stem}-{'images' if mode == 'extract' else target}.zip")


def html_to_pdf(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """Chromium prints the page; anything it loads from the web is checked against private addresses."""
    out = output(work, ctx, "pdf")
    convert_service.html_to_pdf(out, None, src, "a4", False, "small", True, True)
    return ensure(out)
