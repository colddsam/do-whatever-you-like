"""
Entry points that run inside an isolated child process (app/core/isolation.py). Each takes the
payload the service wrote and returns what goes into result.json.
"""

from pathlib import Path
from typing import Any, Dict, List

from app.exceptions.merge_split import InvalidMergeSplitInputError
from app.services.merge_split.common import bundle, family_of, stem


def inspect(payload: Dict[str, Any]) -> Dict[str, Any]:
    path, family, work = Path(payload["input"]), payload["family"], Path(payload["work"])
    if family == "pdf":
        from app.services.merge_split import pdf

        info = pdf.inspect(path)
    elif family == "word":
        from app.services.merge_split import word

        info = word.inspect(path, work)
    elif family == "slides":
        from app.services.merge_split import slides

        info = slides.inspect(path, work)
    elif family == "sheet":
        from app.services.merge_split import sheets

        info = sheets.inspect(path, work)
    else:
        from app.services.merge_split import media

        info = media.inspect(path, family)
    return {"info": info}


def split(payload: Dict[str, Any]) -> Dict[str, Any]:
    path, family, plan = Path(payload["input"]), payload["family"], payload["plan"]
    work = Path(payload["work"])
    name = stem(payload["name"])
    out_dir = work / "parts"
    if family == "pdf":
        from app.services.merge_split import pdf

        files, notes = pdf.split(path, plan, out_dir, name)
    elif family == "word":
        from app.services.merge_split import word

        files, notes = word.split(path, plan, out_dir, name, work)
    elif family == "slides":
        from app.services.merge_split import slides

        files, notes = slides.split(path, plan, out_dir, name, work)
    elif family == "sheet":
        from app.services.merge_split import sheets

        files, notes = sheets.split(path, plan, out_dir, name, work)
    else:
        from app.services.merge_split import media

        files, notes = media.split(path, plan, out_dir, name, family)
    archive = bundle(files, work / f"{name}-split.zip")
    return {"path": str(archive), "notes": notes, "parts": len(files)}


def merge(payload: Dict[str, Any]) -> Dict[str, Any]:
    inputs: List[Dict[str, str]] = payload["inputs"]
    family, options = payload["family"], payload["options"]
    work = Path(payload["work"])
    paths = [Path(i["path"]) for i in inputs]
    names = [i["name"] for i in inputs]
    if any(family_of(n) != family for n in names):
        raise InvalidMergeSplitInputError("Merge files of one kind at a time.")
    out = work / "out" / f"{stem(names[0])}-merged.{payload['ext']}"
    out.parent.mkdir(parents=True, exist_ok=True)
    if family == "pdf":
        from app.services.merge_split import pdf

        result, notes = pdf.merge(paths, out, options, names)
    elif family == "word":
        from app.services.merge_split import word

        result, notes = word.merge(paths, out, options, work)
    elif family == "slides":
        from app.services.merge_split import slides

        result, notes = slides.merge(paths, out, options, work)
    elif family == "sheet":
        from app.services.merge_split import sheets

        result, notes = sheets.merge(paths, out, options, work)
    else:
        from app.services.merge_split import media

        result, notes = media.merge(paths, out, options, family, work)
    return {"path": str(result), "notes": notes, "parts": len(paths)}
