"""PDFs go through the same engine as Merge PDF and Split PDF (services/pdf.py), not a copy of it."""

from pathlib import Path
from typing import Any, Dict, List, Tuple

import pymupdf

from app.exceptions.merge_split import InvalidMergeSplitInputError
from app.services.merge_split.common import ensure, groups, label, unique
from app.services.pdf import pdf_service


def _pages(path: Path) -> int:
    try:
        with pymupdf.open(str(path)) as doc:
            if doc.needs_pass:
                raise InvalidMergeSplitInputError(f"'{path.name}' is password-protected. Unlock it first.")
            return doc.page_count
    except InvalidMergeSplitInputError:
        raise
    except Exception as exc:
        raise InvalidMergeSplitInputError(f"'{path.name}' couldn't be opened as a PDF. It may be damaged.") from exc


def inspect(path: Path) -> Dict[str, Any]:
    return {"family": "pdf", "units": _pages(path)}


def split(path: Path, plan: Dict[str, Any], out_dir: Path, name: str) -> Tuple[List[Path], List[str]]:
    chosen = groups(plan, _pages(path), "page")
    # The PDF engine's own syntax: commas between parts, + joining ranges inside one.
    ranges = ", ".join(label(units).replace("_", "+") for units in chosen)
    parts = pdf_service.split_pdf(path, out_dir / "raw", ranges, path.name)
    files = []
    for units, part in zip(chosen, parts):
        files.append(ensure(part.replace(unique(out_dir, f"{name}-pages-{label(units)}.pdf")), "A part"))
    return files, []


def merge(paths: List[Path], out: Path, options: Dict[str, Any], names: List[str]) -> Tuple[Path, List[str]]:
    return ensure(pdf_service.merge_pdfs(paths, out, names)), []
