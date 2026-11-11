"""
PDF tools beyond merge/split/organize/compress: page numbers, watermark, crop, edit & sign,
redact, protect, unlock, repair, OCR, PDF <-> images, PDF/A and compare.

Everything PyMuPDF-heavy here runs in the PDF process pool (`run_pdf("tools.<method>", ...)`).
Ghostscript (PDF/A) is a subprocess and runs in a thread.

Positions from the browser are fractions of the page *as seen* (rotation applied). Anything drawn
on a page is first drawn on a plain "stamp" page in those coordinates and then placed with
`show_pdf_page(..., rotate=page.rotation)`, which keeps it upright on rotated pages.
"""

import difflib
import io
import logging
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pymupdf
from PIL import Image, ImageFilter, ImageOps

from app.config.pdf import settings
from app.exceptions.pdf import InvalidPDFInputError, PDFProcessingError
from app.schemas.pdf_tools import Box, EditOp, RedactArea, RedactSearch
from app.services.pdf import PDFService

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
PAGE_SIZES = {"a4": (595.28, 841.89), "letter": (612, 792), "legal": (612, 1008), "a3": (841.89, 1190.55)}
MARGINS = {"none": 0, "small": 20, "large": 40}
FONTS = {"sans": "helv", "serif": "tiro", "mono": "cour"}
CSS_FONTS = {"sans": "sans-serif", "serif": "serif", "mono": "monospace"}

REDACT_PRESETS = {
    "email": r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+",
    "phone": r"(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?(?!\w)",
    "card": r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)",
    "date": r"\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b",
    "url": r"\bhttps?://[^\s)]+|\bwww\.[^\s)]+",
    "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    "iban": r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b",
}


def _rgb(hex_color: str) -> Tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _find_tool(configured: Optional[Path], names: Sequence[str], globs: Sequence[str]) -> Optional[Path]:
    if configured and Path(configured).is_file():
        return Path(configured)
    for name in names:
        found = shutil.which(name)
        if found:
            return Path(found)
    for pattern in globs:
        root, _, rest = pattern.partition("*")
        base = Path(root)
        if base.exists():
            hits = sorted(base.glob("*" + rest), reverse=True)  # Newest version first.
            if hits:
                return hits[0]
    return None


class PDFToolsService:
    open_pdf = staticmethod(PDFService._open_valid_pdf)

    # ---------- shared helpers ----------

    @staticmethod
    def page_selection(doc: pymupdf.Document, pages: Optional[str]) -> List[int]:
        """'' or None → every page; otherwise the same syntax as split ('1-3, 7'). 0-based, sorted."""
        if not pages or not pages.strip():
            return list(range(doc.page_count))
        groups = PDFService.parse_page_groups(pages.replace("+", ","), doc.page_count)
        return sorted({p for g in groups for p in g})

    @staticmethod
    def _stamp_page(page: pymupdf.Page) -> Tuple[pymupdf.Document, pymupdf.Page]:
        stamp = pymupdf.open()
        return stamp, stamp.new_page(width=page.rect.width, height=page.rect.height)

    @staticmethod
    def _apply_stamp(page: pymupdf.Page, stamp: pymupdf.Document, overlay: bool = True) -> None:
        page.show_pdf_page(
            page.rect * page.derotation_matrix, stamp, 0, overlay=overlay, rotate=page.rotation, keep_proportion=False
        )

    @staticmethod
    def _box_rect(page_rect: pymupdf.Rect, box: Box) -> pymupdf.Rect:
        w, h = page_rect.width, page_rect.height
        return pymupdf.Rect(box.x0 * w, box.y0 * h, box.x1 * w, box.y1 * h)

    @staticmethod
    def _to_unrotated(page: pymupdf.Page, rect: pymupdf.Rect) -> pymupdf.Rect:
        return (rect * page.derotation_matrix).normalize()

    @staticmethod
    def _to_visible_box(page: pymupdf.Page, rect: pymupdf.Rect) -> Dict[str, float]:
        r = (pymupdf.Rect(rect) * page.rotation_matrix).normalize()
        w, h = page.rect.width, page.rect.height
        return {
            "x0": round(max(0.0, r.x0 / w), 5),
            "y0": round(max(0.0, r.y0 / h), 5),
            "x1": round(min(1.0, r.x1 / w), 5),
            "y1": round(min(1.0, r.y1 / h), 5),
        }

    @staticmethod
    def _save(doc: pymupdf.Document, out: Path, **kw: Any) -> Path:
        out.parent.mkdir(parents=True, exist_ok=True)
        doc.save(str(out), garbage=3, deflate=True, **kw)
        if not out.is_file() or out.stat().st_size == 0:
            raise PDFProcessingError("The PDF could not be written.")
        return out

    def _guard(self, what: str, fn, *args: Any) -> Any:
        """Runs one operation, keeping clean errors and turning anything else into a 422."""
        try:
            return fn(*args)
        except (InvalidPDFInputError, PDFProcessingError):
            raise
        except Exception as exc:
            logger.error("PDF tool '%s' failed: %s", what, exc)
            raise PDFProcessingError(f"Couldn't {what} this PDF.")

    # ---------- page numbers ----------

    def page_numbers(
        self,
        pdf_path: Path,
        out: Path,
        position: str,
        style: str,
        start: int,
        pages: Optional[str],
        font_size: float,
        margin: str,
        color: str,
        display_name: str,
    ) -> Path:
        styles = {"n": "{n}", "n_of": "{n} / {total}", "page_n": "Page {n}", "page_n_of": "Page {n} of {total}"}
        if style not in styles or position not in {"tl", "tc", "tr", "bl", "bc", "br"}:
            raise InvalidPDFInputError("Pick a position and a style for the numbers.")
        if margin not in MARGINS or margin == "none":
            margin = "small"

        def run() -> Path:
            doc = self.open_pdf(pdf_path, display_name)
            try:
                chosen = self.page_selection(doc, pages)
                total = len(chosen) + start - 1
                gap = {"small": 24, "large": 48}[margin]
                for i, pno in enumerate(chosen):
                    page = doc[pno]
                    label = styles[style].format(n=start + i, total=total)
                    stamp, sp = self._stamp_page(page)
                    tw = pymupdf.get_text_length(label, fontname="helv", fontsize=font_size)
                    w, h = sp.rect.width, sp.rect.height
                    x = {"l": gap, "c": (w - tw) / 2, "r": w - gap - tw}[position[1]]
                    y = gap + font_size if position[0] == "t" else h - gap
                    sp.insert_text((x, y), label, fontsize=font_size, fontname="helv", color=_rgb(color))
                    self._apply_stamp(page, stamp)
                    stamp.close()
                return self._save(doc, out)
            finally:
                doc.close()

        return self._guard("number the pages of", run)

    # ---------- watermark ----------

    def watermark(
        self,
        pdf_path: Path,
        out: Path,
        mode: str,
        text: str,
        font: str,
        font_size: float,
        bold: bool,
        color: str,
        opacity: float,
        rotation: int,
        position: str,
        layer: str,
        pages: Optional[str],
        image_path: Optional[Path],
        image_scale: float,
        display_name: str,
    ) -> Path:
        if mode == "text" and not text.strip():
            raise InvalidPDFInputError("Type the watermark text.")
        if mode == "image" and not image_path:
            raise InvalidPDFInputError("Add the image to use as a watermark.")
        valid_positions = {"tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br", "tile"}
        if position not in valid_positions:
            raise InvalidPDFInputError("Pick where the watermark goes.")

        image_bytes = None
        image_size = (1, 1)
        if mode == "image":
            image_bytes, image_size = self._watermark_image(image_path, opacity)

        fontname = FONTS.get(font, "helv")
        if bold:
            fontname = {"helv": "hebo", "tiro": "tibo", "cour": "cobo"}[fontname]

        def place(sp: pymupdf.Page, cx: float, cy: float) -> None:
            pivot = pymupdf.Point(cx, cy)
            if mode == "text":
                tw = pymupdf.get_text_length(text, fontname=fontname, fontsize=font_size)
                sp.insert_text(
                    (cx - tw / 2, cy + font_size * 0.35),
                    text,
                    fontsize=font_size,
                    fontname=fontname,
                    color=_rgb(color),
                    fill_opacity=opacity,
                    # In PyMuPDF's top-down page space a positive matrix angle turns clockwise, so
                    # positive `rotation` (counter-clockwise, rising left to right) is passed as is.
                    morph=(pivot, pymupdf.Matrix(rotation)),
                )
            else:
                base = min(sp.rect.width, sp.rect.height) * image_scale
                ratio = image_size[1] / image_size[0]
                iw, ih = (base, base * ratio) if ratio <= 1 else (base / ratio, base)
                sp.insert_image(
                    pymupdf.Rect(cx - iw / 2, cy - ih / 2, cx + iw / 2, cy + ih / 2),
                    stream=image_bytes,
                    rotate=(-rotation) % 360 if rotation % 90 == 0 else 0,
                )

        def run() -> Path:
            doc = self.open_pdf(pdf_path, display_name)
            try:
                for pno in self.page_selection(doc, pages):
                    page = doc[pno]
                    stamp, sp = self._stamp_page(page)
                    w, h = sp.rect.width, sp.rect.height
                    if position == "tile":
                        step_x, step_y = max(w / 3, 120), max(h / 4, 120)
                        y = step_y / 2
                        row = 0
                        while y < h + step_y:
                            x = step_x / 2 + (step_x / 2 if row % 2 else 0)
                            while x < w + step_x:
                                place(sp, x - step_x / 2, y)
                                x += step_x
                            y += step_y
                            row += 1
                    else:
                        pad = min(w, h) * 0.12
                        cx = {"l": pad + w * 0.12, "c": w / 2, "r": w - pad - w * 0.12}[position[1]]
                        cy = {"t": pad + h * 0.06, "m": h / 2, "b": h - pad - h * 0.06}[position[0]]
                        place(sp, cx, cy)
                    self._apply_stamp(page, stamp, overlay=layer != "under")
                    stamp.close()
                return self._save(doc, out)
            finally:
                doc.close()

        return self._guard("watermark", run)

    @staticmethod
    def _watermark_image(path: Path, opacity: float) -> Tuple[bytes, Tuple[int, int]]:
        try:
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im).convert("RGBA")
                im.thumbnail((1600, 1600))
                if opacity < 1:
                    alpha = im.getchannel("A").point(lambda a: int(a * opacity))
                    im.putalpha(alpha)
                buf = io.BytesIO()
                im.save(buf, format="PNG", optimize=True)
                return buf.getvalue(), im.size
        except Exception as exc:
            logger.error("Watermark image unreadable: %s", exc)
            raise InvalidPDFInputError("That watermark image couldn't be read. Try a PNG or JPG.")

    # ---------- crop ----------

    def crop(self, pdf_path: Path, out: Path, box: Box, pages: Optional[str], display_name: str) -> Path:
        def run() -> Path:
            doc = self.open_pdf(pdf_path, display_name)
            try:
                for pno in self.page_selection(doc, pages):
                    page = doc[pno]
                    visible = self._box_rect(page.rect, box)
                    target = self._to_unrotated(page, visible)
                    # set_cropbox wants the box in unrotated page space, inside the mediabox.
                    target = (target + (page.cropbox.x0, page.cropbox.y0, page.cropbox.x0, page.cropbox.y0)) & page.mediabox
                    if target.is_empty or target.width < 10 or target.height < 10:
                        raise InvalidPDFInputError("That crop is too small. Leave at least a little of the page.")
                    page.set_cropbox(target)
                return self._save(doc, out)
            finally:
                doc.close()

        return self._guard("crop", run)

    # ---------- edit & sign ----------

    def edit(self, pdf_path: Path, out: Path, ops: List[Dict[str, Any]], images: List[Path], display_name: str) -> Path:
        parsed = [EditOp.model_validate(o) for o in ops]
        if not parsed:
            raise InvalidPDFInputError("Add something to the pages first.")
        if len(parsed) > settings.EDIT_MAX_OPS:
            raise InvalidPDFInputError(f"That's more than {settings.EDIT_MAX_OPS} changes in one go.")
        image_bytes: Dict[int, bytes] = {}
        for op in parsed:
            if op.type == "image" and op.image not in image_bytes:
                if op.image is None or op.image >= len(images):
                    raise InvalidPDFInputError("An image on the page is missing its file.")
                image_bytes[op.image] = self._image_for_pdf(images[op.image])

        def run() -> Path:
            doc = self.open_pdf(pdf_path, display_name)
            try:
                by_page: Dict[int, List[EditOp]] = {}
                for op in parsed:
                    if op.page > doc.page_count:
                        raise InvalidPDFInputError(f"Page {op.page} doesn't exist in this PDF.")
                    by_page.setdefault(op.page - 1, []).append(op)
                for pno, page_ops in by_page.items():
                    page = doc[pno]
                    stamp, sp = self._stamp_page(page)
                    for op in page_ops:
                        self._draw(sp, op, image_bytes)
                    self._apply_stamp(page, stamp)
                    stamp.close()
                return self._save(doc, out)
            finally:
                doc.close()

        return self._guard("edit", run)

    def _draw(self, sp: pymupdf.Page, op: EditOp, image_bytes: Dict[int, bytes]) -> None:
        w, h = sp.rect.width, sp.rect.height
        rect = self._box_rect(sp.rect, op.box) if op.box else None
        color = _rgb(op.color)
        fill = _rgb(op.fill) if op.fill else None
        if op.type == "text":
            css = (
                f"* {{font-family: {CSS_FONTS[op.font]}; font-size: {op.size}px; color: {op.color};"
                f" font-weight: {'bold' if op.bold else 'normal'}; font-style: {'italic' if op.italic else 'normal'};"
                f" text-align: {op.align}; line-height: 1.2; margin: 0; }}"
            )
            html = "<br>".join(_escape(line) for line in op.text.split("\n"))
            # A box drawn a little tight still shows all its text: allow shrinking to 50%.
            sp.insert_htmlbox(rect, f"<p>{html}</p>", css=css, scale_low=0.5, opacity=op.opacity)
        elif op.type == "image":
            sp.insert_image(rect, stream=image_bytes[op.image], keep_proportion=True)
        elif op.type in ("rect", "whiteout", "highlight"):
            if op.type == "whiteout":
                sp.draw_rect(rect, color=None, fill=(1, 1, 1), width=0)
            elif op.type == "highlight":
                sp.draw_rect(rect, color=None, fill=fill or (1, 0.89, 0.2), fill_opacity=min(op.opacity, 0.5), width=0)
            else:
                sp.draw_rect(
                    rect,
                    color=color if op.width > 0 else None,
                    fill=fill,
                    width=op.width,
                    stroke_opacity=op.opacity,
                    fill_opacity=op.opacity,
                )
        elif op.type == "ellipse":
            sp.draw_oval(
                rect, color=color if op.width > 0 else None, fill=fill, width=op.width, stroke_opacity=op.opacity, fill_opacity=op.opacity
            )
        elif op.type == "line":
            x0, y0, x1, y1 = op.line or [0, 0, 0, 0]
            sp.draw_line((x0 * w, y0 * h), (x1 * w, y1 * h), color=color, width=max(op.width, 0.5), stroke_opacity=op.opacity)
        elif op.type == "ink":
            pts = [pymupdf.Point(x * w, y * h) for x, y in op.points or []]
            sp.draw_polyline(pts, color=color, width=max(op.width, 0.5), stroke_opacity=op.opacity, lineCap=1, lineJoin=1)

    @staticmethod
    def _image_for_pdf(path: Path) -> bytes:
        """PNG for anything with transparency (signatures), JPEG otherwise; at most 2400px."""
        try:
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im)
                im.thumbnail((2400, 2400))
                buf = io.BytesIO()
                if im.mode in ("RGBA", "LA", "P"):
                    im.convert("RGBA").save(buf, format="PNG", optimize=True)
                else:
                    im.convert("RGB").save(buf, format="JPEG", quality=90)
                return buf.getvalue()
        except Exception as exc:
            logger.error("Edit image unreadable: %s", exc)
            raise InvalidPDFInputError("One of the images couldn't be read. Try PNG or JPG.")

    # ---------- redact ----------

    def redact_find(self, pdf_path: Path, search: Dict[str, Any], display_name: str) -> Dict[str, Any]:
        query = RedactSearch.model_validate(search)
        if not query.terms and not query.presets:
            raise InvalidPDFInputError("Type a word to find, or pick a kind of detail.")

        def run() -> Dict[str, Any]:
            doc = self.open_pdf(pdf_path, display_name)
            matches: List[Dict[str, Any]] = []
            try:
                for page in doc:
                    found = self._page_matches(page, query)
                    for text, rect in found:
                        matches.append({"page": page.number + 1, "text": text, "box": self._to_visible_box(page, rect)})
                        if len(matches) >= 2000:
                            return {"matches": matches, "truncated": True}
                return {"matches": matches, "truncated": False}
            finally:
                doc.close()

        return self._guard("search", run)

    def _page_matches(self, page: pymupdf.Page, query: RedactSearch) -> List[Tuple[str, pymupdf.Rect]]:
        words = page.get_text("words")  # x0, y0, x1, y1, word, block, line, word_no
        hits: List[Tuple[str, pymupdf.Rect]] = []
        patterns: List[Tuple[str, re.Pattern]] = []
        for term in query.terms:
            body = re.escape(term.text.strip())
            if term.whole_word:
                body = rf"(?<!\w){body}(?!\w)"
            patterns.append((term.text, re.compile(body, 0 if term.case_sensitive else re.IGNORECASE)))
        for preset in query.presets:
            patterns.append((preset, re.compile(REDACT_PRESETS[preset])))
        if not patterns:
            return hits

        # Search line by line over the words, so matches can span words ("John Smith", "+1 555 0100").
        lines: Dict[Tuple[int, int], List[Any]] = {}
        for wd in words:
            lines.setdefault((wd[5], wd[6]), []).append(wd)
        for line_words in lines.values():
            line_words.sort(key=lambda wd: wd[7])
            text, spans = "", []
            for wd in line_words:
                if text:
                    text += " "
                spans.append((len(text), len(text) + len(wd[4]), pymupdf.Rect(wd[:4])))
                text += wd[4]
            for _, pattern in patterns:
                for m in pattern.finditer(text):
                    if not m.group(0).strip():
                        continue
                    rect = pymupdf.Rect()
                    for start, end, r in spans:
                        if start < m.end() and end > m.start():
                            rect |= r
                    if not rect.is_empty:
                        hits.append((m.group(0), rect))
        return hits

    def redact(
        self, pdf_path: Path, out: Path, areas: List[Dict[str, Any]], clean_metadata: bool, display_name: str
    ) -> Path:
        parsed = [RedactArea.model_validate(a) for a in areas]
        if not parsed:
            raise InvalidPDFInputError("Mark at least one area to black out.")

        def run() -> Path:
            doc = self.open_pdf(pdf_path, display_name)
            try:
                touched = set()
                for area in parsed:
                    if area.page > doc.page_count:
                        raise InvalidPDFInputError(f"Page {area.page} doesn't exist in this PDF.")
                    page = doc[area.page - 1]
                    rect = self._to_unrotated(page, self._box_rect(page.rect, area.box))
                    page.add_redact_annot(rect, fill=(0, 0, 0))
                    touched.add(area.page - 1)
                for pno in touched:
                    # Removes the text, the covered image pixels and vector drawings under each box.
                    doc[pno].apply_redactions(
                        images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                        graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
                    )
                if clean_metadata:
                    doc.set_metadata({})
                    doc.del_xml_metadata()
                    doc.scrub(
                        attached_files=True, clean_pages=False, embedded_files=True, hidden_text=True,
                        javascript=True, metadata=True, redactions=False, remove_links=False,
                        reset_fields=False, reset_responses=True, thumbnails=True, xml_metadata=True,
                    )
                return self._save(doc, out, clean=True)
            finally:
                doc.close()

        return self._guard("redact", run)

    # ---------- protect / unlock / repair ----------

    def protect(
        self,
        pdf_path: Path,
        out: Path,
        password: str,
        owner_password: str,
        allow_print: bool,
        allow_copy: bool,
        allow_edit: bool,
        display_name: str,
    ) -> Path:
        if len(password) < 1 or len(password) > 128:
            raise InvalidPDFInputError("Choose a password (up to 128 characters).")

        def run() -> Path:
            doc = self.open_pdf(pdf_path, display_name)
            try:
                perms = pymupdf.PDF_PERM_ACCESSIBILITY
                if allow_print:
                    perms |= pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ
                if allow_copy:
                    perms |= pymupdf.PDF_PERM_COPY
                if allow_edit:
                    perms |= pymupdf.PDF_PERM_MODIFY | pymupdf.PDF_PERM_ANNOTATE | pymupdf.PDF_PERM_FORM | pymupdf.PDF_PERM_ASSEMBLE
                # Without a separate owner password, restrictions would be lifted by the same password.
                owner = owner_password or (password + "#" + os.urandom(8).hex())
                return self._save(
                    doc, out, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=owner, permissions=perms
                )
            finally:
                doc.close()

        return self._guard("protect", run)

    def unlock(self, pdf_path: Path, out: Path, password: str, display_name: str) -> Path:
        def run() -> Path:
            try:
                doc = pymupdf.open(str(pdf_path), filetype="pdf")
            except Exception:
                raise InvalidPDFInputError(f"'{display_name}' is not a valid or readable PDF.")
            try:
                if doc.needs_pass:
                    if not password:
                        raise InvalidPDFInputError("This PDF needs its password to open. Type it to unlock the file.")
                    if not doc.authenticate(password):
                        raise InvalidPDFInputError("That password didn't open the PDF. Check it and try again.")
                elif not _has_encrypt(doc):
                    raise InvalidPDFInputError("This PDF isn't protected. There's nothing to unlock.")
                return self._save(doc, out, encryption=pymupdf.PDF_ENCRYPT_NONE)
            finally:
                doc.close()

        return self._guard("unlock", run)

    def repair(self, pdf_path: Path, out: Path, display_name: str) -> Dict[str, Any]:
        def run() -> Dict[str, Any]:
            try:
                # MuPDF rebuilds a broken cross-reference table while opening.
                doc = pymupdf.open(str(pdf_path), filetype="pdf")
            except Exception:
                raise InvalidPDFInputError(
                    f"'{display_name}' is too damaged to recover: no readable pages were found."
                )
            try:
                if doc.needs_pass:
                    raise InvalidPDFInputError("This PDF is password-protected. Unlock it first, then repair it.")
                if doc.page_count == 0:
                    raise InvalidPDFInputError(f"No pages could be recovered from '{display_name}'.")
                rebuilt = bool(getattr(doc, "is_repaired", False))
                good = pymupdf.open()
                skipped = 0
                for pno in range(doc.page_count):
                    try:
                        good.insert_pdf(doc, from_page=pno, to_page=pno)
                    except Exception:
                        skipped += 1
                if good.page_count == 0:
                    raise InvalidPDFInputError(f"No pages could be recovered from '{display_name}'.")
                out.parent.mkdir(parents=True, exist_ok=True)
                good.save(str(out), garbage=4, deflate=True, clean=True)
                good.close()
                return {"pages": doc.page_count - skipped, "skipped": skipped, "rebuilt": rebuilt}
            finally:
                doc.close()

        return self._guard("repair", run)

    # ---------- OCR ----------

    @staticmethod
    def tessdata_dir() -> Optional[Path]:
        candidates = [
            settings.TESSDATA_DIR,
            os.environ.get("TESSDATA_PREFIX"),
            r"C:\Program Files\Tesseract-OCR\tessdata",
            r"C:\Program Files (x86)\Tesseract-OCR\tessdata",
            "/usr/share/tesseract-ocr/5/tessdata",
            "/usr/share/tesseract-ocr/4.00/tessdata",
            "/usr/share/tessdata",
            "/opt/homebrew/share/tessdata",
            "/usr/local/share/tessdata",
        ]
        for c in candidates:
            if c and Path(c).is_dir() and any(Path(c).glob("*.traineddata")):
                return Path(c)
        return None

    def ocr_languages(self) -> List[str]:
        folder = self.tessdata_dir()
        if not folder:
            return []
        return sorted(p.stem for p in folder.glob("*.traineddata") if p.stem not in ("osd", "equ"))

    def ocr(self, pdf_path: Path, out: Path, languages: List[str], force: bool, display_name: str) -> Dict[str, Any]:
        folder = self.tessdata_dir()
        if not folder:
            raise PDFProcessingError("Text recognition isn't set up on this server yet.")
        installed = set(self.ocr_languages())
        langs = [l for l in dict.fromkeys(languages) if l]
        if not langs:
            langs = ["eng"]
        missing = [l for l in langs if l not in installed]
        if missing or len(langs) > 5:
            raise InvalidPDFInputError(
                f"Pick up to 5 languages from the list{'; not available: ' + ', '.join(missing) if missing else ''}."
            )
        lang = "+".join(langs)

        def run() -> Dict[str, Any]:
            doc = self.open_pdf(pdf_path, display_name)
            try:
                if doc.page_count > settings.OCR_MAX_PAGES:
                    raise InvalidPDFInputError(f"OCR works on up to {settings.OCR_MAX_PAGES} pages at a time.")
                done, skipped = 0, 0
                for page in doc:
                    if not force and len(page.get_text().strip()) > 20:
                        skipped += 1  # Already has real text; OCR would only add a duplicate layer.
                        continue
                    pix = page.get_pixmap(dpi=settings.OCR_DPI, alpha=False)
                    ocr_doc = pymupdf.open("pdf", pix.pdfocr_tobytes(language=lang, tessdata=str(folder)))
                    op = ocr_doc[0]
                    # Keep only the invisible text Tesseract produced; the original page stays as it was.
                    op.add_redact_annot(op.rect)
                    op.apply_redactions(
                        images=pymupdf.PDF_REDACT_IMAGE_REMOVE, graphics=0, text=pymupdf.PDF_REDACT_TEXT_NONE
                    )
                    page.show_pdf_page(
                        page.rect * page.derotation_matrix, ocr_doc, 0, overlay=True, rotate=page.rotation, keep_proportion=False
                    )
                    ocr_doc.close()
                    done += 1
                self._save(doc, out)
                return {"ocr_pages": done, "skipped_pages": skipped, "languages": langs}
            finally:
                doc.close()

        return self._guard("read the text of", run)

    # ---------- PDF -> images ----------

    def to_images(
        self, pdf_path: Path, out_dir: Path, mode: str, fmt: str, dpi: int, pages: Optional[str], display_name: str
    ) -> List[Path]:
        if fmt not in ("jpg", "png") or dpi not in (72, 150, 220, 300) or mode not in ("pages", "extract"):
            raise InvalidPDFInputError("Pick an image format and quality.")
        stem = Path(display_name).stem or "document"

        def run() -> List[Path]:
            out_dir.mkdir(parents=True, exist_ok=True)
            doc = self.open_pdf(pdf_path, display_name)
            files: List[Path] = []
            try:
                chosen = self.page_selection(doc, pages)
                if mode == "pages":
                    for pno in chosen:
                        pix = doc[pno].get_pixmap(dpi=dpi, alpha=False)
                        target = out_dir / f"{stem}_page_{pno + 1}.{fmt}"
                        if fmt == "jpg":
                            pix.save(str(target), output="jpeg", jpg_quality=90)
                        else:
                            pix.save(str(target), output="png")
                        files.append(target)
                else:
                    seen = set()
                    for pno in chosen:
                        for img in doc.get_page_images(pno, full=True):
                            xref = img[0]
                            if xref in seen:
                                continue
                            seen.add(xref)
                            try:
                                info = doc.extract_image(xref)
                            except Exception:
                                continue
                            if not info or info.get("width", 0) < 16 or info.get("height", 0) < 16:
                                continue
                            ext = info.get("ext", "png")
                            target = out_dir / f"{stem}_p{pno + 1}_img{len(files) + 1}.{ext}"
                            target.write_bytes(info["image"])
                            files.append(target)
                    if not files:
                        raise InvalidPDFInputError("This PDF has no pictures to extract. Try 'Page to image' instead.")
                return files
            finally:
                doc.close()

        return self._guard("turn into images", run)

    # ---------- images -> PDF ----------

    def from_images(
        self,
        image_paths: List[Path],
        names: List[str],
        out: Path,
        page_size: str,
        orientation: str,
        margin: str,
        enhance: bool,
    ) -> Path:
        if not image_paths:
            raise InvalidPDFInputError("Add at least one image.")
        if len(image_paths) > settings.IMAGES_MAX_FILES:
            raise InvalidPDFInputError(f"Up to {settings.IMAGES_MAX_FILES} images at a time.")
        if page_size not in ("fit", *PAGE_SIZES) or orientation not in ("auto", "portrait", "landscape") or margin not in MARGINS:
            raise InvalidPDFInputError("Pick a page size, orientation and margin.")

        def run() -> Path:
            doc = pymupdf.open()
            try:
                for path, name in zip(image_paths, names):
                    data, (iw, ih) = self._prepare_photo(path, name, enhance)
                    pad = MARGINS[margin]
                    if page_size == "fit":
                        pw, ph = iw * 72 / 150 + 2 * pad, ih * 72 / 150 + 2 * pad  # 150 dpi feels like "actual size"
                    else:
                        pw, ph = PAGE_SIZES[page_size]
                        landscape = orientation == "landscape" or (orientation == "auto" and iw > ih)
                        if landscape:
                            pw, ph = ph, pw
                    page = doc.new_page(width=pw, height=ph)
                    page.insert_image(pymupdf.Rect(pad, pad, pw - pad, ph - pad), stream=data, keep_proportion=True)
                return self._save(doc, out)
            finally:
                doc.close()

        return self._guard("build a PDF from", run)

    @staticmethod
    def _prepare_photo(path: Path, name: str, enhance: bool) -> Tuple[bytes, Tuple[int, int]]:
        try:
            with Image.open(path) as im:
                im.seek(0)
                im = ImageOps.exif_transpose(im)
                im.thumbnail((3508, 3508))  # A4 at 300 dpi is plenty for any page size we offer.
                if enhance:
                    # "Scan" look: greyscale, stretched contrast, slight sharpening (paper turns white).
                    im = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=2).filter(ImageFilter.SHARPEN)
                buf = io.BytesIO()
                if im.mode in ("RGBA", "LA", "P") and not enhance:
                    bg = Image.new("RGB", im.size, (255, 255, 255))
                    rgba = im.convert("RGBA")
                    bg.paste(rgba, mask=rgba.getchannel("A"))
                    im = bg
                im.convert("L" if enhance else "RGB").save(buf, format="JPEG", quality=88, optimize=True)
                return buf.getvalue(), im.size
        except Exception as exc:
            logger.error("Image %s unreadable: %s", name, exc)
            raise InvalidPDFInputError(f"'{name}' couldn't be read as an image. Try JPG or PNG.")

    # ---------- PDF/A ----------

    @staticmethod
    def ghostscript() -> Optional[Path]:
        return _find_tool(
            settings.GHOSTSCRIPT_PATH,
            ["gswin64c", "gswin32c", "gs"],
            [r"C:\Program Files\gs\*\bin\gswin64c.exe", r"C:\Program Files (x86)\gs\*\bin\gswin32c.exe"],
        )

    def to_pdfa(self, pdf_path: Path, out: Path, level: int, work_dir: Path, display_name: str) -> Path:
        """Runs in a thread (Ghostscript is a separate process)."""
        if level not in (1, 2, 3):
            raise InvalidPDFInputError("Pick PDF/A-1b, 2b or 3b.")
        gs = self.ghostscript()
        if not gs:
            raise PDFProcessingError("PDF/A conversion isn't available on this server yet (Ghostscript is missing).")
        work_dir.mkdir(parents=True, exist_ok=True)
        icc = self._srgb_profile(gs, work_dir)
        definition = work_dir / "pdfa_def.ps"
        definition.write_text(_PDFA_DEF.replace("@ICC@", icc.as_posix()).replace("@TITLE@", _ps_escape(Path(display_name).stem)), encoding="latin-1")
        cmd = [
            str(gs), "-dPDFA=%d" % level, "-dBATCH", "-dNOPAUSE", "-dSAFER", "-dQUIET", "-dNOOUTERSAVE",
            "-sColorConversionStrategy=RGB", "-sProcessColorModel=DeviceRGB", "-dPDFACompatibilityPolicy=1",
            "-sDEVICE=pdfwrite", f"--permit-file-read={work_dir.as_posix()}/", f"-sOutputFile={out}", str(definition), str(pdf_path),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=settings.SUBPROCESS_TIMEOUT_SECONDS, cwd=work_dir)
        except subprocess.TimeoutExpired:
            raise PDFProcessingError("PDF/A conversion took too long. Try a smaller PDF.")
        if proc.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
            logger.error("Ghostscript failed (%s): %s", proc.returncode, proc.stderr[-800:])
            raise PDFProcessingError("This PDF couldn't be converted to PDF/A.")
        return out

    @staticmethod
    def _srgb_profile(gs: Path, work_dir: Path) -> Path:
        for candidate in (gs.parent.parent / "iccprofiles" / "srgb.icc", gs.parent.parent / "iccprofiles" / "default_rgb.icc"):
            if candidate.is_file():
                target = work_dir / "srgb.icc"
                shutil.copyfile(candidate, target)
                return target
        from PIL import ImageCms

        target = work_dir / "srgb.icc"
        target.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
        return target

    # ---------- compare ----------

    def compare(self, path_a: Path, path_b: Path, name_a: str, name_b: str) -> Dict[str, Any]:
        def run() -> Dict[str, Any]:
            a = self.open_pdf(path_a, name_a)
            b = self.open_pdf(path_b, name_b)
            try:
                if max(a.page_count, b.page_count) > settings.COMPARE_MAX_PAGES:
                    raise InvalidPDFInputError(f"Compare works on PDFs of up to {settings.COMPARE_MAX_PAGES} pages.")
                wa, wb = _doc_words(a), _doc_words(b)
                if not wa and not wb:
                    raise InvalidPDFInputError("Neither PDF has selectable text to compare. Run OCR on them first.")
                matcher = difflib.SequenceMatcher(a=[w[0] for w in wa], b=[w[0] for w in wb], autojunk=False)
                changes: List[Dict[str, Any]] = []
                counts = {"insert": 0, "delete": 0, "replace": 0}
                for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                    if tag == "equal":
                        continue
                    counts[tag] += 1
                    if len(changes) < settings.COMPARE_MAX_CHANGES:
                        changes.append(
                            {
                                "type": tag,
                                "old": " ".join(w[0] for w in wa[i1:i2])[:400],
                                "new": " ".join(w[0] for w in wb[j1:j2])[:400],
                                "old_marks": _marks(a, wa[i1:i2]),
                                "new_marks": _marks(b, wb[j1:j2]),
                            }
                        )
                return {
                    "similarity": round(matcher.ratio() * 100, 1),
                    "counts": counts,
                    "total": sum(counts.values()),
                    "truncated": sum(counts.values()) > len(changes),
                    "pages": {"old": a.page_count, "new": b.page_count},
                    "changes": changes,
                }
            finally:
                a.close()
                b.close()

        return self._guard("compare", run)

    def compare_report(self, path_a: Path, path_b: Path, name_a: str, name_b: str, out: Path) -> Path:
        """Side-by-side pages, old on the left and new on the right, with every change marked."""
        result = self.compare(path_a, path_b, name_a, name_b)

        def run() -> Path:
            a = self.open_pdf(path_a, name_a)
            b = self.open_pdf(path_b, name_b)
            report = pymupdf.open()
            try:
                red, green = (0.86, 0.15, 0.15), (0.13, 0.6, 0.3)
                for i in range(max(a.page_count, b.page_count)):
                    left = a[i] if i < a.page_count else None
                    right = b[i] if i < b.page_count else None
                    pw = max(p.rect.width for p in (left, right) if p)
                    ph = max(p.rect.height for p in (left, right) if p)
                    page = report.new_page(width=pw * 2 + 72, height=ph + 60)
                    page.insert_text((24, 30), f"{name_a} · page {i + 1}" if left else f"{name_a} · (no page)", fontsize=10, color=(0.35, 0.35, 0.35))
                    page.insert_text((pw + 48, 30), f"{name_b} · page {i + 1}" if right else f"{name_b} · (no page)", fontsize=10, color=(0.35, 0.35, 0.35))
                    slots = [(left, a, pymupdf.Rect(24, 44, 24 + pw, 44 + ph), "old_marks", red), (right, b, pymupdf.Rect(pw + 48, 44, pw * 2 + 48, 44 + ph), "new_marks", green)]
                    for src_page, src_doc, slot, key, colour in slots:
                        page.draw_rect(slot, color=(0.8, 0.8, 0.8), width=0.5)
                        if not src_page:
                            continue
                        page.show_pdf_page(slot, src_doc, src_page.number)
                        sx, sy = slot.width / src_page.rect.width, slot.height / src_page.rect.height
                        for change in result["changes"]:
                            for mark in change[key]:
                                if mark["page"] != i + 1:
                                    continue
                                bx = mark["box"]
                                r = pymupdf.Rect(
                                    slot.x0 + bx["x0"] * src_page.rect.width * sx,
                                    slot.y0 + bx["y0"] * src_page.rect.height * sy,
                                    slot.x0 + bx["x1"] * src_page.rect.width * sx,
                                    slot.y0 + bx["y1"] * src_page.rect.height * sy,
                                )
                                page.draw_rect(r, color=None, fill=colour, fill_opacity=0.28, width=0)
                out.parent.mkdir(parents=True, exist_ok=True)
                report.save(str(out), garbage=3, deflate=True)
                return out
            finally:
                report.close()
                a.close()
                b.close()

        return self._guard("compare", run)

    # ---------- packaging ----------

    @staticmethod
    def zip_files(files: List[Path], target: Path) -> Path:
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for f in files:
                zf.write(f, arcname=f.name)
        return target


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _ps_escape(text: str) -> str:
    return re.sub(r"[()\\]", "", text)[:120] or "Document"


def _has_encrypt(doc: pymupdf.Document) -> bool:
    try:
        return doc.xref_get_key(-1, "Encrypt")[0] != "null"
    except Exception:
        return False


def _doc_words(doc: pymupdf.Document) -> List[Tuple[str, int, Tuple[float, float, float, float]]]:
    words = []
    for page in doc:
        for w in page.get_text("words", sort=True):
            words.append((w[4], page.number, (w[0], w[1], w[2], w[3])))
    return words


def _marks(doc: pymupdf.Document, words: Sequence[Tuple[str, int, Tuple[float, float, float, float]]]) -> List[Dict[str, Any]]:
    """Merges the boxes of consecutive words on one line into a single mark."""
    marks: List[Dict[str, Any]] = []
    current: Optional[Tuple[int, pymupdf.Rect]] = None
    for _, pno, box in words[:400]:
        r = pymupdf.Rect(box)
        if current and current[0] == pno and abs(current[1].y0 - r.y0) < 2 and r.x0 - current[1].x1 < 20:
            current = (pno, current[1] | r)
            continue
        if current:
            marks.append(_mark(doc, *current))
        current = (pno, r)
    if current:
        marks.append(_mark(doc, *current))
    return marks


def _mark(doc: pymupdf.Document, pno: int, rect: pymupdf.Rect) -> Dict[str, Any]:
    page = doc[pno]
    return {"page": pno + 1, "box": PDFToolsService._to_visible_box(page, rect)}


# PDF/A definition for Ghostscript: sets the sRGB output intent (required by PDF/A) and a title.
_PDFA_DEF = """%!
/ICCProfile (@ICC@) def
[ /Title (@TITLE@) /DOCINFO pdfmark
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} << /N 3 >> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} <<
  /Type /OutputIntent
  /S /GTS_PDFA1
  /DestOutputProfile {icc_PDFA}
  /OutputConditionIdentifier (sRGB)
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark
"""

pdf_tools_service = PDFToolsService()
