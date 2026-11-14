"""
Upload guard: every file sent to any endpoint is checked before the endpoint (or any converter,
renderer or decoder) sees it.

Two rules, both from the bytes, never from what the client claims:
1. The file's extension must be one this endpoint accepts (POLICY, built from the services' own lists).
2. The content must really be that kind of file: magic numbers for binary formats, the ZIP's internal
   layout for Office/OpenDocument/EPUB, "looks like text" for text formats, "<svg" for SVG.

So a renamed executable, a script called photo.jpg or a ZIP called report.docx is refused with
HTTP 415 at the door, instead of reaching LibreOffice, ffmpeg, PyMuPDF or Pillow. The check reads at
most a few KB of each file (plus a ZIP's directory), so it costs next to nothing.
"""

from __future__ import annotations

import logging
import zipfile
from pathlib import PurePath
from typing import BinaryIO, Dict, FrozenSet, Iterable, Optional

from fastapi import Request
from starlette.datastructures import UploadFile

from app.core.config import app_settings
from app.exceptions.upload import UnsupportedFileError

logger = logging.getLogger(__name__)

HEAD_BYTES = 8192

# ---------------------------------------------------------------------------
# What the bytes say
# ---------------------------------------------------------------------------

ISO_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"avif", b"avis", b"mif2"}
QT_ATOMS = {b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot", b"junk"}
EXECUTABLE = "executable"


def detect(head: bytes) -> Optional[str]:
    """The format the first bytes belong to, or None. 'text' when it's readable text."""
    h = head
    if h.startswith(b"MZ") or h.startswith(b"\x7fELF") or h[:4] in (b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"):
        return EXECUTABLE
    if b"%PDF-" in h[:1024]:
        return "pdf"
    if h.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if h.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if h[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if h[:4] == b"RIFF" and len(h) >= 12:
        return {b"WEBP": "webp", b"WAVE": "wav", b"AVI ": "avi"}.get(h[8:12])
    if h[:4] == b"FORM" and h[8:11] == b"AIF":
        return "aiff"
    if h[4:8] == b"ftyp":
        brand = h[8:12]
        if brand in ISO_HEIF_BRANDS:
            return "heif"
        if brand == b"crx ":
            return "cr3"
        return "isobmff"
    if h[4:8] in QT_ATOMS:
        return "isobmff"
    if h.startswith(b"\x1a\x45\xdf\xa3"):
        return "ebml"
    if h.startswith(b"OggS"):
        return "ogg"
    if h.startswith(b"fLaC"):
        return "flac"
    if h.startswith(b"#!AMR"):
        return "amr"
    if h.startswith(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11"):
        return "asf"
    if h.startswith(b"FLV"):
        return "flv"
    if h.startswith(b"\x0b\x77"):
        return "ac3"
    if h.startswith(b"\x00\x00\x01\xba") or h.startswith(b"\x00\x00\x01\xb3"):
        return "mpegps"
    if len(h) > 376 and h[0] == 0x47 and h[188] == 0x47:
        return "mpegts"
    if len(h) > 392 and h[4] == 0x47 and h[196] == 0x47:
        return "mpegts"  # M2TS: 192-byte packets
    if h[:2] in (bytes([0xFF, 0xFE]), bytes([0xFE, 0xFF])) and looks_like_text(h):
        return "text"  # UTF-16 with a byte-order mark (FF FE also starts some audio frames)
    if h.startswith(b"ID3"):
        return "mp3"  # ID3-tagged audio (MP3, sometimes AAC)
    if len(h) > 3 and h[0] == 0xFF and (h[1] & 0xF6) == 0xF0 and (h[2] >> 2) & 0xF < 13:
        return "aac"  # ADTS, with a real sampling-rate index
    if _mpeg_audio_frame(h):
        return "mp3"
    if h.startswith(b"BM") and len(h) > 14:
        return "bmp"
    if h[:4] in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        return "tiff"
    if h.startswith(b"IIRO") or h.startswith(b"IIRS") or h.startswith(b"MMOR"):
        return "orf"
    if h.startswith(b"IIU\x00"):
        return "rw2"
    if h.startswith(b"FUJIFILMCCD-RAW"):
        return "raf"
    if h[:2] == b"II" and h[6:14] == b"HEAPCCDR":
        return "crw"
    if h.startswith(b"\x00MRM"):
        return "mrw"
    if h.startswith(b"FOVb"):
        return "x3f"
    if h[:4] in (b"\x00\x00\x01\x00", b"\x00\x00\x02\x00") and len(h) > 6 and h[4] > 0:
        return "ico"
    if h.startswith(b"8BPS"):
        return "psd"
    if h[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true", b"typ1"):
        return "sfnt"
    if h.startswith(b"ttcf"):
        return "ttc"
    if h.startswith(b"wOFF"):
        return "woff"
    if h.startswith(b"wOF2"):
        return "woff2"
    if h.startswith(b"PK\x03\x04") or h.startswith(b"PK\x05\x06") or h.startswith(b"PK\x07\x08"):
        return "zip"
    if h.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "ole"
    if h.startswith(b"\x1f\x8b"):
        return "gzip"
    if h.startswith(b"BZh"):
        return "bzip2"
    if h.startswith(b"\xfd7zXZ\x00"):
        return "xz"
    if h.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7z"
    if h.startswith(b"Rar!\x1a\x07"):
        return "rar"
    if len(h) > 262 and h[257:262] == b"ustar":
        return "tar"
    if h.lstrip().startswith(b"{\\rtf"):
        return "rtf"
    if looks_like_text(h):
        return "text"
    return None


def _mpeg_audio_frame(h: bytes) -> bool:
    """A valid MPEG audio frame header (not just the sync bits), followed by a second one."""
    def frame_len(i: int) -> int:
        if i + 4 > len(h) or h[i] != 0xFF or (h[i + 1] & 0xE0) != 0xE0:
            return 0
        version = (h[i + 1] >> 3) & 3
        layer = (h[i + 1] >> 1) & 3
        bitrate = h[i + 2] >> 4
        rate = (h[i + 2] >> 2) & 3
        if version == 1 or layer == 0 or bitrate in (0, 15) or rate == 3:
            return 0
        if layer != 1:  # Layers I and II: one valid header is enough to be confident.
            return 4
        kbps = ([0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] if version == 3 else [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrate]
        hz = ([44100, 48000, 32000] if version == 3 else [22050, 24000, 16000] if version == 2 else [11025, 12000, 8000])[rate]
        return (144 if version == 3 else 72) * kbps * 1000 // hz + ((h[i + 2] >> 1) & 1)

    n = frame_len(0)
    if not n:
        return False
    return n == 4 or n >= len(h) - 4 or bool(frame_len(n))


def looks_like_text(h: bytes) -> bool:
    """Readable text in UTF-8 (or UTF-16 with a BOM, or mostly-printable Latin-1): no binary garbage."""
    if not h:
        return True  # An empty text file is still a text file; the tool itself says it's empty.
    if h.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            h[2 : len(h) - (len(h) % 2)].decode("utf-16-le" if h[:2] == b"\xff\xfe" else "utf-16-be")
            return True
        except UnicodeDecodeError:
            return False
    if b"\x00" in h:
        return False
    body = h[3:] if h.startswith(b"\xef\xbb\xbf") else h
    try:
        body[:-4].decode("utf-8") if len(body) == HEAD_BYTES else body.decode("utf-8")
        return True
    except UnicodeDecodeError:
        controls = sum(1 for b in body if b < 9 or 13 < b < 32)
        return controls / max(1, len(body)) < 0.01  # Latin-1 / Windows-1252 text


# ---------------------------------------------------------------------------
# What each extension must be
# ---------------------------------------------------------------------------

def _all(exts: str, *kinds: str) -> Dict[str, FrozenSet[str]]:
    return {("." + e.lstrip(".")).lower(): frozenset(kinds) for e in exts.split()}


EXT_KINDS: Dict[str, FrozenSet[str]] = {
    **_all("pdf", "pdf"),
    **_all("jpg jpeg jpe jfif", "jpeg"),
    **_all("png", "png"),
    **_all("gif", "gif"),
    **_all("webp", "webp"),
    **_all("bmp dib", "bmp"),
    **_all("tif tiff", "tiff"),
    **_all("ico", "ico", "png"),  # Single-image .ico files are sometimes plain PNGs.
    **_all("psd", "psd"),
    **_all("heic heif avif", "heif", "isobmff"),
    # Camera RAW: most are TIFF underneath.
    **_all("cr2 nef nrw arw sr2 srf dng pef 3fr kdc srw", "tiff"),
    **_all("raw", "tiff", "rw2", "orf"),
    **_all("orf", "orf", "tiff"),
    **_all("rw2", "rw2", "tiff"),
    **_all("raf", "raf"),
    **_all("crw", "crw"),
    **_all("cr3", "cr3", "isobmff"),
    **_all("mrw", "mrw"),
    **_all("x3f", "x3f"),
    **_all("svg", "svg"),
    # Audio and video
    **_all("mp4 m4a m4v mov qt 3gp 3g2", "isobmff"),
    **_all("mkv webm mka weba", "ebml"),
    **_all("avi", "avi"),
    **_all("wav wave", "wav"),
    **_all("mp3", "mp3", "aac"),
    **_all("aac", "aac", "mp3", "isobmff"),
    **_all("ogg oga ogv opus", "ogg"),
    **_all("flac", "flac", "mp3"),
    **_all("aif aiff aifc", "aiff"),
    **_all("amr", "amr"),
    **_all("wma wmv asf", "asf"),
    **_all("flv", "flv"),
    **_all("ac3", "ac3"),
    **_all("m2ts mts", "mpegts"),
    **_all("mpg mpeg mpe vob", "mpegps", "mpegts"),
    # Fonts
    **_all("ttf otf", "sfnt"),
    **_all("ttc otc", "ttc", "sfnt"),
    **_all("woff", "woff"),
    **_all("woff2", "woff2"),
    # Documents
    **_all("docx docm dotx dotm", "ooxml-word"),
    **_all("xlsx xlsm xltx xltm", "ooxml-xl"),
    **_all("pptx pptm ppsx potx", "ooxml-ppt"),
    **_all("odt ott", "odf-text"),
    **_all("ods ots", "odf-spreadsheet"),
    **_all("odp otp", "odf-presentation"),
    **_all("odg otg", "odf-graphics"),
    **_all("epub", "epub"),
    # Word also writes .doc files as RTF or HTML; old Office is OLE.
    **_all("doc dot", "ole", "rtf", "text"),
    **_all("xls ppt pps", "ole"),
    **_all("rtf", "rtf"),
    # Archives
    **_all("zip", "zip", "ooxml-word", "ooxml-xl", "ooxml-ppt", "odf-text", "odf-spreadsheet", "odf-presentation", "odf-graphics", "epub"),
    **_all("gz tgz tar.gz", "gzip"),
    **_all("tar.bz2 tbz tbz2", "bzip2"),
    **_all("tar.xz txz", "xz"),
    **_all("7z", "7z"),
    **_all("tar", "tar"),
    # Text: markup, data, subtitles, code. Read as text by the tools; never run.
    **_all(
        "txt text md markdown mdown mkd csv tsv tab html htm xhtml xml json jsonl ndjson yaml yml toml ini cfg conf properties env log "
        "srt vtt ass ssa tex latex rst adoc asciidoc org textile mediawiki wiki typ eml fb2 ipynb "
        "c cc cpp cxx h hh hpp hxx cs css less scss dart go java js mjs cjs jsx kt kts lua php ps1 py pyw r rb rs sh bash zsh sql swift tsx cts",
        "text",
    ),
    # .ts is TypeScript or an MPEG transport stream.
    **_all("ts", "text", "mpegts"),
}

FRIENDLY = {
    EXECUTABLE: "a program (executable)", "pdf": "a PDF", "jpeg": "a JPEG image", "png": "a PNG image", "gif": "a GIF", "webp": "a WebP image",
    "zip": "a ZIP archive", "ole": "an old-style Office file", "text": "plain text", "isobmff": "an MP4/MOV media file", "ebml": "a Matroska/WebM media file",
    "mp3": "MP3 audio", "wav": "WAV audio", "sfnt": "a font", "heif": "a HEIC/AVIF image", "tiff": "a TIFF image", "rtf": "an RTF document",
    "ooxml-word": "a Word document", "ooxml-xl": "an Excel workbook", "ooxml-ppt": "a PowerPoint deck", "epub": "an EPUB book", "gzip": "a gzip archive",
    "rar": "a RAR archive", "7z": "a 7-Zip archive", "svg": "an SVG", "html": "HTML",
}


def _ext(filename: str) -> str:
    name = PurePath(filename or "").name.lower()
    for double in (".tar.gz", ".tar.bz2", ".tar.xz"):
        if name.endswith(double):
            return double
    return PurePath(name).suffix


def _zip_kind(f: BinaryIO) -> str:
    """Which ZIP-based format this is, from its directory (a few KB at the end of the file)."""
    try:
        with zipfile.ZipFile(f) as z:
            names = z.namelist()
            if "mimetype" in names:
                mt = z.read("mimetype")[:100].decode("ascii", "replace").strip()
                if mt == "application/epub+zip":
                    return "epub"
                for kind in ("text", "spreadsheet", "presentation", "graphics"):
                    if mt.startswith(f"application/vnd.oasis.opendocument.{kind}"):
                        return f"odf-{kind}"
            if "[Content_Types].xml" in names:
                for prefix, kind in (("word/", "ooxml-word"), ("xl/", "ooxml-xl"), ("ppt/", "ooxml-ppt")):
                    if any(n.startswith(prefix) for n in names):
                        return kind
            return "zip"
    except (zipfile.BadZipFile, OSError, ValueError, EOFError):
        return "broken-zip"


def identify(f: BinaryIO) -> Optional[str]:
    """Reads the start of `f` (and a ZIP's directory) and rewinds it."""
    f.seek(0)
    head = f.read(HEAD_BYTES)
    f.seek(0)
    kind = detect(head)
    if kind == "zip":
        kind = _zip_kind(f)
        f.seek(0)
    elif kind == "text":
        low = head.lower()
        if b"<svg" in low:
            kind = "svg-or-text"
    return kind


def check_upload(upload: UploadFile, allowed_exts: Iterable[str]) -> None:
    """Raises UnsupportedFileError unless the file's name and its bytes agree with this endpoint."""
    name = upload.filename or ""
    ext = _ext(name)
    allowed = set(allowed_exts)
    shown = PurePath(name).name or "the file"
    if not ext or ext not in allowed:
        if not ext:
            raise UnsupportedFileError(f"“{shown}” has no file extension, so its type can't be checked. Rename it with the right extension (for example .pdf).")
        if len(allowed) > 20:
            raise UnsupportedFileError(f"{ext.lstrip('.').upper()} files aren't supported here.")
        nice = ", ".join(sorted(e.lstrip(".").upper() for e in allowed))
        raise UnsupportedFileError(f"“{shown}” isn't a file type this tool takes. It accepts: {nice}.")
    expected = EXT_KINDS.get(ext)
    kind = identify(upload.file)
    if expected is None:
        # An extension a tool lists but this guard has no rule for: never accept programs or junk.
        ok = kind not in (EXECUTABLE, None)
    elif kind == "svg-or-text":
        ok = "svg" in expected or "text" in expected
    else:
        ok = kind in expected
    if not ok:
        what = FRIENDLY.get(kind or "", "something else") if kind != "broken-zip" else "a damaged or incomplete file"
        logger.warning("Upload refused: %r claims %s but is %s", shown, ext, kind)
        if kind is None:
            raise UnsupportedFileError(f"“{shown}” doesn't look like a real {ext.lstrip('.').upper()} file. It may be damaged, or renamed from another type.")
        raise UnsupportedFileError(f"“{shown}” is named {ext.lstrip('.').upper()}, but it's actually {what}. Upload the real file.")
    if ext == ".svg" and kind != "svg-or-text":
        raise UnsupportedFileError(f"“{shown}” doesn't contain an SVG drawing.")


# ---------------------------------------------------------------------------
# Which files each endpoint takes (relative to /api/v1)
# ---------------------------------------------------------------------------

def _policies() -> Dict[str, FrozenSet[str]]:
    # The services' own lists, so the guard and the tools can't drift apart.
    from app.services.fonts import DOC_EXTS, FONT_EXTS
    from app.services.icon import PICTURES
    from app.services.image import ALL_INPUTS, TOOL_INPUTS
    from app.services.pdf_tools import IMAGE_EXTENSIONS
    from app.services.qrcode import QRCodeService
    from app.services.transcribe import ALLOWED_EXTENSIONS as MEDIA
    from app.services.universal import formats as universal_formats

    pdf = frozenset({".pdf"})
    pictures = frozenset(IMAGE_EXTENSIONS)
    html = frozenset({".html", ".htm"})
    # Anything the converter, compressor, merger or colour picker can read.
    anything = frozenset(universal_formats._BY_EXT) | ALL_INPUTS | FONT_EXTS | DOC_EXTS
    p: Dict[str, FrozenSet[str]] = {
        "/pdf/watermark": pdf | {".png", ".jpg", ".jpeg", ".webp"},
        "/pdf/edit": pdf | pictures,
        "/pdf/from-images": pictures,
        "/convert/html-to-pdf": html,
        "/qrcode/generate-with-logo": frozenset(QRCodeService.ALLOWED_LOGO_EXTENSIONS),
        "/transcribe": frozenset(MEDIA),
        "/image/watermark": frozenset(TOOL_INPUTS["watermark"] | TOOL_INPUTS["mark"]),
        "/image/faces": frozenset(TOOL_INPUTS["blur"]),
        "/image/remove-background": frozenset(TOOL_INPUTS["background"]),
        "/image/html": html,
        "/icon": frozenset(PICTURES),
        "/fonts/inspect": frozenset(FONT_EXTS),
        "/fonts/document": frozenset(DOC_EXTS),
        "/universal/convert": anything,
        "/compress": anything,
        "/merge-split/inspect": anything,
        "/merge-split/split": anything,
        "/merge-split/merge": anything,
        "/palette/extract": anything,
        "/media/trim": frozenset(MEDIA),
        "/media/sound": frozenset(MEDIA),
        "/media/denoise": frozenset(MEDIA),
    }
    for tool in ("compress", "resize", "crop", "convert", "gif", "rotate", "blur", "upscale"):
        p[f"/image/{tool}"] = frozenset(TOOL_INPUTS[tool])
    for name in ("upload", "merge", "split", "organize", "compress", "page-numbers", "crop", "redact", "protect", "unlock", "repair", "ocr", "pdfa"):
        p[f"/pdf/{name}"] = pdf
    return p


_POLICIES: Optional[Dict[str, FrozenSet[str]]] = None


def policy_for(path: str) -> FrozenSet[str]:
    global _POLICIES
    if _POLICIES is None:
        _POLICIES = _policies()
    rel = path[len(app_settings.API_V1_PREFIX):] if path.startswith(app_settings.API_V1_PREFIX) else path
    rel = rel.rstrip("/") or "/"
    found = _POLICIES.get(rel)
    if found is None:
        # A new upload endpoint nobody listed: refuse files rather than accept anything.
        logger.error("Upload to %s, which has no file policy in app/core/file_guard.py", rel)
        raise UnsupportedFileError("This endpoint doesn't accept files.")
    return found


async def guard_uploads(request: Request) -> None:
    """Router-wide dependency: checks every uploaded file before the endpoint runs."""
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        return
    form = await request.form()  # Parsed once; FastAPI reuses this same form for the endpoint.
    uploads = [v for _, v in form.multi_items() if isinstance(v, UploadFile)]
    if not uploads:
        return
    allowed = policy_for(request.url.path)
    for upload in uploads:
        if upload.filename == "" and upload.size == 0:
            continue  # An optional file field left empty.
        check_upload(upload, allowed)
