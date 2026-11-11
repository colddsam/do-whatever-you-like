from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class Area(BaseModel):
    """A rectangle in fractions of the image as seen (EXIF orientation applied), 0 at top-left."""

    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)
    w: float = Field(..., gt=0, le=1)
    h: float = Field(..., gt=0, le=1)


class FaceBox(Area):
    score: float


class FaceDetection(BaseModel):
    width: int
    height: int
    faces: List[FaceBox]


class TextMark(BaseModel):
    text: str = Field(..., min_length=1, max_length=200)
    font: Literal["sans", "serif", "mono", "impact", "hand"] = "sans"
    bold: bool = True
    italic: bool = False
    # Font size as a fraction of the image's width, so a batch of different sizes looks alike.
    size: float = Field(0.06, ge=0.01, le=0.5)
    color: str = Field("#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    shadow: bool = True


class WatermarkOptions(BaseModel):
    kind: Literal["text", "image"] = "text"
    text: Optional[TextMark] = None
    # Image marks: width as a fraction of the image's width.
    scale: float = Field(0.25, ge=0.02, le=1)
    opacity: float = Field(0.5, ge=0.05, le=1)
    rotation: float = Field(0, ge=-180, le=180)
    position: Literal["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] = "br"
    # Tile the mark across the whole image (harder to crop out).
    mosaic: bool = False
    # Space between the mark and the edge, as a fraction of the image's shorter side.
    margin: float = Field(0.03, ge=0, le=0.25)


class Capabilities(BaseModel):
    heic: bool
    raw: bool
    svg: bool
    background: bool
    upscale: bool
    faces: bool
    web: bool
    max_files: int
    max_pixels: int
    upscale_max_output_pixels: int
