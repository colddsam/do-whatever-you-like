"""
Runs inside an isolated child process. FFmpeg may only open the local file (LOCAL_ONLY), and
playlist-style inputs are refused when probing (universal/engines/media.py).
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config.media import settings
from app.exceptions.media import InvalidMediaInputError, MediaProcessingError, MediaUnavailableError
from app.exceptions.universal import InvalidUniversalInputError, UniversalUnavailableError
from app.services.universal.engines.common import run, tail
from app.services.universal.engines.media import LOCAL_ONLY, probe
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
        # keyframe at or before `start` (usually within a second or two).
        _ffmpeg(["-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src), "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", *(["-movflags", "+faststart"] if ext in (".mp4", ".mov", ".m4v", ".m4a") else []), str(out)], "Cutting the file")
        if info["video"]:
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
