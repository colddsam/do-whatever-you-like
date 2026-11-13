from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidPaletteInputError(AppBaseException):
    def __init__(self, detail: str = "Colours can't be read from that file."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class PaletteProcessingError(AppBaseException):
    def __init__(self, detail: str = "The colours couldn't be read."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class PaletteUnavailableError(AppBaseException):
    """A program this job needs isn't installed, or every slot is busy."""

    def __init__(self, detail: str = "This isn't available on this server right now."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
