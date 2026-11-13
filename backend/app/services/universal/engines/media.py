"""
Audio, video and subtitles with FFmpeg.

Safety: an uploaded "video" may really be a playlist (HLS, concat, SDP) that tells FFmpeg to fetch
web addresses or read files on the server. Inputs are probed first and those formats refused, and
FFmpeg may only open local files (`-protocol_whitelist file`).

Speed: when a video's streams already fit the new container they are copied, not re-encoded, which
takes seconds instead of minutes on a small server.
"""

import json
import logging
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config.universal import settings
from app.exceptions.universal import InvalidUniversalInputError, UniversalConversionError, UniversalUnavailableError
from app.services.universal.engines.common import Ctx, ensure, output, run, tail
from app.services.universal.graph import ffmpeg_path

logger = logging.getLogger(__name__)

UNSAFE_DEMUXERS = {"hls", "applehttp", "concat", "ffconcat", "dash", "sdp", "rtp", "rtsp", "image2", "image2pipe", "tee", "lavfi"}
LOCAL_ONLY = ["-protocol_whitelist", "file"]

AUDIO_ARGS: Dict[str, List[str]] = {
    "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
    "wav": ["-c:a", "pcm_s16le"],
    "ogg": ["-c:a", "libvorbis", "-q:a", "5"],
    "flac": ["-c:a", "flac"],
    "m4a": ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
    "aac": ["-c:a", "aac", "-b:a", "192k", "-f", "adts"],
    "opus": ["-c:a", "libopus", "-b:a", "128k"],
    "wma": ["-c:a", "wmav2", "-b:a", "192k"],
    "aiff": ["-c:a", "pcm_s16be"],
    "ac3": ["-c:a", "ac3", "-b:a", "192k"],
}
# Codecs each audio format holds as they are (so M4A → AAC is a copy, not a re-encode).
AUDIO_COPY = {"mp3": {"mp3"}, "m4a": {"aac", "alac"}, "aac": {"aac"}, "ogg": {"vorbis"}, "opus": {"opus"}, "flac": {"flac"}, "ac3": {"ac3"}}

H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]
EVEN = ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]
VIDEO_ARGS: Dict[str, List[str]] = {
    "mp4": H264 + EVEN + ["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
    "m4v": H264 + EVEN + ["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
    "mov": H264 + EVEN + ["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
    "mkv": H264 + EVEN + ["-c:a", "aac", "-b:a", "160k"],
    "flv": H264 + EVEN + ["-c:a", "aac", "-b:a", "160k", "-ar", "44100"],
    "webm": ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "34", "-b:v", "0",
             "-pix_fmt", "yuv420p"] + EVEN + ["-c:a", "libopus", "-b:a", "128k"],
    "avi": ["-c:v", "mpeg4", "-q:v", "4", "-vtag", "xvid"] + EVEN + ["-c:a", "libmp3lame", "-b:a", "192k"],
    "wmv": ["-c:v", "wmv2", "-b:v", "2500k"] + EVEN + ["-c:a", "wmav2", "-b:a", "192k"],
}
# Which streams a container takes as they are.
VIDEO_COPY = {
    "mp4": ({"h264", "hevc", "mpeg4", "av1"}, {"aac", "mp3", "alac", "ac3", "opus"}),
    "m4v": ({"h264", "hevc", "mpeg4"}, {"aac", "mp3", "alac", "ac3"}),
    "mov": ({"h264", "hevc", "mpeg4", "prores", "mjpeg"}, {"aac", "mp3", "alac", "pcm_s16le", "pcm_s16be"}),
    "mkv": (None, None),  # Matroska holds nearly anything.
    "webm": ({"vp8", "vp9", "av1"}, {"opus", "vorbis"}),
}


def _ffprobe() -> Optional[str]:
    ff = ffmpeg_path()
    if not ff:
        return None
    probe = Path(ff).with_name(Path(ff).name.replace("ffmpeg", "ffprobe"))
    return str(probe) if probe.is_file() else shutil.which("ffprobe")


def _int(v: Any) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def probe(src: Path) -> Dict[str, Any]:
    tool = _ffprobe()
    if not tool:
        raise UniversalUnavailableError("Audio and video conversion isn't available on this server yet.")
    proc = run([tool, "-v", "error", *LOCAL_ONLY, "-show_format", "-show_streams", "-of", "json", str(src)], 60, what="Reading the file")
    try:
        info = json.loads(proc.stdout or b"{}")
    except ValueError:
        info = {}
    fmt = info.get("format") or {}
    if proc.returncode != 0 or not fmt:
        raise InvalidUniversalInputError("That file couldn't be read as audio or video. It may be damaged.")
    names = set(str(fmt.get("format_name", "")).split(","))
    if names & UNSAFE_DEMUXERS:
        raise InvalidUniversalInputError("Playlists and stream descriptions can't be converted. Upload the media file itself.")
    streams = info.get("streams") or []
    video = [s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    try:
        duration = float(fmt.get("duration") or 0)
    except ValueError:
        duration = 0.0
    return {
        "duration": duration,
        "video": video[0].get("codec_name") if video else None,
        "audio": audio[0].get("codec_name") if audio else None,
        "subtitle": any(s.get("codec_type") == "subtitle" for s in streams),
        # Used by the compressor and merge/split: picture size and bitrates (bits per second, 0 if unknown).
        "width": int(video[0].get("width") or 0) if video else 0,
        "height": int(video[0].get("height") or 0) if video else 0,
        "audio_bitrate": _int(audio[0].get("bit_rate")) if audio else 0,
        "bitrate": _int(fmt.get("bit_rate")),
    }


def _ffmpeg(args: List[str], what: str) -> None:
    ff = ffmpeg_path()
    if not ff:
        raise UniversalUnavailableError("Audio and video conversion isn't available on this server yet.")
    proc = run([ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], settings.MEDIA_TIMEOUT_SECONDS, what=what)
    if proc.returncode != 0:
        logger.error("ffmpeg failed: %s", tail(proc.stderr))
        raise UniversalConversionError(f"{what} failed. The file may be damaged or use a format FFmpeg can't decode.")


def _minutes(seconds: int) -> str:
    return f"{seconds // 60} minutes" if seconds >= 120 else f"{seconds} seconds"


def audio(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    info = probe(src)
    if not info["audio"]:
        raise InvalidUniversalInputError("This file has no sound to convert.")
    if info["duration"] > settings.AUDIO_MAX_SECONDS:
        raise InvalidUniversalInputError(f"Audio up to {_minutes(settings.AUDIO_MAX_SECONDS)} can be converted.")
    out = output(work, ctx, target)
    base = [*LOCAL_ONLY, "-i", str(src), "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "0"]
    args = list(AUDIO_ARGS[target])
    bitrate = ctx.options.get("bitrate")
    if bitrate and "-b:a" in args:
        args[args.index("-b:a") + 1] = f"{bitrate}k"
    elif bitrate and target == "ogg":
        args = ["-c:a", "libvorbis", "-b:a", f"{bitrate}k"]
    elif bitrate:
        bitrate = None  # Lossless formats have no bitrate to choose.
    if info["audio"] in AUDIO_COPY.get(target, set()) and not bitrate:
        try:
            _ffmpeg(base + ["-c:a", "copy"] + (["-f", "adts"] if target == "aac" else []) + [str(out)], "Copying the sound")
            return ensure(out)
        except UniversalConversionError:
            pass  # Some streams won't copy cleanly (odd timestamps); encode instead.
    _ffmpeg(base + args + [str(out)], "Converting the sound")
    return ensure(out)


def video(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    info = probe(src)
    if not info["video"]:
        raise InvalidUniversalInputError("This file has no picture: convert it to an audio format instead.")
    out = output(work, ctx, target)
    vcodecs, acodecs = VIDEO_COPY.get(target, (set(), set()))
    copy_ok = (vcodecs is None or info["video"] in vcodecs) and (acodecs is None or info["audio"] is None or info["audio"] in acodecs)
    base = [*LOCAL_ONLY, "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "0"]
    if copy_ok and target in VIDEO_COPY and src.suffix != ".gif":
        try:
            tag = ["-tag:v", "hvc1"] if info["video"] == "hevc" and target in ("mp4", "mov", "m4v") else []
            faststart = ["-movflags", "+faststart"] if target in ("mp4", "mov", "m4v") else []
            _ffmpeg(base + ["-c", "copy"] + tag + faststart + [str(out)], "Repackaging the video")
            ctx.notes.append("Repackaged without re-encoding: same quality, done in seconds.")
            return ensure(out)
        except UniversalConversionError:
            out.unlink(missing_ok=True)
    if info["duration"] > settings.VIDEO_MAX_SECONDS:
        raise InvalidUniversalInputError(
            f"Re-encoding works on videos up to {_minutes(settings.VIDEO_MAX_SECONDS)}. Try MKV, which usually needs no re-encoding."
        )
    _ffmpeg(base + VIDEO_ARGS[target] + [str(out)], "Converting the video")
    return ensure(out)


def gif(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    info = probe(src)
    if not info["video"]:
        raise InvalidUniversalInputError("This file has no picture to animate.")
    out = output(work, ctx, "gif")
    seconds = settings.GIF_MAX_SECONDS
    if info["duration"] > seconds:
        ctx.notes.append(f"GIFs get big fast, so the first {seconds} seconds were used.")
    graph = "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
    _ffmpeg([*LOCAL_ONLY, "-t", str(seconds), "-i", str(src), "-an", "-filter_complex", graph, "-loop", "0", str(out)], "Making the GIF")
    return ensure(out)


def frame(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    """One still from the video: a tenth of the way in (past black intro frames), at most 10 s in."""
    info = probe(src)
    if not info["video"]:
        raise InvalidUniversalInputError("This file has no picture to take a frame from.")
    at = min(10.0, info["duration"] * 0.1) if info["duration"] else 0
    png = work / "frame.png"
    work.mkdir(parents=True, exist_ok=True)
    # Seek after decoding, not before: fast input seeking skips every frame of short clips in
    # containers whose clock doesn't start at 0 (MPEG-TS, AVCHD). At most 10 s is decoded.
    _ffmpeg([*LOCAL_ONLY, "-i", str(src), "-ss", f"{at:.2f}", "-frames:v", "1", "-update", "1", str(png)], "Taking a frame")
    ensure(png)
    out = output(work, ctx, target)
    from PIL import Image

    with Image.open(png) as img:
        if target == "png":
            img.save(out, "PNG", optimize=True)
        elif target == "jpg":
            img.convert("RGB").save(out, "JPEG", quality=92, optimize=True)
        else:
            img.save(out, "WEBP", quality=90)
    ctx.notes.append(f"A still from {at:.1f} s into the video.")
    return ensure(out)


def subtitles(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    out = output(work, ctx, target)
    _ffmpeg([*LOCAL_ONLY, "-i", str(src), str(out)], "Converting the subtitles")
    return ensure(out)
