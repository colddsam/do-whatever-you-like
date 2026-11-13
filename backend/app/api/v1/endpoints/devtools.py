"""
Developer and network tools (JSON in, JSON out), for the parts a browser can't do itself.

POST /devtools/dns      — DNS records (A, AAAA, CNAME, MX, NS, TXT, SOA, CAA, SRV) via public resolvers
POST /devtools/reverse  — reverse DNS (PTR) for an IP
POST /devtools/port     — is a TCP port open on a public host
POST /devtools/http     — one HTTP request to a public address (headers, status, body, redirect chain)
POST /devtools/xsd      — validate XML against an XSD schema
POST /devtools/xslt     — transform XML with an XSLT 1.0 stylesheet (browsers are dropping built-in XSLT)
"""

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app.schemas.devtools import DnsRequest, HttpRequest, PortRequest, ReverseRequest, XsdRequest, XsltRequest
from app.services import devtools

router = APIRouter(prefix="/devtools", tags=["Developer tools"])


@router.post("/dns", summary="DNS records for a domain")
async def dns(req: DnsRequest):
    return await run_in_threadpool(devtools.dns_lookup, req.host, [t.upper() for t in req.types])


@router.post("/reverse", summary="The hostname behind an IP address (PTR)")
async def reverse(req: ReverseRequest):
    return await run_in_threadpool(devtools.reverse_dns, req.ip)


@router.post("/port", summary="Is this TCP port open on a public host")
async def port(req: PortRequest):
    return await run_in_threadpool(devtools.check_port, req.host, req.port)


@router.post("/http", summary="Send one HTTP request to a public address")
async def http(req: HttpRequest):
    return await run_in_threadpool(devtools.http_request, req.url, req.method, req.headers, req.body, req.follow)


@router.post("/xsd", summary="Validate XML against an XSD schema")
async def xsd(req: XsdRequest):
    return await run_in_threadpool(devtools.validate_xsd, req.xml, req.xsd)


@router.post("/xslt", summary="Transform XML with an XSLT 1.0 stylesheet")
async def xslt(req: XsltRequest):
    return await run_in_threadpool(devtools.transform_xslt, req.xml, req.xsl)
