"""
Word documents (python-docx + docxcompose).

Split: a .docx has no fixed pages (Word lays them out when it opens the file), so it splits where the
document itself says: at headings, at page/section breaks, or at the pages Word recorded the last
time it saved the file. Each part keeps the original's styles, headers, footers and page setup, and
carries only the pictures it uses.

Merge: docxcompose appends documents keeping their styles, numbering, pictures and footnotes.
"""

import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.exceptions.merge_split import InvalidMergeSplitInputError, MergeSplitProcessingError
from app.services.merge_split.common import ensure, groups, label, limit_parts, safe_name, unique
from app.services.merge_split.office import as_ooxml

# Relationships a part may drop when none of its text uses them. Styles, numbering, headers and
# footers are never dropped: the page setup and every paragraph's look depend on them.
PRUNABLE = ("/image", "/chart", "/oleObject", "/package", "/hyperlink", "/diagramData", "/diagramLayout",
            "/diagramQuickStyle", "/diagramColors", "/diagramDrawing", "/video", "/audio", "/media")


def _open(path: Path):
    from docx import Document

    try:
        return Document(str(path))
    except Exception as exc:
        raise InvalidMergeSplitInputError(f"'{path.name}' couldn't be opened as a Word document. Is it damaged or password-protected?") from exc


def _qn(tag: str) -> str:
    from docx.oxml.ns import qn

    return qn(tag)


def _heading_levels(doc) -> Dict[str, int]:
    """Style id → heading level (Title counts as 1), from names and outline levels."""
    levels: Dict[str, int] = {}
    for style in doc.styles:
        try:
            sid, name = style.style_id, (style.name or "").strip().lower()
        except Exception:
            continue
        m = re.fullmatch(r"heading\s*(\d)", name)
        if m:
            levels[sid] = int(m.group(1))
        elif name == "title":
            levels[sid] = 1
        else:
            el = getattr(style, "element", None)
            lvl = el.find(f"{_qn('w:pPr')}/{_qn('w:outlineLvl')}") if el is not None else None
            if lvl is not None and str(lvl.get(_qn("w:val"), "9")).isdigit() and int(lvl.get(_qn("w:val"))) < 9:
                levels[sid] = int(lvl.get(_qn("w:val"))) + 1
    return levels


def _blocks(doc) -> Tuple[List[Any], Any]:
    body = doc.element.body
    sect = body.find(_qn("w:sectPr"))
    return [el for el in body if el is not sect], sect


def _level(el, levels: Dict[str, int]) -> Optional[int]:
    if el.tag != _qn("w:p"):
        return None
    ppr = el.find(_qn("w:pPr"))
    if ppr is None:
        return None
    lvl = ppr.find(_qn("w:outlineLvl"))
    if lvl is not None and str(lvl.get(_qn("w:val"), "9")).isdigit() and int(lvl.get(_qn("w:val"))) < 9:
        return int(lvl.get(_qn("w:val"))) + 1
    style = ppr.find(_qn("w:pStyle"))
    return levels.get(style.get(_qn("w:val"))) if style is not None else None


def _text(el) -> str:
    return "".join(t.text or "" for t in el.iter(_qn("w:t"))).strip()


def _starts(doc, how: str, level: int = 1) -> Tuple[List[int], List[str]]:
    """Indexes of the blocks that open a new part, and a title for each part."""
    blocks, _ = _blocks(doc)
    starts, titles = [0], [""]
    if how == "headings":
        levels = _heading_levels(doc)
        for i, el in enumerate(blocks):
            lv = _level(el, levels)
            if lv is not None and lv <= level and _text(el):
                if not any(_text(b) for b in blocks[starts[-1]:i]):
                    titles[-1] = _text(el)  # Nothing written before it: this heading names the current part.
                else:
                    starts.append(i)
                    titles.append(_text(el))
    else:
        page_br = f".//{_qn('w:br')}[@{_qn('w:type')}='page']"
        rendered = f".//{_qn('w:lastRenderedPageBreak')}"
        for i, el in enumerate(blocks):
            ppr = el.find(_qn("w:pPr"))
            opens = False
            if how == "breaks":
                opens = ppr is not None and ppr.find(_qn("w:pageBreakBefore")) is not None
                prev = blocks[i - 1] if i else None
                if prev is not None:
                    pprev = prev.find(_qn("w:pPr"))
                    opens = opens or bool(prev.findall(page_br)) or (pprev is not None and pprev.find(_qn("w:sectPr")) is not None)
            else:  # pages, as Word last laid them out
                opens = bool(el.findall(rendered)) or (ppr is not None and ppr.find(_qn("w:pageBreakBefore")) is not None)
            if opens and i > starts[-1]:
                starts.append(i)
                titles.append("")
    return starts, titles


def inspect(path: Path, work: Path) -> Dict[str, Any]:
    doc = _open(as_ooxml(path, "docx", work))
    blocks, _ = _blocks(doc)
    h1, t1 = _starts(doc, "headings", 1)
    h2, _ = _starts(doc, "headings", 2)
    h3, _ = _starts(doc, "headings", 3)
    breaks, _ = _starts(doc, "breaks")
    pages, _ = _starts(doc, "pages")
    return {
        "family": "word",
        "units": len(blocks),
        # Parts each choice would make (0: nothing to split at).
        "headings": {str(n): (len(s) if len(s) > 1 else 0) for n, s in ((1, h1), (2, h2), (3, h3))},
        "titles": [t or "Introduction" for t in t1][:60] if len(h1) > 1 else [],
        "breaks": len(breaks) if len(breaks) > 1 else 0,
        "pages": len(pages) if len(pages) > 1 else 0,
    }


def _referenced(part) -> str:
    return part._element.xml


def _save_part(doc, keep: List[Any], sect, out: Path) -> Path:
    """Saves the document holding only `keep` (deep copies), and only the pictures and links they use."""
    body = doc.element.body
    for el in list(body):
        if el is not sect:
            body.remove(el)
    for el in keep:
        if sect is not None:
            sect.addprevious(deepcopy(el))
        else:
            body.append(deepcopy(el))
    part = doc.part
    xml = _referenced(part)
    dropped = {}
    for rId, rel in list(part.rels.items()):
        if rel.reltype.endswith(PRUNABLE) and f'"{rId}"' not in xml:
            dropped[rId] = part.rels.pop(rId)
    try:
        doc.save(str(out))
    finally:
        part.rels.update(dropped)
    return ensure(out, "A part")


def split(path: Path, plan: Dict[str, Any], out_dir: Path, name: str, work: Path) -> Tuple[List[Path], List[str]]:
    doc = _open(as_ooxml(path, "docx", work))
    blocks, sect = _blocks(doc)
    if not blocks:
        raise InvalidMergeSplitInputError("This document is empty.")
    how = plan.get("by", "headings")
    notes: List[str] = []
    if how == "headings":
        level = int(plan.get("level") or 1)
        if level not in (1, 2, 3):
            raise InvalidMergeSplitInputError("Pick heading level 1, 2 or 3.")
        starts, titles = _starts(doc, "headings", level)
        if len(starts) < 2:
            raise InvalidMergeSplitInputError(f"No level-{level} headings to split at. Try another level, or split at page breaks.")
        chosen = [[i] for i in range(len(starts))]
    elif how in ("breaks", "pages"):
        starts, titles = _starts(doc, how)
        if len(starts) < 2:
            raise InvalidMergeSplitInputError(
                "This document has no page or section breaks to split at." if how == "breaks"
                else "Word didn't record pages in this file. Split at headings or page breaks instead."
            )
        chosen = groups(plan, len(starts), "page" if how == "pages" else "section")
        if how == "pages":
            notes.append("Pages are as Word last laid them out, so a part may start a line or two early or late.")
    else:
        raise InvalidMergeSplitInputError("Pick how to split the document.")
    limit_parts(chosen)
    bounds = starts + [len(blocks)]
    files = []
    width = len(str(len(chosen)))
    for n, units in enumerate(chosen, 1):
        keep = [blocks[i] for u in units for i in range(bounds[u], bounds[u + 1])]
        if how == "headings" and titles[units[0]]:
            fname = f"{str(n).zfill(width)} {safe_name(titles[units[0]], 60)}.docx"
        else:
            noun = "pages" if how == "pages" else "part"
            fname = f"{name}-{noun}-{label(units)}.docx" if how == "pages" else f"{name}-part-{str(n).zfill(width)}.docx"
        files.append(_save_part(doc, keep, sect, unique(out_dir, fname)))
    return files, notes


def merge(paths: List[Path], out: Path, options: Dict[str, Any], work: Path) -> Tuple[Path, List[str]]:
    from docxcompose.composer import Composer

    docs = [as_ooxml(p, "docx", work / f"in{i}") for i, p in enumerate(paths)]
    master = _open(docs[0])
    composer = Composer(master)
    for p in docs[1:]:
        if options.get("page_breaks", True):
            master.add_page_break()
        try:
            composer.append(_open(p))
        except InvalidMergeSplitInputError:
            raise
        except Exception as exc:
            raise MergeSplitProcessingError(f"'{p.name}' couldn't be added. It may use a feature we can't merge yet.") from exc
    composer.save(str(out))
    return ensure(out), []
