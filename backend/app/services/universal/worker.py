"""
Runs one conversion, every step of its route. app/core/isolation.py calls `execute` in a child
process of its own (python -m app.core.job_worker), and kills it — with any LibreOffice, FFmpeg or
Pandoc it started — on timeout or when the person cancels.
"""

from pathlib import Path
from typing import Callable, Dict

Handler = Callable[..., Path]


def _handlers() -> Dict[str, Handler]:
    """Imported here, not at module level, so a step only loads the libraries it uses."""
    from app.services.universal.engines import archive, data, font, image, media, office, pandoc, pdf, text

    return {
        "office.writer": lambda *a: office.convert("writer", *a),
        "office.calc": lambda *a: office.convert("calc", *a),
        "office.impress": lambda *a: office.convert("impress", *a),
        "office.draw": lambda *a: office.convert("draw", *a),
        "office.pdf_slides": lambda *a: office.convert("pdf_slides", *a),
        "pdf.word": pdf.to_word,
        "pdf.excel": pdf.to_excel,
        "pdf.text": pdf.to_text,
        "pdf.images": pdf.to_images,
        "web.pdf": pdf.html_to_pdf,
        "pandoc": pandoc.convert,
        "text.code": text.code,
        "text.plain": text.plain,
        "text.notebook": text.notebook,
        "text.subtitles": text.subtitles,
        "text.email": text.email,
        "data": data.convert,
        "image": image.convert,
        "image.svg_pdf": image.svg_to_pdf,
        "image.ocr": image.ocr,
        "media.audio": media.audio,
        "media.video": media.video,
        "media.gif": media.gif,
        "media.frame": media.frame,
        "media.subtitles": media.subtitles,
        "font": font.convert,
        "archive": archive.convert,
    }


def execute(job: dict) -> dict:
    from app.services.universal.engines.common import Ctx

    handlers = _handlers()
    steps = job["steps"]
    ctx = Ctx(stem=job["stem"], source=job["source"])
    current = Path(job["input"])
    work = Path(job["work"])
    for i, step in enumerate(steps):
        final = i == len(steps) - 1
        # Options tune the step that makes the result, never the ones on the way there.
        ctx.options = (job.get("options") or {}) if final else {}
        current = handlers[step["engine"]](current, step["target"], work / f"step{i + 1}", final, ctx)
    return {"path": str(current), "notes": ctx.notes}
