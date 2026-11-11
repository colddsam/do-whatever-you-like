"""
Document conversion: Office/HTML → PDF and PDF → Word/PowerPoint/Excel.

- Office ↔ PDF uses LibreOffice (soffice, headless) as a subprocess, so it runs in a thread.
  Every job gets its own LibreOffice profile folder: a shared profile makes parallel
  conversions fail or hang.
- PDF → Word (pdf2docx) and PDF → Excel (PyMuPDF tables + openpyxl) are CPU-bound Python and
  run in the PDF process pool (`run_pdf("convert.<method>", ...)`).
- HTML/URL → PDF uses headless Chromium (Playwright). Every request the page makes is checked
  against private address ranges, so a page can't be used to reach the server's network.
"""

import ipaddress
import logging
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import BinaryIO, List, Optional
from urllib.parse import urlparse

import pymupdf

from app.config.convert import settings
from app.core.config import app_settings
from app.exceptions.convert import ConverterUnavailableError, ConvertProcessingError, InvalidConvertInputError

logger = logging.getLogger(__name__)

OFFICE_KINDS = {
    "word": {".doc", ".docx", ".odt", ".rtf", ".txt", ".wpd"},
    "powerpoint": {".ppt", ".pptx", ".odp", ".pps", ".ppsx", ".key"},
    "excel": {".xls", ".xlsx", ".ods", ".csv", ".xlsm"},
    "html": {".html", ".htm"},
}
PAGE_FORMATS = {"a4": "A4", "letter": "Letter", "legal": "Legal", "a3": "A3"}
MARGINS = {"none": "0", "small": "10mm", "large": "20mm"}

_office_slots = threading.BoundedSemaphore(max(1, settings.OFFICE_CONCURRENCY))


class ConvertService:
    CHUNK_SIZE = 1024 * 64

    # ---------- shared ----------

    @staticmethod
    def soffice() -> Optional[Path]:
        if settings.SOFFICE_PATH and Path(settings.SOFFICE_PATH).is_file():
            return Path(settings.SOFFICE_PATH)
        for name in ("soffice", "libreoffice"):
            found = shutil.which(name)
            if found:
                return Path(found)
        for candidate in (
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            "/usr/bin/soffice",
            "/usr/lib/libreoffice/program/soffice",
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        ):
            if Path(candidate).is_file():
                return Path(candidate)
        return None

    @staticmethod
    def validate_office(filename: Optional[str], kind: str) -> str:
        if kind not in OFFICE_KINDS:
            raise InvalidConvertInputError("Unknown document type.")
        ext = Path(filename or "").suffix.lower()
        if ext not in OFFICE_KINDS[kind]:
            allowed = ", ".join(sorted(e[1:].upper() for e in OFFICE_KINDS[kind]))
            raise InvalidConvertInputError(f"'{ext[1:].upper() or 'That'}' files won't work here. Try {allowed}.")
        return ext

    def save_upload(self, file_obj: BinaryIO, destination: Path, max_mb: Optional[int] = None) -> Path:
        limit = (max_mb or app_settings.MAX_DOWNLOAD_SIZE_MB) * 1024 * 1024
        total = 0
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(destination, "wb") as buffer:
                while chunk := file_obj.read(self.CHUNK_SIZE):
                    total += len(chunk)
                    if total > limit:
                        raise InvalidConvertInputError(f"That file is over {limit // (1024 * 1024)} MB.")
                    buffer.write(chunk)
        except InvalidConvertInputError:
            raise
        except Exception as exc:
            logger.error("Failed to save upload: %s", exc)
            raise ConvertProcessingError("Could not save the uploaded file.")
        if total == 0:
            raise InvalidConvertInputError("That file is empty.")
        return destination

    # ---------- LibreOffice ----------

    def _soffice_convert(self, source: Path, out_dir: Path, target: str, infilter: Optional[str] = None) -> Path:
        soffice = self.soffice()
        if not soffice:
            raise ConverterUnavailableError("Office conversion isn't available on this server yet (LibreOffice is missing).")
        source, out_dir = source.resolve(), out_dir.resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        # Profiles live under a short path: LibreOffice builds deep folders inside its profile and
        # crashes (0xC0000409) once a path passes Windows' 260-character limit.
        profile = _profile_root() / uuid.uuid4().hex[:10]
        cmd = [
            str(soffice),
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless", "--invisible", "--norestore", "--nolockcheck", "--nodefault", "--nofirststartwizard",
        ]
        if infilter:
            cmd.append(f"--infilter={infilter}")
        cmd += ["--convert-to", target, "--outdir", str(out_dir), str(source)]
        acquired = _office_slots.acquire(timeout=settings.OFFICE_TIMEOUT_SECONDS)
        if not acquired:
            raise ConvertProcessingError("The converter is busy. Try again in a minute.")
        try:
            # A server process has no usable console: LibreOffice crashes on inherited console
            # handles, so give it its own null stdin and (on Windows) no console window.
            proc = subprocess.run(
                cmd,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=settings.OFFICE_TIMEOUT_SECONDS,
                cwd=str(out_dir),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired:
            raise ConvertProcessingError("That conversion took too long. Try a smaller file.")
        finally:
            _office_slots.release()
            _remove_profile(profile)
        ext = target.split(":", 1)[0]
        produced = out_dir / f"{source.stem}.{ext}"
        if proc.returncode != 0 or not produced.is_file() or produced.stat().st_size == 0:
            logger.error("soffice failed (%s): %s %s", proc.returncode, proc.stdout[-400:], proc.stderr[-400:])
            raise ConvertProcessingError("This document couldn't be converted. It may be damaged or password-protected.")
        return produced

    def office_to_pdf(self, source: Path, out_dir: Path, kind: str, one_page_sheets: bool = False) -> Path:
        """Word/PowerPoint/Excel/HTML file → PDF. Runs in a thread."""
        target = "pdf"
        if kind == "excel":
            filt = '{"SinglePageSheets":{"type":"boolean","value":"%s"}}' % ("true" if one_page_sheets else "false")
            target = f"pdf:calc_pdf_Export:{filt}"
        elif kind == "powerpoint":
            target = "pdf:impress_pdf_Export"
        elif kind == "word":
            target = "pdf:writer_pdf_Export"
        return self._soffice_convert(source, out_dir, target)

    def pdf_to_powerpoint(self, source: Path, out_dir: Path) -> Path:
        """Each PDF page becomes a slide whose text and drawings stay editable. Runs in a thread."""
        self._check_pdf(source)
        return self._soffice_convert(source, out_dir, "pptx:Impress MS PowerPoint 2007 XML", infilter="impress_pdf_import")

    @staticmethod
    def _check_pdf(source: Path) -> int:
        try:
            doc = pymupdf.open(str(source), filetype="pdf")
        except Exception:
            raise InvalidConvertInputError("That isn't a readable PDF.")
        try:
            if doc.needs_pass:
                raise InvalidConvertInputError("This PDF is password-protected. Unlock it first.")
            if doc.page_count == 0:
                raise InvalidConvertInputError("This PDF has no pages.")
            return doc.page_count
        finally:
            doc.close()

    # ---------- PDF → Word / Excel (process pool) ----------

    def pdf_to_word(self, source: Path, out: Path) -> Path:
        self._check_pdf(source)
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            from pdf2docx import Converter

            logging.getLogger("pdf2docx").setLevel(logging.WARNING)
            cv = Converter(str(source))
            try:
                cv.convert(str(out), multi_processing=False)
            finally:
                cv.close()
        except (InvalidConvertInputError, ConvertProcessingError):
            raise
        except Exception as exc:
            logger.error("pdf2docx failed: %s", exc)
            raise ConvertProcessingError("This PDF couldn't be turned into a Word document.")
        if not out.is_file() or out.stat().st_size == 0:
            raise ConvertProcessingError("The Word document could not be written.")
        return out

    def pdf_to_excel(self, source: Path, out: Path, mode: str) -> dict:
        """Tables become sheets. mode: 'tables' (one sheet per table) or 'pages' (one sheet per page)."""
        pages = self._check_pdf(source)
        if pages > settings.EXCEL_MAX_PAGES:
            raise InvalidConvertInputError(f"PDF to Excel works on up to {settings.EXCEL_MAX_PAGES} pages.")
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font
        from openpyxl.utils import get_column_letter

        wb = Workbook()
        wb.remove(wb.active)
        tables_found = 0
        doc = pymupdf.open(str(source))
        try:
            for page in doc:
                try:
                    tables = page.find_tables().tables
                except Exception:
                    tables = []
                rows_for_page: List[List[Optional[str]]] = []
                for ti, table in enumerate(tables, start=1):
                    rows = [[_clean_cell(c) for c in row] for row in table.extract()]
                    rows = [r for r in rows if any(c for c in r)]
                    if not rows:
                        continue
                    tables_found += 1
                    if mode == "tables":
                        _write_sheet(wb, f"P{page.number + 1} T{ti}", rows, Font, Alignment, get_column_letter)
                    else:
                        rows_for_page += rows + [[]]
                if mode == "pages" and rows_for_page:
                    _write_sheet(wb, f"Page {page.number + 1}", rows_for_page, Font, Alignment, get_column_letter)
            if tables_found == 0:
                # No ruled tables: fall back to the text, split into columns where words sit apart.
                for page in doc:
                    rows = _text_rows(page)
                    if rows:
                        _write_sheet(wb, f"Page {page.number + 1}", rows, Font, Alignment, get_column_letter)
        finally:
            doc.close()
        if not wb.worksheets:
            raise InvalidConvertInputError("No tables or text were found. If this is a scan, run OCR on it first.")
        out.parent.mkdir(parents=True, exist_ok=True)
        wb.save(str(out))
        return {"tables": tables_found, "sheets": len(wb.worksheets)}

    # ---------- HTML / URL → PDF (Chromium) ----------

    @staticmethod
    def check_public_url(url: str) -> str:
        url = (url or "").strip()
        if not url:
            raise InvalidConvertInputError("Paste the address of a web page.")
        if "://" not in url:
            url = "https://" + url
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise InvalidConvertInputError("Use a web address that starts with http:// or https://.")
        if len(url) > 2048:
            raise InvalidConvertInputError("That address is too long.")
        _assert_public_host(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        return url

    def html_to_pdf(
        self,
        out: Path,
        url: Optional[str],
        html_path: Optional[Path],
        page_size: str,
        landscape: bool,
        margin: str,
        background: bool,
        screen: bool,
    ) -> Path:
        """Runs in a thread (Playwright's sync API with its own browser process)."""
        if page_size not in PAGE_FORMATS or margin not in MARGINS:
            raise InvalidConvertInputError("Pick a page size and margin.")
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise ConverterUnavailableError("Web page conversion isn't available on this server yet.")

        out.parent.mkdir(parents=True, exist_ok=True)
        timeout_ms = settings.HTML_TIMEOUT_SECONDS * 1000
        # Chromium shares LibreOffice's slots: on a small instance (512 MB) two heavy converters at
        # once would run the machine out of memory.
        if not _office_slots.acquire(timeout=settings.OFFICE_TIMEOUT_SECONDS):
            raise ConvertProcessingError("The converter is busy. Try again in a minute.")
        try:
            with sync_playwright() as p:
                try:
                    browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
                except PlaywrightError as exc:
                    logger.error("Chromium failed to start: %s", exc)
                    raise ConverterUnavailableError("Web page conversion isn't available on this server yet.")
                try:
                    context = browser.new_context(
                        accept_downloads=False, java_script_enabled=True, viewport={"width": 1280, "height": 900},
                        service_workers="block",
                    )
                    context.route("**/*", _guard_request)
                    page = context.new_page()
                    page.set_default_timeout(timeout_ms)
                    if url:
                        response = page.goto(url, wait_until="load", timeout=timeout_ms)
                        if response is not None and response.status >= 400:
                            raise InvalidConvertInputError(f"That page answered with an error ({response.status}).")
                    else:
                        page.set_content(html_path.read_text(encoding="utf-8", errors="replace"), wait_until="load", timeout=timeout_ms)
                    try:
                        page.wait_for_load_state("networkidle", timeout=8000)
                    except PlaywrightError:
                        pass  # Pages that poll forever still get printed.
                    if screen:
                        page.emulate_media(media="screen")
                    page.pdf(
                        path=str(out),
                        format=PAGE_FORMATS[page_size],
                        landscape=landscape,
                        print_background=background,
                        margin={k: MARGINS[margin] for k in ("top", "bottom", "left", "right")},
                    )
                finally:
                    browser.close()
        except (InvalidConvertInputError, ConverterUnavailableError, ConvertProcessingError):
            raise
        except Exception as exc:
            logger.error("HTML to PDF failed: %s", exc)
            message = str(exc)
            if "Timeout" in message:
                raise ConvertProcessingError("That page took too long to load.")
            if "ERR_NAME_NOT_RESOLVED" in message or "ERR_CONNECTION" in message:
                raise InvalidConvertInputError("That page couldn't be reached. Check the address.")
            if "blocked" in message.lower() or "ERR_FAILED" in message:
                raise InvalidConvertInputError("That address isn't allowed. Use a public web page.")
            raise ConvertProcessingError("That page couldn't be turned into a PDF.")
        finally:
            _office_slots.release()
        if not out.is_file() or out.stat().st_size == 0:
            raise ConvertProcessingError("The PDF could not be written.")
        return out


def _profile_root() -> Path:
    root = Path(settings.OFFICE_PROFILE_DIR or Path(tempfile.gettempdir()) / "dw_lo")
    root.mkdir(parents=True, exist_ok=True)
    return root


def _remove_profile(profile: Path) -> None:
    """LibreOffice's helper process can hold its profile for a moment after exiting."""
    for _ in range(10):
        shutil.rmtree(profile, ignore_errors=True)
        if not profile.exists():
            return
        time.sleep(0.3)
    logger.warning("Couldn't remove LibreOffice profile %s", profile)


def _assert_public_host(host: str, port: int) -> None:
    """Every address the host resolves to must be public, so the server's own network stays out of reach."""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise InvalidConvertInputError("That address couldn't be found. Check it and try again.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise InvalidConvertInputError("That address isn't allowed. Use a public web page.")


def _guard_request(route, request) -> None:
    """Playwright route handler: lets through data/blob and public http(s); blocks everything else."""
    url = request.url
    scheme = url.split(":", 1)[0].lower()
    if scheme in ("data", "blob", "about"):
        return route.continue_()
    if scheme not in ("http", "https"):
        return route.abort("blockedbyclient")
    parsed = urlparse(url)
    try:
        _assert_public_host(parsed.hostname or "", parsed.port or (443 if scheme == "https" else 80))
    except InvalidConvertInputError:
        logger.warning("Blocked a request to a non-public address while printing a page: %s", parsed.hostname)
        return route.abort("blockedbyclient")
    return route.continue_()


def _clean_cell(value) -> Optional[str]:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def _coerce(value: Optional[str]):
    """Numbers stay numbers in Excel ("1,234.50" → 1234.5); everything else stays text."""
    if value is None:
        return None
    raw = value.replace(",", "").replace(" ", "")
    if raw and raw.replace(".", "", 1).lstrip("-").isdigit() and not (len(raw) > 1 and raw.startswith("0") and "." not in raw):
        try:
            return float(raw) if "." in raw else int(raw)
        except ValueError:
            return value
    return value


def _write_sheet(wb, title: str, rows, Font, Alignment, get_column_letter) -> None:
    ws = wb.create_sheet(title=title[:31])
    widths: dict = {}
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=_coerce(value))
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            widths[c] = max(widths.get(c, 8), min(60, len(str(value or "")) + 2))
    if rows and any(rows[0]):
        for cell in ws[1]:
            cell.font = Font(bold=True)
    for c, w in widths.items():
        ws.column_dimensions[get_column_letter(c)].width = w


def _text_rows(page: pymupdf.Page) -> List[List[str]]:
    rows: List[List[str]] = []
    words = page.get_text("words", sort=True)
    lines: dict = {}
    for w in words:
        lines.setdefault((w[5], w[6]), []).append(w)
    for key in sorted(lines, key=lambda k: (min(x[1] for x in lines[k]), min(x[0] for x in lines[k]))):
        ws = sorted(lines[key], key=lambda x: x[0])
        cells, current, last_x1 = [], "", None
        for w in ws:
            if last_x1 is not None and w[0] - last_x1 > 18:  # A wide gap starts a new column.
                cells.append(current)
                current = ""
            current = f"{current} {w[4]}".strip()
            last_x1 = w[2]
        cells.append(current)
        rows.append(cells)
    return rows


convert_service = ConvertService()
