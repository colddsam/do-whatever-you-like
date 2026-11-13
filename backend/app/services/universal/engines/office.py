"""LibreOffice (headless) for word-processor, spreadsheet, presentation and drawing files."""

from pathlib import Path

from app.services.convert import convert_service
from app.services.universal.engines.common import Ctx, ensure, fresh_copy, output

# Export filters by app: the same target needs a different filter in Writer, Calc, Impress and Draw.
FILTERS = {
    "writer": {
        "pdf": "pdf:writer_pdf_Export",
        "docx": "docx:MS Word 2007 XML",
        "doc": "doc:MS Word 97",
        "odt": "odt:writer8",
        "rtf": "rtf:Rich Text Format",
        "txt": "txt:Text (encoded):UTF8",
        "html": "html:XHTML Writer File:UTF8",
        "epub": "epub:EPUB",
    },
    "calc": {
        "pdf": "pdf:calc_pdf_Export",
        "xlsx": "xlsx:Calc MS Excel 2007 XML",
        "xls": "xls:MS Excel 97",
        "ods": "ods:calc8",
        "html": "html:XHTML Calc File:UTF8",
    },
    "impress": {
        "pdf": "pdf:impress_pdf_Export",
        "pptx": "pptx:Impress MS PowerPoint 2007 XML",
        "ppt": "ppt:MS PowerPoint 97",
        "odp": "odp:impress8",
    },
    "draw": {
        "pdf": "pdf:draw_pdf_Export",
        "odg": "odg:draw8",
        "svg": "svg:draw_svg_Export",
        "png": "png:draw_png_Export",
    },
    "pdf_slides": {
        "pptx": "pptx:Impress MS PowerPoint 2007 XML",
        "odp": "odp:impress8",
    },
}

# How to read inputs LibreOffice would otherwise guess at (text encodings, CSV separators).
IMPORT_FILTERS = {
    "txt": "Text (encoded):UTF8",
    # Comma-separated, double quotes, UTF-8 (76), from line 1.
    "csv": "CSV:44,34,76,1",
    "pdf": "impress_pdf_import",
}


def convert(app: str, src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    # LibreOffice names its result after its input, so give the input a fixed, safe name.
    # Every file in a job is named after its format id ("x.txt", "x.csv"), so the suffix says how to read it.
    local = fresh_copy(src, work / "in", f"document{src.suffix.lower()}")
    infilter = IMPORT_FILTERS.get(local.suffix.lstrip("."))
    export = FILTERS[app][target]
    if app == "calc" and target == "pdf" and ctx.options.get("fit_sheets"):
        # Shrinks each sheet onto one page instead of breaking wide or long sheets across pages.
        export += ':{"SinglePageSheets":{"type":"boolean","value":"true"}}'
    out = convert_service._soffice_convert(local, work / "out", export, infilter=infilter)
    renamed = output(work, ctx, target)
    out.replace(renamed)
    if app == "draw" and target == "png":
        ctx.notes.append("Only the first page of a drawing becomes a picture.")
    return ensure(renamed)
