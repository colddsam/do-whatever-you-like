"""
One compressor per kind of file. Each takes (source, output folder, level, display name) and returns
(result path, note). Levels: light (no visible change), recommended (the sensible default),
strong (smallest, some loss). Formats keep their type where they can; where a format can't get
smaller in place (BMP, WAV…) it becomes the closest format that can, and the note says so.
"""

import gzip
import io
import json
import logging
import shutil
import tarfile
import zipfile
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple

from app.config.compress import settings
from app.exceptions.compress import CompressProcessingError, CompressUnavailableError, InvalidCompressInputError

logger = logging.getLogger(__name__)

Result = Tuple[Path, Optional[str]]

PDF = {".pdf"}
WEB_IMAGES = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
OTHER_IMAGES = {".heic", ".heif", ".avif", ".tif", ".tiff", ".bmp", ".psd", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf", ".ico"}
OFFICE = {".docx", ".docm", ".dotx", ".xlsx", ".xlsm", ".pptx", ".pptm", ".ppsx", ".odt", ".ods", ".odp", ".odg", ".epub", ".vsdx"}
AUDIO = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".weba", ".wma", ".wav", ".aiff", ".aif", ".flac"}
VIDEO = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".wmv", ".flv", ".webm", ".3gp", ".mpeg", ".mpg", ".mts", ".m2ts", ".ogv"}
FONTS = {".ttf", ".otf", ".woff"}
ARCHIVES = {".zip", ".gz", ".tgz", ".tar"}
JSON = {".json", ".geojson", ".webmanifest"}
# Already compressed as tightly as their format allows: re-zipping them gains nothing.
DENSE = {".7z", ".rar", ".xz", ".bz2", ".zst", ".br", ".woff2", ".apk", ".jar", ".dmg", ".iso", ".amr", ".jxl"}

PDF_STRENGTH = {"light": 25, "recommended": 50, "strong": 75}
JPEG_Q = {"light": 85, "recommended": 75, "strong": 60}
MAX_SIDE = {"light": 3000, "recommended": 2000, "strong": 1400}


def kind_of(name: str) -> str:
    ext = Path(name).suffix.lower()
    if name.lower().endswith((".tar.gz", ".tar.bz2", ".tar.xz")):
        return "archive" if name.lower().endswith(".tar.gz") else "dense"
    for kind, exts in (("pdf", PDF), ("image", WEB_IMAGES), ("photo", OTHER_IMAGES), ("office", OFFICE), ("audio", AUDIO),
                       ("video", VIDEO), ("font", FONTS), ("archive", ARCHIVES), ("json", JSON), ("dense", DENSE)):
        if ext in exts:
            return kind
    return "other"


# ---------- documents ----------


def pdf(src: Path, out_dir: Path, level: str, name: str) -> Result:
    from app.services.pdf import pdf_service

    out = out_dir / name
    pdf_service.compress_pdf(src, out, PDF_STRENGTH[level], name)
    return out, None


def office(src: Path, out_dir: Path, level: str, name: str) -> Result:
    """
    Office files, OpenDocument and EPUB are ZIPs of XML and pictures: the pictures are re-encoded
    (and big ones scaled down) in their own format, everything is re-zipped at full strength, and the
    preview thumbnail is dropped. Names stay the same, so every link inside keeps working.
    """
    from PIL import Image, ImageOps

    out = out_dir / name
    try:
        zin = zipfile.ZipFile(src)
    except zipfile.BadZipFile:
        raise InvalidCompressInputError(f"'{name}' isn't a valid {Path(name).suffix.upper()[1:]} file. It may be damaged or password-protected.")
    infos = zin.infolist()
    if len(infos) > settings.ZIP_MAX_ENTRIES or sum(i.file_size for i in infos) > settings.ZIP_MAX_UNPACKED_MB * 1024 * 1024:
        raise InvalidCompressInputError(f"'{name}' unpacks to more than this server can handle.")
    if any(i.flag_bits & 0x1 for i in infos):
        raise InvalidCompressInputError(f"'{name}' is encrypted. Remove its password first.")
    shrunk = 0
    with zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
        for info in infos:
            data = zin.read(info)
            lower = info.filename.lower()
            if lower in ("docprops/thumbnail.jpeg", "docprops/thumbnail.jpg", "thumbnails/thumbnail.png") and level != "light":
                data = _tiny_png() if lower.endswith(".png") else _tiny_jpeg()
            elif lower.rsplit(".", 1)[-1] in ("jpg", "jpeg", "png") and len(data) > 30_000:
                try:
                    img = Image.open(io.BytesIO(data))
                    img.load()
                    fmt = img.format
                    if max(img.size) > MAX_SIDE[level]:
                        img = ImageOps.contain(img, (MAX_SIDE[level], MAX_SIDE[level]), Image.Resampling.LANCZOS)
                    buf = io.BytesIO()
                    if fmt == "JPEG":
                        img.convert("RGB").save(buf, "JPEG", quality=JPEG_Q[level], optimize=True, progressive=True)
                    elif fmt == "PNG":
                        if level == "strong" and img.mode in ("RGB", "RGBA"):
                            img = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
                        img.save(buf, "PNG", optimize=True)
                    if fmt in ("JPEG", "PNG") and 0 < buf.tell() < len(data):
                        shrunk += 1
                        data = buf.getvalue()
                except Exception:
                    pass  # A picture we can't re-encode stays as it was.
            # ODF and EPUB readers need "mimetype" first and stored, not compressed.
            if info.filename == "mimetype":
                zout.writestr(info, data, compress_type=zipfile.ZIP_STORED)
            else:
                zout.writestr(_entry(info), data)
    return out, f"{shrunk} picture{'s' if shrunk != 1 else ''} made smaller." if shrunk else None


def _entry(info: zipfile.ZipInfo) -> zipfile.ZipInfo:
    e = zipfile.ZipInfo(info.filename, date_time=info.date_time)
    e.compress_type = zipfile.ZIP_DEFLATED
    e.external_attr = info.external_attr
    return e


def _tiny_jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, "JPEG", quality=50)
    return buf.getvalue()


def _tiny_png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, "PNG")
    return buf.getvalue()


# ---------- pictures ----------


def image(src: Path, out_dir: Path, level: str, name: str) -> Result:
    """JPG, PNG, GIF, WebP and SVG: the Compress image tool's own engine."""
    from app.services.image import image_service

    result = image_service.compress([(str(src), name)], str(out_dir), level, False)
    entry = result["files"][0]
    return out_dir / entry["name"], None


def photo(src: Path, out_dir: Path, level: str, name: str) -> Result:
    """HEIC, AVIF and TIFF keep their format; BMP, PSD, ICO and camera RAW can't shrink in place and become JPG or PNG."""
    from PIL import Image, ImageOps

    from app.services.image import open_image

    ext = Path(name).suffix.lower()
    img = open_image(src, name)
    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    img = ImageOps.exif_transpose(img) if ext not in (".dng", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf") else img
    if max(img.size) > MAX_SIDE[level] and level != "light":
        img = ImageOps.contain(img, (MAX_SIDE[level], MAX_SIDE[level]), Image.Resampling.LANCZOS)
    alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    stem = Path(name).stem
    q = JPEG_Q[level]
    if ext in (".heic", ".heif"):
        from pillow_heif import register_heif_opener

        register_heif_opener()
        out = out_dir / f"{stem}{ext}"
        img.save(out, format="HEIF", quality=q - 5)
        return out, None
    if ext == ".avif":
        out = out_dir / f"{stem}.avif"
        img.save(out, format="AVIF", quality=q - 10)
        return out, None
    if ext in (".tif", ".tiff"):
        out = out_dir / f"{stem}{ext}"
        if level == "light" or alpha:
            img.save(out, format="TIFF", compression="tiff_adobe_deflate")
        else:
            img.convert("RGB").save(out, format="TIFF", compression="jpeg", quality=q)
        return out, None
    if ext == ".ico":
        out = out_dir / f"{stem}.ico"
        sizes = sorted({s for s in getattr(img, "info", {}).get("sizes", set())} or {(img.width, img.height)})
        img.convert("RGBA").save(out, format="ICO", sizes=sizes)
        return out, None
    if alpha or level == "light" and ext == ".bmp":
        out = out_dir / f"{stem}.png"
        img.save(out, format="PNG", optimize=True)
        return out, f"{ext.upper()[1:]} can't be compressed, so it was saved as PNG (no quality lost)."
    out = out_dir / f"{stem}.jpg"
    img.convert("RGB").save(out, format="JPEG", quality=q, optimize=True, progressive=True)
    return out, f"{ext.upper()[1:]} can't be compressed, so it was saved as JPG."


# ---------- sound and video ----------

# Target bitrate in kbps by level, for formats that keep their codec.
LOSSY = {
    ".mp3": ("mp3", ["-c:a", "libmp3lame"], {"light": 160, "recommended": 128, "strong": 96}),
    ".m4a": ("m4a", ["-c:a", "aac", "-movflags", "+faststart"], {"light": 160, "recommended": 128, "strong": 96}),
    ".aac": ("aac", ["-c:a", "aac", "-f", "adts"], {"light": 160, "recommended": 128, "strong": 96}),
    ".ogg": ("ogg", ["-c:a", "libvorbis"], {"light": 160, "recommended": 112, "strong": 80}),
    ".oga": ("oga", ["-c:a", "libvorbis", "-f", "ogg"], {"light": 160, "recommended": 112, "strong": 80}),
    ".opus": ("opus", ["-c:a", "libopus"], {"light": 128, "recommended": 96, "strong": 64}),
    ".weba": ("weba", ["-c:a", "libopus", "-f", "webm"], {"light": 128, "recommended": 96, "strong": 64}),
    ".wma": ("wma", ["-c:a", "wmav2"], {"light": 160, "recommended": 128, "strong": 96}),
}


def audio(src: Path, out_dir: Path, level: str, name: str) -> Result:
    from app.services.universal.engines.media import LOCAL_ONLY, probe

    ext = Path(name).suffix.lower()
    info = probe(src)
    if not info["audio"]:
        raise InvalidCompressInputError(f"'{name}' has no sound.")
    if info["duration"] > settings.AUDIO_MAX_SECONDS:
        raise InvalidCompressInputError(f"Audio up to {settings.AUDIO_MAX_SECONDS // 3600} hours can be compressed.")
    stem = Path(name).stem
    base = [*LOCAL_ONLY, "-i", str(src), "-map", "0:a:0", "-vn", "-map_metadata", "0"]
    if ext in LOSSY:
        fmt, codec, rates = LOSSY[ext]
        kbps = rates[level]
        current = (info["audio_bitrate"] or info["bitrate"]) // 1000
        if current and current <= kbps + 8:
            raise _AlreadySmall(f"It's already {current} kbps; going lower would hurt the sound for little gain.")
        out = out_dir / f"{stem}.{fmt}"
        _ffmpeg(base + codec + ["-b:a", f"{kbps}k", str(out)], "Compressing the sound")
        return out, f"Re-encoded at {kbps} kbps."
    # WAV, AIFF and FLAC: lossless FLAC first; smaller choices trade a little quality for much less space.
    if level == "light":
        out = out_dir / f"{stem}.flac"
        _ffmpeg(base + ["-c:a", "flac", "-compression_level", "12", str(out)], "Compressing the sound")
        return out, None if ext == ".flac" else "Saved as FLAC: the exact same sound, in less space."
    kbps = 192 if level == "recommended" else 128
    out = out_dir / f"{stem}.mp3"
    _ffmpeg(base + ["-c:a", "libmp3lame", "-b:a", f"{kbps}k", str(out)], "Compressing the sound")
    return out, f"{ext.upper()[1:]} holds sound uncompressed, so it was saved as a {kbps} kbps MP3."


VIDEO_CRF = {"light": 24, "recommended": 28, "strong": 32}
VIDEO_HEIGHT = {"light": 0, "recommended": 1080, "strong": 720}
VIDEO_AUDIO = {"light": 128, "recommended": 96, "strong": 64}


def video(src: Path, out_dir: Path, level: str, name: str) -> Result:
    from app.services.universal.engines.media import LOCAL_ONLY, probe

    info = probe(src)
    if not info["video"]:
        raise InvalidCompressInputError(f"'{name}' has no picture. Compress it as audio instead.")
    if info["duration"] > settings.VIDEO_MAX_SECONDS:
        raise InvalidCompressInputError(f"Videos up to {settings.VIDEO_MAX_SECONDS // 60} minutes can be compressed on this server.")
    ext = Path(name).suffix.lower()
    container = "mkv" if ext == ".mkv" else "mp4"
    out = out_dir / f"{Path(name).stem}.{container}"
    height = VIDEO_HEIGHT[level]
    scale = f"scale=-2:'min({height},ih)'" if height and info["height"] > height else "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    args = [*LOCAL_ONLY, "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "0",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", str(VIDEO_CRF[level]), "-pix_fmt", "yuv420p", "-vf", scale,
            "-c:a", "aac", "-b:a", f"{VIDEO_AUDIO[level]}k"]
    if container == "mp4":
        args += ["-movflags", "+faststart"]
    _ffmpeg(args + [str(out)], "Compressing the video")
    note = f"Re-encoded as H.264{f', at most {height}p' if height and info['height'] > height else ''}."
    if ext not in (".mp4", ".mkv"):
        note += f" Saved as MP4, which plays everywhere and is far smaller than {ext.upper()[1:]}."
    return out, note


def _ffmpeg(args, what: str) -> None:
    from app.services.universal.engines.common import run, tail
    from app.services.universal.graph import ffmpeg_path

    ff = ffmpeg_path()
    if not ff:
        raise CompressUnavailableError("Audio and video compression isn't available on this server yet.")
    proc = run([ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], settings.TIMEOUT_SECONDS - 30, what=what)
    if proc.returncode != 0:
        logger.error("ffmpeg failed: %s", tail(proc.stderr))
        raise CompressProcessingError(f"{what} failed. The file may be damaged.")


# ---------- everything else ----------


def font(src: Path, out_dir: Path, level: str, name: str) -> Result:
    from fontTools.ttLib import TTFont

    try:
        f = TTFont(str(src), recalcTimestamp=False)
    except Exception:
        raise InvalidCompressInputError(f"'{name}' couldn't be read as a font.")
    out = out_dir / f"{Path(name).stem}.woff2"
    f.flavor = "woff2"
    f.save(str(out))
    f.close()
    return out, "Saved as WOFF2, the compressed font format every browser reads. Desktop apps still need the original."


def archive(src: Path, out_dir: Path, level: str, name: str) -> Result:
    lower = name.lower()
    out = out_dir / name
    if lower.endswith(".zip"):
        try:
            zin = zipfile.ZipFile(src)
        except zipfile.BadZipFile:
            raise InvalidCompressInputError(f"'{name}' isn't a valid ZIP.")
        infos = zin.infolist()
        if len(infos) > settings.ZIP_MAX_ENTRIES or sum(i.file_size for i in infos) > settings.ZIP_MAX_UNPACKED_MB * 1024 * 1024:
            raise InvalidCompressInputError(f"'{name}' unpacks to more than this server can handle.")
        if any(i.flag_bits & 0x1 for i in infos):
            raise InvalidCompressInputError(f"'{name}' is password-protected, so it can't be repacked.")
        with zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
            for info in infos:
                with zin.open(info) as fin, zout.open(_entry(info), "w") as fout:
                    shutil.copyfileobj(fin, fout, 1024 * 256)
        return out, "Repacked at the strongest ZIP setting."
    if lower.endswith((".gz", ".tgz")):
        limit = settings.ZIP_MAX_UNPACKED_MB * 1024 * 1024
        with gzip.open(src, "rb") as fin, gzip.open(out, "wb", compresslevel=9) as fout:
            copied = 0
            while chunk := fin.read(1024 * 256):
                copied += len(chunk)
                if copied > limit:
                    raise InvalidCompressInputError(f"'{name}' unpacks to more than this server can handle.")
                fout.write(chunk)
        return out, "Repacked at the strongest gzip setting."
    # A plain .tar isn't compressed at all: gzip it (keeps every file, opens anywhere).
    out = out_dir / f"{name}.gz"
    try:
        tarfile.open(src).close()
    except tarfile.TarError:
        raise InvalidCompressInputError(f"'{name}' isn't a valid TAR file.")
    with open(src, "rb") as fin, gzip.open(out, "wb", compresslevel=9) as fout:
        shutil.copyfileobj(fin, fout, 1024 * 256)
    return out, "TAR files aren't compressed, so it was gzipped (.tar.gz)."


def minify_json(src: Path, out_dir: Path, level: str, name: str) -> Result:
    try:
        data = json.loads(src.read_bytes().decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        return zipped(src, out_dir, level, name)
    out = out_dir / name
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out, "Spaces and line breaks removed; the data is identical."


def zipped(src: Path, out_dir: Path, level: str, name: str) -> Result:
    """Anything else: a ZIP at full strength (opens on every computer without extra software)."""
    out = out_dir / f"{name}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        zf.write(src, arcname=name)
    return out, "Packed into a ZIP. Unzip it to get the file back exactly."


def dense(src: Path, out_dir: Path, level: str, name: str) -> Result:
    raise _AlreadySmall(f"{Path(name).suffix.upper()[1:] or 'This'} files are already compressed as far as they go.")


class _AlreadySmall(Exception):
    """Nothing to gain: the original is sent back, with the reason."""


ENGINES: Dict[str, Callable[[Path, Path, str, str], Result]] = {
    "pdf": pdf,
    "image": image,
    "photo": photo,
    "office": office,
    "audio": audio,
    "video": video,
    "font": font,
    "archive": archive,
    "json": minify_json,
    "dense": dense,
    "other": zipped,
}
AlreadySmall = _AlreadySmall
