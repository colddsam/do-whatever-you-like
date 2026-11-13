"""
Which fonts a document uses, whether they're embedded, and the embedded font files themselves
where they can be recovered (so they open straight in the Font checker).

- PDF: every font object (PyMuPDF): subset or not, embedded or not, on which pages; embedded
  TrueType/OpenType programs extracted.
- Word (DOCX): fontTable.xml, run fonts, theme fonts; embedded fonts de-obfuscated (ECMA-376 §17.8.1).
- PowerPoint (PPTX), Excel (XLSX): theme fonts and the fonts runs and styles use; PowerPoint's
  embedded-font list.
- OpenDocument (ODT/ODS/ODP): font-face declarations and fonts packed inside.
- EPUB: CSS font families and packed fonts, de-obfuscated when the IDPF algorithm was used.
- HTML, CSS, SVG: font-family declarations and @font-face sources.
"""

import hashlib
import re
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree as ET

from app.exceptions.fonts import InvalidFontsInputError

MAX_EMBEDDED_BYTES = 20 * 1024 * 1024
SFNT = (b"\x00\x01\x00\x00", b"OTTO", b"true", b"wOFF", b"wOF2", b"ttcf")
GENERIC = {"serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit", "initial", "unset", "emoji", "math", "ui-sans-serif", "ui-serif", "ui-monospace"}


class Found:
    def __init__(self) -> None:
        self.fonts: Dict[str, Dict[str, Any]] = {}
        self.files: List[Dict[str, Any]] = []
        self.budget = MAX_EMBEDDED_BYTES

    def add(self, name: str, **info: Any) -> Dict[str, Any]:
        name = name.strip().strip("'\"")
        if not name or name.lower() in GENERIC:
            return {}
        key = name.lower()
        f = self.fonts.setdefault(key, {"name": name, "type": None, "embedded": False, "subset": False, "uses": 0, "where": [], "file": None})
        for k, v in info.items():
            if k == "where":
                if v and v not in f["where"]:
                    f["where"].append(v)
            elif k == "uses":
                f["uses"] += v
            elif v is not None and (f.get(k) in (None, False) or k == "file"):
                f[k] = v
        return f

    def attach(self, name: str, data: bytes, ext: str) -> Optional[int]:
        if not data or len(data) > self.budget:
            return None
        self.budget -= len(data)
        self.files.append({"name": name, "ext": ext, "data": data})
        return len(self.files) - 1


def scan(path: Path, display: str) -> Dict[str, Any]:
    ext = Path(display).suffix.lower()
    found = Found()
    if ext == ".pdf" or path.read_bytes()[:5] == b"%PDF-":
        _pdf(path, found)
        kind = "PDF"
    elif ext in (".docx", ".docm", ".dotx"):
        _docx(path, found)
        kind = "Word document"
    elif ext in (".pptx", ".ppsx", ".pptm"):
        _pptx(path, found)
        kind = "PowerPoint"
    elif ext in (".xlsx", ".xlsm"):
        _xlsx(path, found)
        kind = "Excel workbook"
    elif ext in (".odt", ".ods", ".odp", ".odg"):
        _odf(path, found)
        kind = "OpenDocument"
    elif ext == ".epub":
        _epub(path, found)
        kind = "EPUB"
    elif ext in (".html", ".htm", ".css", ".svg", ".xhtml"):
        _css_text(path.read_text(encoding="utf-8", errors="replace"), found, ext[1:].upper())
        kind = ext[1:].upper()
    else:
        raise InvalidFontsInputError("Fonts can be listed from PDF, Word, PowerPoint, Excel, OpenDocument, EPUB, HTML, CSS and SVG files.")
    fonts = sorted(found.fonts.values(), key=lambda f: (-f["uses"], f["name"].lower()))
    return {"kind": kind, "fonts": fonts, "files": found.files}


# ---------- PDF ----------


def _pdf(path: Path, found: Found) -> None:
    import pymupdf

    try:
        doc = pymupdf.open(str(path))
    except Exception as exc:
        raise InvalidFontsInputError("That PDF couldn't be opened.") from exc
    if doc.needs_pass:
        raise InvalidFontsInputError("That PDF is password-protected. Unlock it first.")
    seen: Dict[int, Dict[str, Any]] = {}
    try:
        for pno in range(min(doc.page_count, 2000)):
            for xref, fext, ftype, basefont, _name, _enc, *_ in doc.get_page_fonts(pno, full=True):
                subset = bool(re.match(r"^[A-Z]{6}\+", basefont or ""))
                name = re.sub(r"^[A-Z]{6}\+", "", basefont or "") or f"Font {xref}"
                embedded = fext not in ("n/a", "")
                f = found.add(name, type=ftype, embedded=embedded, subset=subset, uses=1)
                if not f:
                    continue
                entry = seen.setdefault(xref, {"font": f, "pages": set(), "done": False})
                entry["pages"].add(pno + 1)
                if embedded and not entry["done"]:
                    entry["done"] = True
                    try:
                        _b, ext, _t, content = doc.extract_font(xref)
                    except Exception:
                        continue
                    if ext in ("ttf", "otf") and content[:4] in SFNT and f.get("file") is None:
                        f["file"] = found.attach(f"{name}.{ext}", content, ext)
        for v in seen.values():
            v["font"]["where"].append(_pages(sorted(v["pages"])))
    finally:
        doc.close()


def _pages(p: List[int]) -> str:
    runs, start, prev = [], p[0], p[0]
    for n in p[1:]:
        if n != prev + 1:
            runs.append(f"{start}" if start == prev else f"{start}–{prev}")
            start = n
        prev = n
    runs.append(f"{start}" if start == prev else f"{start}–{prev}")
    text = ", ".join(runs[:6]) + (" …" if len(runs) > 6 else "")
    return f"page {text}" if len(p) == 1 else f"pages {text}"


# ---------- Office Open XML ----------

NS_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
NS_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
NS_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _zip(path: Path) -> zipfile.ZipFile:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise InvalidFontsInputError("That file isn't a valid Office document. It may be damaged or password-protected.") from exc
    if sum(i.file_size for i in z.infolist()) > 1500 * 1024 * 1024:
        raise InvalidFontsInputError("That document unpacks to more than this server can handle.")
    return z


def _xml(z: zipfile.ZipFile, name: str) -> Optional[ET.Element]:
    try:
        data = z.read(name)
    except KeyError:
        return None
    if b"<!ENTITY" in data[:4096]:
        return None
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        return None


def _theme(z: zipfile.ZipFile, found: Found) -> None:
    for name in z.namelist():
        if re.search(r"theme/theme\d*\.xml$", name):
            root = _xml(z, name)
            if root is None:
                continue
            for role, label in (("majorFont", "theme heading font"), ("minorFont", "theme body font")):
                el = root.find(f".//{NS_A}{role}/{NS_A}latin")
                if el is not None and el.get("typeface"):
                    found.add(el.get("typeface"), where=label, type="Theme")


def _runs(z: zipfile.ZipFile, found: Found, pattern: str, where: str) -> None:
    counts: Counter = Counter()
    for name in z.namelist():
        if re.search(pattern, name):
            data = z.read(name)
            counts.update(m.decode("utf-8", "replace") for m in re.findall(rb'(?:w:ascii|w:hAnsi|w:cs|w:eastAsia|typeface)="([^"+][^"]*)"', data))
    for name, n in counts.items():
        found.add(name, uses=n, where=where)


def _docx(path: Path, found: Found) -> None:
    z = _zip(path)
    _theme(z, found)
    _runs(z, found, r"^word/(document|styles|header\d*|footer\d*|footnotes|endnotes)\.xml$", "text")
    table = _xml(z, "word/fontTable.xml")
    rels = {}
    rel_root = _xml(z, "word/_rels/fontTable.xml.rels")
    if rel_root is not None:
        rels = {r.get("Id"): r.get("Target") for r in rel_root}
    if table is None:
        return
    for el in table.findall(f"{NS_W}font"):
        name = el.get(f"{NS_W}name") or ""
        f = found.add(name, where="font table")
        for kind in ("embedRegular", "embedBold", "embedItalic", "embedBoldItalic"):
            emb = el.find(f"{NS_W}{kind}")
            if emb is None or not f:
                continue
            f["embedded"] = True
            target = rels.get(emb.get(f"{NS_R}id"))
            key = (emb.get(f"{NS_W}fontKey") or "").strip("{}").replace("-", "")
            if not target or len(key) != 32:
                continue
            try:
                data = bytearray(z.read("word/" + target.lstrip("/").replace("word/", "")))
            except KeyError:
                continue
            # ECMA-376: the first 32 bytes are XORed with the GUID's bytes, in reverse order.
            guid = bytes.fromhex(key)[::-1]
            for i in range(min(32, len(data))):
                data[i] ^= guid[i % 16]
            if bytes(data[:4]) in SFNT and f.get("file") is None:
                style = kind.replace("embed", "")
                f["file"] = found.attach(f"{name} {style}.ttf", bytes(data), "ttf")
                f["type"] = f.get("type") or "TrueType (embedded)"


def _pptx(path: Path, found: Found) -> None:
    z = _zip(path)
    _theme(z, found)
    _runs(z, found, r"^ppt/(slides/slide\d+|slideLayouts/slideLayout\d+|slideMasters/slideMaster\d+)\.xml$", "slides")
    pres = _xml(z, "ppt/presentation.xml")
    if pres is not None:
        for el in pres.iter("{http://schemas.openxmlformats.org/presentationml/2006/main}embeddedFont"):
            font = el.find("{http://schemas.openxmlformats.org/presentationml/2006/main}font")
            if font is not None and font.get("typeface"):
                found.add(font.get("typeface"), embedded=True, where="embedded in the deck")


def _xlsx(path: Path, found: Found) -> None:
    z = _zip(path)
    _theme(z, found)
    styles = z.read("xl/styles.xml") if "xl/styles.xml" in z.namelist() else b""
    for n, c in Counter(m.decode() for m in re.findall(rb'<name val="([^"]+)"', styles)).items():
        found.add(n, uses=c, where="cell styles")


# ---------- OpenDocument, EPUB, CSS ----------


def _odf(path: Path, found: Found) -> None:
    z = _zip(path)
    for part in ("content.xml", "styles.xml"):
        if part in z.namelist():
            data = z.read(part)
            for m in re.findall(rb'svg:font-family="([^"]+)"', data):
                found.add(m.decode("utf-8", "replace").replace("&apos;", ""), where="font declarations")
    for name in z.namelist():
        if name.startswith("Fonts/") and name.lower().endswith((".ttf", ".otf")):
            data = z.read(name)
            stem = Path(name).stem
            f = found.add(stem, embedded=True, where="packed in the file")
            if f and data[:4] in SFNT and f.get("file") is None:
                f["file"] = found.attach(Path(name).name, data, Path(name).suffix[1:].lower())


def _css_text(text: str, found: Found, where: str) -> None:
    for decl in re.findall(r"font-family\s*:\s*([^;}{\"]+(?:\"[^\"]*\"[^;}{]*)*)", text, flags=re.I):
        for part in decl.split(","):
            found.add(part.strip().strip("'\""), uses=1, where=where)
    for attr in re.findall(r'font-family="([^"]+)"', text):
        for part in attr.split(","):
            found.add(part, uses=1, where=where)


def _epub(path: Path, found: Found) -> None:
    z = _zip(path)
    obfuscated: Dict[str, str] = {}
    enc = _xml(z, "META-INF/encryption.xml")
    if enc is not None:
        for data in enc.iter("{http://www.w3.org/2001/04/xmlenc#}EncryptedData"):
            method = data.find("{http://www.w3.org/2001/04/xmlenc#}EncryptionMethod")
            ref = data.find(".//{http://www.w3.org/2001/04/xmlenc#}CipherReference")
            if method is not None and ref is not None:
                obfuscated[ref.get("URI", "")] = method.get("Algorithm", "")
    uid = _epub_uid(z)
    for name in z.namelist():
        low = name.lower()
        if low.endswith((".css", ".xhtml", ".html")):
            _css_text(z.read(name).decode("utf-8", "replace"), found, "styles")
        if low.endswith((".ttf", ".otf", ".woff", ".woff2")):
            data = bytearray(z.read(name))
            alg = obfuscated.get(name, "")
            if alg == "http://www.idpf.org/2008/embedding" and uid:
                key = hashlib.sha1(re.sub(r"\s", "", uid).encode()).digest()
                for i in range(min(1040, len(data))):
                    data[i] ^= key[i % 20]
            f = found.add(Path(name).stem, embedded=True, where="packed in the book")
            if f and bytes(data[:4]) in SFNT and f.get("file") is None:
                f["file"] = found.attach(Path(name).name, bytes(data), Path(name).suffix[1:].lower())


def _epub_uid(z: zipfile.ZipFile) -> Optional[str]:
    container = _xml(z, "META-INF/container.xml")
    if container is None:
        return None
    rootfile = container.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
    opf = _xml(z, rootfile.get("full-path")) if rootfile is not None else None
    if opf is None:
        return None
    uid_id = opf.get("unique-identifier")
    for el in opf.iter("{http://purl.org/dc/elements/1.1/}identifier"):
        if el.get("id") == uid_id or not uid_id:
            return (el.text or "").strip()
    return None
