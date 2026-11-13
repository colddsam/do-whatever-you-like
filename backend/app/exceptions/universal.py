from fastapi import status
from app.exceptions.base import AppBaseException


class InvalidUniversalInputError(AppBaseException):
    def __init__(self, detail: str = "That file or format isn't supported."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class UniversalConversionError(AppBaseException):
    def __init__(self, detail: str = "That file couldn't be converted."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class UniversalUnavailableError(AppBaseException):
    """A converter this route needs isn't installed, or every slot is busy."""

    def __init__(self, detail: str = "This conversion isn't available on this server right now."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
