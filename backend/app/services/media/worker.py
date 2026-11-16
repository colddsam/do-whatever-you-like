"""
Runs inside an isolated child process. FFmpeg may only open the local file (LOCAL_ONLY), and
playlist-style inputs are refused when probing (universal/engines/media.py).
"""

import logging
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.config.media import settings
from app.exceptions.media import InvalidMediaInputError, MediaProcessingError, MediaUnavailableError
from app.exceptions.universal import InvalidUniversalInputError, UniversalUnavailableError
from app.services.universal.engines.common import run, tail
from app.services.universal.engines.media import AUDIO_ARGS, AUDIO_COPY, LOCAL_ONLY, VIDEO_ARGS, VIDEO_COPY, probe
from app.services.universal.graph import ffmpeg_path

logger = logging.getLogger(__name__)

# The codec each container's sound is re-encoded to when the volume changes (video is copied).
AUDIO_CODEC: Dict[str, List[str]] = {
    ".mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
    ".wav": ["-c:a", "pcm_s16le"],
    ".flac": ["-c:a", "flac"],
    ".ogg": ["-c:a", "libvorbis", "-q:a", "5"],
    ".oga": ["-c:a", "libvorbis", "-q:a", "5"],
    ".opus": ["-c:a", "libopus", "-b:a", "128k"],
    ".webm": ["-c:a", "libopus", "-b:a", "128k"],
    ".weba": ["-c:a", "libopus", "-b:a", "128k"],
    ".aiff": ["-c:a", "pcm_s16be"],
    ".aif": ["-c:a", "pcm_s16be"],
}
AAC = ["-c:a", "aac", "-b:a", "192k"]
# Containers that hold what we write back as they are; anything else comes back as MP4 / M4A.
KEEP = {".mp4", ".m4a", ".m4v", ".mov", ".mkv", ".webm", ".mp3", ".wav", ".flac", ".ogg", ".oga", ".opus", ".weba", ".aiff", ".aif", ".avi", ".mpg", ".mpeg", ".ts", ".3gp"}


def _info(src: Path) -> Dict[str, Any]:
    try:
        return probe(src)
    except InvalidUniversalInputError as exc:
        raise InvalidMediaInputError(exc.detail)
    except UniversalUnavailableError:
        raise MediaUnavailableError()


def _ffmpeg(args: List[str], what: str) -> None:
    ff = ffmpeg_path()
    if not ff:
        raise MediaUnavailableError()
    proc = run([ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *LOCAL_ONLY, *args], settings.TIMEOUT_SECONDS - 30, what=what)
    if proc.returncode != 0:
        logger.error("ffmpeg failed: %s", tail(proc.stderr))
        raise MediaProcessingError(f"{what} failed. The file may be damaged or use a format FFmpeg can't handle.")


def _out(work: Path, name: str, suffix: str, ext: str) -> Path:
    work.mkdir(parents=True, exist_ok=True)
    return work / f"{Path(name).stem[:120]}-{suffix}{ext}"


def _clock(s: float) -> str:
    return f"{int(s // 60)}:{s % 60:06.3f}"


def trim(p: Dict[str, Any]) -> Dict[str, Any]:
    src, name = Path(p["path"]), p["name"]
    info = _info(src)
    dur = info["duration"]
    start, end, exact = float(p["start"]), float(p["end"]), bool(p["exact"])
    if not dur:
        raise InvalidMediaInputError("That file has no length we can read.")
    if start >= dur:
        raise InvalidMediaInputError(f"The start is past the end of the file ({_clock(dur)}).")
    end = min(end, dur)
    ext = src.suffix.lower() if src.suffix.lower() in KEEP else (".mp4" if info["video"] else ".m4a")
    out = _out(Path(p["work"]), name, "trimmed", ext)
    notes = []
    if exact and info["video"]:
        if end - start > settings.EXACT_TRIM_MAX_SECONDS:
            raise InvalidMediaInputError(f"Exact cuts re-encode the video, so they're for parts up to {settings.EXACT_TRIM_MAX_SECONDS // 60} minutes. Use a fast cut for longer parts.")
        vcodec = ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-crf", "34", "-b:v", "0"] if ext == ".webm" else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
        acodec = AUDIO_CODEC.get(ext, AAC) if info["audio"] else ["-an"]
        _ffmpeg(["-ss", f"{start:.3f}", "-i", str(src), "-t", f"{end - start:.3f}", "-map", "0:v:0", "-map", "0:a?", *vcodec, *acodec, *(["-movflags", "+faststart"] if ext in (".mp4", ".mov", ".m4v") else []), str(out)], "Cutting the video")
        notes.append("Exact cut: the video was re-encoded from the first frame you picked.")
    else:
        # Stream copy: no quality loss and seconds even for long files. Video cuts start at the
        # keyframe at or before `start`; if sparse keyframes snap far backward, re-encode cleanly.
        span = end - start
        _ffmpeg(["-ss", f"{start:.3f}", "-i", str(src), "-t", f"{span:.3f}", "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", *(["-movflags", "+faststart"] if ext in (".mp4", ".mov", ".m4v", ".m4a") else []), str(out)], "Cutting the file")
        if info["video"] and start > 0 and out.is_file():
            copied_dur = float(probe(out).get("duration") or 0)
            if copied_dur > span + 0.6 and span <= settings.EXACT_TRIM_MAX_SECONDS:
                out.unlink(missing_ok=True)
                vcodec = ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-crf", "34", "-b:v", "0"] if ext == ".webm" else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
                acodec = AUDIO_CODEC.get(ext, AAC) if info["audio"] else ["-an"]
                _ffmpeg(["-ss", f"{start:.3f}", "-i", str(src), "-t", f"{span:.3f}", "-map", "0:v:0", "-map", "0:a?", *vcodec, *acodec, *(["-movflags", "+faststart"] if ext in (".mp4", ".mov", ".m4v") else []), str(out)], "Cutting the video")
                notes.append("Re-encoded automatically so the cut starts cleanly without repeating earlier footage (few keyframes in source).")
            else:
                notes.append("Fast cut (no re-encoding): it starts at the nearest keyframe, which can be up to a second early.")
        elif info["video"]:
            notes.append("Fast cut (no re-encoding): it starts at the nearest keyframe, which can be up to a couple of seconds early.")
    if not out.exists() or out.stat().st_size == 0:
        raise MediaProcessingError("The cut came out empty. Try a slightly longer part.")
    return {"path": str(out), "notes": notes, "start": start, "end": end, "duration": end - start}


def sound(p: Dict[str, Any]) -> Dict[str, Any]:
    src, name = Path(p["path"]), p["name"]
    info = _info(src)
    mode, gain = p["mode"], float(p["gain_db"])
    if not info["audio"]:
        raise InvalidMediaInputError("That file has no sound to change.")
    if mode == "mute" and not info["video"]:
        raise InvalidMediaInputError("Muting is for videos (an audio file would come out empty).")
    if mode != "mute":
        cap = settings.VIDEO_REENCODE_MAX_SECONDS if info["video"] else settings.AUDIO_MAX_SECONDS
        if info["duration"] > cap:
            raise InvalidMediaInputError(f"Changing the volume works on files up to {cap // 60} minutes.")
    ext = src.suffix.lower() if src.suffix.lower() in KEEP else (".mp4" if info["video"] else ".m4a")
    if ext == ".avi" or ext in (".mpg", ".mpeg", ".ts", ".3gp"):
        ext = ".mp4" if info["video"] else ".m4a"
    work = Path(p["work"])
    notes: List[str] = []
    if mode == "mute":
        out = _out(work, name, "muted", ext)
        _ffmpeg(["-i", str(src), "-map", "0:v", "-c", "copy", "-an", *(["-movflags", "+faststart"] if ext in (".mp4", ".mov", ".m4v") else []), str(out)], "Removing the sound")
        notes.append("The sound track was removed; the picture is untouched.")
    else:
        if mode == "volume":
            # A limiter keeps boosted peaks from clipping into distortion.
            filt = f"volume={gain:+.1f}dB" + (",alimiter=limit=0.95:level=disabled" if gain > 0 else "")
            notes.append(f"Volume {gain:+.1f} dB" + (", with a limiter so peaks don't distort." if gain > 0 else "."))
        else:
            # EBU R128 loudness (the level podcasts and streaming services use), single pass.
            filt = "loudnorm=I=-16:TP=-1.5:LRA=11"
            notes.append("Loudness normalised to -16 LUFS (true peak -1.5 dB), the level podcasts and streaming use.")
        out = _out(work, name, "louder" if mode == "volume" and gain > 0 else ("quieter" if mode == "volume" else "normalised"), ext)
        acodec = AUDIO_CODEC.get(ext, AAC)
        maps = ["-map", "0:v?", "-map", "0:a:0"]
        vcopy = ["-c:v", "copy"] if info["video"] else []
        rate = ["-ar", "48000"] if mode == "normalize" and ext not in (".mp3",) else (["-ar", "44100"] if mode == "normalize" else [])
        _ffmpeg(["-i", str(src), *maps, *vcopy, "-af", filt, *acodec, *rate, *(["-movflags", "+faststart"] if ext in (".mp4", ".mov", ".m4v", ".m4a") else []), str(out)], "Changing the sound")
    if not out.exists() or out.stat().st_size == 0:
        raise MediaProcessingError("The result came out empty.")
    return {"path": str(out), "notes": notes}


# ---------- Noise removal ----------

ANALYSE_RATE = 16000
ANALYSE_SECONDS = 20 * 60
# How hard afftdn pushes the learnt noise down (dB), per strength.
STRENGTH = {"light": 12, "medium": 24, "strong": 40}


def _analyse(src: Path, start: Optional[float], end: Optional[float]) -> Dict[str, Any]:
    """
    Reads the sound (mono, 16 kHz, first 20 min) to find what to learn the noise from: the span
    the person picked, or the quietest half second that isn't digital silence. Also checks that
    span for mains hum (50 or 60 Hz and its harmonics standing far above the neighbouring bins).
    """
    import numpy as np

    ff = ffmpeg_path()
    if not ff:
        raise MediaUnavailableError()
    proc = run([ff, "-nostdin", "-hide_banner", "-loglevel", "error", *LOCAL_ONLY, "-i", str(src), "-map", "0:a:0", "-t", str(ANALYSE_SECONDS), "-ac", "1", "-ar", str(ANALYSE_RATE), "-f", "s16le", "-"], settings.TIMEOUT_SECONDS // 3, what="Reading the sound")
    if proc.returncode != 0 or not proc.stdout:
        raise MediaProcessingError("The sound couldn't be read. The file may be damaged.")
    x = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    win = ANALYSE_RATE // 2
    if len(x) < win:
        raise InvalidMediaInputError("The sound is too short to clean (under half a second).")
    hop = ANALYSE_RATE // 20
    frames = np.sqrt(np.mean(x[: len(x) // hop * hop].reshape(-1, hop) ** 2, axis=1) + 1e-12)
    per = win // hop
    if start is not None and end is not None:
        a, b = int(start * ANALYSE_RATE), int(min(end, len(x) / ANALYSE_RATE) * ANALYSE_RATE)
        if b - a < ANALYSE_RATE // 5:
            raise InvalidMediaInputError("Pick a noise-only part at least 0.2 seconds long, inside the file.")
        s0, s1, picked = a / ANALYSE_RATE, b / ANALYSE_RATE, True
    else:
        energy = np.convolve(frames**2, np.ones(per) / per, mode="valid")
        # Digital silence (fades, padding) has no noise to learn from: skip it.
        energy = np.where(energy < 10 ** (-85 / 10), np.inf, energy)
        i = int(np.argmin(energy))
        if not np.isfinite(energy[i]):
            raise InvalidMediaInputError("The file is silent: there's nothing to clean.")
        s0, s1, picked = i * hop / ANALYSE_RATE, (i * hop + win) / ANALYSE_RATE, False
    seg = x[int(s0 * ANALYSE_RATE) : int(s1 * ANALYSE_RATE)]
    noise_db = float(20 * np.log10(np.sqrt(np.mean(seg**2)) + 1e-9))
    level_db = float(20 * np.log10(np.percentile(frames, 90) + 1e-9))

    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    hz = np.fft.rfftfreq(len(seg), 1 / ANALYSE_RATE)

    def prominence(f0: float) -> float:
        scores = []
        for k in (1, 2, 3):
            j = int(np.argmin(np.abs(hz - f0 * k)))
            peak = spec[max(0, j - 1) : j + 2].max()
            around = np.median(np.concatenate([spec[max(0, j - 12) : max(0, j - 3)], spec[j + 3 : j + 12]]))
            scores.append(20 * np.log10((peak + 1e-12) / (around + 1e-12)))
        return float(np.mean(sorted(scores)[1:]))  # the best two of three harmonics

    p50, p60 = prominence(50), prominence(60)
    hum = 50 if p50 >= 15 and p50 >= p60 else (60 if p60 >= 15 else None)
    return {"start": s0, "end": s1, "picked": picked, "noise_db": noise_db, "level_db": level_db, "hum": hum}


def denoise(p: Dict[str, Any]) -> Dict[str, Any]:
    src, name = Path(p["path"]), p["name"]
    info = _info(src)
    if not info["audio"]:
        raise InvalidMediaInputError("That file has no sound to clean.")
    cap = settings.VIDEO_REENCODE_MAX_SECONDS if info["video"] else settings.AUDIO_MAX_SECONDS
    if info["duration"] > cap:
        raise InvalidMediaInputError(f"Noise removal works on files up to {cap // 60} minutes. Trim it first.")
    a = _analyse(src, p.get("noise_start"), p.get("noise_end"))
    notes: List[str] = []

    filters: List[str] = []
    if p["voice"]:
        filters.append("highpass=f=70")
    hum = {"auto": a["hum"], "off": None, "50": 50, "60": 60}[p["hum"]]
    if hum:
        # Narrow notches on the mains frequency and its first harmonics (hum is tonal; afftdn alone
        # barely touches it).
        filters += [f"bandreject=f={hum * k}:width_type=h:w={3 + k}" for k in (1, 2, 3, 4)]
        notes.append(f"Removed {hum} Hz mains hum{' (found automatically)' if p['hum'] == 'auto' else ''}.")
    # Teach the denoiser the noise from the chosen span, with its noise floor set to that level.
    nf = max(-80.0, min(-20.0, a["noise_db"]))
    nr = STRENGTH[p["strength"]]
    t0, t1 = a["start"], max(a["end"], a["start"] + 0.2)
    filters.append(f"asendcmd=c='{t0:.3f} afftdn@dn sn start; {t1:.3f} afftdn@dn sn stop'")
    filters.append(f"afftdn@dn=nr={nr}:nf={nf:.1f}")
    if p["strength"] == "strong":
        filters.append(f"afftdn=nr=10:nf={max(-80.0, nf - 12):.1f}")
    if p["voice"]:
        filters.append("lowpass=f=12000")
    if p["clicks"]:
        filters.append("adeclick")
        notes.append("Clicks and pops smoothed out.")
    notes.insert(0, f"Learnt the noise from {_clock(t0)}–{_clock(t1)} ({'the part you picked' if a['picked'] else 'the quietest moment'}), at {nf:.0f} dB, and reduced it by up to {nr} dB.")
    if a["level_db"] - a["noise_db"] < 6:
        notes.append("The noise is almost as loud as the sound itself, so it can only be reduced so far without harming the voice. Picking a noise-only part can help.")

    ext = src.suffix.lower() if src.suffix.lower() in KEEP else (".mp4" if info["video"] else ".m4a")
    if ext in (".avi", ".mpg", ".mpeg", ".ts", ".3gp"):
        ext = ".mp4" if info["video"] else ".m4a"
    out = _out(Path(p["work"]), name, "clean", ext)
    _ffmpeg(
        ["-i", str(src), "-map", "0:v?", "-map", "0:a:0", *(["-c:v", "copy"] if info["video"] else []), "-af", ",".join(filters), *AUDIO_CODEC.get(ext, AAC),
         *(["-movflags", "+faststart"] if ext in (".mp4", ".mov", ".m4v", ".m4a") else []), str(out)],
        "Removing the noise",
    )
    if not out.exists() or out.stat().st_size == 0:
        raise MediaProcessingError("The result came out empty.")
    return {"path": str(out), "notes": notes, "noise_db": round(nf, 1), "hum": hum, "sample": [round(t0, 2), round(t1, 2)]}


# ---------- Multi-part cutter & desired-format export ----------

VIDEO_FMTS = {"mp4", "mov", "mkv", "webm"}
AUDIO_FMTS = {"mp3", "m4a", "wav", "flac", "ogg", "opus"}


def _file_clock(s: float) -> str:
    total = int(round(s))
    h, m, sec = total // 3600, (total % 3600) // 60, total % 60
    return f"{h:02d}h{m:02d}m{sec:02d}s" if h else f"{m:02d}m{sec:02d}s"


def _safe_label(raw: Optional[str]) -> str:
    if not raw:
        return ""
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "", str(raw)).strip(" ._-")
    return re.sub(r"\s+", "-", cleaned)[:40]


def _resolve_target_format(requested: str, src: Path, info: Dict[str, Any]) -> Tuple[str, bool]:
    """Returns (extension_without_dot, is_audio_only_output)."""
    has_video = bool(info["video"])
    has_audio = bool(info["audio"])
    if requested == "original":
        src_ext = src.suffix.lower().lstrip(".")
        if f".{src_ext}" in KEEP:
            if has_video:
                return src_ext, False
            return (src_ext if src_ext in AUDIO_FMTS or src_ext in ("oga", "weba", "aiff", "aif") else "m4a"), True
        return ("mp4", False) if has_video else ("m4a", True)

    if requested == "gif":
        if not has_video:
            raise InvalidMediaInputError("GIF output needs a video file.")
        return "gif", False

    if requested in VIDEO_FMTS:
        if not has_video:
            raise InvalidMediaInputError("That file has no picture. Pick an audio format such as MP3, WAV or M4A.")
        return requested, False

    if requested in AUDIO_FMTS:
        if not has_audio:
            raise InvalidMediaInputError("This file has no sound track to save as audio.")
        return requested, True

    raise InvalidMediaInputError(f"Unsupported output format '{requested}'.")


def _cut_audio_clip(src: Path, dest: Path, start: float, span: float, target: str, info: Dict[str, Any], exact: bool) -> bool:
    """Cuts one audio clip (or extracts audio from video). Returns True if re-encoded."""
    base = ["-ss", f"{start:.3f}", "-i", str(src), "-t", f"{span:.3f}", "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "0"]
    can_copy = not exact and info["audio"] in AUDIO_COPY.get(target, set())
    if can_copy:
        try:
            _ffmpeg(
                base + ["-c:a", "copy", *(["-movflags", "+faststart"] if target == "m4a" else []), str(dest)],
                "Cutting audio clip",
            )
            return False
        except MediaProcessingError:
            dest.unlink(missing_ok=True)
    args = AUDIO_ARGS.get(target) or AUDIO_CODEC.get(f".{target}", AAC)
    _ffmpeg(base + args + [str(dest)], "Cutting and converting audio")
    return True


def _cut_video_clip(
    src: Path, dest: Path, start: float, span: float, target: str, info: Dict[str, Any], exact: bool, *, fast_copy_only: bool = False
) -> bool:
    """Cuts one video clip into `target`. Returns True if re-encoded."""
    if target == "gif":
        graph = "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
        _ffmpeg(
            ["-ss", f"{start:.3f}", "-i", str(src), "-t", f"{span:.3f}", "-an", "-filter_complex", graph, "-loop", "0", str(dest)],
            "Creating GIF clip",
        )
        return True

    vcodecs, acodecs = VIDEO_COPY.get(target, (set(), set()))
    copy_ok = (not exact) and (target in VIDEO_COPY or fast_copy_only) and (vcodecs is None or info["video"] in vcodecs) and (
        acodecs is None or info["audio"] is None or info["audio"] in acodecs
    )
    faststart = ["-movflags", "+faststart"] if target in ("mp4", "mov", "m4v") else []
    base = ["-ss", f"{start:.3f}", "-i", str(src), "-t", f"{span:.3f}", "-map", "0:v:0", "-map", "0:a?", "-sn", "-dn", "-map_metadata", "0"]
    if copy_ok:
        try:
            _ffmpeg(base + ["-c", "copy", "-avoid_negative_ts", "make_zero", *faststart, str(dest)], "Cutting video clip")
            copied_dur = float((probe(dest).get("duration") or 0)) if dest.is_file() else 0.0
            # If stream copy jumped back to an earlier keyframe (e.g. t=0, producing 0-4 / 0-6 / 0-8),
            # re-encode this clip cleanly when within server budget so separated parts never repeat prior footage.
            if not (start > 0 and copied_dur > span + 0.55 and span <= settings.EXACT_TRIM_MAX_SECONDS):
                return False
            dest.unlink(missing_ok=True)
        except MediaProcessingError:
            dest.unlink(missing_ok=True)

    args = VIDEO_ARGS.get(target)
    if not args:
        vcodec = ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-crf", "34", "-b:v", "0", "-pix_fmt", "yuv420p"] if target == "webm" else [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"
        ]
        acodec = AUDIO_CODEC.get(f".{target}", AAC) if info["audio"] else ["-an"]
        args = [*vcodec, *acodec, *faststart]
    elif not info["audio"]:
        args = ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-crf", "34", "-b:v", "0", "-pix_fmt", "yuv420p", "-an"] if target == "webm" else [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-an", *faststart
        ]
    _ffmpeg(base + args + [str(dest)], "Cutting and encoding video")
    return True


def _concat_files_demuxer(parts: List[Path], out: Path, work: Path, is_audio: bool, target: str) -> None:
    if is_audio:
        inputs = [arg for part in parts for arg in (*LOCAL_ONLY, "-i", str(part))]
        chain = "".join(f"[{i}:a:0]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[a]"
        args = AUDIO_ARGS.get(target) or AUDIO_CODEC.get(f".{target}", AAC)
        _ffmpeg([*inputs, "-filter_complex", chain, "-map", "[a]", *args, str(out)], "Joining audio clips")
        return

    listing = work / "concat.txt"
    quoted = (part.resolve().as_posix().replace("'", "'\\''") for part in parts)
    listing.write_text("".join(f"file '{q}'\n" for q in quoted), encoding="utf-8")
    faststart = ["-movflags", "+faststart"] if target in ("mp4", "mov", "m4v") else []
    _ffmpeg(
        ["-f", "concat", "-safe", "0", "-protocol_whitelist", "file", "-i", str(listing), "-map", "0:v:0", "-map", "0:a?", "-c", "copy", *faststart, str(out)],
        "Joining video clips",
    )


def cut_parts(p: Dict[str, Any]) -> Dict[str, Any]:
    src, name = Path(p["path"]), p["name"]
    plan = p["plan"]
    info = _info(src)
    dur = float(info["duration"] or 0)
    if dur <= 0:
        raise InvalidMediaInputError("That file has no length we can read.")

    raw_segments = plan.get("segments") or []
    spans: List[Tuple[float, float, str]] = []
    for item in raw_segments:
        a = max(0.0, float(item["start"]))
        b = min(dur, float(item["end"]))
        if a >= dur:
            raise InvalidMediaInputError(f"A segment starts past the end of the file ({_clock(dur)}).")
        if b - a < 0.05:
            raise InvalidMediaInputError("Every kept segment must be at least 0.05 seconds long.")
        spans.append((a, b, _safe_label(item.get("label"))))

    combine = plan.get("combine", "parts")
    requested_fmt = plan.get("output_format", "original")
    exact = bool(plan.get("exact", False))
    target, audio_only = _resolve_target_format(requested_fmt, src, info)
    work = Path(p["work"])
    out_dir = work / "out"
    seg_dir = work / "seg"
    out_dir.mkdir(parents=True, exist_ok=True)
    seg_dir.mkdir(parents=True, exist_ok=True)

    total_span = sum(b - a for a, b, _ in spans)
    if target == "gif" and total_span > 30.0:
        raise InvalidMediaInputError("GIF export handles up to 30 seconds of kept video total.")

    vcodecs, acodecs = VIDEO_COPY.get(target, (set(), set()))
    needs_video_reencode = (
        not audio_only
        and target != "gif"
        and (
            exact
            or (requested_fmt != "original" and (target not in VIDEO_COPY or (vcodecs is not None and info["video"] not in vcodecs) or (acodecs is not None and info["audio"] is not None and info["audio"] not in acodecs)))
        )
    )
    if needs_video_reencode and total_span > settings.EXACT_TRIM_MAX_SECONDS:
        raise InvalidMediaInputError(
            f"Re-encoding cuts work on up to {settings.EXACT_TRIM_MAX_SECONDS // 60} minutes of kept video. Switch to Fast copy or trim fewer seconds."
        )
    if combine == "join" and target == "gif" and len(spans) > 1:
        raise InvalidMediaInputError("Export GIF clips as separate parts, or join in MP4 / WebM.")

    stem_name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", Path(name).stem)[:100].strip(" .") or "clip"
    rendered: List[Path] = []
    parts_meta: List[Dict[str, Any]] = []
    reencoded_any = False
    target_dir = seg_dir if (combine == "join" and len(spans) > 1) else out_dir

    for idx, (a, b, label) in enumerate(spans, start=1):
        tag = f"-{label}" if label else ""
        part_name = f"{stem_name}-{idx:02d}{tag} ({_file_clock(a)}-{_file_clock(b)}).{target}"
        dest = target_dir / part_name
        span = b - a
        if audio_only:
            reenc = _cut_audio_clip(src, dest, a, span, target, info, exact)
        else:
            reenc = _cut_video_clip(
                src,
                dest,
                a,
                span,
                target,
                info,
                exact,
                fast_copy_only=(requested_fmt == "original" and not exact),
            )
        reencoded_any = reencoded_any or reenc
        if not dest.is_file() or dest.stat().st_size == 0:
            raise MediaProcessingError(f"Part {idx} came out empty. Try adjusting its timestamps.")
        rendered.append(dest)
        parts_meta.append({"index": idx, "name": part_name, "start": round(a, 3), "end": round(b, 3), "duration": round(span, 3)})

    notes: List[str] = []
    if combine == "join" and len(rendered) > 1:
        joined = out_dir / f"{stem_name}-edited.{target}"
        _concat_files_demuxer(rendered, joined, work, audio_only, target)
        if not joined.is_file() or joined.stat().st_size == 0:
            raise MediaProcessingError("Joining the cut parts produced an empty file.")
        notes.append(f"Joined {len(rendered)} kept parts into one {target.upper()} file.")
        if not reencoded_any:
            notes.append("Fast stream copy kept original quality without re-encoding.")
        return {"path": str(joined), "notes": notes, "count": 1, "format": target, "parts": parts_meta}

    if len(rendered) == 1:
        if audio_only and info["video"]:
            notes.append(f"Extracted audio clip in {target.upper()} format.")
        elif reencoded_any and info["video"] and not exact and target != "webm":
            notes.append("Applied a frame-exact cut automatically so the clip stays cleanly separated.")
        elif not reencoded_any and info["video"]:
            notes.append("Fast stream copy: original video quality, cuts snap to the nearest keyframe.")
        elif reencoded_any:
            notes.append(f"Frame-exact clip encoded cleanly as {target.upper()}.")
        return {"path": str(rendered[0]), "notes": notes, "count": 1, "format": target, "parts": parts_meta}

    zip_path = work / f"{stem_name}-parts.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in rendered:
            zf.write(file_path, arcname=file_path.name)
    notes.append(f"Cut into {len(rendered)} {target.upper()} parts inside one ZIP.")
    if reencoded_any and info["video"] and not exact and target != "webm":
        notes.append("Applied frame-exact cuts automatically where needed so every part stays cleanly separated.")
    elif not reencoded_any and info["video"]:
        notes.append("Fast stream copy kept original quality with near-instant speed.")
    return {"path": str(zip_path), "notes": notes, "count": len(rendered), "format": target, "parts": parts_meta}
