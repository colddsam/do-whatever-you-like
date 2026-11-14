"""Canonical language catalogue for text, speech recognition, and spoken dubbing."""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class LanguageMeta:
    code: str
    name: str
    native_name: str
    rtl: bool = False
    female_voice: str = ""
    male_voice: str = ""
    speech_input: bool = True
    google_code: str = ""
    espeak_voice: str = ""

    @property
    def tts_supported(self) -> bool:
        return bool(self.female_voice or self.male_voice or self.google_tts_code)

    @property
    def google_translate_code(self) -> str:
        return self.google_code or self.code

    @property
    def google_tts_code(self) -> str:
        if self.code in GOOGLE_TTS_CODES:
            return GOOGLE_TTS_CODES[self.code]
        return self.code if (self.female_voice or self.male_voice) else ""


# Languages accepted by translate.google.com/translate_tts when Edge neural voice is absent or as fallback.
GOOGLE_TTS_CODES: Dict[str, str] = {
    "af": "af", "am": "am", "ar": "ar", "bg": "bg", "bn": "bn", "bs": "bs", "ca": "ca",
    "cs": "cs", "cy": "cy", "da": "da", "de": "de", "el": "el", "en": "en", "es": "es",
    "et": "et", "eu": "eu", "fi": "fi", "fr": "fr", "gl": "gl", "gu": "gu", "ha": "ha",
    "he": "iw", "hi": "hi", "hr": "hr", "hu": "hu", "hy": "hy", "id": "id", "is": "is",
    "it": "it", "ja": "ja", "jv": "jw", "km": "km", "kn": "kn", "ko": "ko", "la": "la",
    "lv": "lv", "ml": "ml", "mr": "mr", "ms": "ms", "my": "my", "ne": "ne", "nl": "nl",
    "no": "no", "pa": "pa", "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "si": "si",
    "sk": "sk", "sq": "sq", "sr": "sr", "su": "su", "sv": "sv", "sw": "sw", "ta": "ta",
    "te": "te", "th": "th", "tl": "tl", "tr": "tr", "uk": "uk", "ur": "ur", "vi": "vi",
    "yue": "zh-TW", "zh": "zh-CN", "zh-tw": "zh-TW",
}


LANGUAGES: Tuple[LanguageMeta, ...] = (
    LanguageMeta("en", "English", "English", False, "en-US-AvaNeural", "en-US-AndrewNeural", True, "en", "en"),
    LanguageMeta("hi", "Hindi", "हिन्दी", False, "hi-IN-SwaraNeural", "hi-IN-MadhurNeural", True, "hi", "hi"),
    LanguageMeta("bn", "Bengali", "বাংলা", False, "bn-IN-TanishaaNeural", "bn-IN-BashkarNeural", True, "bn", "bn"),
    LanguageMeta("es", "Spanish", "Español", False, "es-ES-ElviraNeural", "es-ES-AlvaroNeural", True, "es", "es"),
    LanguageMeta("fr", "French", "Français", False, "fr-FR-DeniseNeural", "fr-FR-HenriNeural", True, "fr", "fr"),
    LanguageMeta("ar", "Arabic", "العربية", True, "ar-SA-ZariyahNeural", "ar-SA-HamedNeural", True, "ar", "ar"),
    LanguageMeta("de", "German", "Deutsch", False, "de-DE-KatjaNeural", "de-DE-ConradNeural", True, "de", "de"),
    LanguageMeta("pt", "Portuguese", "Português", False, "pt-BR-FranciscaNeural", "pt-BR-AntonioNeural", True, "pt", "pt"),
    LanguageMeta("ru", "Russian", "Русский", False, "ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural", True, "ru", "ru"),
    LanguageMeta("ja", "Japanese", "日本語", False, "ja-JP-NanamiNeural", "ja-JP-KeitaNeural", True, "ja", "ja"),
    LanguageMeta("ko", "Korean", "한국어", False, "ko-KR-SunHiNeural", "ko-KR-HyunsuMultilingualNeural", True, "ko", "ko"),
    LanguageMeta("zh", "Chinese (Simplified)", "简体中文", False, "zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", True, "zh-CN", "cmn"),
    LanguageMeta("zh-tw", "Chinese (Traditional)", "繁體中文", False, "zh-TW-HsiaoChenNeural", "zh-TW-YunJheNeural", False, "zh-TW", "cmn"),
    LanguageMeta("yue", "Cantonese", "粵語", False, "zh-HK-HiuGaaiNeural", "zh-HK-WanLungNeural", True, "yue", "yue"),
    LanguageMeta("it", "Italian", "Italiano", False, "it-IT-ElsaNeural", "it-IT-GiuseppeMultilingualNeural", True, "it", "it"),
    LanguageMeta("tr", "Turkish", "Türkçe", False, "tr-TR-EmelNeural", "tr-TR-AhmetNeural", True, "tr", "tr"),
    LanguageMeta("vi", "Vietnamese", "Tiếng Việt", False, "vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural", True, "vi", "vi"),
    LanguageMeta("th", "Thai", "ไทย", False, "th-TH-PremwadeeNeural", "th-TH-NiwatNeural", True, "th", "th"),
    LanguageMeta("id", "Indonesian", "Bahasa Indonesia", False, "id-ID-GadisNeural", "id-ID-ArdiNeural", True, "id", "id"),
    LanguageMeta("ta", "Tamil", "தமிழ்", False, "ta-IN-PallaviNeural", "ta-IN-ValluvarNeural", True, "ta", "ta"),
    LanguageMeta("te", "Telugu", "తెలుగు", False, "te-IN-ShrutiNeural", "te-IN-MohanNeural", True, "te", "te"),
    LanguageMeta("mr", "Marathi", "मराठी", False, "mr-IN-AarohiNeural", "mr-IN-ManoharNeural", True, "mr", "mr"),
    LanguageMeta("gu", "Gujarati", "ગુજરાતી", False, "gu-IN-DhwaniNeural", "gu-IN-NiranjanNeural", True, "gu", "gu"),
    LanguageMeta("kn", "Kannada", "ಕನ್ನಡ", False, "kn-IN-SapnaNeural", "kn-IN-GaganNeural", True, "kn", "kn"),
    LanguageMeta("ml", "Malayalam", "മലയാളം", False, "ml-IN-SobhanaNeural", "ml-IN-MidhunNeural", True, "ml", "ml"),
    LanguageMeta("pa", "Punjabi", "ਪੰਜਾਬੀ", False, "", "", True, "pa", "pa"),
    LanguageMeta("ur", "Urdu", "اردو", True, "ur-IN-GulNeural", "ur-IN-SalmanNeural", True, "ur", "ur"),
    LanguageMeta("ne", "Nepali", "नेपाली", False, "ne-NP-HemkalaNeural", "ne-NP-SagarNeural", True, "ne", "ne"),
    LanguageMeta("si", "Sinhala", "සිංහල", False, "si-LK-ThiliniNeural", "si-LK-SameeraNeural", True, "si", "si"),
    LanguageMeta("fa", "Persian", "فارسی", True, "fa-IR-DilaraNeural", "fa-IR-FaridNeural", True, "fa", "fa"),
    LanguageMeta("he", "Hebrew", "עברית", True, "he-IL-HilaNeural", "he-IL-AvriNeural", True, "iw", "he"),
    LanguageMeta("nl", "Dutch", "Nederlands", False, "nl-BE-DenaNeural", "nl-BE-ArnaudNeural", True, "nl", "nl"),
    LanguageMeta("pl", "Polish", "Polski", False, "pl-PL-ZofiaNeural", "pl-PL-MarekNeural", True, "pl", "pl"),
    LanguageMeta("uk", "Ukrainian", "Українська", False, "uk-UA-PolinaNeural", "uk-UA-OstapNeural", True, "uk", "uk"),
    LanguageMeta("ro", "Romanian", "Română", False, "ro-RO-AlinaNeural", "ro-RO-EmilNeural", True, "ro", "ro"),
    LanguageMeta("el", "Greek", "Ελληνικά", False, "el-GR-AthinaNeural", "el-GR-NestorasNeural", True, "el", "el"),
    LanguageMeta("cs", "Czech", "Čeština", False, "cs-CZ-VlastaNeural", "cs-CZ-AntoninNeural", True, "cs", "cs"),
    LanguageMeta("sv", "Swedish", "Svenska", False, "sv-SE-SofieNeural", "sv-SE-MattiasNeural", True, "sv", "sv"),
    LanguageMeta("da", "Danish", "Dansk", False, "da-DK-ChristelNeural", "da-DK-JeppeNeural", True, "da", "da"),
    LanguageMeta("fi", "Finnish", "Suomi", False, "fi-FI-NooraNeural", "fi-FI-HarriNeural", True, "fi", "fi"),
    LanguageMeta("no", "Norwegian", "Norsk", False, "nb-NO-PernilleNeural", "nb-NO-FinnNeural", True, "no", "nb"),
    LanguageMeta("hu", "Hungarian", "Magyar", False, "hu-HU-NoemiNeural", "hu-HU-TamasNeural", True, "hu", "hu"),
    LanguageMeta("bg", "Bulgarian", "Български", False, "bg-BG-KalinaNeural", "bg-BG-BorislavNeural", True, "bg", "bg"),
    LanguageMeta("hr", "Croatian", "Hrvatski", False, "hr-HR-GabrijelaNeural", "hr-HR-SreckoNeural", True, "hr", "hr"),
    LanguageMeta("sk", "Slovak", "Slovenčina", False, "sk-SK-ViktoriaNeural", "sk-SK-LukasNeural", True, "sk", "sk"),
    LanguageMeta("sl", "Slovenian", "Slovenščina", False, "sl-SI-PetraNeural", "sl-SI-RokNeural", True, "sl", "sl"),
    LanguageMeta("sr", "Serbian", "Српски", False, "sr-RS-SophieNeural", "sr-RS-NicholasNeural", True, "sr", "sr"),
    LanguageMeta("ca", "Catalan", "Català", False, "ca-ES-JoanaNeural", "ca-ES-EnricNeural", True, "ca", "ca"),
    LanguageMeta("ms", "Malay", "Bahasa Melayu", False, "ms-MY-YasminNeural", "ms-MY-OsmanNeural", True, "ms", "ms"),
    LanguageMeta("tl", "Filipino (Tagalog)", "Tagalog", False, "fil-PH-BlessicaNeural", "fil-PH-AngeloNeural", True, "tl", ""),
    LanguageMeta("sw", "Swahili", "Kiswahili", False, "sw-KE-ZuriNeural", "sw-KE-RafikiNeural", True, "sw", "sw"),
    LanguageMeta("af", "Afrikaans", "Afrikaans", False, "af-ZA-AdriNeural", "af-ZA-WillemNeural", True, "af", "af"),
    LanguageMeta("am", "Amharic", "አማርኛ", False, "am-ET-MekdesNeural", "am-ET-AmehaNeural", True, "am", "am"),
    LanguageMeta("az", "Azerbaijani", "Azərbaycan", False, "az-AZ-BanuNeural", "az-AZ-BabekNeural", True, "az", "az"),
    LanguageMeta("bs", "Bosnian", "Bosanski", False, "bs-BA-VesnaNeural", "bs-BA-GoranNeural", True, "bs", "bs"),
    LanguageMeta("cy", "Welsh", "Cymraeg", False, "cy-GB-NiaNeural", "cy-GB-AledNeural", True, "cy", "cy"),
    LanguageMeta("et", "Estonian", "Eesti", False, "et-EE-AnuNeural", "et-EE-KertNeural", True, "et", "et"),
    LanguageMeta("gl", "Galician", "Galego", False, "gl-ES-SabelaNeural", "gl-ES-RoiNeural", True, "gl", ""),
    LanguageMeta("hy", "Armenian", "Հայերեն", False, "", "", True, "hy", "hy"),
    LanguageMeta("is", "Icelandic", "Íslenska", False, "is-IS-GudrunNeural", "is-IS-GunnarNeural", True, "is", "is"),
    LanguageMeta("jv", "Javanese", "Basa Jawa", False, "jv-ID-SitiNeural", "jv-ID-DimasNeural", True, "jw", ""),
    LanguageMeta("ka", "Georgian", "ქართული", False, "ka-GE-EkaNeural", "ka-GE-GiorgiNeural", True, "ka", "ka"),
    LanguageMeta("kk", "Kazakh", "Қазақша", False, "kk-KZ-AigulNeural", "kk-KZ-DauletNeural", True, "kk", ""),
    LanguageMeta("km", "Khmer", "ខ្មែរ", False, "km-KH-SreymomNeural", "km-KH-PisethNeural", True, "km", ""),
    LanguageMeta("lo", "Lao", "ລາວ", False, "lo-LA-KeomanyNeural", "lo-LA-ChanthavongNeural", True, "lo", ""),
    LanguageMeta("lt", "Lithuanian", "Lietuvių", False, "lt-LT-OnaNeural", "lt-LT-LeonasNeural", True, "lt", "lt"),
    LanguageMeta("lv", "Latvian", "Latviešu", False, "lv-LV-EveritaNeural", "lv-LV-NilsNeural", True, "lv", "lv"),
    LanguageMeta("mk", "Macedonian", "Македонски", False, "mk-MK-MarijaNeural", "mk-MK-AleksandarNeural", True, "mk", "mk"),
    LanguageMeta("mn", "Mongolian", "Монгол", False, "mn-MN-YesuiNeural", "mn-MN-BataaNeural", True, "mn", ""),
    LanguageMeta("mt", "Maltese", "Malti", False, "mt-MT-GraceNeural", "mt-MT-JosephNeural", True, "mt", "mt"),
    LanguageMeta("my", "Myanmar (Burmese)", "မြန်မာ", False, "my-MM-NilarNeural", "my-MM-ThihaNeural", True, "my", "my"),
    LanguageMeta("ps", "Pashto", "پښتو", True, "ps-AF-LatifaNeural", "ps-AF-GulNawazNeural", True, "ps", ""),
    LanguageMeta("so", "Somali", "Soomaali", False, "so-SO-UbaxNeural", "so-SO-MuuseNeural", True, "so", ""),
    LanguageMeta("sq", "Albanian", "Shqip", False, "sq-AL-AnilaNeural", "sq-AL-IlirNeural", True, "sq", "sq"),
    LanguageMeta("su", "Sundanese", "Basa Sunda", False, "su-ID-TutiNeural", "su-ID-JajangNeural", True, "su", ""),
    LanguageMeta("uz", "Uzbek", "Oʻzbek", False, "uz-UZ-MadinaNeural", "uz-UZ-SardorNeural", True, "uz", ""),
    LanguageMeta("zu", "Zulu", "isiZulu", False, "zu-ZA-ThandoNeural", "zu-ZA-ThembaNeural", False, "zu", ""),
    # Additional text & Whisper-recognized languages
    LanguageMeta("as", "Assamese", "অসমীয়া", False, "", "", True, "as", ""),
    LanguageMeta("be", "Belarusian", "Беларуская", False, "", "", True, "be", ""),
    LanguageMeta("eu", "Basque", "Euskara", False, "", "", True, "eu", "eu"),
    LanguageMeta("ga", "Irish", "Gaeilge", False, "ga-IE-OrlaNeural", "ga-IE-ColmNeural", False, "ga", "ga"),
    LanguageMeta("ha", "Hausa", "Hausa", False, "", "", True, "ha", ""),
    LanguageMeta("haw", "Hawaiian", "ʻŌlelo Hawaiʻi", False, "", "", True, "haw", ""),
    LanguageMeta("ht", "Haitian Creole", "Kreyòl ayisyen", False, "", "", True, "ht", ""),
    LanguageMeta("ku", "Kurdish", "Kurdî", False, "", "", False, "ku", ""),
    LanguageMeta("la", "Latin", "Latina", False, "", "", True, "la", "la"),
    LanguageMeta("lb", "Luxembourgish", "Lëtzebuergesch", False, "", "", True, "lb", ""),
    LanguageMeta("ln", "Lingala", "Lingála", False, "", "", True, "ln", ""),
    LanguageMeta("mg", "Malagasy", "Malagasy", False, "", "", True, "mg", ""),
    LanguageMeta("mi", "Maori", "Māori", False, "", "", True, "mi", ""),
    LanguageMeta("or", "Odia", "ଓଡ଼ିଆ", False, "", "", False, "or", ""),
    LanguageMeta("sa", "Sanskrit", "संस्कृतम्", False, "", "", True, "sa", ""),
    LanguageMeta("sd", "Sindhi", "سنڌي", True, "", "", True, "sd", ""),
    LanguageMeta("sn", "Shona", "chiShona", False, "", "", True, "sn", ""),
    LanguageMeta("tg", "Tajik", "Тоҷикӣ", False, "", "", True, "tg", ""),
    LanguageMeta("tk", "Turkmen", "Türkmen", False, "", "", True, "tk", ""),
    LanguageMeta("tt", "Tatar", "Татар", False, "", "", True, "tt", ""),
    LanguageMeta("yi", "Yiddish", "ייִדיש", True, "", "", True, "yi", ""),
    LanguageMeta("yo", "Yoruba", "Yorùbá", False, "", "", True, "yo", ""),
)

BY_CODE: Dict[str, LanguageMeta] = {lang.code: lang for lang in LANGUAGES}

ALIASES: Dict[str, str] = {
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh_cn": "zh",
    "zh-hant": "zh-tw",
    "zh_tw": "zh-tw",
    "zh-hk": "yue",
    "zh_hk": "yue",
    "iw": "he",
    "jw": "jv",
    "fil": "tl",
    "nb": "no",
    "nn": "no",
    # Groq Whisper occasionally emits lowercase full names instead of ISO codes
    "english": "en",
    "hindi": "hi",
    "bengali": "bn",
    "spanish": "es",
    "french": "fr",
    "arabic": "ar",
    "german": "de",
    "portuguese": "pt",
    "russian": "ru",
    "japanese": "ja",
    "korean": "ko",
    "chinese": "zh",
    "italian": "it",
    "turkish": "tr",
    "vietnamese": "vi",
    "thai": "th",
    "indonesian": "id",
    "tamil": "ta",
    "telugu": "te",
    "marathi": "mr",
    "gujarati": "gu",
    "kannada": "kn",
    "malayalam": "ml",
    "punjabi": "pa",
    "urdu": "ur",
    "nepali": "ne",
    "persian": "fa",
    "hebrew": "he",
    "dutch": "nl",
    "polish": "pl",
    "ukrainian": "uk",
}


def normalize_code(raw: Optional[str]) -> str:
    code = (raw or "").strip().lower().replace("_", "-")
    if not code or code == "auto":
        return "auto"
    if code in ALIASES:
        return ALIASES[code]
    if code in BY_CODE:
        return code
    short = code.split("-", 1)[0]
    if short in ALIASES:
        return ALIASES[short]
    return short if short in BY_CODE else code


def language_name(code: str) -> str:
    norm = normalize_code(code)
    meta = BY_CODE.get(norm)
    return meta.name if meta else (code.upper() if code else "Unknown")


def serialize_languages() -> List[Dict[str, object]]:
    return [
        {
            "code": lang.code,
            "name": lang.name,
            "native_name": lang.native_name,
            "rtl": lang.rtl,
            "tts_supported": lang.tts_supported,
            "speech_input": lang.speech_input,
        }
        for lang in LANGUAGES
    ]


def detect_script_hint(text: str) -> Optional[str]:
    """Quick local fallback for MyMemory when auto-detection sees an unmistakable script."""
    counts: Dict[str, int] = {}
    for ch in text[:1000]:
        cp = ord(ch)
        if 0x0900 <= cp <= 0x097F:
            counts["hi"] = counts.get("hi", 0) + 1
        elif 0x0980 <= cp <= 0x09FF:
            counts["bn"] = counts.get("bn", 0) + 1
        elif 0x0600 <= cp <= 0x06FF:
            counts["ar"] = counts.get("ar", 0) + 1
        elif 0x0590 <= cp <= 0x05FF:
            counts["he"] = counts.get("he", 0) + 1
        elif 0x0400 <= cp <= 0x04FF:
            counts["ru"] = counts.get("ru", 0) + 1
        elif 0xAC00 <= cp <= 0xD7AF or 0x1100 <= cp <= 0x11FF:
            counts["ko"] = counts.get("ko", 0) + 1
        elif 0x3040 <= cp <= 0x30FF:
            counts["ja"] = counts.get("ja", 0) + 1
        elif 0x4E00 <= cp <= 0x9FFF:
            counts["zh"] = counts.get("zh", 0) + 1
        elif 0x0370 <= cp <= 0x03FF:
            counts["el"] = counts.get("el", 0) + 1
        elif 0x0E00 <= cp <= 0x0E7F:
            counts["th"] = counts.get("th", 0) + 1
        elif 0x0B80 <= cp <= 0x0BFF:
            counts["ta"] = counts.get("ta", 0) + 1
        elif 0x0C00 <= cp <= 0x0C7F:
            counts["te"] = counts.get("te", 0) + 1
        elif 0x0A80 <= cp <= 0x0AFF:
            counts["gu"] = counts.get("gu", 0) + 1
        elif 0x0C80 <= cp <= 0x0CFF:
            counts["kn"] = counts.get("kn", 0) + 1
        elif 0x0D00 <= cp <= 0x0D7F:
            counts["ml"] = counts.get("ml", 0) + 1
        elif 0x0A00 <= cp <= 0x0A7F:
            counts["pa"] = counts.get("pa", 0) + 1
    if not counts:
        return None
    if counts.get("ja", 0) > 0:
        return "ja"
    return max(counts, key=lambda k: counts[k])
