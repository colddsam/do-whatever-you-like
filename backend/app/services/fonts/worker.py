"""Entry points run in an isolated child process (app/core/isolation.py)."""

import base64
from pathlib import Path
from typing import Any, Dict

from app.config.fonts import settings


def inspect(payload: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.fonts.inspect import report, to_sfnt

    path = Path(payload["input"])
    index = int(payload.get("index") or 0)
    rep = report(path, payload["name"], index)
    # Browsers and opentype.js can't read WOFF2 inside a collection or a collection itself in every
    # case; hand back the face as a plain font so the page can draw every glyph.
    sfnt = None
    if rep["file"]["format"] in ("WOFF2", "Collection"):
        out = to_sfnt(path, Path(payload["work"]) / "face.otf", index)
        if out.stat().st_size <= settings.MAX_SFNT_MB * 1024 * 1024:
            sfnt = base64.b64encode(out.read_bytes()).decode("ascii")
    return {"report": rep, "sfnt": sfnt}


def document(payload: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.fonts.documents import scan

    result = scan(Path(payload["input"]), payload["name"])
    files = [{"name": f["name"], "ext": f["ext"], "data": base64.b64encode(f["data"]).decode("ascii")} for f in result["files"]]
    return {"kind": result["kind"], "fonts": result["fonts"], "files": files}
