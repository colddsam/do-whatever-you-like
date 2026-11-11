from fastapi import status
from app.exceptions.base import AppBaseException


class InvalidAudioFileError(AppBaseException):
    def __init__(self, detail: str = "That file can't be transcribed."):
        super().__init__(detail=detail, status_code=status.HTTP_400_BAD_REQUEST)


class TranscriptionError(AppBaseException):
    def __init__(self, detail: str = "The audio couldn't be transcribed."):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


class TranscriberUnavailableError(AppBaseException):
    """No speech engine is set up on this server (faster-whisper missing, no Groq key)."""

    def __init__(self, detail: str = "Speech to text isn't available on this server yet."):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
