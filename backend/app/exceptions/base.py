from fastapi import HTTPException, status


class AppBaseException(HTTPException):
    """Base HTTP exception for all application modules."""

    def __init__(
        self,
        detail: str = "An unexpected application error occurred",
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
    ):
        super().__init__(status_code=status_code, detail=detail)

