"""
End-to-end check for merge/split, compress and the icon maker.

Builds sample files (Word, PowerPoint, Excel, CSV, PDF, audio, video, pictures, fonts, archives),
runs every job through the real isolated worker (python -m app.core.job_worker) and checks each
result with an independent reader: python-docx/python-pptx/openpyxl/PyMuPDF/ffprobe/Pillow, and
LibreOffice for merged Office files (if it can open them, Word/PowerPoint/Excel can too).

    python scripts/check_file_tools.py [--only merge|split|compress|icon] [--keep]
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image, ImageDraw  # noqa: E402

from app.services.convert import convert_service  # noqa: E402
from app.services.universal.graph import ffmpeg_path  # noqa: E402

FF = ffmpeg_path()
FFPROBE = str(Path(FF).with_name(Path(FF).name.replace("ffmpeg", "ffprobe"))) if FF else None
SOFFICE = convert_service.soffice()


# ---------------------------------------------------------------------------------------------- seeds


def picture(path: Path, size=(1600, 1000), text="Sample", alpha=False, noise=False) -> Path:
    img = Image.new("RGBA" if alpha else "RGB", size, (0, 0, 0, 0) if alpha else (230, 240, 250))
    d = ImageDraw.Draw(img)
    d.ellipse((size[0] * 0.2, size[1] * 0.1, size[0] * 0.8, size[1] * 0.9), fill=(26, 115, 232, 255))
    d.text((size[0] * 0.4, size[1] * 0.45), text, fill=(255, 255, 255, 255))
    if noise:
        import random

        px = img.load()
        for _ in range(size[0] * size[1] // 6):
            x, y = random.randrange(size[0]), random.randrange(size[1])
            px[x, y] = tuple(random.randrange(256) for _ in range(3)) + ((255,) if alpha else ())
    img.save(path)
    return path


def word(path: Path, title: str, chapters: int, image: Path) -> Path:
    from docx import Document
    from docx.shared import Inches

    doc = Document()
    doc.add_heading(title, 0)
    doc.add_paragraph("Introduction text before the first chapter.")
    for c in range(1, chapters + 1):
        doc.add_heading(f"Chapter {c}", 1)
        doc.add_paragraph(f"Chapter {c} body. " * 30)
        doc.add_heading(f"Section {c}.1", 2)
        doc.add_paragraph("Section text. " * 20)
        if c == 2:
            doc.add_picture(str(image), width=Inches(3))
            t = doc.add_table(rows=2, cols=2)
            t.cell(0, 0).text = "A"
            t.cell(1, 1).text = "D"
        doc.add_page_break()
    doc.save(str(path))
    return path


def slides(path: Path, n: int, image: Path, label: str) -> Path:
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    for i in range(n):
        layout = prs.slide_layouts[1 if i % 2 else 0]
        s = prs.slides.add_slide(layout)
        s.shapes.title.text = f"{label} slide {i + 1}"
        if i % 2:
            s.placeholders[1].text = f"Bullet for {label} {i + 1}"
        if i == 1:
            s.shapes.add_picture(str(image), Inches(1), Inches(3), width=Inches(3))
        s.notes_slide.notes_text_frame.text = f"Speaker notes {label} {i + 1}"
    prs.save(str(path))
    return path


def workbook(path: Path) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "Sales"
    ws.append(["Region", "Rep", "Amount", "Date"])
    regions = ["North", "South", "East", "West"]
    import datetime

    for i in range(1, 101):
        ws.append([regions[i % 4], f"Rep {i}", i * 10.5, datetime.date(2026, 1 + i % 12, 1 + i % 27)])
    ws["A1"].font = Font(bold=True, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor="1A73E8")
    ws.merge_cells("F1:G1")
    ws["F1"] = "Merged"
    ws["H2"] = "=SUM(C2:C101)"
    ws.column_dimensions["B"].width = 24
    ws2 = wb.create_sheet("Targets")
    ws2.append(["Region", "Target"])
    for r in regions:
        ws2.append([r, 1000])
    ws3 = wb.create_sheet("Notes")
    ws3["A1"] = "Hello"
    wb.save(str(path))
    return path


def csvs(folder: Path) -> list:
    a = folder / "jan.csv"
    a.write_text("Name,Amount,City\nAsha,10,Delhi\nBen,20,Pune\n=cmd,30,Goa\n", encoding="utf-8")
    b = folder / "feb.csv"
    b.write_text("name;amount;country\nCara;40;IN\nDev;50;US\n", encoding="utf-8")
    return [a, b]


def pdfs(folder: Path) -> list:
    import pymupdf

    out = []
    for name, pages in (("a.pdf", 6), ("b.pdf", 2)):
        doc = pymupdf.open()
        for i in range(pages):
            page = doc.new_page()
            page.insert_text((72, 72), f"{name} page {i + 1}", fontsize=24)
        doc.save(str(folder / name))
        out.append(folder / name)
    return out


def ffmpeg(*args) -> None:
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *args], check=True, timeout=120)


def media(folder: Path) -> dict:
    out = {}
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-b:a", "320k", str(folder / "tone.mp3"))
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=660:duration=8", str(folder / "beep.wav"))
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=12", "-f", "lavfi", "-i", "sine=duration=12",
           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(folder / "clip1.mp4"))
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=6", "-f", "lavfi", "-i", "sine=duration=6",
           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(folder / "clip2.mp4"))
    # Different size and no sound: merging it forces the re-encode path.
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(folder / "small.mp4"))
    for k in ("tone.mp3", "beep.wav", "clip1.mp4", "clip2.mp4", "small.mp4"):
        out[k] = folder / k
    return out


def lo_convert(src: Path, fmt: str, folder: Path) -> Path:
    local = folder / f"lo_{src.stem}_{fmt}"
    local.mkdir(exist_ok=True)
    return convert_service._soffice_convert(src, local, fmt)


# ---------------------------------------------------------------------------------------------- running


def run_job(entry: str, payload: dict, job_dir: Path, timeout: int = 900) -> dict:
    job_dir.mkdir(parents=True, exist_ok=True)
    job = {"entry": entry, "payload": payload, "result": str(job_dir / "result.json")}
    (job_dir / "job.json").write_text(json.dumps(job), encoding="utf-8")
    started = time.monotonic()
    proc = subprocess.run([sys.executable, "-m", "app.core.job_worker", str(job_dir / "job.json")], cwd=str(ROOT), capture_output=True, timeout=timeout)
    took = time.monotonic() - started
    rf = job_dir / "result.json"
    if not rf.exists():
        return {"ok": False, "detail": f"no result: {proc.stderr.decode(errors='replace')[-400:]}", "took": took}
    r = json.loads(rf.read_text(encoding="utf-8"))
    r["took"] = took
    return r


def staged(files, job_dir: Path) -> list:
    out = []
    for i, f in enumerate(files):
        dest = job_dir / f"in{i}{f.suffix.lower()}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, dest)
        out.append({"path": str(dest), "name": f.name})
    return out


# ---------------------------------------------------------------------------------------------- validating


def opens(path: Path) -> str:
    """'' if `path` opens with an independent reader, else the problem."""
    ext = path.suffix.lower()
    try:
        if ext == ".docx":
            from docx import Document

            Document(str(path))
        elif ext == ".pptx":
            from pptx import Presentation

            Presentation(str(path))
        elif ext == ".xlsx":
            from openpyxl import load_workbook

            load_workbook(str(path)).close()
        elif ext == ".pdf":
            import pymupdf

            with pymupdf.open(str(path)) as d:
                assert d.page_count > 0
        elif ext in (".mp3", ".wav", ".mp4", ".mkv", ".m4a", ".flac", ".ogg", ".opus"):
            assert duration(path) > 0.5
        elif ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".ico", ".icns", ".heic", ".avif"):
            if ext in (".heic", ".avif"):
                from pillow_heif import register_heif_opener

                register_heif_opener()
            Image.open(path).load()
        elif ext == ".csv":
            assert path.read_text(encoding="utf-8-sig").count("\n") >= 2
        elif ext == ".zip":
            with zipfile.ZipFile(path) as z:
                assert z.testzip() is None
        elif ext == ".woff2":
            from fontTools.ttLib import TTFont

            TTFont(str(path))
        elif ext == ".json":
            json.loads(path.read_text(encoding="utf-8"))
        elif ext == ".gz":
            import gzip

            gzip.open(path).read()
    except Exception as exc:
        return f"{path.name} doesn't open: {type(exc).__name__}: {exc}"
    return ""


def duration(path: Path) -> float:
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)], capture_output=True, timeout=60)
    return float(json.loads(out.stdout)["format"]["duration"])


def lo_opens(path: Path, folder: Path) -> str:
    """LibreOffice can turn it into a PDF with pages: a strict, independent check that the package is sound."""
    if not SOFFICE:
        return ""
    try:
        pdf = lo_convert(path, "pdf", folder)
        import pymupdf

        with pymupdf.open(str(pdf)) as d:
            return "" if d.page_count else "LibreOffice made an empty PDF"
    except Exception as exc:
        return f"LibreOffice couldn't open {path.name}: {exc}"


def unzip(path: Path, folder: Path) -> list:
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        z.extractall(folder)
        return [folder / n for n in z.namelist()]


# ---------------------------------------------------------------------------------------------- cases


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["merge", "split", "compress", "icon"])
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    base = Path(tempfile.mkdtemp(prefix="filetools-"))
    seeds = base / "seeds"
    seeds.mkdir()
    pic = picture(seeds / "photo.png", noise=False)
    a_docx, b_docx = word(seeds / "Report.docx", "Annual report", 3, pic), word(seeds / "Appendix.docx", "Appendix", 2, pic)
    a_pptx, b_pptx = slides(seeds / "Deck.pptx", 5, pic, "A"), slides(seeds / "Extra.pptx", 3, pic, "B")
    xlsx = workbook(seeds / "Sales.xlsx")
    jan, feb = csvs(seeds)
    a_pdf, b_pdf = pdfs(seeds)
    m = media(seeds) if FF else {}
    legacy = {}
    if SOFFICE:
        legacy["odt"] = lo_convert(b_docx, "odt", seeds)
        legacy["ppt"] = lo_convert(b_pptx, "ppt", seeds)
        legacy["xls"] = lo_convert(xlsx, "xls", seeds)

    results = []

    def check(label: str, entry: str, payload: dict, job: Path, validate) -> None:
        r = run_job(entry, payload, job)
        problem = "" if r.get("ok") else f"failed: {r.get('detail')}"
        if not problem:
            try:
                problem = validate(r) or ""
            except Exception as exc:  # a validator bug is a failure too
                problem = f"validator: {type(exc).__name__}: {exc}"
        results.append((label, not problem, problem, r.get("took", 0), r.get("notes")))
        print(f"{'PASS' if not problem else 'FAIL'}  {label:<48} {r.get('took', 0):6.1f}s  {problem}")

    n = [0]

    def jd() -> Path:
        n[0] += 1
        return base / f"job{n[0]}"

    E = "app.services.merge_split.worker:"

    if args.only in (None, "merge"):
        def merged(expect_ext, checks=None):
            def v(r):
                p = Path(r["path"])
                if p.suffix != expect_ext:
                    return f"expected {expect_ext}, got {p.name}"
                return opens(p) or (checks(p) if checks else "")
            return v

        def docx_check(p):
            from docx import Document

            d = Document(str(p))
            text = "\n".join(x.text for x in d.paragraphs)
            if "Annual report" not in text or "Appendix" not in text:
                return "merged document misses one of the inputs"
            return lo_opens(p, base)

        def pptx_check(expected):
            def c(p):
                from pptx import Presentation

                prs = Presentation(str(p))
                if len(prs.slides) != expected:
                    return f"{len(prs.slides)} slides, expected {expected}"
                titles = [s.shapes.title.text for s in prs.slides if s.shapes.title is not None]
                if "B slide 3" not in titles:
                    return "second deck's slides are missing"
                notes = [s.notes_slide.notes_text_frame.text for s in prs.slides if s.has_notes_slide]
                if not any("Speaker notes B" in t for t in notes):
                    return "speaker notes of the second deck were lost"
                names = zipfile.ZipFile(p).namelist()
                if len(names) != len(set(names)):
                    return "duplicate parts in the package"
                return lo_opens(p, base)
            return c

        for label, files, family, opts, ext, extra in [
            ("merge PDF", [a_pdf, b_pdf], "pdf", {}, ".pdf", lambda p: "" if __import__("pymupdf").open(str(p)).page_count == 8 else "page count"),
            ("merge Word (docx+docx)", [a_docx, b_docx], "word", {"page_breaks": True}, ".docx", docx_check),
            ("merge PowerPoint (pptx+pptx)", [a_pptx, b_pptx], "slides", {}, ".pptx", pptx_check(8)),
            ("merge Excel sheets (xlsx+csv)", [xlsx, jan], "sheet", {"mode": "sheets"}, ".xlsx",
             lambda p: "" if len(__import__("openpyxl").load_workbook(str(p)).sheetnames) == 4 else "sheet count"),
            ("merge CSV stack → csv", [jan, feb], "sheet", {"mode": "stack", "output": "csv"}, ".csv",
             lambda p: "" if p.read_text(encoding="utf-8-sig").count("\n") == 6 and "'=cmd" not in p.read_text(encoding="utf-8-sig") else "rows/escaping"),
            ("merge CSV stack → xlsx", [jan, feb], "sheet", {"mode": "stack"}, ".xlsx", lambda p: lo_opens(p, base)),
        ] + ([
            ("merge Word (docx+odt via LibreOffice)", [a_docx, legacy["odt"]], "word", {}, ".docx", docx_check),
            ("merge PowerPoint (pptx+ppt via LibreOffice)", [a_pptx, legacy["ppt"]], "slides", {}, ".pptx", pptx_check(8)),
            ("merge Excel (xlsx+xls via LibreOffice)", [xlsx, legacy["xls"]], "sheet", {"mode": "sheets"}, ".xlsx", lambda p: lo_opens(p, base)),
        ] if legacy else []) + ([
            ("merge audio (mp3+wav → mp3)", [m["tone.mp3"], m["beep.wav"]], "audio", {}, ".mp3", lambda p: "" if abs(duration(p) - 28) < 1 else f"length {duration(p)}"),
            ("merge video, same format (copy)", [m["clip1.mp4"], m["clip2.mp4"]], "video", {}, ".mp4", lambda p: "" if abs(duration(p) - 18) < 1 else f"length {duration(p)}"),
            ("merge video, mixed sizes (re-encode)", [m["clip2.mp4"], m["small.mp4"]], "video", {}, ".mp4", lambda p: "" if abs(duration(p) - 10) < 1 else f"length {duration(p)}"),
        ] if m else []):
            job = jd()
            from app.services.merge_split import merge_split_service

            ext_ = merge_split_service.merged_ext(family, [f.name for f in files], opts)
            check(label, E + "merge", {"inputs": staged(files, job), "family": family, "options": opts, "ext": ext_, "work": str(job / "work")}, job, merged(ext, extra))

    if args.only in (None, "split"):
        def parts(expected, ext, each=None):
            def v(r):
                files = unzip(Path(r["path"]), Path(r["path"]).parent / "unz")
                if len(files) != expected:
                    return f"{len(files)} parts, expected {expected}: {[f.name for f in files][:6]}"
                for f in files:
                    if f.suffix != ext:
                        return f"part {f.name} isn't {ext}"
                    problem = opens(f) or (each(f) if each else "")
                    if problem:
                        return problem
                return ""
            return v

        def pptx_slides(k):
            return lambda f: "" if len(__import__("pptx").Presentation(str(f)).slides) == k else f"{f.name} has the wrong number of slides"

        def small_pptx(f):
            # A one-slide part without a picture mustn't carry the deck's picture.
            from pptx import Presentation

            prs = Presentation(str(f))
            pics = any(n.startswith("ppt/media/") for n in zipfile.ZipFile(f).namelist())
            title = prs.slides[0].shapes.title.text
            return "" if pics == (title == "A slide 2") else f"{f.name}: picture carried wrongly"

        cases = [
            ("split PDF each page", a_pdf, "pdf", {"mode": "each"}, parts(6, ".pdf")),
            ("split PDF ranges 1-2, 3+5", a_pdf, "pdf", {"mode": "ranges", "ranges": "1-2, 3+5"}, parts(2, ".pdf")),
            ("split Word at Heading 1", a_docx, "word", {"by": "headings", "level": 1}, parts(4, ".docx")),
            ("split Word at Heading 2", a_docx, "word", {"by": "headings", "level": 2}, parts(7, ".docx")),
            ("split Word at page breaks", a_docx, "word", {"by": "breaks", "mode": "each"}, parts(3, ".docx")),
            ("split PowerPoint each slide", a_pptx, "slides", {"mode": "each"}, parts(5, ".pptx", small_pptx)),
            ("split PowerPoint every 2", a_pptx, "slides", {"mode": "every", "n": 2}, parts(3, ".pptx")),
            ("split PowerPoint ranges 1-3, 4-5", a_pptx, "slides", {"mode": "ranges", "ranges": "1-3, 4-5"}, parts(2, ".pptx", lambda f: "" if len(__import__("pptx").Presentation(str(f)).slides) in (2, 3) else "slides")),
            ("split Excel by sheet", xlsx, "sheet", {"by": "sheets"}, parts(3, ".xlsx", lambda f: lo_opens(f, base) if f.stem == "Sales" else "")),
            ("split Excel every 30 rows", xlsx, "sheet", {"by": "rows", "n": 30, "sheet": "Sales"}, parts(4, ".xlsx")),
            ("split Excel by Region column", xlsx, "sheet", {"by": "column", "column": 0, "sheet": "Sales"}, parts(4, ".xlsx")),
            ("split CSV every 2 rows", jan, "sheet", {"by": "rows", "n": 2}, parts(2, ".csv")),
        ]
        if legacy:
            cases.append(("split PPT (via LibreOffice) each slide", legacy["ppt"], "slides", {"mode": "each"}, parts(3, ".pptx")))
        if m:
            cases += [
                ("split MP3 every 5 s", m["tone.mp3"], "audio", {"by": "every", "seconds": 5}, parts(4, ".mp3")),
                ("split WAV into 2 parts", m["beep.wav"], "audio", {"by": "parts", "n": 2}, parts(2, ".wav")),
                ("split MP4 at 0:04, 0:08", m["clip1.mp4"], "video", {"by": "times", "times": "0:04, 0:08"}, parts(3, ".mp4")),
            ]
        for label, f, family, plan, v in cases:
            job = jd()
            s = staged([f], job)[0]
            check(label, E + "split", {"input": s["path"], "name": s["name"], "family": family, "plan": plan, "work": str(job / "work")}, job, v)

        # Inspect: what the split screen shows.
        for label, f, family, want in [("inspect Word", a_docx, "word", lambda i: i["headings"]["1"] == 4 and i["breaks"] == 3),
                                       ("inspect PowerPoint", a_pptx, "slides", lambda i: i["units"] == 5 and i["titles"][0] == "A slide 1"),
                                       ("inspect Excel", xlsx, "sheet", lambda i: [s["name"] for s in i["sheets"]] == ["Sales", "Targets", "Notes"] and i["sheets"][0]["rows"] == 100),
                                       ("inspect PDF", a_pdf, "pdf", lambda i: i["units"] == 6)] + ([("inspect MP3", m["tone.mp3"], "audio", lambda i: abs(i["duration"] - 20) < 1)] if m else []):
            job = jd()
            s = staged([f], job)[0]
            check(label, E + "inspect", {"input": s["path"], "name": s["name"], "family": family, "work": str(job / "work")}, job,
                  lambda r, want=want: "" if want(r["info"]) else f"unexpected: {json.dumps(r['info'])[:300]}")

    if args.only in (None, "compress"):
        big = picture(seeds / "big.jpg", (3000, 2000), noise=True)
        Image.open(big).save(seeds / "big.jpg", quality=98)
        Image.open(big).save(seeds / "scan.bmp")
        Image.open(big).save(seeds / "scan.tiff")
        try:
            from pillow_heif import register_heif_opener

            register_heif_opener()
            Image.open(big).save(seeds / "phone.heic", quality=95)
        except Exception:
            pass
        heavy_docx = word(seeds / "Heavy.docx", "Heavy", 2, seeds / "big.jpg")
        heavy_pptx = slides(seeds / "Heavy.pptx", 3, seeds / "big.jpg", "H")
        import pymupdf

        doc = pymupdf.open()
        for _ in range(3):
            page = doc.new_page()
            page.insert_image(page.rect, filename=str(seeds / "big.jpg"))
        doc.save(str(seeds / "Scanned.pdf"))
        (seeds / "data.json").write_text(json.dumps({"rows": [{"id": i, "name": f"Item {i}"} for i in range(500)]}, indent=4), encoding="utf-8")
        (seeds / "notes.txt").write_text("All work and no play. " * 4000, encoding="utf-8")
        with zipfile.ZipFile(seeds / "stored.zip", "w", zipfile.ZIP_STORED) as z:
            z.writestr("notes.txt", "Lots of text. " * 20000)
        font_src = next(iter(sorted((ROOT / "app").rglob("*.ttf"))), None)
        files = [seeds / "Scanned.pdf", seeds / "big.jpg", seeds / "scan.bmp", seeds / "scan.tiff", heavy_docx, heavy_pptx,
                 xlsx, seeds / "data.json", seeds / "notes.txt", seeds / "stored.zip"]
        if (seeds / "phone.heic").exists():
            files.append(seeds / "phone.heic")
        if font_src:
            files.append(font_src)
        if m:
            files += [m["tone.mp3"], m["beep.wav"], m["clip1.mp4"]]
        for level in ("light", "recommended", "strong"):
            for f in files:
                job = jd()

                def v(r, f=f):
                    out = Path(r["path"])
                    info = r["files"][0]
                    if "error" in info:
                        return info["error"]
                    if info["after"] > info["before"]:
                        return "got bigger"
                    return opens(out) or (lo_opens(out, base) if out.suffix in (".docx", ".pptx") else "")
                check(f"compress {level:<11} {f.name}", "app.services.compress.worker:compress",
                      {"inputs": staged([f], job), "level": level, "work": str(job / "work")}, job, v)
        # Several files at once, one of them broken: the rest still come back.
        broken = seeds / "broken.docx"
        broken.write_bytes(b"not a zip")
        job = jd()

        def several(r):
            names = zipfile.ZipFile(r["path"]).namelist()
            errs = [f for f in r["files"] if "error" in f]
            return "" if len(names) == 2 and len(errs) == 1 else f"zip {names}, errors {errs}"
        check("compress several, one broken", "app.services.compress.worker:compress",
              {"inputs": staged([seeds / "big.jpg", broken, seeds / "data.json"], job), "level": "recommended", "work": str(job / "work")}, job, several)

    if args.only in (None, "icon"):
        logo = picture(seeds / "logo.png", (1200, 900), alpha=True)
        svg = seeds / "logo.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="64mm" height="64mm" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="10" fill="#1a73e8"/></svg>', encoding="utf-8")

        def icon_pack(r):
            p = Path(r["path"])
            files = unzip(p, p.parent / "unz")
            names = {f.relative_to(p.parent / "unz").as_posix() for f in files}
            need = {"web/favicon.ico", "web/site.webmanifest", "windows/app.ico", "macos/app.icns", "ios/AppIcon.appiconset/Contents.json",
                    "android/res/mipmap-xxxhdpi/ic_launcher.png", "desktop/1024x1024.png", "web/paste-into-head.html"}
            missing = need - names
            if missing:
                return f"missing {missing}"
            ico = Image.open(p.parent / "unz" / "windows/app.ico")
            if {(16, 16), (32, 32), (48, 48), (256, 256)} - set(ico.info.get("sizes", ())):
                return f"app.ico sizes {ico.info.get('sizes')}"
            icns = Image.open(p.parent / "unz" / "macos/app.icns")
            if icns.size[0] < 512:
                return f"icns too small {icns.size}"
            contents = json.loads((p.parent / "unz" / "ios/AppIcon.appiconset/Contents.json").read_text())
            for img in contents["images"]:
                f = p.parent / "unz" / "ios/AppIcon.appiconset" / img["filename"]
                if not f.exists():
                    return f"Contents.json names a missing {img['filename']}"
                if Image.open(f).mode != "RGB":
                    return "iOS icon isn't opaque"
            for f in files:
                if f.suffix in (".png", ".ico", ".icns") and opens(f):
                    return opens(f)
            return ""
        allpacks = ["web", "windows", "macos", "ios", "android", "desktop"]
        for label, src, opts, v in [
            ("icon pack, all platforms, PNG", logo, {"mode": "pack", "packs": allpacks, "shape": "rounded", "padding": 0.08}, icon_pack),
            ("icon pack, all platforms, SVG (mm)", svg, {"mode": "pack", "packs": allpacks, "shape": "square", "padding": 0.0}, icon_pack),
            ("icon pack, circle on colour", logo, {"mode": "pack", "packs": allpacks, "shape": "circle", "padding": 0.12, "background": "#ffcc00"}, icon_pack),
            ("single .ico, 16/32/256", logo, {"mode": "ico", "sizes": [16, 32, 256]},
             lambda r: "" if set(Image.open(r["path"]).info["sizes"]) == {(16, 16), (32, 32), (256, 256)} else "sizes"),
        ]:
            job = jd()
            dest = job / f"source{src.suffix}"
            job.mkdir(parents=True)
            shutil.copyfile(src, dest)
            full = {"mode": "pack", "packs": ["web"], "sizes": [], "shape": "square", "padding": 0.0, "background": None, "name": None, **opts}
            check(label, "app.services.icon.engine:make", {"input": str(dest), "name": src.name, "options": full, "work": str(job / "work")}, job, v)

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed. Work folder: {base}")
    if not args.keep and not failed:
        shutil.rmtree(base, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
