"""
The API client's request relay (the Postman-style tool at /tools/api-client).

The browser builds every request itself (variables, auth signatures, multipart bodies), then asks us to
send it, because most APIs don't allow cross-origin calls from a web page. We send exactly what we were
given and report what happened in detail: each phase's timing (DNS, TCP, TLS, request, first byte,
download), the TLS certificate, the redirect chain and the raw response bytes.

Safety is the same as the other network tools: a host is resolved once, every address it resolves to
must be public, and the socket is opened to that checked address (so DNS can't change in between),
on every redirect hop. Timeouts and size caps keep each call short; nothing is stored.

Also here: NTLM (a connection-bound handshake a browser can't do), and gRPC unary/streaming calls over
HTTP/2 (browsers can't read HTTP/2 trailers), with messages encoded and decoded in the browser.
"""

import base64
import gzip
import hashlib
import hmac
import http.client
import logging
import os
import re
import socket
import ssl
import struct
import time
import zlib
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote, urljoin, urlparse

from app.config.apiclient import settings
from app.exceptions.apiclient import ApiClientProcessingError, InvalidApiClientInputError
from app.exceptions.devtools import InvalidDevtoolsInputError
from app.schemas.apiclient import GrpcRequest, NtlmCredentials, SendRequest
from app.services.devtools import _public_addresses, clean_host

logger = logging.getLogger(__name__)

TOKEN = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
# Set by the connection itself; a caller can't choose them.
HOP_HEADERS = {"host", "content-length", "connection", "transfer-encoding", "upgrade", "te", "trailer", "keep-alive", "proxy-authorization", "proxy-connection"}
USER_AGENT = "DoWhatever-API-Client/1.0"


def _ms(t0: float, t1: float) -> float:
    return round((t1 - t0) * 1000, 2)


def _check_target(host: str, port: int) -> Tuple[str, str, float]:
    """Hostname → (clean host, one checked public IP, DNS ms). Raised errors are already user-friendly."""
    t0 = time.monotonic()
    try:
        clean = clean_host(host)
        ip = _public_addresses(clean, port)[0]
    except InvalidDevtoolsInputError as exc:
        msg = exc.detail
        if "Private, local" in msg:
            msg = f"{host} is a private or local address, which our server can't reach. Switch the agent to \"Browser\" to call it from your device."
        raise InvalidApiClientInputError(msg)
    return clean, ip, _ms(t0, time.monotonic())


def _cert_info(sock: ssl.SSLSocket, verified: bool) -> Dict[str, Any]:
    info: Dict[str, Any] = {"protocol": sock.version(), "verified": verified}
    cipher = sock.cipher()
    if cipher:
        info["cipher"], info["bits"] = cipher[0], cipher[2]
    try:
        cert = sock.getpeercert()
    except ValueError:
        cert = None
    if cert:
        flat = lambda seq: ", ".join("=".join(x) for rdn in seq for x in rdn)  # noqa: E731
        info.update(
            subject=flat(cert.get("subject", ())),
            issuer=flat(cert.get("issuer", ())),
            not_before=cert.get("notBefore"),
            not_after=cert.get("notAfter"),
            san=[v for k, v in cert.get("subjectAltName", ()) if k == "DNS"][:20],
        )
    return info


def _open(scheme: str, host: str, ip: str, port: int, verify: bool, timeout: float, alpn: Optional[List[str]] = None):
    """A TCP (and TLS) socket to the checked IP, with the time each step took."""
    t0 = time.monotonic()
    try:
        raw = socket.create_connection((ip, port), timeout=settings.CONNECT_TIMEOUT)
    except socket.timeout:
        raise ApiClientProcessingError(f"Couldn't connect to {host}:{port} within {settings.CONNECT_TIMEOUT:g} seconds.")
    except OSError as exc:
        raise ApiClientProcessingError(f"Couldn't connect to {host}:{port} ({exc.strerror or type(exc).__name__}).")
    t1 = time.monotonic()
    tls = None
    sock: socket.socket = raw
    if scheme == "https":
        import certifi

        ctx = ssl.create_default_context(cafile=certifi.where())
        if not verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        ctx.set_alpn_protocols(alpn or ["http/1.1"])
        try:
            sock = ctx.wrap_socket(raw, server_hostname=host)
        except ssl.SSLCertVerificationError as exc:
            raw.close()
            raise ApiClientProcessingError(f"{host}'s certificate isn't trusted ({exc.verify_message}). Turn off SSL verification in the request's settings to send anyway.")
        except (ssl.SSLError, OSError) as exc:
            raw.close()
            raise ApiClientProcessingError(f"The secure connection to {host} failed ({getattr(exc, 'reason', None) or type(exc).__name__}).")
        tls = _cert_info(sock, verify)
    t2 = time.monotonic()
    sock.settimeout(timeout)
    return sock, _ms(t0, t1), (_ms(t1, t2) if scheme == "https" else 0.0), tls


def _decode(raw: bytes, encoding: str) -> bytes:
    """Undo Content-Encoding (gzip, deflate, br), capped so a zip bomb can't grow past the limit."""
    cap = settings.MAX_RESPONSE_BYTES + 1
    for enc in [e.strip().lower() for e in encoding.split(",") if e.strip()][::-1]:
        try:
            if enc in ("gzip", "x-gzip"):
                d = zlib.decompressobj(16 + zlib.MAX_WBITS)
                raw = d.decompress(raw, cap)
            elif enc == "deflate":
                try:
                    raw = zlib.decompressobj().decompress(raw, cap)
                except zlib.error:
                    raw = zlib.decompressobj(-zlib.MAX_WBITS).decompress(raw, cap)
            elif enc == "br":
                import brotli

                raw = brotli.decompress(raw)[:cap]
            elif enc == "identity":
                pass
            else:
                break
        except Exception:  # A body that lies about its encoding is shown as it came.
            break
    return raw


class _Conn:
    """One HTTP/1.1 connection over a socket we opened (so we can time it and pin the IP)."""

    def __init__(self, sock, host: str, port: int):
        self.http = http.client.HTTPConnection(host, port)
        self.http.sock = sock

    def send(self, method: str, path: str, netloc: str, headers: List[Tuple[str, str]], body: Optional[bytes]) -> None:
        h = self.http
        h.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        h.putheader("Host", netloc)
        for k, v in headers:
            h.putheader(k, v)
        if body is not None and (body or method not in ("GET", "HEAD", "DELETE", "OPTIONS")):
            h.putheader("Content-Length", str(len(body)))
        h.endheaders(body or None)

    def close(self) -> None:
        try:
            self.http.close()
        except Exception:
            pass


def _read(resp: http.client.HTTPResponse, stream: bool) -> Tuple[bytes, bool, bool]:
    """Body bytes, whether it was cut at the size cap, and whether a stream was cut at the time cap."""
    cap = settings.MAX_RESPONSE_BYTES
    if not stream:
        data = resp.read(cap + 1)
        return data[:cap], len(data) > cap, False
    # text/event-stream: read what arrives within STREAM_SECONDS.
    buf = bytearray()
    deadline = time.monotonic() + settings.STREAM_SECONDS
    sock = resp.fp.raw._sock if hasattr(resp.fp, "raw") else None  # type: ignore[attr-defined]
    while time.monotonic() < deadline and len(buf) <= cap:
        if sock is not None:
            sock.settimeout(max(0.05, deadline - time.monotonic()))
        try:
            chunk = resp.read1(16384) if hasattr(resp, "read1") else resp.read(16384)
        except (socket.timeout, TimeoutError):
            return bytes(buf[:cap]), len(buf) > cap, True
        except http.client.IncompleteRead as exc:
            buf += exc.partial
            break
        if not chunk:
            return bytes(buf[:cap]), len(buf) > cap, False
        buf += chunk
    return bytes(buf[:cap]), len(buf) > cap, time.monotonic() >= deadline


# ---------------------------------------------------------------- NTLM (v2)


def _md4(data: bytes) -> bytes:
    """MD4 for the NT hash: OpenSSL 3 dropped it from hashlib on many systems."""
    try:
        return hashlib.new("md4", data).digest()
    except (ValueError, TypeError):
        pass
    F = lambda x, y, z: (x & y) | (~x & z)  # noqa: E731
    G = lambda x, y, z: (x & y) | (x & z) | (y & z)  # noqa: E731
    H = lambda x, y, z: x ^ y ^ z  # noqa: E731
    rot = lambda x, n: ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF  # noqa: E731
    msg = data + b"\x80" + b"\x00" * ((55 - len(data)) % 64) + struct.pack("<Q", len(data) * 8)
    a, b, c, d = 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476
    for i in range(0, len(msg), 64):
        X = struct.unpack("<16I", msg[i : i + 64])
        aa, bb, cc, dd = a, b, c, d
        for k in range(16):
            s = (3, 7, 11, 19)[k % 4]
            if k % 4 == 0:
                a = rot((a + F(b, c, d) + X[k]) & 0xFFFFFFFF, s)
            elif k % 4 == 1:
                d = rot((d + F(a, b, c) + X[k]) & 0xFFFFFFFF, s)
            elif k % 4 == 2:
                c = rot((c + F(d, a, b) + X[k]) & 0xFFFFFFFF, s)
            else:
                b = rot((b + F(c, d, a) + X[k]) & 0xFFFFFFFF, s)
        for k, idx in enumerate((0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15)):
            s = (3, 5, 9, 13)[k % 4]
            if k % 4 == 0:
                a = rot((a + G(b, c, d) + X[idx] + 0x5A827999) & 0xFFFFFFFF, s)
            elif k % 4 == 1:
                d = rot((d + G(a, b, c) + X[idx] + 0x5A827999) & 0xFFFFFFFF, s)
            elif k % 4 == 2:
                c = rot((c + G(d, a, b) + X[idx] + 0x5A827999) & 0xFFFFFFFF, s)
            else:
                b = rot((b + G(c, d, a) + X[idx] + 0x5A827999) & 0xFFFFFFFF, s)
        for k, idx in enumerate((0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15)):
            s = (3, 9, 11, 15)[k % 4]
            if k % 4 == 0:
                a = rot((a + H(b, c, d) + X[idx] + 0x6ED9EBA1) & 0xFFFFFFFF, s)
            elif k % 4 == 1:
                d = rot((d + H(a, b, c) + X[idx] + 0x6ED9EBA1) & 0xFFFFFFFF, s)
            elif k % 4 == 2:
                c = rot((c + H(d, a, b) + X[idx] + 0x6ED9EBA1) & 0xFFFFFFFF, s)
            else:
                b = rot((b + H(c, d, a) + X[idx] + 0x6ED9EBA1) & 0xFFFFFFFF, s)
        a, b, c, d = (a + aa) & 0xFFFFFFFF, (b + bb) & 0xFFFFFFFF, (c + cc) & 0xFFFFFFFF, (d + dd) & 0xFFFFFFFF
    return struct.pack("<4I", a, b, c, d)


NTLM_FLAGS = 0x00000001 | 0x00000004 | 0x00000200 | 0x00008000 | 0x00080000 | 0x00800000 | 0x20000000 | 0x80000000


def ntlm_negotiate() -> str:
    msg = b"NTLMSSP\x00" + struct.pack("<II", 1, NTLM_FLAGS) + struct.pack("<HHI", 0, 0, 0) * 2
    return "NTLM " + base64.b64encode(msg).decode()


def ntlm_authenticate(challenge_header: str, creds: NtlmCredentials, client_challenge: Optional[bytes] = None, now: Optional[int] = None) -> str:
    m = re.search(r"NTLM\s+([A-Za-z0-9+/=]+)", challenge_header or "")
    if not m:
        raise ApiClientProcessingError("The server didn't send an NTLM challenge.")
    msg = base64.b64decode(m.group(1))
    if msg[:8] != b"NTLMSSP\x00" or struct.unpack("<I", msg[8:12])[0] != 2:
        raise ApiClientProcessingError("The server's NTLM challenge couldn't be read.")
    flags = struct.unpack("<I", msg[20:24])[0]
    server_challenge = msg[24:32]
    ti_len, _, ti_off = struct.unpack("<HHI", msg[40:48]) if len(msg) >= 48 else (0, 0, 0)
    target_info = msg[ti_off : ti_off + ti_len]
    # The server's own clock, when it sends one (MsvAvTimestamp, id 7), avoids skew failures.
    ts = None
    i = 0
    while i + 4 <= len(target_info):
        av_id, av_len = struct.unpack("<HH", target_info[i : i + 4])
        if av_id == 7 and av_len == 8:
            ts = target_info[i + 4 : i + 12]
        if av_id == 0:
            break
        i += 4 + av_len
    if ts is None:
        ts = struct.pack("<Q", ((now if now is not None else int(time.time())) + 11644473600) * 10_000_000)
    cc = client_challenge or os.urandom(8)
    nt_hash = _md4(creds.password.encode("utf-16-le"))
    v2 = hmac.new(nt_hash, (creds.username.upper() + creds.domain).encode("utf-16-le"), "md5").digest()
    blob = b"\x01\x01\x00\x00" + b"\x00" * 4 + ts + cc + b"\x00" * 4 + target_info + b"\x00" * 4
    nt_response = hmac.new(v2, server_challenge + blob, "md5").digest() + blob
    lm_response = hmac.new(v2, server_challenge + cc, "md5").digest() + cc
    domain = creds.domain.encode("utf-16-le")
    user = creds.username.encode("utf-16-le")
    ws = (creds.workstation or "WORKSTATION").encode("utf-16-le")
    fields = [lm_response, nt_response, domain, user, ws, b""]
    offset = 64
    header = b"NTLMSSP\x00" + struct.pack("<I", 3)
    payload = b""
    for f in fields:
        header += struct.pack("<HHI", len(f), len(f), offset + len(payload))
        payload += f
    header += struct.pack("<I", flags & NTLM_FLAGS | 0x00000001)
    return "NTLM " + base64.b64encode(header + payload).decode()


# ---------------------------------------------------------------- HTTP


def _validate(req: SendRequest) -> Tuple[str, List[Tuple[str, str]], Optional[bytes]]:
    method = req.method.strip().upper()
    if not TOKEN.match(method):
        raise InvalidApiClientInputError("A method is one word of letters, like GET or PROPFIND.")
    headers: List[Tuple[str, str]] = []
    for k, v in req.headers:
        k = k.strip()
        if not k:
            continue
        if not TOKEN.match(k):
            raise InvalidApiClientInputError(f"\"{k[:60]}\" isn't a valid header name: header names can't contain spaces or symbols like : ( ) < >.")
        if "\r" in v or "\n" in v:
            raise InvalidApiClientInputError(f"The value of {k} contains a line break, which headers can't carry.")
        if len(v) > 16_000:
            raise InvalidApiClientInputError(f"The value of {k} is longer than 16,000 characters.")
        if k.lower() in HOP_HEADERS:
            continue
        headers.append((k, v))
    body = None
    if req.body_b64 is not None:
        try:
            body = base64.b64decode(req.body_b64, validate=True)
        except (ValueError, TypeError):
            raise InvalidApiClientInputError("The request body couldn't be read.")
        if len(body) > settings.MAX_BODY_BYTES:
            raise InvalidApiClientInputError(f"The request body is over {settings.MAX_BODY_BYTES // (1024 * 1024)} MB, the most our server relays. Send it with the Browser agent instead.")
    return method, headers, body


def send_request(req: SendRequest) -> Dict[str, Any]:
    method, headers, body = _validate(req)
    url = req.url.strip()
    if "://" not in url:
        url = "http://" + url
    timeout = min(req.timeout_ms, settings.MAX_TIMEOUT_MS) / 1000
    if not any(k.lower() == "user-agent" for k, _ in headers):
        headers.append(("User-Agent", USER_AGENT))
    if not any(k.lower() == "accept" for k, _ in headers):
        headers.append(("Accept", "*/*"))
    if not any(k.lower() == "accept-encoding" for k, _ in headers):
        headers.append(("Accept-Encoding", "gzip, deflate, br"))
    hops: List[Dict[str, Any]] = []
    started = time.monotonic()
    first_host = None

    for _ in range(min(req.max_redirects, settings.MAX_REDIRECTS) + 1):
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            raise InvalidApiClientInputError("Use an address that starts with http:// or https://.")
        port = p.port or (443 if p.scheme == "https" else 80)
        host, ip, dns_ms = _check_target(p.hostname, port)
        first_host = first_host or host
        sock, tcp_ms, tls_ms, tls = _open(p.scheme, host, ip, port, req.verify_ssl, timeout)
        conn = _Conn(sock, host, port)
        path = (p.path or "/") + (f";{p.params}" if p.params else "") + (f"?{p.query}" if p.query else "")
        sent_headers = list(headers)
        try:
            t0 = time.monotonic()
            if req.ntlm:
                resp = _ntlm_exchange(conn, method, path, p.netloc, sent_headers, body, req.ntlm)
            else:
                conn.send(method, path, p.netloc, sent_headers, body)
                resp = conn.http.getresponse()
            t1 = time.monotonic()
            ctype = resp.getheader("Content-Type", "") or ""
            raw, truncated, stream_cut = _read(resp, "text/event-stream" in ctype.lower()) if method != "HEAD" else (b"", False, False)
            t2 = time.monotonic()
        except (socket.timeout, TimeoutError):
            conn.close()
            raise ApiClientProcessingError(f"{host} didn't answer within {timeout:g} seconds. Raise the timeout in the request's settings if it's a slow call.")
        except ApiClientProcessingError:
            conn.close()
            raise
        except (http.client.HTTPException, OSError) as exc:
            conn.close()
            raise ApiClientProcessingError(f"The connection to {host} failed: {type(exc).__name__}{': ' + str(exc) if str(exc) else ''}.")
        resp_headers = [[k, v] for k, v in resp.getheaders()]
        conn.close()
        hops.append({"url": url, "status": resp.status, "reason": resp.reason, "ms": _ms(t0, t2) + dns_ms + tcp_ms + tls_ms})
        loc = resp.getheader("Location")
        if req.follow_redirects and resp.status in (301, 302, 303, 307, 308) and loc and len(hops) <= req.max_redirects:
            url = urljoin(url, loc)
            if resp.status == 303 or (resp.status in (301, 302) and not req.follow_original_method and method not in ("GET", "HEAD")):
                method, body = ("GET" if method != "HEAD" else "HEAD"), None
                headers = [(k, v) for k, v in headers if k.lower() not in ("content-type",)]
            new_host = urlparse(url).hostname
            if new_host and clean_host(new_host) != first_host and not req.follow_auth_header:
                headers = [(k, v) for k, v in headers if k.lower() not in ("authorization", "cookie")]
            continue
        if req.follow_redirects and resp.status in (301, 302, 303, 307, 308) and loc and len(hops) > req.max_redirects:
            raise ApiClientProcessingError(f"Stopped after {req.max_redirects} redirects. Raise the limit in the request's settings.")
        encoding = resp.getheader("Content-Encoding", "") or ""
        decoded = _decode(raw, encoding) if encoding and not truncated else raw
        if len(decoded) > settings.MAX_RESPONSE_BYTES:
            decoded, truncated = decoded[: settings.MAX_RESPONSE_BYTES], True
        head_size = len(f"HTTP/1.1 {resp.status} {resp.reason}\r\n") + sum(len(k) + len(v) + 4 for k, v in resp_headers) + 2
        return {
            "status": resp.status,
            "reason": resp.reason,
            "http_version": {10: "HTTP/1.0", 11: "HTTP/1.1"}.get(resp.version, "HTTP/1.1"),
            "headers": resp_headers,
            "body_b64": base64.b64encode(decoded).decode("ascii"),
            "size": {"body": len(decoded), "wire_body": len(raw), "headers": head_size},
            "truncated": truncated,
            "stream_cut": stream_cut,
            "timings": {"dns": dns_ms, "tcp": tcp_ms, "tls": tls_ms, "ttfb": _ms(t0, t1), "download": _ms(t1, t2), "total": _ms(started, time.monotonic())},
            "remote": {"ip": ip, "port": port},
            "tls": tls,
            "hops": hops,
            "request": {"method": method, "url": url, "headers": [[k, v] for k, v in [("Host", p.netloc), *sent_headers]], "body_size": len(body or b"")},
        }
    raise ApiClientProcessingError(f"Stopped after {req.max_redirects} redirects. Raise the limit in the request's settings.")


def _ntlm_exchange(conn: _Conn, method: str, path: str, netloc: str, headers: List[Tuple[str, str]], body: Optional[bytes], creds: NtlmCredentials):
    """Negotiate → challenge → authenticate, all on one keep-alive connection (NTLM authenticates the connection)."""
    base = [(k, v) for k, v in headers if k.lower() != "authorization"] + [("Connection", "keep-alive")]
    conn.send(method, path, netloc, base + [("Authorization", ntlm_negotiate())], None if body is None else b"")
    first = conn.http.getresponse()
    first.read()
    challenge = next((v for k, v in first.getheaders() if k.lower() == "www-authenticate" and v.strip().upper().startswith("NTLM ")), None)
    if first.status != 401 or not challenge:
        raise ApiClientProcessingError("The server didn't ask for NTLM (no NTLM challenge came back). Check the URL, or pick another auth type.")
    conn.send(method, path, netloc, base + [("Authorization", ntlm_authenticate(challenge, creds))], body)
    return conn.http.getresponse()


# ---------------------------------------------------------------- gRPC over HTTP/2


def grpc_call(req: GrpcRequest) -> Dict[str, Any]:
    import h2.config
    import h2.connection
    import h2.events

    if not req.path.startswith("/") or req.path.count("/") != 2:
        raise InvalidApiClientInputError("The method path looks like /package.Service/Method.")
    target = req.url.strip()
    if "://" in target:
        pu = urlparse(target)
        tls = pu.scheme in ("https", "grpcs")
        hostname, port = pu.hostname or "", pu.port or (443 if tls else 80)
    else:
        tls = req.tls
        hostname, _, port_s = target.rpartition(":") if re.search(r":\d+$", target) else (target, "", "")
        port = int(port_s) if port_s else (443 if tls else 80)
    if not hostname:
        raise InvalidApiClientInputError("Type the server as host:port, like grpcb.in:9001.")
    host, ip, dns_ms = _check_target(hostname, port)
    timeout = min(req.timeout_ms, settings.MAX_TIMEOUT_MS) / 1000
    messages = []
    for m in req.messages_b64:
        try:
            messages.append(base64.b64decode(m, validate=True))
        except (ValueError, TypeError):
            raise InvalidApiClientInputError("A message couldn't be read.")
    if sum(len(m) for m in messages) > settings.MAX_BODY_BYTES:
        raise InvalidApiClientInputError("The messages are too large to relay.")
    started = time.monotonic()
    sock, tcp_ms, tls_ms, tls_info = _open("https" if tls else "http", host, ip, port, req.verify_ssl, timeout, alpn=["h2"])
    if tls and isinstance(sock, ssl.SSLSocket) and sock.selected_alpn_protocol() != "h2":
        sock.close()
        raise ApiClientProcessingError(f"{host}:{port} doesn't speak HTTP/2, so it isn't a gRPC server (or it needs TLS turned off).")
    conn = h2.connection.H2Connection(config=h2.config.H2Configuration(client_side=True, header_encoding="utf-8"))
    conn.initiate_connection()
    sock.sendall(conn.data_to_send())
    authority = host if port in (80, 443) else f"{host}:{port}"
    hdrs = [(":method", "POST"), (":scheme", "https" if tls else "http"), (":path", req.path), (":authority", authority),
            ("content-type", "application/grpc"), ("te", "trailers"), ("user-agent", "grpc-dowhatever/1.0"),
            ("grpc-timeout", f"{int(timeout * 1000)}m")]
    for k, v in req.metadata:
        k = k.strip().lower()
        if k and not k.startswith(":") and k not in ("content-type", "te", "grpc-timeout", "host", "connection"):
            if not re.match(r"^[0-9a-z_.-]+$", k):
                raise InvalidApiClientInputError(f"\"{k}\" isn't a valid metadata key: use lowercase letters, digits, - _ and .")
            hdrs.append((k, v))
    sid = conn.get_next_available_stream_id()
    conn.send_headers(sid, hdrs)
    payload = b"".join(b"\x00" + struct.pack(">I", len(m)) + m for m in messages)
    resp_headers: List[List[str]] = []
    trailers: List[List[str]] = []
    buf = bytearray()
    out: List[bytes] = []
    ended = False
    reset = None
    first_byte = None
    t_sent = time.monotonic()
    deadline = time.monotonic() + timeout
    pending = memoryview(payload)
    try:
        while not ended and time.monotonic() < deadline:
            # Send as much of the body as flow control allows; close our side once it's all out.
            while pending is not None:
                window = min(conn.local_flow_control_window(sid), conn.max_outbound_frame_size)
                if len(pending) == 0:
                    conn.end_stream(sid)
                    pending = None
                    break
                if window <= 0:
                    break
                n = min(window, len(pending))
                conn.send_data(sid, pending[:n].tobytes())
                pending = pending[n:]
            data_out = conn.data_to_send()
            if data_out:
                sock.sendall(data_out)
            sock.settimeout(max(0.05, deadline - time.monotonic()))
            try:
                data = sock.recv(65536)
            except (socket.timeout, TimeoutError):
                break
            if not data:
                break
            for ev in conn.receive_data(data):
                if isinstance(ev, h2.events.ResponseReceived):
                    first_byte = first_byte or time.monotonic()
                    resp_headers = [[str(k), str(v)] for k, v in ev.headers]
                elif isinstance(ev, h2.events.DataReceived):
                    first_byte = first_byte or time.monotonic()
                    buf += ev.data
                    conn.acknowledge_received_data(ev.flow_controlled_length, ev.stream_id)
                elif isinstance(ev, h2.events.TrailersReceived):
                    trailers = [[str(k), str(v)] for k, v in ev.headers]
                elif isinstance(ev, h2.events.StreamEnded) and ev.stream_id == sid:
                    ended = True
                elif isinstance(ev, h2.events.StreamReset) and ev.stream_id == sid:
                    reset, ended = ev.error_code, True
                elif isinstance(ev, h2.events.ConnectionTerminated):
                    ended = True
            if conn.data_to_send():
                sock.sendall(conn.data_to_send())
            # Pull whole length-prefixed messages out of the buffer as they complete.
            while len(buf) >= 5 and len(out) < settings.MAX_GRPC_MESSAGES:
                flag, size = buf[0], struct.unpack(">I", bytes(buf[1:5]))[0]
                if len(buf) < 5 + size:
                    break
                msg = bytes(buf[5 : 5 + size])
                del buf[: 5 + size]
                if flag & 1:
                    try:
                        msg = gzip.decompress(msg)
                    except OSError:
                        pass
                out.append(msg)
            if len(out) > settings.MAX_GRPC_MESSAGES or sum(len(m) for m in out) > settings.MAX_RESPONSE_BYTES:
                break
    except OSError as exc:
        raise ApiClientProcessingError(f"The connection to {host} failed: {type(exc).__name__}.")
    finally:
        try:
            sock.close()
        except OSError:
            pass
    meta = {k: v for k, v in (trailers or resp_headers)}
    hmap = {k: v for k, v in resp_headers}
    status = meta.get("grpc-status", hmap.get("grpc-status"))
    message = unquote(meta.get("grpc-message", hmap.get("grpc-message", "")))
    if status is None and not ended:
        status, message = "4", message or f"No answer within {timeout:g} seconds (DEADLINE_EXCEEDED)."
    if status is None and reset is not None:
        status, message = "14", f"The server reset the stream (HTTP/2 error {reset})."
    return {
        "status": int(status) if status is not None and str(status).isdigit() else 2,
        "message": message,
        "http_status": int(hmap.get(":status", "0") or 0),
        "headers": [h for h in resp_headers if not h[0].startswith(":")],
        "trailers": trailers,
        "messages_b64": [base64.b64encode(m).decode() for m in out],
        "timings": {"dns": dns_ms, "tcp": tcp_ms, "tls": tls_ms, "ttfb": _ms(t_sent, first_byte) if first_byte else None, "total": _ms(started, time.monotonic())},
        "tls": tls_info,
        "remote": {"ip": ip, "port": port},
    }
