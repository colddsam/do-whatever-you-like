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
