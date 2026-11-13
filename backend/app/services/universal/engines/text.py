"""Plain-text conversions: source code, notebooks, subtitles and email."""

import html
import json
import re
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path

from app.exceptions.universal import InvalidUniversalInputError
from app.services.universal.engines.common import Ctx, output, read_text
from app.services.universal.formats import CODE_LANGUAGE, FORMATS


def code(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """Code → plain text (as is) or Markdown (one highlighted block, which Pandoc turns into HTML, Word…)."""
    text = read_text(src).replace("\r\n", "\n")
    out = output(work, ctx, target)
    if target == "txt":
        out.write_text(text, encoding="utf-8")
        return out
    fmt = src.suffix.lstrip(".")
    lang = CODE_LANGUAGE.get(fmt, fmt)
    longest = max((len(m) for m in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    out.write_text(f"# {ctx.stem}.{fmt}\n\n{fence}{lang}\n{text.rstrip()}\n{fence}\n", encoding="utf-8")
    return out


_MD_SPECIAL = re.compile(r"([\\`*_{}\[\]<>#|~])")
_LIST_START = re.compile(r"^(\s*)([-+]|\d+[.)])(\s)")


def plain(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """Plain text → Markdown that reads back as the same words: symbols escaped, line breaks kept."""
    lines = []
    for line in read_text(src).replace("\r\n", "\n").split("\n"):
        line = _LIST_START.sub(r"\1\\\2\3", _MD_SPECIAL.sub(r"\\\1", line))
        lines.append(line)
    paragraphs = "\n".join(lines).split("\n\n")
    body = "\n\n".join(p.replace("\n", "  \n") for p in paragraphs)
    out = output(work, ctx, "md")
    out.write_text(body, encoding="utf-8")
    return out


def notebook(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """Jupyter notebook → Python script: code cells in order, text cells as comments."""
    try:
        nb = json.loads(read_text(src))
        cells = nb["cells"]
    except (ValueError, KeyError, TypeError):
        raise InvalidUniversalInputError("That isn't a readable Jupyter notebook.")
    parts = []
    for cell in cells:
        source = cell.get("source", "")
        text = "".join(source) if isinstance(source, list) else str(source)
        if not text.strip():
            continue
        if cell.get("cell_type") == "code":
            parts.append(text.rstrip())
        else:
            parts.append("\n".join(f"# {l}".rstrip() for l in text.rstrip().split("\n")))
    out = output(work, ctx, "py")
    out.write_text("\n\n\n".join(parts) + "\n", encoding="utf-8")
    return out


_TIMING = re.compile(r"^\s*(\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->")


def subtitles(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """Subtitles → just the words, one cue per line, with repeated lines dropped."""
    text = read_text(src).replace("\r\n", "\n")
    lines = []
    if src.suffix == ".ass":
        for line in text.split("\n"):
            if line.startswith("Dialogue:"):
                words = line.split(",", 9)[-1]
                lines.append(re.sub(r"\{[^}]*\}", "", words).replace("\\N", " ").replace("\\n", " ").strip())
    else:
        for block in re.split(r"\n\s*\n", text):
            rows = [r for r in block.split("\n") if r.strip()]
            timing = next((i for i, r in enumerate(rows) if _TIMING.match(r)), None)
            if timing is None:
                continue
            words = " ".join(rows[timing + 1 :])
            lines.append(re.sub(r"<[^>]+>", "", words).strip())
    cleaned = []
    for line in lines:
        if line and (not cleaned or cleaned[-1] != line):
            cleaned.append(line)
    if not cleaned:
        raise InvalidUniversalInputError(f"No subtitles were found in this {FORMATS[src.suffix.lstrip('.')].label} file.")
    out = output(work, ctx, "txt")
    out.write_text("\n".join(cleaned) + "\n", encoding="utf-8")
    return out


class _TextOnly(HTMLParser):
    BLOCK = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def _html_text(markup: str) -> str:
    p = _TextOnly()
    p.feed(markup)
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", "".join(p.parts))).strip()


def email(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """An .eml message → a readable page (headers, then the body). Attachments are listed, not kept."""
    try:
        msg = BytesParser(policy=policy.default).parsebytes(src.read_bytes())
    except Exception:
        raise InvalidUniversalInputError("That isn't a readable email message.")
    headers = [(k, str(msg.get(k, ""))) for k in ("From", "To", "Cc", "Date", "Subject") if msg.get(k)]
    body_part = msg.get_body(preferencelist=("html", "plain"))
    body = body_part.get_content() if body_part is not None else ""
    is_html = body_part is not None and body_part.get_content_subtype() == "html"
    attachments = [a.get_filename() or "attachment" for a in msg.iter_attachments()]
    if attachments:
        ctx.notes.append(f"Attachments aren't included: {', '.join(attachments[:5])}{'…' if len(attachments) > 5 else ''}.")
    out = output(work, ctx, target)
    if target == "txt":
        text = _html_text(body) if is_html else body
        head = "\n".join(f"{k}: {v}" for k, v in headers)
        out.write_text(f"{head}\n\n{text.strip()}\n", encoding="utf-8")
        return out
    rows = "".join(f"<tr><th>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>" for k, v in headers)
    # Scripts and remote content are dropped: the page is read, printed or converted, never run.
    content = re.sub(r"<script\b.*?</script\s*>", "", body, flags=re.I | re.S) if is_html else f"<pre>{html.escape(body)}</pre>"
    subject = html.escape(str(msg.get("Subject", ctx.stem)))
    out.write_text(
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{subject}</title>"
        "<style>body{font:15px/1.6 system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}"
        "table.h{border-collapse:collapse;margin-bottom:1.5rem}table.h th{text-align:left;padding:2px 12px 2px 0;color:#555}"
        "pre{white-space:pre-wrap}</style></head><body>"
        f"<table class='h'>{rows}</table><hr>{content}</body></html>",
        encoding="utf-8",
    )
    return out
