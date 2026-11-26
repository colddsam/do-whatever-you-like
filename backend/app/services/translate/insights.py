"""
Extras around a translation, from Google's free "gtx" endpoint (no key):

- detect_language_sync: which language a snippet is in, with confidence and runner-ups
- lookup_insights_sync: romanisation of both sides, alternative translations, a bilingual
  dictionary grouped by part of speech, definitions, examples, synonyms and "did you mean"

Every field may come back empty; the translator shows only what it gets.
"""

from __future__ import annotations

import html
import logging
import re
from typing import List, Tuple

import requests

from app.config.translate import settings
from app.exceptions.translate import InvalidTranslateInputError, TranslationError
from app.services.translate.languages import detect_script_hint, normalize_code
from app.services.translate.providers import _GTX_URL, _UA, _google_code, translate_text_sync, validate_pair

logger = logging.getLogger(__name__)


def _gtx(q: str, src: str, dst: str, dts: Tuple[str, ...]) -> dict:
    params = [("client", "gtx"), ("sl", _google_code(src)), ("tl", _google_code(dst)), ("hl", "en"), ("dj", "1"), ("ie", "UTF-8"), ("oe", "UTF-8")]
    params += [("dt", d) for d in dts]
    resp = requests.post(_GTX_URL, params=params, data={"q": q}, headers={"User-Agent": _UA}, timeout=settings.REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def detect_language_sync(text: str) -> Tuple[str, float, List[Tuple[str, float]]]:
    """Returns (best_code, confidence 0-1, [(code, confidence)…])."""
    sample = (text or "").strip()[:500]
    if not sample:
        raise InvalidTranslateInputError("Type some text to detect its language.")
    try:
        data = _gtx(sample, "auto", "en", ("t",))
        ld = data.get("ld_result") or {}
        langs = [normalize_code(str(c)) for c in ld.get("srclangs") or []]
        confs = [float(c) for c in ld.get("srclangs_confidences") or []]
        pairs = [(c, round(confs[i] if i < len(confs) else 0.0, 3)) for i, c in enumerate(langs) if c]
        best = normalize_code(str(data.get("src") or (langs[0] if langs else "")))
        if best:
            conf = float(data.get("confidence") or (pairs[0][1] if pairs else 0.0))
            return best, round(conf, 3), pairs or [(best, round(conf, 3))]
    except Exception as exc:
        logger.debug("gtx detect failed: %s", exc)
    hint = detect_script_hint(sample)
    _, detected, _ = translate_text_sync(sample, "auto", "es" if hint == "en" else "en")
    conf = 0.9 if hint == detected else 0.6
    return detected, conf, [(detected, conf)]


def _clean(t: str) -> str:
    return re.sub(r"</?b>", "", html.unescape(t or "")).strip()


def lookup_insights_sync(text: str, source: str, target: str) -> dict:
    src, dst = validate_pair(source, target)
    q = (text or "").strip()
    if not q:
        raise InvalidTranslateInputError("Type a word or phrase to look up.")
    q = q[: settings.INSIGHTS_MAX_CHARS]
    try:
        data = _gtx(q, src, dst, ("t", "rm", "bd", "at", "md", "ex", "ss", "qca"))
    except Exception as exc:
        logger.info("Insights lookup failed: %s", exc)
        raise TranslationError("Word details aren't available right now. The translation itself still works.")

    sentences = data.get("sentences") or []
    translation = "".join(str(s.get("trans") or "") for s in sentences if "trans" in s)
    translit = " ".join(str(s.get("translit")) for s in sentences if s.get("translit")).strip()
    src_translit = " ".join(str(s.get("src_translit")) for s in sentences if s.get("src_translit")).strip()

    alternatives: List[dict] = []
    for item in (data.get("alternative_translations") or [])[:12]:
        options = [str(a.get("word_postproc") or "").strip() for a in item.get("alternative") or []]
        options = [o for o in dict.fromkeys(options) if o]
        if len(options) > 1:
            alternatives.append({"source": str(item.get("src_phrase") or ""), "options": options[:6]})

    dictionary: List[dict] = []
    for entry in (data.get("dict") or [])[:6]:
        words = [
            {
                "word": str(e.get("word") or ""),
                "reverse": [str(r) for r in (e.get("reverse_translation") or [])[:6]],
                "score": round(float(e.get("score") or 0.0), 6),
            }
            for e in (entry.get("entry") or [])[:8]
            if e.get("word")
        ]
        if words:
            dictionary.append({"pos": str(entry.get("pos") or "") or "phrase", "base": str(entry.get("base_form") or ""), "entries": words})

    definitions: List[dict] = []
    for d in (data.get("definitions") or [])[:5]:
        items = [
            {"gloss": _clean(str(e.get("gloss") or "")), "example": _clean(str(e.get("example") or ""))}
            for e in (d.get("entry") or [])[:4]
            if e.get("gloss")
        ]
        if items:
            definitions.append({"pos": str(d.get("pos") or ""), "items": items})

    examples = [_clean(str(e.get("text") or "")) for e in ((data.get("examples") or {}).get("example") or [])[:6]]

    synonyms: List[dict] = []
    for syn in (data.get("synsets") or [])[:4]:
        words: List[str] = []
        for e in syn.get("entry") or []:
            words.extend(str(w) for w in e.get("synonym") or [])
        if words:
            synonyms.append({"pos": str(syn.get("pos") or ""), "words": list(dict.fromkeys(words))[:12]})

    spell = data.get("spell") or {}
    corrected = _clean(str(spell.get("spell_res") or "")) if isinstance(spell, dict) else ""
    detected = normalize_code(str(data.get("src") or src))
    return {
        "text": q,
        "translation": translation,
        "detected_language": detected if src == "auto" else src,
        "confidence": round(float(data.get("confidence") or 0.0), 3),
        "source_romanization": src_translit,
        "target_romanization": translit,
        "alternatives": alternatives,
        "dictionary": dictionary,
        "definitions": definitions,
        "examples": [e for e in examples if e],
        "synonyms": synonyms,
        "did_you_mean": corrected if corrected and corrected.lower() != q.lower() else "",
    }
