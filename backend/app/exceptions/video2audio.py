from fastapi import status
from app.exceptions.base import AppBaseException


class AudioExtractionError(AppBaseException):
    def __init__(self, detail: str = "Failed to extract audio from video"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class InvalidVideoFileError(AppBaseException):
    def __init__(self, detail: str = "Invalid or unsupported video file"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
        )

