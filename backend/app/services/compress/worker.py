"""
Runs inside an isolated child process (app/core/isolation.py). Every file is compressed on its own:
one that fails is reported and the others still come back. A result that isn't smaller than the
original is replaced by the original, so nothing ever grows.
"""

import logging
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict, List

from app.exceptions.base import AppBaseException
from app.exceptions.compress import CompressProcessingError

logger = logging.getLogger(__name__)


def compress(payload: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.compress.engines import ENGINES, AlreadySmall, kind_of

    level = payload["level"]
    work = Path(payload["work"])
    out_dir = work / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    report: List[Dict[str, Any]] = []
    produced: List[Path] = []
    first_error = None
    taken: set = set()
    for item in payload["inputs"]:
        src, name = Path(item["path"]), item["name"]
        before = src.stat().st_size
        kind = kind_of(name)
        entry: Dict[str, Any] = {"name": name, "kind": kind, "before": before}
        slot = out_dir / f"f{len(report)}"
        slot.mkdir()
        try:
            out, note = ENGINES[kind](src, slot, level, name)
            after = out.stat().st_size if out.is_file() else 0
            if not after or after >= before:
                out.unlink(missing_ok=True)
                out = slot / name
                shutil.copyfile(src, out)
                after, note = before, "Already as small as it gets, so it's unchanged."
            entry.update(after=after, note=note)
        except AlreadySmall as small:
            out = slot / name
            shutil.copyfile(src, out)
            entry.update(after=before, note=str(small))
        except AppBaseException as exc:
            entry.update(error=exc.detail)
            first_error = first_error or exc
            out = None
        except MemoryError:
            entry.update(error="It needs more memory than this server has.")
            out = None
        except Exception:
            logger.exception("Compressing %s failed", name)
            entry.update(error="It couldn't be compressed. It may be damaged.")
            out = None
        if out is not None:
            final = _unique_name(out.name, taken)
            entry["output"] = final
            produced.append(out.rename(out.with_name(final)) if final != out.name else out)
        report.append(entry)

    if not produced:
        if first_error is not None:
            raise first_error
        raise CompressProcessingError(report[0].get("error") or "Nothing could be compressed.")
    if len(payload["inputs"]) == 1:
        result = produced[0]
    else:
        result = work / "compressed.zip"
        # Stored, not deflated: the files inside are already as small as they get.
        with zipfile.ZipFile(result, "w", zipfile.ZIP_STORED) as zf:
            for f in produced:
                zf.write(f, arcname=f.name)
    return {"path": str(result), "files": report}


def _unique_name(name: str, taken: set) -> str:
    candidate, n = name, 2
    while candidate.lower() in taken:
        p = Path(name)
        candidate = f"{p.stem} ({n}){p.suffix}"
        n += 1
    taken.add(candidate.lower())
    return candidate
