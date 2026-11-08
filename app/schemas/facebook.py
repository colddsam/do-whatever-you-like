from pydantic import BaseModel, Field
from typing import List, Optional


class FacebookDownloadRequest(BaseModel):
    url: str = Field(
        ...,
        min_length=10,
        max_length=512,
        description="Public Facebook video or reel URL",
        examples=["https://www.facebook.com/reel/1195289147628387"],
    )


class FacebookMediaItem(BaseModel):
    id: str
    type: str = "video"
    url: str
    ext: str = "mp4"
    format_id: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


class FacebookMediaResponse(BaseModel):
    id: str
    title: Optional[str] = None
    uploader: Optional[str] = None
    duration: Optional[float] = None
    thumbnail: Optional[str] = None
    items: List[FacebookMediaItem]

