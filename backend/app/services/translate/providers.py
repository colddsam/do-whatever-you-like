"""
Resilient free-tier translation chain across multiple public/optional backends:
1. Optional Groq free-tier LLM (only when TRANSLATE_GROQ_API_KEY is explicitly configured)
2. Optional LibreTranslate endpoint (only when TRANSLATE_LIBRETRANSLATE_URL is configured)
3. Google Translate web batchexecute RPC (keyless, fast, 100+ languages, auto-detect)
4. Mozhi public aggregator (keyless fallback)
5. MyMemory public REST API (free official fallback, automatically chunked under 450 bytes)
"""

from __future__ import annotations

import html
import json
import logging
import re
from typing import Callable, List, Optional, Tuple

import requests

from app.config.translate import settings
from app.exceptions.translate import InvalidTranslateInputError, TranslationError
from app.services.translate.languages import BY_CODE, detect_script_hint, language_name, normalize_code

logger = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
_GOOGLE_WEB_URL = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute"
_MOZHI_URL = "https://mozhi.aryak.me/api/translate"
_MYMEMORY_URL = "https://api.mymemory.translated.net/get"
_GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

_TIMESTAMP_LINE_RE = re.compile(r"^\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?.*$")


def validate_pair(source: str, target: str) -> Tuple[str, str]:
    src = normalize_code(source)
    dst = normalize_code(target)
    if src != "auto" and src not in BY_CODE:
        raise InvalidTranslateInputError("Pick a supported source language, or use Auto-detect.")
    if dst == "auto" or dst not in BY_CODE:
        raise InvalidTranslateInputError("Pick a supported target language.")
    return src, dst


def _google_code(code: str) -> str:
    if code == "auto":
        return "auto"
    meta = BY_CODE.get(code)
    return meta.google_translate_code if meta else code


def _mymemory_code(code: str) -> str:
    if code == "auto":
        return "Autodetect"
    if code == "zh":
        return "zh-CN"
    if code == "zh-tw":
        return "zh-TW"
    return BY_CODE[code].google_translate_code if code in BY_CODE else code


def _split_chars(text: str, max_chars: int) -> List[str]:
    """Splits long text cleanly at paragraphs, then sentences, then spaces."""
    if len(text) <= max_chars:
        return [text]
    chunks: List[str] = []
    cur = ""
    for para in text.split("\n"):
        piece = para if not cur else f"\n{para}"
        if len(cur) + len(piece) <= max_chars:
            cur += piece
            continue
        if cur:
            chunks.append(cur)
            cur = ""
        if len(para) <= max_chars:
            cur = para
            continue
        # Oversized single line: break by sentence punctuation or whitespace.
        for tok in re.split(r"(?<=[.!?।。？！\s])\s*", para):
            if not tok:
                continue
            if len(tok) > max_chars:
                if cur:
                    chunks.append(cur)
                    cur = ""
                for i in range(0, len(tok), max_chars):
                    chunks.append(tok[i : i + max_chars])
            elif len(cur) + len(tok) + 1 <= max_chars:
                cur = f"{cur} {tok}".strip() if cur else tok
            else:
                if cur:
                    chunks.append(cur)
                cur = tok
    if cur:
        chunks.append(cur)
    return chunks or [text]


def _split_bytes(text: str, max_bytes: int) -> List[str]:
    """Splits text so every chunk fits within MyMemory's 500-byte query ceiling."""
    if len(text.encode("utf-8")) <= max_bytes:
        return [text]
    chunks: List[str] = []
    cur = ""
    for part in re.split(r"(\s+)", text):
        cand = cur + part
        if len(cand.encode("utf-8")) <= max_bytes:
            cur = cand
            continue
        if cur.strip():
            chunks.append(cur)
            cur = part.lstrip()
        else:
            cur = ""
        # Hard split extremely long unbroken token safely at rune boundaries.
        while len(cur.encode("utf-8")) > max_bytes:
            cut = max(1, len(cur) // 2)
            while len(cur[:cut].encode("utf-8")) > max_bytes:
                cut -= 1
            chunks.append(cur[:cut])
            cur = cur[cut:]
    if cur:
        chunks.append(cur)
    return chunks or [text]


def _call_google_web(text: str, src: str, dst: str) -> Tuple[str, str]:
    g_src = _google_code(src)
    g_dst = _google_code(dst)
    payload = [[["MkEWBc", json.dumps([[text, g_src, g_dst, True], [None]]), None, "generic"]]]
    resp = requests.post(
        _GOOGLE_WEB_URL,
        headers={"User-Agent": _UA, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"},
        data={"f.req": json.dumps(payload)},
        timeout=settings.REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    inner = None
    for line in resp.text.splitlines():
        if line.startswith("[["):
            outer = json.loads(line)
            if outer and isinstance(outer[0], list) and len(outer[0]) > 2 and outer[0][2]:
                inner = json.loads(outer[0][2])
                break
    if not inner:
        raise ValueError("Missing translation payload")
    detected = normalize_code((inner[0][2] if inner[0] and len(inner[0]) > 2 else None) or inner[2] or src)
    segs = inner[1][0][0][5]
    parts: List[str] = []
    for seg in segs:
        piece = seg[0] or ""
        if not piece:
            continue
        needs_space = len(seg) > 2 and bool(seg[2])
        if parts and needs_space and not parts[-1].endswith((" ", "\n", "\t")) and not piece.startswith((" ", "\n", "\t")):
            parts.append(" ")
        parts.append(piece)
    out = "".join(parts)
    if not out and text.strip():
        raise ValueError("Empty translation returned")
    return out, (src if src != "auto" else detected)


def _call_mozhi(text: str, src: str, dst: str) -> Tuple[str, str]:
    resp = requests.get(
        _MOZHI_URL,
        params={"engine": "google", "from": _google_code(src), "to": _google_code(dst), "text": text},
        headers={"User-Agent": _UA},
        timeout=settings.REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    out = str(data.get("translated-text") or "")
    if not out and text.strip():
        raise ValueError("Empty translation from Mozhi")
    detected = normalize_code(data.get("detected") or src)
    return out, (src if src != "auto" else detected)


def _call_mymemory(text: str, src: str, dst: str) -> Tuple[str, str]:
    effective_src = src
    if effective_src == "auto":
        effective_src = detect_script_hint(text) or "auto"
    langpair = f"{_mymemory_code(effective_src)}|{_mymemory_code(dst)}"
    pieces: List[str] = []
    detected = effective_src
    for sub in _split_bytes(text, 430):
        if not sub.strip():
            pieces.append(sub)
            continue
        params = {"q": sub, "langpair": langpair}
        if settings.MYMEMORY_EMAIL:
            params["de"] = settings.MYMEMORY_EMAIL
        resp = requests.get(_MYMEMORY_URL, params=params, headers={"User-Agent": _UA}, timeout=settings.REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if data.get("quotaFinished"):
            raise ValueError("MyMemory daily free quota exhausted")
        raw = str((data.get("responseData") or {}).get("translatedText") or "")
        if not raw or "QUERY LENGTH LIMIT" in raw.upper() or "INVALID LANGUAGE PAIR" in raw.upper():
            raise ValueError(f"MyMemory returned error: {raw[:120]}")
        det = (data.get("responseData") or {}).get("detectedLanguage")
        if det and src == "auto":
            detected = normalize_code(str(det))
        pieces.append(html.unescape(raw))
    return "".join(pieces), detected


def _call_libretranslate(text: str, src: str, dst: str) -> Tuple[str, str]:
    url = settings.LIBRETRANSLATE_URL.strip().rstrip("/")
    if not url:
        raise ValueError("LibreTranslate URL unset")
    payload = {"q": text, "source": src, "target": dst, "format": "text"}
    if settings.LIBRETRANSLATE_API_KEY:
        payload["api_key"] = settings.LIBRETRANSLATE_API_KEY
    resp = requests.post(f"{url}/translate", json=payload, headers={"User-Agent": _UA}, timeout=settings.REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    out = str(data.get("translatedText") or "")
    if not out and text.strip():
        raise ValueError("Empty LibreTranslate output")
    det = ((data.get("detectedLanguage") or {}).get("language")) if isinstance(data.get("detectedLanguage"), dict) else None
    return out, normalize_code(det or src)


def _call_groq(text: str, src: str, dst: str) -> Tuple[str, str]:
    key = settings.GROQ_API_KEY.strip()
    if not key:
        raise ValueError("Groq translation key unset")
    src_label = "the detected source language" if src == "auto" else language_name(src)
    dst_label = language_name(dst)
    resp = requests.post(
        _GROQ_CHAT_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": settings.GROQ_MODEL,
            "temperature": 0,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"Translate from {src_label} into natural {dst_label}. "
                        "Preserve line breaks and punctuation. Reply with ONLY the translation and no commentary."
                    ),
                },
                {"role": "user", "content": text},
            ],
        },
        timeout=settings.REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    out = str(data["choices"][0]["message"]["content"]).strip()
    if not out and text.strip():
        raise ValueError("Empty Groq output")
    return out, (src if src != "auto" else (detect_script_hint(text) or "auto"))


def _providers() -> List[Tuple[str, Callable[[str, str, str], Tuple[str, str]]]]:
    chain: List[Tuple[str, Callable[[str, str, str], Tuple[str, str]]]] = []
    if settings.GROQ_API_KEY.strip():
        chain.append(("groq", _call_groq))
    if settings.LIBRETRANSLATE_URL.strip():
        chain.append(("libretranslate", _call_libretranslate))
    chain.extend([
        ("google_web", _call_google_web),
        ("mozhi", _call_mozhi),
        ("mymemory", _call_mymemory),
    ])
    return chain


def _translate_chunk(text: str, src: str, dst: str) -> Tuple[str, str, str]:
    last_err: Optional[Exception] = None
    for name, fn in _providers():
        try:
            out, detected = fn(text, src, dst)
            if out or not text.strip():
                return out, detected, name
        except Exception as exc:
            last_err = exc
            logger.debug("Provider %s failed for chunk (%s -> %s): %s", name, src, dst, exc)
    logger.warning("All translation providers failed (%s -> %s): %s", src, dst, last_err)
    raise TranslationError("The translation service couldn't be reached right now. Try again in a moment.")


def translate_text_sync(text: str, source: str = "auto", target: str = "hi") -> Tuple[str, str, str]:
    """Returns (translated_text, detected_source_code, provider_name)."""
    src, dst = validate_pair(source, target)
    if not text.strip():
        return text, (src if src != "auto" else "en"), "direct"
    if src != "auto" and src == dst:
        return text, src, "direct"

    parts: List[str] = []
    detected = src
    provider = "google_web"
    for chunk in _split_chars(text, 3200):
        if not chunk.strip():
            parts.append(chunk)
            continue
        out, det, prov = _translate_chunk(chunk, src, dst)
        parts.append(out)
        provider = prov
        if src == "auto" and det and det != "auto":
            detected = det
    if detected == "auto":
        detected = detect_script_hint(text) or "en"
    return "".join(parts), detected, provider


def translate_batch_sync(lines: List[str], source: str = "auto", target: str = "hi") -> Tuple[List[str], str, str]:
    """
    Translates an ordered list of strings 1:1 with automatic structural verification.
    Falls back cleanly via binary bisection if a provider merges lines across a newline.
    """
    src, dst = validate_pair(source, target)
    clean_lines = [re.sub(r"[\r\n]+", " ", ln).strip() for ln in lines]
    if not clean_lines:
        return [], (src if src != "auto" else "en"), "direct"
    if src != "auto" and src == dst:
        return list(clean_lines), src, "direct"

    non_empty_idx = [i for i, ln in enumerate(clean_lines) if ln]
    if not non_empty_idx:
        return list(clean_lines), (src if src != "auto" else "en"), "direct"

    out = list(clean_lines)
    detected_global = src
    provider_used = "google_web"

    def translate_slice(indices: List[int]) -> None:
        nonlocal detected_global, provider_used
        if not indices:
            return
        if len(indices) == 1:
            idx = indices[0]
            txt, det, prov = translate_text_sync(clean_lines[idx], detected_global if detected_global != "auto" else src, dst)
            out[idx] = re.sub(r"[\r\n]+", " ", txt).strip()
            provider_used = prov
            if detected_global == "auto" and det and det != "auto":
                detected_global = det
            return
        joined = "\n".join(clean_lines[i] for i in indices)
        txt, det, prov = translate_text_sync(joined, detected_global if detected_global != "auto" else src, dst)
        split = [re.sub(r"[\r\n]+", " ", s).strip() for s in txt.split("\n")]
        if len(split) == len(indices):
            for idx, val in zip(indices, split):
                out[idx] = val or clean_lines[idx]
            provider_used = prov
            if detected_global == "auto" and det and det != "auto":
                detected_global = det
            return
        mid = len(indices) // 2
        translate_slice(indices[:mid])
        translate_slice(indices[mid:])

    # Group into fast batches under 2,000 chars and 30 lines each.
    batch: List[int] = []
    batch_chars = 0
    for idx in non_empty_idx:
        line_len = len(clean_lines[idx])
        if batch and (len(batch) >= 30 or batch_chars + line_len > 2000):
            translate_slice(batch)
            batch = []
            batch_chars = 0
        batch.append(idx)
        batch_chars += line_len + 1
    if batch:
        translate_slice(batch)

    if detected_global == "auto":
        detected_global = detect_script_hint(" ".join(clean_lines[:5])) or "en"
    return out, detected_global, provider_used


def translate_subtitles_text_sync(raw: str, source: str = "auto", target: str = "hi") -> Tuple[str, str, str]:
    """Preserves SRT/VTT cue numbers and timing lines while translating all spoken captions."""
    norm = raw.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n{2,}", norm)
    cue_refs: List[Tuple[int, List[str], List[int]]] = []
    texts_to_translate: List[str] = []

    for b_idx, block in enumerate(blocks):
        lines = block.split("\n")
        ts_idx = next((i for i, ln in enumerate(lines) if "-->" in ln and _TIMESTAMP_LINE_RE.match(ln)), -1)
        if ts_idx == -1:
            cue_refs.append((b_idx, lines, []))
            continue
        payload_indices = [i for i in range(ts_idx + 1, len(lines)) if lines[i].strip()]
        if payload_indices:
            texts_to_translate.append(" ".join(lines[i].strip() for i in payload_indices))
        cue_refs.append((b_idx, lines, payload_indices))

    if not texts_to_translate:
        return translate_text_sync(raw, source, target)

    translated_cues, detected, provider = translate_batch_sync(texts_to_translate, source, target)
    q_iter = iter(translated_cues)
    rebuilt: List[str] = []
    for _, lines, payload_indices in cue_refs:
        if not payload_indices:
            rebuilt.append("\n".join(lines))
            continue
        ts_idx = next(i for i, ln in enumerate(lines) if "-->" in ln)
        header = lines[: ts_idx + 1]
        rebuilt.append("\n".join([*header, next(q_iter)]))
    return "\n\n".join(rebuilt), detected, provider
