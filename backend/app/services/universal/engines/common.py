"""Helpers every engine shares. Engines run inside the worker process (see ../worker.py)."""

import logging
import re
import shutil
import subprocess
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from app.exceptions.universal import UniversalConversionError

logger = logging.getLogger(__name__)


@dataclass
class Ctx:
    """What a step knows besides its input: the name to give results, and notes for the person."""

    stem: str
    source: str
    notes: List[str] = field(default_factory=list)
    # The person's fine-tuning (see schemas/universal.py ConvertOptions); set only for the last step.
    options: Dict[str, Any] = field(default_factory=dict)


def safe_stem(stem: str) -> str:
    stem = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", stem).strip(" .")
    return stem[:120] or "file"


def run(cmd: Sequence[str], timeout: int, cwd: Optional[Path] = None, what: str = "The converter") -> subprocess.CompletedProcess:
    """
    Runs a converter program with no console and no stdin. On timeout the program is killed
    (subprocess.run does that) and the person gets a plain message instead of a stack trace.
    """
    try:
        return subprocess.run(
            list(cmd),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=timeout,
            cwd=str(cwd) if cwd else None,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        raise UniversalConversionError(f"{what} took too long. Try a smaller file.")
    except FileNotFoundError:
        raise UniversalConversionError(f"{what} isn't installed on this server.")


def tail(data: bytes, n: int = 600) -> str:
    return data.decode("utf-8", errors="replace")[-n:]


def read_text(path: Path) -> str:
    """Text files arrive in all sorts of encodings; UTF-8 (with or without BOM) first, then the usual suspects."""
    raw = path.read_bytes()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def output(work: Path, ctx: Ctx, fmt: str) -> Path:
    work.mkdir(parents=True, exist_ok=True)
    return work / f"{safe_stem(ctx.stem)}.{fmt}"


def bundle(files: List[Path], dest: Path) -> Path:
    """Several results (pages, sheets, slides) in one ZIP, in order."""
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, arcname=f.name)
    return dest


def ensure(path: Path, what: str = "The result") -> Path:
    if not path.is_file() or path.stat().st_size == 0:
        raise UniversalConversionError(f"{what} came out empty. The file may be damaged.")
    return path


def fresh_copy(src: Path, work: Path, name: str) -> Path:
    """A private copy with a predictable name: some programs name their output after their input."""
    work.mkdir(parents=True, exist_ok=True)
    dest = work / name
    shutil.copyfile(src, dest)
    return dest
