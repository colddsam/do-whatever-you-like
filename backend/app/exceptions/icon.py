from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidIconInputError(AppBaseException):
    def __init__(self, detail: str = "That picture can't be made into icons."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class IconProcessingError(AppBaseException):
    def __init__(self, detail: str = "The icons couldn't be made."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class IconUnavailableError(AppBaseException):
    """A program this job needs isn't installed, or every slot is busy."""

    def __init__(self, detail: str = "This isn't available on this server right now."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
