from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidDevtoolsInputError(AppBaseException):
    def __init__(self, detail: str = "That input isn't valid."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class DevtoolsProcessingError(AppBaseException):
    def __init__(self, detail: str = "That didn't work. Try again."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)
