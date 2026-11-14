"""In-process ASGI + local HTTP/SMTP server verification for the Tool Request feature."""

from __future__ import annotations

import asyncio
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import socketserver
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config.tool_request import settings
from app.core.config import app_settings
from app.main import app
from app.services.tool_request import tool_request_service

RESULTS: list[bool] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append(ok)
    print("PASS" if ok else "FAIL", name, "" if ok else f"-> {detail}", flush=True)


async def asgi_request(
    method: str,
    path: str,
    body: bytes = b"",
    token: str | None = None,
    client_ip: str = "198.51.100.10",
) -> tuple[int, bytes]:
    headers = [(b"content-type", b"application/json"), (b"x-forwarded-for", client_ip.encode())]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
        "scheme": "http",
    }
    status_code = 0
    resp_body = b""
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(msg):
        nonlocal status_code, resp_body
        if msg["type"] == "http.response.start":
            status_code = msg["status"]
        elif msg["type"] == "http.response.body":
            resp_body += msg.get("body", b"")

    await app(scope, receive, send)
    return status_code, resp_body


def post_json(path: str, payload: dict, token: str | None = None, ip: str = "198.51.100.10") -> tuple[int, dict]:
    code, raw = asyncio.run(asgi_request("POST", path, json.dumps(payload).encode(), token=token, client_ip=ip))
    return code, json.loads(raw.decode() or "{}")


def run_all() -> None:
    token = app_settings.HEADER_TOKEN

    # 1. Auth checks
    c1, _ = asyncio.run(asgi_request("GET", "/api/v1/tool-request/capabilities"))
    c2, _ = post_json("/api/v1/tool-request", {"idea": "Batch watermark"})
    check("capabilities requires Bearer auth", c1 in (401, 403), str(c1))
    check("submit requires Bearer auth", c2 in (401, 403), str(c2))

    # 2. Capabilities check
    c3, raw3 = asyncio.run(asgi_request("GET", "/api/v1/tool-request/capabilities", token=token))
    cap = json.loads(raw3.decode())
    check("capabilities returns 200 with colddsam@gmail.com target", c3 == 200 and cap.get("to_email") == "colddsam@gmail.com", str(cap))

    # Snapshot settings before local test overrides
    orig = {
        "APPS_SCRIPT_URL": settings.APPS_SCRIPT_URL,
        "WEBHOOK_URL": settings.WEBHOOK_URL,
        "SMTP_HOST": settings.SMTP_HOST,
        "SMTP_PORT": settings.SMTP_PORT,
        "SMTP_USER": settings.SMTP_USER,
        "SMTP_PASS": settings.SMTP_PASS,
        "SMTP_USE_SSL": settings.SMTP_USE_SSL,
        "SMTP_STARTTLS": settings.SMTP_STARTTLS,
        "FORMSUBMIT_ENABLED": settings.FORMSUBMIT_ENABLED,
        "RATE_LIMIT_PER_HOUR": settings.RATE_LIMIT_PER_HOUR,
    }

    captured_http: list[dict] = []

    class CaptureHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            ln = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(ln)
            captured_http.append(json.loads(raw.decode()))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')

        def log_message(self, format, *args):
            return

    http_srv = HTTPServer(("127.0.0.1", 0), CaptureHandler)
    http_port = http_srv.server_address[1]
    t_http = threading.Thread(target=http_srv.serve_forever, daemon=True)
    t_http.start()

    captured_smtp: list[str] = []

    class MockSMTPHandler(socketserver.StreamRequestHandler):
        def handle(self):
            self.wfile.write(b"220 mock-smtp ESMTP\r\n")
            self.wfile.flush()
            data_mode = False
            buf: list[str] = []
            while True:
                line = self.rfile.readline(65536)
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                if data_mode:
                    if text.rstrip("\r\n") == ".":
                        captured_smtp.append("".join(buf))
                        data_mode = False
                        buf.clear()
                        self.wfile.write(b"250 OK\r\n")
                    else:
                        buf.append(text)
                    self.wfile.flush()
                    continue
                upper = text.upper()
                if upper.startswith("EHLO") or upper.startswith("HELO"):
                    self.wfile.write(b"250-mock-smtp\r\n250 AUTH PLAIN LOGIN\r\n")
                elif upper.startswith("AUTH"):
                    self.wfile.write(b"235 Authentication successful\r\n")
                elif upper.startswith(("MAIL FROM", "RCPT TO")):
                    self.wfile.write(b"250 OK\r\n")
                elif upper.startswith("DATA"):
                    self.wfile.write(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                    data_mode = True
                elif upper.startswith("QUIT"):
                    self.wfile.write(b"221 Bye\r\n")
                    self.wfile.flush()
                    break
                else:
                    self.wfile.write(b"250 OK\r\n")
                self.wfile.flush()

    class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True

    smtp_srv = ThreadedTCPServer(("127.0.0.1", 0), MockSMTPHandler)
    smtp_port = smtp_srv.server_address[1]
    t_smtp = threading.Thread(target=smtp_srv.serve_forever, daemon=True)
    t_smtp.start()

    try:
        settings.FORMSUBMIT_ENABLED = False
        settings.WEBHOOK_URL = ""
        settings.SMTP_HOST = ""
        settings.SMTP_USER = ""
        settings.SMTP_PASS = ""
        settings.APPS_SCRIPT_URL = f"http://127.0.0.1:{http_port}/send"

        # 3. Validation errors
        c_blank, d_blank = post_json("/api/v1/tool-request", {"idea": "   "}, token=token, ip="198.51.100.11")
        check("whitespace-only idea rejected (400)", c_blank == 400, f"{c_blank} {d_blank}")

        c_short, _ = post_json("/api/v1/tool-request", {"idea": "ab"}, token=token, ip="198.51.100.12")
        check("too-short idea rejected (422)", c_short == 422, str(c_short))

        c_bad_email, d_bad = post_json(
            "/api/v1/tool-request",
            {"idea": "Convert AVIF images cleanly", "reply_to": "not-an-email"},
            token=token,
            ip="198.51.100.13",
        )
        check("malformed reply_to rejected (400)", c_bad_email == 400, f"{c_bad_email} {d_bad}")

        c_crlf, d_crlf = post_json(
            "/api/v1/tool-request",
            {"idea": "Convert AVIF images cleanly", "reply_to": "ok@example.com\r\nBcc: bad@evil.com"},
            token=token,
            ip="198.51.100.14",
        )
        check("CRLF injection in reply_to rejected (400)", c_crlf == 400, f"{c_crlf} {d_crlf}")

        # 4. Honeypot filter
        before_count = len(captured_http)
        c_honey, d_honey = post_json(
            "/api/v1/tool-request",
            {"idea": "Buy cheap watches now", "website": "https://spam.example.com"},
            token=token,
            ip="198.51.100.15",
        )
        check(
            "honeypot skips delivery and marks filtered",
            c_honey == 200 and d_honey.get("delivered") is False and d_honey.get("provider") == "filtered" and len(captured_http) == before_count,
            str(d_honey),
        )

        # 5. Real Apps Script HTTP delivery & HTML escaping check
        c_ok, d_ok = post_json(
            "/api/v1/tool-request",
            {
                "idea": "SVG path optimizer <script>alert(1)</script>",
                "category": "Images",
                "reply_to": "maker@example.com",
                "page_url": "https://do-whatever-you-like.colddsam.com/#request",
            },
            token=token,
            ip="198.51.100.16",
        )
        sent_mail = captured_http[-1] if captured_http else {}
        check(
            "Apps Script HTTP delivery sends escaped HTML & colddsam@gmail.com",
            c_ok == 200
            and d_ok.get("delivered") is True
            and d_ok.get("provider") == "apps_script"
            and sent_mail.get("to") == "colddsam@gmail.com"
            and sent_mail.get("replyTo") == "maker@example.com"
            and "&lt;script&gt;alert(1)&lt;/script&gt;" in sent_mail.get("html", "")
            and "<script>" not in sent_mail.get("html", ""),
            str((d_ok, sent_mail)),
        )

        # 6. Mock SMTP delivery check
        settings.APPS_SCRIPT_URL = ""
        settings.SMTP_HOST = "127.0.0.1"
        settings.SMTP_PORT = smtp_port
        settings.SMTP_USER = "sender@example.com"
        settings.SMTP_PASS = "secret"
        settings.SMTP_USE_SSL = False
        settings.SMTP_STARTTLS = False
        c_smtp, d_smtp = post_json(
            "/api/v1/tool-request",
            {"idea": "PDF table splitter for bank statements", "reply_to": "reader@example.com"},
            token=token,
            ip="198.51.100.17",
        )
        raw_smtp = captured_smtp[-1] if captured_smtp else ""
        check(
            "SMTP provider sends MIME message to colddsam@gmail.com",
            c_smtp == 200
            and d_smtp.get("provider") == "smtp"
            and "To: colddsam@gmail.com" in raw_smtp
            and "Reply-To: reader@example.com" in raw_smtp
            and "PDF table splitter" in raw_smtp,
            str(d_smtp),
        )

        # 7. Honest 503 when zero providers exist
        settings.SMTP_HOST = ""
        settings.SMTP_USER = ""
        settings.SMTP_PASS = ""
        settings.FORMSUBMIT_ENABLED = False
        c_none, _ = post_json(
            "/api/v1/tool-request",
            {"idea": "Should return honest 503 when unconfigured"},
            token=token,
            ip="198.51.100.18",
        )
        check("returns 503 instead of fake success when no providers configured", c_none == 503, str(c_none))

        # 8. Rate limit check
        settings.RATE_LIMIT_PER_HOUR = 2
        settings.WEBHOOK_URL = f"http://127.0.0.1:{http_port}/hook"
        r1, _ = post_json("/api/v1/tool-request", {"idea": "First rate limit test"}, token=token, ip="203.0.113.99")
        r2, _ = post_json("/api/v1/tool-request", {"idea": "Second rate limit test"}, token=token, ip="203.0.113.99")
        r3, _ = post_json("/api/v1/tool-request", {"idea": "Third should 429"}, token=token, ip="203.0.113.99")
        check("per-IP rate limit triggers 429 cleanly", r1 == 200 and r2 == 200 and r3 == 429, f"{r1},{r2},{r3}")
    finally:
        http_srv.shutdown()
        smtp_srv.shutdown()
        for k, v in orig.items():
            setattr(settings, k, v)
        with tool_request_service._lock:
            tool_request_service._hits.clear()

    print(f"\nTool Request Check Summary: {sum(RESULTS)}/{len(RESULTS)} passed")
    sys.exit(0 if all(RESULTS) else 1)


if __name__ == "__main__":
    run_all()
