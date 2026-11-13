"""
The conversion graph. Each engine is a set of edges (every input → every output); the planner finds
the cheapest route of up to three steps between two formats, so "Markdown → PDF" or "XLS → JSON"
need no code of their own. Engines whose program isn't installed are left out of the graph, so the
site never offers a conversion this server can't do.

Costs are rough "how slow and how lossy" weights: a cheap faithful step (CSV → XLSX) is 1, LibreOffice
is 4, re-encoding video or reading text off pixels is 6–8.
"""

import heapq
import logging
import shutil
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, FrozenSet, List, Optional, Tuple

from app.services.universal.formats import FORMATS, category_of

logger = logging.getLogger(__name__)

MAX_STEPS = 3


def _ids(*cats: str, plus: Tuple[str, ...] = (), minus: Tuple[str, ...] = ()) -> FrozenSet[str]:
    found = {f.id for f in FORMATS.values() if f.category in cats}
    return frozenset((found | set(plus)) - set(minus))


WRITER_IN = frozenset({"docx", "doc", "odt", "rtf", "txt", "docm", "dotx"})
CALC_IN = frozenset({"xlsx", "xls", "ods", "xlsm", "csv"})
IMPRESS_IN = frozenset({"pptx", "ppt", "odp", "ppsx"})
DRAW_IN = frozenset({"odg"})
PANDOC_IN = frozenset({"md", "html", "docx", "odt", "rtf", "epub", "rst", "tex", "org", "ipynb", "textile", "wiki", "fb2", "adoc", "typ"})
PANDOC_OUT = frozenset({"md", "html", "docx", "odt", "rtf", "epub", "rst", "tex", "org", "ipynb", "txt", "wiki", "textile", "adoc", "typ", "fb2", "pptx"})
RASTER_IN = frozenset({"jpg", "png", "webp", "gif", "bmp", "tiff", "ico", "avif", "heic", "psd", "raw", "svg"})
RASTER_OUT = frozenset({"jpg", "png", "webp", "gif", "bmp", "tiff", "ico", "avif", "pdf"})
AUDIO = _ids("audio")
AUDIO_OUT = frozenset({"mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma", "aiff", "ac3"})
VIDEO = _ids("video")
VIDEO_OUT = frozenset({"mp4", "mkv", "webm", "mov", "avi", "wmv", "flv", "m4v"})
SUBTITLES = _ids("subtitle")
FONTS = _ids("font")
ARCHIVES_IN = _ids("archive")
ARCHIVES_OUT = frozenset({"zip", "7z", "tar", "tar.gz", "tar.bz2", "tar.xz"})
DATA_IN = frozenset({"csv", "tsv", "json", "jsonl", "xml", "yaml", "toml", "xlsx", "xlsm"})
DATA_OUT = frozenset({"csv", "tsv", "json", "jsonl", "xml", "yaml", "toml", "xlsx", "html", "md", "sql"})
CODE = _ids("code", plus=("sql",))


@dataclass(frozen=True)
class Engine:
    id: str
    label: str  # Shown to people: "via LibreOffice".
    inputs: FrozenSet[str]
    outputs: FrozenSet[str]
    cost: int
    needs: Optional[str] = None
    # Nothing may follow this step (its result is a frame, a GIF, a bundle of pages…).
    terminal: bool = False
    # As the last step, the result may be a ZIP (several pages, sheets or slides).
    bundle: FrozenSet[str] = field(default_factory=frozenset)
    # Edges to leave out (src, dst), where a better engine exists or the result would be poor.
    skip: FrozenSet[Tuple[str, str]] = field(default_factory=frozenset)


_WORDLIKE = {"docx", "odt", "rtf"}

ENGINES: List[Engine] = [
    Engine("office.writer", "LibreOffice", WRITER_IN, frozenset({"pdf", "docx", "doc", "odt", "rtf", "txt", "html", "epub"}), 4, "office"),
    Engine("office.calc", "LibreOffice", CALC_IN, frozenset({"xlsx", "xls", "ods", "pdf", "html"}), 4, "office"),
    Engine("office.impress", "LibreOffice", IMPRESS_IN, frozenset({"pptx", "ppt", "odp", "pdf"}), 4, "office"),
    Engine("office.draw", "LibreOffice", DRAW_IN, frozenset({"pdf", "odg", "svg", "png"}), 4, "office"),
    # One slide per page, text kept editable: closer to "PDF to PowerPoint" than Pandoc's outline.
    Engine("office.pdf_slides", "LibreOffice", frozenset({"pdf"}), frozenset({"pptx", "odp"}), 3, "office"),
    Engine("pdf.word", "pdf2docx", frozenset({"pdf"}), frozenset({"docx"}), 3),
    Engine("pdf.excel", "PyMuPDF tables", frozenset({"pdf"}), frozenset({"xlsx"}), 3),
    Engine("pdf.text", "PyMuPDF", frozenset({"pdf"}), frozenset({"txt"}), 4),
    Engine("pdf.images", "PyMuPDF", frozenset({"pdf"}), frozenset({"png", "jpg", "webp", "svg"}), 3,
           terminal=True, bundle=frozenset({"png", "jpg", "webp", "svg"})),
    Engine("web.pdf", "Chromium", frozenset({"html"}), frozenset({"pdf"}), 5, "web"),
    # Pandoc rewrites word-processor files through a simpler model; LibreOffice keeps more of their layout.
    Engine("pandoc", "Pandoc", PANDOC_IN, PANDOC_OUT, 2, "pandoc",
           skip=frozenset((a, b) for a in _WORDLIKE for b in _WORDLIKE)),
    Engine("text.code", "plain text", CODE, frozenset({"txt", "md"}), 1),
    Engine("text.plain", "plain text", frozenset({"txt"}), frozenset({"md"}), 3),
    Engine("text.notebook", "notebook reader", frozenset({"ipynb"}), frozenset({"py"}), 1),
    Engine("text.subtitles", "subtitle reader", SUBTITLES, frozenset({"txt"}), 1),
    Engine("text.email", "email reader", frozenset({"eml"}), frozenset({"html", "txt"}), 2),
    Engine("data", "data converter", DATA_IN, DATA_OUT, 1, bundle=frozenset({"csv", "tsv"})),
    Engine("image", "Pillow", RASTER_IN, RASTER_OUT, 2),
    Engine("image.svg_pdf", "MuPDF (vector)", frozenset({"svg"}), frozenset({"pdf"}), 1),
    Engine("image.ocr", "Tesseract OCR", RASTER_IN - {"svg"}, frozenset({"txt"}), 8, "ocr"),
    Engine("media.audio", "FFmpeg", AUDIO | VIDEO, AUDIO_OUT, 3, "ffmpeg"),
    Engine("media.video", "FFmpeg", VIDEO | {"gif"}, VIDEO_OUT, 6, "ffmpeg"),
    Engine("media.gif", "FFmpeg", VIDEO, frozenset({"gif"}), 6, "ffmpeg", terminal=True),
    Engine("media.frame", "FFmpeg", VIDEO, frozenset({"jpg", "png", "webp"}), 4, "ffmpeg", terminal=True),
    Engine("media.subtitles", "FFmpeg", SUBTITLES, SUBTITLES, 1, "ffmpeg"),
    Engine("font", "fontTools", FONTS, FONTS, 1),
    Engine("archive", "archive repacker", ARCHIVES_IN, ARCHIVES_OUT, 1),
]

# Which categories a file may pass through or end up in, by the category it starts in.
REACHABLE: Dict[str, FrozenSet[str]] = {
    "document": frozenset({"document", "markup", "ebook", "image", "presentation", "spreadsheet"}),
    "markup": frozenset({"document", "markup", "ebook", "presentation", "code"}),
    "ebook": frozenset({"document", "markup", "ebook"}),
    "code": frozenset({"code", "document", "markup"}),
    "spreadsheet": frozenset({"spreadsheet", "data", "document", "markup"}),
    "data": frozenset({"data", "spreadsheet", "document", "markup"}),
    "presentation": frozenset({"presentation", "document", "image"}),
    "drawing": frozenset({"drawing", "document", "image"}),
    "image": frozenset({"image", "document"}),
    "audio": frozenset({"audio"}),
    "video": frozenset({"video", "audio", "image"}),
    "subtitle": frozenset({"subtitle", "document"}),
    "font": frozenset({"font"}),
    "archive": frozenset({"archive"}),
    "email": frozenset({"markup", "document"}),
}
# Formats a route may end on but never pass through, by starting category. A photo becomes a Word
# document by reading its text (OCR), not by wrapping the picture in a PDF and "converting" that.
_SHEETS = _ids("spreadsheet")
# Plain text drops headings, bold and tables, so formatted files never pass through it. It stays a
# step only where the words are all there is: OCR, subtitles, email, code.
_PLAIN = frozenset({"txt"})
NO_TRANSIT: Dict[str, FrozenSet[str]] = {
    "image": frozenset({"pdf"}),
    # Tables pulled out of a document are an end result, never a step towards HTML or Markdown.
    "document": _SHEETS | _PLAIN,
    "presentation": _SHEETS | _PLAIN,
    "markup": _PLAIN,
    "ebook": _PLAIN,
    "spreadsheet": _PLAIN,
    "data": _PLAIN,
    "email": _PLAIN,
}
# Formats no route passes through, whatever it starts as (a table is never turned into a Word
# document by way of SQL statements).
NEVER_TRANSIT = frozenset({"sql", "ico", "gif"})
# Per-format requirements on top of an engine's own.
FORMAT_NEEDS = {"heic": "heic", "raw": "raw", "avif": "avif", "woff2": "woff2", "7z": "sevenzip"}


@dataclass(frozen=True)
class Step:
    source: str
    target: str
    engine: str
    label: str

    def as_dict(self) -> dict:
        return {"source": self.source, "target": self.target, "engine": self.label}


# ------------------------------------------------------------------------------------------------
# What this server has
# ------------------------------------------------------------------------------------------------


def _probe() -> Dict[str, bool]:
    caps: Dict[str, bool] = {}
    from app.services.convert import convert_service

    caps["office"] = convert_service.soffice() is not None
    caps["web"] = _chromium_installed()
    try:
        from app.services.pdf_tools import pdf_tools_service

        caps["ocr"] = bool(pdf_tools_service.ocr_languages())
    except Exception:
        caps["ocr"] = False
    caps["pandoc"] = pandoc_path() is not None
    caps["ffmpeg"] = ffmpeg_path() is not None
    caps["sevenzip"] = _importable("py7zr")
    caps["woff2"] = _importable("brotli")
    caps["heic"] = _importable("pillow_heif")
    caps["raw"] = _importable("rawpy")
    try:
        from PIL import features

        caps["avif"] = bool(features.check("avif"))
    except Exception:
        caps["avif"] = False
    return caps


_caps: Optional[Dict[str, bool]] = None


def capabilities() -> Dict[str, bool]:
    """Checked once per process: installing a program means restarting the server anyway."""
    global _caps
    if _caps is None:
        _caps = _probe()
        missing = sorted(k for k, ok in _caps.items() if not ok)
        if missing:
            logger.warning("Universal converter: not installed here: %s", ", ".join(missing))
    return _caps


def _importable(module: str) -> bool:
    import importlib.util

    return importlib.util.find_spec(module) is not None


def _chromium_installed() -> bool:
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            return Path(p.chromium.executable_path).is_file()
    except Exception:
        return False


@lru_cache(maxsize=1)
def pandoc_path() -> Optional[str]:
    try:
        import pypandoc

        path = pypandoc.get_pandoc_path()
        # On Windows pypandoc reports the binary without its ".exe".
        for candidate in (Path(path), Path(f"{path}.exe")) if path else ():
            if candidate.is_file():
                return str(candidate)
    except Exception:
        pass
    return shutil.which("pandoc")


@lru_cache(maxsize=1)
def ffmpeg_path() -> Optional[str]:
    try:
        from app.services.ffmpeg_service import init_ffmpeg

        init_ffmpeg()
    except Exception:
        pass
    return shutil.which("ffmpeg")


# ------------------------------------------------------------------------------------------------
# Planning
# ------------------------------------------------------------------------------------------------


def _edges(caps: Dict[str, bool]) -> Dict[str, List[Tuple[str, Engine]]]:
    graph: Dict[str, List[Tuple[str, Engine]]] = {}
    for eng in ENGINES:
        if eng.needs and not caps.get(eng.needs):
            continue
        for src in eng.inputs:
            if FORMAT_NEEDS.get(src) and not caps.get(FORMAT_NEEDS[src]):
                continue
            for dst in eng.outputs:
                if src == dst or (src, dst) in eng.skip:
                    continue
                if FORMAT_NEEDS.get(dst) and not caps.get(FORMAT_NEEDS[dst]):
                    continue
                graph.setdefault(src, []).append((dst, eng))
    return graph


def plan_all(source: str, caps: Optional[Dict[str, bool]] = None) -> Dict[str, List[Step]]:
    """Cheapest route from `source` to every format it can reach (Dijkstra, at most MAX_STEPS steps)."""
    caps = caps if caps is not None else capabilities()
    graph = _edges(caps)
    start_cat = category_of(source)
    allowed = REACHABLE.get(start_cat, frozenset())
    no_transit = NO_TRANSIT.get(start_cat, frozenset())

    best: Dict[str, Tuple[int, List[Step]]] = {}
    # States are (format, steps taken, ended): a pricier route with fewer steps may still reach further.
    seen: set = set()
    queue: List[Tuple[int, int, int, str, Tuple[Step, ...], bool]] = [(0, 0, 0, source, (), False)]
    counter = 0
    while queue:
        cost, n, _, fmt, path, ended = heapq.heappop(queue)
        if (fmt, n, ended) in seen:
            continue
        seen.add((fmt, n, ended))
        if fmt != source and (fmt not in best or cost < best[fmt][0]):
            best[fmt] = (cost, list(path))
        if ended or n >= MAX_STEPS or (fmt != source and (fmt in no_transit or fmt in NEVER_TRANSIT)):
            continue
        for dst, eng in graph.get(fmt, ()):
            if dst == source or category_of(dst) not in allowed:
                continue
            counter += 1
            step = Step(fmt, dst, eng.id, eng.label)
            heapq.heappush(queue, (cost + eng.cost, n + 1, counter, dst, path + (step,), eng.terminal))
    return {fmt: steps for fmt, (_, steps) in best.items()}


def plan(source: str, target: str) -> Optional[List[Step]]:
    return plan_all(source).get(target)


def engine(eid: str) -> Engine:
    for e in ENGINES:
        if e.id == eid:
            return e
    raise KeyError(eid)


def is_bundle(steps: List[Step]) -> bool:
    last = steps[-1]
    return last.target in engine(last.engine).bundle


def catalogue() -> dict:
    """Everything the frontend needs: formats, categories and every route this server can run."""
    from app.services.universal.formats import CATEGORIES

    caps = capabilities()
    routes = {}
    for fid in FORMATS:
        reach = plan_all(fid, caps)
        if reach:
            routes[fid] = [
                {"target": t, "steps": [s.as_dict() for s in steps], "bundle": is_bundle(steps)}
                for t, steps in sorted(reach.items(), key=lambda kv: list(FORMATS).index(kv[0]))
            ]
    # Formats that are only ever written (like SQL from a table) still need describing.
    return {
        "categories": [{"id": c, "label": label} for c, label in CATEGORIES],
        "formats": [f.as_dict() for f in FORMATS.values()],
        "routes": routes,
        "engines": caps,
    }
