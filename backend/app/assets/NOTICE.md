# Bundled assets and their licences

Everything here is free to use, change and redistribute under the licence noted.

## ml/ (neural networks, run with ONNX Runtime)

| File | What | Source | Licence |
|---|---|---|---|
| `realesr-general-x4v3.onnx` | Upscaler (Real-ESRGAN, compact model) | github.com/xinntao/Real-ESRGAN, release v0.2.5.0, converted to ONNX by `backend/scripts/export_upscaler.py` | BSD-3-Clause |
| `face_detection_yunet_2023mar.onnx` | Face detector (YuNet) | github.com/opencv/opencv_zoo | MIT |

Downloaded on first use (and baked into the Docker image), not stored here: `silueta.onnx`, the
background-removal model (U²-Net, via github.com/danielgatis/rembg), Apache-2.0, pinned by SHA-256
in `app/config/image.py`.

## fonts/ (watermark and meme lettering)

Noto Sans, Noto Serif, Noto Sans Mono, Noto Sans Devanagari, Noto Sans Bengali, Anton and Caveat,
from github.com/google/fonts. All under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
The frontend loads the same families through `next/font`, so its previews match.
