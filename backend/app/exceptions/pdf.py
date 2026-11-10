from fastapi import status
from app.exceptions.base import AppBaseException


class PDFProcessingError(AppBaseException):
    def __init__(self, detail: str = "Failed to process PDF file"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class InvalidPDFInputError(AppBaseException):
    def __init__(self, detail: str = "Invalid PDF file or parameters"):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_400_BAD_REQUEST,
        )



class PDFUploadExpiredError(AppBaseException):
    def __init__(self, detail: str = "That upload has expired. Add the PDF again."):
        super().__init__(
            detail=detail,
            status_code=status.HTTP_410_GONE,
        )
