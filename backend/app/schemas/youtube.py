from pydantic import BaseModel, Field
from typing import List, Literal, Optional


class YoutubeDownloadRequest(BaseModel):
    url: str = Field(
        ...,
        min_length=10,
        max_length=512,
        description="Public YouTube video or Shorts URL",
        examples=["https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    )
    quality: str = Field(
        default="auto",
        pattern=r"^(auto|audio|\d{3,4})$",
        description="'auto' (the best that fits the size cap), a height like '720', or 'audio' (M4A)",
    )
    audio: Optional[Literal["m4a", "mp3"]] = Field(
        default=None,
        description="Save only the sound: 'm4a' (original quality, instant) or 'mp3' (encoded). Omit for the video.",
    )


class YoutubeQuality(BaseModel):
    id: str = Field(description="What to send as `quality`: a height like '720', or 'audio'")
    label: str
    height: Optional[int] = None
    ext: str
    size: Optional[int] = None
    size_is_exact: bool = False
    fits: bool = Field(description="False when it's over the size cap and can't be downloaded")


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
    estimated_size: Optional[int] = Field(
        default=None, description="Predicted size in bytes of what the download endpoint returns"
    )
    size_is_exact: bool = Field(default=False, description="False when any part of the size is approximated")
    items: List[YoutubeMediaItem]
    qualities: List[YoutubeQuality] = Field(default_factory=list, description="Best first; the first that fits is the default")
    default_quality: Optional[str] = None
    max_download_mb: int = 0

