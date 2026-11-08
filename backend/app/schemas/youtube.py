from pydantic import BaseModel, Field
from typing import List, Optional


class YoutubeDownloadRequest(BaseModel):
    url: str = Field(
        ...,
        min_length=10,
        max_length=512,
        description="Public YouTube video or Shorts URL",
        examples=["https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    )


class YoutubeMediaItem(BaseModel):
    id: str
    type: str = "video"
    url: str
    ext: str = "mp4"
    format_id: Optional[str] = None
    resolution: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None


class YoutubeMediaResponse(BaseModel):
    id: str
    title: Optional[str] = None
    uploader: Optional[str] = None
    duration: Optional[float] = None
    view_count: Optional[int] = None
    thumbnail: Optional[str] = None
    is_short: bool = False
    items: List[YoutubeMediaItem]

