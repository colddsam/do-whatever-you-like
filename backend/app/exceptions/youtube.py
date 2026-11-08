from fastapi import status
from app.exceptions.base import AppBaseException


class YoutubeExtractionError(AppBaseException):
    def __init__(self, detail: str = "Failed to extract YouTube media"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class InvalidYoutubeURLError(AppBaseException):
    def __init__(self, detail: str = "Invalid YouTube video or Shorts URL"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
        )

