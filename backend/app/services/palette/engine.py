"""
Colours from any file, two ways:

- pictures of it (pages of a PDF or Office file, an image the browser can't open, frames of a video),
  for the eyedropper and the automatic palette;
- the exact colours the file itself declares: Office theme colours and every colour in its XML, the
  fills, strokes and text colours of a PDF's vector drawing, the colours in SVG/CSS/HTML.

Runs in an isolated child process (app/core/isolation.py), in the heavy lane (LibreOffice, FFmpeg).
"""

import base64
import io
import re
import shutil
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

from app.config.palette import settings
from app.exceptions.palette import InvalidPaletteInputError, PaletteProcessingError

IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".psd", ".ico", ".svg",
          ".dng", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf"}
OFFICE = {".docx", ".doc", ".odt", ".rtf", ".pptx", ".ppt", ".odp", ".ppsx", ".xlsx", ".xls", ".ods", ".odg", ".pub", ".vsdx"}
VIDEO = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".wmv", ".flv", ".3gp", ".mpeg", ".mpg", ".mts", ".ogv"}
TEXT = {".html", ".htm", ".css", ".scss", ".less", ".json", ".txt", ".md", ".xml", ".js", ".ts", ".tsx", ".jsx", ".vue", ".svelte"}
PDFLIKE = {".pdf", ".ai", ".eps"}

THEME_SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
THEME_NAMES = {"dk1": "Dark 1", "lt1": "Light 1", "dk2": "Dark 2", "lt2": "Light 2", "accent1": "Accent 1", "accent2": "Accent 2",
               "accent3": "Accent 3", "accent4": "Accent 4", "accent5": "Accent 5", "accent6": "Accent 6", "hlink": "Hyperlink", "folHlink": "Followed link"}

HEX = re.compile(r"(?<![0-9A-Za-z&])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9A-Za-z])")
RGB = re.compile(r"rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})")


def _png(img, label: str) -> Dict[str, Any]:
    from PIL import Image, ImageOps

    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    if max(img.size) > settings.PAGE_PIXELS:
        img = ImageOps.contain(img, (settings.PAGE_PIXELS, settings.PAGE_PIXELS), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=False, compress_level=6)
    return {"label": label, "width": img.width, "height": img.height, "data": base64.b64encode(buf.getvalue()).decode("ascii")}


def _hex(r: float, g: float, b: float) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, round(v))) for v in (r, g, b)))


def extract(payload: Dict[str, Any]) -> Dict[str, Any]:
    path = Path(payload["input"])
    name = payload["name"]
    ext = Path(name).suffix.lower()
    work = Path(payload["work"])
    work.mkdir(parents=True, exist_ok=True)
    pages: List[Dict[str, Any]] = []
    declared: Counter = Counter()
    sources: Dict[str, str] = {}
    theme: List[Dict[str, str]] = []
    notes: List[str] = []

    def note_colour(hexv: str, src: str, n: int = 1) -> None:
        hexv = hexv.lower()
        declared[hexv] += n
        sources.setdefault(hexv, src)

    if ext in PDFLIKE or path.read_bytes()[:5] == b"%PDF-":
        _pdf(path, pages, note_colour, notes)
    elif ext in OFFICE:
        theme = _ooxml_colours(path, note_colour) if zipfile.is_zipfile(path) else []
        pdf = _office_pdf(path, ext, work)
        _pdf(pdf, pages, lambda *a, **k: None, notes)
    elif ext in IMAGES:
        from app.services.image import open_image

        if ext == ".svg":
            for h in _text_colours(path.read_text(encoding="utf-8", errors="replace")):
                note_colour(h, "SVG")
        img = open_image(path, name)
        if getattr(img, "n_frames", 1) > 1:
            img.seek(0)
        pages.append(_png(img.copy(), Path(name).name))
    elif ext in VIDEO:
        _video(path, pages, work)
    elif ext in TEXT:
        text = path.read_text(encoding="utf-8", errors="replace")
        for h in _text_colours(text):
            note_colour(h, ext[1:].upper())
        if not declared:
            raise InvalidPaletteInputError("No colours were found in that file.")
    elif ext == ".epub" and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.lower().endswith((".css", ".xhtml", ".html", ".svg")):
                    for h in _text_colours(z.read(n).decode("utf-8", "replace")):
                        note_colour(h, "EPUB styles")
    else:
        raise InvalidPaletteInputError("Colours can be picked from images, PDFs, Office files, videos, SVG, HTML and CSS.")

    if not pages and not declared and not theme:
        raise PaletteProcessingError("Nothing in that file could be shown or read for colours.")
    top = [{"hex": h, "count": c, "source": sources[h]} for h, c in declared.most_common(48)]
    return {"pages": pages, "declared": top, "theme": theme, "notes": notes}


def _text_colours(text: str) -> List[str]:
    out = []
    for m in HEX.finditer(text):
        h = m.group(1)
        out.append("#" + ("".join(c * 2 for c in h) if len(h) == 3 else h).lower())
    for r, g, b in RGB.findall(text):
        out.append(_hex(int(r), int(g), int(b)))
    return out


# ---------- PDF ----------


def _pdf(path: Path, pages: List[Dict[str, Any]], note, notes: List[str]) -> None:
    import pymupdf
    from PIL import Image

    try:
        doc = pymupdf.open(str(path))
    except Exception as exc:
        raise InvalidPaletteInputError("That file couldn't be opened as a PDF.") from exc
    if doc.needs_pass:
        raise InvalidPaletteInputError("That PDF is password-protected. Unlock it first.")
    try:
        count = doc.page_count
        if count > settings.MAX_PAGES:
            notes.append(f"The first {settings.MAX_PAGES} of {count} pages are shown.")
        for pno in range(min(count, settings.MAX_PAGES)):
            page = doc[pno]
            zoom = settings.PAGE_PIXELS / max(page.rect.width, page.rect.height)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            pages.append(_png(Image.frombytes("RGB", (pix.width, pix.height), pix.samples), f"Page {pno + 1}"))
            # Exact colours of the vector drawing and the text.
            try:
                for d in page.get_drawings():
                    for key in ("fill", "color"):
                        c = d.get(key)
                        if c and len(c) == 3:
                            note(_hex(*(v * 255 for v in c)), "PDF drawing")
                for block in page.get_text("dict").get("blocks", []):
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            c = span.get("color")
                            if isinstance(c, int):
                                note("#{:06x}".format(c), "PDF text", len(span.get("text", "")) // 4 + 1)
            except Exception:
                pass
    finally:
        doc.close()


# ---------- Office ----------

FILTER = {
    ".docx": "pdf:writer_pdf_Export", ".doc": "pdf:writer_pdf_Export", ".odt": "pdf:writer_pdf_Export", ".rtf": "pdf:writer_pdf_Export",
    ".pptx": "pdf:impress_pdf_Export", ".ppt": "pdf:impress_pdf_Export", ".odp": "pdf:impress_pdf_Export", ".ppsx": "pdf:impress_pdf_Export",
    ".xlsx": "pdf:calc_pdf_Export", ".xls": "pdf:calc_pdf_Export", ".ods": "pdf:calc_pdf_Export", ".odg": "pdf:draw_pdf_Export",
    ".pub": "pdf:draw_pdf_Export", ".vsdx": "pdf:draw_pdf_Export",
}


def _office_pdf(path: Path, ext: str, work: Path) -> Path:
    from app.services.convert import convert_service

    if convert_service.soffice() is None:
        raise PaletteProcessingError("Office files need LibreOffice, which isn't on this server.")
    local = work / f"document{ext}"
    shutil.copyfile(path, local)
    return convert_service._soffice_convert(local, work / "out", FILTER[ext])


def _ooxml_colours(path: Path, note) -> List[Dict[str, str]]:
    """Theme colours (in order) plus every colour written into the document's XML."""
    theme: List[Dict[str, str]] = []
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if sum(i.file_size for i in z.infolist()) > 1500 * 1024 * 1024:
            raise InvalidPaletteInputError("That document unpacks to more than this server can handle.")
        for n in names:
            if re.search(r"theme/theme1\.xml$", n):
                xml = z.read(n).decode("utf-8", "replace")
                for slot in THEME_SLOTS:
                    m = re.search(rf"<a:{slot}>\s*<a:(?:srgbClr val=\"([0-9A-Fa-f]{{6}})\"|sysClr[^>]*lastClr=\"([0-9A-Fa-f]{{6}})\")", xml)
                    if m:
                        theme.append({"name": THEME_NAMES[slot], "hex": "#" + (m.group(1) or m.group(2)).lower()})
                break
        for n in names:
            if not n.endswith(".xml") or "/theme/" in n:
                continue
            data = z.read(n)
            for m in re.findall(rb'(?:srgbClr val|w:color w:val|w:fill|rgb|fo:color|fo:background-color|draw:fill-color|svg:stroke-color)="#?(?:FF)?([0-9A-Fa-f]{6})"', data):
                h = "#" + m.decode().lower()
                if h not in ("#auto",):
                    note(h, "Document")
    return theme


# ---------- Video ----------


def _video(path: Path, pages: List[Dict[str, Any]], work: Path) -> None:
    from PIL import Image

    from app.services.universal.engines.common import run
    from app.services.universal.engines.media import LOCAL_ONLY, probe
    from app.services.universal.graph import ffmpeg_path

    info = probe(path)
    if not info["video"]:
        raise InvalidPaletteInputError("That file has no picture to pick colours from.")
    ff = ffmpeg_path()
    if not ff:
        raise PaletteProcessingError("Video frames need FFmpeg, which isn't on this server.")
    d = max(info["duration"], 0.5)
    for i in range(6):
        t = d * (i + 0.5) / 6
        out = work / f"frame{i}.png"
        run([ff, "-nostdin", "-loglevel", "error", "-y", *LOCAL_ONLY, "-i", str(path), "-ss", f"{t:.2f}", "-frames:v", "1", "-update", "1", str(out)], 120, what="Taking a frame")
        if out.is_file() and out.stat().st_size:
            pages.append(_png(Image.open(out), f"{int(t // 60)}:{int(t % 60):02d}"))
    if not pages:
        raise PaletteProcessingError("No frames could be taken from that video.")

