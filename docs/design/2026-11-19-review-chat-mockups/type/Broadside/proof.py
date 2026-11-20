"""Render proof sheets of the built font (needs Pillow; dev-only helper).

    python proof.py OUT.png "line one" "line two" ... [--size 150] [--paper]

Ligatures need Pillow built with Raqm. Standard ligatures are on; prefix a
line with "dlig:" to switch the discretionary ct / st on, or "noliga:" to
switch the standard ones off, for that line.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "KeatingBroadside-Regular.ttf")
TEX = os.path.join(HERE, "..", "..", "textures", "tex-paper.webp")


def main():
    args = sys.argv[1:]
    out = args.pop(0)
    size, paper, ink = 150, False, (28, 33, 27)
    lines = []
    while args:
        a = args.pop(0)
        if a == "--size":
            size = int(args.pop(0))
        elif a == "--paper":
            paper = True
        elif a == "--ink":
            ink = tuple(int(args.pop(0)[i : i + 2], 16) for i in (0, 2, 4)) if False else ink
        else:
            feats = None
            if a.startswith("dlig:"):
                a, feats = a[5:], ["dlig"]
            elif a.startswith("noliga:"):
                a, feats = a[7:], ["-liga"]
            lines.append((a, feats))
    font = ImageFont.truetype(FONT, size, layout_engine=ImageFont.Layout.RAQM if hasattr(ImageFont, "Layout") else None)
    lead = int(size * 1.12)
    w = max(int(font.getlength(l, features=f)) for l, f in lines) + size
    h = lead * len(lines) + size // 2
    img = Image.new("RGB", (w, h), (241, 236, 224))
    if paper and os.path.exists(TEX):
        tex = Image.open(TEX).convert("RGB")
        for x in range(0, w, tex.width):
            for y in range(0, h, tex.height):
                img.paste(tex, (x, y))
    d = ImageDraw.Draw(img)
    for i, (l, f) in enumerate(lines):
        d.text((size // 2, size // 4 + i * lead), l, font=font, fill=ink, features=f)
    img.save(out)
    print(out, img.size)


if __name__ == "__main__":
    main()
