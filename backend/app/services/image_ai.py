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

Memory, measured for one 2000 x 2667 photo: U²-Net's activations at 320 px take ~240 MB (~180 MB with
silueta-lean.onnx, see background_model), so nothing else may be large at the same time. ONNX Runtime's default CPU arena kept another
~130 MB (and grew with each run), and the full-size photo was held twice while the network ran;
together that pushed the instance past 512 MB and Render restarted it. Hence: no arena, small
copies for the network, and the model is freed before any full-size photo is opened.
"""

import ctypes
import gc
import hashlib
import logging
import math
import os
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter

from app.config.image import settings
from app.exceptions.image import ImageProcessingError, ImageToolUnavailableError

logger = logging.getLogger(__name__)

ML_DIR = Path(__file__).resolve().parent.parent / "assets" / "ml"
UPSCALER = ML_DIR / "realesr-general-x4v3.onnx"
FACES = ML_DIR / "face_detection_yunet_2023mar.onnx"


def _threads() -> int:
    """ONNX_THREADS, or (0) the CPUs this container may actually use: its cgroup quota, not the host's cores."""
    if settings.ONNX_THREADS > 0:
        return settings.ONNX_THREADS
    cpus = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()[:2]
        if quota != "max":
            cpus = min(cpus, math.ceil(int(quota) / int(period)))
    except (OSError, ValueError):
        pass
    return max(1, min(cpus, 4))


def _session(path: Path, layout_copies: bool = True):
    try:
        import onnxruntime as ort
    except ImportError:
        raise ImageToolUnavailableError()
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = _threads()
    opts.inter_op_num_threads = 1
    opts.log_severity_level = 3
    # The arena keeps every buffer it ever allocated (and grows run after run); the memory pattern
    # pre-plans one block for the whole graph. Both trade a few percent of speed for 100+ MB here.
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    if not layout_copies:
        # EXTENDED skips the NCHWc layout pass, which copies each full-size activation once more.
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
    # Idle worker threads would otherwise spin, burning a small instance's CPU quota for nothing.
    opts.add_session_config_entry("session.intra_op.allow_spinning", "0")
    return ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])


def _release() -> None:
    """Hands freed native memory back to the OS, so the pool process doesn't sit on it after a job."""
    gc.collect()
    if sys.platform.startswith("linux"):
        try:
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except (OSError, AttributeError):
            pass


# ---------- background ----------


def background_model() -> Path:
    """
    The cut-out model, fetched on first use (and baked into the Docker image) and verified. The
    Docker image also carries silueta-lean.onnx (scripts/lean_background_model.py), the same network
    with its full-resolution layers in float, which needs ~60 MB less per run; it's used when present.
    """
    lean = settings.MODEL_DIR / "silueta-lean.onnx"
    if lean.is_file():
        return lean
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


MASK_SIZE = 320  # silueta's fixed input size


def background_masks(images: Iterable[Image.Image]) -> List[Image.Image]:
    """
    One raw MASK_SIZE x MASK_SIZE L-mode mask per RGB image, from a single model session that is
    freed before returning. Pass small copies: only a 320 px version of each image is ever used.
    """
    session = _session(background_model(), layout_copies=False)
    try:
        name = session.get_inputs()[0].name
        masks = []
        for img in images:
            small = img.resize((MASK_SIZE, MASK_SIZE), Image.Resampling.LANCZOS)
            del img
            arr = np.asarray(small, dtype=np.float32)
            arr = arr / max(float(arr.max()), 1e-6)
            arr = (arr - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
            tensor = arr.transpose(2, 0, 1)[None].astype(np.float32)
            pred = session.run(None, {name: tensor})[0][0, 0]
            lo, hi = float(pred.min()), float(pred.max())
            pred = (pred - lo) / max(hi - lo, 1e-6)
            masks.append(Image.fromarray((pred * 255).astype(np.uint8), "L"))
        return masks
    finally:
        del session
        _release()


def cutout(img: Image.Image, raw_mask: Image.Image, background: str, color: Tuple[int, int, int]) -> Image.Image:
    """
    Applies a mask from background_masks() to the full-size RGB image. Works in place where it can
    (`img` itself may become the RGBA result): at 25 MP every extra full-size copy is 75-100 MB.
    """
    mask = raw_mask.resize(img.size, Image.Resampling.LANCZOS)
    # Firm up the edges: faint haze becomes background, near-certain pixels become fully solid.
    mask = mask.point(lambda v: 0 if v < 20 else 255 if v > 235 else int((v - 20) * 255 / 215))
    if mask.getextrema()[1] < 32:
        raise ImageProcessingError("We couldn't find a clear subject in that image.")
    if background == "transparent":
        img.putalpha(mask)
        return img
    if background == "blur":
        radius = max(6, max(img.size) // 60)
        # A blur this strong looks the same done at reduced scale and enlarged, for a fraction of
        # the memory and CPU (a ~100 px radius over a 25 MP photo otherwise needs its own full copy).
        f = max(1, min(4, radius // 6))
        small = img.resize((max(1, img.width // f), max(1, img.height // f)), Image.Resampling.BOX)
        back = small.filter(ImageFilter.GaussianBlur(radius / f)).resize(img.size, Image.Resampling.BICUBIC)
        del small
    else:
        back = Image.new("RGB", img.size, color)
    back.paste(img, (0, 0), mask)
    return back


# ---------- upscaling ----------


def upscale_plan(w: int, h: int, factor: int, max_in: int, max_out: int) -> Optional[Dict[str, Any]]:
    """
    Sizes for one upscale: what the network sees and what comes out. The network always enlarges 4x
    (2x is that result scaled down, which keeps the sharper detail), so its cost follows its input,
    not the factor. An image above `max_in` is reduced first; a result above `max_out` is made as
    large as fits. None when the result couldn't be meaningfully bigger than the image itself.
    """
    if factor not in (2, 4):
        raise ImageProcessingError("Pick 2× or 4×.")
    ow, oh = w * factor, h * factor
    capped = ow * oh > max_out
    if capped:
        s = math.sqrt(max_out / (ow * oh))
        ow, oh = max(1, int(ow * s)), max(1, int(oh * s))
    if ow < w * 1.25 or oh < h * 1.25:
        return None
    nw, nh = w, h
    if nw * nh > max_in:
        s = math.sqrt(max_in / (nw * nh))
        nw, nh = max(1, int(nw * s)), max(1, int(nh * s))
    # Feeding the full image for 2x is right (4x then down keeps detail); beyond the result's own size it's waste.
    if nw > ow or nh > oh:
        nw, nh = min(nw, ow), min(nh, oh)
    return {"network": (nw, nh), "output": (ow, oh), "capped": capped, "reduced": (nw, nh) != (w, h)}


def super_resolve(img: Image.Image, network: Tuple[int, int], output: Tuple[int, int]) -> Image.Image:
    """Real-ESRGAN 4x on `img` at the `network` size, then resized to `output` (see upscale_plan)."""
    if not UPSCALER.is_file():
        raise ImageToolUnavailableError("Upscaling isn't available on this server yet.")
    alpha = None
    if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
        alpha = (img if img.mode in ("RGBA", "LA") else img.convert("RGBA")).getchannel("A")
    work = img.convert("RGB")
    if work.size != tuple(network):
        work = work.resize(network, Image.Resampling.LANCZOS)
    session = _session(UPSCALER)
    rgb = np.asarray(work, dtype=np.float32) / 255.0
    del work
    h, w, _ = rgb.shape
    scale = 4
    out = np.zeros((h * scale, w * scale, 3), dtype=np.uint8)
    tile, pad = max(64, settings.UPSCALE_TILE), 12
    name = session.get_inputs()[0].name
    try:
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
    finally:
        del session, rgb, out
        _release()
    if result.size != tuple(output):
        result = result.resize(output, Image.Resampling.LANCZOS)
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
