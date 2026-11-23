from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidMusicInputError(AppBaseException):
    def __init__(self, detail: str = "That request isn't valid."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class MusicProcessingError(AppBaseException):
    def __init__(self, detail: str = "The song couldn't be planned. Try again."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class MusicUnavailableError(AppBaseException):
    """No AI key is configured, or every provider is out of quota right now."""

    def __init__(self, detail: str = "The AI composer is busy right now. The studio's built-in composer still works."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
