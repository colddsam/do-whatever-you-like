"""
End-to-end check for the developer tools (/api/v1/devtools/*), in-process through the ASGI app:
auth, DNS, reverse DNS, ports, HTTP (with redirect chains), XSD, XSLT, and the safety rules
(no private addresses, no redirects into them, no entities, no file access from XSLT).

Needs internet access (it looks up real domains).

    python scripts/check_devtools.py
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from app.core.config import app_settings  # noqa: E402
from app.main import app  # noqa: E402

results = []


async def call(path: str, body: dict | None = None, token: bool = True):
    raw = json.dumps(body or {}).encode()
    headers = [(b"content-type", b"application/json")]
    if token:
        headers.append((b"authorization", f"Bearer {app_settings.HEADER_TOKEN}".encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "path": path, "raw_path": path.encode(), "query_string": b"",
             "headers": headers, "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 8000), "scheme": "http"}
    status, out, sent = 0, b"", False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": raw, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(msg):
        nonlocal status, out
        if msg["type"] == "http.response.start":
            status = msg["status"]
        elif msg["type"] == "http.response.body":
            out += msg.get("body", b"")

    await app(scope, receive, send)
    try:
        return status, json.loads(out or b"null")
    except json.JSONDecodeError:
        return status, out.decode(errors="replace")


def check(name: str, ok: bool, detail: str = ""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "" if ok else f"→ {detail}")


def run(path, body=None, token=True):
    return asyncio.run(call(f"/api/v1/devtools/{path}", body, token))


XSD = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="n" type="xs:int"/></xs:schema>'
XSL = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="html"/><xsl:template match="/"><p><xsl:value-of select="sum(//b)"/></p></xsl:template></xsl:stylesheet>'

s, r = run("dns", {"host": "example.com"}, token=False)
check("auth required", s in (401, 403), s)

s, r = run("dns", {"host": "https://www.github.com/x", "types": ["A", "MX", "NS", "TXT"]})
check("dns: URL accepted, records back", s == 200 and r["host"] == "www.github.com" and r["records"].get("A") is not None, (s, r))
s, r = run("dns", {"host": "gmail.com", "types": ["MX"]})
check("mx: priorities", s == 200 and r["records"]["MX"] and "priority" in r["records"]["MX"][0], (s, r))
s, r = run("dns", {"host": "this-domain-does-not-exist-9f3k2.com"})
check("dns: unknown domain is a clear 400", s == 400 and "doesn't exist" in r["detail"], (s, r))
s, r = run("dns", {"host": "not a domain!"})
check("dns: junk rejected", s == 400, (s, r))

s, r = run("reverse", {"ip": "8.8.8.8"})
check("reverse: 8.8.8.8 → dns.google", s == 200 and "dns.google" in r["hostnames"], (s, r))
s, r = run("reverse", {"ip": "nope"})
check("reverse: bad IP rejected", s == 400, (s, r))

s, r = run("port", {"host": "example.com", "port": 443})
check("port: 443 open", s == 200 and r["state"] == "open" and r["service"] == "HTTPS", (s, r))
s, r = run("port", {"host": "example.com", "port": 70000})
check("port: out of range is 422", s == 422, (s, r))

s, r = run("http", {"url": "http://github.com", "method": "HEAD"})
check("http: redirect chain followed", s == 200 and r["status"] == 200 and r["hops"][0]["status"] == 301, (s, r))
s, r = run("http", {"url": "https://example.com", "method": "GET"})
check("http: HTTPS with verified certificate", s == 200 and r["status"] == 200 and "Example Domain" in r["body"], (s, str(r)[:200]))
s, r = run("http", {"url": "https://httpbin.org/post", "method": "POST", "headers": [["Content-Type", "application/json"]], "body": '{"a": 1}'})
check("http: POST with body (API tester)", s == 200 and r["status"] == 200 and '"a": 1' in r["body"], (s, str(r)[:200]))

for bad in ["http://127.0.0.1:8000/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://localhost/", "http://[::1]/", "http://2130706433/", "http://0x7f000001/"]:
    s, r = run("http", {"url": bad})
    check(f"ssrf blocked: {bad}", s in (400, 422), (s, r))
# A public server answering with a redirect into the private network (simulated: public
# redirectors now refuse to do this themselves). Every hop must be checked, so this is refused.
import urllib3  # noqa: E402


class _Redirect:
    status, reason, version = 302, "Found", 11
    headers = {"Location": "http://127.0.0.1:8000/admin"}

    def read(self, *a, **k):
        return b""

    def release_conn(self):
        pass


_real = urllib3.HTTPSConnectionPool.urlopen
urllib3.HTTPSConnectionPool.urlopen = lambda self, *a, **k: _Redirect()
try:
    s, r = run("http", {"url": "https://example.com/go"})
finally:
    urllib3.HTTPSConnectionPool.urlopen = _real
check("ssrf: redirect into a private address blocked", s == 400 and "Private" in r["detail"], (s, r))
s, r = run("port", {"host": "127.0.0.1", "port": 22})
check("ssrf: port check on loopback blocked", s == 400, (s, r))

s, r = run("xsd", {"xml": "<n>5</n>", "xsd": XSD})
check("xsd: valid", s == 200 and r["valid"], (s, r))
s, r = run("xsd", {"xml": "<n>five</n>", "xsd": XSD})
check("xsd: invalid with a reason", s == 200 and not r["valid"] and "five" in r["errors"][0]["message"], (s, r))
s, r = run("xsd", {"xml": '<!DOCTYPE n [<!ENTITY x SYSTEM "file:///etc/passwd">]><n>&x;</n>', "xsd": XSD})
check("xsd: entities refused", s == 400, (s, r))

s, r = run("xslt", {"xml": "<a><b>2</b><b>3</b></a>", "xsl": XSL})
check("xslt: transform", s == 200 and r["ok"] and "<p>5</p>" in r["output"] and r["html"], (s, r))
evil = XSL.replace('sum(//b)', "document('file:///etc/passwd')")
s, r = run("xslt", {"xml": "<a/>", "xsl": evil})
check("xslt: file access denied", s == 200 and not r["ok"], (s, r))
s, r = run("xslt", {"xml": "<a>", "xsl": XSL})
check("xslt: malformed XML explained", s == 200 and not r["ok"] and "well-formed" in r["error"], (s, r))

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
