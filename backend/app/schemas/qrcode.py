from typing import Literal, Optional
from pydantic import BaseModel, Field


ContentType = Literal["text", "url", "wifi", "vcard", "email", "sms", "phone", "geo", "event"]
ErrorCorrectionLevel = Literal["L", "M", "Q", "H"]
ModuleStyle = Literal["square", "gapped", "circle", "rounded", "vertical_bars", "horizontal_bars"]
EyeStyle = Literal["square", "rounded", "circle"]
ColorMaskStyle = Literal[
    "solid",
    "radial_gradient",
    "square_gradient",
    "horizontal_gradient",
    "vertical_gradient",
]
OutputFormat = Literal["png", "svg", "webp", "jpeg", "pdf"]


class WifiPayload(BaseModel):
    ssid: str = Field(..., min_length=1, max_length=128, description="Wi-Fi network SSID", examples=["MyHomeWiFi"])
    password: Optional[str] = Field(default="", max_length=128, description="Wi-Fi password", examples=["secret123"])
    encryption: Literal["WPA", "WEP", "nopass"] = Field(default="WPA", description="Wi-Fi security type")
    hidden: bool = Field(default=False, description="Whether the Wi-Fi SSID is hidden")


class VCardPayload(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100, examples=["Jane"])
    last_name: Optional[str] = Field(default="", max_length=100, examples=["Doe"])
    organization: Optional[str] = Field(default=None, max_length=150, examples=["Acme Corp"])
    title: Optional[str] = Field(default=None, max_length=100, examples=["Software Engineer"])
    phone: Optional[str] = Field(default=None, max_length=40, examples=["+1-555-0199"])
    email: Optional[str] = Field(default=None, max_length=150, examples=["jane@example.com"])
    website: Optional[str] = Field(default=None, max_length=256, examples=["https://example.com"])
    address: Optional[str] = Field(default=None, max_length=256, examples=["123 Main St, Metropolis"])


class EmailPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=254, examples=["hello@example.com"])
    subject: Optional[str] = Field(default=None, max_length=200, examples=["Inquiry"])
    body: Optional[str] = Field(default=None, max_length=1000, examples=["Hi there!"])


class SMSPayload(BaseModel):
    phone: str = Field(..., min_length=3, max_length=40, examples=["+15550199"])
    message: Optional[str] = Field(default=None, max_length=500, examples=["Hello from QR!"])


class GeoPayload(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, examples=[37.7749])
    longitude: float = Field(..., ge=-180.0, le=180.0, examples=[-122.4194])
    query: Optional[str] = Field(default=None, max_length=200, examples=["San Francisco, CA"])


class EventPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, examples=["Team Sync"])
    start_time: str = Field(
        ...,
        min_length=8,
        max_length=32,
        description="UTC or local ISO/iCal timestamp (e.g. 20261115T090000Z)",
        examples=["20261115T090000Z"],
    )
    end_time: str = Field(
        ...,
        min_length=8,
        max_length=32,
        description="UTC or local ISO/iCal timestamp (e.g. 20261115T100000Z)",
        examples=["20261115T100000Z"],
    )
    location: Optional[str] = Field(default=None, max_length=200, examples=["Conference Room A"])
    description: Optional[str] = Field(default=None, max_length=500, examples=["Weekly project sync"])


class QRCodeStyleOptions(BaseModel):
    error_correction: ErrorCorrectionLevel = Field(
        default="M",
        description="Error correction level: L (7%), M (15%), Q (25%), H (30%)",
    )
    box_size: int = Field(
        default=12,
        ge=4,
        le=40,
        description="Pixel size of each QR module box (4-40)",
    )
    border: int = Field(
        default=4,
        ge=0,
        le=20,
        description="Border thickness in modules around the QR code (0-20)",
    )
    module_style: ModuleStyle = Field(
        default="square",
        description="Shape of individual QR data modules",
    )
    eye_style: EyeStyle = Field(
        default="square",
        description="Shape of the three corner finder patterns (eyes)",
    )
    color_mask: ColorMaskStyle = Field(
        default="solid",
        description="Solid fill or gradient fill style across the QR code",
    )
    fill_color: str = Field(
        default="#000000",
        min_length=3,
        max_length=32,
        description="Primary foreground color in hex (#RRGGBB) or CSS color name",
        examples=["#111827"],
    )
    gradient_color: Optional[str] = Field(
        default=None,
        max_length=32,
        description="Secondary target color in hex (#RRGGBB) when using a gradient color_mask",
        examples=["#4F46E5"],
    )
    back_color: str = Field(
        default="#FFFFFF",
        min_length=3,
        max_length=32,
        description="Background color in hex (#RRGGBB), CSS name, or 'transparent' (for PNG/WebP/SVG)",
        examples=["#FFFFFF"],
    )
    eye_color: Optional[str] = Field(
        default=None,
        max_length=32,
        description="Optional custom color (#RRGGBB) for the three corner finder patterns",
        examples=["#111827"],
    )
    output_format: OutputFormat = Field(
        default="png",
        description="Output file format: png, svg, webp, jpeg, or pdf",
    )


class QRCodeGenerateRequest(QRCodeStyleOptions):
    content_type: ContentType = Field(
        default="text",
        description="Type of payload to encode into the QR code",
    )
    data: Optional[str] = Field(
        default=None,
        max_length=4096,
        description="Raw text, URL, phone number, or arbitrary string when content_type is 'text', 'url', or 'phone'",
        examples=["https://example.com"],
    )
    wifi: Optional[WifiPayload] = Field(
        default=None,
        description="Structured Wi-Fi credentials when content_type is 'wifi'",
    )
    vcard: Optional[VCardPayload] = Field(
        default=None,
        description="Structured contact details when content_type is 'vcard'",
    )
    email: Optional[EmailPayload] = Field(
        default=None,
        description="Structured email fields when content_type is 'email'",
    )
    sms: Optional[SMSPayload] = Field(
        default=None,
        description="Structured SMS details when content_type is 'sms'",
    )
    geo: Optional[GeoPayload] = Field(
        default=None,
        description="Structured geographic coordinates when content_type is 'geo'",
    )
    event: Optional[EventPayload] = Field(
        default=None,
        description="Structured calendar event when content_type is 'event'",
    )

