from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_CUT_SEGMENTS = 60


class MediaSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(..., ge=0, description="Segment start time in seconds")
    end: float = Field(..., gt=0, description="Segment end time in seconds")
    label: Optional[str] = Field(default=None, max_length=60, description="Optional short filename label")

    @field_validator("end")
    @classmethod
    def check_order(cls, v: float, info) -> float:
        start = info.data.get("start")
        if start is not None and v <= start:
            raise ValueError("Segment end must come after start.")
        return v


class CutPartsPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    segments: List[MediaSegment] = Field(..., min_length=1, max_length=MAX_CUT_SEGMENTS)
    combine: Literal["parts", "join"] = "parts"
    output_format: Literal[
        "original",
        "mp4",
        "mov",
        "mkv",
        "webm",
        "gif",
        "mp3",
        "m4a",
        "wav",
        "flac",
        "ogg",
        "opus",
    ] = "original"
    exact: bool = False
