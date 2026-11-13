"""
Tables and structured data: CSV, TSV, Excel, JSON, JSON Lines, XML, YAML, TOML → any of those, plus
HTML and Markdown tables and SQL inserts.

Everything is read into one of two shapes:
- tables: {name: (headers, rows)}, from CSV/TSV/Excel;
- a tree: plain dicts and lists, from JSON/YAML/TOML/XML.
Writers take whichever shape suits them and convert the other: a list of records becomes a table
(nested fields flattened to "a.b"), a table becomes a list of records.
"""

import csv
import datetime as dt
import decimal
import html
import io
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.config.universal import settings
from app.exceptions.universal import InvalidUniversalInputError, UniversalConversionError
from app.services.universal.engines.common import Ctx, bundle, output, read_text

logger = logging.getLogger(__name__)

# Ceiling on values in a YAML tree once its aliases are expanded.
MAX_VALUES = 5_000_000

Table = Tuple[List[str], List[List[Any]]]
Tables = Dict[str, Table]

# ------------------------------------------------------------------------------------------------
# Reading
# ------------------------------------------------------------------------------------------------


def _limit(n: int) -> None:
    if n > settings.DATA_MAX_ROWS:
        raise InvalidUniversalInputError(f"That's more than {settings.DATA_MAX_ROWS:,} rows. Split it into smaller files.")


def _headers(first: List[Any], width: int) -> List[str]:
    """Header cells as unique, non-empty names ("column_3" for blanks, "name_2" for repeats)."""
    names, seen = [], {}
    for i in range(width):
        raw = first[i] if i < len(first) else None
        name = str(raw).strip() if raw not in (None, "") else f"column_{i + 1}"
        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 1
        names.append(name)
    return names


def _table(rows: List[List[Any]]) -> Table:
    rows = [r for r in rows if any(c not in (None, "") for c in r)]
    if not rows:
        return [], []
    width = max(len(r) for r in rows)
    headers = _headers(rows[0], width)
    body = [list(r) + [None] * (width - len(r)) for r in rows[1:]]
    return headers, body


def _read_delimited(path: Path, fmt: str, name: str) -> Tables:
    text = read_text(path)
    if fmt == "tsv":
        delimiter = "\t"
    else:
        try:
            delimiter = csv.Sniffer().sniff(text[:20000], delimiters=",;|\t").delimiter
        except csv.Error:
            delimiter = ","
    rows = []
    for i, row in enumerate(csv.reader(io.StringIO(text), delimiter=delimiter)):
        _limit(i)
        rows.append([_cell(v) for v in row])
    headers, body = _table(rows)
    if not headers:
        raise InvalidUniversalInputError("That file has no rows.")
    return {name: (headers, body)}


def _cell(value: str) -> Any:
    """Numbers become numbers ("1,234" stays text: it may be a list); empty cells become nothing."""
    v = value.strip()
    if v == "":
        return None
    if re.fullmatch(r"-?(0|[1-9]\d{0,14})", v):
        return int(v)
    if re.fullmatch(r"-?(0|[1-9]\d*)\.\d+([eE][-+]?\d+)?", v):
        try:
            return float(v)
        except ValueError:
            return value
    if v.lower() in ("true", "false"):
        return v.lower() == "true"
    return value


def _read_excel(path: Path) -> Tables:
    from openpyxl import load_workbook

    try:
        wb = load_workbook(str(path), read_only=True, data_only=True)
    except Exception:
        raise InvalidUniversalInputError("That workbook couldn't be opened. It may be damaged or password-protected.")
    tables: Tables = {}
    try:
        for ws in wb.worksheets:
            rows = []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                _limit(i)
                rows.append([_plain(v) for v in row])
            headers, body = _table(rows)
            if headers:
                tables[ws.title] = (headers, body)
    finally:
        wb.close()
    if not tables:
        raise InvalidUniversalInputError("That workbook is empty.")
    return tables


def _plain(v: Any) -> Any:
    """Excel and YAML values that JSON can't hold (dates, decimals) as text or numbers."""
    if isinstance(v, (dt.datetime, dt.date, dt.time)):
        return v.isoformat()
    if isinstance(v, dt.timedelta):
        return str(v)
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return v


def _tree_plain(v: Any) -> Any:
    if isinstance(v, dict):
        return {str(k): _tree_plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [_tree_plain(x) for x in v]
    return _plain(v)


def _expanded_size(value: Any, budget: int) -> int:
    """
    Counts values as they'd be written out, stopping at `budget`. YAML aliases share one object, so a
    few lines of nested aliases ("billion laughs") load cheaply but expand to billions of items when
    written as JSON. The walk visits shared objects again on purpose: that's the true output size.
    """
    count = 0
    stack = [value]
    while stack:
        v = stack.pop()
        count += 1
        if count > budget:
            return count
        if isinstance(v, dict):
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
    return count


def _read_yaml(path: Path) -> Any:
    import yaml

    try:
        docs = [d for d in yaml.safe_load_all(read_text(path)) if d is not None]
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" (line {mark.line + 1})" if mark else ""
        raise InvalidUniversalInputError(f"That isn't valid YAML{where}.")
    if not docs:
        raise InvalidUniversalInputError("That YAML file is empty.")
    data = docs[0] if len(docs) == 1 else docs
    if _expanded_size(data, MAX_VALUES) > MAX_VALUES:
        raise InvalidUniversalInputError("That YAML file expands to too many values (repeated aliases) to convert safely.")
    return _tree_plain(data)


def _read_json(path: Path, lines: bool) -> Any:
    text = read_text(path)
    try:
        if lines:
            rows = []
            for i, line in enumerate(text.splitlines()):
                if line.strip():
                    _limit(i)
                    rows.append(json.loads(line))
            return rows
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise InvalidUniversalInputError(f"That isn't valid JSON (line {exc.lineno}, column {exc.colno}).")


def _read_toml(path: Path) -> Any:
    import tomllib

    try:
        return _tree_plain(tomllib.loads(read_text(path)))
    except tomllib.TOMLDecodeError as exc:
        raise InvalidUniversalInputError(f"That isn't valid TOML: {exc}.")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _read_xml(path: Path) -> Any:
    import xml.etree.ElementTree as ET

    text = read_text(path)
    # Entity declarations are how XML "bombs" and file-reading tricks start; real data never needs them.
    if re.search(r"<!ENTITY", text, flags=re.I):
        raise InvalidUniversalInputError("XML with entity declarations (<!ENTITY>) can't be converted, for safety.")
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError as exc:
        raise InvalidUniversalInputError(f"That isn't valid XML ({exc}).")

    def walk(el) -> Any:
        node: Dict[str, Any] = {f"@{_local(k)}": v for k, v in el.attrib.items()}
        for child in el:
            key, value = _local(child.tag), walk(child)
            if key in node:
                if not isinstance(node[key], list) or not getattr(node[key], "_repeated", False):
                    node[key] = _Repeated([node[key]])
                node[key].append(value)
            else:
                node[key] = value
        text_value = (el.text or "").strip()
        if not node:
            return _cell(text_value) if text_value else None
        if text_value:
            node["#text"] = text_value
        return node

    return {_local(root.tag): _unrepeat(walk(root))}


class _Repeated(list):
    _repeated = True


def _unrepeat(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _unrepeat(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_unrepeat(x) for x in v]
    return v


def read(path: Path, fmt: str, name: str) -> Any:
    if fmt in ("csv", "tsv"):
        return _read_delimited(path, fmt, name)
    if fmt in ("xlsx", "xlsm"):
        return _read_excel(path)
    if fmt in ("json", "jsonl"):
        return _read_json(path, fmt == "jsonl")
    if fmt == "yaml":
        return _read_yaml(path)
    if fmt == "toml":
        return _read_toml(path)
    if fmt == "xml":
        return _read_xml(path)
    raise InvalidUniversalInputError("That data format isn't supported.")


# ------------------------------------------------------------------------------------------------
# Shapes
# ------------------------------------------------------------------------------------------------


def _is_tables(data: Any) -> bool:
    return isinstance(data, dict) and bool(data) and all(isinstance(v, tuple) and len(v) == 2 for v in data.values())


def as_tree(data: Any) -> Any:
    if not _is_tables(data):
        return data
    records = {name: [dict(zip(h, row)) for row in rows] for name, (h, rows) in data.items()}
    return next(iter(records.values())) if len(records) == 1 else records


def _flatten(obj: Any, prefix: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, dict) and v:
                out.update(_flatten(v, key))
            elif isinstance(v, list):
                out[key] = json.dumps(v, ensure_ascii=False) if any(isinstance(x, (dict, list)) for x in v) else ", ".join("" if x is None else str(x) for x in v)
            else:
                out[key] = None if isinstance(v, dict) else v
    else:
        out[prefix or "value"] = obj
    return out


def _records_table(records: List[Any]) -> Table:
    if records and all(isinstance(r, list) for r in records):
        first = records[0]
        if all(isinstance(c, str) for c in first):
            return _table(records)
        width = max(len(r) for r in records)
        return [f"column_{i + 1}" for i in range(width)], [r + [None] * (width - len(r)) for r in records]
    flat = [_flatten(r) if isinstance(r, dict) else {"value": r} for r in records]
    headers: List[str] = []
    seen = set()
    for row in flat:
        for k in row:
            if k not in seen:
                seen.add(k)
                headers.append(k)
    return headers, [[row.get(h) for h in headers] for row in flat]


def as_tables(data: Any, name: str) -> Tables:
    if _is_tables(data):
        return data
    if isinstance(data, list):
        return {name: _records_table(data)}
    if isinstance(data, dict):
        # An API answer like {"data": [...], "meta": {...}}: the lists of records are the tables.
        lists = {k: v for k, v in data.items() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v)}
        if lists:
            return {k: _records_table(v) for k, v in lists.items()}
        if len(data) == 1:
            only = next(iter(data.values()))
            if isinstance(only, (dict, list)):
                return as_tables(only, next(iter(data)))
        flat = _flatten(data)
        return {name: (["key", "value"], [[k, v] for k, v in flat.items()])}
    return {name: (["value"], [[data]])}


# ------------------------------------------------------------------------------------------------
# Writing
# ------------------------------------------------------------------------------------------------


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return str(int(v))
    return str(v)


def _write_delimited(tables: Tables, work: Path, ctx: Ctx, fmt: str, final: bool) -> Path:
    delimiter = "\t" if fmt == "tsv" else ","

    def write(path: Path, table: Table) -> Path:
        headers, rows = table
        # UTF-8 with a byte-order mark, so Excel opens accented letters correctly.
        with open(path, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh, delimiter=delimiter)
            w.writerow(headers)
            for r in rows:
                w.writerow([_text(c) for c in r])
        return path

    items = list(tables.items())
    if len(items) == 1 or not final:
        if len(items) > 1:
            ctx.notes.append(f"Only the first sheet ({items[0][0]}) was used.")
        return write(output(work, ctx, fmt), items[0][1])
    parts = work / "sheets"
    parts.mkdir(parents=True, exist_ok=True)
    files = [write(parts / f"{_safe_name(n)}.{fmt}", t) for n, t in items]
    ctx.notes.append(f"{len(files)} sheets, one {fmt.upper()} file each, in a ZIP.")
    return bundle(files, work / f"{ctx.stem}-{fmt}.zip")


def _safe_name(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", str(name)).strip(" .")[:80] or "sheet"


def _write_excel(tables: Tables, out: Path) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    wb = Workbook(write_only=False)
    wb.remove(wb.active)
    used = set()
    for name, (headers, rows) in tables.items():
        if len(rows) > 1_048_575:
            raise InvalidUniversalInputError("Excel holds up to 1,048,576 rows per sheet. Try CSV instead.")
        title = re.sub(r"[\[\]:*?/\\]", "_", str(name))[:31] or "Sheet"
        base, n = title, 2
        while title.lower() in used:
            title = f"{base[:28]}_{n}"
            n += 1
        used.add(title.lower())
        ws = wb.create_sheet(title)
        ws.append(headers)
        widths = [min(60, max(8, len(str(h)) + 2)) for h in headers]
        for r in rows:
            ws.append([_excel_value(c) for c in r])
            for i, c in enumerate(r[: len(widths)]):
                widths[i] = min(60, max(widths[i], len(_text(c)) + 2))
        for cell in ws[1]:
            cell.font = Font(bold=True)
        ws.freeze_panes = "A2"
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
    wb.save(str(out))
    return out


_ILLEGAL_XLSX = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _excel_value(v: Any) -> Any:
    if isinstance(v, str):
        v = _ILLEGAL_XLSX.sub("", v)
        # Text that starts like a formula stays text: never let a CSV run formulas in someone's Excel.
        return "'" + v if v[:1] in ("=", "+", "-", "@") and not re.fullmatch(r"-?\d+(\.\d+)?", v) else v
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


def _drop_none(v: Any) -> Any:
    """TOML has no "null": empty values are left out."""
    if isinstance(v, dict):
        return {k: _drop_none(x) for k, x in v.items() if x is not None}
    if isinstance(v, list):
        return [_drop_none(x) for x in v if x is not None]
    return v


_XML_NAME = re.compile(r"[^A-Za-z0-9_.-]")


def _xml_name(key: str) -> str:
    name = _XML_NAME.sub("_", str(key)) or "item"
    if not re.match(r"[A-Za-z_]", name) or name.lower().startswith("xml"):
        name = f"_{name}"
    return name


def _write_xml(tree: Any, out: Path, ctx: Ctx) -> Path:
    import xml.etree.ElementTree as ET

    def build(parent, key: str, value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                build(parent, key, item)
            return
        el = ET.SubElement(parent, _xml_name(key))
        if isinstance(value, dict):
            for k, v in value.items():
                if k.startswith("@") and not isinstance(v, (dict, list)):
                    el.set(_xml_name(k[1:]), _text(v))
                elif k == "#text":
                    el.text = _text(v)
                else:
                    build(el, k, v)
        elif value is not None:
            el.text = _text(value)

    if isinstance(tree, dict) and len(tree) == 1 and isinstance(next(iter(tree.values())), dict):
        root_name, content = next(iter(tree.items()))
        root = ET.Element(_xml_name(root_name))
        for k, v in content.items():
            if k.startswith("@") and not isinstance(v, (dict, list)):
                root.set(_xml_name(k[1:]), _text(v))
            elif k == "#text":
                root.text = _text(v)
            else:
                build(root, k, v)
    else:
        root = ET.Element("root")
        if isinstance(tree, list):
            for item in tree:
                build(root, "item", item)
        elif isinstance(tree, dict):
            for k, v in tree.items():
                build(root, k, v)
        else:
            root.text = _text(tree)
    ET.indent(root)
    ET.ElementTree(root).write(str(out), encoding="utf-8", xml_declaration=True)
    return out


def _write_html(tables: Tables, out: Path, ctx: Ctx) -> Path:
    parts = []
    for name, (headers, rows) in tables.items():
        if len(tables) > 1:
            parts.append(f"<h2>{html.escape(str(name))}</h2>")
        head = "".join(f"<th>{html.escape(h)}</th>" for h in headers)
        body = "".join("<tr>" + "".join(f"<td>{html.escape(_text(c))}</td>" for c in r) + "</tr>" for r in rows)
        parts.append(f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")
    out.write_text(
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{html.escape(ctx.stem)}</title>"
        "<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;margin-bottom:2rem}"
        "th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f3f3f3}</style>"
        f"</head><body>{''.join(parts)}</body></html>",
        encoding="utf-8",
    )
    return out


def _md_cell(v: Any) -> str:
    return _text(v).replace("\\", "\\\\").replace("|", "\\|").replace("\r", "").replace("\n", "<br>")


def _write_markdown(tables: Tables, out: Path) -> Path:
    parts = []
    for name, (headers, rows) in tables.items():
        if len(tables) > 1:
            parts.append(f"## {name}\n")
        parts.append("| " + " | ".join(_md_cell(h) for h in headers) + " |")
        parts.append("|" + "|".join(" --- " for _ in headers) + "|")
        parts.extend("| " + " | ".join(_md_cell(c) for c in r) + " |" for r in rows)
        parts.append("")
    out.write_text("\n".join(parts), encoding="utf-8")
    return out


def _sql_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _sql_value(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, float) else str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    return "'" + str(v).replace("'", "''") + "'"


def _sql_type(values: List[Any]) -> str:
    present = [v for v in values if v is not None]
    if present and all(isinstance(v, bool) for v in present):
        return "BOOLEAN"
    if present and all(isinstance(v, int) and not isinstance(v, bool) for v in present):
        return "BIGINT"
    if present and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
        return "DOUBLE PRECISION"
    return "TEXT"


def _write_sql(tables: Tables, out: Path) -> Path:
    with open(out, "w", encoding="utf-8") as fh:
        for name, (headers, rows) in tables.items():
            table = _sql_ident(re.sub(r"\W+", "_", str(name)).strip("_").lower() or "data")
            cols = ",\n".join(f"  {_sql_ident(h)} {_sql_type([r[i] for r in rows])}" for i, h in enumerate(headers))
            fh.write(f"CREATE TABLE {table} (\n{cols}\n);\n\n")
            names = ", ".join(_sql_ident(h) for h in headers)
            for start in range(0, len(rows), 500):
                chunk = rows[start : start + 500]
                values = ",\n".join("  (" + ", ".join(_sql_value(c) for c in r) + ")" for r in chunk)
                fh.write(f"INSERT INTO {table} ({names}) VALUES\n{values};\n\n")
    return out


def convert(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    source = src.suffix.lstrip(".").lower()
    data = read(src, source, ctx.stem)
    out = output(work, ctx, target)
    try:
        if target in ("csv", "tsv"):
            return _write_delimited(as_tables(data, ctx.stem), work, ctx, target, final)
        if target == "xlsx":
            return _write_excel(as_tables(data, ctx.stem), out)
        if target == "html":
            return _write_html(as_tables(data, ctx.stem), out, ctx)
        if target == "md":
            return _write_markdown(as_tables(data, ctx.stem), out)
        if target == "sql":
            return _write_sql(as_tables(data, ctx.stem), out)
        tree = as_tree(data)
        if target == "json":
            out.write_text(json.dumps(tree, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        elif target == "jsonl":
            items = tree if isinstance(tree, list) else [tree]
            with open(out, "w", encoding="utf-8") as fh:
                for item in items:
                    fh.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")
        elif target == "yaml":
            import yaml

            out.write_text(yaml.safe_dump(tree, allow_unicode=True, sort_keys=False, default_flow_style=False), encoding="utf-8")
        elif target == "toml":
            import tomli_w

            body = _drop_none(tree if isinstance(tree, dict) else {"items": tree})
            out.write_text(tomli_w.dumps(body), encoding="utf-8")
        elif target == "xml":
            _write_xml(tree, out, ctx)
        else:
            raise InvalidUniversalInputError("That data format isn't supported.")
    except (InvalidUniversalInputError, UniversalConversionError):
        raise
    except Exception as exc:
        logger.error("Writing %s failed: %s", target, exc)
        raise UniversalConversionError(f"This data couldn't be written as {target.upper()}. Its structure may not fit that format.")
    return out

