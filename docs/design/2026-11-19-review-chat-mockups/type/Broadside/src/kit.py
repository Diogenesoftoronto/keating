"""Geometry kit for Keating Broadside.

Glyphs are assembled as shapely polygons from a handful of drawing
primitives (flared stems, wedge arms, cut diagonals, variable-width pen
strokes, beak terminals), softened like inked metal, then traced back into
clean cubic outlines with a Schneider curve fit.
"""
import math

import numpy as np
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

BIG = 4000.0

# ---------------------------------------------------------------- booleans


def U(*shapes):
    flat = []
    for s in shapes:
        if s is None:
            continue
        if isinstance(s, (list, tuple)):
            flat.extend(s)
        else:
            flat.append(s)
    return unary_union(flat)


def poly(pts):
    return Polygon(pts).buffer(0)


def rect(x0, y0, x1, y1):
    return box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def mirror_x(shape, axis):
    return affinity.scale(shape, xfact=-1, yfact=1, origin=(axis, 0))


def mirror_y(shape, axis):
    return affinity.scale(shape, xfact=1, yfact=-1, origin=(0, axis))


def rot180(shape, cx, cy):
    return affinity.rotate(shape, 180, origin=(cx, cy))


def move(shape, dx=0, dy=0):
    return affinity.translate(shape, dx, dy)


def scale(shape, sx, sy=None, origin=(0, 0)):
    return affinity.scale(shape, xfact=sx, yfact=sx if sy is None else sy, origin=origin)


def rotate(shape, deg, origin=(0, 0)):
    return affinity.rotate(shape, deg, origin=origin)


def skew(shape, deg, origin=(0, 0)):
    return affinity.skew(shape, xs=deg, origin=origin)


def above(y):
    return box(-BIG, y, BIG, BIG)


def below(y):
    return box(-BIG, -BIG, BIG, y)


def left_of(x):
    return box(-BIG, -BIG, x, BIG)


def right_of(x):
    return box(x, -BIG, BIG, BIG)


def halfplane(p, q):
    """Everything to the right of the directed line p -> q."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    n = math.hypot(dx, dy)
    dx, dy = dx / n, dy / n
    nx, ny = dy, -dx
    a = (p[0] - dx * BIG, p[1] - dy * BIG)
    b = (p[0] + dx * BIG, p[1] + dy * BIG)
    return Polygon([a, b, (b[0] + nx * BIG, b[1] + ny * BIG), (a[0] + nx * BIG, a[1] + ny * BIG)])


def yspan(shape, x, ylo=-BIG, yhi=BIG):
    hit = shape.intersection(LineString([(x, ylo), (x, yhi)]))
    if hit.is_empty:
        return None
    b = hit.bounds
    return b[1], b[3]


def xspan(shape, y, xlo=-BIG, xhi=BIG):
    hit = shape.intersection(LineString([(xlo, y), (xhi, y)]))
    if hit.is_empty:
        return None
    b = hit.bounds
    return b[0], b[2]


# -------------------------------------------------------------- primitives


def stem(xl, y0, y1, w, ft=0.0, fb=0.0, reach=0.42, cap=210.0):
    """Vertical stroke, waisted: it swells by ft/fb at each side of its ends."""
    h = y1 - y0
    lf = min(cap, h * reach)
    n = 14
    right, left = [], []
    for i in range(n + 1):
        u = i / n
        right.append((xl + w + fb * (1 - u) ** 2.1, y0 + lf * u))
    for i in range(n + 1):
        u = i / n
        right.append((xl + w + ft * u**2.1, y1 - lf * (1 - u)))
    for x, y in right:
        left.append((2 * xl + w - x, y))
    return poly(right + left[::-1])


def arm(xa, xb, y, th, grow, mode="up", reach=170.0, p=2.3):
    """Thin horizontal arm from a joined end xa to a free end xb where it
    swells into a wedge with a vertical cut.
    mode 'up': bottom edge sits on y; 'down': top edge on y; 'both': centred on y."""
    sgn = 1 if xb > xa else -1
    ln = abs(xb - xa)
    lf = min(reach, ln)
    n = 18
    curve = []
    for i in range(n + 1):
        u = i / n
        curve.append((xb - sgn * lf * (1 - u), grow * u**p))
    if mode == "up":
        pts = [(xa, y), (xb, y)] + [(x, y + th + g) for x, g in curve[::-1]] + [(xa, y + th)]
    elif mode == "down":
        pts = [(xa, y), (xb, y)] + [(x, y - th - g) for x, g in curve[::-1]] + [(xa, y - th)]
    else:
        h = th / 2
        pts = (
            [(xa, y - h)]
            + [(x, y - h - g / 2) for x, g in curve]
            + [(x, y + h + g / 2) for x, g in curve[::-1]]
            + [(xa, y + h)]
        )
    return poly(pts)


def diag(b0, b1, t0, t1, y0, y1):
    """Diagonal with horizontal cuts: bottom spans b0..b1 at y0, top t0..t1 at y1."""
    return poly([(b0, y0), (b1, y0), (t1, y1), (t0, y1)])


def diamond(cx, cy, a=86.0, b=90.0, bulge=0.0):
    return poly([(cx - a, cy), (cx, cy + b), (cx + a, cy), (cx, cy - b)])


def chevron(pts, w):
    return LineString(pts).buffer(w / 2, cap_style="flat", join_style="mitre", mitre_limit=4)


def _hermite(p0, d0, p1, d1, c, n):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    dist = math.hypot(dx, dy)
    v0 = (math.cos(math.radians(d0)), math.sin(math.radians(d0)))
    v1 = (math.cos(math.radians(d1)), math.sin(math.radians(d1)))
    h0 = abs(dx * v0[0] + dy * v0[1]) * c
    h1 = abs(dx * v1[0] + dy * v1[1]) * c
    h0 = max(h0, dist * 0.18)
    h1 = max(h1, dist * 0.18)
    c1 = (p0[0] + v0[0] * h0, p0[1] + v0[1] * h0)
    c2 = (p1[0] - v1[0] * h1, p1[1] - v1[1] * h1)
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t**3 * p1[0]
        y = mt**3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t**3 * p1[1]
        out.append((x, y, t))
    return out


def stroke(nodes, c=0.62, ease=1.0):
    """Variable-width pen stroke through nodes (x, y, heading_deg, width).

    Segments are cubic Hermite spans whose handles are the projection of the
    chord on each heading (so quarter turns come out squarish, like the
    superelliptical rounds the face is built on). Width eases between nodes.
    A node may carry a 5th value overriding `c` for the span that follows.
    """
    discs = []
    for i in range(len(nodes) - 1):
        a, b = nodes[i], nodes[i + 1]
        cc = a[4] if len(a) > 4 else c
        dist = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(6, int(dist / 5))
        for x, y, t in _hermite(a[:2], a[2], b[:2], b[2], cc, n):
            s = t * t * (3 - 2 * t)
            if ease != 1.0:
                s = s**ease if b[3] > a[3] else 1 - (1 - s) ** ease
            w = a[3] + (b[3] - a[3]) * s
            discs.append((x, y, w / 2))
    hulls = []
    prev = None
    for x, y, r in discs:
        cur = Point(x, y).buffer(r, quad_segs=10)
        if prev is not None:
            hulls.append(unary_union([prev, cur]).convex_hull)
        prev = cur
    return unary_union(hulls)


def oval(lx, w, bot, top, sw, tw, c=0.62, lean=0.0):
    """Closed superelliptical bowl: thick sides sw, thin top and bottom tw."""
    cx = lx + w / 2
    cy = (bot + top) / 2
    nodes = [
        (cx + lean, top - tw / 2, 180, tw),
        (lx + sw / 2, cy, 270, sw),
        (cx - lean, bot + tw / 2, 0, tw),
        (lx + w - sw / 2, cy, 90, sw),
        (cx + lean, top - tw / 2, 180, tw),
    ]
    return stroke(nodes, c=c)


BEAK_GAIN = 1.14


def _span_near(shape, x, y0, y1, near):
    """The piece of the vertical section at x that lies closest to y = near."""
    hit = shape.intersection(LineString([(x, y0), (x, y1)]))
    if hit.is_empty:
        return None
    parts = [g for g in getattr(hit, "geoms", [hit]) if g.length > 0.5]
    if not parts:
        return None
    best = min(parts, key=lambda g: 0 if g.bounds[1] - 1 <= near <= g.bounds[3] + 1 else min(abs(g.bounds[1] - near), abs(g.bounds[3] - near)))
    return best.bounds[1], best.bounds[3]


def beak(shape, x, band, side="R", vdir="down", h=110.0, depth=120.0, thin=44.0, keep=None):
    """Cut a stroke on the vertical line x (inside the y band) and hang a
    wedge-shaped beak from the cut: the face's signature terminal. The wedge
    is rooted on the stroke's own edges `depth` back from the cut, so it
    grows out of the hairline without a step."""
    y0, y1 = band
    cutbox = box(x, y0, BIG, y1) if side == "R" else box(-BIG, y0, x, y1)
    if keep is not None:
        cutbox = cutbox.difference(keep)
    shape = shape.difference(cutbox)
    if h <= 0:
        return shape
    sx = -1 if side == "R" else 1  # direction pointing back into the stroke
    span = yspan(shape, x + sx * 0.6, y0, y1)
    if span is None:
        return shape
    edge, sy = (span[1], -1) if vdir == "down" else (span[0], 1)
    rs = None
    while depth > 30:
        rs = _span_near(shape, x + sx * depth, y0, y1, edge)
        if rs is not None and (rs[1] - rs[0]) < thin * 2.4:
            break
        depth *= 0.85
        rs = None
    if rs is None:
        return shape
    outer_r, inner_r = (rs[1], rs[0]) if vdir == "down" else (rs[0], rs[1])
    xr = x + sx * depth
    tip = (x, edge + sy * h * BEAK_GAIN)
    root = (xr, inner_r - sy * 3)
    ctrl = (x + sx * depth * 0.46, root[1] + sy * h * 0.33)
    pts = [(x, edge), tip]
    n = 16
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        pts.append(
            (
                mt * mt * tip[0] + 2 * mt * t * ctrl[0] + t * t * root[0],
                mt * mt * tip[1] + 2 * mt * t * ctrl[1] + t * t * root[1],
            )
        )
    pts.append((xr, outer_r + sy * 3))
    return U(shape, poly(pts))


def soften(shape, r_out=7.0, r_in=5.0):
    """Ink-and-metal softening: round the convex corners, fill the crotches."""
    s = shape.buffer(-r_out, quad_segs=6).buffer(r_out, quad_segs=6)
    s = s.buffer(r_in, quad_segs=6).buffer(-r_in, quad_segs=6)
    return s


# ------------------------------------------------------------ curve fitting

LINE_MIN = 15.0
CORNER = math.radians(34)
SMOOTH = math.radians(20)


def _unit(v):
    n = math.hypot(v[0], v[1])
    return np.array([0.0, 0.0]) if n < 1e-9 else np.array([v[0] / n, v[1] / n])


def _bez(b, t):
    mt = 1 - t
    return (
        (mt**3)[:, None] * b[0]
        + (3 * mt * mt * t)[:, None] * b[1]
        + (3 * mt * t * t)[:, None] * b[2]
        + (t**3)[:, None] * b[3]
    )


def _gen(pts, u, t1, t2):
    p0, p3 = pts[0], pts[-1]
    mt = 1 - u
    b0, b1, b2, b3 = mt**3, 3 * mt * mt * u, 3 * mt * u * u, u**3
    a1 = b1[:, None] * t1
    a2 = b2[:, None] * t2
    c00 = (a1 * a1).sum()
    c01 = (a1 * a2).sum()
    c11 = (a2 * a2).sum()
    tmp = pts - ((b0 + b1)[:, None] * p0 + (b2 + b3)[:, None] * p3)
    x0 = (a1 * tmp).sum()
    x1 = (a2 * tmp).sum()
    det = c00 * c11 - c01 * c01
    seg = np.linalg.norm(p3 - p0)
    if abs(det) > 1e-9:
        al = (x0 * c11 - x1 * c01) / det
        ar = (c00 * x1 - c01 * x0) / det
    else:
        al = ar = 0
    eps = 1e-6 * seg
    if al < eps or ar < eps or al > seg * 3 or ar > seg * 3:
        al = ar = seg / 3
    return np.array([p0, p0 + t1 * al, p3 + t2 * ar, p3])


def _chord(pts):
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    u = np.concatenate([[0], np.cumsum(d)])
    return u / u[-1] if u[-1] > 0 else u


def _reparam(pts, u, b):
    d1 = 3 * (b[1:] - b[:-1])
    d2 = 2 * (d1[1:] - d1[:-1])
    mt = 1 - u
    q = _bez(b, u)
    q1 = (mt * mt)[:, None] * d1[0] + (2 * mt * u)[:, None] * d1[1] + (u * u)[:, None] * d1[2]
    q2 = mt[:, None] * d2[0] + u[:, None] * d2[1]
    num = ((q - pts) * q1).sum(axis=1)
    den = (q1 * q1).sum(axis=1) + ((q - pts) * q2).sum(axis=1)
    out = np.where(np.abs(den) > 1e-9, u - num / np.where(np.abs(den) > 1e-9, den, 1), u)
    return np.clip(out, 0, 1)


def _fit(pts, t1, t2, tol, depth=0):
    if len(pts) == 2:
        d = np.linalg.norm(pts[1] - pts[0]) / 3
        return [np.array([pts[0], pts[0] + t1 * d, pts[1] + t2 * d, pts[1]])]
    u = _chord(pts)
    b = _gen(pts, u, t1, t2)
    err = ((_bez(b, u) - pts) ** 2).sum(axis=1)
    k = int(err.argmax())
    if err[k] < tol * tol:
        return [b]
    if err[k] < tol * tol * 36:
        for _ in range(5):
            u = _reparam(pts, u, b)
            b = _gen(pts, u, t1, t2)
            err = ((_bez(b, u) - pts) ** 2).sum(axis=1)
            k = int(err.argmax())
            if err[k] < tol * tol:
                return [b]
    k = min(max(k, 1), len(pts) - 2)
    tc = _unit(pts[k - 1] - pts[k + 1])
    return _fit(pts[: k + 1], t1, tc, tol, depth + 1) + _fit(pts[k:], -tc, t2, tol, depth + 1)


def fit_ring(coords, tol=0.55):
    """Trace a closed polyline ring into ('line', p) / ('curve', c1, c2, p) segments."""
    pts = [np.array(c[:2], dtype=float) for c in coords[:-1]]
    clean = [pts[0]]
    for p in pts[1:]:
        if np.linalg.norm(p - clean[-1]) > 0.05:
            clean.append(p)
    if np.linalg.norm(clean[0] - clean[-1]) <= 0.05:
        clean.pop()
    pts = clean
    n = len(pts)
    if n < 3:
        return None, []
    evec = [pts[(i + 1) % n] - pts[i] for i in range(n)]
    elen = [float(np.linalg.norm(v)) for v in evec]
    edir = [_unit(v) for v in evec]
    is_line = [l >= LINE_MIN for l in elen]

    def turn(i):
        a, b = edir[i - 1], edir[i]
        return abs(math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]))

    split = {}
    for i in range(n):
        tn = turn(i)
        ln_in, ln_out = is_line[i - 1], is_line[i]
        if tn > CORNER:
            split[i] = (None, None)  # true corner: one-sided tangents
        elif ln_in or ln_out:
            if tn < SMOOTH:
                d = edir[i - 1] if ln_in else edir[i]
                split[i] = (d, d)
            else:
                split[i] = (None, None)
    if not split:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for i in {xs.index(min(xs)), xs.index(max(xs)), ys.index(min(ys)), ys.index(max(ys))}:
            d = _unit(pts[(i + 1) % n] - pts[i - 1])
            split[i] = (d, d)
    idx = sorted(split)
    segs = []
    for k, i in enumerate(idx):
        j = idx[(k + 1) % len(idx)]
        span = (j - i) % n or n
        run = [pts[(i + m) % n] for m in range(span + 1)]
        if span == 1 and is_line[i]:
            segs.append(("line", run[-1]))
            continue
        arr = np.array(run)
        t_out = split[i][1]
        t_in = split[j][0]
        t1 = t_out if t_out is not None else _unit(arr[1] - arr[0])
        t2 = -t_in if t_in is not None else _unit(arr[-2] - arr[-1])
        chordlen = np.linalg.norm(arr[-1] - arr[0])
        dev = 0.0
        if chordlen > 1e-6:
            dv = _unit(arr[-1] - arr[0])
            rel = arr - arr[0]
            dev = float(np.abs(rel[:, 0] * dv[1] - rel[:, 1] * dv[0]).max())
        if dev < 0.25:
            segs.append(("line", run[-1]))
            continue
        for b in _fit(arr, t1, t2, tol):
            segs.append(("curve", b[1], b[2], b[3]))
    return pts[idx[0]], segs


def polygons(shape):
    if shape.is_empty:
        return []
    if isinstance(shape, Polygon):
        return [shape]
    if isinstance(shape, MultiPolygon):
        return list(shape.geoms)
    return [g for g in getattr(shape, "geoms", []) if isinstance(g, Polygon)]


def draw(shape, pen, tol=0.55):
    """Draw a shapely shape into a fontTools segment pen as fitted cubics.
    Outer contours run clockwise (TrueType convention)."""
    for pg in polygons(shape):
        if pg.area < 30:
            continue
        pg = orient(pg, sign=-1.0)
        for ring in [pg.exterior] + list(pg.interiors):
            if abs(Polygon(ring).area) < 20:
                continue
            start, segs = fit_ring(list(ring.coords), tol)
            if not segs:
                continue
            pen.moveTo((round(start[0], 2), round(start[1], 2)))
            for s in segs:
                if s[0] == "line":
                    pen.lineTo((round(s[1][0], 2), round(s[1][1], 2)))
                else:
                    pen.curveTo(*[(round(p[0], 2), round(p[1], 2)) for p in s[1:]])
            pen.closePath()
