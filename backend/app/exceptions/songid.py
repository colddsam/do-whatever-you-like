from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidSongQueryError(AppBaseException):
    def __init__(self, detail: str = "That search isn't valid."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class InvalidSongClipError(AppBaseException):
    def __init__(self, detail: str = "We couldn't read that recording. Try recording again."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class SongIdProcessingError(AppBaseException):
    def __init__(self, detail: str = "We couldn't search for that song. Try again."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class SongIdUnavailableError(AppBaseException):
    """No AI key is configured, or every free provider is out of quota right now."""

    def __init__(self, detail: str = "The song finder is busy right now. Try again in a minute."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
