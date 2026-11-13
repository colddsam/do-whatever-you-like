"""
Audio and video with FFmpeg.

Split cuts without re-encoding (stream copy): seconds per part even on a small server, at the cost
of video cuts landing on the nearest keyframe. Merge copies streams when every file shares the same
codecs and picture size (the usual case: clips from one phone or camera), and re-encodes otherwise.

Inputs are probed first and playlist-style formats refused (see universal/engines/media.py), and
FFmpeg may only open local files.
"""

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.config.merge_split import settings
from app.exceptions.merge_split import InvalidMergeSplitInputError, MergeSplitProcessingError, MergeSplitUnavailableError
from app.services.merge_split.common import ensure, limit_parts, unique
from app.services.universal.engines.common import run, tail
from app.services.universal.engines.media import LOCAL_ONLY, probe
from app.services.universal.graph import ffmpeg_path

logger = logging.getLogger(__name__)

AUDIO_OUT = {
    "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
    "m4a": ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
    "wav": ["-c:a", "pcm_s16le"],
    "flac": ["-c:a", "flac"],
    "ogg": ["-c:a", "libvorbis", "-q:a", "5"],
    "opus": ["-c:a", "libopus", "-b:a", "128k"],
}
VIDEO_OUT = {
    "mp4": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
    "mkv": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"],
}


def _ffmpeg(args: List[str], what: str) -> None:
    ff = ffmpeg_path()
    if not ff:
        raise MergeSplitUnavailableError("Audio and video tools aren't available on this server yet.")
    proc = run([ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], settings.TIMEOUT_SECONDS - 30, what=what)
    if proc.returncode != 0:
        logger.error("ffmpeg failed: %s", tail(proc.stderr))
        raise MergeSplitProcessingError(f"{what} failed. A file may be damaged or use a format FFmpeg can't read.")


def _probe(path: Path, family: str) -> Dict[str, Any]:
    info = probe(path)
    if family == "video" and not info["video"]:
        raise InvalidMergeSplitInputError(f"'{path.name}' has no picture. Use it with the audio files instead.")
    if family == "audio" and not info["audio"]:
        raise InvalidMergeSplitInputError(f"'{path.name}' has no sound.")
    if not info["duration"]:
        raise InvalidMergeSplitInputError(f"'{path.name}' has no length we can read.")
    return info


def inspect(path: Path, family: str) -> Dict[str, Any]:
    info = _probe(path, family)
    return {"family": family, "units": round(info["duration"], 2), "duration": round(info["duration"], 2)}


def _clock(text: str) -> float:
    """'90', '1:30', '01:02:03.5' → seconds."""
    text = text.strip()
    if not re.fullmatch(r"\d+(:\d{1,2}){0,2}(\.\d+)?", text):
        raise InvalidMergeSplitInputError(f"'{text}' isn't a time. Write times like 1:30 or 1:02:00.")
    secs = 0.0
    for piece in text.split(":"):
        secs = secs * 60 + float(piece)
    return secs


def _stamp(s: float) -> str:
    s = int(round(s))
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}h{m:02d}m{sec:02d}s" if h else f"{m}m{sec:02d}s"


def _cuts(plan: Dict[str, Any], duration: float) -> List[Tuple[float, float]]:
    how = plan.get("by", "every")
    if how == "every":
        step = float(plan.get("seconds") or 0)
        if step < 1:
            raise InvalidMergeSplitInputError("Say how long each part should be.")
        points = [i * step for i in range(1, int(duration // step) + 1) if i * step < duration - 0.5]
    elif how == "parts":
        n = int(plan.get("n") or 0)
        if n < 2:
            raise InvalidMergeSplitInputError("Split into at least 2 parts.")
        points = [duration * i / n for i in range(1, n)]
    elif how == "times":
        points = sorted({_clock(t) for t in str(plan.get("times") or "").split(",") if t.strip()})
        if not points:
            raise InvalidMergeSplitInputError("Type the times to cut at, like 1:30, 4:00.")
        bad = [p for p in points if not 0 < p < duration]
        if bad:
            raise InvalidMergeSplitInputError(f"{_stamp(bad[0])} is outside the file, which is {_stamp(duration)} long.")
    else:
        raise InvalidMergeSplitInputError("Pick how to split the file.")
    edges = [0.0] + points + [duration]
    spans = [(a, b) for a, b in zip(edges, edges[1:]) if b - a > 0.05]
    if len(spans) < 2:
        raise InvalidMergeSplitInputError(f"That leaves the whole file in one part. It is {_stamp(duration)} long.")
    return limit_parts(spans)


def split(path: Path, plan: Dict[str, Any], out_dir: Path, name: str, family: str) -> Tuple[List[Path], List[str]]:
    info = _probe(path, family)
    ext = path.suffix.lower()
    files = []
    for i, (a, b) in enumerate(_cuts(plan, info["duration"]), 1):
        out = unique(out_dir, f"{name}-{i:02d} ({_stamp(a)}-{_stamp(b)}){ext}")
        maps = ["-map", "0:v:0", "-map", "0:a?"] if family == "video" else ["-map", "0:a:0"]
        _ffmpeg([*LOCAL_ONLY, "-ss", f"{a:.3f}", "-i", str(path), "-t", f"{b - a:.3f}", *maps, "-sn", "-dn", "-c", "copy",
                 "-avoid_negative_ts", "make_zero", "-map_metadata", "0", str(out)], "Cutting the file")
        files.append(ensure(out, "A part"))
    notes = ["Cut without re-encoding, so quality is untouched."]
    if family == "video":
        notes.append("Video cuts land on the nearest keyframe, so a part may start up to a second or two early.")
    return files, notes


def merge(paths: List[Path], out: Path, options: Dict[str, Any], family: str, work: Path) -> Tuple[Path, List[str]]:
    infos = [_probe(p, family) for p in paths]
    total = sum(i["duration"] for i in infos)
    limit = settings.VIDEO_MAX_SECONDS if family == "video" else settings.AUDIO_MAX_SECONDS
    target = out.suffix.lstrip(".")
    if family == "video":
        first = infos[0]
        same = all((i["video"], i["width"], i["height"], i["audio"]) == (first["video"], first["width"], first["height"], first["audio"]) for i in infos)
        if same and all(p.suffix.lower() == paths[0].suffix.lower() for p in paths):
            try:
                return _concat_copy(paths, out, work), ["Joined without re-encoding: same quality, done in seconds."]
            except MergeSplitProcessingError:
                out.unlink(missing_ok=True)
        if total > limit:
            raise InvalidMergeSplitInputError(f"Videos that need re-encoding can be merged up to {int(limit // 60)} minutes in all.")
        _concat_encode_video(paths, infos, out, target)
        return ensure(out), ["The videos had different formats or sizes, so they were re-encoded to match the first one."]
    if total > limit:
        raise InvalidMergeSplitInputError(f"Audio can be merged up to {int(limit // 3600)} hours in all.")
    inputs = [a for p in paths for a in (*LOCAL_ONLY, "-i", str(p))]
    chain = "".join(f"[{i}:a:0]" for i in range(len(paths))) + f"concat=n={len(paths)}:v=0:a=1[a]"
    _ffmpeg([*inputs, "-filter_complex", chain, "-map", "[a]", *AUDIO_OUT[target], str(out)], "Joining the audio")
    return ensure(out), []


def _concat_copy(paths: List[Path], out: Path, work: Path) -> Path:
    # Our own list of our own (already probed) files: the concat demuxer only ever sees these paths.
    listing = work / "concat.txt"
    # The concat format quotes paths with ' and writes a ' inside one as '\''.
    quoted = (p.resolve().as_posix().replace("'", "'\\''") for p in paths)
    listing.write_text("".join(f"file '{q}'\n" for q in quoted), encoding="utf-8")
    faststart = ["-movflags", "+faststart"] if out.suffix in (".mp4", ".mov", ".m4v") else []
    _ffmpeg(["-f", "concat", "-safe", "0", "-protocol_whitelist", "file", "-i", str(listing), "-map", "0:v:0", "-map", "0:a?",
             "-c", "copy", *faststart, str(out)], "Joining the videos")
    return ensure(out)


def _concat_encode_video(paths: List[Path], infos: List[Dict[str, Any]], out: Path, target: str) -> None:
    """Every clip scaled and padded to the first one's size, with silence where a clip has no sound."""
    w = max(2, (infos[0]["width"] or 1280) // 2 * 2)
    h = max(2, (infos[0]["height"] or 720) // 2 * 2)
    inputs: List[str] = []
    for p in paths:
        inputs += [*LOCAL_ONLY, "-i", str(p)]
    graph, labels = [], []
    silent = len(paths)
    for i, info in enumerate(infos):
        graph.append(f"[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}]")
        if info["audio"]:
            graph.append(f"[{i}:a:0]aresample=48000,aformat=channel_layouts=stereo[a{i}]")
        else:
            inputs += ["-f", "lavfi", "-t", f"{info['duration']:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
            graph.append(f"[{silent}:a]anull[a{i}]")
            silent += 1
        labels.append(f"[v{i}][a{i}]")
    graph.append("".join(labels) + f"concat=n={len(paths)}:v=1:a=1[v][a]")
    _ffmpeg([*inputs, "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]", *VIDEO_OUT[target], str(out)], "Joining the videos")
