"""
End-to-end check of the universal converter: builds a real sample of every input format, then runs
every route the server offers (source → target) through the actual worker process and validates
what comes out (PDFs open, images decode, JSON parses, archives list…).

    cd backend
    .\\venv\\Scripts\\python.exe scripts\\check_universal.py [--jobs 6] [--only docx,png] [--out DIR]

Exit code 0 only when every route passes.
"""

import argparse
import gzip
import io
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.universal.formats import FORMATS, stem_of  # noqa: E402
from app.services.universal.graph import capabilities, plan_all  # noqa: E402

# ------------------------------------------------------------------------------------------------
# Seed files written by hand
# ------------------------------------------------------------------------------------------------

TEXT_SEEDS = {
    "txt": "Quarterly report — café résumé ✓\n\nRevenue grew 12% to $4.2M.\n* not a list\n# not a heading\n",
    "md": "# Quarterly report\n\nRevenue grew **12%** to $4.2M — café ✓.\n\n## Regions\n\n| Region | Sales |\n|---|---|\n| North | 120 |\n| South | 95 |\n\n- Hiring\n- Launch\n\n```python\nprint('hi')\n```\n",
    "html": "<!doctype html><html><head><meta charset='utf-8'><title>Report</title></head><body><h1>Quarterly report</h1><p>Revenue grew <b>12%</b> — café ✓.</p><table><tr><th>Region</th><th>Sales</th></tr><tr><td>North</td><td>120</td></tr></table></body></html>",
    "rst": "Quarterly report\n================\n\nRevenue grew **12%** to $4.2M.\n\n* Hiring\n* Launch\n",
    "tex": "\\documentclass{article}\n\\begin{document}\n\\section{Quarterly report}\nRevenue grew \\textbf{12\\%} to \\$4.2M.\n\\begin{itemize}\\item Hiring\\item Launch\\end{itemize}\n\\end{document}\n",
    "org": "* Quarterly report\nRevenue grew *12%* to $4.2M.\n- Hiring\n- Launch\n",
    "adoc": "= Quarterly report\n\nRevenue grew *12%* to $4.2M.\n\n* Hiring\n* Launch\n",
    "textile": "h1. Quarterly report\n\nRevenue grew *12%* to $4.2M.\n\n* Hiring\n* Launch\n",
    "wiki": "= Quarterly report =\n\nRevenue grew '''12%''' to $4.2M.\n\n* Hiring\n* Launch\n",
    "typ": "= Quarterly report\n\nRevenue grew *12%* to \\$4.2M.\n\n- Hiring\n- Launch\n",
    "ipynb": json.dumps({
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Analysis\n", "Sales by region."]},
            {"cell_type": "code", "metadata": {}, "execution_count": 1, "outputs": [], "source": ["x = [1, 2, 3]\n", "print(sum(x))"]},
        ],
        "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}},
        "nbformat": 4, "nbformat_minor": 5,
    }),
    "csv": "name,city,amount,active\nAsha,Kolkata,1200.5,true\nBen,\"Austin, TX\",300,false\nChloé,Paris,,true\n",
    "tsv": "name\tcity\tamount\nAsha\tKolkata\t1200.5\nBen\tAustin\t300\n",
    "json": json.dumps({"data": [{"id": 1, "name": "Asha", "tags": ["a", "b"], "address": {"city": "Kolkata"}}, {"id": 2, "name": "Ben", "tags": [], "address": {"city": "Austin"}}], "meta": {"count": 2}}),
    "jsonl": '{"id": 1, "name": "Asha"}\n{"id": 2, "name": "Ben", "extra": true}\n',
    "xml": "<?xml version='1.0'?><catalog><book id='b1'><title>Dune</title><price>9.99</price></book><book id='b2'><title>Emma</title><price>5</price></book></catalog>",
    "yaml": "server:\n  host: example.com\n  ports: [80, 443]\ndefaults: &d\n  retries: 3\nservice:\n  <<: *d\n  name: api\n",
    "toml": "title = \"Config\"\n[server]\nhost = \"example.com\"\nports = [80, 443]\n[[users]]\nname = \"Asha\"\n[[users]]\nname = \"Ben\"\n",
    "srt": "1\n00:00:01,000 --> 00:00:03,000\nHello there.\n\n2\n00:00:04,000 --> 00:00:06,500\n<i>General Kenobi!</i>\n",
    "eml": (
        "From: Asha <asha@example.com>\nTo: Ben <ben@example.com>\nSubject: Quarterly numbers\nDate: Tue, 10 Nov 2026 10:00:00 +0000\n"
        "MIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=XYZ\n\n--XYZ\nContent-Type: text/html; charset=utf-8\n\n"
        "<p>Hi Ben,</p><p>Revenue grew <b>12%</b>.</p><script>alert(1)</script>\n--XYZ\nContent-Type: text/plain\n"
        "Content-Disposition: attachment; filename=notes.txt\n\nattached\n--XYZ--\n"
    ),
    "py": "def total(xs):\n    \"\"\"Sum with ``backticks``.\"\"\"\n    return sum(xs)\n\nprint(total([1, 2, 3]))\n",
    "sql": "SELECT name, SUM(amount) FROM sales GROUP BY name;\n",
}
CODE_SAMPLE = "// sample\nfunction add(a, b) { return a + b; }\n"
SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='120' viewBox='0 0 200 120'><rect width='200' height='120' fill='#f3f0e8'/><circle cx='60' cy='60' r='40' fill='#eb4a10'/><text x='110' y='70' font-size='24' font-family='sans-serif'>Hi</text></svg>"


def write_psd(path: Path, img) -> None:
    """A minimal flat RGB Photoshop file (uncompressed), enough for Pillow's reader."""
    img = img.convert("RGB")
    w, h = img.size
    data = io.BytesIO()
    data.write(b"8BPS" + struct.pack(">H6xHIIHH", 1, 3, h, w, 8, 3))
    data.write(struct.pack(">I", 0))  # colour mode data
    data.write(struct.pack(">I", 0))  # image resources
    data.write(struct.pack(">I", 0))  # layer and mask info
    data.write(struct.pack(">H", 0))  # raw image data
    for band in img.split():
        data.write(band.tobytes())
    path.write_bytes(data.getvalue())


def ffmpeg() -> str:
    from app.services.universal.graph import ffmpeg_path

    return ffmpeg_path()


def sh(cmd):
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{cmd[:4]}… failed: {proc.stderr.decode(errors='replace')[-400:]}")


def make_seeds(seeds: Path) -> None:
    from PIL import Image, ImageDraw

    seeds.mkdir(parents=True, exist_ok=True)
    for fid, text in TEXT_SEEDS.items():
        (seeds / f"report.{fid}").write_text(text, encoding="utf-8")
    for fid, fmt in FORMATS.items():
        if fmt.category == "code" and fid != "py":
            (seeds / f"report.{fid}").write_text(CODE_SAMPLE, encoding="utf-8")

    # Pictures, including text for OCR.
    img = Image.new("RGB", (900, 300), "white")
    d = ImageDraw.Draw(img)
    from PIL import ImageFont

    font = ImageFont.truetype(str(ROOT / "app/assets/fonts/NotoSans.ttf"), 56)
    d.text((40, 100), "Invoice 2026 total 4200", fill="black", font=font)
    img.save(seeds / "report.png")
    (seeds / "report.svg").write_text(SVG, encoding="utf-8")
    write_psd(seeds / "report.psd", img)
    import pillow_heif

    pillow_heif.register_heif_opener()
    img.save(seeds / "report.heic", quality=80)
    # An animation whose frames carry the same text, so reading it (OCR) has something to find.
    frames = [img.copy() for _ in range(3)]
    for i, f in enumerate(frames):
        ImageDraw.Draw(f).rectangle((0, 0, 60 * (i + 1), 20), fill="orange")
    frames[0].save(seeds / "report.gif", save_all=True, append_images=frames[1:], duration=200, loop=0)

    # Audio and video.
    ff = ffmpeg()
    sh([ff, "-y", "-hide_banner", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "2", str(seeds / "report.wav")])
    sh([ff, "-y", "-hide_banner", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3", "-f", "lavfi", "-i", "sine=duration=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(seeds / "report.mp4")])
    sh([ff, "-y", "-hide_banner", "-i", str(seeds / "report.wav"), "-ar", "8000", "-ac", "1", "-c:a", "libopencore_amrnb", "-b:a", "12.2k", str(seeds / "report.amr")])
    sh([ff, "-y", "-hide_banner", "-i", str(seeds / "report.wav"), "-c:a", "libopus", "-f", "webm", str(seeds / "report.weba")])
    sh([ff, "-y", "-hide_banner", "-i", str(seeds / "report.wav"), "-c:a", "flac", str(seeds / "report.mka")])
    sh([ff, "-y", "-hide_banner", "-i", str(seeds / "report.mp4"), "-c:v", "mpeg2video", "-c:a", "mp2", str(seeds / "report.mpeg")])
    sh([ff, "-y", "-hide_banner", "-i", str(seeds / "report.mp4"), "-c:v", "h263", "-s", "352x288", "-c:a", "libopencore_amrnb", "-ar", "8000", "-ac", "1", str(seeds / "report.3gp")])
    sh([ff, "-y", "-hide_banner", "-i", str(seeds / "report.mp4"), "-c", "copy", "-f", "mpegts", str(seeds / "report.mts")])
    sh([ff, "-y", "-hide_banner", "-i", str(seeds / "report.mp4"), "-c:v", "libtheora", "-c:a", "libvorbis", str(seeds / "report.ogv")])

    # Fonts and archives.
    shutil.copy(ROOT / "app/assets/fonts/Anton.ttf", seeds / "report.ttf")
    otf = next(Path("C:/Windows/Fonts").glob("*.otf"), None) if Path("C:/Windows/Fonts").is_dir() else None
    otf = otf or next(Path("/usr/share/fonts").rglob("*.otf"), None) if not otf else otf
    if otf:
        shutil.copy(otf, seeds / "report.otf")
    with zipfile.ZipFile(seeds / "report.zip", "w") as zf:
        zf.writestr("docs/readme.txt", "hello")
        zf.writestr("data/table.csv", TEXT_SEEDS["csv"])
        zf.writestr("../evil.txt", "should be skipped")
    with gzip.open(seeds / "report.csv.gz", "wb") as fh:
        fh.write(TEXT_SEEDS["csv"].encode())
    # A real drawing for LibreOffice Draw.
    from app.services.convert import convert_service

    out = convert_service._soffice_convert(seeds / "report.svg", seeds / "odg", "odg:draw8")
    shutil.move(str(out), seeds / "report.odg")
    shutil.rmtree(seeds / "odg", ignore_errors=True)


# Formats made from other seeds by the converter itself (source seed, target), in dependency order.
DERIVED = [
    ("md", "docx"), ("docx", "odt"), ("docx", "rtf"), ("docx", "doc"), ("md", "epub"), ("md", "fb2"),
    ("md", "pptx"), ("pptx", "ppt"), ("pptx", "odp"), ("csv", "xlsx"), ("xlsx", "xls"), ("xlsx", "ods"),
    ("png", "jpg"), ("png", "webp"), ("png", "bmp"), ("png", "tiff"), ("png", "ico"), ("png", "avif"),
    ("wav", "mp3"), ("wav", "ogg"), ("wav", "flac"), ("wav", "m4a"), ("wav", "aac"), ("wav", "opus"),
    ("wav", "wma"), ("wav", "aiff"), ("wav", "ac3"), ("mp4", "mkv"), ("mp4", "webm"), ("mp4", "mov"),
    ("mp4", "avi"), ("mp4", "wmv"), ("mp4", "flv"), ("mp4", "m4v"), ("srt", "vtt"), ("srt", "ass"),
    ("ttf", "woff"), ("ttf", "woff2"), ("zip", "7z"), ("zip", "tar"), ("zip", "tar.gz"), ("zip", "tar.bz2"),
    ("zip", "tar.xz"), ("html", "pdf"),
]
# Formats LibreOffice can write but that have no route of their own (templates, macro files, shows).
OFFICE_SEEDS = [("docx", "dotx", "dotx:MS Word 2007 XML Template"), ("docx", "docm", "docm:MS Word 2007 XML VBA"),
                ("xlsx", "xlsm", "xlsm:Calc MS Excel 2007 VBA XML"), ("pptx", "ppsx", "ppsx:Impress MS PowerPoint 2007 XML AutoPlay")]


def seed_path(seeds: Path, fid: str) -> Path:
    return seeds / ("report.csv.gz" if fid == "gz" else f"report.{fid}")


def run_job(seed: Path, source: str, target: str, base: Path, timeout: int = 900) -> dict:
    steps = plan_all(source)[target]
    job_dir = Path(tempfile.mkdtemp(prefix=f"{source.replace('.', '_')}-{target.replace('.', '_')}-", dir=base))
    src = job_dir / f"source.{source}"
    shutil.copy(seed, src)
    payload = {
        "input": str(src), "source": source, "stem": stem_of(seed.name, source),
        "steps": [{"source": s.source, "target": s.target, "engine": s.engine} for s in steps],
        "work": str(job_dir / "work"), "options": {},
    }
    job = {"entry": "app.services.universal.worker:execute", "payload": payload, "result": str(job_dir / "result.json")}
    (job_dir / "job.json").write_text(json.dumps(job), encoding="utf-8")
    started = time.monotonic()
    proc = subprocess.run([sys.executable, "-m", "app.core.job_worker", str(job_dir / "job.json")],
                          cwd=str(ROOT), capture_output=True, timeout=timeout)
    took = time.monotonic() - started
    result_file = job_dir / "result.json"
    if not result_file.exists():
        return {"ok": False, "detail": f"no result; exit {proc.returncode}; {proc.stderr.decode(errors='replace')[-300:]}", "took": took}
    result = json.loads(result_file.read_text(encoding="utf-8"))
    result["took"] = took
    result["route"] = " → ".join([source] + [s.target for s in steps])
    if result.get("ok"):
        problem = validate(Path(result["path"]), target)
        if problem:
            result.update(ok=False, detail=f"invalid output: {problem}")
    return result


def validate(path: Path, target: str) -> str:
    """Opens the result with an independent reader. Returns a problem, or '' if it's good."""
    if not path.is_file() or path.stat().st_size == 0:
        return "empty"
    data = path.read_bytes()
    try:
        if path.suffix == ".zip":
            with zipfile.ZipFile(path) as zf:
                bad = zf.testzip()
                names = zf.namelist()
                if bad or not names:
                    return f"bad zip ({bad})"
                if target != "zip" and not any(n.endswith(f".{target}") for n in names):
                    return f"zip without .{target}: {names[:3]}"
            return ""
        if target == "pdf":
            import pymupdf

            with pymupdf.open(path) as doc:
                return "" if doc.page_count > 0 else "no pages"
        if target in ("docx", "pptx", "xlsx", "xlsm", "docm", "dotx", "ppsx", "odt", "ods", "odp", "odg", "epub"):
            with zipfile.ZipFile(path) as zf:
                return "" if zf.testzip() is None else "corrupt container"
        if target in ("png", "jpg", "webp", "gif", "bmp", "tiff", "ico", "avif"):
            from PIL import Image

            with Image.open(path) as im:
                im.load()
                return "" if im.width and im.height else "no pixels"
        if target == "svg":
            return "" if b"<svg" in data[:5000] else "not svg"
        if target in ("json", "ipynb"):
            json.loads(data)
            return ""
        if target == "jsonl":
            for line in data.decode().splitlines():
                json.loads(line)
            return ""
        if target == "yaml":
            import yaml

            yaml.safe_load(data)
            return ""
        if target == "toml":
            import tomllib

            tomllib.loads(data.decode())
            return ""
        if target == "xml":
            import xml.etree.ElementTree as ET

            ET.fromstring(data)
            return ""
        if FORMATS[target].category in ("audio", "video"):
            from app.services.universal.engines.media import probe

            info = probe(path)
            want = "video" if FORMATS[target].category == "video" else "audio"
            return "" if info[want] and info["duration"] > 0 else f"no {want} stream"
        if target in ("ttf", "otf", "woff", "woff2"):
            from fontTools.ttLib import TTFont

            f = TTFont(str(path))
            want = {"woff": "woff", "woff2": "woff2"}.get(target)
            if f.flavor != want:
                return f"flavor {f.flavor}"
            if target == "ttf" and "glyf" not in f:
                return "ttf without glyf"
            return ""
        if target in ("7z",):
            import py7zr

            with py7zr.SevenZipFile(path) as sz:
                return "" if sz.getnames() else "empty 7z"
        if target.startswith("tar"):
            import tarfile

            with tarfile.open(path) as tf:
                return "" if tf.getnames() else "empty tar"
        if target in ("doc", "xls", "ppt"):
            return "" if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" else "not an OLE file"
        if target == "rtf":
            return "" if data.lstrip().startswith(b"{\\rtf") else "not rtf"
        # Text formats: must decode and have words in them.
        text = data.decode("utf-8")
        return "" if text.strip() else "blank text"
    except Exception as exc:
        return f"{type(exc).__name__}: {str(exc)[:120]}"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=str(Path(tempfile.gettempdir()) / "universal-check"))
    args = ap.parse_args()

    base = Path(args.out)
    shutil.rmtree(base, ignore_errors=True)
    seeds = base / "seeds"
    print("Engines:", capabilities())
    make_seeds(seeds)
    for source, target in DERIVED:
        r = run_job(seed_path(seeds, source), source, target, base)
        if not r.get("ok"):
            print(f"!! could not derive {target} from {source}: {r.get('detail')}")
            continue
        shutil.copy(r["path"], seeds / f"report.{target}")
    from app.services.convert import convert_service

    for source, target, filt in OFFICE_SEEDS:
        out = convert_service._soffice_convert(seeds / f"report.{source}", base / f"seed-{target}", filt)
        shutil.copy(out, seeds / f"report.{target}")

    only = set(filter(None, args.only.split(",")))
    pairs = []
    missing = []
    for source in FORMATS:
        if only and source not in only:
            continue
        routes = plan_all(source)
        if not routes:
            continue
        seed = seed_path(seeds, source)
        if not seed.exists():
            missing.append(source)
            continue
        pairs += [(seed, source, t) for t in routes]
    print(f"Running {len(pairs)} conversions from {len(pairs and {p[1] for p in pairs})} formats ({args.jobs} at a time)…")
    if missing:
        print("No sample for:", ", ".join(missing))

    failures, done, started = [], 0, time.monotonic()
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_job, seed, s, t, base): (s, t) for seed, s, t in pairs}
        for fut in as_completed(futures):
            s, t = futures[fut]
            done += 1
            try:
                r = fut.result()
            except Exception as exc:
                r = {"ok": False, "detail": repr(exc), "took": 0}
            if not r.get("ok"):
                failures.append((s, t, r.get("route", ""), r.get("detail")))
                print(f"FAIL {s} → {t} [{r.get('route', '')}]: {r.get('detail')}", flush=True)
            if done % 100 == 0:
                print(f"… {done}/{len(pairs)} ({time.monotonic() - started:.0f}s)", flush=True)
    print(f"\n{len(pairs) - len(failures)}/{len(pairs)} passed in {time.monotonic() - started:.0f}s")
    return 1 if failures or missing else 0


if __name__ == "__main__":
    sys.exit(main())
