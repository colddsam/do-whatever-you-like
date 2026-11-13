"""
The child side of app/core/isolation.py:

    python -m app.core.job_worker <job.json>

Imports the job's entry point, runs it with the payload and writes result.json:
{"ok": true, ...what the entry returned} or {"ok": false, "status", "detail"}.
"""

import importlib
import json
import logging
import sys
from pathlib import Path

from app.exceptions.base import AppBaseException


def main(job_file: str) -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    job = json.loads(Path(job_file).read_text(encoding="utf-8"))
    result_path = Path(job["result"])
    module_name, _, func_name = job["entry"].partition(":")
    try:
        fn = getattr(importlib.import_module(module_name), func_name)
        result = {"ok": True, **fn(job["payload"])}
    except AppBaseException as exc:
        result = {"ok": False, "status": exc.status_code, "detail": exc.detail}
    except MemoryError:
        result = {"ok": False, "status": 422, "detail": "That file needs more memory than this server has. Try a smaller one."}
    except Exception:
        logging.getLogger("job_worker").exception("Job %s crashed", job["entry"])
        result = {"ok": False, "status": 422, "detail": "That file couldn't be processed. It may be damaged, or in a variant we can't read."}
    result_path.write_text(json.dumps(result), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
