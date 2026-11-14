"""
Audio and video edits (/api/v1/media), in-process through the ASGI app with real files.

    python scripts/check_media.py
"""

import asyncio
import json
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from app.core.config import app_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services.ffmpeg_service import init_ffmpeg  # noqa: E402

init_ffmpeg()
results = []


def check(name, ok, info=""):
    results.append(bool(ok))
    print("PASS" if ok else "FAIL", name, "" if ok else f"→ {info}", flush=True)


def multipart(fields):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields:
        if isinstance(value, tuple):
            head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{value[0]}"\r\nContent-Type: application/octet-stream\r\n\r\n'
            parts.append(head.encode() + value[1] + b"\r\n")
        else:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    return b"".join(parts) + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


async def call(path, fields):
    body, ctype = multipart(fields)
    headers = [(b"content-type", ctype.encode()), (b"authorization", f"Bearer {app_settings.HEADER_TOKEN}".encode()), (b"content-length", str(len(body)).encode())]
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "path": path, "raw_path": path.encode(), "query_string": b"",
             "headers": headers, "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 8000), "scheme": "http"}
    st, out, hd, sent = 0, b"", {}, False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.sleep(3600)

    async def send(m):
        nonlocal st, out, hd
        if m["type"] == "http.response.start":
            st, hd = m["status"], {k.decode(): v.decode() for k, v in m["headers"]}
        elif m["type"] == "http.response.body":
            out += m.get("body", b"")

    task = asyncio.create_task(app(scope, receive, send))
    for _ in range(3000):
        await asyncio.sleep(0.1)
        if st and ((hd.get("content-length") and len(out) >= int(hd["content-length"])) or (st != 200 and out)):
            break
    task.cancel()
    return st, hd, out


def probe(data, suffix):
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", f.name], capture_output=True)
    Path(f.name).unlink()
    d = json.loads(r.stdout or b"{}")
    return float(d.get("format", {}).get("duration", 0)), sorted({s["codec_type"] for s in d.get("streams", [])})


def loudness(data, suffix):
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", f.name, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    Path(f.name).unlink()
    line = [ln for ln in r.stderr.splitlines() if "mean_volume" in ln]
    return float(line[0].split(":")[1].split()[0]) if line else None


def detail(out):
    try:
        return json.loads(out).get("detail")
    except Exception:  # noqa: BLE001
        return out[:150]


tmp = Path(tempfile.mkdtemp())
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=20", "-f", "lavfi", "-i", "sine=f=440:d=20",
                "-af", "volume=-20dB", "-c:v", "libx264", "-g", "50", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(tmp / "v.mp4")], check=True)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=330:d=30", "-af", "volume=-18dB", "-c:a", "libmp3lame", str(tmp / "a.mp3")], check=True)
V = (tmp / "v.mp4").read_bytes()
A = (tmp / "a.mp3").read_bytes()
base_v = loudness(V, ".mp4")

st, hd, out = asyncio.run(call("/api/v1/media/trim", [("file", ("v.mp4", V)), ("start", "4"), ("end", "12")]))
dur, kinds = probe(out, ".mp4") if st == 200 else (0, [])
check("trim video, fast (copy): ~8 s, picture and sound", st == 200 and 7.5 <= dur <= 10.5 and kinds == ["audio", "video"], (st, dur, kinds, detail(out) if st != 200 else ""))
check("trim: named and explained", "v-trimmed.mp4" in hd.get("content-disposition", "") and "keyframe" in hd.get("x-convert-info", ""), hd.get("content-disposition"))
st, hd, out = asyncio.run(call("/api/v1/media/trim", [("file", ("v.mp4", V)), ("start", "4.4"), ("end", "7.6"), ("exact", "true")]))
dur, kinds = probe(out, ".mp4") if st == 200 else (0, [])
check("trim video, exact (re-encode): 3.2 s", st == 200 and abs(dur - 3.2) < 0.15, (st, dur, detail(out) if st != 200 else ""))
st, hd, out = asyncio.run(call("/api/v1/media/trim", [("file", ("a.mp3", A)), ("start", "10"), ("end", "15")]))
dur, kinds = probe(out, ".mp3") if st == 200 else (0, [])
check("trim audio (MP3): 5 s", st == 200 and abs(dur - 5) < 0.2 and kinds == ["audio"], (st, dur))
st, hd, out = asyncio.run(call("/api/v1/media/trim", [("file", ("v.mp4", V)), ("start", "30"), ("end", "40")]))
check("trim: start past the end explained (400)", st == 400 and "past the end" in str(detail(out)), (st, detail(out)))
st, hd, out = asyncio.run(call("/api/v1/media/trim", [("file", ("v.mp4", V)), ("start", "5"), ("end", "2")]))
check("trim: end before start refused (400)", st == 400, (st, detail(out)))

st, hd, out = asyncio.run(call("/api/v1/media/sound", [("file", ("v.mp4", V)), ("mode", "volume"), ("gain_db", "10")]))
lv = loudness(out, ".mp4") if st == 200 else None
check("volume +10 dB: about 10 dB louder, video kept", st == 200 and lv is not None and 8.5 <= lv - base_v <= 10.5 and probe(out, ".mp4")[1] == ["audio", "video"], (st, base_v, lv, detail(out) if st != 200 else ""))
st, hd, out = asyncio.run(call("/api/v1/media/sound", [("file", ("a.mp3", A)), ("mode", "normalize")]))
lv = loudness(out, ".mp3") if st == 200 else None
check("normalise: quiet MP3 brought up", st == 200 and lv is not None and lv > loudness(A, ".mp3") + 3, (st, lv, detail(out) if st != 200 else ""))
st, hd, out = asyncio.run(call("/api/v1/media/sound", [("file", ("v.mp4", V)), ("mode", "mute")]))
dur, kinds = probe(out, ".mp4") if st == 200 else (0, [])
check("mute: no sound left, picture untouched, full length", st == 200 and kinds == ["video"] and abs(dur - 20) < 0.5, (st, kinds, dur))
st, hd, out = asyncio.run(call("/api/v1/media/sound", [("file", ("a.mp3", A)), ("mode", "mute")]))
check("mute: refused for audio files (400)", st == 400, (st, detail(out)))
st, hd, out = asyncio.run(call("/api/v1/media/sound", [("file", ("v.mp4", V)), ("mode", "volume"), ("gain_db", "99")]))
check("volume: out of range refused (400)", st == 400, st)
st, hd, out = asyncio.run(call("/api/v1/media/sound", [("file", ("fake.mp4", b"MZ" + b"\x00" * 300)), ("mode", "mute")]))
check("upload guard: a program named .mp4 is refused (415)", st == 415, st)

# ---------- Noise removal ----------
import wave  # noqa: E402

import numpy as np  # noqa: E402

rate = 48000
t = np.arange(rate * 6) / rate
voice = np.zeros_like(t)
m = (t > 1) & (t < 4)
voice[m] = sum(np.sin(2 * np.pi * f * t[m]) / k for k, f in enumerate([180, 360, 540, 1200, 2400], 1)) * 0.25 * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t[m]))
noisy = voice + 0.05 * np.random.default_rng(0).standard_normal(len(t)) + 0.06 * (np.sin(2 * np.pi * 50 * t) + 0.5 * np.sin(2 * np.pi * 100 * t) + 0.3 * np.sin(2 * np.pi * 150 * t))
with wave.open(str(tmp / "noisy.wav"), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes((np.clip(noisy, -1, 1) * 32767).astype(np.int16).tobytes())
N = (tmp / "noisy.wav").read_bytes()
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=6", "-i", str(tmp / "noisy.wav"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", str(tmp / "nv.mp4")], check=True)
NV = (tmp / "nv.mp4").read_bytes()


def levels(data, suffix):
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", f.name, "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], capture_output=True)
    Path(f.name).unlink()
    y = np.frombuffer(r.stdout, np.int16) / 32767
    db = lambda a: 20 * np.log10(np.sqrt(np.mean(a**2)) + 1e-9)  # noqa: E731
    return db(y[int(4.5 * rate) : int(5.8 * rate)]), db(y[int(1.5 * rate) : int(3.5 * rate)])


n0, v0 = levels(N, ".wav")
st, hd, out = asyncio.run(call("/api/v1/media/denoise", [("file", ("noisy.wav", N)), ("strength", "medium")]))
n1, v1 = levels(out, ".wav") if st == 200 else (0, 0)
info = json.loads(hd.get("x-convert-info", "{}")) if st == 200 else {}
check("denoise WAV: background noise down 12+ dB", st == 200 and n0 - n1 >= 12, (st, round(n0, 1), round(n1, 1), detail(out) if st != 200 else ""))
check("denoise: the voice is kept (within 1.5 dB)", st == 200 and abs(v1 - v0) <= 1.5, (round(v0, 1), round(v1, 1)))
check("denoise: 50 Hz hum found by itself, quiet moment used", info.get("hum") == 50 and 4.0 <= info.get("sample", [0])[0] <= 6, info)
st, hd, out = asyncio.run(call("/api/v1/media/denoise", [("file", ("nv.mp4", NV)), ("strength", "strong"), ("clicks", "true")]))
dur, kinds = probe(out, ".mp4") if st == 200 else (0, [])
n2, _ = levels(out, ".mp4") if st == 200 else (0, 0)
check("denoise video (strong): picture kept, cleaner sound", st == 200 and kinds == ["audio", "video"] and abs(dur - 6) < 0.3 and n2 < n0 - 12, (st, kinds, dur, round(n2, 1), detail(out) if st != 200 else ""))
st, hd, out = asyncio.run(call("/api/v1/media/denoise", [("file", ("noisy.wav", N)), ("noise_start", "0.1"), ("noise_end", "0.8"), ("hum", "off")]))
info = json.loads(hd.get("x-convert-info", "{}")) if st == 200 else {}
check("denoise: a picked noise-only part is used, hum off respected", st == 200 and info.get("sample") == [0.1, 0.8] and info.get("hum") is None, (st, info))
st, hd, out = asyncio.run(call("/api/v1/media/denoise", [("file", ("noisy.wav", N)), ("noise_start", "1")]))
check("denoise: a start without an end refused (400)", st == 400, (st, detail(out)))
st, hd, out = asyncio.run(call("/api/v1/media/denoise", [("file", ("noisy.wav", N)), ("strength", "max")]))
check("denoise: unknown strength refused", st in (400, 422), st)
st, hd, out = asyncio.run(call("/api/v1/media/denoise", [("file", ("fake.wav", b"MZ" + bytes(300)))]))
check("upload guard: a program named .wav is refused (415)", st == 415, st)

left = [p for p in (ROOT / "temp" / "media").glob("*") if p.is_dir()]
check("temp folders cleaned up", not left, left[:3])
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
