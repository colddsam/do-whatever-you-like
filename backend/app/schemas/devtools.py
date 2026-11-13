from typing import List, Optional, Tuple

from pydantic import BaseModel, Field


class DnsRequest(BaseModel):
    host: str = Field(..., min_length=1, max_length=300, examples=["example.com"])
    types: List[str] = Field(default_factory=lambda: ["A", "AAAA", "CNAME", "MX", "NS", "TXT"], max_length=10)


class ReverseRequest(BaseModel):
    ip: str = Field(..., min_length=2, max_length=64, examples=["8.8.8.8"])


class PortRequest(BaseModel):
    host: str = Field(..., min_length=1, max_length=300)
    port: int = Field(..., ge=1, le=65535)


class HttpRequest(BaseModel):
    url: str = Field(..., min_length=3, max_length=2048, examples=["https://example.com"])
    method: str = Field(default="GET", max_length=10)
    headers: List[Tuple[str, str]] = Field(default_factory=list, max_length=50)
    body: Optional[str] = Field(default=None, max_length=1_100_000)
    follow: bool = True


class XsdRequest(BaseModel):
    xml: str = Field(..., min_length=1, max_length=5_000_000)
    xsd: str = Field(..., min_length=1, max_length=5_000_000)


class XsltRequest(BaseModel):
    xml: str = Field(..., min_length=1, max_length=5_000_000)
    xsl: str = Field(..., min_length=1, max_length=5_000_000)
