"""
The image tools that need a neural network, all run with ONNX Runtime on the CPU (no GPU, no PyTorch):

- Background removal: U²-Net "silueta" (rembg, Apache-2.0/MIT), 44 MB, downloaded once and checked
  against a pinned SHA-256. The mask is predicted at 320 px and scaled back to the full photo.
- Upscaling: Real-ESRGAN realesr-general-x4v3 (BSD-3-Clause), 5 MB, bundled in app/assets/ml.
  Runs in overlapping tiles, so memory stays flat whatever the image size.
- Face detection: YuNet (OpenCV Zoo, MIT), 230 KB, bundled. Faces come back as boxes people can
  adjust before anything is blurred.

These run inside the PDF process pool. Sessions are created per job and dropped afterwards, so an
idle server holds none of them in memory (important on a 512 MB instance).
"""

import hashlib
import logging
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image, ImageFilter

from app.config.image import settings
from app.exceptions.image import ImageProcessingError, ImageToolUnavailableError

logger = logging.getLogger(__name__)

ML_DIR = Path(__file__).resolve().parent.parent / "assets" / "ml"
UPSCALER = ML_DIR / "realesr-general-x4v3.onnx"
FACES = ML_DIR / "face_detection_yunet_2023mar.onnx"


def _session(path: Path):
    try:
        import onnxruntime as ort
    except ImportError:
        raise ImageToolUnavailableError()
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = settings.ONNX_THREADS
    opts.inter_op_num_threads = 1
    opts.log_severity_level = 3
    return ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])


# ---------- background ----------


def background_model() -> Path:
    """The cut-out model, fetched on first use (and baked into the Docker image) and verified."""
    target = settings.MODEL_DIR / "silueta.onnx"
    if target.is_file():
        return target
    settings.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=settings.MODEL_DIR, suffix=".part")
    os.close(fd)
    try:
        digest = hashlib.sha256()
        with urllib.request.urlopen(settings.BACKGROUND_MODEL_URL, timeout=60) as resp, open(tmp, "wb") as out:
            while chunk := resp.read(1 << 20):
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != settings.BACKGROUND_MODEL_SHA256:
            raise ValueError("checksum mismatch")
        os.replace(tmp, target)
    except Exception as exc:
        logger.error("Couldn't fetch the background model: %s", exc)
        raise ImageToolUnavailableError("Background removal isn't available on this server right now.")
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return target


def subject_mask(img: Image.Image) -> Image.Image:
    """An L-mode mask the size of `img`: 255 where the subject is, 0 for background."""
    session = _session(background_model())
    small = img.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS)
    arr = np.asarray(small, dtype=np.float32)
    arr = arr / max(float(arr.max()), 1e-6)
    arr = (arr - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = arr.transpose(2, 0, 1)[None].astype(np.float32)
    pred = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
    lo, hi = float(pred.min()), float(pred.max())
    pred = (pred - lo) / max(hi - lo, 1e-6)
    mask = Image.fromarray((pred * 255).astype(np.uint8), "L").resize(img.size, Image.Resampling.LANCZOS)
    # Firm up the edges: faint haze becomes background, near-certain pixels become fully solid.
    return mask.point(lambda v: 0 if v < 20 else 255 if v > 235 else int((v - 20) * 255 / 215))


def cutout(img: Image.Image, background: str, color: Tuple[int, int, int]) -> Image.Image:
    mask = subject_mask(img)
    if mask.getextrema()[1] < 32:
        raise ImageProcessingError("We couldn't find a clear subject in that image.")
    if background == "transparent":
        out = img.convert("RGBA")
        out.putalpha(mask)
        return out
    if background == "blur":
        back = img.filter(ImageFilter.GaussianBlur(max(6, max(img.size) // 60)))
    else:
        back = Image.new("RGB", img.size, color)
    return Image.composite(img, back, mask)


# ---------- upscaling ----------


def super_resolve(img: Image.Image, factor: int) -> Image.Image:
    """4× with Real-ESRGAN (2× is the 4× result scaled down, which keeps the sharper detail)."""
    if factor not in (2, 4):
        raise ImageProcessingError("Pick 2× or 4×.")
    if not UPSCALER.is_file():
        raise ImageToolUnavailableError("Upscaling isn't available on this server yet.")
    session = _session(UPSCALER)
    alpha = img.getchannel("A") if img.mode in ("RGBA", "LA") else None
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    h, w, _ = rgb.shape
    scale = 4
    out = np.zeros((h * scale, w * scale, 3), dtype=np.uint8)
    tile, pad = max(64, settings.UPSCALE_TILE), 12
    name = session.get_inputs()[0].name
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            y0, x0 = max(0, y - pad), max(0, x - pad)
            y1, x1 = min(h, y + tile + pad), min(w, x + tile + pad)
            patch = rgb[y0:y1, x0:x1].transpose(2, 0, 1)[None]
            res = session.run(None, {name: np.ascontiguousarray(patch)})[0][0].transpose(1, 2, 0)
            # Keep only the tile's own area; the padding just gives the network context at the seams.
            ty, tx = (y - y0) * scale, (x - x0) * scale
            th, tw = (min(y + tile, h) - y) * scale, (min(x + tile, w) - x) * scale
            out[y * scale : y * scale + th, x * scale : x * scale + tw] = np.clip(res[ty : ty + th, tx : tx + tw] * 255.0 + 0.5, 0, 255).astype(np.uint8)
    result = Image.fromarray(out, "RGB")
    if factor == 2:
        result = result.resize((w * 2, h * 2), Image.Resampling.LANCZOS)
    if alpha is not None:
        result = result.convert("RGBA")
        result.putalpha(alpha.resize(result.size, Image.Resampling.LANCZOS))
    return result


# ---------- faces ----------

SENSITIVITY = {"low": 0.9, "recommended": 0.75, "high": 0.55}


def find_faces(img: Image.Image, sensitivity: str) -> List[Dict[str, Any]]:
    """Face boxes as fractions of the image, grown a little so the whole head is covered."""
    try:
        import cv2
    except ImportError:
        raise ImageToolUnavailableError("Face detection isn't available on this server yet.")
    if not FACES.is_file():
        raise ImageToolUnavailableError("Face detection isn't available on this server yet.")
    w, h = img.size
    # Large photos are searched at up to 1600 px (2400 px on "high", for small faces in group shots).
    limit = 2400 if sensitivity == "high" else 1600
    scale = min(1.0, limit / max(w, h))
    work = img if scale == 1 else img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    bgr = cv2.cvtColor(np.asarray(work.convert("RGB")), cv2.COLOR_RGB2BGR)
    detector = cv2.FaceDetectorYN.create(str(FACES), "", (bgr.shape[1], bgr.shape[0]), SENSITIVITY.get(sensitivity, 0.75), 0.3, 5000)
    _, found = detector.detect(bgr)
    faces = []
    for row in found if found is not None else []:
        fx, fy, fw, fh, score = float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[-1])
        # Grow 20% sideways and 35% upwards: the detector boxes the face, not the hair and forehead.
        gx, gy = fw * 0.2, fh * 0.2
        x0, y0 = max(0.0, fx - gx), max(0.0, fy - gy * 1.75)
        x1, y1 = min(bgr.shape[1], fx + fw + gx), min(bgr.shape[0], fy + fh + gy)
        faces.append({
            "x": round(x0 / bgr.shape[1], 5),
            "y": round(y0 / bgr.shape[0], 5),
            "w": round((x1 - x0) / bgr.shape[1], 5),
            "h": round((y1 - y0) / bgr.shape[0], 5),
            "score": round(score, 3),
        })
    faces.sort(key=lambda f: (f["y"], f["x"]))
    return faces
