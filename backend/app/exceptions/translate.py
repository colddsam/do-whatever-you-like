from fastapi import status
from app.exceptions.base import AppBaseException


class InvalidTranslateInputError(AppBaseException):
    def __init__(self, detail: str = "That translation request isn't valid."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class TranslationError(AppBaseException):
    def __init__(self, detail: str = "We couldn't complete that translation. Try again in a moment."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class TranslationResultExpiredError(AppBaseException):
    def __init__(self, detail: str = "That translated file expired. Translate the recording again to download a fresh copy."):
        super().__init__(detail=detail, status_code=status.HTTP_410_GONE)


class TranslatorUnavailableError(AppBaseException):
    def __init__(self, detail: str = "Translation isn't available on this server right now."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
