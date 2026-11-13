"""
PowerPoint (python-pptx, at the package level).

Merge: every slide is copied with everything it uses (layout, master, theme, pictures, charts,
media, speaker notes), so each deck keeps its own design, like PowerPoint's "Keep source formatting".
Split: the deck is opened once; each part is saved with only its slides listed, and the package
writer leaves out whatever those slides don't use.
"""

import re
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

from app.exceptions.merge_split import InvalidMergeSplitInputError, MergeSplitProcessingError
from app.services.merge_split.common import ensure, groups, label, unique
from app.services.merge_split.office import as_ooxml

FIRST_LAYOUT_OR_MASTER_ID = 2147483648  # Masters and layouts share one id space, from 2^31.


def _open(path: Path):
    from pptx import Presentation

    try:
        return Presentation(str(path))
    except Exception as exc:
        raise InvalidMergeSplitInputError(f"'{path.name}' couldn't be opened as a presentation. Is it damaged or password-protected?") from exc


def _titles(prs) -> List[str]:
    out = []
    for slide in prs.slides:
        title = ""
        try:
            if slide.shapes.title is not None:
                title = slide.shapes.title.text_frame.text.strip()
        except Exception:
            pass
        out.append(title.replace("\n", " ")[:80])
    return out


def inspect(path: Path, work: Path) -> Dict[str, Any]:
    prs = _open(as_ooxml(path, "pptx", work))
    titles = _titles(prs)
    return {"family": "slides", "units": len(titles), "titles": titles[:300]}


def split(path: Path, plan: Dict[str, Any], out_dir: Path, name: str, work: Path) -> Tuple[List[Path], List[str]]:
    prs = _open(as_ooxml(path, "pptx", work))
    sld_ids = list(prs.slides._sldIdLst)
    chosen = groups(plan, len(sld_ids), "slide")
    part = prs.part
    rels = {s.rId: part.rels.pop(s.rId) for s in sld_ids}
    lst = prs.slides._sldIdLst
    files = []
    try:
        for units in chosen:
            for el in list(lst):
                lst.remove(el)
            for u in units:
                lst.append(sld_ids[u])
                part.rels._rels[sld_ids[u].rId] = rels[sld_ids[u].rId]
            out = unique(out_dir, f"{name}-slides-{label(units)}.pptx")
            prs.save(str(out))
            files.append(ensure(out, "A part"))
            for u in units:
                part.rels._rels.pop(sld_ids[u].rId, None)
    finally:
        for el in list(lst):
            lst.remove(el)
        for s in sld_ids:
            lst.append(s)
        part.rels._rels.update(rels)
    return files, []


# ---------- merge ----------


def _template(partname: str) -> str:
    """'/ppt/slides/slide12.xml' → '/ppt/slides/slide%d.xml'."""
    m = re.match(r"^(.*?)(\d*)(\.[^./]+)$", partname)
    if not m:
        return partname.replace("%", "%%") + "%d"
    return m.group(1).replace("%", "%%") + "%d" + m.group(3)


class _Copier:
    """Copies parts from one package into another, with their relationships, each part once."""

    def __init__(self, prs) -> None:
        from pptx.opc.packuri import PackURI

        self.prs = prs
        self.package = prs.part.package
        self.used: Set[str] = {str(p.partname) for p in self.package.iter_parts()}
        self.PackURI = PackURI
        self.new_masters: List[Any] = []

    def _name(self, partname: str) -> str:
        tmpl = _template(partname)
        n = 1
        while (tmpl % n) in self.used:
            n += 1
        name = tmpl % n
        self.used.add(name)
        return name

    def copy(self, src, memo: Dict[Any, Any]):
        from pptx.opc.constants import CONTENT_TYPE as CT
        from pptx.opc.constants import RELATIONSHIP_TARGET_MODE as RTM
        from pptx.opc.constants import RELATIONSHIP_TYPE as RT
        from pptx.opc.package import PartFactory, _Relationship

        if src in memo:
            return memo[src]
        if src.content_type == CT.PML_NOTES_MASTER:
            memo[src] = self.prs.part.notes_master_part
            return memo[src]
        new = PartFactory(self.PackURI(self._name(str(src.partname))), src.content_type, self.package, src.blob)
        memo[src] = new
        if src.content_type == CT.PML_SLIDE_MASTER:
            self.new_masters.append(new)
        rels = new.rels
        for rId, rel in src.rels.items():
            if rel.reltype in (RT.COMMENTS, RT.COMMENT_AUTHORS) or "comment" in rel.reltype.lower():
                continue  # Comments point at authors kept per presentation; they don't travel.
            if rel.is_external:
                rels._rels[rId] = _Relationship(rels._base_uri, rId, rel.reltype, RTM.EXTERNAL, rel.target_ref)
            else:
                rels._rels[rId] = _Relationship(rels._base_uri, rId, rel.reltype, RTM.INTERNAL, self.copy(rel.target_part, memo))
        return new


def _register_masters(prs, masters: List[Any]) -> None:
    """Lists copied masters in the presentation, renumbering their layout ids so none clash."""
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT
    from pptx.oxml.ns import qn

    pres = prs.part._element
    master_lst = pres.find(qn("p:sldMasterIdLst"))
    ids = [int(e.get("id")) for e in master_lst]
    for m in prs.slide_masters:
        ids += [int(e.get("id")) for e in m._element.findall(f"{qn('p:sldLayoutIdLst')}/{qn('p:sldLayoutId')}")]
    next_id = max(ids + [FIRST_LAYOUT_OR_MASTER_ID - 1]) + 1
    for master in masters:
        for e in master._element.findall(f"{qn('p:sldLayoutIdLst')}/{qn('p:sldLayoutId')}"):
            next_id += 1
            e.set("id", str(next_id))
        rId = prs.part.relate_to(master, RT.SLIDE_MASTER)
        entry = master_lst.makeelement(qn("p:sldMasterId"), {"id": str(next_id + 1)})
        entry.set(qn("r:id"), rId)
        master_lst.append(entry)
        next_id += 2


def merge(paths: List[Path], out: Path, options: Dict[str, Any], work: Path) -> Tuple[Path, List[str]]:
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT
    from pptx.oxml.ns import qn

    decks = [as_ooxml(p, "pptx", work / f"in{i}") for i, p in enumerate(paths)]
    prs = _open(decks[0])
    copier = _Copier(prs)
    notes: List[str] = []
    lst = prs.slides._sldIdLst
    next_slide_id = max([int(e.get("id")) for e in lst] + [255]) + 1
    size = (prs.slide_width, prs.slide_height)
    for path in decks[1:]:
        src = _open(path)
        if (src.slide_width, src.slide_height) != size and not notes:
            notes.append("The decks have different slide sizes; the merged one uses the first deck's.")
        memo: Dict[Any, Any] = {}
        copier.new_masters = []
        try:
            new_slides = [copier.copy(slide.part, memo) for slide in src.slides]
            _register_masters(prs, copier.new_masters)
            for part in new_slides:
                rId = prs.part.relate_to(part, RT.SLIDE)
                entry = lst.makeelement(qn("p:sldId"), {"id": str(next_slide_id)})
                entry.set(qn("r:id"), rId)
                lst.append(entry)
                next_slide_id += 1
        except Exception as exc:
            raise MergeSplitProcessingError(f"The slides of '{path.name}' couldn't be copied.") from exc
    prs.save(str(out))
    return ensure(out), notes
