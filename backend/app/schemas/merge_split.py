from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SplitPlan(BaseModel):
    """How to split one file. Which keys matter depends on the file's family (see services/merge_split)."""

    model_config = ConfigDict(extra="forbid")

    # word: headings | breaks | pages · sheet: sheets | rows | column · audio/video: every | parts | times
    # pdf/slides (and word pages): leave `by` out and use `mode`.
    by: Optional[Literal["headings", "breaks", "pages", "sheets", "rows", "column", "every", "parts", "times"]] = None
    # Pages, slides or Word pages: one per part, n per part, or typed ranges ("1-3, 4+6").
    mode: Optional[Literal["each", "every", "ranges"]] = None
    n: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    ranges: Optional[str] = Field(default=None, max_length=500, pattern=r"^[0-9,+\- ]*$")
    level: Optional[int] = Field(default=None, ge=1, le=3)
    sheet: Optional[str] = Field(default=None, max_length=120)
    column: Optional[int] = Field(default=None, ge=0, le=5000)
    seconds: Optional[float] = Field(default=None, ge=1, le=86_400)
    times: Optional[str] = Field(default=None, max_length=500, pattern=r"^[0-9:., ]*$")


class MergeOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Word: start each document on a new page.
    page_breaks: bool = True
    # Spreadsheets: every sheet side by side, or every file's rows stacked into one sheet.
    mode: Literal["sheets", "stack"] = "sheets"
    source_column: bool = True
    first_sheet_only: bool = True
    # Stacked spreadsheets: csv or xlsx. Audio: the format to save in.
    output: Optional[Literal["xlsx", "csv", "mp3", "m4a", "wav", "flac", "ogg", "opus"]] = None


class InspectResponse(BaseModel):
    family: str = Field(..., examples=["slides"])
    units: float = Field(..., description="Pages, slides, rows or seconds, depending on the family.")
    titles: Optional[List[str]] = None
    headings: Optional[Dict[str, int]] = Field(default=None, description="Word: parts each heading level would make (0: none).")
    breaks: Optional[int] = None
    pages: Optional[int] = None
    sheets: Optional[List[Dict[str, Any]]] = None
    text: Optional[bool] = None
    duration: Optional[float] = None
