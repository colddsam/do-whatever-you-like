"""
Spreadsheets: Excel workbooks and CSV/TSV (openpyxl and the csv module).

Merge, two ways:
- sheets: every sheet of every file side by side in one workbook, with its formatting
- stack: the rows of every file one under another, columns matched by their heading (the usual
  "combine the monthly exports" job), optionally with a column saying which file each row came from
Split, three ways: each sheet as its own workbook, every N rows (headings repeated in each part),
or a part per value of a column (one file per region, per customer…).
"""

import csv
import io
from copy import copy
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple

from app.config.merge_split import settings
from app.exceptions.merge_split import InvalidMergeSplitInputError, MergeSplitProcessingError
from app.services.merge_split.common import ensure, limit_parts, safe_name, unique
from app.services.merge_split.office import as_ooxml

TEXT = {".csv", ".tsv"}
FORMULA_START = ("=", "+", "-", "@")


def _text(path: Path) -> str:
    raw = path.read_bytes()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def _csv_rows(path: Path) -> List[List[str]]:
    text = _text(path)
    if path.suffix.lower() == ".tsv":
        delim = "\t"
    else:
        try:
            delim = csv.Sniffer().sniff(text[:20000], delimiters=",;\t|").delimiter
        except csv.Error:
            delim = ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if len(rows) > settings.MAX_ROWS:
        raise InvalidMergeSplitInputError(f"'{path.name}' has more than {settings.MAX_ROWS:,} rows.")
    return rows


def _workbook(path: Path, work: Path, read_only: bool):
    from openpyxl import load_workbook

    src = as_ooxml(path, "xlsx", work) if path.suffix.lower() not in (".xlsx", ".xlsm") else path
    try:
        return load_workbook(str(src), read_only=read_only, data_only=read_only)
    except Exception as exc:
        raise InvalidMergeSplitInputError(f"'{path.name}' couldn't be opened as a spreadsheet. Is it damaged or password-protected?") from exc


def _sheet_rows(ws) -> Iterator[List[Any]]:
    for row in ws.iter_rows(values_only=True):
        yield list(row)


def _tables(path: Path, work: Path) -> List[Tuple[str, List[List[Any]]]]:
    """(name, rows) for every sheet (a CSV is one sheet), values only."""
    if path.suffix.lower() in TEXT:
        return [(path.stem, _csv_rows(path))]
    wb = _workbook(path, work, read_only=True)
    out = []
    total = 0
    try:
        for ws in wb.worksheets:
            rows = _trim(list(_sheet_rows(ws)))
            total += len(rows)
            if total > settings.MAX_ROWS:
                raise InvalidMergeSplitInputError(f"'{path.name}' has more than {settings.MAX_ROWS:,} rows.")
            out.append((ws.title, rows))
    finally:
        wb.close()
    return out


def _trim(rows: List[List[Any]]) -> List[List[Any]]:
    """Drops empty rows at the end and empty columns on the right (read-only sheets report the used range loosely)."""
    while rows and all(v in (None, "") for v in rows[-1]):
        rows.pop()
    width = max((max((i + 1 for i, v in enumerate(r) if v not in (None, "")), default=0) for r in rows), default=0)
    return [r[:width] + [None] * (width - len(r)) for r in rows]


def inspect(path: Path, work: Path) -> Dict[str, Any]:
    sheets = []
    for name, rows in _tables(path, work):
        header = [("" if v is None else str(v))[:60] for v in (rows[0] if rows else [])][:200]
        sheets.append({"name": name, "rows": max(0, len(rows) - 1), "columns": header})
    return {"family": "sheet", "units": sum(s["rows"] for s in sheets), "sheets": sheets[:200], "text": path.suffix.lower() in TEXT}


# ---------- writing ----------


def _safe_cell(v: Any) -> Any:
    """Text that looks like a formula is kept as text, so a CSV can't smuggle formulas into Excel."""
    if isinstance(v, str) and v.startswith(FORMULA_START) and len(v) > 1:
        return "'" + v if v[0] == "=" else v
    return v


def _write_xlsx(out: Path, sheets: List[Tuple[str, List[List[Any]]]]) -> Path:
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font

    wb = Workbook(write_only=True)
    bold = Font(bold=True)
    names: set = set()
    for name, rows in sheets:
        ws = wb.create_sheet(_sheet_title(name, names))
        for i, row in enumerate(rows):
            if i == 0:
                cells = []
                for v in row:
                    c = WriteOnlyCell(ws, value=_safe_cell(v))
                    c.font = bold
                    cells.append(c)
                ws.append(cells)
            else:
                ws.append([_safe_cell(v) for v in row])
    wb.save(str(out))
    return ensure(out)


def _write_csv(out: Path, rows: List[List[Any]], delimiter: str = ",") -> Path:
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=delimiter)
        for r in rows:
            w.writerow(["" if v is None else v for v in r])
    return ensure(out)


def _sheet_title(name: str, taken: set) -> str:
    base = "".join(ch for ch in str(name) if ch not in '[]:*?/\\').strip("' ")[:31] or "Sheet"
    title, n = base, 2
    while title.lower() in taken:
        suffix = f" ({n})"
        title = base[: 31 - len(suffix)] + suffix
        n += 1
    taken.add(title.lower())
    return title


# ---------- split ----------


def split(path: Path, plan: Dict[str, Any], out_dir: Path, name: str, work: Path) -> Tuple[List[Path], List[str]]:
    how = plan.get("by", "sheets")
    text = path.suffix.lower() in TEXT
    ext = path.suffix.lower() if text else ".xlsx"
    delim = "\t" if ext == ".tsv" else ","
    notes: List[str] = []
    if how == "sheets":
        if text:
            raise InvalidMergeSplitInputError("A CSV file has a single sheet. Split it by rows or by a column instead.")
        return _split_sheets(path, out_dir, name, work), ["Formulas that point at other sheets keep their last value only where Excel saved one."]

    tables = _tables(path, work)
    sheet_name = plan.get("sheet") or tables[0][0]
    rows = next((r for n, r in tables if n == sheet_name), None)
    if rows is None:
        raise InvalidMergeSplitInputError(f"There's no sheet called '{sheet_name}'.")
    if len(rows) < 3:
        raise InvalidMergeSplitInputError("That sheet has too few rows to split.")
    header, body = rows[0], rows[1:]
    files: List[Path] = []
    if how == "rows":
        n = int(plan.get("n") or 0)
        if n < 1:
            raise InvalidMergeSplitInputError("Say how many rows go in each part.")
        chunks = limit_parts([body[i:i + n] for i in range(0, len(body), n)])
        if len(chunks) < 2:
            raise InvalidMergeSplitInputError(f"That sheet has {len(body)} rows, so it would stay in one part.")
        for i, chunk in enumerate(chunks):
            first = i * n + 1
            fname = f"{name}-rows-{first}-{first + len(chunk) - 1}{ext}"
            files.append(_write(out_dir, fname, sheet_name, [header] + chunk, ext, delim))
    elif how == "column":
        col = int(plan.get("column", -1))
        if not 0 <= col < len(header):
            raise InvalidMergeSplitInputError("Pick the column to split by.")
        buckets: Dict[str, List[List[Any]]] = {}
        for r in body:
            key = "" if col >= len(r) or r[col] is None else str(r[col]).strip()
            buckets.setdefault(key, []).append(r)
        limit_parts(list(buckets))
        if len(buckets) < 2:
            raise InvalidMergeSplitInputError("Every row has the same value in that column, so there's nothing to split.")
        for key, chunk in buckets.items():
            fname = f"{safe_name(key, 60) if key else '(blank)'}{ext}"
            files.append(_write(out_dir, fname, sheet_name, [header] + chunk, ext, delim))
    else:
        raise InvalidMergeSplitInputError("Pick how to split the spreadsheet.")
    if not text:
        notes.append("Values are kept; fonts, colours and formulas aren't carried into parts made from rows.")
    return files, notes


def _write(out_dir: Path, fname: str, sheet: str, rows: List[List[Any]], ext: str, delim: str) -> Path:
    out = unique(out_dir, fname)
    return _write_csv(out, rows, delim) if ext in TEXT else _write_xlsx(out, [(sheet, rows)])


def _split_sheets(path: Path, out_dir: Path, name: str, work: Path) -> List[Path]:
    """Each sheet in a workbook of its own, with its formatting (the workbook is reopened per sheet)."""
    probe = _workbook(path, work, read_only=True)
    titles = [ws.title for ws in probe.worksheets]
    probe.close()
    if len(titles) < 2:
        raise InvalidMergeSplitInputError("This workbook has only one sheet. Split it by rows or by a column instead.")
    limit_parts(titles)
    files = []
    for title in titles:
        wb = _workbook(path, work, read_only=False)
        for ws in list(wb.worksheets):
            if ws.title != title:
                wb.remove(ws)
        for dn in list(wb.defined_names):
            if title not in str(wb.defined_names[dn].attr_text):
                del wb.defined_names[dn]
        wb.active = 0
        out = unique(out_dir, f"{safe_name(title, 60)}.xlsx")
        wb.save(str(out))
        wb.close()
        files.append(ensure(out, "A sheet"))
    return files


# ---------- merge ----------


def merge(paths: List[Path], out: Path, options: Dict[str, Any], work: Path) -> Tuple[Path, List[str]]:
    mode = options.get("mode", "sheets")
    if mode == "stack":
        return _stack(paths, out, options, work)
    if mode != "sheets":
        raise InvalidMergeSplitInputError("Pick how to merge the spreadsheets.")
    return _side_by_side(paths, out, work)


def _stack(paths: List[Path], out: Path, options: Dict[str, Any], work: Path) -> Tuple[Path, List[str]]:
    columns: List[str] = []
    index: Dict[str, int] = {}
    rows: List[Dict[int, Any]] = []
    with_source = bool(options.get("source_column", True))
    notes: List[str] = []
    shapes: set = set()
    for path in paths:
        for sheet, table in _tables(path, work)[: 1 if options.get("first_sheet_only", True) else None]:
            if not table:
                continue
            keys = []
            for i, h in enumerate(table[0]):
                label_ = str(h).strip() if h not in (None, "") else f"Column {i + 1}"
                k = label_.lower()
                if k not in index:
                    index[k] = len(columns)
                    columns.append(label_)
                keys.append(index[k])
            shapes.add(frozenset(keys))
            for r in table[1:]:
                rows.append({**{keys[i]: v for i, v in enumerate(r) if i < len(keys)}, -1: path.name})
            if len(rows) > settings.MAX_ROWS:
                raise InvalidMergeSplitInputError(f"Together the files have more than {settings.MAX_ROWS:,} rows.")
    if not rows:
        raise InvalidMergeSplitInputError("Those files have no rows to combine.")
    header = (["Source file"] if with_source else []) + columns
    table = [header] + [([r[-1]] if with_source else []) + [r.get(i) for i in range(len(columns))] for r in rows]
    if len(shapes) > 1:
        notes.append("Some files had columns the others didn't; those cells are left empty where a file had no such column.")
    if options.get("output") == "csv" or out.suffix == ".csv":
        return _write_csv(out, table), notes
    return _write_xlsx(out, [("Combined", table)]), notes


def _side_by_side(paths: List[Path], out: Path, work: Path) -> Tuple[Path, List[str]]:
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)
    taken: set = set()
    budget = [settings.STYLED_CELLS]
    notes: List[str] = []
    for path in paths:
        if path.suffix.lower() in TEXT:
            ws = wb.create_sheet(_sheet_title(path.stem, taken))
            for r in _csv_rows(path):
                ws.append([_safe_cell(v) for v in r])
            continue
        src = _workbook(path, work, read_only=False)
        try:
            for sws in src.worksheets:
                title = sws.title if sws.title.lower() not in taken else f"{path.stem} {sws.title}"
                ws = wb.create_sheet(_sheet_title(title, taken))
                if not _copy_sheet(sws, ws, budget) and "formatting" not in " ".join(notes):
                    notes.append("Big sheets were copied as values only, without their formatting.")
        finally:
            src.close()
    if not wb.worksheets:
        raise InvalidMergeSplitInputError("Those files have no sheets to combine.")
    try:
        wb.save(str(out))
    except Exception as exc:
        raise MergeSplitProcessingError("The combined workbook couldn't be saved.") from exc
    notes.append("Charts, pictures and macros aren't carried across; values, formulas and formatting are.")
    return ensure(out), notes


def _copy_sheet(src, dst, budget: List[int]) -> bool:
    """Values, formulas and formatting cell by cell, plus widths, heights, merges and frozen panes. False if copied plain."""
    cells = (src.max_row or 0) * (src.max_column or 0)
    styled = cells <= budget[0]
    budget[0] -= cells if styled else 0
    for row in src.iter_rows():
        for c in row:
            if c.value is None and not (styled and c.has_style):
                continue
            n = dst.cell(row=c.row, column=c.column, value=c.value)
            if styled and c.has_style:
                n.font, n.fill, n.border = copy(c.font), copy(c.fill), copy(c.border)
                n.alignment, n.protection, n.number_format = copy(c.alignment), copy(c.protection), c.number_format
    if styled:
        for key, dim in src.column_dimensions.items():
            if dim.width:
                dst.column_dimensions[key].width = dim.width
        for key, dim in src.row_dimensions.items():
            if dim.height:
                dst.row_dimensions[key].height = dim.height
        for rng in src.merged_cells.ranges:
            dst.merge_cells(str(rng))
        dst.freeze_panes = src.freeze_panes
    return styled


def output_ext(options: Dict[str, Any]) -> str:
    return "csv" if options.get("mode") == "stack" and options.get("output") == "csv" else "xlsx"
