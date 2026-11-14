from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidMediaInputError(AppBaseException):
    def __init__(self, detail: str = "That file or setting isn't valid."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class MediaProcessingError(AppBaseException):
    def __init__(self, detail: str = "That file couldn't be processed."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class MediaUnavailableError(AppBaseException):
    def __init__(self, detail: str = "Audio and video tools aren't available on this server right now."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
