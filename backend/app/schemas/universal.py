from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class FormatInfo(BaseModel):
    id: str = Field(..., examples=["docx"])
    label: str = Field(..., examples=["Word document"])
    category: str = Field(..., examples=["document"])
    extensions: List[str] = Field(..., examples=[[".docx"]])


class RouteStep(BaseModel):
    source: str
    target: str
    engine: str


class Route(BaseModel):
    target: str
    steps: List[RouteStep]
    bundle: bool = Field(False, description="The result may come as a ZIP (one file per page, sheet or slide).")


class CategoryInfo(BaseModel):
    id: str
    label: str


class FormatsResponse(BaseModel):
    categories: List[CategoryInfo]
    formats: List[FormatInfo]
    routes: Dict[str, List[Route]] = Field(..., description="For each input format: every format it can become.")
    engines: Dict[str, bool] = Field(..., description="Which converters this server has installed.")
    max_mb: int


class ConvertOptions(BaseModel):
    """Fine-tuning for the step that makes the result. Each engine reads only the keys it knows."""

    model_config = ConfigDict(extra="forbid")

    # PDF to JPG/PNG: draw each page, or pull out the pictures inside; at what resolution; which pages.
    images: Optional[Literal["pages", "extract"]] = None
    dpi: Optional[Literal[72, 150, 220, 300]] = None
    pages: Optional[str] = Field(default=None, max_length=200, pattern=r"^[0-9,\- ]*$")
    # PDF to Excel: a sheet per table, or per page.
    sheets: Optional[Literal["tables", "pages"]] = None
    # Spreadsheet to PDF: shrink each sheet onto a single page.
    fit_sheets: Optional[bool] = None
    # To MP3/M4A/AAC/Opus/OGG: audio bitrate in kbps.
    bitrate: Optional[Literal[64, 96, 128, 160, 192, 256, 320]] = None
