from pydantic import BaseModel, Field
from typing import List, Literal, Optional


class DownloadRequest(BaseModel):
    url_or_shortcode: str = Field(
        ...,
        min_length=5,
        max_length=512,
        description="Instagram post/reel URL or shortcode",
    )
    audio: Optional[Literal["m4a", "mp3"]] = Field(
        default=None,
        description="Save only the sound: 'm4a' (original quality, instant) or 'mp3' (encoded). Omit for the video.",
    )


class MediaItem(BaseModel):
    type: str
    url: str
    thumbnail: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None
    size: Optional[int] = None


class MediaResponse(BaseModel):
    shortcode: str
    title: Optional[str] = None
    owner_username: str
    is_carousel: bool
    media_count: int
    thumbnail: Optional[str] = None
    duration: Optional[float] = None
    estimated_size: Optional[int] = Field(
        default=None, description="Predicted size in bytes of what the download endpoint returns"
    )
    size_is_exact: bool = Field(default=False, description="False when any part of the size is approximated")
    items: List[MediaItem]
