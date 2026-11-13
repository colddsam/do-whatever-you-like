"""
Everything about one font (fontTools), plus the verdict browsers would give it (OTS, the OpenType
Sanitizer that Chrome and Firefox run on every web font).

The report is plain data for the Font checker page: names, metrics, embedding rights, tables,
OpenType features, variable axes, colour formats, script and language coverage, and a list of
checks that each pass, warn or fail with a reason a person can act on.
"""

import io
import os
import subprocess
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.exceptions.fonts import FontsProcessingError, InvalidFontsInputError

NAME_IDS = {
    0: "Copyright", 1: "Family", 2: "Style", 3: "Unique ID", 4: "Full name", 5: "Version", 6: "PostScript name",
    7: "Trademark", 8: "Manufacturer", 9: "Designer", 10: "Description", 11: "Vendor URL", 12: "Designer URL",
    13: "License", 14: "License URL", 16: "Typographic family", 17: "Typographic style", 18: "Compatible full name",
    19: "Sample text", 21: "WWS family", 22: "WWS style", 25: "Variations PostScript prefix",
}

FEATURES = {
    "aalt": "Access all alternates", "abvf": "Above-base forms", "abvm": "Above-base mark positioning", "abvs": "Above-base substitutions",
    "afrc": "Alternative fractions", "akhn": "Akhand", "blwf": "Below-base forms", "blwm": "Below-base mark positioning",
    "blws": "Below-base substitutions", "c2pc": "Petite capitals from capitals", "c2sc": "Small capitals from capitals",
    "calt": "Contextual alternates", "case": "Case-sensitive forms", "ccmp": "Glyph composition", "cjct": "Conjunct forms",
    "clig": "Contextual ligatures", "cpsp": "Capital spacing", "cswh": "Contextual swash", "curs": "Cursive positioning",
    "dist": "Distances", "dlig": "Discretionary ligatures", "dnom": "Denominators", "expt": "Expert forms",
    "fina": "Final forms", "frac": "Fractions", "fwid": "Full widths", "half": "Half forms", "haln": "Halant forms",
    "halt": "Alternate half widths", "hist": "Historical forms", "hlig": "Historical ligatures", "hwid": "Half widths",
    "init": "Initial forms", "isol": "Isolated forms", "ital": "Italics", "jalt": "Justification alternates",
    "kern": "Kerning", "liga": "Standard ligatures", "lnum": "Lining figures", "locl": "Localized forms",
    "mark": "Mark positioning", "medi": "Medial forms", "mgrk": "Mathematical Greek", "mkmk": "Mark to mark positioning",
    "nalt": "Alternate annotation forms", "nukt": "Nukta forms", "numr": "Numerators", "onum": "Oldstyle figures",
    "ordn": "Ordinals", "ornm": "Ornaments", "palt": "Proportional alternate widths", "pcap": "Petite capitals",
    "pnum": "Proportional figures", "pres": "Pre-base substitutions", "pstf": "Post-base forms", "psts": "Post-base substitutions",
    "pwid": "Proportional widths", "rand": "Randomize", "rclt": "Required contextual alternates", "rkrf": "Rakar forms",
    "rlig": "Required ligatures", "rphf": "Reph form", "rtla": "Right-to-left alternates", "rvrn": "Required variation alternates",
    "salt": "Stylistic alternates", "sinf": "Scientific inferiors", "smcp": "Small capitals", "subs": "Subscript",
    "sups": "Superscript", "swsh": "Swash", "titl": "Titling", "tnum": "Tabular figures", "unic": "Unicase",
    "vert": "Vertical alternates", "vkrn": "Vertical kerning", "vrt2": "Vertical rotation", "zero": "Slashed zero",
}
# Features a person may want to switch on or off in the type tester (the rest are applied by shaping).
OPTIONAL = {"dlig", "hlig", "smcp", "c2sc", "pcap", "c2pc", "onum", "lnum", "tnum", "pnum", "frac", "afrc", "sups", "subs", "sinf",
            "ordn", "zero", "case", "salt", "swsh", "cswh", "titl", "unic", "hist", "ornm", "liga", "calt", "kern", "clig", "ital", "cpsp"}

SCRIPTS: List[Tuple[str, List[Tuple[int, int]]]] = [
    ("Basic Latin", [(0x20, 0x7E)]), ("Latin-1 Supplement", [(0xA0, 0xFF)]), ("Latin Extended-A", [(0x100, 0x17F)]),
    ("Latin Extended-B", [(0x180, 0x24F)]), ("Latin Extended Additional", [(0x1E00, 0x1EFF)]), ("Greek", [(0x370, 0x3FF)]),
    ("Cyrillic", [(0x400, 0x4FF)]), ("Armenian", [(0x530, 0x58F)]), ("Hebrew", [(0x590, 0x5FF)]), ("Arabic", [(0x600, 0x6FF)]),
    ("Devanagari", [(0x900, 0x97F)]), ("Bengali", [(0x980, 0x9FF)]), ("Gurmukhi", [(0xA00, 0xA7F)]), ("Gujarati", [(0xA80, 0xAFF)]),
    ("Tamil", [(0xB80, 0xBFF)]), ("Telugu", [(0xC00, 0xC7F)]), ("Kannada", [(0xC80, 0xCFF)]), ("Malayalam", [(0xD00, 0xD7F)]),
    ("Thai", [(0xE00, 0xE7F)]), ("Georgian", [(0x10A0, 0x10FF)]), ("Hangul", [(0xAC00, 0xD7A3)]), ("Hiragana", [(0x3040, 0x309F)]),
    ("Katakana", [(0x30A0, 0x30FF)]), ("CJK Unified Ideographs", [(0x4E00, 0x9FFF)]), ("General Punctuation", [(0x2000, 0x206F)]),
    ("Currency Symbols", [(0x20A0, 0x20CF)]), ("Letterlike Symbols", [(0x2100, 0x214F)]), ("Arrows", [(0x2190, 0x21FF)]),
    ("Mathematical Operators", [(0x2200, 0x22FF)]), ("Box Drawing", [(0x2500, 0x257F)]), ("Geometric Shapes", [(0x25A0, 0x25FF)]),
    ("Emoji", [(0x1F300, 0x1F5FF), (0x1F600, 0x1F64F), (0x1F680, 0x1F6FF), (0x1F900, 0x1F9FF)]),
]

LANGUAGES: Dict[str, str] = {
    "English": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    "French": "àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ«»",
    "German": "äöüßÄÖÜ„“",
    "Spanish": "áéíñóúüÁÉÍÑÓÚÜ¿¡",
    "Portuguese": "ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ",
    "Italian": "àèéìòùÀÈÉÌÒÙ",
    "Dutch": "ĳĲëïéè",
    "Nordic (Danish, Norwegian, Swedish)": "æøåäöÆØÅÄÖ",
    "Polish": "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
    "Czech & Slovak": "áčďéěíňóřšťúůýžäľĺôŕÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ",
    "Hungarian": "áéíóöőúüűÁÉÍÓÖŐÚÜŰ",
    "Romanian": "ăâîșțĂÂÎȘȚ",
    "Turkish": "çğıöşüÇĞİÖŞÜ",
    "Vietnamese": "ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵĐ",
    "Russian": "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
    "Ukrainian": "ґєіїҐЄІЇ",
    "Greek": "αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩάέήίόύώ",
    "Hindi (Devanagari)": "अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसहािीुूेैोौं्",
    "Bengali": "অআইঈউঊএঐওঔকখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহািীুূেৈোৌং্",
    "Tamil": "அஆஇஈஉஊஎஏஐஒஓஔகஙசஞடணதநபமயரலவழளறன",
    "Arabic": "ابتثجحخدذرزسشصضطظعغفقكلمنهوي",
    "Hebrew": "אבגדהוזחטיכלמנסעפצקרשת",
    "Thai": "กขคงจฉชซญดตถทธนบปผพฟภมยรลวศสหอฮ",
    "Japanese (kana)": "あいうえおかきくけこさしすせそアイウエオカキクケコサシスセソ",
    "Chinese (common)": "的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年",
    "Korean (Hangul)": "가나다라마바사아자차카타파하한국어",
}


def _name(font, nid: int) -> Optional[str]:
    try:
        n = font["name"].getDebugName(nid)
        return n.strip() if n else None
    except Exception:
        return None


def _assigned(start: int, end: int) -> List[int]:
    return [c for c in range(start, end + 1) if unicodedata.category(chr(c)) not in ("Cn", "Co", "Cs")]


def _check(checks: List[dict], cid: str, level: str, title: str, detail: str = "") -> None:
    checks.append({"id": cid, "level": level, "title": title, "detail": detail})


def run_ots(path: Path) -> Tuple[bool, str]:
    try:
        import ots
    except ImportError:
        return True, "skipped"
    import tempfile

    fd, name = tempfile.mkstemp(suffix=".ots", dir=str(path.parent) if os.access(path.parent, os.W_OK) else None)
    os.close(fd)
    out = Path(name)
    try:
        r = subprocess.run([ots.OTS_SANITIZE, str(path), str(out)], capture_output=True, timeout=60,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        return False, "The browser sanitizer timed out on this font."
    finally:
        out.unlink(missing_ok=True)
    msg = (r.stderr or r.stdout or b"").decode("utf-8", "replace").strip()
    return r.returncode == 0, msg.replace("\r", "")[:600]


def open_font(path: Path, index: int = 0):
    from fontTools.ttLib import TTCollection, TTFont, TTLibError

    raw = path.read_bytes()[:4]
    try:
        if raw == b"ttcf":
            coll = TTCollection(str(path), lazy=True)
            faces = [f["name"].getDebugName(4) or f"Face {i + 1}" for i, f in enumerate(coll.fonts)]
            if not 0 <= index < len(faces):
                raise InvalidFontsInputError(f"This collection has {len(faces)} fonts; pick 1 to {len(faces)}.")
            return coll.fonts[index], faces
        return TTFont(str(path), lazy=True, recalcBBoxes=False, recalcTimestamp=False), None
    except InvalidFontsInputError:
        raise
    except (TTLibError, AssertionError, OSError, ValueError, KeyError, IndexError) as exc:
        raise InvalidFontsInputError("That file couldn't be read as a font. Is it a working TTF, OTF, WOFF or WOFF2?") from exc


def report(path: Path, display_name: str, index: int = 0) -> Dict[str, Any]:
    try:
        return _report(path, display_name, index)
    except (InvalidFontsInputError, FontsProcessingError):
        raise
    except Exception as exc:
        ok, msg = run_ots(path)
        why = msg.splitlines()[-1] if msg and not ok and msg != "skipped" else str(exc)[:120]
        raise InvalidFontsInputError(f"That font is damaged and couldn't be read ({why}).") from exc


def _report(path: Path, display_name: str, index: int = 0) -> Dict[str, Any]:
    font, faces = open_font(path, index)
    size = path.stat().st_size
    flavor = font.flavor or ("collection" if faces else None)
    tables = sorted(font.keys())
    checks: List[dict] = []

    # --- the browsers' verdict ---
    ok, msg = run_ots(path)
    if msg != "skipped":
        if ok:
            _check(checks, "ots", "pass", "Browsers accept it", "Passes the OpenType Sanitizer that Chrome and Firefox run on every web font.")
        else:
            _check(checks, "ots", "fail", "Browsers would reject it", f"The OpenType Sanitizer refused it: {msg.splitlines()[-1] if msg else 'unknown error'}. Chrome and Firefox won't load it as a web font.")

    required = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post"]
    missing = [t for t in required if t not in font]
    if missing:
        _check(checks, "tables", "fail", "Required tables are missing", ", ".join(missing))
    else:
        _check(checks, "tables", "pass", "All required tables are present", ", ".join(required))

    outline = "CFF2" if "CFF2" in font else "CFF (PostScript)" if "CFF " in font else "TrueType" if "glyf" in font else "Bitmap only" if ("CBDT" in font or "sbix" in font) else "None"
    head = font["head"] if "head" in font else None
    os2 = font["OS/2"] if "OS/2" in font else None
    hhea = font["hhea"] if "hhea" in font else None
    post = font["post"] if "post" in font else None
    upm = head.unitsPerEm if head else 1000

    # --- names ---
    names = [{"id": nid, "label": NAME_IDS.get(nid, f"Name {nid}"), "value": v} for nid in sorted({r.nameID for r in font["name"].names}) if (v := _name(font, nid))] if "name" in font else []
    family = _name(font, 16) or _name(font, 1) or Path(display_name).stem
    style = _name(font, 17) or _name(font, 2) or "Regular"
    if not _name(font, 1) or not _name(font, 4):
        _check(checks, "names", "fail", "Family or full name is missing", "Apps list fonts by these names; without them it may not show up in menus.")
    else:
        _check(checks, "names", "pass", "Names are set", f"{family} {style}")
    version = _name(font, 5) or ""
    if version and not version.lower().startswith("version "):
        _check(checks, "version", "warn", "Version string isn't in the usual form", f"“{version}”. The convention is “Version 1.000”, which some apps parse.")
    if head and version:
        import re

        m = re.search(r"(\d+)\.(\d+)", version)
        if m and abs(float(f"{m.group(1)}.{m.group(2)}") - round(head.fontRevision, 3)) > 0.002:
            _check(checks, "revision", "warn", "Version and revision disagree", f"The name says {m.group(0)}, the head table says {head.fontRevision:.3f}.")

    # --- cmap and characters ---
    cmap = font.getBestCmap() or {} if "cmap" in font else {}
    glyph_order = font.getGlyphOrder()
    glyph_count = len(glyph_order)
    if not cmap:
        _check(checks, "cmap", "fail", "No Unicode character map", "Text can't be typed in it: no characters are mapped to glyphs.")
    else:
        _check(checks, "cmap", "pass", f"{len(cmap):,} characters mapped", f"{glyph_count:,} glyphs in all.")
    if glyph_order and glyph_order[0] != ".notdef":
        _check(checks, "notdef", "warn", "The first glyph isn't .notdef", "The first glyph is shown for missing characters; it should be the .notdef box.")
    if 0x20 in cmap and 0xA0 in cmap and "hmtx" in font:
        sp, nb = font["hmtx"][cmap[0x20]][0], font["hmtx"][cmap[0xA0]][0]
        if sp != nb:
            _check(checks, "nbsp", "warn", "No-break space and space differ in width", f"Space is {sp} units wide, no-break space {nb}.")
    elif cmap and 0x20 not in cmap:
        _check(checks, "space", "fail", "There's no space character", "Words would run together.")

    # Printable letters with no outline at all (looks blank on screen).
    empty: List[str] = []
    try:
        gs = font.getGlyphSet()
        from fontTools.pens.boundsPen import ControlBoundsPen

        for cp, g in [(c, g) for c, g in cmap.items() if c < 0x3000][:1500]:
            ch = chr(cp)
            if unicodedata.category(ch)[0] in "LN" and g in gs:
                pen = ControlBoundsPen(gs)
                gs[g].draw(pen)
                if pen.bounds is None:
                    empty.append(ch)
    except Exception:
        pass
    if empty:
        _check(checks, "blank", "warn", f"{len(empty)} letters or digits are blank", "No outline for: " + " ".join(empty[:30]) + (" …" if len(empty) > 30 else ""))

    # --- embedding rights ---
    fs_type = os2.fsType if os2 else 0
    if fs_type & 0x0002 and not fs_type & 0x000C:
        emb = "Restricted: may not be embedded in documents"
        _check(checks, "fstype", "warn", "Embedding is restricted", "The font asks apps not to embed it in PDFs or documents (OS/2 fsType = restricted).")
    elif fs_type & 0x0004:
        emb = "Preview & print: documents open read-only"
    elif fs_type & 0x0008:
        emb = "Editable: documents can be edited"
    else:
        emb = "Installable: no restrictions"
    if fs_type & 0x0100:
        emb += " · no subsetting"
    if fs_type & 0x0200:
        emb += " · bitmap embedding only"

    # --- vertical metrics ---
    metrics: Dict[str, Any] = {"unitsPerEm": upm}
    if hhea:
        metrics.update(hheaAscender=hhea.ascent, hheaDescender=hhea.descent, hheaLineGap=hhea.lineGap)
    if os2:
        metrics.update(
            typoAscender=os2.sTypoAscender, typoDescender=os2.sTypoDescender, typoLineGap=os2.sTypoLineGap,
            winAscent=os2.usWinAscent, winDescent=os2.usWinDescent, xAvgCharWidth=os2.xAvgCharWidth,
            xHeight=getattr(os2, "sxHeight", None), capHeight=getattr(os2, "sCapHeight", None),
            weightClass=os2.usWeightClass, widthClass=os2.usWidthClass, vendor=str(os2.achVendID).strip(),
            useTypoMetrics=bool(os2.fsSelection & (1 << 7)),
        )
    if head:
        metrics.update(xMin=head.xMin, yMin=head.yMin, xMax=head.xMax, yMax=head.yMax)
    if post:
        metrics.update(italicAngle=post.italicAngle, underlinePosition=post.underlinePosition, underlineThickness=post.underlineThickness, isFixedPitch=bool(post.isFixedPitch))
    if os2 and hhea and head:
        if os2.usWinAscent < head.yMax or os2.usWinDescent < -head.yMin:
            _check(checks, "clip", "warn", "Tall glyphs may be clipped on Windows", f"winAscent/winDescent ({os2.usWinAscent}/{os2.usWinDescent}) don't cover the tallest glyphs ({head.yMax}/{-head.yMin}).")
        hh = hhea.ascent - hhea.descent + hhea.lineGap
        ty = os2.sTypoAscender - os2.sTypoDescender + os2.sTypoLineGap
        if abs(hh - ty) > upm * 0.02 and not metrics.get("useTypoMetrics"):
            _check(checks, "lineheight", "warn", "Line spacing differs between Mac and Windows", f"hhea gives {hh} units, typo metrics {ty}; set USE_TYPO_METRICS or make them match.")
        else:
            _check(checks, "lineheight", "pass", "Line spacing is consistent", f"{round((hhea.ascent - hhea.descent + hhea.lineGap) / upm, 2)} em between lines.")
    if not (16 <= upm <= 16384):
        _check(checks, "upm", "fail", "Units per em is out of range", f"{upm} (must be 16 to 16384).")

    # --- style consistency ---
    if os2 and head:
        bold_bit = bool(head.macStyle & 1) or bool(os2.fsSelection & (1 << 5))
        italic_bit = bool(head.macStyle & 2) or bool(os2.fsSelection & 1)
        sl = style.lower()
        if ("bold" in sl) != bold_bit and "semibold" not in sl and "extrabold" not in sl:
            _check(checks, "bold", "warn", "Bold flag doesn't match the style name", f"Style “{style}”, bold flag {'on' if bold_bit else 'off'}: apps may pick the wrong weight.")
        if ("italic" in sl or "oblique" in sl) != italic_bit:
            _check(checks, "italic", "warn", "Italic flag doesn't match the style name", f"Style “{style}”, italic flag {'on' if italic_bit else 'off'}.")
        if post and italic_bit and post.italicAngle == 0:
            _check(checks, "angle", "warn", "Italic with no slant angle", "post.italicAngle is 0; cursors and synthetic styles won't slant.")
    if post and post.isFixedPitch and "hmtx" in font:
        widths = {font["hmtx"][g][0] for cp, g in cmap.items() if 0x21 <= cp <= 0x7E}
        if len(widths) > 1:
            _check(checks, "mono", "warn", "Marked monospaced but widths vary", f"{len(widths)} different widths among the basic characters.")

    # --- layout: features, kerning, hinting ---
    features: Dict[str, dict] = {}
    scripts: set = set()
    for tag in ("GSUB", "GPOS"):
        if tag in font and font[tag].table.FeatureList:
            t = font[tag].table
            for rec in t.FeatureList.FeatureRecord:
                f = features.setdefault(rec.FeatureTag, {"tag": rec.FeatureTag, "name": FEATURES.get(rec.FeatureTag, ""), "table": tag, "optional": False})
                if rec.FeatureTag.startswith("ss") and rec.FeatureTag[2:].isdigit():
                    f["name"] = f"Stylistic set {int(rec.FeatureTag[2:])}"
                    params = getattr(rec.Feature, "FeatureParams", None)
                    if params is not None and getattr(params, "UINameID", None):
                        f["name"] = _name(font, params.UINameID) or f["name"]
                if rec.FeatureTag.startswith("cv") and rec.FeatureTag[2:].isdigit():
                    f["name"] = f"Character variant {int(rec.FeatureTag[2:])}"
                f["optional"] = rec.FeatureTag in OPTIONAL or rec.FeatureTag[:2] in ("ss", "cv")
            if t.ScriptList:
                scripts.update(r.ScriptTag for r in t.ScriptList.ScriptRecord)
    kerning = "kern" in features or "kern" in font
    _check(checks, "kern", "pass" if kerning else "warn", "Kerning is present" if kerning else "No kerning", "Letter pairs like AV and To are spaced individually." if kerning else "Pairs like AV and To may look gappy.")
    hinted = outline == "TrueType" and ("fpgm" in font or "prep" in font)
    if outline == "TrueType":
        _check(checks, "hint", "pass" if hinted else "info", "Hinted" if hinted else "Unhinted", "Has instructions for crisp small sizes on Windows." if hinted else "Fine on Mac, phones and high-DPI screens; may look softer on older Windows screens.")

    # --- variable fonts ---
    axes, instances = [], []
    if "fvar" in font:
        for a in font["fvar"].axes:
            axes.append({"tag": a.axisTag, "name": _name(font, a.axisNameID) or a.axisTag, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue})
        for inst in font["fvar"].instances:
            instances.append({"name": _name(font, inst.subfamilyNameID) or "Instance", "coordinates": inst.coordinates})

    color = [label for t, label in (("COLR", "COLR"), ("CPAL", "CPAL palettes"), ("SVG ", "SVG glyphs"), ("sbix", "sbix bitmaps"), ("CBDT", "CBDT bitmaps")) if t in font]
    if "COLR" in font:
        # The version is the table's first two bytes; decoding a big COLR just for it takes seconds.
        raw = font.reader["COLR"] if getattr(font, "reader", None) and "COLR" in font.reader else b"\x00\x00"
        color[color.index("COLR")] = f"COLR v{int.from_bytes(raw[:2], 'big')}"

    # --- coverage ---
    keys = set(cmap)
    coverage = []
    for script, ranges in SCRIPTS:
        assigned = [c for a, b in ranges for c in _assigned(a, b)]
        have = sum(1 for c in assigned if c in keys)
        if have:
            coverage.append({"name": script, "have": have, "total": len(assigned)})
    languages = []
    for lang, chars in LANGUAGES.items():
        need = [ord(c) for c in chars]
        have = sum(1 for c in need if c in keys)
        if have:
            languages.append({"name": lang, "supported": have == len(need), "missing": "".join(chr(c) for c in need if c not in keys)[:40]})
    latin = next((c for c in coverage if c["name"] == "Basic Latin"), None)
    if latin and latin["have"] < latin["total"]:
        miss = "".join(chr(c) for c in range(0x20, 0x7F) if c not in keys)
        _check(checks, "ascii", "warn", "Some basic characters are missing", f"Missing: {miss[:60]}")

    # --- licence ---
    lic = (_name(font, 13) or "") + " " + (_name(font, 14) or "")
    licence = "SIL Open Font License" if "open font license" in lic.lower() or "scripts.sil.org/ofl" in lic.lower() or "openfontlicense" in lic.lower() else \
        "Apache License" if "apache" in lic.lower() else "Ubuntu Font Licence" if "ubuntu font" in lic.lower() else (lic.strip()[:120] or None)

    # --- size as WOFF2: exact for small fonts; big ones are estimated (an exact pass takes minutes on a small CPU) ---
    woff2, woff2_exact = None, False
    if font.flavor != "woff2" and not faces:
        try:
            if size <= 700 * 1024:
                buf = io.BytesIO()
                font.flavor = "woff2"
                font.save(buf)
                woff2, woff2_exact = buf.tell(), True
            else:
                import brotli

                raw = path.read_bytes() if not font.flavor else None
                if raw is not None:
                    woff2 = int(len(brotli.compress(raw, quality=5)) * 0.93)
        except Exception:
            woff2 = None
        finally:
            font.flavor = flavor if flavor in ("woff", "woff2") else None

    order = {"fail": 0, "warn": 1, "info": 2, "pass": 3}
    checks.sort(key=lambda c: order[c["level"]])
    return {
        "file": {"name": display_name, "size": size, "format": {"woff": "WOFF", "woff2": "WOFF2", "collection": "Collection"}.get(flavor or "", "OpenType" if outline.startswith("CFF") else "TrueType"), "woff2_size": woff2, "woff2_exact": woff2_exact},
        "faces": faces,
        "face": index,
        "family": family,
        "style": style,
        "names": names,
        "outline": outline,
        "glyphs": glyph_count,
        "characters": len(cmap),
        "embedding": emb,
        "fs_type": fs_type,
        "licence": licence,
        "metrics": metrics,
        "tables": [{"tag": t, "size": len(font.reader[t]) if hasattr(font, "reader") and font.reader and t in font.reader else None} for t in tables if t != "GlyphOrder"],
        "features": sorted(features.values(), key=lambda f: (not f["optional"], f["tag"])),
        "scripts": sorted(scripts),
        "axes": axes,
        "instances": instances,
        "color": color,
        "coverage": coverage,
        "languages": sorted(languages, key=lambda l: (not l["supported"], l["name"])),
        "checks": checks,
        "summary": {k: sum(1 for c in checks if c["level"] == k) for k in ("pass", "warn", "fail", "info")},
    }


def to_sfnt(path: Path, out: Path, index: int = 0) -> Path:
    """The font as plain TTF/OTF (decompressed WOFF2, one face of a collection), for browsers and opentype.js."""
    font, _ = open_font(path, index)
    try:
        font.flavor = None
        font.save(str(out))
    except Exception as exc:
        raise FontsProcessingError("The font couldn't be unpacked.") from exc
    return out
