"""
Image tools: compress, resize, crop, convert, animated GIF, rotate, watermark, blur, plus the AI tools
(background removal, upscaling, face detection) in image_ai.py and web page capture (html_to_image).

Everything except web capture runs in the PDF process pool (`run_pdf("image.<method>", ...)`), so
decoding a 50-megapixel photo never blocks a web worker. Methods take paths and plain options (they
are pickled across processes) and write their results into `out_dir`.

Every image is opened "as seen": EXIF orientation is applied first, so crop boxes, blur areas and
rotations match what people saw in their browser.
"""

import json
import logging
import math
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageSequence, UnidentifiedImageError

from app.config.image import settings
from app.exceptions.image import ImageProcessingError, ImageToolUnavailableError, InvalidImageError

logger = logging.getLogger(__name__)

Image.MAX_IMAGE_PIXELS = settings.MAX_PIXELS

RASTER = {".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico", ".psd", ".avif"}
HEIC = {".heic", ".heif"}
RAW = {".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".rw2", ".orf", ".pef", ".raf", ".dng", ".raw", ".srw", ".3fr", ".kdc", ".mrw", ".x3f"}
SVG = {".svg"}
ALL_INPUTS = RASTER | HEIC | RAW | SVG

# What each tool accepts (the frontend mirrors these in lib/image.ts).
WEB_FORMATS = {".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp"}
TOOL_INPUTS: Dict[str, set] = {
    "compress": WEB_FORMATS | SVG,
    "resize": WEB_FORMATS | SVG | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
    "crop": WEB_FORMATS | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
    "rotate": WEB_FORMATS | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
    "convert": ALL_INPUTS,
    "gif": WEB_FORMATS | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
    "watermark": WEB_FORMATS | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
    "mark": {".png", ".jpg", ".jpeg", ".webp", ".gif"},
    "blur": WEB_FORMATS | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
    "background": WEB_FORMATS | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
    "upscale": WEB_FORMATS | {".bmp", ".tif", ".tiff", ".avif"} | HEIC,
}

SAVE_FORMATS = {"jpg": ("JPEG", ".jpg"), "png": ("PNG", ".png"), "webp": ("WEBP", ".webp"), "gif": ("GIF", ".gif")}
EXT_FORMAT = {".jpg": "jpg", ".jpeg": "jpg", ".jfif": "jpg", ".png": "png", ".webp": "webp", ".gif": "gif"}

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONTS = {"sans": "NotoSans.ttf", "serif": "NotoSerif.ttf", "mono": "NotoSansMono.ttf", "impact": "Anton.ttf", "hand": "Caveat.ttf"}
SCRIPT_FONTS = [((0x0900, 0x097F), "NotoSansDevanagari.ttf"), ((0x0980, 0x09FF), "NotoSansBengali.ttf")]

_heif_ready = False


def _readable(name: str) -> str:
    return name if len(name) <= 60 else name[:57] + "…"


# ---------------------------------------------------------------------------------------------
# Reading and writing
# ---------------------------------------------------------------------------------------------


def sanitize_svg(text: str) -> str:
    """
    SVGs are rendered on the server, so they may only use what's inside them: references to files or
    web addresses are removed (an SVG could otherwise pull a file off the server into its picture),
    and so are scripts and DOCTYPEs (entity expansion).
    """
    text = re.sub(r"<!DOCTYPE[^>[]*(\[[^\]]*\])?\s*>", "", text, flags=re.I | re.S)
    text = re.sub(r"<script\b.*?</script\s*>", "", text, flags=re.I | re.S)
    text = re.sub(r"""\s(?:xlink:)?href\s*=\s*(["'])(?!data:|#)[^"']*\1""", " ", text, flags=re.I)
    text = re.sub(r"""url\(\s*(["']?)(?!data:|#)[^)]*\1\s*\)""", "none", text, flags=re.I)
    return text


def _svg_size(text: str) -> Tuple[Optional[float], Optional[float], Optional[Tuple[float, ...]]]:
    root = re.search(r"<svg\b[^>]*>", text, flags=re.I | re.S)
    if not root:
        raise InvalidImageError("That SVG has no <svg> element.")
    tag = root.group(0)

    def length(attr: str) -> Optional[float]:
        m = re.search(rf"\s{attr}\s*=\s*[\"']\s*([\d.]+)\s*(px)?\s*[\"']", tag)
        return float(m.group(1)) if m else None

    vb = re.search(r"viewBox\s*=\s*[\"']([^\"']+)[\"']", tag)
    box = tuple(float(v) for v in re.split(r"[\s,]+", vb.group(1).strip())) if vb else None
    return length("width"), length("height"), box if box and len(box) == 4 else None


_PX_PER_UNIT = {"mm": 96 / 25.4, "cm": 96 / 2.54, "in": 96.0, "pt": 96 / 72, "pc": 16.0, "px": 1.0}


def _root_size_in_px(text: str) -> str:
    """
    resvg refuses a root width/height in physical units ("52.92mm", which LibreOffice and Inkscape
    write), so they become pixels at 96 dpi. Percentages are dropped and the viewBox decides.
    """
    root = re.search(r"<svg\b[^>]*>", text, flags=re.I | re.S)
    if not root:
        return text

    def fix(m: "re.Match[str]") -> str:
        value, unit = float(m.group(3)), (m.group(4) or "px").lower()
        if unit == "%":
            return ""
        return f' {m.group(1)}={m.group(2)}{value * _PX_PER_UNIT[unit]:.3f}{m.group(2)}'

    tag = re.sub(r"""\s(width|height)\s*=\s*(["'])\s*([\d.]+)\s*(mm|cm|in|pt|pc|px|%)?\s*\2""", fix, root.group(0), flags=re.I)
    return text[: root.start()] + tag + text[root.end() :]


def _render_svg(path: Path, name: str, width: Optional[int] = None) -> Image.Image:
    try:
        import resvg_py
    except ImportError:
        raise ImageToolUnavailableError("SVG images can't be read on this server yet.")
    text = _root_size_in_px(sanitize_svg(path.read_text(encoding="utf-8", errors="replace")))
    w, h, box = _svg_size(text)
    natural_w = w or (box[2] if box else 1024)
    natural_h = h or (box[3] if box else natural_w)
    target_w = width or int(round(natural_w))
    target_h = int(round(target_w * natural_h / natural_w)) if natural_w else target_w
    if target_w * target_h > settings.MAX_PIXELS:
        raise InvalidImageError(f"{name} would be too large as a picture.")
    import tempfile

    try:
        # References were stripped above; an empty folder as the base makes sure nothing else resolves.
        with tempfile.TemporaryDirectory(prefix="svg_") as empty:
            data = resvg_py.svg_to_bytes(svg_string=text, width=target_w, height=target_h, font_dirs=[str(FONT_DIR)], resources_dir=empty)
    except Exception as exc:
        logger.error("resvg failed on %s: %s", path.name, exc)
        raise InvalidImageError(f"We couldn't draw {name}. Is it a working SVG?")
    import io

    return Image.open(io.BytesIO(bytes(data))).convert("RGBA")


def _render_raw(path: Path, name: str) -> Image.Image:
    try:
        import rawpy
    except ImportError:
        raise ImageToolUnavailableError("Camera RAW photos can't be read on this server yet.")
    try:
        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, output_bps=8, no_auto_bright=False)
    except Exception as exc:
        logger.error("rawpy failed on %s: %s", path.name, exc)
        raise InvalidImageError(f"We couldn't develop {name}. Is it a camera RAW file?")
    return Image.fromarray(rgb)


def open_image(path: Path, display_name: Optional[str] = None) -> Image.Image:
    """Opens any supported image. Animated images stay animated; still ones come back upright."""
    global _heif_ready
    name = _readable(display_name or path.name)
    ext = path.suffix.lower()
    if ext in SVG:
        return _render_svg(path, name)
    if ext in RAW:
        return _render_raw(path, name)
    if ext in HEIC and not _heif_ready:
        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
            _heif_ready = True
        except ImportError:
            raise ImageToolUnavailableError("HEIC photos can't be read on this server yet.")
    try:
        img = Image.open(path)
        if img.width * img.height > settings.MAX_PIXELS:
            raise InvalidImageError(
                f"{name} is {img.width * img.height / 1e6:.0f} megapixels. The limit is {settings.MAX_PIXELS / 1e6:.0f}."
            )
        if not _animated(img):
            img = ImageOps.exif_transpose(img)
            img.load()
        return img
    except InvalidImageError:
        raise
    except Image.DecompressionBombError:
        raise InvalidImageError(f"{name} is too large to open. The limit is {settings.MAX_PIXELS / 1e6:.0f} megapixels.")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        logger.info("Couldn't open %s: %s", path.name, exc)
        raise InvalidImageError(f"We couldn't read {name}. Is it a working image?")


def _animated(img: Image.Image) -> bool:
    return bool(getattr(img, "is_animated", False)) and getattr(img, "n_frames", 1) > 1


def _frames(img: Image.Image) -> Tuple[List[Image.Image], List[int], int]:
    """All frames as full RGBA pictures, their durations (ms) and the loop count."""
    frames, durations = [], []
    for frame in ImageSequence.Iterator(img):
        durations.append(int(frame.info.get("duration", img.info.get("duration", 100)) or 100))
        frames.append(frame.convert("RGBA"))
    return frames, durations, int(img.info.get("loop", 0))


def _flatten(img: Image.Image, background: Tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        base = Image.new("RGB", rgba.size, background)
        base.paste(rgba, mask=rgba.getchannel("A"))
        return base
    return img.convert("RGB")


def _hex(color: str) -> Tuple[int, int, int]:
    color = (color or "#ffffff").lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", color):
        raise InvalidImageError("Colours look like #ff8800.")
    return tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def save_image(
    img: Image.Image,
    path: Path,
    fmt: str,
    *,
    quality: int = 92,
    source: Optional[Image.Image] = None,
    keep_exif: bool = True,
    background: Tuple[int, int, int] = (255, 255, 255),
    subsampling: Optional[int] = None,
) -> Path:
    """Writes a still image, keeping the colour profile (and EXIF, with orientation reset)."""
    params: Dict[str, Any] = {}
    info = (source or img).info
    if info.get("icc_profile"):
        params["icc_profile"] = info["icc_profile"]
    if keep_exif and source is not None:
        exif = source.getexif()
        if exif:
            exif[0x0112] = 1  # Already upright.
            params["exif"] = exif.tobytes()
    try:
        if fmt == "jpg":
            out = _flatten(img, background)
            params.update(quality=quality, optimize=True, progressive=True)
            if subsampling is not None:
                params["subsampling"] = subsampling
            out.save(path, "JPEG", **params)
        elif fmt == "png":
            out = img if img.mode in ("RGB", "RGBA", "L", "LA", "P", "1", "I;16") else img.convert("RGBA")
            out.save(path, "PNG", optimize=True, **params)
        elif fmt == "webp":
            out = img.convert("RGBA") if img.mode not in ("RGB", "RGBA") else img
            out.save(path, "WEBP", quality=quality, method=5, **params)
        elif fmt == "gif":
            out = img.convert("RGBA")
            alpha = out.getchannel("A")
            pal = _flatten(out, background).quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
            if alpha.getextrema()[0] < 128:
                # Keep transparency: reserve the last palette slot for "see-through".
                pal = _flatten(out, background).quantize(255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
                mask = alpha.point(lambda a: 255 if a < 128 else 0)
                pal.paste(255, mask=mask)
                pal.save(path, "GIF", transparency=255, optimize=True)
            else:
                pal.save(path, "GIF", optimize=True)
        else:
            raise InvalidImageError("Pick JPG, PNG, WebP or GIF.")
    except InvalidImageError:
        raise
    except Exception as exc:
        logger.error("Saving %s failed: %s", path.name, exc)
        raise ImageProcessingError("The image couldn't be saved.")
    return path


def save_animation(frames: List[Image.Image], durations: List[int], loop: Optional[int], path: Path, fmt: str, *, quality: int = 85, colors: int = 256) -> Path:
    if fmt == "webp":
        frames[0].save(path, "WEBP", save_all=True, append_images=frames[1:], duration=durations, loop=loop or 0, quality=quality, method=4)
        return path
    pal = []
    for f in frames:
        rgba = f.convert("RGBA")
        alpha = rgba.getchannel("A")
        q = _flatten(rgba).quantize(colors - 1, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
        if alpha.getextrema()[0] < 128:
            q.paste(colors - 1, mask=alpha.point(lambda a: 255 if a < 128 else 0))
        pal.append(q)
    params: Dict[str, Any] = {"save_all": True, "append_images": pal[1:], "duration": durations, "disposal": 2, "optimize": False}
    if loop is not None:
        params["loop"] = loop
    if any(f.convert("RGBA").getchannel("A").getextrema()[0] < 128 for f in frames):
        params["transparency"] = colors - 1
    pal[0].save(path, "GIF", **params)
    return path


def _output_format(src: Path, img: Image.Image) -> str:
    """Formats the browser can show stay as they are; the rest become PNG (alpha) or JPG."""
    fmt = EXT_FORMAT.get(src.suffix.lower())
    if fmt:
        return fmt
    return "png" if img.mode in ("RGBA", "LA", "P") else "jpg"


def _unique(out_dir: Path, stem: str, ext: str) -> Path:
    stem = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", stem).strip(" .") or "image"
    path = out_dir / f"{stem}{ext}"
    n = 2
    while path.exists():
        path = out_dir / f"{stem}-{n}{ext}"
        n += 1
    return path


def _entry(src: Path, out: Path, name: str, img: Optional[Image.Image] = None) -> Dict[str, Any]:
    entry: Dict[str, Any] = {"name": out.name, "source": name, "before": src.stat().st_size if src.exists() else None, "after": out.stat().st_size}
    if img is not None:
        entry.update(width=img.width, height=img.height)
    return entry


def _apply_frames(img: Image.Image, src: Path, out_dir: Path, name: str, fn, *, fmt: Optional[str] = None, quality: int = 92, keep_exif: bool = True) -> Dict[str, Any]:
    """Runs `fn` on a still image or on every frame of an animated one, then saves it like the original."""
    fmt = fmt or _output_format(src, img)
    out = _unique(out_dir, Path(name).stem, SAVE_FORMATS[fmt][1])
    if _animated(img) and fmt in ("gif", "webp"):
        frames, durations, loop = _frames(img)
        frames = [fn(f) for f in frames]
        save_animation(frames, durations, loop, out, fmt, quality=quality)
        result = frames[0]
    else:
        result = fn(img)
        save_image(result, out, fmt, quality=quality, source=img, keep_exif=keep_exif)
    return _entry(src, out, name, result)


class ImageService:
    CHUNK_SIZE = 1024 * 64

    @staticmethod
    def validate_filename(filename: Optional[str], tool: str) -> str:
        if not filename:
            raise InvalidImageError("An image has no name.")
        ext = Path(filename).suffix.lower()
        allowed = TOOL_INPUTS[tool]
        if ext not in allowed:
            shown = ", ".join(sorted({e.lstrip(".").upper() for e in allowed if e not in RAW}))
            raise InvalidImageError(f"{ext.lstrip('.').upper() or 'That'} files don't work in this tool. Try {shown}.")
        return ext

    def save_upload(self, file_obj, destination: Path, budget: List[int]) -> int:
        """Chunked save; `budget` is the bytes left for the whole request (shared across files)."""
        total = 0
        with open(destination, "wb") as out:
            while chunk := file_obj.read(self.CHUNK_SIZE):
                total += len(chunk)
                if total > budget[0]:
                    raise InvalidImageError("Those images add up to too much. Send fewer or smaller ones.")
                out.write(chunk)
        if total == 0:
            raise InvalidImageError("One of the images is empty.")
        budget[0] -= total
        return total

    @staticmethod
    def capabilities() -> Dict[str, Any]:
        from importlib.util import find_spec

        from app.services.image_ai import ML_DIR

        return {
            "heic": find_spec("pillow_heif") is not None,
            "raw": find_spec("rawpy") is not None,
            "svg": find_spec("resvg_py") is not None,
            "background": find_spec("onnxruntime") is not None,
            "upscale": find_spec("onnxruntime") is not None and (ML_DIR / "realesr-general-x4v3.onnx").is_file(),
            "faces": find_spec("cv2") is not None and (ML_DIR / "face_detection_yunet_2023mar.onnx").is_file(),
            "web": find_spec("playwright") is not None,
            "max_files": settings.MAX_FILES,
            "max_pixels": settings.MAX_PIXELS,
            "upscale_max_output_pixels": settings.UPSCALE_MAX_OUTPUT_PIXELS,
        }

    # ---------- compress ----------

    def compress(self, items: List[Tuple[str, str]], out_dir: str, level: str, keep_metadata: bool) -> Dict[str, Any]:
        """
        light: lossless (re-encoded with the best settings), recommended: visually the same, strong: smallest.
        A result that comes out bigger than the original is replaced by the original.
        """
        jpeg_q = {"light": 90, "recommended": 76, "strong": 58}[level]
        colors = {"light": None, "recommended": 256, "strong": 96}[level]
        out = Path(out_dir)
        entries = []
        for path_s, name in items:
            src = Path(path_s)
            ext = src.suffix.lower()
            if ext in SVG:
                target = _unique(out, Path(name).stem, ".svg")
                target.write_text(minify_svg(src.read_text(encoding="utf-8", errors="replace"), level), encoding="utf-8")
                entries.append(_entry(src, target, name))
            else:
                img = open_image(src, name)
                fmt = _output_format(src, img)
                target = _unique(out, Path(name).stem, SAVE_FORMATS[fmt][1])
                if _animated(img):
                    frames, durations, loop = _frames(img)
                    save_animation(frames, durations, loop, target, fmt, quality=jpeg_q, colors=colors or 256)
                elif fmt == "jpg":
                    save_image(img, target, "jpg", quality=jpeg_q, source=img, keep_exif=keep_metadata, subsampling=0 if level == "light" else 2)
                elif fmt == "webp":
                    save_image(img, target, "webp", quality=jpeg_q + 4, source=img, keep_exif=keep_metadata)
                elif fmt == "png":
                    _compress_png(img, target, colors, keep_metadata)
                else:
                    save_image(img, target, fmt, source=img, keep_exif=keep_metadata)
                entry = _entry(src, target, name, img)
                entries.append(entry)
            last = entries[-1]
            if last["before"] is not None and last["after"] >= last["before"]:
                shutil.copyfile(src, out / last["name"])  # Already as small as it gets.
                last["after"] = last["before"]
        return {"files": entries}

    # ---------- resize ----------

    def resize(self, items: List[Tuple[str, str]], out_dir: str, mode: str, width: Optional[int], height: Optional[int], percent: Optional[float], keep_ratio: bool, no_enlarge: bool) -> Dict[str, Any]:
        out = Path(out_dir)
        entries = []
        for path_s, name in items:
            src = Path(path_s)
            if src.suffix.lower() in SVG:
                text = src.read_text(encoding="utf-8", errors="replace")
                w, h, box = _svg_size(text)
                w = w or (box[2] if box else 300)
                h = h or (box[3] if box else 150)
                nw, nh = target_size(int(w), int(h), mode, width, height, percent, keep_ratio, no_enlarge)
                target = _unique(out, Path(name).stem, ".svg")
                target.write_text(resize_svg(text, nw, nh, w, h, box), encoding="utf-8")
                entries.append({**_entry(src, target, name), "width": nw, "height": nh})
                continue
            img = open_image(src, name)
            nw, nh = target_size(img.width, img.height, mode, width, height, percent, keep_ratio, no_enlarge)
            entries.append(_apply_frames(img, src, out, name, lambda f, nw=nw, nh=nh: f if f.size == (nw, nh) else f.resize((nw, nh), Image.Resampling.LANCZOS)))
        return {"files": entries}

    # ---------- crop ----------

    def crop(self, path_s: str, name: str, out_dir: str, x: int, y: int, w: int, h: int) -> Dict[str, Any]:
        src = Path(path_s)
        img = open_image(src, name)
        x, y = max(0, min(x, img.width - 1)), max(0, min(y, img.height - 1))
        w, h = max(1, min(w, img.width - x)), max(1, min(h, img.height - y))
        box = (x, y, x + w, y + h)
        return {"files": [_apply_frames(img, src, Path(out_dir), name, lambda f: f.crop(box))]}

    # ---------- convert ----------

    def convert(self, items: List[Tuple[str, str]], out_dir: str, target: str, quality: str, background: str) -> Dict[str, Any]:
        """Any image → JPG / PNG / WebP / GIF. 'recommended' keeps sizes sensible; 'high' keeps every pixel."""
        if target not in SAVE_FORMATS:
            raise InvalidImageError("Pick JPG, PNG, WebP or GIF.")
        bg = _hex(background)
        q = 95 if quality == "high" else 85
        out = Path(out_dir)
        entries = []
        for path_s, name in items:
            src = Path(path_s)
            img = open_image(src, name)
            if _animated(img) and target in ("gif", "webp"):
                entries.append(_apply_frames(img, src, out, name, lambda f: f, fmt=target, quality=q))
                continue
            still = img
            if _animated(img) or getattr(img, "n_frames", 1) > 1:
                img.seek(0)  # First frame / first page.
                still = img.copy()
            if quality != "high" and target in ("jpg", "webp") and max(still.size) > 6000:
                still = ImageOps.contain(still, (6000, 6000), Image.Resampling.LANCZOS)
            if still.mode in ("I", "I;16", "F"):
                still = ImageOps.autocontrast(still.convert("L"))
            dest = _unique(out, Path(name).stem, SAVE_FORMATS[target][1])
            save_image(still, dest, target, quality=q, source=img, background=bg, subsampling=0 if quality == "high" else 2)
            entries.append(_entry(src, dest, name, still))
        return {"files": entries}

    def animated_gif(self, items: List[Tuple[str, str]], out_dir: str, seconds: float, loop: bool, fit: str, background: str, name: str) -> Dict[str, Any]:
        """Several images → one animated GIF, in the order given, sized to the first image."""
        if len(items) < 2:
            raise InvalidImageError("Add at least two images to make an animation.")
        bg = _hex(background)
        first = open_image(Path(items[0][0]), items[0][1])
        size = first.size
        if size[0] * size[1] > 4_000_000:
            size = ImageOps.contain(Image.new("L", size), (2000, 2000)).size  # GIFs that big don't play smoothly.
        frames = []
        for path_s, n in items:
            img = open_image(Path(path_s), n)
            if _animated(img):
                img.seek(0)
                img = img.copy()
            img = img.convert("RGBA")
            canvas = Image.new("RGBA", size, (*bg, 255))
            if fit == "cover":
                fitted = ImageOps.fit(img, size, Image.Resampling.LANCZOS)
            else:
                fitted = ImageOps.contain(img, size, Image.Resampling.LANCZOS)
            canvas.alpha_composite(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
            frames.append(canvas)
        dest = _unique(Path(out_dir), name or "animation", ".gif")
        ms = int(round(max(0.05, min(seconds, 20)) * 1000))
        save_animation(frames, [ms] * len(frames), 0 if loop else None, dest, "gif")
        return {"files": [{"name": dest.name, "source": name, "before": None, "after": dest.stat().st_size, "width": size[0], "height": size[1], "frames": len(frames)}]}

    # ---------- rotate ----------

    def rotate(self, items: List[Tuple[str, str]], out_dir: str, turns: List[Dict[str, Any]]) -> Dict[str, Any]:
        """`turns[i]` = {"angle": 0|90|180|270 clockwise, "flip_h": bool, "flip_v": bool}. Pixel-exact (no resampling)."""
        out = Path(out_dir)
        entries = []
        ops = {90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}
        for (path_s, name), turn in zip(items, turns):
            src = Path(path_s)
            img = open_image(src, name)
            angle = int(turn.get("angle", 0)) % 360

            def fn(f: Image.Image, angle=angle, turn=turn) -> Image.Image:
                if angle in ops:
                    f = f.transpose(ops[angle])
                if turn.get("flip_h"):
                    f = f.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                if turn.get("flip_v"):
                    f = f.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                return f

            entries.append(_apply_frames(img, src, out, name, fn, quality=95))
        return {"files": entries}

    # ---------- watermark ----------

    def watermark(self, items: List[Tuple[str, str]], out_dir: str, options: Dict[str, Any], mark_path: Optional[str]) -> Dict[str, Any]:
        out = Path(out_dir)
        mark_img = None
        if options["kind"] == "image":
            if not mark_path:
                raise InvalidImageError("Add the image to stamp.")
            mark_img = open_image(Path(mark_path), "watermark").convert("RGBA")
        entries = []
        for path_s, name in items:
            src = Path(path_s)
            img = open_image(src, name)
            cache: Dict[Tuple[int, int], Image.Image] = {}

            def fn(f: Image.Image) -> Image.Image:
                key = f.size
                if key not in cache:
                    cache[key] = watermark_layer(f.size, options, mark_img)
                base = f.convert("RGBA")
                base.alpha_composite(cache[key])
                return base if f.mode in ("RGBA", "LA", "P") else base.convert("RGB")

            entries.append(_apply_frames(img, src, out, name, fn))
        return {"files": entries}

    # ---------- blur ----------

    def blur(self, path_s: str, name: str, out_dir: str, areas: List[Dict[str, float]], mode: str, strength: int, shape: str) -> Dict[str, Any]:
        """Hides each area (fractions of the image) with a heavy blur or big pixels. Nothing underneath survives."""
        src = Path(path_s)
        img = open_image(src, name)
        if not areas:
            raise InvalidImageError("Mark at least one area to blur.")

        def fn(f: Image.Image) -> Image.Image:
            base = f.convert("RGBA") if f.mode in ("RGBA", "LA", "P") else f.convert("RGB")
            for a in areas:
                x0 = int(round(a["x"] * base.width))
                y0 = int(round(a["y"] * base.height))
                x1 = int(round(min(1.0, a["x"] + a["w"]) * base.width))
                y1 = int(round(min(1.0, a["y"] + a["h"]) * base.height))
                if x1 - x0 < 2 or y1 - y0 < 2:
                    continue
                region = base.crop((x0, y0, x1, y1))
                size = max(x1 - x0, y1 - y0)
                if mode == "pixelate":
                    block = max(4, int(size * (0.04 + strength / 100 * 0.16)))
                    small = region.resize((max(1, region.width // block), max(1, region.height // block)), Image.Resampling.BOX)
                    hidden = small.resize(region.size, Image.Resampling.NEAREST)
                else:
                    radius = max(4, size * (0.05 + strength / 100 * 0.2))
                    # Shrinking first makes the blur irreversible and fast at any size.
                    small = region.resize((max(1, region.width // 4), max(1, region.height // 4)), Image.Resampling.BOX)
                    hidden = small.filter(ImageFilter.GaussianBlur(radius / 4)).resize(region.size, Image.Resampling.BICUBIC)
                    hidden = hidden.filter(ImageFilter.GaussianBlur(radius / 8))
                mask = None
                if shape == "ellipse":
                    mask = Image.new("L", region.size, 0)
                    ImageDraw.Draw(mask).ellipse((0, 0, region.width - 1, region.height - 1), fill=255)
                    mask = mask.filter(ImageFilter.GaussianBlur(max(1, size * 0.02)))
                base.paste(hidden, (x0, y0), mask)
            return base

        return {"files": [_apply_frames(img, src, Path(out_dir), name, fn)]}

    # ---------- AI tools (models load in this same pool process) ----------

    def remove_background(self, items: List[Tuple[str, str]], out_dir: str, background: str, color: str) -> Dict[str, Any]:
        from app.services.image_ai import cutout

        out = Path(out_dir)
        entries = []
        for path_s, name in items:
            src = Path(path_s)
            img = open_image(src, name)
            if _animated(img):
                img.seek(0)
                img = img.copy()
            result = cutout(img.convert("RGB"), background, _hex(color))
            fmt = "png" if result.mode == "RGBA" else "jpg"
            dest = _unique(out, f"{Path(name).stem}-cutout", SAVE_FORMATS[fmt][1])
            save_image(result, dest, fmt, quality=92, source=img)
            entries.append(_entry(src, dest, name, result))
        return {"files": entries}

    def upscale(self, path_s: str, name: str, out_dir: str, factor: int) -> Dict[str, Any]:
        from app.services.image_ai import super_resolve

        src = Path(path_s)
        img = open_image(src, name)
        if _animated(img):
            img.seek(0)
            img = img.copy()
        if img.width * img.height * factor * factor > settings.UPSCALE_MAX_OUTPUT_PIXELS:
            limit = math.sqrt(settings.UPSCALE_MAX_OUTPUT_PIXELS / (factor * factor))
            raise InvalidImageError(
                f"That image is {img.width} × {img.height}. For {factor}× it can be up to about {int(limit)} × {int(limit)} "
                f"({settings.UPSCALE_MAX_OUTPUT_PIXELS / 1e6:.0f} MP out). Try 2×, or a smaller image."
            )
        result = super_resolve(img, factor)
        fmt = "png" if result.mode == "RGBA" else ("jpg" if src.suffix.lower() in (".jpg", ".jpeg", ".jfif") else "png")
        dest = _unique(Path(out_dir), f"{Path(name).stem}-{factor}x", SAVE_FORMATS[fmt][1])
        save_image(result, dest, fmt, quality=95, source=img, subsampling=0)
        return {"files": [_entry(src, dest, name, result)]}

    def detect_faces(self, path_s: str, name: str, sensitivity: str) -> Dict[str, Any]:
        from app.services.image_ai import find_faces

        img = open_image(Path(path_s), name)
        if _animated(img):
            img.seek(0)
            img = img.copy()
        return {"width": img.width, "height": img.height, "faces": find_faces(img.convert("RGB"), sensitivity)}


# ---------------------------------------------------------------------------------------------
# Helpers that are also unit-tested directly
# ---------------------------------------------------------------------------------------------


def target_size(w: int, h: int, mode: str, width: Optional[int], height: Optional[int], percent: Optional[float], keep_ratio: bool, no_enlarge: bool) -> Tuple[int, int]:
    """iLoveIMG-style resize maths: with the ratio kept, width and height are maximums."""
    if mode == "percent":
        f = (percent or 100) / 100
        nw, nh = w * f, h * f
    elif keep_ratio:
        sx = width / w if width else math.inf
        sy = height / h if height else math.inf
        s = min(sx, sy)
        s = 1 if s == math.inf else s
        nw, nh = w * s, h * s
    else:
        nw, nh = width or w, height or h
    if no_enlarge and (nw > w or nh > h):
        if keep_ratio or mode == "percent":
            nw, nh = w, h
        else:
            nw, nh = min(nw, w), min(nh, h)
    nw, nh = max(1, int(round(nw))), max(1, int(round(nh)))
    if nw * nh > settings.MAX_PIXELS:
        raise InvalidImageError(f"{nw} × {nh} is too large. Keep it under {settings.MAX_PIXELS / 1e6:.0f} megapixels.")
    return nw, nh


def _compress_png(img: Image.Image, target: Path, colors: Optional[int], keep_metadata: bool) -> None:
    params: Dict[str, Any] = {"optimize": True}
    if img.info.get("icc_profile"):
        params["icc_profile"] = img.info["icc_profile"]
    if colors is None or img.mode in ("P", "1", "L") and colors >= 256:
        img.save(target, "PNG", **params)
        return
    rgba = img.convert("RGBA")
    has_alpha = rgba.getchannel("A").getextrema()[0] < 255
    q = rgba.quantize(colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG) if has_alpha else rgba.convert("RGB").quantize(
        colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG
    )
    q.save(target, "PNG", **params)


def minify_svg(text: str, level: str) -> str:
    """Removes what an SVG doesn't need to draw: comments, editor metadata, whitespace; strong also rounds numbers."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<\?xml[^>]*\?>", "", text)
    text = re.sub(r"<!DOCTYPE[^>[]*(\[[^\]]*\])?\s*>", "", text, flags=re.I | re.S)
    text = re.sub(r"<metadata\b.*?</metadata\s*>", "", text, flags=re.I | re.S)
    text = re.sub(r"<(sodipodi|inkscape):[^>]*/>", "", text)
    text = re.sub(r"<(sodipodi|inkscape):(\w+)\b.*?</\1:\2\s*>", "", text, flags=re.S)
    text = re.sub(r"\s(sodipodi|inkscape):[\w-]+\s*=\s*\"[^\"]*\"", "", text)
    text = re.sub(r">\s+<", "><", text)
    text = re.sub(r"[ \t\r\n]+", " ", text)
    if level != "light":
        digits = 2 if level == "recommended" else 1

        def round_num(m: re.Match) -> str:
            value = round(float(m.group(0)), digits)
            out = f"{value:.{digits}f}".rstrip("0").rstrip(".")
            return out if out not in ("-0", "") else "0"

        # Only inside path data and coordinates, never ids or colours.
        text = re.sub(
            r"(\s(?:d|points|transform|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height)\s*=\s*\")([^\"]*)(\")",
            lambda m: m.group(1) + re.sub(r"-?\d+\.\d{%d,}" % (digits + 1), round_num, m.group(2)) + m.group(3),
            text,
        )
    return text.strip()


def resize_svg(text: str, nw: int, nh: int, w: float, h: float, box: Optional[Tuple[float, ...]]) -> str:
    """Vector images resize without loss: new width/height, with a viewBox so the drawing scales along."""
    root = re.search(r"<svg\b[^>]*>", text, flags=re.I | re.S)
    tag = root.group(0)
    new = re.sub(r"\s(width|height)\s*=\s*([\"'])[^\"']*\2", "", tag)
    extra = f' width="{nw}" height="{nh}"'
    if not box:
        extra += f' viewBox="0 0 {w:g} {h:g}"'
    if not re.search(r"preserveAspectRatio", new):
        extra += ' preserveAspectRatio="none"' if nw * h != nh * w else ""
    new = new[:-1].rstrip("/") + extra + (" />" if new.endswith("/>") else ">")
    return text.replace(tag, new, 1)


# ---------- watermark drawing ----------


def _font_file(name: str, text: str) -> Path:
    for (lo, hi), file in SCRIPT_FONTS:
        if any(lo <= ord(c) <= hi for c in text):
            return FONT_DIR / file
    return FONT_DIR / FONTS.get(name, FONTS["sans"])


def load_font(name: str, size: int, text: str, bold: bool = True) -> ImageFont.FreeTypeFont:
    path = _font_file(name, text)
    try:
        font = ImageFont.truetype(str(path), size)
    except OSError:
        raise ImageToolUnavailableError("The watermark fonts are missing on this server.")
    try:
        axes = font.get_variation_axes()
        values = []
        for axis in axes:
            label = axis.get("name", b"")
            label = label.decode() if isinstance(label, bytes) else str(label)
            if label.lower().startswith("weight"):
                values.append(min(axis["maximum"], max(axis["minimum"], 700 if bold else 400)))
            else:
                values.append(axis.get("default", axis["minimum"]))
        if values:
            font.set_variation_by_axes(values)
    except (OSError, AttributeError):
        pass  # A static font: nothing to set.
    return font


def text_mark(opts: Dict[str, Any], image_width: int) -> Image.Image:
    """The text as an RGBA picture (with an optional soft shadow), sized relative to the image."""
    text = opts["text"]
    size = max(8, int(round(opts.get("size", 0.06) * image_width)))
    font = load_font(opts.get("font", "sans"), size, text, opts.get("bold", True))
    probe = ImageDraw.Draw(Image.new("L", (1, 1)))
    left, top, right, bottom = probe.multiline_textbbox((0, 0), text, font=font, align="center")
    pad = int(size * 0.25)
    w, h = right - left + pad * 2, bottom - top + pad * 2
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    color = (*_hex(opts.get("color", "#ffffff")), 255)
    if opts.get("shadow", True):
        shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        off = max(1, size // 18)
        ImageDraw.Draw(shadow).multiline_text((pad - left + off, pad - top + off), text, font=font, fill=(0, 0, 0, 150), align="center")
        layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(max(1, size // 24))))
    ImageDraw.Draw(layer).multiline_text((pad - left, pad - top), text, font=font, fill=color, align="center")
    if opts.get("italic"):
        shear = 0.2
        layer = layer.transform((w + int(h * shear), h), Image.Transform.AFFINE, (1, shear, -h * shear, 0, 1, 0), Image.Resampling.BICUBIC)
    return layer


def watermark_layer(size: Tuple[int, int], options: Dict[str, Any], mark_img: Optional[Image.Image]) -> Image.Image:
    """The whole overlay for an image of `size`: the mark, faded, turned and placed (or tiled)."""
    width, height = size
    if options["kind"] == "image":
        target_w = max(4, int(round(options.get("scale", 0.25) * width)))
        mark = mark_img.resize((target_w, max(1, int(round(mark_img.height * target_w / mark_img.width)))), Image.Resampling.LANCZOS)
    else:
        mark = text_mark(options["text"], width)
    opacity = float(options.get("opacity", 0.5))
    alpha = mark.getchannel("A").point(lambda a: int(a * opacity))
    mark.putalpha(alpha)
    if options.get("rotation"):
        mark = mark.rotate(float(options["rotation"]), resample=Image.Resampling.BICUBIC, expand=True)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    if options.get("mosaic"):
        gap_x, gap_y = int(mark.width * 0.6) + 8, int(mark.height * 1.2) + 8
        row = 0
        for y in range(-mark.height // 2, height, mark.height + gap_y):
            shift = (mark.width + gap_x) // 2 if row % 2 else 0
            for x in range(-mark.width // 2 - shift, width, mark.width + gap_x):
                layer.paste(mark, (x, y), mark)  # Tiles never overlap, and paste takes negative offsets.
            row += 1
        return layer
    margin = int(round(options.get("margin", 0.03) * min(width, height)))
    pos = options.get("position", "br")
    col = {"l": margin, "c": (width - mark.width) // 2, "r": width - mark.width - margin}[pos[1]]
    row_ = {"t": margin, "m": (height - mark.height) // 2, "b": height - mark.height - margin}[pos[0]]
    layer.paste(mark, (col, row_), mark)
    return layer


def json_info(result: Dict[str, Any]) -> str:
    """The X-Image-Info header: ASCII JSON, kept small."""
    return json.dumps(result, ensure_ascii=True, separators=(",", ":"))


image_service = ImageService()
