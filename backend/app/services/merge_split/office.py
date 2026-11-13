"""Older and OpenDocument formats (DOC, ODT, RTF, PPT, ODP, XLS, ODS…) become DOCX/PPTX/XLSX with LibreOffice first."""

import shutil
from pathlib import Path

from app.exceptions.merge_split import MergeSplitUnavailableError
from app.services.convert import convert_service

FILTERS = {
    "docx": "docx:MS Word 2007 XML",
    "pptx": "pptx:Impress MS PowerPoint 2007 XML",
    "xlsx": "xlsx:Calc MS Excel 2007 XML",
}


def as_ooxml(src: Path, target: str, work: Path) -> Path:
    """`src` as .docx / .pptx / .xlsx. Files already in that format are used as they are."""
    if src.suffix.lower() == f".{target}":
        return src
    if convert_service.soffice() is None:
        raise MergeSplitUnavailableError(f"{src.suffix.upper()[1:]} files need LibreOffice, which isn't on this server. Save it as .{target} and try again.")
    # LibreOffice names its result after its input, so give it a private, predictable name.
    local_dir = work / f"lo_{src.stem}"
    local_dir.mkdir(parents=True, exist_ok=True)
    local = local_dir / f"document{src.suffix.lower()}"
    shutil.copyfile(src, local)
    out = convert_service._soffice_convert(local, local_dir / "out", FILTERS[target])
    return out
