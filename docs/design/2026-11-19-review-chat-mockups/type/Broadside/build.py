# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools>=4.50", "brotli", "shapely>=2.0", "numpy"]
# ///
"""Build Keating Broadside from its drawing source.

    uv run build.py            # writes KeatingBroadside-Regular.ttf / .woff2

No font editor and no third-party font data is involved: src/glyphs.py draws
the letters, src/kit.py turns them into outlines, this file assembles the
font tables, spacing and kerning.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from fontTools.agl import UV2AGL  # noqa: E402
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString  # noqa: E402
from fontTools.fontBuilder import FontBuilder  # noqa: E402
from fontTools.pens.cu2quPen import Cu2QuPen  # noqa: E402
from fontTools.pens.ttGlyphPen import TTGlyphPen  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402
from shapely.geometry import box  # noqa: E402

import glyphs  # noqa: E402
import kit  # noqa: E402

FAMILY = "Keating Broadside"
STYLE = "Regular"
VERSION = "1.100"
UPM = 1000
ASCENT, DESCENT = 960, -240

SPECIAL_NAMES = {"dotlessj": 0x0237, "dotlessi": 0x0131}


def glyph_name(key):
    if key in SPECIAL_NAMES:
        return key, SPECIAL_NAMES[key]
    if key in glyphs.LIGATURES:
        return key, glyphs.LIGATURES[key][2]
    if len(key) == 1:
        cp = ord(key)
        names = UV2AGL.get(cp)
        if isinstance(names, (list, tuple)):
            names = names[0] if names else None
        return (names or "uni%04X" % cp), cp
    return key, None  # unencoded helper glyph


# ------------------------------------------------------------------ kerning
STRIP = 20
Y0, Y1 = -240, 960


def profile(shape):
    """Left and right edge of a glyph in horizontal strips."""
    lo, hi = {}, {}
    if shape is None or shape.is_empty:
        return lo, hi
    for i, y in enumerate(range(Y0, Y1, STRIP)):
        hit = shape.intersection(box(-4000, y, 4000, y + STRIP))
        if hit.is_empty:
            continue
        b = hit.bounds
        lo[i], hi[i] = b[0], b[2]
    return lo, hi


def spread(prof, fn, reach=2):
    out = {}
    for i in prof:
        for d in range(-reach, reach + 1):
            j = i + d
            out[j] = fn(out[j], prof[i]) if j in out else prof[i]
    return out


def autokern(G, keys, open_gap=92, tight_gap=38, gain=0.82, floor=-120, minimum=12):
    prof = {}
    for k in keys:
        shape, adv = G[k]
        lo, hi = profile(shape)
        prof[k] = (spread(lo, min), spread(hi, max), adv)
    pairs = {}
    for a in keys:
        _, hia, adva = prof[a]
        if not hia:
            continue
        for b in keys:
            lob = prof[b][0]
            common = hia.keys() & lob.keys()
            if not common:
                continue
            gap = min(adva - hia[i] + lob[i] for i in common)
            if gap > open_gap:
                k = -(gap - open_gap) * gain
            elif gap < tight_gap:
                k = tight_gap - gap
            else:
                continue
            k = max(floor, k)
            if len(common) < 6:  # only a sliver faces each other: go easy
                k *= 0.5
            k = int(round(k / 2.0)) * 2
            if abs(k) >= minimum:
                pairs[(a, b)] = k
    return pairs


# -------------------------------------------------------------------- build
def build(out_dir=HERE, verbose=True):
    t0 = time.time()
    G = glyphs.build_all()
    order = [".notdef"]
    cmap = {}
    names = {}
    for key in G:
        name, cp = glyph_name(key)
        names[key] = name
        if name not in order:
            order.append(name)
        if cp is not None:
            cmap[cp] = name
    if " " in G:
        cmap[0xA0] = names[" "]

    glyf, metrics = {}, {}
    notdef = kit.rect(60, 0, 440, 700).difference(kit.rect(106, 46, 394, 654))
    shapes = {".notdef": (notdef, 500)}
    for key, (shape, adv) in G.items():
        if shape is not None and not shape.is_empty:
            shape = kit.soften(shape, *glyphs.SOFT.get(key, glyphs.SOFT_DEFAULT))
        shapes[names[key]] = (shape, adv)
    for name in order:
        shape, adv = shapes[name]
        tt = TTGlyphPen(None)
        if shape is not None and not shape.is_empty:
            pen = Cu2QuPen(tt, max_err=0.5, reverse_direction=False)
            kit.draw(shape, pen)
        g = tt.glyph()
        glyf[name] = g
        lsb = int(round(shape.bounds[0])) if shape is not None and not shape.is_empty else 0
        metrics[name] = (int(round(adv)), lsb)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyf)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT, lineGap=0)
    fb.setupNameTable(
        {
            "familyName": FAMILY,
            "styleName": STYLE,
            "uniqueFontIdentifier": f"{FAMILY} {STYLE} {VERSION}",
            "fullName": f"{FAMILY} {STYLE}",
            "psName": "KeatingBroadside-Regular",
            "version": f"Version {VERSION}",
            "designer": "Keating design pass, 2026",
            "description": "Original display face drawn in code for Keating headlines. "
            "Waisted stems, wedge arms, beaked terminals, lozenge points.",
        }
    )
    fb.setupOS2(
        version=4,
        sTypoAscender=ASCENT,
        sTypoDescender=DESCENT,
        sTypoLineGap=0,
        usWinAscent=ASCENT + 20,
        usWinDescent=-DESCENT + 20,
        sxHeight=glyphs.XH,
        sCapHeight=glyphs.CAP,
        usWeightClass=400,
        usWidthClass=4,
        fsSelection=0x40 | 0x80,  # REGULAR | USE_TYPO_METRICS
        achVendID="KTNG",
        fsType=0,
        panose=dict(
            bFamilyType=2, bSerifStyle=0, bWeight=8, bProportion=6, bContrast=7,
            bStrokeVariation=0, bArmStyle=0, bLetterForm=0, bMidline=0, bXHeight=0,
        ),
    )
    fb.setupPost(underlinePosition=-110, underlineThickness=46)
    font = fb.font
    font["head"].fontRevision = float(VERSION)

    kern_keys = [k for k in G if k not in glyphs.NO_KERN and G[k][0] is not None and not G[k][0].is_empty]
    soft = {k: (shapes[names[k]][0], G[k][1]) for k in kern_keys}
    pairs = autokern(soft, kern_keys)
    pairs.update({k: v for k, v in glyphs.KERN_OVERRIDES.items() if k[0] in G and k[1] in G})
    lines = ["languagesystem DFLT dflt;", "languagesystem latn dflt;"]
    # ligatures: f-ligatures are standard (on by default), ct / st are
    # discretionary (opt-in). Longest sequences first.
    ligs = sorted(glyphs.LIGATURES.items(), key=lambda kv: -len(kv[1][0]))
    for feature in ("liga", "dlig"):
        rules = [(k, parts) for k, (parts, feat, _) in ligs if feat == feature and k in G]
        if rules:
            lines.append(f"feature {feature} {{")
            for k, parts in rules:
                lines.append(f"  sub {' '.join(names[p] for p in parts)} by {names[k]};")
            lines.append(f"}} {feature};")
    lines.append("feature kern {")
    for (a, b), v in sorted(pairs.items(), key=lambda kv: (names[kv[0][0]], names[kv[0][1]])):
        if v:
            lines.append(f"  pos {names[a]} {names[b]} {v};")
    lines.append("} kern;")
    carets = {k: v for k, v in glyphs.CARETS.items() if k in G}
    if carets:
        lines.append("table GDEF {")
        for k, xs in carets.items():
            lines.append(f"  LigatureCaretByPos {names[k]} {' '.join(str(int(x)) for x in xs)};")
        lines.append("} GDEF;")
    addOpenTypeFeaturesFromString(font, "\n".join(lines))

    ttf = os.path.join(out_dir, "KeatingBroadside-Regular.ttf")
    woff2 = os.path.join(out_dir, "KeatingBroadside-Regular.woff2")
    font.save(ttf)
    w = TTFont(ttf)
    w.flavor = "woff2"
    w.save(woff2)
    if verbose:
        npts = sum(len(getattr(g, "coordinates", [])) for g in glyf.values())
        print(
            f"{len(order)} glyphs, {len(cmap)} code points, {len(pairs)} kern pairs, {npts} points, "
            f"ttf {os.path.getsize(ttf) / 1024:.1f}K, woff2 {os.path.getsize(woff2) / 1024:.1f}K, "
            f"{time.time() - t0:.1f}s"
        )
    return ttf, woff2


if __name__ == "__main__":
    build()
