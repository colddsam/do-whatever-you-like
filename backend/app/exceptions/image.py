from fastapi import status
from app.exceptions.base import AppBaseException


class InvalidImageError(AppBaseException):
    def __init__(self, detail: str = "That image or those options don't work here."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class ImageProcessingError(AppBaseException):
    def __init__(self, detail: str = "The image couldn't be processed."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class ImageToolUnavailableError(AppBaseException):
    """A model or program this tool needs isn't on this server (and couldn't be fetched)."""

    def __init__(self, detail: str = "This image tool isn't available on this server yet."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
