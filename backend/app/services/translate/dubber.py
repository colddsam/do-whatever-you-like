"""
Isolated subprocess pipeline for translating spoken audio and video files:
  source media → 16 kHz PCM → Whisper STT → batched text translation → neural TTS dubbing
  → sample-aligned 48 kHz voiceover mix → translated audio or video file.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

from app.exceptions.translate import InvalidTranslateInputError, TranslationError, TranslatorUnavailableError
from app.services import transcribe as stt
from app.services.media.worker import AAC, AUDIO_CODEC
from app.services.translate.languages import BY_CODE, language_name, normalize_code
from app.services.translate.providers import translate_batch_sync
from app.services.universal.engines.common import run as run_cmd, tail
from app.services.universal.engines.media import EVEN, H264, LOCAL_ONLY, VIDEO_COPY, ffmpeg_path, probe

logger = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
_GTTS_URL = "https://translate.google.com/translate_tts"

DUB_SR = 48000
BYTES_PER_SAMPLE = 2  # s16le mono
BYTES_PER_SECOND = DUB_SR * BYTES_PER_SAMPLE

AUDIO_OUT_KEEP = {".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".flac", ".aac", ".weba", ".aiff", ".aif"}
VIDEO_OUT_KEEP = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
AUDIO_EXT_SET = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma", ".amr", ".aiff", ".aif", ".weba"}

_SENTENCE_END = re.compile(r"[.!?।。？！…]+[\"')\]”’]*$")


def _ff() -> str:
    ff = ffmpeg_path()
    if not ff:
        raise TranslatorUnavailableError("FFmpeg isn't installed on this server yet.")
    return ff


def _clean_tts_text(text: str) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text or "")
    return re.sub(r"\s+", " ", cleaned).strip()


def coalesce_segments(raw_segments: List[Dict[str, Any]], max_dur: float = 14.0) -> List[Dict[str, Any]]:
    """
    Merges short continuous Whisper fragments into grammatical spoken clauses so both translation
    and TTS dubbing sound natural rather than choppy.
    """
    merged: List[Dict[str, Any]] = []
    for seg in raw_segments:
        txt = _clean_tts_text(str(seg.get("text") or ""))
        if not txt:
            continue
        start = float(seg.get("start") or 0.0)
        end = max(start + 0.15, float(seg.get("end") or start + 0.5))
        if merged:
            prev = merged[-1]
            gap = start - prev["end"]
            combined_dur = end - prev["start"]
            if (
                gap <= 0.45
                and combined_dur <= max_dur
                and len(prev["source"]) + len(txt) <= 220
                and not _SENTENCE_END.search(prev["source"])
            ):
                prev["end"] = max(prev["end"], end)
                prev["source"] = f"{prev['source']} {txt}".strip()
                continue
        merged.append({"id": len(merged), "start": round(start, 2), "end": round(end, 2), "source": txt})
    return merged


def _pick_edge_voice(target: str, gender: str) -> Optional[str]:
    meta = BY_CODE.get(target)
    if not meta:
        return None
    if gender == "male":
        return meta.male_voice or meta.female_voice or None
    return meta.female_voice or meta.male_voice or None


async def _edge_tts_to_file(text: str, voice: str, dest: Path) -> None:
    import edge_tts

    await edge_tts.Communicate(text, voice).save(str(dest))


def _synthesize_edge(text: str, target: str, gender: str, dest: Path) -> bool:
    voice = _pick_edge_voice(target, gender)
    if not voice:
        return False
    try:
        asyncio.run(_edge_tts_to_file(text, voice, dest))
        return dest.is_file() and dest.stat().st_size > 128
    except Exception as exc:
        logger.debug("edge-tts failed (%s, %s): %s", voice, target, exc)
        return False


def _split_tts_chunks(text: str, max_chars: int = 185) -> List[str]:
    if len(text) <= max_chars:
        return [text]
    chunks: List[str] = []
    cur = ""
    for word in text.split():
        if len(word) > max_chars:
            if cur:
                chunks.append(cur)
                cur = ""
            for i in range(0, len(word), max_chars):
                chunks.append(word[i : i + max_chars])
        elif not cur:
            cur = word
        elif len(cur) + 1 + len(word) <= max_chars:
            cur = f"{cur} {word}"
        else:
            chunks.append(cur)
            cur = word
    if cur:
        chunks.append(cur)
    return chunks or [text]


def _synthesize_gtts(text: str, target: str, dest: Path) -> bool:
    meta = BY_CODE.get(target)
    tl = meta.google_tts_code if meta else target
    if not tl:
        return False
    try:
        chunks = _split_tts_chunks(text)
        raw = bytearray()
        for chunk in chunks:
            resp = requests.get(
                _GTTS_URL,
                params={"ie": "UTF-8", "client": "tw-ob", "tl": tl, "q": chunk},
                headers={"User-Agent": _UA},
                timeout=15,
            )
            if resp.status_code != 200 or len(resp.content) < 128:
                return False
            raw.extend(resp.content)
        dest.write_bytes(bytes(raw))
        return dest.stat().st_size > 128
    except Exception as exc:
        logger.debug("Google TTS fallback failed (%s): %s", tl, exc)
        return False


def _synthesize_espeak(text: str, target: str, dest: Path) -> bool:
    espeak = shutil.which("espeak-ng") or shutil.which("espeak")
    if not espeak:
        return False
    meta = BY_CODE.get(target)
    voice = (meta.espeak_voice if meta else "") or target
    wav = dest.with_suffix(".wav")
    try:
        proc = subprocess.run(
            [espeak, "-v", voice, "-s", "165", "-w", str(wav), text],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if proc.returncode != 0 or not wav.is_file() or wav.stat().st_size < 128:
            return False
        shutil.move(str(wav), str(dest))
        return True
    except Exception as exc:
        logger.debug("espeak-ng fallback failed (%s): %s", voice, exc)
        return False


def synthesize_segment_pcm(
    text: str,
    target: str,
    gender: str,
    work: Path,
    index: int,
    slot_seconds: Optional[float] = None,
) -> Tuple[bytes, str]:
    """Synthesizes `text` into 48 kHz mono s16le PCM bytes and optionally fits `slot_seconds`."""
    cleaned = _clean_tts_text(text)
    if not cleaned:
        return b"", "edge-tts"

    raw_clip = work / f"tts_{index}.audio"
    engine_used = ""
    if _synthesize_edge(cleaned, target, gender, raw_clip):
        engine_used = "edge-tts"
    elif _synthesize_gtts(cleaned, target, raw_clip):
        engine_used = "google-tts"
    elif _synthesize_espeak(cleaned, target, raw_clip):
        engine_used = "espeak-ng"
    else:
        raise TranslationError("The text-to-speech voice engine couldn't be reached right now. Try again in a moment.")

    pcm_clip = work / f"tts_{index}.pcm"
    ff = _ff()
    proc = run_cmd(
        [ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *LOCAL_ONLY,
         "-i", str(raw_clip), "-vn", "-sn", "-dn", "-ac", "1", "-ar", str(DUB_SR), "-f", "s16le", str(pcm_clip)],
        timeout=60,
        what="Preparing translated voice",
    )
    raw_clip.unlink(missing_ok=True)
    if proc.returncode != 0 or not pcm_clip.is_file():
        logger.error("Failed decoding TTS clip: %s", tail(proc.stderr))
        raise TranslationError("We couldn't prepare one of the translated voice lines.")

    raw_bytes = pcm_clip.read_bytes()
    dur = len(raw_bytes) / BYTES_PER_SECOND

    # If synced timing requested and speech slightly overruns the gap before the next line, gently speed up (<= 1.45x).
    if slot_seconds is not None and slot_seconds >= 0.8 and dur > slot_seconds * 1.06:
        tempo = min(1.45, max(1.05, dur / slot_seconds))
        fast_pcm = work / f"tts_{index}_fast.pcm"
        proc2 = run_cmd(
            [ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *LOCAL_ONLY,
             "-f", "s16le", "-ar", str(DUB_SR), "-ac", "1", "-i", str(pcm_clip),
             "-af", f"atempo={tempo:.3f}", "-f", "s16le", str(fast_pcm)],
            timeout=60,
            what="Matching voice timing",
        )
        if proc2.returncode == 0 and fast_pcm.is_file() and fast_pcm.stat().st_size > 0:
            raw_bytes = fast_pcm.read_bytes()
        fast_pcm.unlink(missing_ok=True)

    pcm_clip.unlink(missing_ok=True)
    return raw_bytes, engine_used


def _stamp_srt(sec: float) -> str:
    ms = max(0, round(sec * 1000))
    h = ms // 3_600_000
    m = (ms % 3_600_000) // 60_000
    s = (ms % 60_000) // 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms % 1000:03d}"


def _stamp_vtt(sec: float) -> str:
    ms = max(0, round(sec * 1000))
    h = ms // 3_600_000
    m = (ms % 3_600_000) // 60_000
    s = (ms % 60_000) // 1000
    return f"{h:02d}:{m:02d}:{s:02d}.{ms % 1000:03d}"


def _write_subtitles(segments: List[Dict[str, Any]], dest: Path, vtt: bool = False) -> None:
    if vtt:
        lines = ["WEBVTT", ""]
        for s in segments:
            end = max(float(s["end"]), float(s["start"]) + 0.5)
            lines.append(f"{_stamp_vtt(float(s['start']))} --> {_stamp_vtt(end)}\n{s['translated']}\n")
        dest.write_text("\n".join(lines), encoding="utf-8")
        return
    lines = []
    for i, s in enumerate(segments, 1):
        end = max(float(s["end"]), float(s["start"]) + 0.5)
        lines.append(f"{i}\n{_stamp_srt(float(s['start']))} --> {_stamp_srt(end)}\n{s['translated']}\n")
    dest.write_text("\n".join(lines), encoding="utf-8")


def _assemble_dubbed_pcm(
    pairs: List[Dict[str, Any]],
    target: str,
    gender: str,
    timing: str,
    total_duration: float,
    work: Path,
    on_step: Callable[[int, int], None],
) -> Tuple[Path, str]:
    """Writes one sequential 48 kHz mono s16le file on disk with O(1) memory."""
    out_pcm = work / "dubbed.pcm"
    cursor_samples = 0
    tts_engine = "edge-tts"

    def write_silence(samples: int, fh) -> None:
        nonlocal cursor_samples
        if samples <= 0:
            return
        chunk_bytes = b"\x00" * (min(samples, DUB_SR) * BYTES_PER_SAMPLE)
        left = samples
        while left > 0:
            take = min(left, DUB_SR)
            fh.write(chunk_bytes[: take * BYTES_PER_SAMPLE])
            left -= take
        cursor_samples += samples

    with open(out_pcm, "wb") as out:
        for i, seg in enumerate(pairs):
            next_start = pairs[i + 1]["start"] if i + 1 < len(pairs) else None
            slot = None
            if timing == "timed":
                base = max(0.85, float(seg["end"]) - float(seg["start"]))
                extra = max(0.0, min(0.6, float(next_start) - float(seg["end"]) - 0.08)) if next_start is not None else 0.8
                slot = base + extra
            clip_bytes, eng = synthesize_segment_pcm(seg["translated"], target, gender, work, i, slot)
            tts_engine = eng or tts_engine
            on_step(i + 1, len(pairs))
            if not clip_bytes:
                continue

            if timing == "timed":
                min_gap = 0 if cursor_samples == 0 else int(0.06 * DUB_SR)
                desired_samples = int(float(seg["start"]) * DUB_SR)
                start_samples = max(cursor_samples + min_gap, desired_samples)
                write_silence(start_samples - cursor_samples, out)
                # Record actual playback window for the transcript sheet when timing shifts slightly.
                actual_start = round(cursor_samples / DUB_SR, 2)
                clip_dur = len(clip_bytes) / BYTES_PER_SECOND
                seg["dub_start"] = actual_start
                seg["dub_end"] = round(actual_start + clip_dur, 2)
            else:
                if cursor_samples > 0:
                    write_silence(int(0.28 * DUB_SR), out)
                actual_start = round(cursor_samples / DUB_SR, 2)
                clip_dur = len(clip_bytes) / BYTES_PER_SECOND
                seg["dub_start"] = actual_start
                seg["dub_end"] = round(actual_start + clip_dur, 2)

            out.write(clip_bytes)
            cursor_samples += len(clip_bytes) // BYTES_PER_SAMPLE

        # Pad tail cleanly up to the original recording length so video picture isn't cut short.
        target_end_samples = int(total_duration * DUB_SR)
        if timing == "timed" and target_end_samples > cursor_samples:
            write_silence(target_end_samples - cursor_samples, out)

    return out_pcm, tts_engine


def _mime_for(ext: str, is_video: bool) -> str:
    return {
        ".mp4": "video/mp4",
        ".m4v": "video/x-m4v",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".webm": "video/webm" if is_video else "audio/webm",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".opus": "audio/opus",
        ".flac": "audio/flac",
        ".aiff": "audio/aiff",
        ".aif": "audio/aiff",
    }.get(ext, "video/mp4" if is_video else "audio/mpeg")


def run_media_job(events, payload: Dict[str, Any]) -> None:
    """
    Spawned subprocess entry point. Receives `payload` with:
      source, stem, job_dir, result_path, source_lang, target_lang, voice_gender, timing,
      keep_background, include_subtitles, speech_engine, max_audio_seconds, max_video_seconds
    """
    stt._exit_with_parent()
    put = events.put
    try:
        source = Path(payload["source"])
        job_dir = Path(payload["job_dir"])
        work = job_dir / "work"
        work.mkdir(parents=True, exist_ok=True)
        src_lang = None if payload["source_lang"] == "auto" else payload["source_lang"]
        dst_lang = payload["target_lang"]
        gender = payload["voice_gender"]
        timing = payload["timing"]
        keep_bg = bool(payload["keep_background"])
        include_subs = bool(payload["include_subtitles"])
        speech_engine = payload["speech_engine"]

        put({"type": "status", "stage": "preparing"})
        info_probe = probe(source)
        has_video = bool(info_probe.get("video"))
        if not info_probe.get("audio"):
            raise InvalidTranslateInputError("That file has no audio track to translate.")
        media_kind = "video" if has_video else "audio"

        pcm = work / "speech_in.pcm"
        duration = stt._to_pcm(source, pcm, keep_source=True)
        max_sec = int(payload["max_video_seconds"] if has_video else payload["max_audio_seconds"])
        if duration > max_sec:
            mins = max_sec // 60
            raise InvalidTranslateInputError(
                f"That {media_kind} is over {mins} minutes. Keep {media_kind} translations up to {mins} minutes."
            )

        raw_segments: List[Dict[str, Any]] = []
        stt_info: Dict[str, Any] = {}

        def capture_stt(ev: Dict[str, Any]) -> None:
            kind = ev.get("type")
            if kind == "status":
                put(ev)
            elif kind == "info":
                stt_info.update(ev)
                put({
                    "type": "info",
                    "language": normalize_code(str(ev.get("language") or "en")),
                    "target": dst_lang,
                    "duration": round(duration, 2),
                    "media_kind": media_kind,
                    "speech_engine": ev.get("engine") or speech_engine,
                })
            elif kind == "segment":
                raw_segments.append(ev)
            elif kind == "progress":
                put({"type": "progress", "done": ev.get("done", 0), "total": round(duration, 2)})

        if speech_engine == "groq":
            stt._transcribe_groq(capture_stt, pcm, duration, src_lang, "", work)
        else:
            stt._transcribe_local(capture_stt, pcm, duration, src_lang, "")
        pcm.unlink(missing_ok=True)

        coalesced = coalesce_segments(raw_segments)
        if not coalesced:
            raise TranslationError("No spoken words were found in this file. Make sure there is audible speech and try again.")

        detected_code = normalize_code(str(stt_info.get("language") or payload["source_lang"] or "auto"))
        if detected_code == "auto":
            detected_code = "en"

        put({"type": "status", "stage": "translating"})
        translated_list, detected_after, provider = translate_batch_sync(
            [s["source"] for s in coalesced],
            source=detected_code,
            target=dst_lang,
        )
        if detected_after and detected_after != "auto":
            detected_code = detected_after

        pairs: List[Dict[str, Any]] = []
        for s, tr in zip(coalesced, translated_list):
            pair = {
                "id": s["id"],
                "start": s["start"],
                "end": s["end"],
                "source": s["source"],
                "translated": tr,
            }
            pairs.append(pair)
            put({"type": "segment", **pair})

        put({"type": "status", "stage": "synthesizing"})
        dub_pcm, tts_engine = _assemble_dubbed_pcm(
            pairs,
            dst_lang,
            gender,
            timing,
            duration,
            work,
            lambda done_n, tot_n: put({"type": "progress", "done": done_n, "total": tot_n}),
        )

        put({"type": "status", "stage": "muxing"})
        ff = _ff()
        src_ext = source.suffix.lower()

        if not has_video:
            out_ext = src_ext if src_ext in AUDIO_OUT_KEEP else ".mp3"
            if out_ext in (".wma", ".amr", ".weba") and src_ext not in AUDIO_OUT_KEEP:
                out_ext = ".mp3"
            out_path = Path(payload["result_path"]).with_suffix(out_ext)
            acodec = AUDIO_CODEC.get(out_ext, AAC)
            inputs = ["-f", "s16le", "-ar", str(DUB_SR), "-ac", "1", "-i", str(dub_pcm)]
            if keep_bg:
                inputs += [*LOCAL_ONLY, "-i", str(source)]
                flt = "[1:a]volume=0.14,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono[bg];[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono[fg];[bg][fg]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[outa]"
                args = [*inputs, "-filter_complex", flt, "-map", "[outa]", *acodec, str(out_path)]
            else:
                args = [*inputs, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", *acodec, str(out_path)]
            proc = run_cmd([ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], timeout=600, what="Creating translated audio")
            if proc.returncode != 0 or not out_path.is_file() or out_path.stat().st_size == 0:
                logger.error("Audio encode failed: %s", tail(proc.stderr))
                raise TranslationError("We couldn't build the translated audio file.")
        else:
            out_ext = src_ext if src_ext in VIDEO_OUT_KEEP else ".mp4"
            out_path = Path(payload["result_path"]).with_suffix(out_ext)
            container = out_ext.lstrip(".")
            allowed_v, _ = VIDEO_COPY.get(container, (None, None))
            can_copy_v = allowed_v is None or info_probe.get("vcodec") in allowed_v
            if not can_copy_v:
                out_ext = ".mp4"
                out_path = out_path.with_suffix(".mp4")
                container = "mp4"
            vcodec = ["-c:v", "copy"] if can_copy_v else (H264 + EVEN)
            acodec = ["-c:a", "libopus", "-b:a", "128k"] if out_ext == ".webm" else AAC

            inputs = [*LOCAL_ONLY, "-i", str(source), "-f", "s16le", "-ar", str(DUB_SR), "-ac", "1", "-i", str(dub_pcm)]
            if keep_bg:
                audio_filter = "[0:a]volume=0.14,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono[bg];[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono[fg];[bg][fg]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[outa]"
                a_map = "[outa]"
            else:
                audio_filter = "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[outa]"
                a_map = "[outa]"

            sub_args: List[str] = []
            if include_subs:
                is_vtt = out_ext == ".webm"
                sub_file = work / ("translated.vtt" if is_vtt else "translated.srt")
                _write_subtitles(pairs, sub_file, vtt=is_vtt)
                inputs += [*LOCAL_ONLY, "-i", str(sub_file)]
                sub_codec = "webvtt" if is_vtt else ("srt" if out_ext == ".mkv" else "mov_text")
                sub_args = ["-map", "2:s:0", "-c:s", sub_codec, f"-metadata:s:s:0", f"language={dst_lang[:3]}"]

            faststart = ["-movflags", "+faststart"] if out_ext in (".mp4", ".mov", ".m4v") else []
            args = [
                *inputs,
                "-filter_complex", audio_filter,
                "-map", "0:v:0",
                "-map", a_map,
                *vcodec,
                *acodec,
                f"-metadata:s:a:0", f"language={dst_lang[:3]}",
                *sub_args,
                *faststart,
                str(out_path),
            ]
            proc = run_cmd([ff, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], timeout=900, what="Building translated video")
            if proc.returncode != 0 or not out_path.is_file() or out_path.stat().st_size == 0:
                logger.error("Video mux failed: %s", tail(proc.stderr))
                raise TranslationError("We couldn't build the translated video file.")

        source_text = "\n\n".join(s["source"] for s in pairs)
        translated_text = "\n\n".join(s["translated"] for s in pairs)
        clean_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(payload["stem"]).stem).strip("-") or "translated"
        download_name = f"{clean_stem}-{dst_lang}{out_path.suffix}"
        put({
            "type": "_done_file",
            "result_file": str(out_path),
            "result_name": download_name,
            "result_type": _mime_for(out_path.suffix, has_video),
            "result_size": out_path.stat().st_size,
            "source_text": source_text,
            "translated_text": translated_text,
            "detected_language": detected_code,
            "detected_language_name": language_name(detected_code),
            "target_language": dst_lang,
            "target_language_name": language_name(dst_lang),
            "media_kind": media_kind,
            "duration": round(duration, 2),
            "segments": pairs,
            "provider": provider,
            "tts_engine": tts_engine,
        })
    except (InvalidTranslateInputError, TranslationError, TranslatorUnavailableError) as exc:
        put({"type": "error", "detail": exc.detail})
    except stt.InvalidAudioFileError as exc:
        put({"type": "error", "detail": exc.detail})
    except (stt.TranscriptionError, stt.TranscriberUnavailableError) as exc:
        put({"type": "error", "detail": exc.detail})
    except MemoryError:
        put({"type": "error", "detail": "The server ran out of memory for that file. Try a shorter clip."})
    except Exception as exc:
        logger.exception("Media translation failed: %s", exc)
        put({"type": "error", "detail": "We couldn't finish translating that file. Try a shorter recording."})
    finally:
        put({"type": "_end"})
        events.close()
        events.join_thread()
