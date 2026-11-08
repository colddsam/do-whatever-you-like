from pydantic import BaseModel, Field
from typing import List, Optional


class DownloadRequest(BaseModel):
    url_or_shortcode: str = Field(
        ...,
        min_length=5,
        max_length=512,
        description="Instagram post/reel URL or shortcode",
    )


class MediaItem(BaseModel):
    type: str
    url: str
    width: Optional[int] = None
    height: Optional[int] = None


class MediaResponse(BaseModel):
    shortcode: str
    title: Optional[str] = None
    owner_username: str
    is_carousel: bool
    media_count: int
    items: List[MediaItem]
