from fastapi import status
from app.exceptions.base import AppBaseException


class InvalidQRCodeInputError(AppBaseException):
    def __init__(self, detail: str = "Invalid QR code input or customization parameters"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class QRCodeGenerationError(AppBaseException):
    def __init__(self, detail: str = "Failed to generate QR code"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )

