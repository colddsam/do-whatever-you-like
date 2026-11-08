from fastapi import status
from app.exceptions.base import AppBaseException


class MediaExtractionError(AppBaseException):
    def __init__(self, detail: str = "Failed to extract Instagram media"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class InvalidInstagramURLError(AppBaseException):
    def __init__(self, detail: str = "Invalid Instagram URL or shortcode"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
        )
