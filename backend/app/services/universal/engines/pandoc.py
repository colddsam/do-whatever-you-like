"""
Pandoc: Markdown, HTML, LaTeX, reStructuredText, Org, AsciiDoc, Typst, notebooks, EPUB and more.

Always run with --sandbox: a document may not read anything but itself. Without it, a Markdown
image like ![](/etc/passwd) or a LaTeX \\input would copy server files into the result.
"""

import json
import logging
import zipfile
from pathlib import Path

from app.config.universal import settings
from app.exceptions.universal import UniversalConversionError, UniversalUnavailableError
from app.services.universal.engines.common import Ctx, ensure, output, run, tail
from app.services.universal.formats import FORMATS
from app.services.universal.graph import pandoc_path

logger = logging.getLogger(__name__)

READERS = {
    "md": "markdown", "html": "html", "docx": "docx", "odt": "odt", "rtf": "rtf", "epub": "epub",
    "rst": "rst", "tex": "latex", "org": "org", "ipynb": "ipynb", "textile": "textile",
    "wiki": "mediawiki", "fb2": "fb2", "adoc": "asciidoc", "typ": "typst",
}
WRITERS = {
    "md": "gfm", "html": "html5", "docx": "docx", "odt": "odt", "rtf": "rtf", "epub": "epub3",
    "rst": "rst", "tex": "latex", "org": "org", "ipynb": "ipynb", "txt": "plain",
    "wiki": "mediawiki", "textile": "textile", "adoc": "asciidoc", "typ": "typst", "fb2": "fb2",
    "pptx": "pptx",
}
# Text formats that are a complete file only with a header (preamble, <head>…).
STANDALONE = {"html", "tex", "rtf", "typ", "fb2"}
# Text formats that point at pictures by file name, so the pictures must travel with them.
LINKS_MEDIA = {"md", "rst", "org", "adoc", "textile", "wiki", "tex", "typ"}


def convert(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    binary = pandoc_path()
    if not binary:
        raise UniversalUnavailableError("Document conversion isn't available on this server yet (Pandoc is missing).")
    source = src.suffix.lstrip(".").lower()
    out = output(work, ctx, target)
    # Defaults only: a title set inside the document wins over a metadata file (unlike --metadata).
    defaults = work / "defaults.json"
    defaults.write_text(json.dumps({"title": ctx.stem, "pagetitle": ctx.stem}), encoding="utf-8")
    cmd = [binary, "--sandbox", "-f", READERS[source], "-t", WRITERS[target], "-o", out.name, f"--metadata-file={defaults.name}"]
    if target in STANDALONE:
        cmd.append("--standalone")
    if target == "html":
        # One self-contained page: pictures inside the HTML rather than beside it.
        cmd.append("--embed-resources")
    media = work / "media"
    if target in LINKS_MEDIA and final:
        cmd.append(f"--extract-media={media.name}")
    cmd.append(str(src.resolve()))
    proc = run(cmd, settings.PANDOC_TIMEOUT_SECONDS, cwd=work, what="Pandoc")
    if proc.returncode != 0:
        logger.error("pandoc %s → %s failed: %s", source, target, tail(proc.stderr))
        raise UniversalConversionError(
            f"This {FORMATS[source].label} file couldn't be read. It may be damaged or use features the converter doesn't know."
        )
    ensure(out)
    pictures = [p for p in media.rglob("*") if p.is_file()] if media.is_dir() else []
    if not pictures:
        return out
    # The text file plus its pictures folder, so the links in it keep working.
    dest = work / f"{ctx.stem}-{target}.zip"
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(out, arcname=out.name)
        for p in pictures:
            zf.write(p, arcname=p.relative_to(work).as_posix())
    n = len(pictures)
    ctx.notes.append(f"It has {n} picture{'s' if n != 1 else ''}, so the {target.upper()} file and its media folder come in a ZIP.")
    return dest
