"""
Every file format the universal converter knows, keyed by a short id that is also the extension of
the file it writes ("tar.gz" included). `detect_format` maps a filename to one of these ids.

Categories group formats for people ("Documents", "Audio"…) and decide which conversions make sense
(see `REACHABLE` in graph.py): a song never turns into a spreadsheet.
"""

from pathlib import Path
from typing import Dict, List, Optional, Tuple

CATEGORIES: List[Tuple[str, str]] = [
    ("document", "Documents"),
    ("markup", "Markup & text"),
    ("ebook", "Ebooks"),
    ("spreadsheet", "Spreadsheets"),
    ("data", "Data"),
    ("presentation", "Presentations"),
    ("drawing", "Drawings"),
    ("image", "Images"),
    ("audio", "Audio"),
    ("video", "Video"),
    ("subtitle", "Subtitles"),
    ("font", "Fonts"),
    ("archive", "Archives"),
    ("code", "Source code"),
    ("email", "Email"),
]

# id: (label, category, extensions it's read from; the first is the one written)
_F: Dict[str, Tuple[str, str, List[str]]] = {
    # Documents
    "pdf": ("PDF", "document", [".pdf"]),
    "docx": ("Word document", "document", [".docx"]),
    "doc": ("Word 97–2003", "document", [".doc"]),
    "odt": ("OpenDocument text", "document", [".odt"]),
    "rtf": ("Rich Text", "document", [".rtf"]),
    "txt": ("Plain text", "document", [".txt", ".text"]),
    "docm": ("Word (macros)", "document", [".docm"]),
    "dotx": ("Word template", "document", [".dotx", ".dot"]),
    # Markup & text
    "md": ("Markdown", "markup", [".md", ".markdown", ".mdown", ".mkd"]),
    "html": ("HTML", "markup", [".html", ".htm", ".xhtml"]),
    "rst": ("reStructuredText", "markup", [".rst"]),
    "tex": ("LaTeX", "markup", [".tex", ".latex"]),
    "org": ("Org mode", "markup", [".org"]),
    "adoc": ("AsciiDoc", "markup", [".adoc", ".asciidoc"]),
    "textile": ("Textile", "markup", [".textile"]),
    "wiki": ("MediaWiki", "markup", [".wiki", ".mediawiki"]),
    "typ": ("Typst", "markup", [".typ"]),
    "ipynb": ("Jupyter notebook", "markup", [".ipynb"]),
    # Ebooks
    "epub": ("EPUB", "ebook", [".epub"]),
    "fb2": ("FictionBook", "ebook", [".fb2"]),
    # Spreadsheets
    "xlsx": ("Excel workbook", "spreadsheet", [".xlsx"]),
    "xls": ("Excel 97–2003", "spreadsheet", [".xls"]),
    "ods": ("OpenDocument sheet", "spreadsheet", [".ods"]),
    "xlsm": ("Excel (macros)", "spreadsheet", [".xlsm"]),
    # Data
    "csv": ("CSV", "data", [".csv"]),
    "tsv": ("TSV", "data", [".tsv", ".tab"]),
    "json": ("JSON", "data", [".json"]),
    "jsonl": ("JSON Lines", "data", [".jsonl", ".ndjson"]),
    "xml": ("XML", "data", [".xml"]),
    "yaml": ("YAML", "data", [".yaml", ".yml"]),
    "toml": ("TOML", "data", [".toml"]),
    "sql": ("SQL", "data", [".sql"]),
    # Presentations
    "pptx": ("PowerPoint", "presentation", [".pptx"]),
    "ppt": ("PowerPoint 97–2003", "presentation", [".ppt"]),
    "odp": ("OpenDocument slides", "presentation", [".odp"]),
    "ppsx": ("PowerPoint show", "presentation", [".ppsx", ".pps"]),
    # Drawings
    "odg": ("OpenDocument drawing", "drawing", [".odg"]),
    # Images
    "jpg": ("JPEG", "image", [".jpg", ".jpeg", ".jfif", ".jpe"]),
    "png": ("PNG", "image", [".png"]),
    "webp": ("WebP", "image", [".webp"]),
    "gif": ("GIF", "image", [".gif"]),
    "bmp": ("Bitmap", "image", [".bmp", ".dib"]),
    "tiff": ("TIFF", "image", [".tiff", ".tif"]),
    "ico": ("Icon", "image", [".ico"]),
    "avif": ("AVIF", "image", [".avif"]),
    "heic": ("HEIC", "image", [".heic", ".heif"]),
    "psd": ("Photoshop", "image", [".psd"]),
    "svg": ("SVG", "image", [".svg"]),
    "raw": ("Camera RAW", "image", [
        ".dng", ".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".rw2", ".orf",
        ".pef", ".raf", ".raw", ".srw", ".3fr", ".kdc", ".mrw", ".x3f",
    ]),
    # Audio
    "mp3": ("MP3", "audio", [".mp3"]),
    "wav": ("WAV", "audio", [".wav", ".wave"]),
    "ogg": ("Ogg Vorbis", "audio", [".ogg", ".oga"]),
    "flac": ("FLAC", "audio", [".flac"]),
    "m4a": ("M4A (AAC)", "audio", [".m4a"]),
    "aac": ("AAC", "audio", [".aac"]),
    "opus": ("Opus", "audio", [".opus"]),
    "wma": ("WMA", "audio", [".wma"]),
    "aiff": ("AIFF", "audio", [".aiff", ".aif", ".aifc"]),
    "ac3": ("AC-3", "audio", [".ac3"]),
    "amr": ("AMR", "audio", [".amr"]),
    "weba": ("WebM audio", "audio", [".weba"]),
    "mka": ("Matroska audio", "audio", [".mka"]),
    # Video
    "mp4": ("MP4", "video", [".mp4"]),
    "mkv": ("MKV", "video", [".mkv"]),
    "webm": ("WebM", "video", [".webm"]),
    "mov": ("QuickTime", "video", [".mov", ".qt"]),
    "avi": ("AVI", "video", [".avi"]),
    "wmv": ("WMV", "video", [".wmv", ".asf"]),
    "flv": ("Flash video", "video", [".flv"]),
    "m4v": ("M4V", "video", [".m4v"]),
    "mpeg": ("MPEG", "video", [".mpeg", ".mpg", ".mpe", ".vob"]),
    "3gp": ("3GP", "video", [".3gp", ".3g2"]),
    "mts": ("AVCHD", "video", [".mts", ".m2ts"]),
    "ogv": ("Ogg video", "video", [".ogv"]),
    # Subtitles
    "srt": ("SubRip", "subtitle", [".srt"]),
    "vtt": ("WebVTT", "subtitle", [".vtt"]),
    "ass": ("Advanced SubStation", "subtitle", [".ass", ".ssa"]),
    # Fonts
    "ttf": ("TrueType", "font", [".ttf"]),
    "otf": ("OpenType", "font", [".otf"]),
    "woff": ("WOFF", "font", [".woff"]),
    "woff2": ("WOFF2", "font", [".woff2"]),
    # Archives (multi-part extensions are matched before single ones)
    "zip": ("ZIP", "archive", [".zip"]),
    "7z": ("7-Zip", "archive", [".7z"]),
    "tar": ("TAR", "archive", [".tar"]),
    "tar.gz": ("TAR.GZ", "archive", [".tar.gz", ".tgz"]),
    "tar.bz2": ("TAR.BZ2", "archive", [".tar.bz2", ".tbz2", ".tbz"]),
    "tar.xz": ("TAR.XZ", "archive", [".tar.xz", ".txz"]),
    "gz": ("Gzip", "archive", [".gz"]),
    # Source code and plain-text config (read as text)
    "py": ("Python", "code", [".py", ".pyw"]),
    "js": ("JavaScript", "code", [".js", ".mjs", ".cjs"]),
    # ".mts" is AVCHD video above; TypeScript modules are too rare to take it.
    "ts": ("TypeScript", "code", [".ts", ".cts"]),
    "jsx": ("JSX", "code", [".jsx"]),
    "tsx": ("TSX", "code", [".tsx"]),
    "java": ("Java", "code", [".java"]),
    "kt": ("Kotlin", "code", [".kt", ".kts"]),
    "c": ("C", "code", [".c", ".h"]),
    "cpp": ("C++", "code", [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"]),
    "cs": ("C#", "code", [".cs"]),
    "go": ("Go", "code", [".go"]),
    "rs": ("Rust", "code", [".rs"]),
    "rb": ("Ruby", "code", [".rb"]),
    "php": ("PHP", "code", [".php"]),
    "swift": ("Swift", "code", [".swift"]),
    "sh": ("Shell script", "code", [".sh", ".bash", ".zsh"]),
    "ps1": ("PowerShell", "code", [".ps1"]),
    "css": ("CSS", "code", [".css", ".scss", ".less"]),
    "lua": ("Lua", "code", [".lua"]),
    "r": ("R", "code", [".r"]),
    "dart": ("Dart", "code", [".dart"]),
    "log": ("Log file", "code", [".log"]),
    "ini": ("INI / config", "code", [".ini", ".cfg", ".conf", ".properties", ".env"]),
    # Email
    "eml": ("Email message", "email", [".eml"]),
}

# Pandoc / highlighting names for code, where they differ from the id.
CODE_LANGUAGE = {
    "py": "python", "js": "javascript", "ts": "typescript", "jsx": "javascript", "tsx": "typescript",
    "kt": "kotlin", "cs": "cs", "rs": "rust", "rb": "ruby", "sh": "bash", "ps1": "powershell",
    "ini": "ini", "log": "", "r": "r", "cpp": "cpp", "c": "c", "sql": "sql",
}


class Format:
    __slots__ = ("id", "label", "category", "extensions")

    def __init__(self, fid: str, label: str, category: str, extensions: List[str]):
        self.id, self.label, self.category, self.extensions = fid, label, category, extensions

    @property
    def ext(self) -> str:
        """What files of this format are written as."""
        return "." + self.id

    def as_dict(self) -> dict:
        return {"id": self.id, "label": self.label, "category": self.category, "extensions": self.extensions}


FORMATS: Dict[str, Format] = {fid: Format(fid, *spec) for fid, spec in _F.items()}

_BY_EXT: Dict[str, str] = {}
for _fmt in FORMATS.values():
    for _ext in _fmt.extensions:
        _BY_EXT[_ext] = _fmt.id
# Longest extensions first, so "x.tar.gz" is TAR.GZ rather than Gzip.
_EXTS = sorted(_BY_EXT, key=len, reverse=True)


def detect_format(filename: Optional[str]) -> Optional[str]:
    name = Path(filename or "").name.lower()
    for ext in _EXTS:
        if name.endswith(ext) and len(name) > len(ext):
            return _BY_EXT[ext]
    return None


def stem_of(filename: Optional[str], fmt: Optional[str]) -> str:
    """The name without its format's extension ("report.tar.gz" → "report")."""
    name = Path(filename or "file").name
    if fmt:
        lower = name.lower()
        for ext in sorted(FORMATS[fmt].extensions, key=len, reverse=True):
            if lower.endswith(ext):
                return name[: -len(ext)] or "file"
    return Path(name).stem or "file"


def category_of(fmt: str) -> str:
    return FORMATS[fmt].category
