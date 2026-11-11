from fastapi import status
from app.exceptions.base import AppBaseException


class InvalidConvertInputError(AppBaseException):
    def __init__(self, detail: str = "Invalid document or options"):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class ConvertProcessingError(AppBaseException):
    def __init__(self, detail: str = "The document couldn't be converted"):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class ConverterUnavailableError(AppBaseException):
    """A converter this server relies on (LibreOffice, Chromium) isn't installed."""

    def __init__(self, detail: str = "This conversion isn't available on this server yet."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
