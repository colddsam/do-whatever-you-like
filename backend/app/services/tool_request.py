"""Tool-request validation, rate limiting, and free-tier email delivery service."""

from collections import deque
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
import html
import logging
import re
import smtplib
import ssl
import threading
import time
from typing import Deque, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests

from app.config.tool_request import settings
from app.core.config import app_settings
from app.exceptions.tool_request import (
    InvalidToolRequestError,
    ToolRequestDeliveryError,
    ToolRequestRateLimitError,
)
from app.schemas.tool_request import (
    ToolRequestCapabilitiesResponse,
    ToolRequestPayload,
    ToolRequestResponse,
)

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s<>()\[\],;:\\\"]+@[^@\s<>()\[\],;:\\\"]+\.[^@\s<>()\[\],;:\\\"]+$")
_SMTP_TIMEOUT = 12


def _clean_line(value: Optional[str]) -> str:
    """Strip CR/LF and control characters to block email header injection."""
    if not value:
        return ""
    return re.sub(r"[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+", " ", value).strip()


def _safe_http_url(url: Optional[str], allow_local_http: bool = False) -> str:
    cleaned = _clean_line(url)
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if parsed.scheme == "https" and parsed.netloc:
        return cleaned
    if allow_local_http and parsed.scheme == "http" and (parsed.hostname in ("127.0.0.1", "localhost")):
        return cleaned
    return ""


class ToolRequestService:
    """Delivers visitor tool requests to CONTACT_EMAIL via free HTTPS APIs or SMTP."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: Dict[str, Deque[float]] = {}

    def _smtp_host(self) -> str:
        host = settings.SMTP_HOST.strip()
        if host:
            return host
        if settings.SMTP_USER.strip().lower().endswith("@gmail.com"):
            return "smtp.gmail.com"
        return ""

    def configured_providers(self) -> List[str]:
        providers: List[str] = []
        if settings.RESEND_API_KEY.strip():
            providers.append("resend")
        if settings.BREVO_API_KEY.strip():
            providers.append("brevo")
        if settings.WEB3FORMS_ACCESS_KEY.strip():
            providers.append("web3forms")
        if _safe_http_url(settings.APPS_SCRIPT_URL, allow_local_http=True):
            providers.append("apps_script")
        if self._smtp_host() and settings.SMTP_USER.strip() and settings.SMTP_PASS.strip():
            providers.append("smtp")
        if _safe_http_url(settings.WEBHOOK_URL, allow_local_http=True):
            providers.append("webhook")
        if settings.FORMSUBMIT_ENABLED:
            providers.append("formsubmit")
        return providers

    def capabilities(self) -> ToolRequestCapabilitiesResponse:
        providers = self.configured_providers()
        return ToolRequestCapabilitiesResponse(
            to_email=settings.TO_EMAIL,
            configured_providers=providers,
            ready=len(providers) > 0,
        )

    def _enforce_rate_limit(self, client_key: str) -> None:
        limit = max(1, settings.RATE_LIMIT_PER_HOUR)
        now = time.monotonic()
        cutoff = now - 3600.0
        with self._lock:
            stale_keys = [k for k, q in self._hits.items() if not q or q[-1] < cutoff]
            for k in stale_keys:
                del self._hits[k]
            bucket = self._hits.setdefault(client_key, deque())
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                raise ToolRequestRateLimitError()
            bucket.append(now)

    @staticmethod
    def _validate(payload: ToolRequestPayload) -> Tuple[str, str, str, str]:
        idea = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+", "", payload.idea).strip()
        if len(idea) < 3:
            raise InvalidToolRequestError("Please describe the tool you want in at least 3 characters.")

        category = _clean_line(payload.category)[:60]
        reply_to = _clean_line(payload.reply_to)[:160]
        if reply_to and not _EMAIL_RE.match(reply_to):
            raise InvalidToolRequestError("Please enter a valid reply email address, or leave it blank.")

        page_url = _safe_http_url(payload.page_url, allow_local_http=True)[:300]
        return idea, category, reply_to, page_url

    @staticmethod
    def _build_content(idea: str, category: str, reply_to: str, page_url: str) -> Tuple[str, str, str]:
        preview = _clean_line(idea)[:70]
        if len(_clean_line(idea)) > 70:
            preview = preview.rstrip() + "…"
        subject = f"[{settings.FROM_NAME}] Tool Request: {preview}"
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

        lines = [
            f"New tool request from {settings.FROM_NAME}",
            "",
            "Requested tool / task:",
            idea,
            "",
            f"Category: {category or 'Not specified'}",
            f"Reply email: {reply_to or 'Anonymous (none provided)'}",
            f"Page: {page_url or settings.SITE_URL}",
            f"Sent at: {timestamp}",
        ]
        plain_body = "\n".join(lines)

        idea_html = html.escape(idea, quote=True).replace("\n", "<br>")
        cat_html = html.escape(category or "Not specified", quote=True)
        reply_html = html.escape(reply_to or "Anonymous (none provided)", quote=True)
        page_html = html.escape(page_url or settings.SITE_URL, quote=True)
        time_html = html.escape(timestamp, quote=True)
        html_body = (
            "<div style=\"font-family:Inter,Arial,sans-serif;max-width:600px;padding:20px;"
            "border:1px solid #e6e2da;border-radius:10px;background:#faf8f3;color:#15140f\">"
            "<p style=\"font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a867a;margin:0 0 8px\">"
            f"{html.escape(settings.FROM_NAME)} · Tool Request</p>"
            "<div style=\"background:#ffffff;border:1px solid #e6e2da;border-radius:8px;padding:16px;margin:12px 0;"
            "font-size:15px;line-height:1.55\">"
            f"{idea_html}</div>"
            "<table style=\"width:100%;font-size:13px;color:#57544a;border-collapse:collapse\">"
            f"<tr><td style=\"padding:4px 0;width:110px\"><strong>Category</strong></td><td>{cat_html}</td></tr>"
            f"<tr><td style=\"padding:4px 0\"><strong>Reply to</strong></td><td>{reply_html}</td></tr>"
            f"<tr><td style=\"padding:4px 0\"><strong>Page</strong></td><td>{page_html}</td></tr>"
            f"<tr><td style=\"padding:4px 0\"><strong>Sent at</strong></td><td>{time_html}</td></tr>"
            "</table></div>"
        )
        return subject, plain_body, html_body

    def _send_resend(self, subject: str, text_body: str, html_body: str, reply_to: str) -> None:
        body: dict = {
            "from": settings.RESEND_FROM.strip() or f"{settings.FROM_NAME} <onboarding@resend.dev>",
            "to": [settings.TO_EMAIL],
            "subject": subject,
            "text": text_body,
            "html": html_body,
        }
        if reply_to:
            body["reply_to"] = reply_to
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY.strip()}", "Content-Type": "application/json"},
            json=body,
            timeout=min(15, app_settings.REQUEST_TIMEOUT),
        )
        if not resp.ok:
            raise RuntimeError(f"Resend returned HTTP {resp.status_code}")

    def _send_brevo(self, subject: str, text_body: str, html_body: str, reply_to: str) -> None:
        sender_email = settings.BREVO_SENDER_EMAIL.strip() or settings.TO_EMAIL
        body: dict = {
            "sender": {"name": settings.FROM_NAME, "email": sender_email},
            "to": [{"email": settings.TO_EMAIL}],
            "subject": subject,
            "textContent": text_body,
            "htmlContent": html_body,
        }
        if reply_to:
            body["replyTo"] = {"email": reply_to}
        resp = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": settings.BREVO_API_KEY.strip(), "Content-Type": "application/json", "accept": "application/json"},
            json=body,
            timeout=min(15, app_settings.REQUEST_TIMEOUT),
        )
        if not resp.ok:
            raise RuntimeError(f"Brevo returned HTTP {resp.status_code}")

    def _send_web3forms(self, subject: str, text_body: str, reply_to: str) -> None:
        payload = {
            "access_key": settings.WEB3FORMS_ACCESS_KEY.strip(),
            "subject": subject,
            "from_name": settings.FROM_NAME,
            "message": text_body,
        }
        if reply_to:
            payload["replyto"] = reply_to
            payload["email"] = reply_to
        resp = requests.post(
            "https://api.web3forms.com/submit",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            json=payload,
            timeout=min(15, app_settings.REQUEST_TIMEOUT),
        )
        data = resp.json() if "json" in resp.headers.get("content-type", "").lower() else {}
        if not resp.ok or not data.get("success"):
            raise RuntimeError(f"Web3Forms returned HTTP {resp.status_code}")

    def _send_apps_script(self, subject: str, text_body: str, html_body: str, reply_to: str) -> None:
        url = _safe_http_url(settings.APPS_SCRIPT_URL, allow_local_http=True)
        resp = requests.post(
            url,
            json={
                "to": settings.TO_EMAIL,
                "subject": subject,
                "text": text_body,
                "html": html_body,
                "replyTo": reply_to,
            },
            timeout=min(15, app_settings.REQUEST_TIMEOUT),
        )
        if not resp.ok:
            raise RuntimeError(f"Apps Script returned HTTP {resp.status_code}")

    def _send_webhook(self, subject: str, text_body: str) -> None:
        url = _safe_http_url(settings.WEBHOOK_URL, allow_local_http=True)
        resp = requests.post(
            url,
            json={"content": f"**{subject}**\n\n{text_body}", "text": f"{subject}\n\n{text_body}", "to": settings.TO_EMAIL},
            timeout=min(12, app_settings.REQUEST_TIMEOUT),
        )
        if not resp.ok:
            raise RuntimeError(f"Webhook returned HTTP {resp.status_code}")

    def _send_smtp(self, subject: str, text_body: str, html_body: str, reply_to: str) -> None:
        host = self._smtp_host()
        user = settings.SMTP_USER.strip()
        password = settings.SMTP_PASS.strip()
        from_email = settings.SMTP_FROM.strip() or user or settings.TO_EMAIL

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = formataddr((settings.FROM_NAME, from_email))
        msg["To"] = settings.TO_EMAIL
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype="html")

        context = ssl.create_default_context()
        if settings.SMTP_USE_SSL and settings.SMTP_PORT == 465:
            with smtplib.SMTP_SSL(host, settings.SMTP_PORT, context=context, timeout=_SMTP_TIMEOUT) as server:
                server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, settings.SMTP_PORT, timeout=_SMTP_TIMEOUT) as server:
                server.ehlo()
                if settings.SMTP_STARTTLS or settings.SMTP_PORT == 587:
                    server.starttls(context=context)
                    server.ehlo()
                server.login(user, password)
                server.send_message(msg)

    def _send_formsubmit(self, subject: str, text_body: str, reply_to: str, page_url: str) -> bool:
        origin = settings.SITE_URL.rstrip("/")
        if page_url:
            parsed = urlparse(page_url)
            if parsed.scheme and parsed.netloc:
                origin = f"{parsed.scheme}://{parsed.netloc}"

        resp = requests.post(
            f"https://formsubmit.co/ajax/{settings.TO_EMAIL}",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Origin": origin,
                "Referer": f"{origin}/",
                "User-Agent": "DoWhateverYouLike/1.0 (+https://do-whatever-you-like.colddsam.com)",
            },
            json={
                "_subject": subject,
                "_captcha": "false",
                "_template": "table",
                "_url": page_url or f"{origin}/#request",
                "email": reply_to or settings.TO_EMAIL,
                "message": text_body,
            },
            timeout=min(15, app_settings.REQUEST_TIMEOUT),
        )
        if "json" not in resp.headers.get("content-type", "").lower():
            raise RuntimeError(f"FormSubmit returned non-JSON HTTP {resp.status_code}")

        data = resp.json()
        raw_msg = str(data.get("message") or "")
        if "activation" in raw_msg.lower() or "activate form" in raw_msg.lower():
            return True
        ok = data.get("success") in (True, "true", "True")
        if not resp.ok or not ok:
            raise RuntimeError(f"FormSubmit refused delivery: {raw_msg or resp.status_code}")
        return False

    def submit(self, payload: ToolRequestPayload, client_key: str = "local") -> ToolRequestResponse:
        self._enforce_rate_limit(client_key)
        idea, category, reply_to, page_url = self._validate(payload)

        if (payload.website or "").strip():
            return ToolRequestResponse(
                ok=True,
                delivered=False,
                provider="filtered",
                to_email=settings.TO_EMAIL,
                message="Request ignored.",
            )

        subject, text_body, html_body = self._build_content(idea, category, reply_to, page_url)
        providers = self.configured_providers()
        if not providers:
            raise ToolRequestDeliveryError("No email delivery provider is configured yet.")

        last_err: Optional[str] = None
        for provider in providers:
            try:
                if provider == "resend":
                    self._send_resend(subject, text_body, html_body, reply_to)
                    return ToolRequestResponse(
                        ok=True,
                        delivered=True,
                        provider="resend",
                        to_email=settings.TO_EMAIL,
                        message=f"Sent! Your tool request is on its way to {settings.TO_EMAIL}.",
                    )
                if provider == "brevo":
                    self._send_brevo(subject, text_body, html_body, reply_to)
                    return ToolRequestResponse(
                        ok=True,
                        delivered=True,
                        provider="brevo",
                        to_email=settings.TO_EMAIL,
                        message=f"Sent! Your tool request is on its way to {settings.TO_EMAIL}.",
                    )
                if provider == "web3forms":
                    self._send_web3forms(subject, text_body, reply_to)
                    return ToolRequestResponse(
                        ok=True,
                        delivered=True,
                        provider="web3forms",
                        to_email=settings.TO_EMAIL,
                        message=f"Sent! Your tool request is on its way to {settings.TO_EMAIL}.",
                    )
                if provider == "apps_script":
                    self._send_apps_script(subject, text_body, html_body, reply_to)
                    return ToolRequestResponse(
                        ok=True,
                        delivered=True,
                        provider="apps_script",
                        to_email=settings.TO_EMAIL,
                        message=f"Sent! Your tool request is on its way to {settings.TO_EMAIL}.",
                    )
                if provider == "smtp":
                    self._send_smtp(subject, text_body, html_body, reply_to)
                    return ToolRequestResponse(
                        ok=True,
                        delivered=True,
                        provider="smtp",
                        to_email=settings.TO_EMAIL,
                        message=f"Sent! Your tool request was emailed to {settings.TO_EMAIL}.",
                    )
                if provider == "webhook":
                    self._send_webhook(subject, text_body)
                    return ToolRequestResponse(
                        ok=True,
                        delivered=True,
                        provider="webhook",
                        to_email=settings.TO_EMAIL,
                        message=f"Sent! Your tool request was forwarded for {settings.TO_EMAIL}.",
                    )
                if provider == "formsubmit":
                    needs_activation = self._send_formsubmit(subject, text_body, reply_to, page_url)
                    msg = (
                        f"Request queued — check {settings.TO_EMAIL} once to click FormSubmit's activation link so messages arrive in your inbox."
                        if needs_activation
                        else f"Sent! Your tool request is on its way to {settings.TO_EMAIL}."
                    )
                    return ToolRequestResponse(
                        ok=True,
                        delivered=True,
                        provider="formsubmit",
                        to_email=settings.TO_EMAIL,
                        activation_required=needs_activation,
                        message=msg,
                    )
            except Exception as exc:
                last_err = f"{provider}: {exc.__class__.__name__}"
                logger.warning("Tool request delivery via %s failed: %s", provider, exc)

        logger.error("All configured tool-request delivery providers failed (%s)", last_err)
        raise ToolRequestDeliveryError(
            f"Could not deliver automatically right now. Please send it directly to {settings.TO_EMAIL}."
        )


tool_request_service = ToolRequestService()
