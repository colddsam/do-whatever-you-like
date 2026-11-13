from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidFontsInputError(AppBaseException):
    def __init__(self, detail: str = "That file can't be checked as a font."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class FontsProcessingError(AppBaseException):
    def __init__(self, detail: str = "The font couldn't be checked."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class FontsUnavailableError(AppBaseException):
    """A program this job needs isn't installed, or every slot is busy."""

    def __init__(self, detail: str = "This isn't available on this server right now."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
