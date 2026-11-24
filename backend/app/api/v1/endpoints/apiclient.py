"""
The API client (Postman-style tool): relays requests the browser has fully built.

POST /apiclient/send  — one HTTP request with timings, TLS details, redirects, NTLM, raw bytes back
POST /apiclient/grpc  — one gRPC call over HTTP/2 (unary or streaming), protobuf bytes in and out
"""

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app.schemas.apiclient import GrpcRequest, SendRequest
from app.services import apiclient

router = APIRouter(prefix="/apiclient", tags=["API client"])


@router.post("/send", summary="Send one HTTP request to a public address and report every detail")
async def send(req: SendRequest):
    return await run_in_threadpool(apiclient.send_request, req)


@router.post("/grpc", summary="Call a gRPC method over HTTP/2")
async def grpc(req: GrpcRequest):
    return await run_in_threadpool(apiclient.grpc_call, req)
