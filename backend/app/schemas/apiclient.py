from typing import List, Optional, Tuple

from pydantic import BaseModel, Field


class NtlmCredentials(BaseModel):
    username: str = Field(..., min_length=1, max_length=256)
    password: str = Field(default="", max_length=256)
    domain: str = Field(default="", max_length=256)
    workstation: str = Field(default="", max_length=256)


class SendRequest(BaseModel):
    """One HTTP request, fully built by the browser (variables, auth and body already applied)."""

    method: str = Field(default="GET", min_length=1, max_length=24, examples=["GET"])
    url: str = Field(..., min_length=3, max_length=8192, examples=["https://httpbin.org/anything"])
    headers: List[Tuple[str, str]] = Field(default_factory=list, max_length=300)
    body_b64: Optional[str] = Field(default=None, max_length=4_200_000, description="Request body, base64")
    follow_redirects: bool = True
    follow_original_method: bool = False
    follow_auth_header: bool = False
    max_redirects: int = Field(default=10, ge=0, le=50)
    timeout_ms: int = Field(default=30_000, ge=100, le=600_000)
    verify_ssl: bool = True
    ntlm: Optional[NtlmCredentials] = None


class GrpcRequest(BaseModel):
    """A gRPC call over HTTP/2: messages are already protobuf-encoded by the browser."""

    url: str = Field(..., min_length=3, max_length=2048, examples=["grpcb.in:9001"])
    path: str = Field(..., min_length=3, max_length=512, examples=["/grpcbin.GRPCBin/DummyUnary"])
    tls: bool = True
    verify_ssl: bool = True
    metadata: List[Tuple[str, str]] = Field(default_factory=list, max_length=100)
    messages_b64: List[str] = Field(default_factory=list, max_length=200)
    timeout_ms: int = Field(default=20_000, ge=100, le=600_000)
