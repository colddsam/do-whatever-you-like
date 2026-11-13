"""
Archives: ZIP, 7z, TAR (plain, gz, bz2, xz) and single .gz files → ZIP, 7z or any TAR.

Unpacking someone else's archive is where the classic attacks live, so every entry is checked:
names can't climb out of the folder ("../") or be absolute, links and devices are skipped, and the
number of files and the bytes actually written are counted, so a "zip bomb" stops early.
"""

import gzip
import os
import shutil
import tarfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Optional

from app.config.universal import settings
from app.exceptions.universal import InvalidUniversalInputError, UniversalConversionError, UniversalUnavailableError
from app.services.universal.engines.common import Ctx, ensure, output

CHUNK = 1024 * 256


class _Budget:
    def __init__(self) -> None:
        self.files = 0
        self.bytes = 0
        self.max_bytes = settings.ARCHIVE_MAX_UNPACKED_MB * 1024 * 1024

    def add_file(self) -> None:
        self.files += 1
        if self.files > settings.ARCHIVE_MAX_FILES:
            raise InvalidUniversalInputError(f"That archive has more than {settings.ARCHIVE_MAX_FILES:,} files.")

    def add_bytes(self, n: int) -> None:
        self.bytes += n
        if self.bytes > self.max_bytes:
            raise InvalidUniversalInputError(f"That archive unpacks to more than {settings.ARCHIVE_MAX_UNPACKED_MB} MB.")


def _safe_target(staging: Path, name: str) -> Optional[Path]:
    """Where an entry may be written, or None if its name tries to leave the folder."""
    parts = [p for p in PurePosixPath(name.replace("\\", "/")).parts if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts) or parts[0].endswith(":") or name.startswith(("/", "\\")):
        return None
    target = staging.joinpath(*parts)
    try:
        target.resolve().relative_to(staging.resolve())
    except ValueError:
        return None
    return target


def _copy(stream: BinaryIO, dest: Path, budget: _Budget) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as fh:
        while chunk := stream.read(CHUNK):
            budget.add_bytes(len(chunk))
            fh.write(chunk)


def _unpack(src: Path, fmt: str, staging: Path, ctx: Ctx) -> None:
    budget = _Budget()
    skipped = 0
    if fmt == "zip":
        try:
            zf = zipfile.ZipFile(src)
        except zipfile.BadZipFile:
            raise InvalidUniversalInputError("That isn't a readable ZIP file.")
        with zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if info.flag_bits & 0x1:
                    raise InvalidUniversalInputError("This ZIP is password-protected, so it can't be repacked.")
                # Unix symlinks are stored as files with the S_IFLNK mode.
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    skipped += 1
                    continue
                target = _safe_target(staging, info.filename)
                if target is None:
                    skipped += 1
                    continue
                budget.add_file()
                with zf.open(info) as stream:
                    _copy(stream, target, budget)
    elif fmt in ("tar", "tar.gz", "tar.bz2", "tar.xz"):
        try:
            tf = tarfile.open(src, "r:*")
        except (tarfile.TarError, OSError):
            raise InvalidUniversalInputError("That isn't a readable TAR archive.")
        with tf:
            for member in tf:
                if not member.isfile():
                    skipped += 0 if member.isdir() else 1
                    continue
                target = _safe_target(staging, member.name)
                if target is None:
                    skipped += 1
                    continue
                budget.add_file()
                stream = tf.extractfile(member)
                if stream is not None:
                    with stream:
                        _copy(stream, target, budget)
    elif fmt == "7z":
        try:
            import py7zr
        except ImportError:
            raise UniversalUnavailableError("7-Zip archives aren't supported on this server yet.")
        try:
            with py7zr.SevenZipFile(src, "r") as sz:
                if sz.needs_password():
                    raise InvalidUniversalInputError("This 7z archive is password-protected, so it can't be repacked.")
                entries = sz.list()
                for e in entries:
                    if e.is_symlink or (not e.is_directory and _safe_target(staging, e.filename) is None):
                        raise InvalidUniversalInputError("This 7z archive has links or unsafe paths, so it can't be repacked.")
                    if not e.is_directory:
                        budget.add_file()
                        budget.add_bytes(e.uncompressed or 0)
                sz.extractall(path=staging)
        except InvalidUniversalInputError:
            raise
        except Exception:
            raise InvalidUniversalInputError("That isn't a readable 7z archive.")
    elif fmt == "gz":
        target = staging / (ctx.stem or "file")
        try:
            with gzip.open(src, "rb") as stream:
                budget.add_file()
                _copy(stream, target, budget)
        except (OSError, EOFError):
            raise InvalidUniversalInputError("That isn't a readable .gz file.")
    else:
        raise InvalidUniversalInputError("That archive format isn't supported.")
    if skipped:
        ctx.notes.append(f"{skipped} link{'s' if skipped != 1 else ''} or unsafe entr{'ies' if skipped != 1 else 'y'} left out.")
    if not any(p.is_file() for p in staging.rglob("*")):
        raise InvalidUniversalInputError("That archive is empty.")


def _files(staging: Path):
    for root, dirs, files in os.walk(staging, followlinks=False):
        dirs.sort()
        for name in sorted(files):
            path = Path(root) / name
            if path.is_file() and not path.is_symlink():
                yield path, path.relative_to(staging).as_posix()


def convert(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    source = "tar.gz" if src.name.endswith(".tar.gz") else "tar.bz2" if src.name.endswith(".tar.bz2") else "tar.xz" if src.name.endswith(".tar.xz") else src.suffix.lstrip(".")
    staging = work / "unpacked"
    staging.mkdir(parents=True, exist_ok=True)
    _unpack(src, source, staging, ctx)
    out = output(work, ctx, target)
    try:
        if target == "zip":
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
                for path, arc in _files(staging):
                    zf.write(path, arcname=arc)
        elif target in ("tar", "tar.gz", "tar.bz2", "tar.xz"):
            mode = {"tar": "w", "tar.gz": "w:gz", "tar.bz2": "w:bz2", "tar.xz": "w:xz"}[target]
            with tarfile.open(out, mode) as tf:
                for path, arc in _files(staging):
                    tf.add(path, arcname=arc, recursive=False)
        elif target == "7z":
            import py7zr

            with py7zr.SevenZipFile(out, "w") as sz:
                for path, arc in _files(staging):
                    sz.write(path, arcname=arc)
        else:
            raise InvalidUniversalInputError("That archive format isn't supported.")
    except InvalidUniversalInputError:
        raise
    except Exception as exc:
        raise UniversalConversionError(f"The {target.upper()} archive couldn't be written.") from exc
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return ensure(out)
