"""
Writes the universal converter's formats and routes for the frontend to ship with
(frontend/src/lib/universal-formats.json), so the format picker works instantly, even while a free
backend instance is still waking up. The page then asks the live server (/universal/formats) and
uses its answer, which leaves out anything that server can't do.

Run after changing formats.py or graph.py:
    cd backend
    .\\venv\\Scripts\\python.exe scripts\\export_universal_formats.py

Routes are planned as if every engine were installed (the production Docker image has them all).
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.universal.formats import CATEGORIES, FORMATS  # noqa: E402
from app.services.universal.graph import ENGINES, FORMAT_NEEDS, is_bundle, plan_all  # noqa: E402

OUT = ROOT.parent / "frontend" / "src" / "lib" / "universal-formats.json"


def main() -> None:
    every = {e.needs for e in ENGINES if e.needs} | set(FORMAT_NEEDS.values())
    caps = {k: True for k in every}
    order = list(FORMATS)
    routes = {}
    for fid in FORMATS:
        reach = plan_all(fid, caps)
        if reach:
            routes[fid] = [
                # [target, engines used, formats passed through, may come as a ZIP]
                [t, [s.label for s in steps], [s.target for s in steps[:-1]], int(is_bundle(steps))]
                for t, steps in sorted(reach.items(), key=lambda kv: order.index(kv[0]))
            ]
    data = {
        "categories": [[c, label] for c, label in CATEGORIES],
        "formats": [[f.id, f.label, f.category, f.extensions] for f in FORMATS.values()],
        "routes": routes,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    pairs = sum(len(v) for v in routes.values())
    print(f"{len(FORMATS)} formats, {len(routes)} readable, {pairs} conversions → {OUT}")


if __name__ == "__main__":
    main()
