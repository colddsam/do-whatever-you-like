from fastapi import status

from app.exceptions.base import AppBaseException


class UnsupportedFileError(AppBaseException):
    """A file whose name or contents aren't what the endpoint accepts (app/core/file_guard.py)."""

    def __init__(self, detail: str = "That file type isn't accepted here."):
        super().__init__(detail=detail, status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)


class RequestTooLargeError(AppBaseException):
    def __init__(self, detail: str = "That upload is too large."):
        super().__init__(detail=detail, status_code=status.HTTP_413_CONTENT_TOO_LARGE)
