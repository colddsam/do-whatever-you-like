from typing import List, Optional
from pydantic import BaseModel, Field


class ToolRequestPayload(BaseModel):
    idea: str = Field(
        ...,
        min_length=3,
        max_length=1200,
        description="Short description of the tool or improvement requested",
        examples=["Compress MOV videos to under 10 MB for WhatsApp"],
    )
    category: Optional[str] = Field(
        None,
        max_length=60,
        description="Optional tool category hint",
        examples=["Audio & video"],
    )
    reply_to: Optional[str] = Field(
        None,
        max_length=160,
        description="Optional email address if the requester wants a reply",
        examples=["user@example.com"],
    )
    page_url: Optional[str] = Field(
        None,
        max_length=300,
        description="Optional page URL where the request originated",
        examples=["https://do-whatever-you-like.colddsam.com/#request"],
    )
    website: Optional[str] = Field(
        None,
        max_length=200,
        description="Bot honeypot field; must stay empty",
    )


class ToolRequestResponse(BaseModel):
    ok: bool = True
    delivered: bool = True
    provider: str
    to_email: str
    activation_required: bool = False
    message: str


class ToolRequestCapabilitiesResponse(BaseModel):
    to_email: str
    configured_providers: List[str]
    ready: bool
