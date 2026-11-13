from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidMergeSplitInputError(AppBaseException):
    def __init__(self, detail: str = "Those files can't be merged or split."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class MergeSplitProcessingError(AppBaseException):
    def __init__(self, detail: str = "The files couldn't be merged or split."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class MergeSplitUnavailableError(AppBaseException):
    """A program this job needs isn't installed, or every slot is busy."""

    def __init__(self, detail: str = "This isn't available on this server right now."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
