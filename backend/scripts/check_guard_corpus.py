"""
False-positive check for the upload guard: every real file in a folder (for example the samples and
outputs of scripts/check_universal.py, which cover every format the site handles) must pass the
guard under its own extension. Prints the ones that would be wrongly refused.

    python scripts/check_universal.py --out C:/tmp/ucheck      # makes the corpus
    python scripts/check_guard_corpus.py C:/tmp/ucheck
"""

import collections
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from starlette.datastructures import UploadFile  # noqa: E402

from app.core.file_guard import EXT_KINDS, _ext, check_upload  # noqa: E402
from app.exceptions.upload import UnsupportedFileError  # noqa: E402

folder = Path(sys.argv[1])
everything = set(EXT_KINDS)
seen = collections.Counter()
bad = []
for path in folder.rglob("*"):
    if not path.is_file() or path.stat().st_size == 0:
        continue
    ext = _ext(path.name)
    if ext not in everything:
        continue
    seen[ext] += 1
    with path.open("rb") as f:
        try:
            check_upload(UploadFile(f, filename=path.name), everything)
        except UnsupportedFileError as exc:
            bad.append((path.relative_to(folder), exc.detail))

print(f"{sum(seen.values())} real files in {len(seen)} formats checked")
print("formats:", " ".join(sorted(e.lstrip(".") for e in seen)))
missing = sorted(e.lstrip(".") for e in everything - set(seen))
print(f"formats with no sample here ({len(missing)}):", " ".join(missing))
for p, why in bad[:60]:
    print("WRONGLY REFUSED", p, "→", why)
print(f"\n{len(bad)} wrongly refused")
sys.exit(1 if bad else 0)
