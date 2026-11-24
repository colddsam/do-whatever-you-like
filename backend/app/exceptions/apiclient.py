from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidApiClientInputError(AppBaseException):
    def __init__(self, detail: str = "That request isn't valid."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class ApiClientProcessingError(AppBaseException):
    """The target couldn't be reached or answered badly (DNS, connect, TLS, timeout)."""

    def __init__(self, detail: str = "The request couldn't be completed."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)
