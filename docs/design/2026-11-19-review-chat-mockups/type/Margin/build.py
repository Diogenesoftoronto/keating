# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.68.0", "brotli==1.2.1", "skia-pathops==0.9.2"]
# ///
"""Build Keating Margin from drawings.py with 'uv run build.py'."""

from pathlib import Path
import unicodedata
import sys

sys.dont_write_bytecode = True

import pathops
from fontTools import agl
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

from drawings import DOTS, EXTRAS, FIGURES, LIGATURES, LOWER, MARKS, SIGNS, UPPER


HERE = Path(__file__).resolve().parent
SLANT = 0.043
BEARING = 45
EPOCH = 3_877_747_200  # Reproducible OpenType timestamp (from 1904).


def drawing(data):
    path = pathops.Path()
    if data:
        parse_path(data, path.getPen())
    return path


def ink(data, width=74):
    """Slightly canted, soft-cut felt nib. Expand and union the pen route."""
    if not data:
        return pathops.Path()
    # Normalize the pen route into the nib's coordinate system before stroking.
    path = drawing(data).transform(1, -0.17 / 0.81, 0, 1 / 0.81)
    path.stroke(width - 8, pathops.LineCap.BUTT_CAP, pathops.LineJoin.ROUND_JOIN, 3)
    path.convertConicsToQuads()
    path.simplify()
    edge = pathops.Path(path)
    edge.stroke(8, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 3)
    edge.convertConicsToQuads()
    return pathops.op(path, edge, pathops.PathOp.UNION).transform(1, 0.17, 0, 0.81)


def join(paths):
    paths = [path for path in paths if len(path)]
    if not paths:
        return pathops.Path()
    result = paths[0]
    for path in paths[1:]:
        result = pathops.op(result, path, pathops.PathOp.UNION)
    result.simplify(clockwise=True)
    return result


def dot(x, y, scale=1):
    # An off-axis, rounded diamond echoes the mark a broad pen leaves on paper.
    return drawing("M-40 -12 Q-43 -5 -35 4 L-1 43 Q6 50 13 42 L41 10 Q47 2 39 -7 L4 -43 Q-3 -50 -10 -43 Z").transform(scale, 0, 0, scale, x, y)


def glyph_name(char):
    return agl.UV2AGL.get(ord(char), f"uni{ord(char):04X}")


def convert(outline):
    pen = TTGlyphPen(None)
    if len(outline):
        outline.simplify(clockwise=True)
        outline.draw(Cu2QuPen(pen, max_err=0.65))
    return pen.glyph()


def mark_form(mark):
    if mark == "\u0307":
        return dot(0, 24, 0.84)
    if mark == "\u0308":
        return join([dot(-83, 25, 0.87), dot(83, 32, 0.87)])
    width = 44 if mark == "\u030a" else 56
    return ink(MARKS[mark], width)


def build():
    shapes = {}
    widths = {}

    def add(name, path, advance):
        shapes[name] = path
        widths[name] = round(advance)

    add(".notdef", ink("M55 35 L55 635 L394 635 L394 35 Z M55 35 L394 635", 58), 450)
    add("space", pathops.Path(), 231)
    cmap = {32: "space", 160: "space", 0x202F: "thinspace"}
    add("thinspace", pathops.Path(), 150)
    all_paths = {**LOWER, **UPPER, **FIGURES, **SIGNS, **EXTRAS}
    for char in DOTS:
        all_paths.setdefault(char, "")
    for char, data in all_paths.items():
        pen_width = 78
        if char in UPPER or char in FIGURES:
            pen_width = 79
        if char in "@%©*":
            pen_width = 60
        points = [dot(x, y, 1.55 if char == "•" else 0.95 if char == "0" else 1.1 if char in ".:;!?¡¿…·" else 1) for x, y in DOTS.get(char, [])]
        path = join([ink(data, pen_width), *points]).transform(1, 0, SLANT, 1)
        left, bottom, right, top = path.bounds
        lsb, rsb = {
            "f": (26, -21), "j": (-27, 34), "r": (44, 24), "t": (27, 26),
            "v": (25, 23), "w": (27, 25), "x": (26, 27), "y": (12, 23),
            "A": (23, 20), "T": (23, 25), "V": (21, 21), "W": (24, 21),
            "Y": (22, 22), "J": (24, 34), ".": (52, 52), ",": (40, 48),
            "i": (45, 43), "l": (42, 26), "I": (33, 32),
        }.get(char, (BEARING, BEARING))
        # Dotless forms retain their dotted sibling's stem position and advance.
        if char in "ıȷ":
            sibling = "i" if char == "ı" else "j"
            base_ink = join([ink(LOWER[sibling], pen_width), *[dot(x, y) for x, y in DOTS[sibling]]]).transform(1, 0, SLANT, 1)
            sibling_lsb = 45 if char == "ı" else -27
            lsb = left - base_ink.bounds[0] + sibling_lsb
            advance = widths[glyph_name(sibling)]
        elif char in FIGURES:
            advance = 468
            lsb = (advance - right + left) / 2
        else:
            advance = right - left + lsb + rsb
        name = glyph_name(char)
        add(name, path.transform(translateX=lsb - left), advance)
        cmap[ord(char)] = name

    for letters, design in LIGATURES.items():
        parts = [ink(design["path"], 78)]
        if "dot" in design:
            parts.append(dot(*design["dot"]))
        form = join(parts).transform(1, 0, SLANT, 1)
        form = form.transform(translateX=26 - form.bounds[0])
        add("_".join(letters), form, design["advance"])

    mark_shapes = {mark: mark_form(mark) for mark in MARKS}
    for mark, path in mark_shapes.items():
        add(glyph_name(mark), path, 0)
        cmap[ord(mark)] = glyph_name(mark)

    def anchor(char, mark):
        form = shapes[glyph_name(char)]
        left, bottom, right, top = form.bounds
        if mark in "\u0327\u0328":
            return round((left + right) * 0.5 + (60 if mark == "\u0328" else 0)), round(bottom + 8)
        if char.lower() == "i":
            center = (left + right) * 0.5 + 6
        else:
            center = (left + right) * 0.5 + 13
        # Accents sit over the bowl of narrow-shouldered letters.
        if char in "rn":
            center += 18
        return round(center), round(top + 93)

    # Generate precomposed Latin letters only when the drawing for both
    # parts exists. Combining marks share the same live anchors below.
    for value in range(0xC0, 0x250):
        char = chr(value)
        decomp = unicodedata.normalize("NFD", char)
        if len(decomp) != 2 or decomp[0] not in all_paths or decomp[1] not in MARKS:
            continue
        base, mark = decomp
        if base in "ij" and mark not in "\u0327\u0328":
            base = "ı" if base == "i" else "ȷ"
        base_name = glyph_name(base)
        x, y = anchor(base, mark)
        accent = mark_shapes[mark].transform(translateX=x, translateY=y)
        # Latvian small g takes a turned comma above. A tall Czech or
        # Slovak ascender takes its caron to the right of the stem.
        advance = widths[base_name]
        if char == "ģ":
            accent = ink("M-24 0 Q-38 52 27 110", 51).transform(translateX=x + 24, translateY=shapes["g"].bounds[3] + 48)
        elif char in "ďťľĽ":
            top = shapes[base_name].bounds[3]
            stem = {"ď": advance - 22, "ť": advance - 92, "ľ": advance - 57, "Ľ": 197}[char]
            accent = ink("M25 0 Q52 49 54 118", 49).transform(translateX=stem, translateY=top - 103)
            advance = max(advance, accent.bounds[2] + 14)
        add(glyph_name(char), join([shapes[base_name], accent]), advance)
        cmap[value] = glyph_name(char)

    # An acute on lowercase i uses its otherwise identical dotless outline.
    # Register canonical ccmp composition for decomposed text before mark positioning.
    order = list(shapes)
    glyphs = {name: convert(shape) for name, shape in shapes.items()}
    metrics = {name: (widths[name], round(shape.bounds[0]) if len(shape) else 0) for name, shape in shapes.items()}
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=970, descent=-252, lineGap=0)
    fb.setupOS2(version=4, sTypoAscender=970, sTypoDescender=-252, sTypoLineGap=0,
                usWinAscent=975, usWinDescent=252, sxHeight=510, sCapHeight=710,
                usWeightClass=400, fsSelection=0xC0, usWidthClass=5)
    fb.setupNameTable({"familyName": "Keating Margin", "styleName": "Regular",
                       "fullName": "Keating Margin Regular", "psName": "KeatingMargin-Regular",
                       "uniqueFontIdentifier": "Keating Margin Regular 1.100",
                       "version": "Version 1.100",
                       "description": "Original pen lettering for short lesson notes and classroom annotations."})
    fb.setupPost(underlinePosition=-111, underlineThickness=57)
    fb.setupMaxp()
    fb.font["head"].fontRevision = 1.1
    fb.font["head"].created = EPOCH
    fb.font["head"].modified = EPOCH
    fb.font.recalcTimestamp = False
    features = ["languagesystem DFLT dflt;", "languagesystem latn dflt;"]
    precompose = []
    for code, name in sorted(cmap.items()):
        decomp = unicodedata.normalize("NFD", chr(code))
        if len(decomp) == 2 and all(ord(part) in cmap for part in decomp):
            precompose.append(f"sub {cmap[ord(decomp[0])]} {cmap[ord(decomp[1])]} by {name};")
    features.append("feature ccmp {\n" + "\n".join(precompose) + "\n} ccmp;")
    features.append("feature liga {")
    for letters in sorted(LIGATURES, key=len, reverse=True):
        features.append(f"sub {' '.join(letters)} by {'_'.join(letters)};")
    features.append("} liga;")
    features.append("table GDEF {")
    for letters, design in LIGATURES.items():
        carets = " ".join(str(x) for x in design["carets"])
        features.append(f"LigatureCaretByPos {'_'.join(letters)} {carets};")
    features.append("} GDEF;")
    for mark in MARKS:
        group = "below" if mark in "\u0327\u0328" else "above"
        features.append(f"markClass {glyph_name(mark)} <anchor 0 0> @MC_{group};")
    features.append("feature mark {")
    for char in {**LOWER, **UPPER, "ı": "", "ȷ": ""}:
        x, y = anchor(char, "\u0301")
        bx, by = anchor(char, "\u0327")
        features.append(f"pos base {glyph_name(char)} <anchor {x} {y}> mark @MC_above <anchor {bx} {by}> mark @MC_below;")
    for letters, design in LIGATURES.items():
        anchors = [
            f"<anchor {x} {y}> mark @MC_above <anchor {x - 28} -3> mark @MC_below"
            for x, y in design["centers"]
        ]
        features.append(f"pos ligature {'_'.join(letters)} {' ligComponent '.join(anchors)};")
    features.append("} mark;")
    features.append("feature kern {")
    pairs = {
        "A": [("TVWY", -45), ("vwy", -20)], "F": [("acdegoq", -37), ("A", -48)],
        "L": [("TVWY", -53), ("vwy", -25)], "P": [("A", -50), ("aeo", -16)],
        "T": [("A", -41), ("acdegoqsu", -50), ("nrvy", -32), (".,", -54)],
        "V": [("A", -45), ("acdegoqs", -40), (".,", -51)],
        "W": [("A", -32), ("acdegoqs", -26)], "Y": [("A", -48), ("acdegoqs", -52), (".,", -52)],
        "r": [(".,", -32)], "v": [(".,", -37)], "w": [(".,", -29)], "y": [(".,", -36)],
    }
    for first, groups in pairs.items():
        for seconds, value in groups:
            for second in seconds:
                features.append(f"pos {glyph_name(first)} {glyph_name(second)} {value};")
    features.append("} kern;")
    addOpenTypeFeaturesFromString(fb.font, "\n".join(features))
    for extension, flavor in [("ttf", None), ("woff2", "woff2")]:
        fb.font.flavor = flavor
        fb.font.save(HERE / f"KeatingMargin-Regular.{extension}")


if __name__ == "__main__":
    build()
