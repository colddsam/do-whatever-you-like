"""What merge and split share: which family a file belongs to, how parts are chosen, and how they're named."""

import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config.merge_split import settings
from app.exceptions.merge_split import InvalidMergeSplitInputError, MergeSplitProcessingError

# Extensions by family. Files are merged with files of the same family only.
# Mirrored in frontend/src/lib/merge-split.ts.
FAMILIES: Dict[str, set] = {
    "pdf": {".pdf"},
    "word": {".docx", ".doc", ".odt", ".rtf", ".docm", ".dotx"},
    "slides": {".pptx", ".ppt", ".odp", ".pps", ".ppsx", ".pptm"},
    "sheet": {".xlsx", ".xls", ".ods", ".xlsm", ".csv", ".tsv"},
    "audio": {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma", ".aiff", ".aif", ".weba", ".amr"},
    "video": {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".wmv", ".flv", ".3gp", ".mpeg", ".mpg", ".mts", ".m2ts", ".ogv"},
}
NOUNS = {"pdf": "PDFs", "word": "Word documents", "slides": "presentations", "sheet": "spreadsheets", "audio": "audio files", "video": "videos"}


def family_of(filename: Optional[str]) -> Optional[str]:
    ext = Path(filename or "").suffix.lower()
    return next((fam for fam, exts in FAMILIES.items() if ext in exts), None)


def safe_name(text: str, limit: int = 80) -> str:
    text = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", str(text)).strip(" .")
    return text[:limit].strip(" .") or "part"


def stem(filename: str) -> str:
    return safe_name(Path(filename).stem, 100) or "file"


def unique(folder: Path, name: str) -> Path:
    """`name` inside `folder`, with (2), (3)… when it's taken (two sheets or headings with the same title)."""
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    n = 2
    while path.exists():
        path = folder / f"{Path(name).stem} ({n}){Path(name).suffix}"
        n += 1
    return path


def _range(text: str, total: int, noun: str) -> range:
    a, sep, b = (s.strip() for s in text.partition("-"))
    if not a.isdigit() or (sep and not b.isdigit()):
        raise InvalidMergeSplitInputError(f"'{text}' isn't a {noun} number or range. Write ranges like 1-3, 5.")
    first, last = int(a), int(b) if sep else int(a)
    if first < 1 or last > total or first > last:
        raise InvalidMergeSplitInputError(f"'{text}' is outside {total} {noun}{'s' if total != 1 else ''}.")
    return range(first - 1, last)


def groups(plan: Dict[str, Any], total: int, noun: str) -> List[List[int]]:
    """
    Which units (pages, slides, page breaks…) go in which part, 0-based.
    each: one per unit · every: n at a time · ranges: "1-3, 5" (commas make parts, + joins ranges into one part).
    """
    if total < 1:
        raise InvalidMergeSplitInputError(f"There are no {noun}s to split.")
    mode = plan.get("mode", "each")
    if mode == "each":
        out = [[i] for i in range(total)]
    elif mode == "every":
        n = int(plan.get("n") or 0)
        if n < 1:
            raise InvalidMergeSplitInputError(f"Say how many {noun}s go in each part.")
        out = [list(range(i, min(i + n, total))) for i in range(0, total, n)]
    elif mode == "ranges":
        text = str(plan.get("ranges") or "").strip()
        parts = [p.strip() for p in text.split(",") if p.strip()]
        if not parts:
            raise InvalidMergeSplitInputError(f"Type the {noun}s for each part, like 1-3, 4-6.")
        out = [[i for piece in part.split("+") for i in _range(piece, total, noun)] for part in parts]
    else:
        raise InvalidMergeSplitInputError("Pick how to split the file.")
    if len(out) < 2 and mode != "ranges":
        raise InvalidMergeSplitInputError(f"That would leave everything in one part. There {'is' if total == 1 else 'are'} {total} {noun}{'s' if total != 1 else ''}.")
    return limit_parts(out)


def limit_parts(parts: list) -> list:
    if len(parts) > settings.MAX_PARTS:
        raise InvalidMergeSplitInputError(f"That makes {len(parts)} parts; the most is {settings.MAX_PARTS}. Put more in each part.")
    return parts


def label(idx: List[int]) -> str:
    """[0,1,2,4] → '1-3_5' (1-based), for file names."""
    runs: List[List[int]] = []
    for i in idx:
        if runs and i == runs[-1][1] + 1:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    return "_".join(f"{a + 1}" if a == b else f"{a + 1}-{b + 1}" for a, b in runs)


def bundle(files: List[Path], dest: Path) -> Path:
    if not files:
        raise MergeSplitProcessingError("Nothing came out of the split.")
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, arcname=f.name)
    return dest


def ensure(path: Path, what: str = "The result") -> Path:
    if not path.is_file() or path.stat().st_size == 0:
        raise MergeSplitProcessingError(f"{what} came out empty. A file may be damaged.")
    return path
