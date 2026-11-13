from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class IconOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # pack: a ZIP with a folder per platform · ico: one .ico file with the sizes picked
    mode: Literal["pack", "ico"] = "pack"
    packs: List[Literal["web", "windows", "macos", "ios", "android", "desktop"]] = Field(default_factory=lambda: ["web"], max_length=6)
    sizes: List[Literal[16, 20, 24, 32, 40, 48, 64, 96, 128, 256]] = Field(default_factory=list, max_length=10)
    shape: Literal["square", "rounded", "circle"] = "square"
    # Space around the picture, as a share of the icon's width on each side.
    padding: float = Field(default=0.0, ge=0.0, le=0.3)
    # A colour behind the picture (#RRGGBB), or none for transparent.
    background: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    # App name for the web manifest.
    name: Optional[str] = Field(default=None, max_length=40)
