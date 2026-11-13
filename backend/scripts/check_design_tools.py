"""
End-to-end check for the Font checker and the Colour picker backends.

Builds sample fonts and documents, runs every job through the real isolated worker
(python -m app.core.job_worker) and checks the results.

    python scripts/check_design_tools.py
"""

import base64
import io
import json
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from fontTools.ttLib import TTFont  # noqa: E402

ANTON = next(iter(sorted((ROOT / "app").rglob("*.ttf"))), None)
results = []


def run_job(entry: str, payload: dict, job: Path) -> dict:
    job.mkdir(parents=True, exist_ok=True)
    (job / "work").mkdir(exist_ok=True)
    payload = {**payload, "work": str(job / "work")}
    (job / "job.json").write_text(json.dumps({"entry": entry, "payload": payload, "result": str(job / "result.json")}), encoding="utf-8")
    t = time.monotonic()
    subprocess.run([sys.executable, "-m", "app.core.job_worker", str(job / "job.json")], cwd=str(ROOT), capture_output=True, timeout=600)
    r = json.loads((job / "result.json").read_text(encoding="utf-8"))
    r["took"] = time.monotonic() - t
    return r


def check(label: str, r: dict, test) -> None:
    problem = "" if r.get("ok") else f"failed: {r.get('detail')}"
    if not problem:
        try:
            problem = test(r) or ""
        except Exception as exc:
            problem = f"validator: {type(exc).__name__}: {exc}"
    results.append(not problem)
    print(f"{'PASS' if not problem else 'FAIL'}  {label:<46} {r.get('took', 0):5.1f}s  {problem}")


def main() -> int:
    base = Path(tempfile.mkdtemp(prefix="design-"))
    n = [0]

    def job() -> Path:
        n[0] += 1
        return base / f"job{n[0]}"

    font = ANTON or Path("C:/Windows/Fonts/arial.ttf")
    fonts = base / "fonts"
    fonts.mkdir()
    shutil.copy(font, fonts / "sample.ttf")
    f = TTFont(str(font))
    f.flavor = "woff2"
    f.save(str(fonts / "sample.woff2"))
    f.flavor = "woff"
    f.save(str(fonts / "sample.woff"))
    (fonts / "broken.ttf").write_bytes(font.read_bytes()[: len(font.read_bytes()) // 3])
    (fonts / "notafont.ttf").write_bytes(b"hello world" * 100)

    E = "app.services.fonts.worker:"
    for name, test in [
        ("sample.ttf", lambda r: "" if r["report"]["glyphs"] > 50 and r["report"]["checks"] and r["sfnt"] is None else "report"),
        ("sample.woff", lambda r: "" if r["report"]["file"]["format"] == "WOFF" else r["report"]["file"]),
        ("sample.woff2", lambda r: "" if r["report"]["file"]["format"] == "WOFF2" and TTFont(io.BytesIO(base64.b64decode(r["sfnt"]))).getBestCmap() else "sfnt"),
    ]:
        check(f"inspect {name}", run_job(E + "inspect", {"input": str(fonts / name), "name": name, "index": 0}, job()), test)
    for name in ("broken.ttf", "notafont.ttf"):
        r = run_job(E + "inspect", {"input": str(fonts / name), "name": name, "index": 0}, job())
        results.append(not r.get("ok") and r.get("status") == 400)
        print(f"{'PASS' if results[-1] else 'FAIL'}  inspect {name} is refused cleanly{'':<17} {r.get('took', 0):5.1f}s  {r.get('detail')}")
    ttc = Path("C:/Windows/Fonts/msgothic.ttc")
    if ttc.exists():
        shutil.copy(ttc, fonts / "coll.ttc")
        check("inspect collection, face 2", run_job(E + "inspect", {"input": str(fonts / "coll.ttc"), "name": "coll.ttc", "index": 1}, job()),
              lambda r: "" if len(r["report"]["faces"]) == 3 and r["report"]["face"] == 1 and r["sfnt"] else "faces")

    # --- documents ---
    docs = base / "docs"
    docs.mkdir()
    import pymupdf

    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_font(fontname="F0", fontfile=str(font))
    page.insert_text((72, 100), "Embedded font text", fontname="F0", fontsize=20)
    page.insert_text((72, 140), "Base-14 Helvetica", fontname="helv", fontsize=14)
    page.draw_rect(pymupdf.Rect(72, 200, 300, 300), color=(26 / 255, 115 / 255, 232 / 255), fill=(235 / 255, 74 / 255, 16 / 255))
    pdf.save(str(docs / "fonts.pdf"))
    check("document fonts: PDF", run_job(E + "document", {"input": str(docs / "fonts.pdf"), "name": "fonts.pdf"}, job()),
          lambda r: "" if any(x["embedded"] and x["file"] is not None for x in r["fonts"]) and any("Helvetica" in x["name"] and not x["embedded"] for x in r["fonts"])
          and TTFont(io.BytesIO(base64.b64decode(r["files"][0]["data"]))) else json.dumps(r["fonts"])[:300])

    # Word with an obfuscated embedded font (ECMA-376 17.8.1), built by hand.
    from docx import Document

    d = Document()
    run = d.add_paragraph().add_run("Hello in a custom font")
    run.font.name = "Sample Sans"
    d.save(str(docs / "plain.docx"))
    key = uuid.uuid4()
    data = bytearray(font.read_bytes())
    g = bytes.fromhex(key.hex)[::-1]
    for i in range(32):
        data[i] ^= g[i % 16]
    with zipfile.ZipFile(docs / "plain.docx") as zin, zipfile.ZipFile(docs / "embedded.docx", "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            buf = zin.read(item)
            if item.filename == "word/fontTable.xml":
                buf = buf.replace(
                    b"</w:fonts>",
                    f'<w:font w:name="Sample Sans"><w:embedRegular r:id="rIdF1" w:fontKey="{{{str(key).upper()}}}"/></w:font></w:fonts>'.encode(),
                )
                if b'xmlns:r=' not in buf[:600]:
                    buf = buf.replace(b"<w:fonts ", b'<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1)
            zout.writestr(item, buf)
        zout.writestr("word/fonts/font1.odttf", bytes(data))
        zout.writestr("word/_rels/fontTable.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.odttf"/></Relationships>')
    check("document fonts: Word, embedded (de-obfuscated)", run_job(E + "document", {"input": str(docs / "embedded.docx"), "name": "embedded.docx"}, job()),
          lambda r: "" if any(x["name"] == "Sample Sans" and x["embedded"] and x["file"] is not None for x in r["fonts"])
          and TTFont(io.BytesIO(base64.b64decode(r["files"][0]["data"]))).getBestCmap() else json.dumps(r["fonts"])[:300])

    from pptx import Presentation
    from pptx.dml.color import RGBColor

    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Quarterly review"
    s.shapes.title.text_frame.paragraphs[0].runs[0].font.name = "Georgia"
    s.shapes.title.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xEB, 0x4A, 0x10)
    prs.save(str(docs / "deck.pptx"))
    check("document fonts: PowerPoint", run_job(E + "document", {"input": str(docs / "deck.pptx"), "name": "deck.pptx"}, job()),
          lambda r: "" if {"Georgia", "Calibri"} <= {x["name"] for x in r["fonts"]} else [x["name"] for x in r["fonts"]])

    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    wb.active["A1"] = "Hi"
    wb.active["A1"].font = Font(name="Verdana", color="FF1A73E8")
    wb.active["A1"].fill = PatternFill("solid", fgColor="FF2F7D4F")
    wb.save(str(docs / "book.xlsx"))
    check("document fonts: Excel", run_job(E + "document", {"input": str(docs / "book.xlsx"), "name": "book.xlsx"}, job()),
          lambda r: "" if "Verdana" in {x["name"] for x in r["fonts"]} else [x["name"] for x in r["fonts"]])

    (docs / "page.html").write_text('<style>@font-face{font-family:"Brand";src:url(b.woff2)} h1{font-family:"Brand", Georgia, serif;color:#1a73e8} p{color:rgb(235,74,16)}</style><h1>Hi</h1>', encoding="utf-8")
    check("document fonts: HTML/CSS", run_job(E + "document", {"input": str(docs / "page.html"), "name": "page.html"}, job()),
          lambda r: "" if {"Brand", "Georgia"} <= {x["name"] for x in r["fonts"]} else [x["name"] for x in r["fonts"]])

    # --- colours ---
    P = "app.services.palette.engine:extract"
    check("colours: PDF (pages + exact vector/text colours)", run_job(P, {"input": str(docs / "fonts.pdf"), "name": "fonts.pdf"}, job()),
          lambda r: "" if r["pages"] and {"#eb4a10", "#1a73e8"} <= {c["hex"] for c in r["declared"]} else [c["hex"] for c in r["declared"]])
    check("colours: PowerPoint (theme + run colour, rendered)", run_job(P, {"input": str(docs / "deck.pptx"), "name": "deck.pptx"}, job()),
          lambda r: "" if r["pages"] and len(r["theme"]) >= 10 and "#eb4a10" in {c["hex"] for c in r["declared"]} else (len(r["pages"]), r["theme"][:3], r["declared"][:5]))
    check("colours: Excel", run_job(P, {"input": str(docs / "book.xlsx"), "name": "book.xlsx"}, job()),
          lambda r: "" if {"#1a73e8", "#2f7d4f"} <= {c["hex"] for c in r["declared"]} else r["declared"][:6])
    check("colours: HTML/CSS (declared only)", run_job(P, {"input": str(docs / "page.html"), "name": "page.html"}, job()),
          lambda r: "" if {"#1a73e8", "#eb4a10"} <= {c["hex"] for c in r["declared"]} else r["declared"])
    (docs / "art.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="100" height="100" fill="#2f7d4f"/><circle cx="150" cy="50" r="40" fill="#f5c518"/></svg>', encoding="utf-8")
    check("colours: SVG (rendered + declared)", run_job(P, {"input": str(docs / "art.svg"), "name": "art.svg"}, job()),
          lambda r: "" if r["pages"] and {"#2f7d4f", "#f5c518"} <= {c["hex"] for c in r["declared"]} else r)
    from PIL import Image

    Image.new("RGB", (300, 200), (26, 115, 232)).save(docs / "photo.tiff")
    check("colours: TIFF (rendered)", run_job(P, {"input": str(docs / "photo.tiff"), "name": "photo.tiff"}, job()),
          lambda r: "" if r["pages"] and r["pages"][0]["width"] == 300 else r["pages"][:1])
    from app.services.universal.graph import ffmpeg_path

    ff = ffmpeg_path()
    if ff:
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=3", "-pix_fmt", "yuv420p", str(docs / "clip.mp4")], check=True)
        check("colours: video (6 frames)", run_job(P, {"input": str(docs / "clip.mp4"), "name": "clip.mp4"}, job()), lambda r: "" if len(r["pages"]) == 6 else len(r["pages"]))
    (docs / "x.bin").write_bytes(b"\x00\x01")
    r = run_job(P, {"input": str(docs / "x.bin"), "name": "x.bin"}, job())
    results.append(not r.get("ok") and r.get("status") == 400)
    print(f"{'PASS' if results[-1] else 'FAIL'}  colours: unknown file refused cleanly{'':<11} {r.get('took', 0):5.1f}s  {r.get('detail')}")

    print(f"\n{sum(results)}/{len(results)} passed. Work folder: {base}")
    if all(results):
        shutil.rmtree(base, ignore_errors=True)
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
