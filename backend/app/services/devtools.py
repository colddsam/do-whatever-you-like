"""
Developer and network tools that can't run in a browser: DNS lookups, reverse DNS, an open-port
check, HTTP headers/status, an API tester, and XSD validation.

Safety: every outbound connection goes only to public addresses. A host is resolved once, every
address it resolves to must be public, and the connection is then pinned to that checked address
(so a DNS answer can't change between the check and the request). Timeouts and size caps keep each
call short and small.
"""

import ipaddress
import logging
import re
import socket
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from app.config.devtools import settings
from app.exceptions.devtools import DevtoolsProcessingError, InvalidDevtoolsInputError

logger = logging.getLogger(__name__)

RECORD_TYPES = ("A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA", "SRV", "PTR")
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
BLOCKED_HEADERS = {"host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization", "te", "trailer"}


def _resolver():
    import dns.resolver

    r = dns.resolver.Resolver(configure=False)
    r.nameservers = settings.NAMESERVERS
    r.lifetime = settings.DNS_TIMEOUT
    r.timeout = settings.DNS_TIMEOUT / 2
    return r


def clean_host(text: str) -> str:
    """'https://www.example.com/path' → 'www.example.com'. Rejects anything that isn't a hostname or IP."""
    t = (text or "").strip()
    if "://" in t:
        t = urlparse(t).hostname or ""
    t = t.split("/")[0].split(":")[0].strip(".").lower() if t.count(":") < 2 else t.strip("[]")
    if not t or len(t) > 253:
        raise InvalidDevtoolsInputError("Type a domain like example.com, or an IP address.")
    try:
        ipaddress.ip_address(t)
        return t
    except ValueError:
        pass
    labels = t.split(".")
    if len(labels) < 2 or not all(l and len(l) <= 63 and all(c.isalnum() or c == "-" for c in l) and not l.startswith("-") for l in labels):
        raise InvalidDevtoolsInputError("That isn't a valid domain name.")
    return t.encode("idna").decode("ascii") if not t.isascii() else t


def dns_lookup(host: str, types: List[str]) -> Dict[str, Any]:
    import dns.exception
    import dns.resolver

    host = clean_host(host)
    r = _resolver()
    started = time.monotonic()
    out: Dict[str, List[Dict[str, Any]]] = {}
    for rtype in types:
        if rtype not in RECORD_TYPES or rtype == "PTR":
            continue
        try:
            ans = r.resolve(host, rtype, raise_on_no_answer=False)
        except dns.resolver.NXDOMAIN:
            raise InvalidDevtoolsInputError(f"{host} doesn't exist (no such domain).")
        except (dns.resolver.NoNameservers, dns.exception.Timeout):
            out[rtype] = []
            continue
        recs = []
        for rd in ans or []:
            ttl = ans.rrset.ttl if ans.rrset is not None else None
            if rtype == "MX":
                ex = str(rd.exchange).rstrip(".")
                recs.append({"value": ex or "(null MX: this domain accepts no email)", "priority": rd.preference, "ttl": ttl})
            elif rtype == "TXT":
                recs.append({"value": b"".join(rd.strings).decode("utf-8", "replace"), "ttl": ttl})
            elif rtype == "SOA":
                recs.append({"value": f"{str(rd.mname).rstrip('.')} {str(rd.rname).rstrip('.')} serial {rd.serial}", "ttl": ttl})
            elif rtype == "SRV":
                recs.append({"value": f"{str(rd.target).rstrip('.')}:{rd.port}", "priority": rd.priority, "ttl": ttl})
            else:
                recs.append({"value": rd.to_text().rstrip("."), "ttl": ttl})
        out[rtype] = sorted(recs, key=lambda x: (x.get("priority", 0), x["value"]))
    return {"host": host, "records": out, "ms": round((time.monotonic() - started) * 1000)}


def reverse_dns(ip: str) -> Dict[str, Any]:
    import dns.exception
    import dns.resolver
    import dns.reversename

    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        raise InvalidDevtoolsInputError("Type an IP address like 8.8.8.8 or 2606:4700:4700::1111.")
    try:
        ans = _resolver().resolve(dns.reversename.from_address(str(addr)), "PTR")
        names = [str(r).rstrip(".") for r in ans]
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        names = []
    except (dns.resolver.NoNameservers, dns.exception.Timeout):
        raise DevtoolsProcessingError("The DNS servers didn't answer in time. Try again.")
    return {"ip": str(addr), "hostnames": names, "public": addr.is_global}


def _public_addresses(host: str, port: int) -> List[str]:
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise InvalidDevtoolsInputError(f"{host} couldn't be found. Check the spelling.")
    ips = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise InvalidDevtoolsInputError("Private, local and reserved addresses can't be checked from here.")
        ips.append(str(ip))
    # IPv4 first: many networks (and free hosts) have no IPv6 route, which would only add a timeout.
    return sorted(dict.fromkeys(ips), key=lambda a: ":" in a)


def check_port(host: str, port: int) -> Dict[str, Any]:
    host = clean_host(host)
    if not 1 <= port <= 65535:
        raise InvalidDevtoolsInputError("Ports run from 1 to 65535.")
    ip = _public_addresses(host, port)[0]
    started = time.monotonic()
    try:
        with socket.create_connection((ip, port), timeout=settings.PORT_TIMEOUT):
            state = "open"
    except socket.timeout:
        state = "filtered"
    except ConnectionRefusedError:
        state = "closed"
    except OSError:
        state = "closed"
    return {"host": host, "ip": ip, "port": port, "state": state, "ms": round((time.monotonic() - started) * 1000), "service": KNOWN_PORTS.get(port)}


KNOWN_PORTS = {21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3", 143: "IMAP", 443: "HTTPS", 465: "SMTPS",
               587: "SMTP submission", 993: "IMAPS", 995: "POP3S", 1433: "SQL Server", 3306: "MySQL", 3389: "Remote Desktop",
               5432: "PostgreSQL", 6379: "Redis", 8080: "HTTP alternate", 8443: "HTTPS alternate", 27017: "MongoDB"}


def http_request(url: str, method: str = "GET", headers: Optional[List[Tuple[str, str]]] = None, body: Optional[str] = None, follow: bool = True) -> Dict[str, Any]:
    """One HTTP request to a public address, pinned to the checked IP; redirects followed hop by hop, each checked."""
    import certifi
    import urllib3

    method = method.upper()
    if method not in METHODS:
        raise InvalidDevtoolsInputError("Pick GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS.")
    url = (url or "").strip()
    if "://" not in url:
        url = "https://" + url
    if len(url) > 2048:
        raise InvalidDevtoolsInputError("That address is too long.")
    hdrs = {"User-Agent": "DoWhatever-HTTP-Checker/1.0", "Accept": "*/*"}
    for k, v in headers or []:
        k = k.strip()
        if k and k.lower() not in BLOCKED_HEADERS and len(k) < 200 and len(v) < 4000:
            hdrs[k] = v
    data = body.encode("utf-8") if body else None
    if data and len(data) > settings.MAX_BODY_BYTES:
        raise InvalidDevtoolsInputError("The request body is over 1 MB.")
    hops = []
    started = time.monotonic()
    for _ in range(settings.MAX_REDIRECTS + 1):
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            raise InvalidDevtoolsInputError("Use an address that starts with http:// or https://.")
        host = clean_host(p.hostname)
        port = p.port or (443 if p.scheme == "https" else 80)
        ip = _public_addresses(host, port)[0]
        kw: Dict[str, Any] = {"timeout": urllib3.Timeout(connect=5, read=settings.HTTP_TIMEOUT), "retries": False}
        if p.scheme == "https":
            # certifi's CA bundle: the OS store isn't reliable inside slim containers (or on Windows).
            pool = urllib3.HTTPSConnectionPool(ip, port, server_hostname=host, assert_hostname=host, cert_reqs="CERT_REQUIRED", ca_certs=certifi.where(), **kw)
        else:
            pool = urllib3.HTTPConnectionPool(ip, port, **kw)
        path = (p.path or "/") + (f"?{p.query}" if p.query else "")
        t0 = time.monotonic()
        try:
            resp = pool.urlopen(method, path, body=data, headers={**hdrs, "Host": p.netloc}, redirect=False, preload_content=False)
            raw = resp.read(settings.MAX_RESPONSE_BYTES + 1, decode_content=True)
            resp.release_conn()
        except urllib3.exceptions.SSLError:
            raise DevtoolsProcessingError(f"{host}'s security certificate isn't valid.")
        except (urllib3.exceptions.TimeoutError, urllib3.exceptions.ReadTimeoutError, urllib3.exceptions.ConnectTimeoutError):
            raise DevtoolsProcessingError(f"{host} didn't answer within {settings.HTTP_TIMEOUT} seconds.")
        except urllib3.exceptions.HTTPError as exc:
            raise DevtoolsProcessingError(f"Couldn't connect to {host}: {type(exc).__name__}.")
        finally:
            pool.close()
        hops.append({"url": url, "status": resp.status, "reason": resp.reason, "ms": round((time.monotonic() - t0) * 1000), "ip": ip})
        loc = resp.headers.get("Location")
        if follow and resp.status in (301, 302, 303, 307, 308) and loc:
            from urllib.parse import urljoin

            url = urljoin(url, loc)
            if resp.status == 303 or (resp.status in (301, 302) and method == "POST"):
                method, data = "GET", None
            continue
        truncated = len(raw) > settings.MAX_RESPONSE_BYTES
        text = raw[: settings.MAX_RESPONSE_BYTES].decode(_charset(resp.headers.get("Content-Type", "")), "replace")
        return {
            "url": url,
            "status": resp.status,
            "reason": resp.reason,
            "http_version": {10: "HTTP/1.0", 11: "HTTP/1.1"}.get(resp.version, "HTTP"),
            "headers": [[k, v] for k, v in resp.headers.items()],
            "body": text if method != "HEAD" else "",
            "size": len(raw),
            "truncated": truncated,
            "ms": round((time.monotonic() - started) * 1000),
            "hops": hops,
        }
    raise DevtoolsProcessingError(f"More than {settings.MAX_REDIRECTS} redirects; stopped.")


def _charset(content_type: str) -> str:
    for part in content_type.split(";"):
        k, _, v = part.strip().partition("=")
        if k.lower() == "charset" and v:
            try:
                "".encode(v.strip('"'))
                return v.strip('"')
            except LookupError:
                break
    return "utf-8"


def validate_xsd(xml: str, xsd: str) -> Dict[str, Any]:
    """XML against an XSD schema (lxml/libxml2). No network: external entities and remote schemas are off."""
    from lxml import etree

    if len(xml) > 5_000_000 or len(xsd) > 5_000_000:
        raise InvalidDevtoolsInputError("Each document can be up to 5 MB.")
    if "<!ENTITY" in xml or "<!ENTITY" in xsd:
        raise InvalidDevtoolsInputError("Entity declarations (<!ENTITY>) aren't allowed: they can read files or blow up in size.")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    try:
        schema_doc = etree.fromstring(xsd.encode("utf-8"), parser)
        schema = etree.XMLSchema(schema_doc)
    except etree.XMLSyntaxError as exc:
        return {"valid": False, "stage": "schema", "errors": [{"line": exc.lineno, "column": exc.offset, "message": f"The schema isn't well-formed XML: {exc.msg}"}]}
    except etree.XMLSchemaParseError as exc:
        return {"valid": False, "stage": "schema", "errors": [{"line": e.line, "column": e.column, "message": e.message} for e in exc.error_log] or [{"line": None, "column": None, "message": str(exc)}]}
    try:
        doc = etree.fromstring(xml.encode("utf-8"), parser)
    except etree.XMLSyntaxError as exc:
        return {"valid": False, "stage": "xml", "errors": [{"line": exc.lineno, "column": exc.offset, "message": f"The XML isn't well-formed: {exc.msg}"}]}
    try:
        ok = schema.validate(doc)
    except etree.XMLSchemaValidateError as exc:
        return {"valid": False, "stage": "xml", "errors": [{"line": None, "column": None, "message": f"The XML couldn't be checked: {exc}"}]}
    return {"valid": ok, "stage": "schema", "errors": [{"line": e.line, "column": e.column, "message": e.message} for e in schema.error_log][:200]}


def transform_xslt(xml: str, xsl: str) -> Dict[str, Any]:
    """XSLT 1.0 with lxml (libxslt), locked down: no file or network access, no entities, no extensions."""
    from lxml import etree

    if len(xml) > 5_000_000 or len(xsl) > 5_000_000:
        raise InvalidDevtoolsInputError("Each document can be up to 5 MB.")
    if "<!ENTITY" in xml or "<!ENTITY" in xsl:
        raise InvalidDevtoolsInputError("Entity declarations (<!ENTITY>) aren't allowed: they can read files or blow up in size.")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    try:
        style = etree.fromstring(xsl.encode("utf-8"), parser)
    except etree.XMLSyntaxError as exc:
        return {"ok": False, "error": f"The stylesheet isn't well-formed (line {exc.lineno}): {exc.msg}"}
    try:
        doc = etree.fromstring(xml.encode("utf-8"), parser)
    except etree.XMLSyntaxError as exc:
        return {"ok": False, "error": f"The XML isn't well-formed (line {exc.lineno}): {exc.msg}"}
    try:
        transform = etree.XSLT(style, access_control=etree.XSLTAccessControl.DENY_ALL)
    except etree.XSLTParseError as exc:
        return {"ok": False, "error": f"The stylesheet isn't valid XSLT: {exc}"}
    try:
        result = transform(doc)
    except etree.XSLTApplyError as exc:
        return {"ok": False, "error": f"The transform failed: {exc}"}
    out = str(result)
    html = bool(re.search(r"<xsl:output[^>]*method=[\"']html", xsl)) or out.lstrip().lower().startswith(("<html", "<!doctype html"))
    if len(out) > settings.MAX_RESPONSE_BYTES * 4:
        raise DevtoolsProcessingError("The output is over 4 MB.")
    return {"ok": True, "output": out, "html": html, "messages": [str(e.message) for e in transform.error_log][:50]}


_HANDLE_UA = "Mozilla/5.0 (compatible; DoWhateverYouLike-HandleCheck/1.0)"
_DOMAIN_TLDS = {
    "domain_com": "com",
    "domain_dev": "dev",
    "domain_io": "io",
    "domain_in": "in",
}
_MAIL_DOMAINS = {
    "gmail": "gmail.com",
    "outlook": "outlook.com",
    "proton_me": "proton.me",
    "icloud": "icloud.com",
    "yahoo": "yahoo.com",
}


def _http_probe(url: str, timeout: float = 3.5, accept: str = "application/json,text/html,*/*") -> Tuple[int, str]:
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": _HANDLE_UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(8192).decode("utf-8", "replace")
            return resp.status, body
    except urllib.error.HTTPError as err:
        body = err.read(4096).decode("utf-8", "replace")
        return err.code, body
    except Exception:
        return 0, ""


_IG_SEMAPHORE = threading.Semaphore(2)
_FB_SEMAPHORE = threading.Semaphore(1)
_TT_SEMAPHORE = threading.Semaphore(1)
_RD_SEMAPHORE = threading.Semaphore(1)
_IG_STATE_LOCK = threading.Lock()
_IG_CANARY_PROBE_LOCK = threading.Lock()
_TT_STATE_LOCK = threading.Lock()
_RD_STATE_LOCK = threading.Lock()
_IG_CANARY_STATE: Dict[str, Any] = {
    "healthy": None,
    "checked_at": 0.0,
    "cooldown_until": 0.0,
}
_TT_UNREACHABLE_UNTIL: float = 0.0
_RD_AVAIL_COOLDOWN_UNTIL: float = 0.0
_RD_RSS_COOLDOWN_UNTIL: float = 0.0
_RD_OAUTH_CACHE: Dict[str, Any] = {"token": None, "expires_at": 0.0}

_FB_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def _new_anonymous_instaloader():
    import instaloader

    # Strictly cookie-free: fresh context, zero cookie/session files loaded, single request attempt.
    loader = instaloader.Instaloader(
        quiet=True,
        sleep=False,
        max_connection_attempts=1,
        request_timeout=9.0,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
    )
    loader.context._session.cookies.clear()
    loader.context._session.headers.setdefault("Accept-Language", "en-US,en;q=0.9")
    return loader


def _probe_ig_html_profile_headers(clean: str) -> Optional[bool]:
    """
    Lightweight cookie-free HTML probe for an Instagram handle.
    Returns True if occupied, False if public 200 without user payload, or None if blocked/uncertain.
    """
    import requests

    target = f"https://www.instagram.com/{clean}/"
    header_sets = (
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        },
        {
            "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    user_re = re.compile(rf'"username"\s*:\s*"{re.escape(clean)}"', re.I)
    og_re = re.compile(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']*)["\']', re.I)
    lower_clean = clean.lower()

    for headers in header_sets:
        try:
            with requests.Session() as sess:
                sess.cookies.clear()
                resp = sess.get(target, headers=headers, timeout=7.5, allow_redirects=False)
            location = (resp.headers.get("location") or "").lower()
            if resp.status_code in (403, 429) or (300 <= resp.status_code < 400) or "login" in location:
                continue
            if resp.status_code != 200:
                continue
            html = resp.text or ""
            if "login" in resp.url.lower():
                continue
            og_match = og_re.search(html)
            og_text = (og_match.group(1) if og_match else "").lower()
            if (
                "xig_user_by_username" in html
                or user_re.search(html)
                or f"@{lower_clean}" in og_text
                or f"&#064;{lower_clean}" in og_text
            ):
                return True
            if html:
                return False
        except Exception:
            continue
    return None


def _verify_ig_anonymous_healthy() -> bool:
    """Confirm Instagram is not soft-404ing every anonymous lookup before reporting a handle as available."""
    import instaloader

    now = time.monotonic()
    with _IG_STATE_LOCK:
        if now < _IG_CANARY_STATE["cooldown_until"]:
            return False
        if _IG_CANARY_STATE["healthy"] is True and (now - _IG_CANARY_STATE["checked_at"]) < 30.0:
            return True

    with _IG_CANARY_PROBE_LOCK:
        now = time.monotonic()
        with _IG_STATE_LOCK:
            if now < _IG_CANARY_STATE["cooldown_until"]:
                return False
            if _IG_CANARY_STATE["healthy"] is True and (now - _IG_CANARY_STATE["checked_at"]) < 30.0:
                return True

        healthy = False
        loader = _new_anonymous_instaloader()
        try:
            instaloader.Profile.from_username(loader.context, "instagram")
            healthy = True
        except Exception:
            healthy = _probe_ig_html_profile_headers("instagram") is True

        now = time.monotonic()
        with _IG_STATE_LOCK:
            if healthy:
                _IG_CANARY_STATE["healthy"] = True
                _IG_CANARY_STATE["checked_at"] = now
                _IG_CANARY_STATE["cooldown_until"] = 0.0
            else:
                _IG_CANARY_STATE["healthy"] = False
                _IG_CANARY_STATE["checked_at"] = now
                _IG_CANARY_STATE["cooldown_until"] = now + 12.0
        return healthy


def _probe_instagram_html_no_cookies(clean: str, url: str, out) -> Optional[Dict[str, Any]]:
    """Fallback cookie-free Instagram profile probe when Instaloader hits cooldown or login redirect."""
    signal = _probe_ig_html_profile_headers(clean)
    if signal is True:
        return out(
            "occupied",
            f"@{clean} is occupied on Instagram (cookie-free public profile check)",
            url,
        )
    if signal is False and clean.lower() != "instagram" and _verify_ig_anonymous_healthy():
        return out(
            "available",
            "No active public Instagram profile found (cookie-free check) — click link to confirm signup",
            url,
        )
    return None


def _probe_instagram_no_cookies(clean: str, url: str, out) -> Dict[str, Any]:
    import instaloader
    from instaloader.exceptions import (
        ConnectionException,
        LoginRequiredException,
        ProfileNotExistsException,
        TooManyRequestsException,
    )

    now = time.monotonic()
    with _IG_STATE_LOCK:
        in_cooldown = now < _IG_CANARY_STATE["cooldown_until"]

    if in_cooldown:
        with _IG_SEMAPHORE:
            fallback = _probe_instagram_html_no_cookies(clean, url, out)
            if fallback is not None:
                return fallback
        return out(
            "unverified",
            "Instagram temporarily rate-limited anonymous lookups — click link to confirm",
            url,
        )

    with _IG_SEMAPHORE:
        loader = _new_anonymous_instaloader()
        try:
            profile = instaloader.Profile.from_username(loader.context, clean)
            handle = getattr(profile, "username", None) or clean
            return out(
                "occupied",
                f"@{handle} is occupied on Instagram (cookie-free Instaloader check)",
                url,
            )
        except ProfileNotExistsException as exc:
            if "seems to exist" in str(exc).lower():
                return out(
                    "occupied",
                    f"@{clean} exists on Instagram (cookie-free Instaloader check)",
                    url,
                )
            # Instagram sometimes returns ErrorRoot shells even for @instagram when throttling unauthenticated IPs.
            if clean.lower() != "instagram" and _verify_ig_anonymous_healthy():
                return out(
                    "available",
                    "No active public Instagram profile found (cookie-free Instaloader) — click link to confirm signup",
                    url,
                )
            fallback = _probe_instagram_html_no_cookies(clean, url, out)
            if fallback is not None:
                return fallback
            return out(
                "unverified",
                "Instagram rate-limited anonymous lookups without cookies — click link to confirm",
                url,
            )
        except (LoginRequiredException, TooManyRequestsException, ConnectionException):
            now = time.monotonic()
            with _IG_STATE_LOCK:
                _IG_CANARY_STATE["healthy"] = False
                _IG_CANARY_STATE["checked_at"] = now
                _IG_CANARY_STATE["cooldown_until"] = now + 12.0
            fallback = _probe_instagram_html_no_cookies(clean, url, out)
            if fallback is not None:
                return fallback
            return out(
                "unverified",
                "Instagram requested login or rate-limit cooldown without cookies — click link to confirm",
                url,
            )
        except Exception:
            fallback = _probe_instagram_html_no_cookies(clean, url, out)
            if fallback is not None:
                return fallback
            return out(
                "unverified",
                "Could not confirm Instagram anonymously right now — click link to verify",
                url,
            )


def _extract_facebook_html_signal(page_url: str) -> Tuple[str, str, str]:
    """
    Cookie-free anonymous Facebook HTML probe using browser navigation headers.
    Returns ('occupied' | 'unverified', canonical_url, label).
    """
    import html as html_lib
    import requests

    try:
        resp = requests.get(
            page_url,
            headers=_FB_BROWSER_HEADERS,
            timeout=4.0,
            allow_redirects=True,
        )
    except Exception:
        return "unverified", page_url, ""

    final_url = resp.url or page_url
    low_url = final_url.lower()
    if "/login" in low_url or "/checkpoint" in low_url or resp.status_code != 200:
        return "unverified", page_url, ""

    text = resp.text[:350_000]
    low = text.lower()
    unavailable_markers = (
        "this content isn't available",
        "this content isn&#039;t available",
        "this page isn't available",
        "this page isn&#039;t available",
        "you must log in to continue",
        "log in or sign up to view",
    )
    if any(marker in low for marker in unavailable_markers):
        return "unverified", page_url, ""

    og_match = re.search(
        r'<meta[^>]+(?:property|name)=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
        text,
        re.IGNORECASE,
    ) or re.search(
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:title["\']',
        text,
        re.IGNORECASE,
    )
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", text, re.IGNORECASE)
    entity_match = re.search(r'"(?:pageID|userID|entity_id)"\s*:\s*"?(\d{4,})"?', text)

    label = ""
    if og_match:
        label = html_lib.unescape(og_match.group(1)).strip()
    elif title_match:
        label = html_lib.unescape(title_match.group(1)).strip()

    if label.lower() in {"", "facebook", "log into facebook", "log in to facebook", "error", "watch"}:
        label = ""

    if label or entity_match:
        return "occupied", final_url, label

    return "unverified", page_url, ""


class _SilentYdlLogger:
    """Suppress verbose extractor stderr errors (e.g. Unsupported URL on private/free Facebook handles)."""

    def debug(self, msg: str) -> None:
        return None

    def warning(self, msg: str) -> None:
        return None

    def error(self, msg: str) -> None:
        return None


def _probe_facebook_no_cookies(clean: str, url: str, out) -> Dict[str, Any]:
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "logger": _SilentYdlLogger(),
        "extract_flat": True,
        "skip_download": True,
        "socket_timeout": 3,
        "ignore_no_formats_error": True,
        "noplaylist": True,
    }

    with _FB_SEMAPHORE:
        # 1) Try cookie-free yt-dlp first (reliably resolves public Facebook Pages & creators).
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            if isinstance(info, dict):
                canonical = info.get("webpage_url") or url
                label = (info.get("title") or info.get("uploader") or info.get("channel") or clean).strip()
                return out(
                    "occupied",
                    f"Public Facebook Page/entity found ({label}) via cookie-free yt-dlp",
                    canonical,
                )
        except Exception:
            pass

        # 2) Fallback: cookie-free public HTML metadata check catches public personal profiles too.
        hint, canonical, label = _extract_facebook_html_signal(url)
        if hint == "occupied":
            suffix = f" ({label})" if label else ""
            return out(
                "occupied",
                f"Public Facebook profile/page found{suffix} without cookies",
                canonical,
            )

        # Private/locked Facebook accounts and truly free handles render identically without login.
        return out(
            "unverified",
            "No public Page matched via cookie-free yt-dlp (may be free or a private profile — click link to confirm)",
            url,
        )


def _probe_x_no_cookies(clean: str, url: str, out) -> Dict[str, Any]:
    import requests
    from urllib.parse import quote

    try:
        resp = requests.get(
            "https://api.twitter.com/i/users/username_available.json",
            params={"username": clean},
            headers={
                "User-Agent": _FB_BROWSER_HEADERS["User-Agent"],
                "Accept": "application/json",
            },
            timeout=4.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            reason = str(data.get("reason") or "")
            if data.get("valid") is True or reason == "available":
                return out("available", "Available on X (Twitter)", url)
            if reason == "taken":
                return out("occupied", f"@{clean} is already taken on X (Twitter)", url)
            if reason in ("is_banned_word", "contains_banned_word"):
                return out("occupied", "Unavailable or reserved handle on X (Twitter)", url)
            if reason == "invalid_username":
                return out("invalid", data.get("desc") or "Invalid X handle format", url)
    except Exception:
        pass

    # Secondary public oEmbed lookup (cookie-free) if signup API is momentarily unavailable.
    try:
        oembed = requests.get(
            f"https://publish.twitter.com/oembed?url={quote(f'https://twitter.com/{clean}', safe='')}",
            headers={"User-Agent": _FB_BROWSER_HEADERS["User-Agent"], "Accept": "application/json"},
            timeout=3.5,
        )
        if oembed.status_code == 200:
            return out("occupied", f"@{clean} exists on X (Twitter)", url)
    except Exception:
        pass

    return out("unverified", "Could not confirm X availability right now — click link to check", url)


def _parse_tiktok_rehydration(html_text: str, url: str, out) -> Optional[Dict[str, Any]]:
    import json

    match = re.search(
        r'<script[^>]+id=["\']__UNIVERSAL_DATA_FOR_REHYDRATION__["\'][^>]*>(.*?)</script>',
        html_text,
        re.DOTALL | re.IGNORECASE,
    )
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
        detail = payload.get("__DEFAULT_SCOPE__", {}).get("webapp.user-detail", {})
        status_code = detail.get("statusCode")
        user_obj = detail.get("userInfo", {}).get("user", {})
        if status_code == 0 and isinstance(user_obj, dict) and user_obj.get("id"):
            uid = user_obj.get("uniqueId") or ""
            label = f"@{uid}" if uid else "TikTok account"
            return out("occupied", f"{label} exists on TikTok (cookie-free public check)", url)
        if status_code in (10221, 10202):
            return out(
                "available",
                "No active TikTok profile found (cookie-free check) — click link to confirm signup",
                url,
            )
    except Exception:
        pass
    return None


def _probe_tiktok_no_cookies(clean: str, url: str, out) -> Dict[str, Any]:
    global _TT_UNREACHABLE_UNTIL
    import requests
    import yt_dlp

    now = time.monotonic()
    with _TT_STATE_LOCK:
        if now < _TT_UNREACHABLE_UNTIL:
            return out(
                "unverified",
                "TikTok is unreachable from this network region (works on Vercel/Render US & EU) — click link to confirm",
                url,
            )

    with _TT_SEMAPHORE:
        with _TT_STATE_LOCK:
            if time.monotonic() < _TT_UNREACHABLE_UNTIL:
                return out(
                    "unverified",
                    "TikTok is unreachable from this network region (works on Vercel/Render US & EU) — click link to confirm",
                    url,
                )

        # 1) Cookie-free public page probe parsing __UNIVERSAL_DATA_FOR_REHYDRATION__ (handles private & 0-video accounts too).
        try:
            resp = requests.get(
                url,
                headers=_FB_BROWSER_HEADERS,
                timeout=(1.8, 3.5),
                allow_redirects=True,
            )
            if resp.status_code == 200:
                parsed = _parse_tiktok_rehydration(resp.text[:600_000], url, out)
                if parsed is not None:
                    return parsed
        except (requests.exceptions.ConnectTimeout, requests.exceptions.ConnectionError):
            with _TT_STATE_LOCK:
                _TT_UNREACHABLE_UNTIL = time.monotonic() + 60.0
            return out(
                "unverified",
                "TikTok is unreachable from this network region (works on Vercel/Render US & EU) — click link to confirm",
                url,
            )
        except Exception:
            pass

        # 2) Fallback: cookie-free yt-dlp creator check.
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "logger": _SilentYdlLogger(),
            "extract_flat": True,
            "skip_download": True,
            "playlist_items": "1",
            "socket_timeout": 3,
            "ignore_no_formats_error": True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            if isinstance(info, dict):
                label = (info.get("uploader") or info.get("channel") or clean).strip()
                return out("occupied", f"Public TikTok creator found ({label}) via cookie-free yt-dlp", url)
        except Exception:
            pass

    return out("unverified", "TikTok challenged anonymous probe — click link to verify directly", url)


def _get_reddit_oauth_token() -> Optional[str]:
    import os
    import requests

    client_id = (os.getenv("REDDIT_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("REDDIT_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        return None

    now = time.monotonic()
    with _RD_STATE_LOCK:
        if _RD_OAUTH_CACHE["token"] and now < _RD_OAUTH_CACHE["expires_at"] - 30:
            return _RD_OAUTH_CACHE["token"]

    try:
        resp = requests.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"User-Agent": "web:dwyl.handlecheck:v1.0 (by /u/dwyl_checker)"},
            timeout=4.0,
        )
        if resp.status_code == 200:
            token = resp.json().get("access_token")
            expires_in = float(resp.json().get("expires_in", 3600))
            if token:
                with _RD_STATE_LOCK:
                    _RD_OAUTH_CACHE["token"] = token
                    _RD_OAUTH_CACHE["expires_at"] = time.monotonic() + expires_in
                return token
    except Exception:
        pass
    return None


def _probe_reddit_no_cookies(clean: str, url: str, out) -> Dict[str, Any]:
    global _RD_AVAIL_COOLDOWN_UNTIL, _RD_RSS_COOLDOWN_UNTIL
    import requests
    from urllib.parse import quote

    # 1) Optional official free app-only OAuth check if credentials exist in env.
    token = _get_reddit_oauth_token()
    if token:
        try:
            r = requests.get(
                "https://oauth.reddit.com/api/username_available",
                params={"user": clean},
                headers={
                    "Authorization": f"Bearer {token}",
                    "User-Agent": "web:dwyl.handlecheck:v1.0 (by /u/dwyl_checker)",
                },
                timeout=3.5,
            )
            if r.status_code == 200:
                txt = r.text.strip()
                if txt == "true":
                    return out("available", "Available on Reddit", url)
                if txt == "false":
                    return out("occupied", "Occupied on Reddit", url)
        except Exception:
            pass

    # 2) Direct unauthenticated username_available JSON endpoint (cooldown when WAF returns 403/429).
    with _RD_STATE_LOCK:
        avail_cooldown = time.monotonic() < _RD_AVAIL_COOLDOWN_UNTIL
    if not avail_cooldown:
        try:
            r = requests.get(
                f"https://www.reddit.com/api/username_available.json?user={quote(clean, safe='')}",
                headers={"User-Agent": _FB_BROWSER_HEADERS["User-Agent"], "Accept": "application/json"},
                timeout=3.5,
            )
            if r.status_code == 200:
                txt = r.text.strip()
                if txt == "true":
                    return out("available", "Available on Reddit", url)
                if txt == "false":
                    return out("occupied", "Occupied on Reddit", url)
            elif r.status_code in (403, 429):
                with _RD_STATE_LOCK:
                    _RD_AVAIL_COOLDOWN_UNTIL = time.monotonic() + 60.0
        except Exception:
            pass

    # 3) Direct Atom RSS feed check (200 = existing feed, 404 = user missing) while avoiding 429 bursts.
    with _RD_STATE_LOCK:
        rss_cooldown = time.monotonic() < _RD_RSS_COOLDOWN_UNTIL
    if not rss_cooldown:
        with _RD_SEMAPHORE:
            with _RD_STATE_LOCK:
                rss_cooldown = time.monotonic() < _RD_RSS_COOLDOWN_UNTIL
            if not rss_cooldown:
                try:
                    r = requests.get(
                        f"https://www.reddit.com/user/{quote(clean, safe='')}/.rss",
                        headers={
                            "User-Agent": "desktop:dwyl.handlecheck:v1.0 (by /u/dwyl_checker)",
                            "Accept": "application/atom+xml,application/xml,text/xml",
                        },
                        timeout=3.5,
                    )
                    body_head = r.text[:300]
                    if r.status_code == 200 and "<feed" in body_head:
                        return out("occupied", f"u/{clean} is active on Reddit", url)
                    if r.status_code == 404 and "<feed" in body_head:
                        return out("available", "Available on Reddit", url)
                    if r.status_code == 429:
                        with _RD_STATE_LOCK:
                            _RD_RSS_COOLDOWN_UNTIL = time.monotonic() + 60.0
                except Exception:
                    pass

    # 4) Public Reddit archive fallback (Arctic Shift) when Reddit blocks datacenter/IP requests with 403/429.
    try:
        arch = requests.get(
            "https://arctic-shift.photon-reddit.com/api/users/search",
            params={"author": clean},
            headers={"Accept": "application/json", "User-Agent": _HANDLE_UA},
            timeout=4.0,
        )
        if arch.status_code == 200:
            rows = arch.json().get("data") or []
            if any(str(row.get("author") or row.get("name") or "").lower() == clean.lower() for row in rows):
                return out("occupied", f"Matched active Reddit history for u/{clean} (public archive check)", url)
    except Exception:
        pass

    return out(
        "unverified",
        "Reddit blocked live checks from this IP & no public post history matched (may be free or non-posting account) — click link to confirm",
        url,
    )


def _probe_single_handle(username: str, service_id: str) -> Dict[str, Any]:
    import hashlib
    import json
    from urllib.parse import quote

    started = time.monotonic()
    clean = username.strip().lstrip("@")
    lower = clean.lower()
    u_enc = quote(clean, safe="")
    l_enc = quote(lower, safe="")

    def out(status: str, detail: str, url: str = "") -> Dict[str, Any]:
        return {
            "serviceId": service_id,
            "username": clean,
            "status": status,
            "detail": detail,
            "url": url,
            "latencyMs": round((time.monotonic() - started) * 1000),
        }

    if service_id in _DOMAIN_TLDS:
        domain = f"{lower}.{_DOMAIN_TLDS[service_id]}"
        status, body = _http_probe(f"https://dns.google/resolve?name={quote(domain)}&type=NS", accept="application/json")
        if status == 200:
            try:
                data = json.loads(body)
                if data.get("Status") == 3:
                    return out("available", f"{domain} returned NXDOMAIN — likely available", f"https://{domain}")
                if data.get("Status") == 0:
                    return out("occupied", f"{domain} is already registered", f"https://{domain}")
            except Exception:
                pass
        return out("unverified", f"Could not reach DNS resolver for {domain}", f"https://{domain}")

    if service_id == "mail_ru":
        email = f"{lower}@mail.ru"
        status, body = _http_probe(f"https://account.mail.ru/api/v1/user/exists?email={quote(email)}")
        if status == 200:
            try:
                exists = json.loads(body).get("body", {}).get("exists")
                if exists is True:
                    return out("occupied", f"{email} is already registered", "https://account.mail.ru/signup")
                if exists is False:
                    return out("available", f"{email} is available", "https://account.mail.ru/signup")
            except Exception:
                pass
        return out("unverified", "Mail.ru probe throttled", "https://account.mail.ru/signup")

    if service_id in _MAIL_DOMAINS:
        email = f"{lower}@{_MAIL_DOMAINS[service_id]}"
        digest = hashlib.sha256(email.encode("utf-8")).hexdigest()
        g_code, _ = _http_probe(f"https://en.gravatar.com/{digest}.json", timeout=2.8, accept="application/json")
        if g_code == 200:
            return out("occupied", f"Matched an existing public Gravatar profile for {email}")
        p_code, _ = _http_probe(f"https://keys.openpgp.org/vks/v1/by-email/{quote(email)}", timeout=2.8, accept="text/plain")
        if p_code == 200:
            return out("occupied", f"Matched a registered OpenPGP key for {email}")
        return out("unclaimed_registry", f"Valid handle & unclaimed in public key registries for {email}")

    url_map = {
        "github": (f"https://github.com/{u_enc}", "GitHub"),
        "youtube": (f"https://www.youtube.com/@{u_enc}", "YouTube"),
        "huggingface": (f"https://huggingface.co/{u_enc}", "Hugging Face"),
        "devto": (f"https://dev.to/api/users/by_username?url={l_enc}", "DEV Community"),
        "mastodon": (f"https://mastodon.social/api/v1/accounts/lookup?acct={l_enc}", "Mastodon"),
        "crates": (f"https://crates.io/api/v1/users/{l_enc}", "crates.io"),
        "rubygems": (f"https://rubygems.org/api/v1/profiles/{l_enc}.json", "RubyGems"),
        "dockerhub": (f"https://hub.docker.com/v2/users/{l_enc}/", "Docker Hub"),
        "chess": (f"https://api.chess.com/pub/player/{l_enc}", "Chess.com"),
        "lichess": (f"https://lichess.org/api/user/{l_enc}", "Lichess"),
        "scratch": (f"https://api.scratch.mit.edu/users/{u_enc}", "Scratch"),
    }

    if service_id in url_map:
        probe_url, label = url_map[service_id]
        code, _ = _http_probe(probe_url)
        if code == 404:
            return out("available", f"Available on {label}", probe_url)
        if code == 200:
            return out("occupied", f"Claimed on {label}", probe_url)
        return out("unverified", f"Could not confirm {label} right now", probe_url)

    if service_id == "bluesky":
        code, body = _http_probe(f"https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={l_enc}.bsky.social")
        if code == 200:
            return out("occupied", f"{lower}.bsky.social is active", f"https://bsky.app/profile/{l_enc}.bsky.social")
        if code == 400 and "Profile not found" in body:
            return out("available", f"{lower}.bsky.social is available", f"https://bsky.app/profile/{l_enc}.bsky.social")

    if service_id == "gitlab":
        code, body = _http_probe(f"https://gitlab.com/api/v4/users?username={l_enc}")
        if code == 200:
            if body.strip() == "[]":
                return out("available", "Available on GitLab", f"https://gitlab.com/{u_enc}")
            if body.strip().startswith("[{"):
                return out("occupied", "Claimed on GitLab", f"https://gitlab.com/{u_enc}")

    if service_id == "hackernews":
        code, body = _http_probe(f"https://hacker-news.firebaseio.com/v0/user/{u_enc}.json")
        if code == 200:
            if body.strip() == "null":
                return out("available", "Available on Hacker News", f"https://news.ycombinator.com/user?id={u_enc}")
            if body.strip().startswith("{"):
                return out("occupied", "Claimed on Hacker News", f"https://news.ycombinator.com/user?id={u_enc}")

    if service_id == "npm":
        code, body = _http_probe(f"https://registry.npmjs.org/-/v1/search?text=maintainer:{l_enc}&size=1")
        if code == 200:
            try:
                total = json.loads(body).get("total", -1)
                if total == 0:
                    return out("available", "No npm maintainer packages under this handle", f"https://www.npmjs.com/~{l_enc}")
                if isinstance(total, int) and total > 0:
                    return out("occupied", "Active npm maintainer handle found", f"https://www.npmjs.com/~{l_enc}")
            except Exception:
                pass

    if service_id == "instagram":
        return _probe_instagram_no_cookies(clean, f"https://www.instagram.com/{u_enc}/", out)

    if service_id == "facebook":
        return _probe_facebook_no_cookies(clean, f"https://www.facebook.com/{u_enc}", out)

    if service_id == "x":
        return _probe_x_no_cookies(clean, f"https://x.com/{u_enc}", out)

    if service_id == "tiktok":
        return _probe_tiktok_no_cookies(clean, f"https://www.tiktok.com/@{u_enc}", out)

    if service_id == "reddit":
        return _probe_reddit_no_cookies(clean, f"https://www.reddit.com/user/{u_enc}", out)

    if service_id == "minecraft":
        code, _ = _http_probe(f"https://api.mojang.com/users/profiles/minecraft/{u_enc}")
        if code in (204, 404):
            return out("available", "Available on Minecraft Java", f"https://namemc.com/profile/{u_enc}")
        if code == 200:
            return out("occupied", "Minecraft Java IGN is taken", f"https://namemc.com/profile/{u_enc}")

    return out("unverified", "Check directly on platform")


def check_usernames(usernames: List[str], services: List[str]) -> Dict[str, Any]:
    """Concurrent zero-key social media & email handle availability probe."""
    from concurrent.futures import ThreadPoolExecutor

    clean_names = [u.strip().lstrip("@") for u in usernames if u and u.strip()][:8]
    clean_services = [s.strip() for s in services if s and s.strip()][:35]
    if not clean_names or not clean_services:
        raise InvalidDevtoolsInputError("Provide at least one username and one service.")

    tasks = [(u, s) for u in clean_names for s in clean_services]
    by_name: Dict[str, List[Dict[str, Any]]] = {u: [] for u in clean_names}
    with ThreadPoolExecutor(max_workers=min(6, max(2, len(tasks)))) as pool:
        for res in pool.map(lambda pair: _probe_single_handle(pair[0], pair[1]), tasks):
            by_name[res["username"]].append(res)
    return {"results": by_name}
