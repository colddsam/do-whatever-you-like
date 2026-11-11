"""
JSON payloads for the PDF tools that place things on pages (edit, sign, redact, crop).

Positions are fractions of the page as it is seen (rotation applied), 0 at the top-left, so the
browser can lay them out on a thumbnail of any size without knowing the PDF's point sizes.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

HEX = r"^#[0-9a-fA-F]{6}$"


class Box(BaseModel):
    x0: float = Field(..., ge=0, le=1)
    y0: float = Field(..., ge=0, le=1)
    x1: float = Field(..., ge=0, le=1)
    y1: float = Field(..., ge=0, le=1)

    @model_validator(mode="after")
    def _ordered(self) -> "Box":
        if self.x1 - self.x0 < 0.002 or self.y1 - self.y0 < 0.002:
            raise ValueError("A box needs some width and height.")
        return self


class EditOp(BaseModel):
    """One thing added to a page by Edit PDF or Sign PDF."""

    type: Literal["text", "image", "rect", "ellipse", "line", "highlight", "whiteout", "ink"]
    page: int = Field(..., ge=1, description="1-based page number")
    box: Optional[Box] = None
    # text
    text: str = Field(default="", max_length=5000)
    font: Literal["sans", "serif", "mono"] = "sans"
    size: float = Field(default=14, ge=4, le=200, description="Font size in points")
    bold: bool = False
    italic: bool = False
    align: Literal["left", "center", "right"] = "left"
    # colours and strokes
    color: str = Field(default="#000000", pattern=HEX)
    fill: Optional[str] = Field(default=None, pattern=HEX)
    width: float = Field(default=2, ge=0, le=40, description="Stroke width in points")
    opacity: float = Field(default=1, ge=0.05, le=1)
    # image: index into the uploaded `images`
    image: Optional[int] = Field(default=None, ge=0, le=50)
    # line: from (x0, y0) to (x1, y1) of `box`, unordered; ink: a freehand stroke
    line: Optional[List[float]] = Field(default=None, min_length=4, max_length=4)
    points: Optional[List[List[float]]] = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def _shape(self) -> "EditOp":
        if self.type in ("text", "image", "rect", "ellipse", "highlight", "whiteout") and self.box is None:
            raise ValueError(f"A {self.type} needs a box.")
        if self.type == "image" and self.image is None:
            raise ValueError("An image needs the index of its uploaded file.")
        if self.type == "text" and not self.text.strip():
            raise ValueError("A text box can't be empty.")
        if self.type == "line" and self.line is None:
            raise ValueError("A line needs its two ends.")
        if self.type == "ink":
            if not self.points or len(self.points) < 2:
                raise ValueError("A drawing needs at least two points.")
            if any(len(p) != 2 or not (0 <= p[0] <= 1 and 0 <= p[1] <= 1) for p in self.points):
                raise ValueError("Drawing points must be [x, y] fractions of the page.")
        if self.line is not None and any(not (0 <= v <= 1) for v in self.line):
            raise ValueError("Line ends must be fractions of the page.")
        return self


class RedactArea(BaseModel):
    page: int = Field(..., ge=1)
    box: Box


class RedactTerm(BaseModel):
    text: str = Field(..., min_length=1, max_length=200)
    case_sensitive: bool = False
    whole_word: bool = False


RedactPreset = Literal["email", "phone", "card", "date", "url", "ssn", "iban"]


class RedactSearch(BaseModel):
    terms: List[RedactTerm] = Field(default_factory=list, max_length=50)
    presets: List[RedactPreset] = Field(default_factory=list)
