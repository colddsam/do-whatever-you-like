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



def writable_cookie_copy(source, workdir) -> str | None:
    """
    yt-dlp writes its cookie jar back to the cookie file when it finishes, and Render's secret files
    are read-only, so hand it a private copy in a writable folder. Returns None when there's no file.
    """
    import os
    import shutil
    from pathlib import Path

    if not source or not os.path.exists(source):
        return None
    dest = Path(workdir) / f".{Path(source).name}"
    try:
        if not dest.exists() or os.path.getmtime(source) > os.path.getmtime(dest):
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, dest)
        return str(dest)
    except OSError:
        return str(source)
