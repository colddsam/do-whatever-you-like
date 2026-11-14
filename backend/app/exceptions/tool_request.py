from fastapi import status

from app.exceptions.base import AppBaseException


class InvalidToolRequestError(AppBaseException):
    def __init__(self, detail: str = "Please write a short description of the tool you need."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class ToolRequestRateLimitError(AppBaseException):
    def __init__(self, detail: str = "Too many tool requests sent recently. Please try again later."):
        super().__init__(detail=detail, status_code=status.HTTP_429_TOO_MANY_REQUESTS)


class ToolRequestDeliveryError(AppBaseException):
    def __init__(self, detail: str = "Could not deliver your tool request right now. Please try emailing directly."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
