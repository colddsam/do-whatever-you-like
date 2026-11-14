from pydantic_settings import BaseSettings, SettingsConfigDict


class ToolRequestSettings(BaseSettings):
    TO_EMAIL: str = "colddsam@gmail.com"
    FROM_NAME: str = "Do-Whatever-You-Like"
    SITE_URL: str = "https://do-whatever-you-like.colddsam.com"

    # Free HTTPS email APIs (port 443 — works on Render Free Tier & Vercel).
    RESEND_API_KEY: str = ""
    RESEND_FROM: str = "Do-Whatever-You-Like <onboarding@resend.dev>"
    BREVO_API_KEY: str = ""
    BREVO_SENDER_EMAIL: str = ""
    WEB3FORMS_ACCESS_KEY: str = ""
    APPS_SCRIPT_URL: str = ""
    WEBHOOK_URL: str = ""

    # Standard SMTP (works locally, on VPS, or from Vercel; blocked on Render Free Tier).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_USE_SSL: bool = True
    SMTP_STARTTLS: bool = False
    SMTP_FROM: str = ""

    # Keyless HTTP fallback (requires clicking FormSubmit's one-time activation email).
    FORMSUBMIT_ENABLED: bool = True

    RATE_LIMIT_PER_HOUR: int = 20

    model_config = SettingsConfigDict(
        env_prefix="TOOL_REQUEST_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = ToolRequestSettings()
