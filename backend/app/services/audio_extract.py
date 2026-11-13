"""
Audio out of a downloaded video, shared by the YouTube, Instagram and Facebook downloaders.

M4A keeps the original sound: the AAC track is copied as it is (no quality loss, a second or two
even for a long video). Sources whose track isn't AAC (Opus in WebM) are re-encoded at 192 kb/s.
MP3 is always an encode (LAME VBR ~190 kb/s), which on a 0.1-CPU instance runs at roughly real
time, so it's capped by length (AUDIO_MP3_MAX_SECONDS); M4A isn't.
"""

import json
import logging
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

from app.core.config import app_settings
from app.services.ffmpeg_service import init_ffmpeg

logger = logging.getLogger(__name__)

AUDIO_FORMATS = ("m4a", "mp3")
VIDEO_SUFFIXES = {".mp4", ".mkv", ".webm", ".mov", ".m4v"}
AUDIO_SUFFIXES = {".m4a", ".webm", ".opus", ".ogg", ".mp3", ".aac"}
MEDIA_TYPES = {".m4a": "audio/mp4", ".mp3": "audio/mpeg"}


class AudioExtractError(Exception):
    """A clean, user-facing reason; each platform wraps it in its own 422."""


def _tool(name: str) -> str:
    init_ffmpeg()  # static_ffmpeg puts ffmpeg and ffprobe on PATH
    found = shutil.which(name)
    if not found:
        raise AudioExtractError("Audio extraction isn't available on this server right now.")
    return found


def _probe(src: Path) -> tuple[Optional[str], Optional[float]]:
    """(codec of the first audio stream or None, duration in seconds)."""
    proc = subprocess.run(
        [_tool("ffprobe"), "-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration", "-of", "json", str(src)],
        capture_output=True,
        timeout=60,
    )
    try:
        data = json.loads(proc.stdout or b"{}")
    except json.JSONDecodeError:
        return None, None
    codec = next((s.get("codec_name") for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    try:
        duration = float(data.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        duration = None
    return codec, duration


def extract_audio(src: Path, fmt: str, out_stem: Optional[str] = None) -> Path:
    """Writes `<stem>.m4a` or `<stem>.mp3` next to `src` and returns it. The source is left alone."""
    if fmt not in AUDIO_FORMATS:
        raise AudioExtractError("Pick M4A or MP3.")
    codec, duration = _probe(src)
    if not codec:
        raise AudioExtractError("This video has no sound to extract.")
    if fmt == "mp3" and duration and duration > app_settings.AUDIO_MP3_MAX_SECONDS:
        raise AudioExtractError(
            f"MP3 is available for videos up to {app_settings.AUDIO_MP3_MAX_SECONDS // 60} minutes "
            f"(this one is {duration / 60:.0f}). Choose M4A: it keeps the original sound and has no length limit."
        )

    out = src.with_name(f"{out_stem or src.stem}.{fmt}")
    if out == src:
        out = src.with_name(f"{out_stem or src.stem}.audio.{fmt}")
    if fmt == "m4a":
        codec_args = ["-c:a", "copy"] if codec == "aac" else ["-c:a", "aac", "-b:a", "192k"]
        extra = ["-movflags", "+faststart"]
    else:
        codec_args = ["-c:a", "libmp3lame", "-q:a", "2"]
        extra = ["-id3v2_version", "3"]

    # Copying takes seconds; encoding on a slow CPU takes up to about the clip's length.
    timeout = 120 if codec_args[1] == "copy" else int(120 + 1.5 * (duration or 600))
    cmd = [_tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-map", "0:a:0", "-vn", "-sn", "-dn", *codec_args, *extra, str(out)]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        out.unlink(missing_ok=True)
        raise AudioExtractError("Extracting the audio took too long. Try M4A, which is much faster.")
    if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        logger.error("ffmpeg audio extraction failed for %s: %s", src.name, proc.stderr.decode(errors="replace")[-400:])
        out.unlink(missing_ok=True)
        raise AudioExtractError("The audio couldn't be extracted from this video.")
    return out


def files_to_audio(files: List[Path], fmt: str) -> List[Path]:
    """
    Every video (or audio-only download) in `files` becomes one audio file; photos are dropped.
    Raises when nothing in the post has sound.
    """
    media = [f for f in files if f.suffix.lower() in VIDEO_SUFFIXES | AUDIO_SUFFIXES]
    if not media:
        raise AudioExtractError("This post has only photos, so there's no audio to extract.")
    out: List[Path] = []
    silent = 0
    for f in media:
        if f.suffix.lower() == f".{fmt}":
            out.append(f)  # Already the format asked for.
            continue
        try:
            out.append(extract_audio(f, fmt))
        except AudioExtractError as exc:
            if "no sound" in str(exc) and len(media) > 1:
                silent += 1  # One silent clip in a carousel: skip it, keep the rest.
                continue
            raise
        f.unlink(missing_ok=True)
    if not out:
        raise AudioExtractError("None of the videos in this post have sound.")
    if silent:
        logger.info("Skipped %d silent clip(s) while extracting audio", silent)
    return out
