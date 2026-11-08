import shutil
from pathlib import Path


def cleanup_folder(folder_path: Path) -> None:
    """Safely remove a temporary directory after a response completes."""
    if folder_path.exists():
        shutil.rmtree(folder_path, ignore_errors=True)


def cleanup_file(file_path: Path) -> None:
    """Safely remove a temporary file after a response completes."""
    try:
        if file_path.is_file():
            file_path.unlink(missing_ok=True)
    except Exception:
        pass

