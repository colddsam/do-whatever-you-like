"""
Icons for every platform from one picture (Pillow).

The picture is first made into a square "master" (1024 px): fitted inside the chosen padding, on the
chosen background, clipped to the chosen shape. Every size is drawn from that master with a good
filter, and the smallest sizes get a touch of sharpening so they don't turn to mush.

Packs:
- web      favicon.ico (16/32/48), PNG favicons, apple-touch-icon, Android/PWA icons (incl. maskable),
           site.webmanifest, browserconfig.xml and the HTML to paste
- windows  app.ico with every size Windows asks for (16 to 256), plus Store/MSIX tile images
- macos    app.icns and the AppIcon.iconset folder (for iconutil / Xcode)
- ios      AppIcon.appiconset with Contents.json, ready to drop into Xcode
- android  mipmap folders: legacy, round and adaptive (foreground + background), plus the Play Store icon
- desktop  PNGs from 16 to 1024 for Linux, Electron, Flutter and the rest
- ico      just one .ico file, with the sizes picked
"""

import io
import json
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

from app.config.icon import settings
from app.exceptions.icon import IconProcessingError, InvalidIconInputError

MASTER = 1024
ICO_ALL = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
PACKS = ("web", "windows", "macos", "ios", "android", "desktop")


# ---------- the master square ----------


def _rgba(hex_color: Optional[str]) -> Optional[Tuple[int, int, int, int]]:
    if not hex_color:
        return None
    h = hex_color.lstrip("#")
    if len(h) != 6:
        raise InvalidIconInputError("Pick a background colour like #1A73E8.")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255


def _trim(img: Image.Image) -> Image.Image:
    """Crops away fully transparent edges, so 'padding' means the same for every picture."""
    if img.mode == "RGBA":
        box = img.getchannel("A").getbbox()
        if box:
            return img.crop(box)
    return img


def _mask(size: int, shape: str) -> Optional[Image.Image]:
    if shape == "square":
        return None
    big = size * 4  # Drawn large and scaled down, for smooth edges.
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)
    if shape == "circle":
        d.ellipse((0, 0, big - 1, big - 1), fill=255)
    else:  # rounded: the iOS-like 22% corner
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.225), fill=255)
    return m.resize((size, size), Image.Resampling.LANCZOS)


def master(src: Image.Image, padding: float, background: Optional[Tuple[int, int, int, int]], shape: str, size: int = MASTER) -> Image.Image:
    art = _trim(ImageOps.exif_transpose(src).convert("RGBA"))
    inner = max(1, round(size * (1 - 2 * padding)))
    art = ImageOps.contain(art, (inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    m = _mask(size, shape)
    if m is not None:
        canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), m))
    return canvas


def _at(img: Image.Image, px: int) -> Image.Image:
    out = img.resize((px, px), Image.Resampling.LANCZOS)
    if px <= 48:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    return out


def _opaque(img: Image.Image, color: Tuple[int, int, int, int]) -> Image.Image:
    base = Image.new("RGBA", img.size, color)
    base.alpha_composite(img)
    return base.convert("RGB")


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _ico(img: Image.Image, sizes: List[int]) -> bytes:
    frames = [_at(img, s) for s in sorted(set(sizes))]
    buf = io.BytesIO()
    frames[-1].save(buf, format="ICO", sizes=[(f.width, f.height) for f in frames], append_images=frames[:-1])
    return buf.getvalue()


def _icns(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    big = img.resize((1024, 1024), Image.Resampling.LANCZOS)
    big.save(buf, format="ICNS", append_images=[_at(img, s) for s in (16, 32, 64, 128, 256, 512)])
    return buf.getvalue()


# ---------- packs ----------


def _web(z: zipfile.ZipFile, art: Image.Image, plain: Image.Image, opts: Dict[str, Any], svg: Optional[str]) -> None:
    bg = opts["solid"]
    name, color = opts["name"], opts["theme"]
    z.writestr("web/favicon.ico", _ico(art, [16, 32, 48]))
    for s in (16, 32, 48, 96):
        z.writestr(f"web/favicon-{s}x{s}.png", _png(_at(art, s)))
    # Apple fills transparent areas with black, so the touch icon is always opaque.
    z.writestr("web/apple-touch-icon.png", _png(_opaque(_at(plain, 180), bg)))
    for s in (192, 512):
        z.writestr(f"web/icon-{s}.png", _png(_at(art, s)))
    # Maskable: the art inside the central 80% safe zone, on a full-bleed background.
    maskable = master(opts["source"], max(opts["padding"], 0.1) + 0.1, bg, "square")
    z.writestr("web/icon-maskable-512.png", _png(_at(maskable, 512)))
    z.writestr("web/mstile-150x150.png", _png(_at(art, 150)))
    if svg:
        z.writestr("web/favicon.svg", svg)
    manifest = {
        "name": name, "short_name": name[:12], "start_url": "/", "display": "standalone",
        "background_color": color, "theme_color": color,
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    z.writestr("web/site.webmanifest", json.dumps(manifest, indent=2))
    z.writestr("web/browserconfig.xml", (
        '<?xml version="1.0" encoding="utf-8"?>\n<browserconfig><msapplication><tile>'
        f'<square150x150logo src="/mstile-150x150.png"/><TileColor>{color}</TileColor>'
        "</tile></msapplication></browserconfig>\n"
    ))
    snippet = [
        '<link rel="icon" href="/favicon.ico" sizes="48x48">',
        *(['<link rel="icon" href="/favicon.svg" type="image/svg+xml">'] if svg else []),
        '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
        '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
        '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/site.webmanifest">',
        f'<meta name="theme-color" content="{color}">',
        '<meta name="msapplication-config" content="/browserconfig.xml">',
    ]
    z.writestr("web/paste-into-head.html", "<!-- Put the files in web/ at the root of your site, then paste this inside <head>. -->\n" + "\n".join(snippet) + "\n")


def _windows(z: zipfile.ZipFile, art: Image.Image, opts: Dict[str, Any]) -> None:
    z.writestr("windows/app.ico", _ico(art, ICO_ALL))
    # MSIX / Microsoft Store assets (scale-100 names; Visual Studio picks them up as they are).
    for fname, size in (("Square44x44Logo.png", 44), ("Square71x71Logo.png", 71), ("Square150x150Logo.png", 150),
                        ("Square310x310Logo.png", 310), ("StoreLogo.png", 50)):
        z.writestr(f"windows/msix/{fname}", _png(_at(art, size)))
    wide = Image.new("RGBA", (310, 150), (0, 0, 0, 0))
    tile = _at(art, 150)
    wide.alpha_composite(tile, (80, 0))
    z.writestr("windows/msix/Wide310x150Logo.png", _png(wide))


def _macos(z: zipfile.ZipFile, art: Image.Image, opts: Dict[str, Any]) -> None:
    z.writestr("macos/app.icns", _icns(art))
    for s in (16, 32, 128, 256, 512):
        z.writestr(f"macos/AppIcon.iconset/icon_{s}x{s}.png", _png(_at(art, s)))
        z.writestr(f"macos/AppIcon.iconset/icon_{s}x{s}@2x.png", _png(_at(art, s * 2)))


IOS_ICONS = [
    # (idiom, points, scales)
    ("iphone", 20, (2, 3)), ("iphone", 29, (2, 3)), ("iphone", 40, (2, 3)), ("iphone", 60, (2, 3)),
    ("ipad", 20, (1, 2)), ("ipad", 29, (1, 2)), ("ipad", 40, (1, 2)), ("ipad", 76, (1, 2)), ("ipad", 83.5, (2,)),
]


def _ios(z: zipfile.ZipFile, plain: Image.Image, opts: Dict[str, Any]) -> None:
    """iOS draws its own rounded corners and refuses transparency: square, opaque art only."""
    bg = opts["solid"]
    images, written = [], set()
    for idiom, pt, scales in IOS_ICONS:
        for sc in scales:
            px = round(pt * sc)
            fname = f"Icon-{px}.png"
            if fname not in written:
                z.writestr(f"ios/AppIcon.appiconset/{fname}", _png(_opaque(_at(plain, px), bg)))
                written.add(fname)
            pts = f"{pt:g}x{pt:g}"
            images.append({"filename": fname, "idiom": idiom, "scale": f"{sc}x", "size": pts})
    z.writestr("ios/AppIcon.appiconset/Icon-1024.png", _png(_opaque(_at(plain, 1024), bg)))
    images.append({"filename": "Icon-1024.png", "idiom": "ios-marketing", "scale": "1x", "size": "1024x1024"})
    z.writestr("ios/AppIcon.appiconset/Contents.json", json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2))


ANDROID_DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def _android(z: zipfile.ZipFile, art: Image.Image, opts: Dict[str, Any]) -> None:
    color = opts["theme"]
    src, pad = opts["source"], opts["padding"]
    round_art = master(src, pad, opts["background"], "circle")
    # Adaptive icons: 108 dp layers, of which the launcher shows the middle 66 dp (the art sits inside 72).
    fg = master(src, max(pad, 0.0) * 0.5 + 0.2, None, "square")
    for name, k in ANDROID_DENSITIES.items():
        legacy = round(48 * k)
        z.writestr(f"android/res/mipmap-{name}/ic_launcher.png", _png(_at(art, legacy)))
        z.writestr(f"android/res/mipmap-{name}/ic_launcher_round.png", _png(_at(round_art, legacy)))
        z.writestr(f"android/res/mipmap-{name}/ic_launcher_foreground.png", _png(_at(fg, round(108 * k))))
    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        "</adaptive-icon>\n"
    )
    z.writestr("android/res/mipmap-anydpi-v26/ic_launcher.xml", adaptive)
    z.writestr("android/res/mipmap-anydpi-v26/ic_launcher_round.xml", adaptive)
    z.writestr("android/res/values/ic_launcher_background.xml",
               f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{color}</color>\n</resources>\n')
    z.writestr("android/playstore-icon.png", _png(_opaque(_at(master(src, pad, opts["solid"], "square"), 512), opts["solid"])))


def _desktop(z: zipfile.ZipFile, art: Image.Image, opts: Dict[str, Any]) -> None:
    for s in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        z.writestr(f"desktop/{s}x{s}.png", _png(_at(art, s)))
    z.writestr("desktop/icon.png", _png(_at(art, 512)))


README = """Your icons
==========

web/       Website and PWA. Put the files at the root of your site and paste
           paste-into-head.html inside <head>. site.webmanifest lists the app icons.
windows/   app.ico holds every size Windows uses (16 to 256 px): use it for .exe files,
           shortcuts and installers. msix/ has the tiles for Microsoft Store apps.
macos/     app.icns for Mac apps (Electron, Tauri, Xcode). AppIcon.iconset is the same
           set as PNGs: `iconutil -c icns AppIcon.iconset` rebuilds the .icns.
ios/       Drag AppIcon.appiconset into Assets.xcassets in Xcode (it replaces AppIcon).
android/   Copy res/ into app/src/main/res. Adaptive icons (Android 8+) use the foreground
           layer on the background colour; older phones use ic_launcher.png.
desktop/   PNGs from 16 to 1024 px for Linux .desktop files, Electron, Flutter and the rest.
"""


def make(payload: Dict[str, Any]) -> Dict[str, Any]:
    from app.services.image import open_image, sanitize_svg

    src_path, name = Path(payload["input"]), payload["name"]
    opts = payload["options"]
    work = Path(payload["work"])
    work.mkdir(parents=True, exist_ok=True)
    try:
        src = open_image(src_path, name)
    except InvalidIconInputError:
        raise
    if getattr(src, "n_frames", 1) > 1:
        src.seek(0)
    src = src.copy()
    if max(src.size) > settings.WORK_SIZE:
        src = ImageOps.contain(src, (settings.WORK_SIZE, settings.WORK_SIZE), Image.Resampling.LANCZOS)
    if min(src.size) < 16:
        raise InvalidIconInputError("That picture is too small to make icons from. Use one at least 256 pixels wide.")
    notes: List[str] = []
    if max(src.size) < 512:
        notes.append(f"Your picture is {max(src.size)} px; large icons (512 px and up) will look soft. Use 1024 px or an SVG for crisp results.")

    background = _rgba(opts.get("background"))
    theme = opts.get("background") or opts.get("theme") or "#ffffff"
    ctx = {
        "source": src,
        "padding": float(opts.get("padding", 0.0)),
        "background": background,
        # Platforms that refuse transparency (iOS, Apple touch icon, Play Store) fall back to white.
        "solid": background or (255, 255, 255, 255),
        "theme": theme,
        "name": (opts.get("name") or Path(name).stem or "App")[:40],
    }
    art = master(src, ctx["padding"], background, opts.get("shape", "square"))
    plain = master(src, ctx["padding"], background, "square")
    svg = None
    if Path(name).suffix.lower() == ".svg" and opts.get("shape", "square") == "square" and not background and not ctx["padding"]:
        svg = sanitize_svg(src_path.read_text(encoding="utf-8", errors="replace"))

    stem = "".join(ch for ch in Path(name).stem if ch.isalnum() or ch in "-_ ")[:60].strip() or "icon"
    mode = opts.get("mode", "pack")
    if mode == "ico":
        sizes = [s for s in opts.get("sizes") or ICO_ALL if s in ICO_ALL]
        if not sizes:
            raise InvalidIconInputError("Pick at least one size for the .ico file.")
        out = work / f"{stem}.ico"
        out.write_bytes(_ico(art, sizes))
        return {"path": str(out), "notes": notes, "files": 1}

    packs = [p for p in opts.get("packs") or [] if p in PACKS]
    if not packs:
        raise InvalidIconInputError("Pick at least one platform.")
    if background is None and ("ios" in packs or "web" in packs):
        notes.append("iOS and the Apple touch icon can't be transparent, so those got a white background.")
    out = work / f"{stem}-icons.zip"
    try:
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for pack in packs:
                if pack == "web":
                    _web(z, art, plain, ctx, svg)
                elif pack == "windows":
                    _windows(z, art, ctx)
                elif pack == "macos":
                    _macos(z, art, ctx)
                elif pack == "ios":
                    _ios(z, plain, ctx)
                elif pack == "android":
                    _android(z, art, ctx)
                elif pack == "desktop":
                    _desktop(z, art, ctx)
            z.writestr("README.txt", README)
            count = len(z.namelist())
    except (InvalidIconInputError, IconProcessingError):
        raise
    except Exception as exc:
        raise IconProcessingError("The icons couldn't be drawn from that picture.") from exc
    return {"path": str(out), "notes": notes, "files": count}
