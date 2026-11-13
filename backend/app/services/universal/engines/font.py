"""Fonts with fontTools: TTF, OTF, WOFF and WOFF2 into one another."""

from pathlib import Path

from app.exceptions.universal import InvalidUniversalInputError, UniversalConversionError
from app.services.universal.engines.common import Ctx, ensure, output


def _cff_to_truetype(font) -> None:
    """
    PostScript (CFF) outlines → TrueType quadratic outlines, so a .ttf is a real TrueType font.
    Follows fontTools' own otf2ttf recipe.
    """
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import newTable

    glyph_order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for name in glyph_order:
        tt_pen = TTGlyphPen(glyph_set)
        glyph_set[name].draw(Cu2QuPen(tt_pen, max_err=1.0, reverse_direction=True))
        glyphs[name] = tt_pen.glyph()

    font["loca"] = newTable("loca")
    font["glyf"] = glyf = newTable("glyf")
    glyf.glyphOrder = glyph_order
    glyf.glyphs = glyphs
    del font["CFF "]
    if "VORG" in font:
        del font["VORG"]
    glyf.compile(font)
    hmtx = font["hmtx"]
    for name, glyph in glyf.glyphs.items():
        if hasattr(glyph, "xMin"):
            hmtx[name] = (hmtx[name][0], glyph.xMin)

    font["maxp"] = maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    for attr in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs",
                 "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, attr, 1 if attr == "maxZones" else 0)
    maxp.compile(font)
    post = font["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = glyph_order
    try:
        post.compile(font)
    except OverflowError:
        post.formatType = 3.0
    font.sfntVersion = "\000\001\000\000"


def convert(src: Path, target: str, work: Path, final: bool, ctx: Ctx) -> Path:
    from fontTools.ttLib import TTFont, TTLibError

    try:
        # Bounding boxes are recalculated on save: glyphs redrawn as TrueType have none until then.
        font = TTFont(str(src), recalcTimestamp=False)
    except (TTLibError, OSError, AssertionError) as exc:
        raise InvalidUniversalInputError("That font couldn't be read. Is it a working font file?") from exc
    out = output(work, ctx, target)
    try:
        if target in ("woff", "woff2"):
            font.flavor = target
        else:
            font.flavor = None
            if target == "ttf" and "CFF2" in font:
                raise InvalidUniversalInputError("Variable PostScript fonts (CFF2) can't be made into TTF. Choose OTF.")
            if target == "ttf" and "CFF " in font:
                _cff_to_truetype(font)
                ctx.notes.append("PostScript outlines were redrawn as TrueType curves.")
        font.save(str(out))
    except InvalidUniversalInputError:
        raise
    except Exception as exc:
        raise UniversalConversionError(f"The font couldn't be saved as {target.upper()}.") from exc
    finally:
        font.close()
    return ensure(out)
