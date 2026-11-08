from fastapi import status
from app.exceptions.base import AppBaseException


class FacebookExtractionError(AppBaseException):
    def __init__(self, detail: str = "Failed to extract Facebook media"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class InvalidFacebookURLError(AppBaseException):
    def __init__(self, detail: str = "Invalid Facebook video or reel URL"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
        )

