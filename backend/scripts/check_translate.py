"""End-to-end check of the Translator API: text, subtitles, batch, spoken audio, and video dubbing."""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
os.environ.setdefault("HEADER_TOKEN", "test-token")

from app.core.config import app_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services.translate import translate_service  # noqa: E402
from app.services.universal.engines.media import probe  # noqa: E402
from app.services.universal.graph import ffmpeg_path  # noqa: E402

TOKEN = app_settings.HEADER_TOKEN
results: List[bool] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append(ok)
    print("PASS" if ok else "FAIL", name, "" if ok else f"-> {detail}", flush=True)


async def _asgi(
    method: str,
    path: str,
    *,
    body: bytes = b"",
    content_type: str = "application/json",
    token: str | None = TOKEN,
) -> Tuple[int, bytes, Dict[str, str]]:
    headers: List[Tuple[bytes, bytes]] = [(b"content-type", content_type.encode())]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "path": f"/api/v1{path}",
        "raw_path": f"/api/v1{path}".encode(),
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
        "scheme": "http",
    }
    status_code = 0
    resp_headers: Dict[str, str] = {}
    out = bytearray()
    sent = False
    finished = asyncio.Event()

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        await finished.wait()
        return {"type": "http.disconnect"}

    async def send(msg):
        nonlocal status_code, resp_headers
        if msg["type"] == "http.response.start":
            status_code = msg["status"]
            resp_headers = {k.decode().lower(): v.decode() for k, v in msg.get("headers", [])}
        elif msg["type"] == "http.response.body":
            out.extend(msg.get("body", b""))
            if not msg.get("more_body", False):
                finished.set()

    try:
        await app(scope, receive, send)
    finally:
        finished.set()
    return status_code, bytes(out), resp_headers


def call_json(method: str, path: str, payload: Any = None, token: str | None = TOKEN) -> Tuple[int, Any]:
    raw = json.dumps(payload).encode("utf-8") if payload is not None else b""
    st, body, _ = asyncio.run(_asgi(method, path, body=raw, content_type="application/json", token=token))
    try:
        return st, json.loads(body.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return st, body


def call_multipart(path: str, file_field: Tuple[str, bytes], fields: Dict[str, str]) -> Tuple[int, List[Dict[str, Any]], bytes]:
    boundary = f"----dwtr{uuid.uuid4().hex}"
    chunks: List[bytes] = []
    for k, v in fields.items():
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    fname, fbytes = file_field
    chunks.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n".encode("utf-8")
        + fbytes
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    st, raw, _ = asyncio.run(
        _asgi("POST", path, body=body, content_type=f"multipart/form-data; boundary={boundary}")
    )
    events: List[Dict[str, Any]] = []
    for ln in raw.decode("utf-8", errors="replace").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            events.append(json.loads(ln))
        except Exception:  # noqa: BLE001
            pass
    return st, events, raw


def main() -> None:
    # 1. Auth & capabilities
    st, _ = call_json("GET", "/translate/capabilities", token=None)
    check("auth required on capabilities", st in (401, 403), str(st))

    st, caps = call_json("GET", "/translate/capabilities")
    check("capabilities 200 & available", st == 200 and isinstance(caps, dict) and caps.get("available") is True, str(st))
    check("capabilities has 90+ languages", isinstance(caps, dict) and len(caps.get("languages", [])) >= 90, str(len(caps.get("languages", []))))

    # 2. Text translation & validation
    st, bad = call_json("POST", "/translate/text", {"text": "   ", "source": "auto", "target": "hi"})
    check("blank text refused (400)", st == 400, f"{st} {bad}")

    st, bad_lang = call_json("POST", "/translate/text", {"text": "Hello", "source": "auto", "target": "xx"})
    check("unknown target language refused (400)", st == 400, f"{st} {bad_lang}")

    st, en_hi = call_json("POST", "/translate/text", {"text": "Good morning! How are you doing today?", "source": "auto", "target": "hi"})
    check("text EN -> HI succeeds", st == 200 and bool(en_hi.get("translated_text")) and en_hi.get("detected_language") == "en", str(en_hi))
    print("  EN -> HI:", en_hi.get("translated_text"))

    st, ar_en = call_json("POST", "/translate/text", {"text": "مرحبا بكم في موقعنا الجديد", "source": "auto", "target": "en"})
    check("RTL Arabic auto-detect -> EN succeeds", st == 200 and ar_en.get("detected_language") == "ar" and "welcome" in ar_en.get("translated_text", "").lower(), str(ar_en))
    print("  AR -> EN:", ar_en.get("translated_text"))

    srt_in = "1\n00:00:01,000 --> 00:00:03,000\nHello everyone.\n\n2\n00:00:03,500 --> 00:00:06,000\nWelcome to our tool."
    st, srt_es = call_json("POST", "/translate/text", {"text": srt_in, "source": "en", "target": "es", "mode": "subtitles"})
    check(
        "subtitle mode preserves timestamps & translates",
        st == 200
        and "00:00:01,000 --> 00:00:03,000" in srt_es.get("translated_text", "")
        and "00:00:03,500 --> 00:00:06,000" in srt_es.get("translated_text", "")
        and "Hola" in srt_es.get("translated_text", ""),
        str(srt_es),
    )

    # 3. Batch translation
    st, batch = call_json("POST", "/translate/batch", {"texts": ["Good morning", "How is the weather?", "Thank you very much"], "source": "en", "target": "fr"})
    check("batch 1:1 translation (EN -> FR)", st == 200 and len(batch.get("translated_texts", [])) == 3 and batch["translated_texts"][0] != "Good morning", str(batch))

    # 4. Upload guard & validation on /translate/media
    st, _, raw = call_multipart("/translate/media", ("fake.mp4", b"MZ\x90\x00" + b"\x00" * 200), {"source_language": "auto", "target_language": "hi"})
    check("upload guard blocks renamed executable (415)", st == 415, f"{st} {raw[:120]}")

    # 5. Real spoken Audio & Video end-to-end dubbing checks
    if caps.get("speech_available"):
        import edge_tts

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            speech_mp3 = tmp / "hello_en.mp3"
            asyncio.run(edge_tts.Communicate("Hello friend, welcome to our website today.", "en-US-AvaNeural").save(str(speech_mp3)))

            # Audio -> Hindi MP3
            st_a, ev_a, raw_a = call_multipart(
                "/translate/media",
                ("speech.mp3", speech_mp3.read_bytes()),
                {"source_language": "en", "target_language": "hi", "voice_gender": "female", "timing": "timed"},
            )
            done_a = next((e for e in ev_a if e.get("type") == "done"), None)
            check("audio EN -> HI dubbing stream done", st_a == 200 and done_a is not None and bool(done_a.get("result_token")), f"st={st_a} ev={[e.get('type') for e in ev_a]} err={[e for e in ev_a if e.get('type')=='error']}")
            if done_a:
                check("audio done has source & translated text", bool(done_a.get("source_text")) and bool(done_a.get("translated_text")), str(done_a))
                dl_st, dl_bytes, dl_hdrs = asyncio.run(_asgi("GET", f"/translate/result/{done_a['result_token']}", token=TOKEN))
                out_a = tmp / done_a["result_name"]
                out_a.write_bytes(dl_bytes)
                ap = probe(out_a)
                check("downloaded translated audio valid (ffprobe)", dl_st == 200 and len(dl_bytes) > 1000 and ap["audio"] and not ap["video"], f"{dl_st} {len(dl_bytes)} {ap}")
                print("  Audio source:", done_a.get("source_text"), "-> HI:", done_a.get("translated_text"))

            # Video -> Spanish MP4 (with video stream preserved + dubbed ES AAC + soft subtitle track)
            ff = ffmpeg_path()
            src_mp4 = tmp / "clip_en.mp4"
            subprocess.run(
                [ff, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=#15140F:s=320x240:r=15:d=4", "-i", str(speech_mp3), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src_mp4)],
                check=True,
            )
            st_v, ev_v, _ = call_multipart(
                "/translate/media",
                ("clip.mp4", src_mp4.read_bytes()),
                {"source_language": "en", "target_language": "es", "voice_gender": "male", "timing": "timed", "include_subtitles": "true"},
            )
            done_v = next((e for e in ev_v if e.get("type") == "done"), None)
            check("video EN -> ES dubbing stream done", st_v == 200 and done_v is not None and bool(done_v.get("result_token")), f"st={st_v} ev={[e.get('type') for e in ev_v]} err={[e for e in ev_v if e.get('type')=='error']}")
            if done_v:
                dl_st, dl_bytes, _ = asyncio.run(_asgi("GET", f"/translate/result/{done_v['result_token']}", token=TOKEN))
                out_v = tmp / done_v["result_name"]
                out_v.write_bytes(dl_bytes)
                vp = probe(out_v)
                check("downloaded translated video valid with video+audio (ffprobe)", dl_st == 200 and vp["video"] and vp["audio"] and vp["width"] == 320, f"{dl_st} {vp}")
                print("  Video source:", done_v.get("source_text"), "-> ES:", done_v.get("translated_text"))
    else:
        print("SKIP audio/video dubbing checks: speech_available is False")

    # 6. Check temp working directories cleaned up (only cache kept)
    leftover = [p for p in Path("temp/translate").iterdir() if p.name != "cache"] if Path("temp/translate").exists() else []
    check("temp work dirs cleaned up", len(leftover) == 0, str(leftover))
    # Clean cached test artifacts created during verification
    from app.config.translate import settings as tr_settings  # noqa: E402
    shutil.rmtree(tr_settings.TEMP_DIR / "cache", ignore_errors=True)
    (tr_settings.TEMP_DIR / "cache").mkdir(parents=True, exist_ok=True)

    passed = sum(results)
    print(f"\n{passed}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
