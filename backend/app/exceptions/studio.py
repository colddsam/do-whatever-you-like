from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidStudioInputError(AppBaseException):
    def __init__(self, detail: str = "That request isn't valid."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class StudioProcessingError(AppBaseException):
    def __init__(self, detail: str = "That didn't work. Try again."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class StudioUpstreamError(AppBaseException):
    """The file's host or the AI provider failed or answered with an error."""

    def __init__(self, detail: str = "The source didn't answer. Try again in a moment."):
        super().__init__(detail=detail, status_code=status.HTTP_502_BAD_GATEWAY)
