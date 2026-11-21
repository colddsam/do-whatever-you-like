"""
Server helpers for the browser video editor. The editor decodes, renders, transcribes and exports on
the user's device; media never comes here. This service only:

1. Proxies allowlisted public files (Google Fonts, free stock libraries) for hosts that don't allow
   cross-origin reads. Every redirect hop is checked against the allowlist and must resolve to public
   addresses; only fonts, stylesheets, pictures, video and audio are passed on, streamed in 64 KB
   chunks with a size cap, so memory stays flat whatever the file's size.
2. Plans edits for the AI Director: a plain-language request plus a summary of the timeline (clip
   names and times, never media) goes to a free LLM (Gemini or Groq) that answers with a list of
   timeline operations. The editor validates them again before applying anything.
"""

import asyncio
import base64
import ipaddress
import json
import logging
import re
import socket
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests

from app.config.studio import settings
from app.exceptions.studio import InvalidStudioInputError, StudioProcessingError, StudioUpstreamError

logger = logging.getLogger(__name__)

MB = 1024 * 1024
CHUNK = 64 * 1024
UA = "DoWhatever-Studio/1.0 (font and stock-media proxy)"
PASSABLE_TYPES = ("font/", "text/css", "image/", "video/", "audio/", "application/octet-stream", "application/ogg", "application/font", "application/x-font", "binary/octet-stream")

KNOWN_OPS = {
    "split", "delete", "trim", "move", "addText", "captions", "removeSilence", "look", "effect",
    "transition", "speed", "volume", "fade", "removeBackground", "aspect", "kenBurns",
    "speedRamp", "reverse", "freeze", "flip", "layout", "voice", "normalize", "duck", "beats",
    "scenes", "stabilize", "reframe", "closeGaps", "addShape", "addAdjustment", "sticker", "sfx", "backdrop",
}

# Edge voice names look like en-US-AriaNeural or en-US-EmmaMultilingualNeural.
VOICE_RE = re.compile(r"^[a-z]{2,3}-[A-Za-z]{2,4}(?:-[A-Za-z]+)?-[A-Za-z]+Neural$")

DIRECTOR_SYSTEM = """You are the AI Director inside a browser video editor. Turn the user's request into a JSON object {"ops": [...]} using ONLY these operations. Times are seconds on the timeline. clipId values must be ids from the timeline JSON; omit clipId to target the selected clips (or every suitable clip when none are selected).
- {"op":"split","at":number,"clipId"?:string}
- {"op":"delete","clipId":string,"ripple"?:boolean}
- {"op":"trim","clipId":string,"start"?:number,"end"?:number}  (new start/end time of the clip)
- {"op":"move","clipId":string,"start":number}
- {"op":"addText","text":string,"start":number,"duration":number,"preset"?:"title"|"subtitle"|"lower-third"|"bold-caption"|"neon"|"typewriter"|"quote"|"handwritten"}
- {"op":"captions","style"?:"bold"|"karaoke"|"clean"|"boxed"|"minimal"}  (auto-captions from speech, made on the device)
- {"op":"removeSilence","thresholdDb"?:number,"minSilence"?:number,"padding"?:number}  (defaults -42 dB, 0.5 s, 0.12 s)
- {"op":"look","look":"warm"|"cool"|"bw"|"vintage"|"cinematic"|"vivid"|"fade"|"none","clipId"?:string}
- {"op":"effect","effect":EFFECT,"clipId"?:string,"params"?:object,"color"?:"#rrggbb"}
  EFFECT is one of: colorGrade, colorWheels, curves, hsl, colorKey, duotone, posterize, invert, blur, sharpen, motionBlur, radialBlur, glow, pixelate, mirror, kaleidoscope, fisheye, wave, shake, glitch, rgbSplit, vhs, filmGrain, halftone, lightLeak, letterbox, lensFlare, godRays, halation, tiltShift, prism, heatDistort, shockwave, crt, edgeGlow, particles, strobe, perspective, chromaticLens, chromaKey, lumaKey, unmult, mask, crop, frame.
  colorGrade params: exposure (-2..2), brightness, contrast, highlights, shadows, whites, blacks, clarity, saturation, vibrance, temperature, tint (-1..1), fade (0..1), hue (-180..180), vignette (0..1); colorWheels: liftR/G/B/Y, gammaR/G/B/Y, gainR/G/B/Y; blur: radius (px); sharpen: amount (0..3); motionBlur: length (px), angle; radialBlur: amount (0..1); glow: radius, intensity (0..2); lensFlare/godRays: x, y, intensity, color; halation: threshold, radius, intensity, warmth; tiltShift: center, band, blur, angle; prism: intensity, dispersion, angle, facets; heatDistort: amount, speed, scale; shockwave: x, y, progress, width, strength; crt: curvature, scanlines, grille, flicker, vignette; edgeGlow: intensity, threshold, thickness, color; particles: amount, size, speed, wind; strobe: rate, duty, intensity; perspective: pitch, yaw, roll, distance; chromaticLens: amount, falloff; chromaKey: similarity, smoothness, spill, clipBlack, clipWhite, edgeShrink, edgeFeather, lightWrap, color is the screen colour; unmult: threshold, softness.
- {"op":"transition","type":"crossDissolve"|"dipToBlack"|"dipToWhite"|"whipPan"|"zoomBlur"|"wipe"|"slide"|"push"|"iris"|"clockWipe"|"zoomIn"|"spin"|"blurDissolve"|"glitch"|"pixelate"|"filmBurn"|"barnDoor"|"lumaDissolve","duration"?:number,"direction"?:"left"|"right"|"up"|"down","clipId"?:string}  (no clipId: every cut)
- {"op":"speed","speed":number,"clipId"?:string}
- {"op":"volume","volume":number,"clipId"?:string}  (1 = unchanged, 0 = mute, 2 = +6 dB)
- {"op":"fade","fadeIn"?:number,"fadeOut"?:number,"clipId"?:string}
- {"op":"removeBackground","clipId"?:string}
- {"op":"aspect","aspect":"16:9"|"9:16"|"1:1"|"4:5"|"21:9"}
- {"op":"kenBurns","clipId"?:string,"from"?:number,"to"?:number}  (slow zoom, scale 1 = 100%)
- {"op":"speedRamp","preset":"montage"|"hero"|"bullet"|"jumpCut"|"flashIn"|"flashOut"|"rampUp"|"rampDown"|"none","clipId"?:string}  (CapCut-style speed curves)
- {"op":"reverse","clipId"?:string}  (play a clip backwards)
- {"op":"freeze","at"?:number,"duration"?:number,"clipId"?:string}  (insert a freeze frame; default at the playhead for 2 s)
- {"op":"flip","axis":"h"|"v","clipId"?:string}
- {"op":"layout","layout":"full"|"fit"|"pip-tl"|"pip-tr"|"pip-bl"|"pip-br"|"pip-framed"|"split-h"|"split-v"|"split-3h"|"split-3v"|"grid"}  (picture-in-picture or split screen for the selected clips)
- {"op":"backdrop","amount"?:number,"clipId"?:string}  (blurred copy of the clip fills the frame behind it, for vertical videos; amount = blur px, 0 removes)
- {"op":"voice","voice":"none"|"chipmunk"|"deep"|"robot"|"telephone"|"radio"|"megaphone"|"echo"|"hall"|"underwater"|"alien","clipId"?:string}  (voice changer on sound clips)
- {"op":"normalize","target"?:number}  (even out loudness, default -14 LUFS)
- {"op":"duck","amount"?:number}  (lower the music under speech by amount dB, default -12)
- {"op":"beats","cut"?:boolean}  (beat markers from the music; cut:true also cuts the video on the beats)
- {"op":"scenes","clipId"?:string}  (split a video at its scene changes)
- {"op":"stabilize","clipId"?:string,"strength"?:number}  (0..1)
- {"op":"reframe","clipId"?:string}  (keep the person in frame after an aspect change)
- {"op":"closeGaps"}
- {"op":"addShape","shape":"rectangle"|"rounded"|"circle"|"triangle"|"star"|"polygon"|"heart"|"arrow"|"line"|"outline"|"progress"|"bubble","start"?:number,"duration"?:number}
- {"op":"addAdjustment","start"?:number,"duration"?:number,"effects"?:[{"effect":EFFECT,"params"?:object,"color"?:"#rrggbb"}]}  (adds an adjustment layer affecting all tracks beneath it)
- {"op":"sticker","emoji":string,"start"?:number,"duration"?:number}
- {"op":"sfx","sound":"whoosh"|"swoosh"|"riser"|"impact"|"boom"|"pop"|"click"|"ding"|"notify"|"shutter"|"typing"|"bleep"|"laser"|"heartbeat"|"kick"|"glitch"|"drop"|"chime","at"?:number}
Use as few operations as the request needs, in a sensible order. If the request is unclear or can't be done with these operations, answer {"ops": [], "note": "<one short reason>"}. Answer with JSON only."""

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class StudioService:
    """Allowlisted proxy and AI Director planning for the browser video editor."""

    @staticmethod
    def host_allowed(host: str) -> bool:
        h = (host or "").lower().rstrip(".")
        return any(h == d or h.endswith("." + d) for d in settings.PROXY_HOSTS)

    @classmethod
    def validate_url(cls, url: str) -> str:
        u = (url or "").strip()
        if len(u) > 2048:
            raise InvalidStudioInputError("That address is too long.")
        p = urlparse(u)
        if p.scheme not in ("http", "https") or not p.hostname:
            raise InvalidStudioInputError("Give a full http(s) address to a file.")
        if p.username or p.password:
            raise InvalidStudioInputError("Addresses with a username or password aren't accepted.")
        if not cls.host_allowed(p.hostname):
            raise InvalidStudioInputError("Only Google Fonts and free stock libraries (Pexels, Pixabay, Unsplash, Wikimedia Commons, the Internet Archive, Freesound, Mixkit, Coverr) can be fetched.")
        return u

    @staticmethod
    def _check_public(host: str, port: int) -> None:
        # The allowlist names big public CDNs; this guards against one of them resolving somewhere
        # private (a misconfigured or hijacked record) before we connect.
        try:
            infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            raise StudioUpstreamError(f"{host} couldn't be found.")
        for info in infos:
            ip = ipaddress.ip_address(info[4][0].split("%")[0])
            if not ip.is_global or ip.is_multicast:
                raise InvalidStudioInputError("That address doesn't point to a public server.")

    def open_proxy(self, url: str) -> Tuple[requests.Response, str, Optional[int]]:
        """Opens the file (following allowlisted redirects hop by hop). Returns the response, its type and length."""
        current = self.validate_url(url)
        for _ in range(settings.PROXY_MAX_REDIRECTS + 1):
            p = urlparse(current)
            self._check_public(p.hostname or "", p.port or (443 if p.scheme == "https" else 80))
            try:
                resp = requests.get(current, stream=True, allow_redirects=False, timeout=settings.PROXY_TIMEOUT, headers={"User-Agent": UA, "Accept": "*/*"})
            except requests.RequestException as exc:
                logger.warning("studio proxy fetch failed for %s: %s", p.hostname, exc)
                raise StudioUpstreamError(f"{p.hostname} didn't answer.")
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                nxt = urljoin(current, resp.headers["Location"])
                resp.close()
                current = self.validate_url(nxt)
                continue
            if resp.status_code != 200:
                resp.close()
                raise StudioUpstreamError(f"The file's site answered {resp.status_code}.")
            ctype = (resp.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip().lower()
            if not ctype.startswith(PASSABLE_TYPES):
                resp.close()
                raise InvalidStudioInputError("Only fonts, pictures, video and audio can be fetched (that address gave a web page).")
            raw_len = resp.headers.get("Content-Length", "")
            length = int(raw_len) if raw_len.isdigit() else None
            if length and length > settings.PROXY_MAX_MB * MB:
                resp.close()
                raise InvalidStudioInputError(f"That file is over {settings.PROXY_MAX_MB} MB.")
            if ctype == "text/css":
                ctype = "text/css; charset=utf-8"
            return resp, ctype, length
        raise StudioUpstreamError("Too many redirects.")

    @staticmethod
    def stream(resp: requests.Response) -> Iterator[bytes]:
        total = 0
        try:
            for chunk in resp.iter_content(CHUNK):
                total += len(chunk)
                if total > settings.PROXY_MAX_MB * MB:
                    logger.warning("studio proxy stopped a file over the cap")
                    break
                yield chunk
        finally:
            resp.close()

    # ---------- AI Director ----------

    @staticmethod
    def engine() -> Optional[str]:
        if settings.GEMINI_API_KEY.strip():
            return "gemini"
        if settings.GROQ_API_KEY.strip():
            return "groq"
        return None

    def capabilities(self) -> Dict[str, Any]:
        return {
            "director": self.engine(),
            "proxy_hosts": settings.PROXY_HOSTS,
            "proxy_max_mb": settings.PROXY_MAX_MB,
            "tts": True,
            "tts_max_chars": settings.TTS_MAX_CHARS,
        }

    @staticmethod
    def _gemini(user: str) -> str:
        key = settings.GEMINI_API_KEY.strip()
        last: Optional[Exception] = None
        for model in dict.fromkeys([settings.GEMINI_MODEL, "gemini-flash-lite-latest", "gemini-flash-latest"]):
            try:
                resp = requests.post(
                    GEMINI_URL.format(model=model),
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json={
                        "systemInstruction": {"parts": [{"text": DIRECTOR_SYSTEM}]},
                        "contents": [{"role": "user", "parts": [{"text": user}]}],
                        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "maxOutputTokens": 2048},
                    },
                    timeout=settings.DIRECTOR_TIMEOUT,
                )
            except requests.Timeout as exc:  # one model stuck: the next may answer
                last = exc
                continue
            # A retired model name (404), or one that's overloaded or rate-limited right now: try the next.
            if resp.status_code == 404 or resp.status_code == 429 or resp.status_code >= 500:
                last = RuntimeError(f"gemini model {model} answered {resp.status_code}")
                continue
            resp.raise_for_status()
            parts = resp.json()["candidates"][0]["content"]["parts"]
            return "".join(str(p.get("text", "")) for p in parts)
        raise last or RuntimeError("no gemini model answered")

    @staticmethod
    def _groq(user: str) -> str:
        key = settings.GROQ_API_KEY.strip()
        last: Optional[Exception] = None
        for model in dict.fromkeys([settings.GROQ_MODEL, "openai/gpt-oss-20b", "llama-3.1-8b-instant"]):
            resp = requests.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "temperature": 0.2,
                    "max_tokens": 2048,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "system", "content": DIRECTOR_SYSTEM}, {"role": "user", "content": user}],
                },
                timeout=settings.DIRECTOR_TIMEOUT,
            )
            if resp.status_code in (400, 404) and "model" in resp.text.lower():
                last = RuntimeError(f"groq model {model} unavailable")
                continue
            resp.raise_for_status()
            return str(resp.json()["choices"][0]["message"]["content"])
        raise last or RuntimeError("no groq model answered")

    @staticmethod
    def _parse(raw: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text[text.find("{") :] if "{" in text else text
        try:
            data = json.loads(text)
        except ValueError:
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end <= start:
                raise StudioProcessingError("The AI's answer wasn't a list of edits. Try rephrasing.")
            data = json.loads(text[start : end + 1])
        ops_raw = data.get("ops", []) if isinstance(data, dict) else data
        note = data.get("note") if isinstance(data, dict) and isinstance(data.get("note"), str) else None
        ops = [o for o in (ops_raw if isinstance(ops_raw, list) else []) if isinstance(o, dict) and o.get("op") in KNOWN_OPS]
        return ops[: settings.DIRECTOR_MAX_OPS], (note[:300] if note else None)

    def plan(self, prompt: str, timeline: Dict[str, Any]) -> Dict[str, Any]:
        engine = self.engine()
        if not engine:
            return {"ops": None, "engine": "none", "note": "No AI key is set on the server, so the editor's built-in commands handle this."}
        summary = json.dumps(timeline, separators=(",", ":"), ensure_ascii=False)
        if len(summary) > settings.DIRECTOR_MAX_TIMELINE_CHARS:
            raise InvalidStudioInputError("The timeline summary is too large.")
        user = f"Request: {prompt.strip()}\nTimeline: {summary}"
        chain = [engine] + (["groq"] if engine == "gemini" and settings.GROQ_API_KEY.strip() else [])
        for i, name in enumerate(chain):
            try:
                raw = self._gemini(user) if name == "gemini" else self._groq(user)
                ops, note = self._parse(raw)
                return {"ops": ops, "engine": name, "note": note}
            except StudioProcessingError:
                raise
            except (requests.RequestException, KeyError, IndexError, ValueError, RuntimeError) as exc:
                logger.warning("studio director via %s failed: %s", name, exc)
                if i == len(chain) - 1:
                    raise StudioUpstreamError("The AI service is busy or unreachable right now; the editor's built-in commands still work.")
        raise StudioUpstreamError()


    # ---------- Text to speech ----------

    @staticmethod
    def validate_voice(voice: str) -> str:
        v = voice.strip()
        if not VOICE_RE.match(v):
            raise InvalidStudioInputError("That voice name isn't valid.")
        return v

    def tts(self, text: str, voice: str, rate: int, pitch: int) -> Dict[str, Any]:
        """
        Speech through Microsoft Edge's online voices (free, no key). The MP3 is collected in memory
        (a few hundred KB a minute) with each word's timing, so the editor can caption it exactly.
        Runs in a worker thread with its own event loop.
        """
        clean = " ".join(text.split())
        if not clean:
            raise InvalidStudioInputError("Type something to say.")
        if len(clean) > settings.TTS_MAX_CHARS:
            raise InvalidStudioInputError(f"Keep it under {settings.TTS_MAX_CHARS} characters per voice-over.")
        v = self.validate_voice(voice)
        limit = settings.TTS_MAX_MB * MB

        async def run() -> Tuple[bytes, List[Dict[str, Any]]]:
            import edge_tts

            comm = edge_tts.Communicate(
                clean, v, rate=f"{rate:+d}%", pitch=f"{pitch:+d}Hz", boundary="WordBoundary", receive_timeout=settings.TTS_TIMEOUT
            )
            audio = bytearray()
            words: List[Dict[str, Any]] = []
            async for chunk in comm.stream():
                if chunk.get("type") == "audio":
                    audio += chunk.get("data") or b""
                    if len(audio) > limit:
                        raise StudioProcessingError("That voice-over is too long. Split the text.")
                elif chunk.get("type") == "WordBoundary":
                    start = float(chunk.get("offset", 0)) / 1e7
                    words.append({"text": str(chunk.get("text", "")), "start": round(start, 3), "end": round(start + float(chunk.get("duration", 0)) / 1e7, 3)})
            return bytes(audio), words

        try:
            audio, words = asyncio.run(asyncio.wait_for(run(), timeout=settings.TTS_TIMEOUT + 5))
        except StudioProcessingError:
            raise
        except Exception as exc:  # network errors, unknown voices, service hiccups
            logger.warning("studio tts failed (%s): %s", v, exc)
            raise StudioUpstreamError("The voice service didn't answer. Try again, or pick another voice.")
        if not audio:
            raise StudioUpstreamError("The voice service sent no audio. Try another voice.")
        return {"audio": base64.b64encode(audio).decode("ascii"), "mime": "audio/mpeg", "voice": v, "words": words}


studio_service = StudioService()
