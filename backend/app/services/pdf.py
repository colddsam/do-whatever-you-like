import json
import logging
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Tuple
import pymupdf

from app.config.pdf import settings
from app.core.config import app_settings
from app.exceptions.pdf import InvalidPDFInputError, PDFProcessingError, PDFUploadExpiredError

logger = logging.getLogger(__name__)


class PDFService:
    CHUNK_SIZE = 1024 * 64
    TOKEN_PATTERN = re.compile(r"^[a-f0-9]{32}$")
    PART_PAGES = re.compile(r"pages?_(\d+(?:-\d+)?(?:_\d+(?:-\d+)?)*)\.pdf$")
    # Strengths the compress estimate measures; the UI interpolates between them and then asks
    # for the exact strength the slider settles on. Includes the UI's presets (25 / 50 / 80).
    ESTIMATE_STRENGTHS = (1, 25, 50, 80, 95)
    ESTIMATE_MAX_STRENGTHS = 10
    ESTIMATE_MIN_SAMPLE_PAGES = 3
    ESTIMATE_MAX_SAMPLE_PAGES = 12
    STALE_JOB_SECONDS = 2 * 60 * 60

    @property
    def cache_dir(self) -> Path:
        return settings.TEMP_DIR / "cache"

    @classmethod
    def validate_filename(cls, filename: str | None) -> str:
        if not filename:
            raise InvalidPDFInputError("PDF filename is missing.")

        ext = Path(filename).suffix.lower()
        if ext != ".pdf":
            raise InvalidPDFInputError(
                f"Unsupported file format '{ext or 'unknown'}'. Only '.pdf' files are allowed."
            )
        return ext

    def save_upload_to_disk(self, file_obj: BinaryIO, destination: Path) -> Path:
        max_bytes = app_settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
        total_bytes = 0

        try:
            with open(destination, "wb") as buffer:
                while True:
                    chunk = file_obj.read(self.CHUNK_SIZE)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise InvalidPDFInputError(
                            f"PDF file exceeds maximum allowed size ({app_settings.MAX_DOWNLOAD_SIZE_MB} MB)."
                        )
                    buffer.write(chunk)
        except InvalidPDFInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save uploaded PDF file: %s", exc)
            raise PDFProcessingError("Could not save the uploaded PDF file.")

        if total_bytes == 0:
            raise InvalidPDFInputError("Uploaded PDF file is empty.")

        return destination

    @staticmethod
    def _open_valid_pdf(pdf_path: Path, display_name: str | None = None) -> pymupdf.Document:

        name = display_name or pdf_path.name
        doc: pymupdf.Document | None = None
        try:
            doc = pymupdf.open(str(pdf_path), filetype="pdf")
        except Exception as exc:
            logger.error("Failed to open PDF %s: %s", pdf_path.name, exc)

        if doc is None:
            raise InvalidPDFInputError(f"'{name}' is not a valid or readable PDF.")

        if doc.is_encrypted:
            doc.close()
            raise InvalidPDFInputError(f"'{name}' is password-protected and cannot be processed.")

        if doc.page_count == 0:
            doc.close()
            raise InvalidPDFInputError(f"'{name}' contains no pages.")

        return doc

    def merge_pdfs(
        self,
        pdf_paths: List[Path],
        output_path: Path,
        display_names: List[str] | None = None,
    ) -> Path:
        if len(pdf_paths) < 2:
            raise InvalidPDFInputError("At least 2 PDF files are required for merging.")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        merged_doc = pymupdf.open()
        try:
            for i, path in enumerate(pdf_paths):
                name = display_names[i] if display_names and i < len(display_names) else None
                src_doc = self._open_valid_pdf(path, name)
                try:
                    merged_doc.insert_pdf(src_doc)
                finally:
                    src_doc.close()

            merged_doc.save(str(output_path), garbage=3, deflate=True)
        except InvalidPDFInputError:
            raise
        except Exception as exc:
            logger.error("Failed to merge PDFs: %s", exc)
            raise PDFProcessingError("Failed to merge the provided PDF files.")
        finally:
            merged_doc.close()

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise PDFProcessingError("Merged PDF file could not be generated.")

        return output_path

    @classmethod
    def _parse_range(cls, text: str, total_pages: int) -> Tuple[int, int]:
        """'3' or '1-3' (1-based) -> 0-based inclusive bounds."""
        if "-" in text:
            a, b = (s.strip() for s in text.split("-", 1))
            if not a.isdigit() or not b.isdigit():
                raise InvalidPDFInputError(f"Invalid page range '{text}'. Use format like '1-3'.")
            start_page, end_page = int(a), int(b)
        else:
            if not text.isdigit():
                raise InvalidPDFInputError(f"Invalid page number '{text}'.")
            start_page = end_page = int(text)

        if start_page < 1 or end_page > total_pages or start_page > end_page:
            raise InvalidPDFInputError(
                f"Page range '{text}' is out of bounds for PDF with {total_pages} page(s)."
            )
        return start_page - 1, end_page - 1

    @classmethod
    def parse_page_groups(cls, page_ranges: str, total_pages: int) -> List[List[int]]:
        """
        Commas separate output PDFs; '+' joins ranges into the same PDF, in the order given.
        '1-3, 5' -> two PDFs (pages 1-3, page 5); '1-3+5, 4' -> pages 1,2,3,5 then page 4.
        Returns 0-based page lists.
        """
        groups: List[List[int]] = []
        parts = [p.strip() for p in page_ranges.split(",") if p.strip()]
        if not parts:
            raise InvalidPDFInputError("Invalid page_ranges format. Example: '1-3, 5' or '1-3+5, 4'.")

        for part in parts:
            pieces = [s.strip() for s in part.split("+")]
            if any(not s for s in pieces):
                raise InvalidPDFInputError(f"Invalid page group '{part}'. Join ranges like '1-3+5'.")
            pages: List[int] = []
            for piece in pieces:
                start, end = cls._parse_range(piece, total_pages)
                pages.extend(range(start, end + 1))
            groups.append(pages)

        if sum(len(g) for g in groups) > settings.MAX_OUTPUT_PAGES:
            raise InvalidPDFInputError(f"That would make more than {settings.MAX_OUTPUT_PAGES} pages.")
        return groups

    @staticmethod
    def _runs(pages: List[int]) -> List[Tuple[int, int]]:
        """0-based pages -> runs of consecutive ascending pages, as 1-based (first, last)."""
        runs: List[Tuple[int, int]] = []
        for p in pages:
            if runs and p == runs[-1][1]:
                runs[-1] = (runs[-1][0], p + 1)
            else:
                runs.append((p + 1, p + 1))
        return runs

    @classmethod
    def _part_name(cls, idx: int, pages: List[int]) -> str:
        """page_5.pdf · part_1_pages_1-3.pdf · part_2_pages_1-3_5.pdf (the frontend parses these)."""
        if len(pages) == 1:
            return f"page_{pages[0] + 1}.pdf"
        label = "_".join(f"{a}" if a == b else f"{a}-{b}" for a, b in cls._runs(pages))
        return f"part_{idx}_pages_{label}.pdf"

    def split_pdf(
        self,
        pdf_path: Path,
        target_dir: Path,
        page_ranges: str | None = None,
        display_name: str | None = None,
    ) -> List[Path]:
        target_dir.mkdir(parents=True, exist_ok=True)
        src_doc = self._open_valid_pdf(pdf_path, display_name)
        output_files: List[Path] = []

        try:
            total_pages = src_doc.page_count
            clean_ranges = (page_ranges or "").strip()

            if clean_ranges:
                groups = self.parse_page_groups(clean_ranges, total_pages)
            else:
                groups = [[i] for i in range(total_pages)]

            for idx, pages in enumerate(groups, start=1):
                part_doc = pymupdf.open()
                try:
                    # Contiguous runs go in with one call each (keeps links between them intact).
                    for first, last in self._runs(pages):
                        part_doc.insert_pdf(src_doc, from_page=first - 1, to_page=last - 1)
                    out_name = self._part_name(idx, pages)
                    out_path = target_dir / out_name
                    if out_path.exists():
                        out_path = target_dir / f"part_{idx}_{out_name}"
                    part_doc.save(str(out_path), garbage=3, deflate=True)
                    output_files.append(out_path)
                finally:
                    part_doc.close()
        except InvalidPDFInputError:
            raise
        except Exception as exc:
            logger.error("Failed to split PDF %s: %s", pdf_path.name, exc)
            raise PDFProcessingError("Failed to split the provided PDF file.")
        finally:
            src_doc.close()

        if not output_files:
            raise PDFProcessingError("No split PDF files were generated.")

        return output_files

    ROTATIONS = (0, 90, 180, 270)

    @classmethod
    def parse_page_order(cls, spec: str, total_pages: int) -> List[Tuple[int, int]]:
        """
        'n' or 'n:deg' entries, comma-separated, in the new order (1-based pages; deg = 90/180/270
        clockwise on top of the page's own rotation). Pages left out are removed.
        '3, 1:90, 2' -> page 3, page 1 turned right, page 2. Returns 0-based (page, deg).
        """
        entries = [e.strip() for e in (spec or "").split(",") if e.strip()]
        if not entries:
            raise InvalidPDFInputError("Keep at least one page. Example: '3, 1:90, 2'.")
        if len(entries) > settings.MAX_OUTPUT_PAGES:
            raise InvalidPDFInputError(f"That would make more than {settings.MAX_OUTPUT_PAGES} pages.")

        order: List[Tuple[int, int]] = []
        for entry in entries:
            page_text, _, rot_text = entry.partition(":")
            page_text, rot_text = page_text.strip(), rot_text.strip()
            if not page_text.isdigit():
                raise InvalidPDFInputError(f"Invalid page '{entry}'. Use a page number, optionally ':90'.")
            page = int(page_text)
            if not 1 <= page <= total_pages:
                raise InvalidPDFInputError(f"Page {page} is out of bounds for PDF with {total_pages} page(s).")
            rotation = 0
            if rot_text:
                if not rot_text.lstrip("-").isdigit() or int(rot_text) % 90:
                    raise InvalidPDFInputError(f"Invalid rotation in '{entry}'. Use 90, 180 or 270.")
                rotation = int(rot_text) % 360
            order.append((page - 1, rotation))
        return order

    def organize_pdf(
        self,
        pdf_path: Path,
        output_path: Path,
        page_order: str,
        display_name: str | None = None,
    ) -> Path:
        """Reorders, rotates and removes pages in one pass."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        doc = self._open_valid_pdf(pdf_path, display_name)
        try:
            order = self.parse_page_order(page_order, doc.page_count)
            # select() keeps links, outlines and annotations that still point at kept pages.
            doc.select([page for page, _ in order])
            for i, (_, rotation) in enumerate(order):
                if rotation:
                    page = doc[i]
                    page.set_rotation((page.rotation + rotation) % 360)
            doc.save(str(output_path), garbage=3, deflate=True)
        except InvalidPDFInputError:
            raise
        except Exception as exc:
            logger.error("Failed to organize PDF %s: %s", pdf_path.name, exc)
            raise PDFProcessingError("Failed to rearrange the pages of that PDF.")
        finally:
            doc.close()

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise PDFProcessingError("Rearranged PDF file could not be generated.")
        return output_path

    def estimate_organize(self, pdf_path: Path, page_order: str, display_name: str, work_dir: Path) -> int:
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            return self.organize_pdf(pdf_path, work_dir / "organized.pdf", page_order, display_name).stat().st_size
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def thumbnail_path(self, token: str, page: int, width: int) -> Path:
        """Where a rendered page is cached, next to its upload (purge_cache expires it with the PDF)."""
        return self.cache_dir / f"{token}_p{page}_w{width}.png"

    @classmethod
    def clamp_thumbnail_width(cls, width: int) -> int:
        # Snap to steps of 40px so small layout differences reuse the same cached image.
        width = min(max(width, settings.THUMBNAIL_MIN_WIDTH), settings.THUMBNAIL_MAX_WIDTH)
        return max(settings.THUMBNAIL_MIN_WIDTH, (width + 39) // 40 * 40)

    def render_thumbnail(self, pdf_path: Path, page: int, width: int, out_path: Path) -> Path:
        """Renders one page (1-based), `width` px wide, as PNG. Respects the page's own rotation."""
        doc = self._open_valid_pdf(pdf_path)
        try:
            if not 1 <= page <= doc.page_count:
                raise InvalidPDFInputError(f"Page {page} is out of bounds for PDF with {doc.page_count} page(s).")
            pg = doc[page - 1]
            zoom = width / max(1.0, pg.rect.width)
            pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False, annots=True)
            tmp = out_path.with_suffix(f".{uuid.uuid4().hex[:8]}.tmp")
            pix.save(str(tmp), output="png")
            os.replace(tmp, out_path)  # Atomic: a parallel request never reads a half-written file.
        except InvalidPDFInputError:
            raise
        except Exception as exc:
            logger.error("Failed to render page %s of %s: %s", page, pdf_path.name, exc)
            raise PDFProcessingError("Couldn't draw that page.")
        finally:
            doc.close()
        return out_path

    @staticmethod
    def _compression_params(percentage: int) -> Tuple[int, int]:
        """(JPEG quality, target DPI) for a strength. Mirrored in frontend/src/lib/pdf.ts."""
        return max(10, int(95 - (percentage * 0.85))), max(50, int(300 - (percentage * 2.4)))

    def compress_pdf(
        self,
        pdf_path: Path,
        output_path: Path,
        compression_percentage: int,
        display_name: str | None = None,
    ) -> Path:
        if not (1 <= compression_percentage <= 95):
            raise InvalidPDFInputError("Compression percentage must be between 1 and 95.")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        doc = self._open_valid_pdf(pdf_path, display_name)
        try:
            quality, dpi_target = self._compression_params(compression_percentage)
            dpi_threshold = dpi_target + 20

            if hasattr(doc, "rewrite_images"):
                doc.rewrite_images(
                    dpi_threshold=dpi_threshold,
                    dpi_target=dpi_target,
                    quality=quality,
                    lossy=True,
                    lossless=True,
                    bitonal=True,
                    color=True,
                    gray=True,
                )

            if hasattr(doc, "scrub"):
                doc.scrub(
                    attached_files=False,
                    clean_pages=True,
                    embedded_files=False,
                    hidden_text=False,
                    javascript=False,
                    metadata=True,
                    redactions=False,
                    redact_images=0,
                    remove_links=False,
                    reset_fields=False,
                    reset_responses=False,
                    thumbnails=True,
                    xml_metadata=True,
                )

            doc.save(
                str(output_path),
                garbage=4,
                deflate=True,
                clean=True,
                deflate_images=True,
                deflate_fonts=True,
            )
        except InvalidPDFInputError:
            raise
        except Exception as exc:
            logger.error("Failed to compress PDF %s: %s", pdf_path.name, exc)
            raise PDFProcessingError("Failed to compress the provided PDF file.")
        finally:
            doc.close()

        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise PDFProcessingError("Compressed PDF file could not be generated.")

        return output_path


    def purge_cache(self) -> None:
        """Deletes cached uploads that haven't been used within the TTL."""
        if not self.cache_dir.exists():
            return
        cutoff = time.time() - settings.CACHE_TTL_SECONDS
        for f in self.cache_dir.iterdir():
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink(missing_ok=True)
            except OSError:
                pass

    def cache_save(self, file_obj: BinaryIO) -> str:
        """Step 1 of an upload (I/O only, fine in a thread): stores the bytes, returns a token."""
        self.purge_cache()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        token = uuid.uuid4().hex
        self.save_upload_to_disk(file_obj, self.cache_dir / f"{token}.pdf")
        return token

    def cache_register(self, token: str, filename: str) -> Dict[str, Any]:
        """Step 2 (PyMuPDF, run in the process pool): checks the PDF and records its details."""
        pdf_path = self.cache_dir / f"{token}.pdf"
        display_name = Path(filename).name
        try:
            doc = self._open_valid_pdf(pdf_path, display_name)
            page_count = doc.page_count
            doc.close()
        except Exception:
            pdf_path.unlink(missing_ok=True)
            raise
        meta = {
            "token": token,
            "filename": display_name,
            "size": pdf_path.stat().st_size,
            "page_count": page_count,
        }
        (self.cache_dir / f"{token}.json").write_text(json.dumps(meta), encoding="utf-8")
        return meta

    def discard_cached(self, token: str) -> None:
        for suffix in (".pdf", ".json"):
            (self.cache_dir / f"{token}{suffix}").unlink(missing_ok=True)

    def resolve_token(self, token: str) -> Tuple[Path, Dict[str, Any]]:
        """The cached PDF and its metadata. Using it refreshes its TTL."""
        if not self.TOKEN_PATTERN.match(token or ""):
            raise InvalidPDFInputError("Invalid upload token.")
        pdf_path = self.cache_dir / f"{token}.pdf"
        meta_path = self.cache_dir / f"{token}.json"
        if not pdf_path.is_file() or not meta_path.is_file():
            raise PDFUploadExpiredError()
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            raise PDFUploadExpiredError()
        now = time.time()
        for f in (pdf_path, meta_path):
            try:
                os.utime(f, (now, now))
            except OSError:
                pass
        return pdf_path, meta


    @classmethod
    def _pages_from_name(cls, name: str) -> List[int]:
        """The 1-based pages in a part, read back from its file name."""
        m = cls.PART_PAGES.search(name)
        if not m:
            return []
        pages: List[int] = []
        for run in m.group(1).split("_"):
            a, _, b = run.partition("-")
            pages.extend(range(int(a), int(b or a) + 1))
        return pages

    def estimate_merge(self, pdf_paths: List[Path], display_names: List[str], work_dir: Path) -> int:
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            out = self.merge_pdfs(pdf_paths, work_dir / "merged.pdf", display_names)
            return out.stat().st_size
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def estimate_split(
        self, pdf_path: Path, page_ranges: str | None, display_name: str, work_dir: Path
    ) -> Dict[str, Any]:
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            out_dir = work_dir / "output"
            parts = self.split_pdf(pdf_path, out_dir, page_ranges, display_name)
            items = []
            for part in parts:
                pages = self._pages_from_name(part.name)
                items.append(
                    {
                        "name": part.name,
                        "first_page": pages[0] if pages else None,
                        "last_page": pages[-1] if pages else None,
                        "pages": pages,
                        "size": part.stat().st_size,
                    }
                )
            if len(parts) == 1:
                return {"output": "pdf", "total_size": items[0]["size"], "parts": items}
            archive = Path(shutil.make_archive(str(work_dir / "archive"), "zip", out_dir))
            return {"output": "zip", "total_size": archive.stat().st_size, "parts": items}
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


    ESTIMATE_LARGEST = 4          
    ESTIMATE_SPREAD = 4         
    ESTIMATE_OUTPUT_PIXELS = 400_000  
    ESTIMATE_GRID = 3
    JPEG_HEADER_BYTES = 600       
    MIN_IMAGE_SIDE = 32

    @staticmethod
    def _stream_length(doc: pymupdf.Document, xref: int) -> int:
        try:
            kind, value = doc.xref_get_key(xref, "Length")
            if kind == "int":
                return int(value)
        except Exception:
            pass
        try:
            return len(doc.xref_stream_raw(xref))
        except Exception:
            return 0

    def _unique_images(self, doc: pymupdf.Document) -> List[Dict[str, Any]]:
        """Each image once (images are often shared between pages), with where it's first drawn."""
        seen: Dict[int, Dict[str, Any]] = {}
        for pno in range(doc.page_count):
            for item in doc.get_page_images(pno, full=True):
                xref, width, height, bpc = item[0], item[2], item[3], item[4]
                if xref <= 0 or xref in seen:
                    continue
                seen[xref] = {
                    "xref": xref,
                    "page": pno,
                    "item": item,
                    "w": width or 0,
                    "h": height or 0,
                    "bpc": bpc or 8,
                    "bytes": self._stream_length(doc, xref),
                }
        return list(seen.values())

    def prepare_compression_sample(self, pdf_path: Path, display_name: str, work_dir: Path) -> Dict[str, Any]:
        """Decides how to estimate this file and which images to measure. Once per request."""
        work_dir.mkdir(parents=True, exist_ok=True)
        original_size = pdf_path.stat().st_size
        doc = self._open_valid_pdf(pdf_path, display_name)
        try:
            images = self._unique_images(doc)
            full = {"mode": "full", "source": str(pdf_path), "original_size": original_size, "exact": True}
            if sum(i["w"] * i["h"] for i in images) <= settings.ESTIMATE_EXACT_PIXELS:

                return {**full, "strength_independent": not images}

            candidates = [i for i in images if i["bpc"] > 1 and min(i["w"], i["h"]) >= self.MIN_IMAGE_SIDE]
            by_size = sorted(candidates, key=lambda i: i["bytes"], reverse=True)
            chosen = by_size[: self.ESTIMATE_LARGEST]
            rest = sorted(by_size[self.ESTIMATE_LARGEST :], key=lambda i: (i["page"], i["xref"]))
            if rest:
                step = len(rest) / min(self.ESTIMATE_SPREAD, len(rest))
                chosen += [rest[int(k * step)] for k in range(min(self.ESTIMATE_SPREAD, len(rest)))]

            picked = []
            for rec in chosen:
                try:
                    bbox = doc[rec["page"]].get_image_bbox(rec["item"])
                except Exception:
                    continue
                if bbox.is_empty or bbox.is_infinite or bbox.width <= 0 or bbox.height <= 0:
                    continue
                picked.append(
                    {
                        "xref": rec["xref"],
                        "bytes": rec["bytes"],
                        "dpi_x": rec["w"] / (bbox.width / 72),
                        "dpi_y": rec["h"] / (bbox.height / 72),
                    }
                )
            if not picked:
                return {**full, "strength_independent": False}

            image_bytes = sum(i["bytes"] for i in images)
            candidate_bytes = sum(i["bytes"] for i in candidates)
            return {
                "mode": "tiles",
                "source": str(pdf_path),
                "original_size": original_size,
                "exact": False,
                "strength_independent": False,
                "picked": picked,
                "unsampled_image_bytes": candidate_bytes - sum(r["bytes"] for r in picked),
                "other_bytes": max(0, original_size - image_bytes) + (image_bytes - candidate_bytes),
            }
        finally:
            doc.close()

    def _tiles(self, w: int, h: int, factor: float) -> List[pymupdf.IRect]:
        """The regions of a w x h image to measure at a given downsampling factor."""
        budget = self.ESTIMATE_OUTPUT_PIXELS * factor * factor
        if w * h <= budget:
            return [pymupdf.IRect(0, 0, w, h)]
        grid = self.ESTIMATE_GRID
        side = max(int(64 * factor), int((budget / (grid * grid)) ** 0.5))
        side = max(16, (side // 16) * 16)
        tw, th = min(side, w), min(side, h)
        boxes = []
        for gy in range(grid):
            for gx in range(grid):
                cx, cy = int(w * (2 * gx + 1) / (2 * grid)), int(h * (2 * gy + 1) / (2 * grid))
                x0 = min(max(0, cx - tw // 2), w - tw)
                y0 = min(max(0, cy - th // 2), h - th)
                boxes.append(pymupdf.IRect(x0, y0, x0 + tw, y0 + th))
        return boxes

    def compressed_size(self, plan: Dict[str, Any], percentage: int, display_name: str, work_dir: Path) -> int:
        """The (estimated) size of the file compressed at one strength."""
        if not (1 <= percentage <= 95):
            raise InvalidPDFInputError("Compression percentage must be between 1 and 95.")
        work_dir.mkdir(parents=True, exist_ok=True)

        if plan["mode"] == "full":
            out = work_dir / f"c{percentage}_{uuid.uuid4().hex[:8]}.pdf"
            try:
                self.compress_pdf(Path(plan["source"]), out, percentage, display_name)
                return out.stat().st_size
            finally:
                out.unlink(missing_ok=True)

        quality, dpi_target = self._compression_params(percentage)
        threshold = dpi_target + 20
        doc = pymupdf.open(plan["source"])
        mini = pymupdf.open()
        layout = []  
        try:
            for rec in plan["picked"]:
                try:
                    pix = pymupdf.Pixmap(doc, rec["xref"])
                    if pix.alpha:
                        pix = pymupdf.Pixmap(pix, 0)
                    if pix.colorspace is None or pix.colorspace.n not in (1, 3):
                        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                except Exception as exc: 
                    logger.debug("Skipping image %s in compression estimate: %s", rec["xref"], exc)
                    continue
                dpi = max(rec["dpi_x"], rec["dpi_y"])
                factor = dpi / dpi_target if dpi > threshold else 1.0
                boxes = self._tiles(pix.width, pix.height, factor)
                for box in boxes:
                    tile = pymupdf.Pixmap(pix.colorspace, box, False)
                    tile.copy(pix, box)
                    tile.set_origin(0, 0)
                    pw, ph = box.width / rec["dpi_x"] * 72, box.height / rec["dpi_y"] * 72
                    page = mini.new_page(width=pw + 2, height=ph + 2)
                    page.insert_image(pymupdf.Rect(1, 1, 1 + pw, 1 + ph), pixmap=tile)
                measured = sum(b.width * b.height for b in boxes)
                layout.append((rec["bytes"], pix.width * pix.height, measured, len(boxes)))

            if not layout:
                return plan["original_size"]
            mini.rewrite_images(
                dpi_threshold=threshold, dpi_target=dpi_target, quality=quality,
                lossy=True, lossless=True, bitonal=True, color=True, gray=True,
            )
            sizes = []
            for page in mini:
                imgs = page.get_images()
                sizes.append(self._stream_length(mini, imgs[0][0]) if imgs else 0)
        finally:
            mini.close()
            doc.close()

        header = self.JPEG_HEADER_BYTES
        estimated = 0.0
        measured_from = 0
        i = 0
        for original, full_px, measured_px, count in layout:
            tiles = sizes[i : i + count]
            i += count
            if measured_px >= full_px:
                size = float(sum(tiles))  
            else:
                size = header + sum(max(0, t - header) for t in tiles) * full_px / max(1, measured_px)

            estimated += min(original, size)
            measured_from += original
        ratio = estimated / measured_from if measured_from else 1.0
        return int(plan["other_bytes"] + estimated + plan["unsampled_image_bytes"] * ratio)

    def purge_stale(self) -> None:
        """
        Startup/shutdown housekeeping that is safe with several workers sharing TEMP_DIR:
        expired cached uploads and job folders left by a crash are removed; live ones are kept.
        """
        self.purge_cache()
        if not settings.TEMP_DIR.exists():
            return
        cutoff = time.time() - self.STALE_JOB_SECONDS
        for entry in settings.TEMP_DIR.iterdir():
            if entry.name == "cache":
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    if entry.is_dir():
                        shutil.rmtree(entry, ignore_errors=True)
                    else:
                        entry.unlink(missing_ok=True)
            except OSError:
                pass

pdf_service = PDFService()
