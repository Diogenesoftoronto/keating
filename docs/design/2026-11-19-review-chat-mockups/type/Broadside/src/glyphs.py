"""Keating Broadside: the letter drawings.

Every glyph is drawn here from first principles with the primitives in
kit.py. Nothing is traced or derived from an existing font.

Design DNA
  * condensed, heavy, vertical-stress contrast (stem 136/150, hair 44/46)
  * waisted stems that swell toward their ends, like worn wood type
  * arms that grow into wedges with a vertical cut
  * curve terminals cut vertically with a hanging "beak"
  * hairline branches that spring from low on the stem
  * rhombic (lozenge) dots and points
"""
from kit import *  # noqa: F401,F403

XH, CAP, ASC, DSC, OS = 500, 700, 740, -200, 12
s, S = 136, 150  # lowercase / capital stem
t, T = 44, 46  # hairlines
FL, FLC = 9, 10  # stem swell
BOWL = 142

G = {}  # char -> (shape, advance)


def put(ch, shape, adv):
    G[ch] = (shape, adv)


def sh(ch):
    return G[ch][0]


def adv(ch):
    return G[ch][1]


def lstem(xl, y0=0, y1=XH, w=s, ft=FL, fb=FL):
    return stem(xl, y0, y1, w, ft, fb)


def cstem(xl, y0=0, y1=CAP, w=S, ft=FLC, fb=FLC):
    return stem(xl, y0, y1, w, ft, fb)


def arch(xs, xr, ys=236, top=XH + OS, w=s, yleg=290, start=34, lean=26):
    """Hairline branch springing from inside a stem at xs, over to a leg
    whose right edge is xr."""
    xc = xr - w / 2
    st = stroke(
        [
            (xs, ys, 84, start, 0.46),
            ((xs + xc) / 2 + lean, top - t / 2, 0, t + 2),
            (xc, yleg, 270, w),
            (xc, yleg - 40, 270, w),
        ]
    )
    return U(st, stem(xr - w, 0, yleg, w, 0, FL))


def rbowl(xe, xr, bot=-OS, top=XH + OS, w=BOWL, hair=t, ya=None, yb=None):
    """Bowl hung on the right of a stem whose right edge is xe."""
    xs = xe - 22
    cy = (bot + top) / 2
    h = top - bot
    ya = cy - h * 0.02 if ya is None else ya
    yb = cy + h * 0.02 if yb is None else yb
    xm = (xs + xr - w / 2) / 2 + 22
    return stroke(
        [
            (xs, ya, 84, 34, 0.46),
            (xm, top - hair / 2, 0, hair),
            (xr - w / 2, cy, 270, w),
            (xm, bot + hair / 2, 180, hair, 0.46),
            (xs, yb, 96, 34),
        ]
    )


# ------------------------------------------------------------------ lowercase
def lowercase():
    put("o", oval(28, 456, -OS, XH + OS, BOWL, t), 512)

    n = U(lstem(44), arch(160, 488))
    put("n", n, 528)
    put("u", rot180(n, 264, 250), 528)
    put("h", U(lstem(44, 0, ASC), arch(160, 488)), 528)
    put("m", U(lstem(44), arch(160, 466, lean=12), arch(446, 752, lean=12)), 792)

    r = U(lstem(44), stroke([(160, 236, 84, 34, 0.46), (318, 487, 0, 52), (392, 462, -32, 66)]))
    r = beak(r, 356, (300, 600), "R", "down", h=124, depth=128, thin=50)
    put("r", r, 372)

    put("dotlessi", lstem(44), 224)
    put("i", U(lstem(44), diamond(112, 662, 84, 88)), 224)
    put("l", lstem(44, 0, ASC), 224)

    jt = stroke([(112, 60, 270, s), (112, -50, 270, s), (12, -177, 180, 50), (-58, -146, 138, 58)])
    jt = beak(jt, -34, (-260, -60), "L", "up", h=92, depth=96, thin=48)
    put("dotlessj", U(stem(44, 40, XH, s, FL, 0), jt), 224)
    put("j", U(sh("dotlessj"), diamond(112, 662, 84, 88)), 224)

    b = U(lstem(44, 0, ASC), rbowl(180, 494))
    put("b", b, 522)
    put("d", mirror_x(b, 261), 522)
    p = U(lstem(44, DSC, XH), rbowl(180, 494))
    put("p", p, 522)
    put("q", mirror_x(p, 261), 522)

    # g: q's bowl, the stem swinging into a beaked tail
    gt = stroke([(410, 60, 270, s), (410, -44, 270, s), (252, -187, 180, 48), (84, -118, 128, 60)])
    gt = beak(gt, 106, (-260, -40), "L", "up", h=96, depth=110, thin=48)
    put("g", U(mirror_x(rbowl(180, 494), 261), stem(342, 40, XH, s, FL, 0), gt), 522)

    # a
    top = stroke([(368, 240, 90, s), (368, 322, 90, s), (214, 490, 180, t + 2), (72, 404, 236, 58)])
    top = beak(top, 62, (300, 600), "L", "down", h=92, depth=112, thin=48)
    bowl = stroke(
        [(336, 250, 180, 40), (196, 270, 180, t), (88, 138, 270, 120), (196, 10, 0, t), (336, 84, 58, 40)]
    )
    put("a", U(top, bowl, stem(300, 0, 250, s, 0, FL)), 476)

    # e
    lx, w = 28, 446
    cx = lx + w / 2
    e = stroke(
        [
            (lx + w - 62, 290, 90, 124),
            (cx, 490, 180, t),
            (lx + 71, 250, 270, BOWL),
            (cx + 8, 10, 0, t),
            (lx + w - 14, 104, 60, 40),
        ]
    )
    e = e.difference(rect(cx, 150, BIG, 240))
    e = U(e, rect(lx + 71, 240, lx + w - 20, 240 + t))
    e = beak(e, lx + w - 14, (-40, 200), "R", "up", h=0)
    put("e", e, w + 50)

    # c
    lx, w = 28, 420
    cx = lx + w / 2
    c = stroke(
        [
            (lx + w - 18, 396, 122, 62),
            (cx + 14, 490, 180, t),
            (lx + 71, 250, 270, BOWL),
            (cx + 14, 10, 0, t),
            (lx + w - 6, 106, 60, 40),
        ]
    )
    c = beak(c, lx + w - 30, (300, 600), "R", "down", h=112, depth=124, thin=48)
    c = beak(c, lx + w - 12, (-40, 200), "R", "up", h=0)
    put("c", c, w + 34)

    # s
    sp = stroke(
        [
            (436, 388, 118, 60),
            (238, 490, 180, t),
            (90, 366, 270, 118),
            (232, 250, -34, 132),
            (374, 134, 270, 118),
            (226, 10, 180, t),
            (28, 112, 118, 60),
        ]
    )
    sp = beak(sp, 420, (300, 600), "R", "down", h=104, depth=118, thin=48)
    sp = beak(sp, 44, (-100, 200), "L", "up", h=104, depth=118, thin=48)
    put("s", sp, 464)

    # t
    tt = stroke([(124, 430, 270, s), (124, 150, 270, s), (238, 11, 0, 48), (330, 70, 52, 44)])
    tt = beak(tt, 314, (-40, 200), "R", "up", h=0)
    tt = U(tt, poly([(56, 420), (192, 420), (192, 660), (56, 586)]), rect(8, XH - t, 304, XH))
    put("t", tt, 326)

    # f
    hook = stroke([(128, 480, 90, s), (128, 560, 90, s), (252, ASC + OS - 24, 0, 50), (344, 694, -38, 62)])
    hook = beak(hook, 318, (500, 800), "R", "down", h=100, depth=110, thin=50)
    put("f", U(stem(60, 0, 500, s, 0, FL), hook, rect(8, XH - t, 296, XH)), 300)

    # k
    karm = diag(150, 216, 398, 468, 170, XH)
    kleg = diag(356, 518, 136, 298, 0, XH).intersection(halfplane((150, 170), (398, XH)))
    put("k", U(lstem(44, 0, ASC), karm, kleg), 524)

    put("v", U(diag(186, 318, 14, 172, -8, XH), diag(254, 318, 394, 458, -8, XH)), 472)
    put(
        "w",
        U(
            diag(178, 300, 14, 172, -8, XH),
            diag(242, 300, 334, 396, -8, XH),
            diag(464, 586, 300, 458, -8, XH),
            diag(528, 586, 648, 712, -8, XH),
        ),
        726,
    )
    put("x", U(diag(296, 458, 18, 180, 0, XH), diag(22, 88, 380, 446, 0, XH)), 474)

    yt = stroke([(300, 42, 254.6, 60), (268, -74, 254.6, 58), (160, -182, 180, 50), (66, -146, 136, 58)])
    yt = beak(yt, 86, (-260, -60), "L", "up", h=92, depth=96, thin=48)
    put("y", U(diag(186, 318, 14, 172, -8, XH), diag(254, 318, 394, 458, -8, XH), yt), 472)

    put(
        "z",
        U(
            arm(428, 40, XH, t, 72, "down"),
            arm(28, 428, 0, t, 72, "up"),
            diag(28, 190, 266, 428, 0, XH),
        ),
        456,
    )


# ------------------------------------------------------------------ ligatures
# key -> (components, feature, code point or None)
LIGATURES = {
    "f_f_i": (["f", "f", "i"], "liga", 0xFB03),
    "f_f_l": (["f", "f", "l"], "liga", 0xFB04),
    "f_f": (["f", "f"], "liga", 0xFB00),
    "f_i": (["f", "i"], "liga", 0xFB01),
    "f_l": (["f", "l"], "liga", 0xFB02),
    "c_t": (["c", "t"], "dlig", None),
    "s_t": (["s", "t"], "dlig", 0xFB06),
}
CARETS = {}  # key -> x positions between components

FF = 292  # stem to stem inside the f ligatures
FI = 304


def f_foot(x=0):
    return stem(x + 60, 0, 500, s, 0, FL)


def f_beak(x=0, reach=0.0, h=100):
    """The f's own hook; `reach` carries it further over a following letter."""
    hook = stroke(
        [
            (x + 128, 480, 90, s),
            (x + 128, 560, 90, s),
            (x + 252 + reach * 0.5, ASC + OS - 24, 0, 50),
            (x + 344 + reach, 694, -38, 62),
        ]
    )
    return beak(hook, x + 318 + reach, (500, 800), "R", "down", h=h, depth=110, thin=50)


def f_link(x, d):
    """A lower hairline hook that runs into the flank of the next f, d away."""
    return stroke(
        [
            (x + 128, 480, 90, s),
            (x + 128, 520, 90, s),
            (x + 250, 652, 0, t + 2),
            (x + d + 100, 640, -10, t),
        ]
    )


def f_gate(x, d):
    """Hook that levels out at ascender height and lands on an l, d away."""
    return U(
        stroke(
            [
                (x + 128, 480, 90, s),
                (x + 128, 560, 90, s),
                (x + 262, ASC - 25, 0, 50),
                (x + d + 80, ASC - 25, 0, 50),
            ]
        ),
        stem(x + d + 60, 0, ASC, s, FL, FL),
    )


def f_dot(x, d):
    """Long hook whose beak hangs over an i stem (d away) in place of its dot."""
    return U(f_beak(x, reach=d - 150, h=128), stem(x + d + 60, 0, XH, s, FL, FL))


def ligatures():
    bar = lambda x1: rect(8, XH - t, x1, XH)  # noqa: E731
    f1, f2 = f_foot(0), f_foot(FF)

    put("f_f", U(f1, f_link(0, FF), f2, f_beak(FF), bar(FF + 296)), FF + 300)
    CARETS["f_f"] = [FF + 16]

    put("f_i", U(f1, f_dot(0, FI), bar(FI + 70)), FI + 240)
    CARETS["f_i"] = [FI + 30]

    put("f_l", U(f1, f_gate(0, FI), bar(FI + 70)), FI + 240)
    CARETS["f_l"] = [FI + 30]

    put("f_f_i", U(f1, f_link(0, FF), f2, f_dot(FF, FI), bar(FF + FI + 70)), FF + FI + 240)
    CARETS["f_f_i"] = [FF + 16, FF + FI + 30]

    put("f_f_l", U(f1, f_link(0, FF), f2, f_gate(FF, FI), bar(FF + FI + 70)), FF + FI + 240)
    CARETS["f_f_l"] = [FF + 16, FF + FI + 30]

    # historical ct / st: a hairline springs from the beak, loops over and
    # comes down on the t
    for key, base, x0, gap in (("c_t", "c", 306, 26), ("s_t", "s", 300, 22)):
        off = adv(base) + gap
        loop = stroke(
            [
                (x0, 494, 54, 36, 0.5),
                ((x0 + off + 154) / 2 + 22, ASC + OS - 22, 0, t),
                (off + 154, 618, 270, 76),
                (off + 154, 560, 270, 76),
            ]
        )
        tee = sh("t").difference(rect(150, 596, 400, 700))  # the loop takes over the t's top corner
        put(key, U(sh(base), loop, move(tee, off)), off + adv("t"))
        CARETS[key] = [off + 4]


# ------------------------------------------------------------------- capitals
def cbowl(x0, xr, top, bot, w, xm=None):
    """Capital bowl: hairline out of the stem, thick round, hairline back."""
    xm = (x0 + xr) / 2 + 10 if xm is None else xm
    return stroke(
        [
            (x0, top - T / 2, 0, T),
            (xm, top - T / 2, 0, T),
            (xr - w / 2, (top + bot) / 2, 270, w),
            (xm, bot + T / 2, 180, T),
            (x0, bot + T / 2, 180, T),
        ]
    )


def capitals():
    put("H", U(cstem(50), cstem(390), rect(180, 327, 410, 373)), 590)
    put("I", cstem(50), 250)
    E = U(cstem(50), arm(190, 452, CAP, T, 88, "down"), arm(190, 400, 350, T, 84, "both", reach=130), arm(190, 466, 0, T, 88, "up"))
    put("E", E, 492)
    put("F", U(cstem(50), arm(190, 452, CAP, T, 88, "down"), arm(190, 400, 350, T, 84, "both", reach=130)), 468)
    put("L", U(cstem(50), arm(190, 446, 0, T, 96, "up")), 462)
    put("T", U(cstem(176), arm(250, 14, CAP, T, 88, "down"), arm(250, 488, CAP, T, 88, "down")), 502)

    O = oval(30, 560, -OS, CAP + OS, 158, T)
    put("O", O, 620)
    put("Q", U(O, diag(452, 596, 306, 436, -150, 130)), 620)

    c = stroke([(548, 556, 120, 66), (304, 689, 180, T), (109, 350, 270, 158), (304, 11, 0, T), (548, 150, 62, 60)])
    c = beak(c, 524, (420, 800), "R", "down", h=156, depth=150, thin=50)
    c = beak(c, 532, (-60, 280), "R", "up", h=64, depth=110, thin=44)
    put("C", c, 566)

    g = stroke([(548, 556, 120, 66), (304, 689, 180, T), (109, 350, 270, 158), (304, 11, 0, T), (478, 150, 90, 150), (478, 200, 90, 150)])
    g = beak(g, 524, (420, 800), "R", "down", h=156, depth=150, thin=50)
    g = U(g, stem(403, 190, 318, S, 0, 0), rect(300, 284, 566, 330))
    put("G", g, 596)

    put("D", U(cstem(50), cbowl(150, 564, CAP, 0, 158)), 594)
    put("B", U(cstem(50), cbowl(150, 504, CAP, 350, 140), cbowl(150, 536, 396, 0, 154)), 564)
    put("P", U(cstem(50), cbowl(150, 532, CAP, 300, 152)), 548)
    R = U(cstem(50), cbowl(150, 522, CAP, 320, 148), diag(408, 570, 262, 420, 0, 344))
    put("R", R, 574)

    put("A", U(diag(16, 82, 205, 271, 0, CAP), diag(404, 568, 211, 375, 0, CAP), rect(100, 170, 420, 216)), 584)
    put("V", U(diag(206, 342, 10, 172, -8, CAP), diag(276, 342, 498, 564, -8, CAP)), 574)
    put(
        "W",
        U(
            diag(196, 320, 10, 170, -8, CAP),
            diag(258, 320, 372, 436, -8, CAP),
            diag(516, 640, 330, 490, -8, CAP),
            diag(578, 640, 730, 796, -8, CAP),
        ),
        806,
    )
    put("X", U(diag(370, 538, 20, 188, 0, CAP), diag(20, 88, 452, 520, 0, CAP)), 556)
    put("Y", U(diag(196, 346, 10, 172, 290, CAP), diag(282, 346, 470, 536, 290, CAP), stem(196, 0, 330, S, 0, FLC)), 544)
    put("Z", U(arm(500, 40, CAP, T, 88, "down"), arm(24, 500, 0, T, 88, "up"), diag(24, 196, 328, 500, 0, CAP)), 526)
    karm = diag(170, 238, 470, 542, 250, CAP)
    kleg = diag(394, 566, 100, 272, 0, CAP).intersection(halfplane((170, 250), (470, CAP)))
    put("K", U(cstem(50), karm, kleg), 570)
    put("M", U(rect(46, 0, 112, CAP), diag(250, 362, 46, 210, 0, CAP), diag(298, 362, 520, 584, 0, CAP), cstem(520)), 720)
    put("N", U(rect(50, 0, 116, CAP), diag(390, 560, 50, 220, 0, CAP), rect(494, 0, 560, CAP)), 610)
    u = stroke([(125, 780, 270, S), (125, 260, 270, S), (298, 11, 0, T + 4), (471, 260, 90, S), (471, 780, 90, S)])
    u = U(u.intersection(below(CAP)), stem(50, 260, CAP, S, FLC, 0), stem(396, 260, CAP, S, FLC, 0))
    put("U", u, 596)
    j = stroke([(275, 300, 270, S), (275, 200, 270, S), (150, 11, 180, T + 4), (26, 128, 120, 62)])
    j = beak(j, 42, (-60, 300), "L", "up", h=120, depth=124, thin=48)
    put("J", U(j, stem(200, 280, CAP, S, FLC, 0)), 400)
    sp = stroke(
        [
            (512, 552, 118, 66),
            (272, 689, 180, T),
            (98, 524, 270, 136),
            (270, 352, -31, 152),
            (444, 182, 270, 136),
            (262, 11, 180, T),
            (30, 150, 118, 66),
        ]
    )
    sp = beak(sp, 492, (420, 800), "R", "down", h=144, depth=140, thin=50)
    sp = beak(sp, 48, (-100, 280), "L", "up", h=144, depth=140, thin=50)
    put("S", sp, 540)


# ------------------------------------------------------------------- numerals
def numerals():
    put("0", oval(34, 452, -OS, CAP + OS, 150, T), 520)
    put("1", U(cstem(180), poly([(190, 700), (190, 600), (60, 520), (44, 566)])), 420)
    two = stroke([(52, 532, 72, 62), (246, 689, 0, T), (404, 520, 270, 140), (236, 214, 232, 138), (64, 10, 236, 96), (34, -40, 236, 96)])
    two = beak(two.intersection(above(0)), 50, (420, 800), "L", "down", h=124, depth=128, thin=50)
    put("2", U(two, arm(60, 470, 0, T, 90, "up")), 506)
    three = U(
        stroke([(46, 560, 72, 62), (236, 689, 0, T), (398, 538, 270, 124), (250, 383, 180, T), (190, 383, 180, T)]),
        stroke([(190, 383, 0, T), (236, 383, 0, T), (430, 198, 270, 142), (238, 11, 180, T), (36, 136, 120, 62)]),
    )
    three = three.difference(rect(-BIG, 330, 204, 436))
    three = beak(three, 50, (440, 800), "L", "down", h=112, depth=120, thin=50)
    three = beak(three, 46, (-60, 280), "L", "up", h=118, depth=124, thin=50)
    put("3", three, 500)
    put("4", U(cstem(310), diag(20, 92, 292, 364, 180, CAP), rect(20, 170, 506, 216)), 526)
    five = stroke([(130, 400, 40, 50), (266, 462, 0, T), (398, 236, 270, 152), (236, 11, 180, T), (36, 136, 120, 62)])
    five = five.difference(rect(-BIG, 300, 96, 900))
    five = beak(five, 46, (-60, 280), "L", "up", h=118, depth=124, thin=50)
    put("5", U(five, rect(96, 372, 164, CAP), arm(100, 444, CAP, T, 90, "down")), 506)
    six = stroke([(105, 232, 90, 142), (105, 420, 90, 142), (300, 689, 0, T), (452, 582, -56, 62)])
    six = beak(six, 432, (440, 800), "R", "down", h=116, depth=124, thin=50)
    six = U(six, oval(34, 440, -OS, 452, 142, T))
    put("6", six, 508)
    put("9", rot180(six, 254, 350), 508)
    put("7", U(arm(470, 30, CAP, T, 90, "down"), diag(130, 292, 318, 470, 0, CAP)), 490)
    put("8", U(oval(60, 380, 362, CAP + OS, 126, T), oval(34, 432, -OS, 398, 146, T)), 500)


# ---------------------------------------------------------------- punctuation
def comma_shape(cx=116, cy=84):
    return U(diamond(cx, cy), poly([(cx + 86, cy), (cx + 52, cy - 120), (cx - 62, cy - 236), (cx - 10, cy - 96), (cx - 40, cy - 40)]))


def punctuation():
    put(" ", None, 216)
    dot = diamond(116, 84)
    put(".", dot, 232)
    put(":", U(dot, diamond(116, 410)), 232)
    com = comma_shape()
    put(",", com, 232)
    put(";", U(com, diamond(116, 410)), 232)
    put("!", U(poly([(40, CAP), (192, CAP), (148, 236), (84, 236)]), dot), 232)
    q = stroke([(40, 540, 72, 62), (222, 689, 0, T), (382, 540, 270, 134), (250, 350, 226, 84), (214, 200, 270, 70)])
    q = beak(q.intersection(above(236)), 44, (420, 800), "L", "down", h=120, depth=124, thin=50)
    put("?", U(q, diamond(214, 84)), 440)

    tick = poly([(40, 724), (132, 724), (108, 456), (64, 456)])
    put("'", tick, 172)
    put('"', U(tick, move(tick, 146)), 318)
    q9 = move(scale(comma_shape(), 0.92, origin=(116, 84)), 0, 548)
    q6 = rot180(q9, 116, 590)
    put("’", q9, 232)
    put("‘", q6, 232)
    put("”", U(q9, move(q9, 196)), 428)
    put("“", U(q6, move(q6, 196)), 428)
    put("‚", com, 232)
    put("„", U(com, move(com, 196)), 428)
    put("…", U(dot, move(dot, 232), move(dot, 464)), 696)
    put("•", diamond(170, 300, 130, 136), 340)
    put("·", diamond(116, 300), 232)
    put("¡", mirror_y(G["!"][0], 250), 232)
    put("¿", rot180(G["?"][0], 220, 250), 440)

    put("-", rect(36, 220, 254, 290), 290)
    put("–", rect(30, 226, 470, 284), 500)
    put("—", rect(30, 226, 870, 284), 900)
    put("_", rect(0, -130, 500, -84), 500)
    bar_h, bar_v = rect(40, 272, 420, 328), rect(202, 110, 258, 490)
    put("+", U(bar_h, bar_v), 460)
    put("−", bar_h, 460)
    put("±", U(move(bar_h, 0, 60), rect(202, 190, 258, 530), rect(40, 60, 420, 116)), 460)
    put("=", U(move(bar_h, 0, -78), move(bar_h, 0, 78)), 460)
    put("×", rotate(U(bar_h, bar_v), 45, origin=(230, 300)), 460)
    put("÷", U(bar_h, diamond(230, 462, 56, 58), diamond(230, 138, 56, 58)), 460)
    put("<", chevron([(410, 500), (70, 300), (410, 100)], 58).intersection(rect(0, 60, 400, 540)), 450)
    put(">", mirror_x(G["<"][0], 225), 450)
    put("/", diag(4, 64, 296, 356, -120, 770), 360)
    put("\\", mirror_x(G["/"][0], 180), 360)
    put("|", rect(92, -190, 150, 790), 242)
    par = stroke([(256, 806, 228, 40), (106, 300, 270, 116), (256, -206, 312, 40)], c=0.5)
    par = par.intersection(rect(0, -180, 250, 780))
    put("(", par, 262)
    put(")", mirror_x(par, 131), 262)
    brk = U(rect(64, -170, 126, 790), rect(64, 744, 246, 790), rect(64, -170, 246, -124))
    put("[", brk, 266)
    put("]", mirror_x(brk, 133), 266)
    half = stroke([(262, 760, 180, 50), (168, 660, 270, 76), (168, 420, 270, 76), (60, 310, 180, 44)], c=0.7)
    brc = U(half, mirror_y(half, 310)).intersection(rect(40, -180, 246, 800))
    put("{", brc, 270)
    put("}", mirror_x(brc, 135), 270)
    petal = poly([(-13, 0), (13, 0), (40, 150), (-40, 150)])
    put("*", move(U([rotate(petal, a) for a in range(0, 360, 60)]), 190, 548), 380)
    put(
        "#",
        U(rect(30, 440, 540, 494), rect(30, 206, 540, 260), diag(120, 184, 216, 280, 0, CAP), diag(304, 368, 400, 464, 0, CAP)),
        570,
    )
    S_ = G["S"][0]
    put("$", U(S_, rect(242, 660, 298, 800), rect(242, -100, 298, 40)), 540)
    pz = oval(30, 264, 360, CAP + OS, 92, 40)
    put("%", U(pz, move(pz, 446, -360), diag(160, 222, 548, 610, 0, CAP)), 770)
    amp = stroke(
        [
            (566, 392, 248, 56),
            (290, 11, 180, T),
            (108, 186, 90, 146),
            (268, 410, 48, 62),
            (396, 574, 90, 98),
            (290, 689, 180, T),
            (176, 566, 270, 124),
            (480, 110, 302, 140),
            (590, -60, 302, 140),
        ]
    )
    amp = U(amp.intersection(rect(0, 0, 900, 372).union(rect(0, 372, 470, 900))), rect(436, 326, 640, 372))
    put("&", amp, 660)
    ring = oval(30, 780, -150, 650, 64, 48)
    ring = ring.difference(poly([(560, 60), (900, 60), (900, -200), (500, -200)]))
    inner = U(oval(236, 262, 86, 424, 88, 40), rect(430, 150, 510, 424))
    tail = stroke([(470, 200, 270, 80), (470, 160, 270, 80), (590, 86, 0, 44), (778, 250, 90, 56)])
    put("@", U(ring, inner, tail), 840)
    put("^", chevron([(60, 380), (220, 716), (380, 380)], 58).intersection(above(400)), 440)
    put("~", stroke([(44, 262, 68, 44), (150, 344, 0, 82), (250, 300, -36, 74), (350, 256, 0, 82), (456, 338, 68, 44)]), 500)
    put("`", move(MARKS["grave"], 170, 130), 300)
    put("°", oval(40, 240, 440, CAP + OS, 60, 50), 320)
    co = oval(30, 700, -OS, CAP + OS, 52, 46)
    cc = stroke([(480, 470, 125, 50), (372, 520, 180, 40), (250, 350, 270, 92), (372, 180, 0, 40), (480, 230, 55, 50)])
    put("©", U(co, cc.intersection(left_of(480))), 760)
    put("€", U(G["C"][0].intersection(rect(60, -60, 900, 800)), rect(0, 392, 400, 438), rect(0, 262, 400, 308)), 566)
    lb = stroke([(470, 560, 120, 62), (360, 689, 180, T), (215, 520, 270, S), (215, 20, 270, S)])
    lb = beak(lb, 452, (420, 800), "R", "down", h=120, depth=120, thin=50)
    put("£", U(lb.intersection(above(0)), arm(60, 480, 0, T, 90, "up"), rect(40, 330, 400, 376)), 512)


# -------------------------------------------------------------------- accents
MARKS = {}


def marks():
    """Marks are drawn centred on x = 0 at lowercase height."""
    MARKS["acute"] = poly([(-44, 570), (-2, 570), (112, 740), (10, 740)])
    MARKS["grave"] = mirror_x(MARKS["acute"], 0)
    MARKS["circumflex"] = chevron([(-150, 520), (0, 716), (150, 520)], 62).intersection(above(574))
    MARKS["caron"] = mirror_y(MARKS["circumflex"], 652)
    MARKS["dieresis"] = U(diamond(-92, 656, 62, 66), diamond(92, 656, 62, 66))
    MARKS["tilde"] = move(scale(stroke([(44, 262, 68, 44), (150, 344, 0, 82), (250, 300, -36, 74), (350, 256, 0, 82), (456, 338, 68, 44)]), 0.66, 0.9, origin=(250, 300)), -250, 356)
    MARKS["ring"] = oval(-84, 168, 572, 748, 48, 40)
    ced = stroke([(8, -34, -20, 40), (62, -104, 270, 60), (0, -176, 180, 40), (-56, -160, 150, 40)], c=0.6)
    MARKS["cedilla"] = U(ced, poly([(-22, 12), (30, 12), (26, -50), (-8, -50)]))


ACCENTED = {
    "a": ("àáâãäå", ["grave", "acute", "circumflex", "tilde", "dieresis", "ring"]),
    "e": ("èéêë", ["grave", "acute", "circumflex", "dieresis"]),
    "dotlessi": ("ìíîï", ["grave", "acute", "circumflex", "dieresis"]),
    "o": ("òóôõö", ["grave", "acute", "circumflex", "tilde", "dieresis"]),
    "u": ("ùúûü", ["grave", "acute", "circumflex", "dieresis"]),
    "y": ("ýÿ", ["acute", "dieresis"]),
    "n": ("ñ", ["tilde"]),
    "c": ("çć č", ["cedilla", "acute", None, "caron"]),
    "s": ("šś", ["caron", "acute"]),
    "z": ("žź", ["caron", "acute"]),
    "A": ("ÀÁÂÃÄÅ", ["grave", "acute", "circumflex", "tilde", "dieresis", "ring"]),
    "E": ("ÈÉÊË", ["grave", "acute", "circumflex", "dieresis"]),
    "I": ("ÌÍÎÏ", ["grave", "acute", "circumflex", "dieresis"]),
    "O": ("ÒÓÔÕÖ", ["grave", "acute", "circumflex", "tilde", "dieresis"]),
    "U": ("ÙÚÛÜ", ["grave", "acute", "circumflex", "dieresis"]),
    "Y": ("ÝŸ", ["acute", "dieresis"]),
    "N": ("Ñ", ["tilde"]),
    "C": ("ÇĆ Č", ["cedilla", "acute", None, "caron"]),
    "S": ("ŠŚ", ["caron", "acute"]),
    "Z": ("ŽŹ", ["caron", "acute"]),
}
BASE_OF = {}
# optical centre of the base where it is not the middle of the advance
MARK_X = {"a": 226, "A": 300, "dotlessi": 112, "c": 236, "C": 310, "y": 240, "J": 275}


def accents():
    for base, (chars, mks) in ACCENTED.items():
        shape, a = G[base]
        cap = base.isupper() and len(base) == 1
        cx = MARK_X.get(base, a / 2)
        for ch, mk in zip(chars, mks):
            if mk is None or ch == " ":
                continue
            m = MARKS[mk]
            if mk != "cedilla":
                if cap:
                    m = move(scale(m, 1.0, 0.86, origin=(0, 560)), 0, 212)
                elif base == "dotlessi":
                    m = scale(m, 0.82, 1.0, origin=(0, 560))
            else:
                cx = {"c": 244, "C": 316}[base]
            put(ch, U(shape, move(m, cx)), a)
            BASE_OF[ch] = base
            cx = MARK_X.get(base, a / 2)

    o, O = G["o"][0], G["O"][0]
    put("ø", U(o, diag(56, 116, 396, 456, -56, 556)), 512)
    put("Ø", U(O, diag(70, 134, 486, 550, -56, 756)), 620)
    BASE_OF["ø"], BASE_OF["Ø"] = "o", "O"
    put("æ", U(G["a"][0], move(G["e"][0], 272)), 272 + 496)
    put("œ", U(o, move(G["e"][0], 314)), 314 + 496)
    put("Æ", U(diag(10, 78, 300, 368, 0, CAP), rect(150, 170, 380, 216), move(G["E"][0], 290), rect(300, CAP - T, 420, CAP)), 290 + 492)
    put("Œ", U(O.intersection(left_of(330)), rect(300, CAP - T, 400, CAP), rect(300, 0, 400, T), move(G["E"][0], 290)), 290 + 492)
    ez = stroke([(112, 540, 90, s), (112, 580, 90, s), (250, ASC + OS - 23, 0, T), (372, 610, 270, 112), (286, 452, 205, 50)])
    ez = U(ez, stroke([(280, 452, -25, 50), (430, 236, 270, 138), (290, 10, 180, T), (196, 70, 140, 44)]))
    put("ß", U(stem(44, 0, 560, s, 0, FL), ez), 540)


def build_all():
    marks()
    lowercase()
    ligatures()
    capitals()
    numerals()
    punctuation()
    accents()
    for ch in list(G):  # capitals and figures get a little more air
        if ch.isupper() or ch.isdigit():
            shape, a = G[ch]
            G[ch] = (move(shape, CAP_AIR), a + 2 * CAP_AIR)
    return G


# per-glyph softening overrides (r_out, r_in) and kerning controls
CAP_AIR = 8
SOFT_DEFAULT = (7.0, 5.0)
SOFT = {}
NO_KERN = {" "}
KERN_OVERRIDES = {}
