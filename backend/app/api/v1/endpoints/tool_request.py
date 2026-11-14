from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from app.schemas.tool_request import (
    ToolRequestCapabilitiesResponse,
    ToolRequestPayload,
    ToolRequestResponse,
)
from app.services.tool_request import tool_request_service

router = APIRouter(prefix="/tool-request", tags=["Tool Request"])


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


@router.get("/capabilities", response_model=ToolRequestCapabilitiesResponse)
async def tool_request_capabilities() -> ToolRequestCapabilitiesResponse:
    """Return which free email delivery channels are active for tool requests."""
    return tool_request_service.capabilities()


@router.post("", response_model=ToolRequestResponse)
async def submit_tool_request(request: Request, payload: ToolRequestPayload) -> ToolRequestResponse:
    """Send a visitor's tool request message to the site contact inbox."""
    return await run_in_threadpool(tool_request_service.submit, payload, _client_key(request))
