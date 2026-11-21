#!/usr/bin/env python3
"""pxl — small-sprite pixel-art toolkit for LLM artists (24–64 px icons/items).

Library (inside a drawing script):   from pxl import *
    C = canvas(48, 48, palette=None)
    m = mask_poly([(10,40),(38,8),(42,12),(14,44)])      # silhouette as a mask
    shade(C, m, "steel", light="nw", style="cyl")         # auto light/shadow inside the mask
    outline(C)                                            # selective dark outline around everything
    C.save("out.png")                                     # or leave C as a global and use `pxl.py render`

CLI:
    pxl.py render  <script.py|grid.json> -o out.png [--preview] [--scale 8]
    pxl.py show    <png|json|py> [--lum]          ASCII view with ruler (+ luminance map)
    pxl.py lint    <png|json|py> [--sym x|y] [--budget N] [--palette P] [--light nw]
    pxl.py dump    <png> [-o grid.json] [--palette P] [--snap]   PNG -> legend+rows grid (few-shot examples; --snap = nearest palette colors)
    pxl.py convert <png> --size N [--palette P] [--colors K] [--ramps body,glow] [--no-enhance] [-o out.png]   any image -> clean pixel art
    pxl.py palette [name]                         list ramps / colors / default chars
    pxl.py diff    <a.png> <b.png> [--region x0,y0,x1,y1]   changed pixels inside/outside a region (JSON)
    pxl.py crop    <png> --region x0,y0,x1,y1 [-o zoom.png] [--scale 8] [--ascii]
    pxl.py palette-from <png> [-o pal.json] [--name N]      palette (hue-grouped ramps) from any image
    render extras: --show (also print the ASCII view), --step-dir DIR (or env PXL_STEP_DIR) saves every render as DIR/step_###.png + lint json; --json
    pxl.py ramp    <#hex> [n]                     generate a hue-shifted ramp
Colors anywhere: "#rrggbb", "ramp.i" (i: 0 darkest .. n-1 lightest), "outline", a palette char, or None (transparent).
"""
import colorsys
import json
import math
import os
import random
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PAL_DIR = os.path.join(HERE, "..", "assets", "palettes")
# user library (private palettes/examples, not part of the repo): $PXL_LIBRARY or ~/.pixel-studio/library
LIB_DIR = os.environ.get("PXL_LIBRARY") or os.path.join(os.path.expanduser("~"), ".pixel-studio", "library")
DEFAULT_PALETTE = os.environ.get("PXL_PALETTE", "studio")
LIGHTS = {"nw": (-1, -1), "n": (0, -1), "ne": (1, -1), "w": (-1, 0), "e": (1, 0), "sw": (-1, 1), "s": (0, 1), "se": (1, 1)}

# ---------------------------------------------------------------- colors / palettes

def hx(c):
    return "#%02X%02X%02X" % tuple(int(v) for v in c[:3])


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(h):
    r, g, b = [v / 255.0 for v in rgb(h)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def make_ramp(base, n=5, hue_shift=18.0, sat_curve=0.15, spread=0.62):
    """Hue-shifted ramp dark->light around `base` (lights warm toward yellow, shadows cool toward blue/purple)."""
    r, g, b = [v / 255.0 for v in rgb(base)]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    out = []
    for i in range(n):
        t = (i / (n - 1)) * 2 - 1 if n > 1 else 0  # -1 .. 1
        hh = (h * 360 + (-t) * hue_shift * (1 if h * 360 > 60 and h * 360 < 240 else -1)) % 360 / 360
        ll = min(0.95, max(0.04, l + t * spread * (0.5 if t > 0 else 0.55)))
        ss = min(1.0, max(0.0, s * (1 + sat_curve * (1 - abs(t)) - 0.25 * max(0, t))))
        out.append(hx([v * 255 for v in colorsys.hls_to_rgb(hh, ll, ss)]))
    return out


class Palette:
    def __init__(self, name=None):
        name = name or DEFAULT_PALETTE
        self.name = name
        self.ramps = {}
        self.colors = {}
        self.chars = {}
        self.outline = "#120C08"
        if name:
            self.load(name)
        self._rev = {}
        for rn, tones in self.ramps.items():
            for i, t in enumerate(tones):
                self._rev.setdefault(t.upper(), (rn, i))

    def load(self, name):
        path = name if name.endswith(".json") else os.path.join(PAL_DIR, name + ".json")
        if not os.path.exists(path) and not name.endswith(".json"):
            path = os.path.join(LIB_DIR, "palettes", name + ".json")
        d = json.load(open(path, encoding="utf-8"))
        self.ramps = {k: [c.upper() for c in v] for k, v in d.get("ramps", {}).items()}
        self.colors = {k: v.upper() for k, v in d.get("colors", {}).items()}
        self.outline = d.get("outline", self.outline).upper()
        self.chars = d.get("chars", {})

    def ramp_of(self, h):
        return self._rev.get(h.upper()) if h else None

    def all_colors(self):
        s = {self.outline}
        for t in self.ramps.values():
            s.update(t)
        s.update(self.colors.values())
        return s

    def nearest(self, h):
        r0 = rgb(h)
        best, bd = None, 1e9
        for c in self.all_colors():
            r1 = rgb(c)
            # perceptual-ish weights
            d = 2 * (r0[0] - r1[0]) ** 2 + 4 * (r0[1] - r1[1]) ** 2 + 3 * (r0[2] - r1[2]) ** 2
            if d < bd:
                best, bd = c, d
        return best


def resolve(pal, c):
    if c is None or c == "." or c == "":
        return None
    if isinstance(c, (tuple, list)):
        return hx(c)
    c = str(c)
    if c.startswith("#"):
        return c.upper()
    if c == "outline":
        return pal.outline
    if c in pal.colors:
        return pal.colors[c]
    if "." in c:
        rn, i = c.rsplit(".", 1)
        tones = pal.ramps[rn]
        i = int(i)
        return tones[max(0, min(len(tones) - 1, i if i >= 0 else len(tones) + i))]
    if c in pal.chars:
        return resolve(pal, pal.chars[c])
    if c in pal.ramps:
        t = pal.ramps[c]
        return t[len(t) // 2]
    raise ValueError("unknown color %r (use #hex, ramp.i, outline, palette color name or char)" % c)

# ---------------------------------------------------------------- canvas

class Canvas:
    def __init__(self, w, h, palette=None):
        self.w, self.h = w, h
        self.pal = palette if isinstance(palette, Palette) else Palette(palette)
        self.g = [[None] * w for _ in range(h)]

    # access
    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def get(self, x, y):
        return self.g[y][x] if self.inside(x, y) else None

    def set(self, x, y, c):
        if self.inside(x, y):
            self.g[y][x] = resolve(self.pal, c)

    def filled(self):
        return {(x, y) for y in range(self.h) for x in range(self.w) if self.g[y][x]}

    def copy(self):
        c = Canvas(self.w, self.h, self.pal)
        c.g = [row[:] for row in self.g]
        return c

    # io
    def image(self):
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                c = self.g[y][x]
                if c:
                    px[x, y] = rgb(c) + (255,)
        return im

    def save(self, path, scale=1, preview=False, bg="#2A1D16"):
        im = self.image()
        if scale != 1:
            im = im.resize((self.w * scale, self.h * scale), Image.NEAREST)
        im.save(path)
        if preview:
            save_preview(self.image(), os.path.splitext(path)[0] + "_x8.png", bg=bg)
        return path

    @staticmethod
    def from_image(im, palette=None):
        im = im.convert("RGBA")
        c = Canvas(im.width, im.height, palette)
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                p = px[x, y]
                if p[3] >= 128:
                    c.g[y][x] = hx(p)
        return c


def canvas(w, h, palette=None):
    return Canvas(w, h, palette)


def save_preview(im, path, scale=8, bg="#2A1D16"):
    b = Image.new("RGBA", im.size, rgb(bg) + (255,))
    b.alpha_composite(im.convert("RGBA"))
    side = Image.new("RGBA", (im.width * 2 + 2, im.height), rgb(bg) + (255,))
    side.alpha_composite(b, (0, 0))
    lightbg = Image.new("RGBA", im.size, (200, 190, 170, 255))
    lightbg.alpha_composite(im.convert("RGBA"))
    side.alpha_composite(lightbg, (im.width + 2, 0))
    side.resize((side.width * scale, side.height * scale), Image.NEAREST).save(path)
    return path

# ---------------------------------------------------------------- masks (sets of (x,y))

def mask_rect(x0, y0, x1, y1):
    return {(x, y) for y in range(min(y0, y1), max(y0, y1) + 1) for x in range(min(x0, x1), max(x0, x1) + 1)}


def mask_ellipse(cx, cy, rx, ry):
    m = set()
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if rx > 0 and ry > 0 and ((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2 <= 1.0:
                m.add((x, y))
    return m


def mask_circle(cx, cy, r):
    return mask_ellipse(cx, cy, r, r)


def mask_poly(pts):
    """Filled polygon (scanline, pixel centers) + its edges, so thin shapes never vanish."""
    m = set()
    ys = [p[1] for p in pts]
    n = len(pts)
    for y in range(int(math.floor(min(ys))), int(math.ceil(max(ys))) + 1):
        yc = y + 0.5
        xs = []
        for i in range(n):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
            if (y0 <= yc < y1) or (y1 <= yc < y0):
                xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            for x in range(int(math.ceil(a - 0.5)), int(math.floor(b - 0.5)) + 1):
                m.add((x, y))
    for i in range(n):
        m |= set(line_pts(*pts[i], *pts[(i + 1) % n]))
    return m


def mask_line(x0, y0, x1, y1, width=1):
    pts = set(line_pts(x0, y0, x1, y1))
    if width > 1:
        pts = grow(pts, (width - 1) // 2 if width % 2 else width // 2, diag=width > 2)
    return pts


def mask_curve(points, width=1, steps=None):
    """Quadratic/cubic Bezier (3 or 4 control points) as a 1px (or wider) stroke."""
    steps = steps or 64
    out = []
    for i in range(steps + 1):
        t = i / steps
        if len(points) == 3:
            (a, b, c) = points
            x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0]
            y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]
        else:
            (a, b, c, d) = points
            x = (1 - t) ** 3 * a[0] + 3 * (1 - t) ** 2 * t * b[0] + 3 * (1 - t) * t * t * c[0] + t ** 3 * d[0]
            y = (1 - t) ** 3 * a[1] + 3 * (1 - t) ** 2 * t * b[1] + 3 * (1 - t) * t * t * c[1] + t ** 3 * d[1]
        out.append((int(round(x)), int(round(y))))
    m = set()
    for p, q in zip(out, out[1:]):
        m |= set(line_pts(*p, *q))
    m = pixel_perfect(m)
    return grow(m, width // 2, diag=False) if width > 1 else m


def line_pts(x0, y0, x1, y1):
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    out = []
    while True:
        out.append((x0, y0))
        if x0 == x1 and y0 == y1:
            return out
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def pixel_perfect(m):
    """Remove L-corner pixels from 1px strokes (classic 'pixel perfect' cleanup)."""
    m = set(m)
    for (x, y) in sorted(m):
        if (x, y) not in m:
            continue
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            if (x + dx, y) in m and (x, y + dy) in m and (x + dx, y + dy) not in m:
                nb = sum((x + a, y + b) in m for a in (-1, 0, 1) for b in (-1, 0, 1)) - 1
                if nb == 2:
                    m.discard((x, y))
                    break
    return m


def grow(m, r=1, diag=True):
    m = set(m)
    for _ in range(r):
        add = set()
        for (x, y) in m:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) + (((1, 1), (1, -1), (-1, 1), (-1, -1)) if diag else ()):
                add.add((x + dx, y + dy))
        m |= add
    return m


def shrink(m, r=1):
    m = set(m)
    for _ in range(r):
        m = {(x, y) for (x, y) in m if all((x + dx, y + dy) in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    return m


def edge(m, diag=False):
    """Pixels of m that touch the outside."""
    ds = ((1, 0), (-1, 0), (0, 1), (0, -1)) + (((1, 1), (1, -1), (-1, 1), (-1, -1)) if diag else ())
    return {(x, y) for (x, y) in m if any((x + dx, y + dy) not in m for dx, dy in ds)}


def mirror_mask(m, axis_x=None, axis_y=None):
    """Union of m and its reflection. axis_x=23.5 mirrors across the vertical line x=23.5 (48px canvas center)."""
    out = set(m)
    for (x, y) in m:
        if axis_x is not None:
            out.add((int(round(2 * axis_x - x)), y))
        if axis_y is not None:
            out.add((x, int(round(2 * axis_y - y))))
    return out


def translate(m, dx, dy):
    return {(x + dx, y + dy) for (x, y) in m}

# ---------------------------------------------------------------- painting

def fill(C, m, color):
    c = resolve(C.pal, color)
    for (x, y) in m:
        if C.inside(x, y):
            C.g[y][x] = c


def erase(C, m):
    fill(C, m, None)


def px(C, x, y, color):
    C.set(x, y, color)


def line(C, x0, y0, x1, y1, color, width=1):
    fill(C, mask_line(x0, y0, x1, y1, width), color)


def flood(C, x, y, color):
    target = C.get(x, y)
    c = resolve(C.pal, color)
    if target == c:
        return
    st = [(x, y)]
    while st:
        a, b = st.pop()
        if C.inside(a, b) and C.g[b][a] == target:
            C.g[b][a] = c
            st += [(a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)]


def _walk(m, x, y, dx, dy, cap):
    n = 0
    while n < cap and (x + dx * (n + 1), y + dy * (n + 1)) in m:
        n += 1
    return n


def shade(C, m, ramp, light="nw", style="round", levels=None, highlight=True, rim=True, dither=False, bias=0.0, smooth=0,
          edge_dither=0.15, ss=4, roundness=1.0, height=None):
    """Paint mask `m` with tones of `ramp` so it reads as a lit volume.
    style: round (sphere/blob) | cyl (long object; shades across its width) | flat (one tone + shadow edge) | bevel (flat face, lit/dark edges).
    levels: ramp indices to use, dark->light (default: all but the darkest, which is kept for outline/rim).
    bias: -0.3..0.3 overall darker/lighter. highlight: brightest tone on a few pixels nearest the light. rim: darkest-but-one on the shadow edge."""
    pal = C.pal
    tones = pal.ramps[ramp] if isinstance(ramp, str) else [resolve(pal, t) for t in ramp]
    n = len(tones)
    lv = list(levels) if levels else list(range(1, n))
    lx, ly = LIGHTS[light] if isinstance(light, str) else light
    if not m:
        return
    cap = max(C.w, C.h)
    xs = [p[0] for p in m]
    ys = [p[1] for p in m]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    vals = {}
    ln = math.hypot(lx, ly) or 1.0
    Lx, Ly = lx / ln, ly / ln
    pts = list(m)
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    proj = {p: (p[0] - mx) * Lx + (p[1] - my) * Ly for p in pts}  # larger = closer to the light
    pmin, pmax = min(proj.values()), max(proj.values())
    if style == "cyl":
        # principal axis (PCA); shade across the width: bands run parallel to the object's length
        sxx = sum((p[0] - mx) ** 2 for p in pts); syy = sum((p[1] - my) ** 2 for p in pts); sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
        ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
        ax, ay = math.cos(ang), math.sin(ang)
        nx, ny = -ay, ax
        if nx * Lx + ny * Ly < 0:
            nx, ny = -nx, -ny  # normal points toward the light
        bins = {}
        for p in pts:
            u = int(round((p[0] - mx) * ax + (p[1] - my) * ay))
            sv = (p[0] - mx) * nx + (p[1] - my) * ny
            lo, hi = bins.get(u, (sv, sv))
            bins[u] = (min(lo, sv), max(hi, sv))
    if style == "form":
        form_vals = _form_light(m, lx, ly, ss=ss, roundness=roundness, height=height)
    for (x, y) in pts:
        if style == "flat":
            t = 0.55
        elif style == "bevel":
            dl = _walk(m, x, y, lx, ly, cap)
            dd = _walk(m, x, y, -lx, -ly, cap)
            t = 0.55 + (0.35 if dl == 0 else 0) - (0.35 if dd == 0 else 0)
        elif style == "cyl":
            u = int(round((x - mx) * ax + (y - my) * ay))
            sv = (x - mx) * nx + (y - my) * ny
            lo, hi = bins[u]
            t = 0.5 if hi - lo < 0.5 else (sv - lo) / (hi - lo)
            t = 0.15 + 0.8 * t
        elif style == "form":
            t = form_vals[(x, y)]
        else:  # round: global projection toward the light + dome height (distance to edge)
            t_dir = (proj[(x, y)] - pmin) / ((pmax - pmin) or 1.0)
            e = min(_walk(m, x, y, 1, 0, cap), _walk(m, x, y, -1, 0, cap), _walk(m, x, y, 0, 1, cap), _walk(m, x, y, 0, -1, cap))
            span = max(1, min(max(xs) - min(xs), max(ys) - min(ys)) / 2)
            hgt = min(1.0, e / span)
            t = 0.7 * t_dir + 0.3 * hgt
        vals[(x, y)] = max(0.0, min(0.999, t + bias))
    for _ in range(smooth):  # box blur inside the mask removes single-pixel flicker before quantizing
        nv = {}
        for (x, y), t in vals.items():
            nb = [vals[q] for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)) if q in vals]
            nv[(x, y)] = (2 * t + sum(nb)) / (2 + len(nb))
        vals = nv
    hi_tone = lv[-1]
    body = lv[:-1] if highlight and len(lv) > 2 else lv
    nb_ = len(body)
    for (x, y), t in vals.items():
        f = t * nb_
        k = min(nb_ - 1, int(f))
        if dither and nb_ > 1:  # flat bands; checker dither only in a thin strip where two bands meet
            frac = f - k
            chk = (x + y) % 2 == 0
            if frac > 1 - edge_dither and k < nb_ - 1 and chk:
                k += 1
            elif frac < edge_dither and k > 0 and not chk:
                k -= 1
        C.g[y][x] = tones[body[k]]
    if rim and len(body) > 1:
        for (x, y) in m:
            if (x - lx, y - ly) not in m and (x + lx, y + ly) in m:
                C.g[y][x] = tones[body[0]]
    if highlight and len(lv) > 2:
        cand = sorted(m, key=lambda p: -vals[p])
        k = max(1, int(len(m) * 0.04))
        for (x, y) in cand[:k]:
            if vals[(x, y)] > 0.7:
                C.g[y][x] = tones[hi_tone]


def _chamfer(inside, W, H):
    """Distance (3-4 chamfer / 3) from every inside cell to the nearest outside cell."""
    INF = 10 ** 9
    d = [[(INF if inside[y][x] else 0) for x in range(W)] for y in range(H)]
    for y in range(H):
        for x in range(W):
            if d[y][x]:
                v = d[y][x]
                if x > 0: v = min(v, d[y][x - 1] + 3)
                else: v = min(v, 3)
                if y > 0:
                    v = min(v, d[y - 1][x] + 3)
                    if x > 0: v = min(v, d[y - 1][x - 1] + 4)
                    if x < W - 1: v = min(v, d[y - 1][x + 1] + 4)
                else:
                    v = min(v, 3)
                d[y][x] = v
    for y in range(H - 1, -1, -1):
        for x in range(W - 1, -1, -1):
            if d[y][x]:
                v = d[y][x]
                v = min(v, d[y][x + 1] + 3) if x < W - 1 else min(v, 3)
                if y < H - 1:
                    v = min(v, d[y + 1][x] + 3)
                    if x < W - 1: v = min(v, d[y + 1][x + 1] + 4)
                    if x > 0: v = min(v, d[y + 1][x - 1] + 4)
                else:
                    v = min(v, 3)
                d[y][x] = v
    return [[v / 3.0 for v in row] for row in d]


def _form_light(m, lx, ly, ss=4, roundness=1.0, height=None, lz=1.1):
    """Organic volume lighting: build a smooth height field from the mask at `ss`x resolution
    (distance to edge -> dome), light it with a 3D light from (lx, ly, up), average back to 1x.
    Returns {pixel: value 0..1} stretched to use the full range (5th-95th percentile)."""
    x0, y0, x1, y1 = bbox(m)
    W, H = (x1 - x0 + 3) * ss, (y1 - y0 + 3) * ss
    inside = [[((X // ss) + x0 - 1, (Y // ss) + y0 - 1) in m for X in range(W)] for Y in range(H)]
    # soften the blocky upsampled mask (box blur of occupancy, threshold 0.5) so heights follow a smooth outline
    r = ss // 2
    occ = [[1 if inside[Y][X] else 0 for X in range(W)] for Y in range(H)]
    integ = [[0] * (W + 1) for _ in range(H + 1)]
    for Y in range(H):
        acc = 0
        for X in range(W):
            acc += occ[Y][X]
            integ[Y + 1][X + 1] = integ[Y][X + 1] + acc
    soft = [[False] * W for _ in range(H)]
    for Y in range(H):
        for X in range(W):
            a, b = max(0, X - r), min(W, X + r + 1)
            c, d_ = max(0, Y - r), min(H, Y + r + 1)
            s = integ[d_][b] - integ[c][b] - integ[d_][a] + integ[c][a]
            soft[Y][X] = s * 2 >= (b - a) * (d_ - c)
    dist = _chamfer(soft, W, H)
    R = max(max(row) for row in dist) or 1.0
    hf = [[0.0] * W for _ in range(H)]
    for Y in range(H):
        for X in range(W):
            if dist[Y][X] > 0:
                u = min(1.0, dist[Y][X] / (R * roundness))
                hf[Y][X] = math.sqrt(1 - (1 - u) ** 2) * R * 0.9  # circular profile -> dome
                if height:
                    hf[Y][X] += height((X / ss) + x0 - 1, (Y / ss) + y0 - 1) * ss
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    Lx, Ly, Lz = lx / ln, ly / ln, lz / ln  # vector toward the light (light comes FROM (lx, ly) and from above)
    acc = {}
    for Y in range(1, H - 1):
        for X in range(1, W - 1):
            if dist[Y][X] <= 0:
                continue
            gx = (hf[Y][X + 1] - hf[Y][X - 1]) / 2.0
            gy = (hf[Y + 1][X] - hf[Y - 1][X]) / 2.0
            nx, ny, nz = -gx, -gy, 1.0
            nl = math.sqrt(nx * nx + ny * ny + nz * nz)
            v = (nx * Lx + ny * Ly + nz * Lz) / nl  # Lambert
            p = ((X // ss) + x0 - 1, (Y // ss) + y0 - 1)
            a = acc.setdefault(p, [0.0, 0])
            a[0] += v
            a[1] += 1
    vals = {p: a[0] / a[1] for p, a in acc.items() if p in m}
    for p in m:
        vals.setdefault(p, 0.3)
    srt = sorted(vals.values())
    lo, hi = srt[int(len(srt) * 0.05)], srt[min(len(srt) - 1, int(len(srt) * 0.95))]
    span = (hi - lo) or 1.0
    return {p: max(0.0, min(0.999, (v - lo) / span)) for p, v in vals.items()}


def rim_light(C, m=None, light="nw", steps=1):
    """Lighten (by `steps` ramp tones) the pixels on the lit edge of m (default: everything drawn).
    Call BEFORE outline(): rim_light(C); outline(C, selective=True)."""
    lx, ly = LIGHTS[light] if isinstance(light, str) else light
    src = set(m) if m is not None else C.filled()
    filled = C.filled()
    hits = {(x, y) for (x, y) in src if (lx and (x + lx, y) not in filled) or (ly and (x, y + ly) not in filled)}
    lighten(C, hits, steps)
    return len(hits)


def smooth_mask(m, holes=True):
    """Clean a silhouette mask: drop 1px nubs/spurs, fill 1px holes and dents. Use before shading."""
    m = set(m)
    for _ in range(2):
        nubs = {(x, y) for (x, y) in m if sum((x + dx, y + dy) in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))) <= 1}
        m -= nubs
        if holes:
            cand = set()
            for (x, y) in m:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    cand.add((x + dx, y + dy))
            fillin = {p for p in cand - m if sum((p[0] + dx, p[1] + dy) in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))) >= 3}
            m |= fillin
    return m


def edge_check(m):
    """Silhouette defects: nubs (pixels with <=1 neighbour), holes/dents (empty pixels with >=3 neighbours)."""
    nubs = [(x, y) for (x, y) in m if sum((x + dx, y + dy) in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))) <= 1]
    cand = set()
    for (x, y) in m:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cand.add((x + dx, y + dy))
    holes = [p for p in cand - set(m) if sum((p[0] + dx, p[1] + dy) in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))) >= 3]
    return nubs, holes


def glint(C, m, color=None, pos=0.78, length=0.75, light="nw", width=1):
    """Specular streak along a long object's axis, on its lit side (metal blades, glass, polished wood).
    pos: 0 = shadow edge .. 1 = lit edge. length: fraction of the object's length. color default: ramp tone 4 of the dominant ramp."""
    pts = list(m)
    if len(pts) < 4:
        return
    lx, ly = LIGHTS[light] if isinstance(light, str) else light
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts); syy = sum((p[1] - my) ** 2 for p in pts); sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ax, ay = math.cos(ang), math.sin(ang)
    nx, ny = -ay, ax
    if nx * lx + ny * ly < 0:
        nx, ny = -nx, -ny
    us = [(p[0] - mx) * ax + (p[1] - my) * ay for p in pts]
    umin, umax = min(us), max(us)
    sv = [(p[0] - mx) * nx + (p[1] - my) * ny for p in pts]
    smin, smax = min(sv), max(sv)
    s = smin + (smax - smin) * pos
    half = (umax - umin) * length / 2
    uc = (umin + umax) / 2
    a = (mx + ax * (uc - half) + nx * s, my + ay * (uc - half) + ny * s)
    b = (mx + ax * (uc + half) + nx * s, my + ay * (uc + half) + ny * s)
    if color is None:
        cnt = {}
        for (x, y) in pts:
            r = C.pal.ramp_of(C.g[y][x] or "")
            if r:
                cnt[r[0]] = cnt.get(r[0], 0) + 1
        color = (max(cnt, key=cnt.get) + ".4") if cnt else "white"
    fill(C, pixel_perfect(mask_line(a[0], a[1], b[0], b[1], width)) & set(m), color)


def outline(C, color="outline", selective=False, light="nw", corners=False, only=None):
    """Draw a 1px outline outside every filled pixel (or around mask `only`).
    selective: on the lit side use the darkest tone of the neighbouring fill's ramp instead of the outline color (softer, pro look)."""
    pal = C.pal
    base = resolve(pal, color)
    lx, ly = LIGHTS[light] if isinstance(light, str) else light
    src = set(only) if only is not None else C.filled()
    ds = ((1, 0), (-1, 0), (0, 1), (0, -1)) + (((1, 1), (1, -1), (-1, 1), (-1, -1)) if corners else ())
    out = {}
    for (x, y) in src:
        for dx, dy in ds:
            q = (x + dx, y + dy)
            if q in src or not C.inside(*q) or C.g[q[1]][q[0]]:
                continue
            col = base
            if selective and (dx * lx + dy * ly) > 0:
                r = pal.ramp_of(C.g[y][x] or "")
                if r:
                    col = pal.ramps[r[0]][0]
            if q not in out or out[q] == base:
                out[q] = col if q not in out else out[q]
    for (x, y), c in out.items():
        C.g[y][x] = c


def inner_line(C, m, color):
    """Darken the boundary of a sub-region inside an already-painted area (separates plates, straps, seams)."""
    fill(C, edge(m), color)


def texture(C, m, kind, colors, seed=1, step=2):
    """Overlay a pattern on mask m. kind: checker | bayer | stripes_h | stripes_v | diag | chain | weave | grain | noise | dots.
    colors: list of 1–2 colors to stamp (pattern pixels)."""
    rnd = random.Random(seed)
    cs = [resolve(C.pal, c) for c in colors]
    for (x, y) in m:
        put = None
        if kind == "checker" and (x + y) % 2 == 0:
            put = cs[0]
        elif kind == "bayer" and [[0, 2], [3, 1]][y % 2][x % 2] == 0:
            put = cs[0]
        elif kind == "stripes_h" and y % step == 0:
            put = cs[0]
        elif kind == "stripes_v" and x % step == 0:
            put = cs[0]
        elif kind == "diag" and (x + y) % step == 0:
            put = cs[0]
        elif kind == "chain":  # mail rings: 2x2 cells, ring hole dark, top-left glint
            cx, cy = (x + (y // 2 % 2)) % 2, y % 2
            if cx == 1 and cy == 1:
                put = cs[0]
            elif cx == 0 and cy == 0 and len(cs) > 1:
                put = cs[1]
        elif kind == "weave":
            if (x % 4 < 2) == (y % 4 < 2) and (x + y) % 2 == 0:
                put = cs[0]
        elif kind in ("grain", "grain_h"):  # wood grain: broken streaks along the plank (vertical, or horizontal for grain_h)
            a, b = (x, y) if kind == "grain" else (y, x)
            h = (a * 73856093 ^ seed * 19349663) & 0xFFFF
            if a % step == 0 and ((b + h) // (3 + h % 4)) % 3 != 0:
                put = cs[0]
        elif kind == "noise" and rnd.random() < 0.18:
            put = cs[rnd.randrange(len(cs))]
        elif kind == "dots" and x % step == 0 and y % step == 0:
            put = cs[0]
        if put and C.inside(x, y):
            C.g[y][x] = put


def recolor(C, m, mapping):
    """Swap colors inside m: mapping {from: to} (palette refs ok). Shift a whole ramp with ramp_shift."""
    mp = {resolve(C.pal, a): resolve(C.pal, b) for a, b in mapping.items()}
    for (x, y) in m:
        c = C.g[y][x]
        if c in mp:
            C.g[y][x] = mp[c]


def ramp_shift(C, m, src, dst):
    """Repaint pixels of ramp `src` inside m with the same tone index of ramp `dst`."""
    a, b = C.pal.ramps[src], C.pal.ramps[dst]
    for (x, y) in m:
        c = C.g[y][x]
        if c in a:
            C.g[y][x] = b[min(len(b) - 1, a.index(c))]


def recolor_hue(C, m, src_hue, dst_hue, hue_range=25.0, sat_mult=1.0, min_sat=0.12):
    """Shift every pixel in m whose hue is within hue_range degrees of src_hue to dst_hue, keeping lightness.
    Works on any colors (no palette snap), so hand-made shading survives exactly. Returns pixels changed."""
    n = 0
    for (x, y) in m:
        c = C.g[y][x]
        if not c:
            continue
        r, g, b = [v / 255.0 for v in rgb(c)]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        d = abs((h * 360 - src_hue + 180) % 360 - 180)
        if s < min_sat or d > hue_range:
            continue
        nh = ((h * 360 - src_hue) + dst_hue) % 360 / 360.0
        nr, ng, nb = colorsys.hls_to_rgb(nh, l, min(1.0, s * sat_mult))
        C.g[y][x] = hx((nr * 255, ng * 255, nb * 255))
        n += 1
    return n


def darken(C, m, steps=1):
    """Move pixels inside m down their ramp by `steps` (cast shadows, recesses)."""
    for (x, y) in m:
        c = C.g[y][x]
        r = C.pal.ramp_of(c or "")
        if r:
            t = C.pal.ramps[r[0]]
            C.g[y][x] = t[max(0, min(len(t) - 1, r[1] - steps))]


def lighten(C, m, steps=1):
    darken(C, m, -steps)


def clean(C, keep_lightest=True):
    """Remove orphan pixels (no same-color 8-neighbour and surrounded by one other color)."""
    removed = 0
    for y in range(C.h):
        for x in range(C.w):
            c = C.g[y][x]
            if not c:
                continue
            nb = [C.get(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]
            if c in nb:
                continue
            if keep_lightest and lum(c) > 0.7:
                continue
            vals = [v for v in nb if v]
            if vals and len(set(vals)) == 1 and len(vals) >= 6:
                C.g[y][x] = vals[0]
                removed += 1
    return removed


def load(path, palette=None):
    """Load a PNG/grid/script as a Canvas (e.g. an existing game sprite to kitbash from)."""
    return load_any(path, palette)


def crop(C, x0, y0, x1, y1, keep=None):
    """New canvas with the pixels of C inside the box (inclusive); `keep` = optional mask to cut a part out precisely."""
    out = Canvas(x1 - x0 + 1, y1 - y0 + 1, C.pal)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if C.inside(x, y) and C.g[y][x] and (keep is None or (x, y) in keep):
                out.g[y - y0][x - x0] = C.g[y][x]
    return out


def stamp(C, other, x0, y0):
    for y in range(other.h):
        for x in range(other.w):
            if other.g[y][x]:
                C.set(x0 + x, y0 + y, other.g[y][x])


def flip(C, horizontal=True):
    C.g = [row[::-1] for row in C.g] if horizontal else C.g[::-1]


def mirror(C, axis="x"):
    """Copy left half onto right half (axis x) or top onto bottom (axis y)."""
    if axis == "x":
        for y in range(C.h):
            for x in range(C.w // 2):
                C.g[y][C.w - 1 - x] = C.g[y][x]
    else:
        for y in range(C.h // 2):
            C.g[C.h - 1 - y] = C.g[y][:]


def region(C, color):
    c = resolve(C.pal, color)
    return {(x, y) for y in range(C.h) for x in range(C.w) if C.g[y][x] == c}


def bbox(m):
    xs = [p[0] for p in m]
    ys = [p[1] for p in m]
    return min(xs), min(ys), max(xs), max(ys)


def center(C):
    """Shift drawing so its bounding box is centered."""
    f = C.filled()
    if not f:
        return
    x0, y0, x1, y1 = bbox(f)
    dx = (C.w - (x1 - x0 + 1)) // 2 - x0
    dy = (C.h - (y1 - y0 + 1)) // 2 - y0
    g = [[None] * C.w for _ in range(C.h)]
    for (x, y) in f:
        if C.inside(x + dx, y + dy):
            g[y + dy][x + dx] = C.g[y][x]
    C.g = g

# ---------------------------------------------------------------- grid json  {"palette":..., "legend":{ch:color}, "rows":[...]}

def from_grid(d):
    pal = Palette(d.get("palette") or DEFAULT_PALETTE)
    legend = dict(pal.chars)
    legend.update(d.get("legend", {}))
    rows = d["rows"]
    w = int(d.get("size") or 0) or max(len(r) for r in rows)
    bad = [(i, len(r)) for i, r in enumerate(rows) if len(r) != w]
    if bad:  # tell the artist exactly which rows are off (they are padded/cropped, which shifts pixels)
        sys.stderr.write("grid warning: %d row(s) not %d chars wide: %s\n" % (len(bad), w, ", ".join("row %d=%d" % b for b in bad[:12])))
    if len(rows) != w and d.get("size"):
        sys.stderr.write("grid warning: %d rows, expected %d\n" % (len(rows), w))
    C = Canvas(w, max(len(rows), w if d.get("size") else len(rows)), pal)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r[:w].ljust(w, ".")):
            if ch in (".", " "):
                continue
            if ch not in legend:
                raise ValueError("row %d col %d: char %r not in legend" % (y, x, ch))
            C.g[y][x] = resolve(pal, legend[ch])
    return C


CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*+=?!<>^~"


def to_grid(C, palette_name=None):
    pal = C.pal
    rev = {}
    for ch, ref in pal.chars.items():
        try:
            rev.setdefault(resolve(pal, ref), ch)
        except Exception:
            pass
    used = sorted({c for row in C.g for c in row if c}, key=lambda c: (-lum(c)))
    legend = {}
    free = [ch for ch in CHARSET if ch not in pal.chars]
    cmap = {}
    for c in used:
        if c in rev:
            ch = rev[c]
            legend[ch] = pal.chars[ch]
        else:
            r = pal.ramp_of(c)
            ch = free.pop(0)
            legend[ch] = "%s.%d" % r if r else c
        cmap[c] = ch
    rows = ["".join(cmap[c] if c else "." for c in row) for row in C.g]
    return {"palette": palette_name or pal.name, "size": C.w, "legend": legend, "rows": rows}

# ---------------------------------------------------------------- loading any source

def load_any(path, palette=None):
    if path.endswith(".png"):
        return Canvas.from_image(Image.open(path), palette)
    if path.endswith(".json"):
        return from_grid(json.load(open(path, encoding="utf-8")))
    if path.endswith(".py"):
        return run_script(path)
    raise SystemExit("unsupported input: " + path)


def run_script(path):
    sys.path.insert(0, HERE)
    g = {"__name__": "__pxl__", "__file__": path}
    code = open(path, encoding="utf-8").read()
    exec(compile(code, path, "exec"), g)
    is_c = lambda v: type(v).__name__ == "Canvas" and hasattr(v, "g")
    if "C" in g and is_c(g["C"]):
        return g["C"]
    if "draw" in g:
        return g["draw"]()
    cands = [v for v in g.values() if is_c(v)]
    if cands:
        return cands[-1]
    raise SystemExit("script must leave a Canvas in global `C` (or define draw() returning one)")

# ---------------------------------------------------------------- text views (for models that cannot see images)

def show(C, lum_map=False):
    g = to_grid(C)
    w = C.w
    out = []
    tens = "".join(str(x // 10) if x % 10 == 0 else " " for x in range(w))
    units = "".join(str(x % 10) for x in range(w))
    out.append("    " + tens)
    out.append("    " + units)
    for y, r in enumerate(g["rows"]):
        out.append("%3d %s" % (y, r))
    out.append("legend: " + ", ".join("%s=%s" % (k, v) for k, v in g["legend"].items()))
    if lum_map:
        out.append("\nluminance 0(dark)-9(light), '.'=empty:")
        for y in range(C.h):
            out.append("%3d %s" % (y, "".join("." if not c else str(min(9, int(lum(c) * 10))) for c in C.g[y])))
    return "\n".join(out)

# ---------------------------------------------------------------- lint

def lint(C, sym=None, budget=None, palette=None, light="nw", kind="item"):
    """Concrete, fixable findings. Returns (score 0-100, [lines])."""
    F = []
    score = 100
    f = C.filled()
    if not f:
        return 0, ["EMPTY: nothing drawn"]
    x0, y0, x1, y1 = bbox(f)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    cover = len(f) / float(C.w * C.h)
    # size / margins
    margin = min(x0, y0, C.w - 1 - x1, C.h - 1 - y1)
    if margin < 1:
        F.append("MARGIN: sprite touches the canvas edge (bbox %d,%d-%d,%d); keep >=1px free so the outline fits" % (x0, y0, x1, y1))
        score -= 8
    if max(bw, bh) < 0.7 * min(C.w, C.h):
        F.append("SMALL: object spans only %dx%d of %dx%d; scale it up to use ~80-90%% of the canvas" % (bw, bh, C.w, C.h))
        score -= 10
    offx = (x0 + x1) / 2 - (C.w - 1) / 2
    offy = (y0 + y1) / 2 - (C.h - 1) / 2
    if abs(offx) > 2 or abs(offy) > 2:
        F.append("OFF-CENTER: bbox center off by (%+.1f, %+.1f); use center(C) or move shapes" % (offx, offy))
        score -= 4
    # colors
    cols = {}
    for (x, y) in f:
        cols[C.g[y][x]] = cols.get(C.g[y][x], 0) + 1
    budget = budget or (12 if C.w <= 24 else 22 if C.w <= 32 else 36)
    if len(cols) > budget:
        F.append("COLORS: %d colors used (budget %d); merge near-identical tones" % (len(cols), budget))
        score -= 6
    if palette:
        pal = palette if isinstance(palette, Palette) else Palette(palette)
        allc = pal.all_colors()
        off = [c for c in cols if c not in allc]
        if off:
            F.append("OFF-PALETTE: %d colors not in palette %s: %s" % (len(off), pal.name, ", ".join(off[:8])))
            score -= min(15, 3 * len(off))
    # outline
    sil = edge(f)
    weak = [(x, y) for (x, y) in sil if lum(C.g[y][x]) > 0.15]
    if len(weak) > 0.25 * len(sil):
        F.append("OUTLINE: %d/%d silhouette pixels are light (no dark contour) e.g. %s; run outline(C) or darken the edge" % (len(weak), len(sil), weak[:6]))
        score -= 12
    # orphans: single pixels that pop out of their surroundings (low-contrast texture pixels are fine)
    orph = []
    for (x, y) in f:
        c = C.g[y][x]
        nb = [C.get(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]
        if c in nb or lum(c) >= 0.75:
            continue
        vals = [lum(v) for v in nb if v]
        if vals and abs(lum(c) - sum(vals) / len(vals)) > 0.22:
            orph.append((x, y))
    if len(orph) > max(4, len(f) * 0.015):
        F.append("NOISE: %d isolated high-contrast single pixels, e.g. %s; merge them into a neighbour tone or call clean(C)" % (len(orph), orph[:8]))
        score -= min(15, len(orph) // 2)
    # stray / detached islands
    comps = _components(f)
    small = [c for c in comps if len(c) <= 3]
    if len(comps) > 1 and small:
        F.append("STRAY: %d tiny detached pixel groups, e.g. at %s; delete or connect them" % (len(small), [sorted(c)[0] for c in small[:5]]))
        score -= 5
    # light direction, per material: within each ramp, pixels on the lit side should use higher tones
    lx, ly = LIGHTS[light]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    groups = {}
    for (x, y) in f:
        if (x, y) in sil:
            continue
        r = C.pal.ramp_of(C.g[y][x])
        if r:
            groups.setdefault(r[0], []).append((x, y))
    wsum = diff = 0.0
    for rn, pts in groups.items():
        if len(pts) < 12:
            continue
        gx = sum(p[0] for p in pts) / len(pts)
        gy = sum(p[1] for p in pts) / len(pts)
        lit = [_tone(C, C.g[y][x]) for (x, y) in pts if (x - gx) * lx + (y - gy) * ly > 1]
        dark = [_tone(C, C.g[y][x]) for (x, y) in pts if (x - gx) * lx + (y - gy) * ly < -1]
        if len(lit) >= 4 and len(dark) >= 4:
            diff += (sum(lit) / len(lit) - sum(dark) / len(dark)) * len(pts)
            wsum += len(pts)
    if wsum and diff / wsum < -0.05:
        F.append("LIGHT: within each material the side facing the light (%s) is not brighter (avg tone diff %+.2f); put tones 3-4 toward %s, 1-0 on the opposite side (ignore if the lighting is intentionally different)" % (light, diff / wsum, light))
        score -= 8
    # pillow shading: brightness follows "distance from edge" instead of the light direction
    interior = [p for p in f if p not in sil]
    if len(interior) > 40:
        depth = {}
        for (x, y) in interior:
            depth[(x, y)] = min(_walk(f, x, y, 1, 0, 99), _walk(f, x, y, -1, 0, 99), _walk(f, x, y, 0, 1, 99), _walk(f, x, y, 0, -1, 99))
        L = [lum(C.g[y][x]) for (x, y) in interior]
        D = [depth[p] for p in interior]
        P = [(x - cx) * lx + (y - cy) * ly for (x, y) in interior]
        cd, cp = _corr(L, D), _corr(L, P)
        if cd > 0.55 and cp < 0.25:
            F.append("PILLOW: brightness follows distance-from-edge (r=%.2f) not the light direction (r=%.2f); light the %s side, darken the opposite side, keep the core mid-tone" % (cd, cp, light))
            score -= 12
    # tonal range
    ls = sorted(lum(c) for c in cols)
    if ls[-1] - ls[0] < 0.35:
        F.append("FLAT: luminance range only %.2f; add a darker shadow tone and a light highlight" % (ls[-1] - ls[0]))
        score -= 10
    # near-duplicate adjacent colors
    pairs = set()
    for (x, y) in f:
        c = C.g[y][x]
        for dx, dy in ((1, 0), (0, 1)):
            d = C.get(x + dx, y + dy)
            if d and d != c and abs(lum(c) - lum(d)) < 0.025 and _cdist(c, d) < 30 and max(lum(c), lum(d)) > 0.07:
                pairs.add(tuple(sorted((c, d))))
    if pairs:
        F.append("MUDDY: %d adjacent color pairs are almost identical (%s); use one of each pair" % (len(pairs), "; ".join("%s~%s" % p for p in list(pairs)[:4])))
        score -= min(8, 2 * len(pairs))
    # banding: a tone boundary that exactly follows the outline at 1px (outline doubled)
    if len(f) > 80:
        ring2 = edge(f - sil)
        if ring2:
            dk = [p for p in ring2 if lum(C.g[p[1]][p[0]]) < 0.12]
            if len(dk) > 0.6 * len(ring2):
                F.append("DOUBLE-OUTLINE: the pixels just inside the contour are also near-black (%d/%d); the outline looks 2px thick — use mid/dark tones there" % (len(dk), len(ring2)))
                score -= 8
    # symmetry
    if sym:
        tot = same = 0
        for (x, y) in f:
            q = (x1 + x0 - x, y) if sym == "x" else (x, y1 + y0 - y)
            tot += 1
            same += (q in f)
        s = same / float(tot)
        if s < 0.9:
            F.append("SYMMETRY: only %d%% of the silhouette mirrors across %s; fix the shape (or ignore if asymmetry is intended)" % (int(s * 100), sym))
            score -= 6
    # silhouette readability: holes / very thin parts
    thin = len(f) - len(grow(shrink(f, 1), 1, diag=False) & f)
    if len(f) > 100 and thin > 0.45 * len(f):
        F.append("THIN: most of the shape is 1-2px wide (%d px); at game size it will read as noise — thicken the main mass" % thin)
        score -= 6
    F.insert(0, "STATS: %dx%d canvas, bbox %dx%d at (%d,%d), coverage %d%%, %d colors, %d parts" % (C.w, C.h, bw, bh, x0, y0, int(cover * 100), len(cols), len(comps)))
    if len(F) == 1:
        F.append("OK: no issues found")
    return max(0, score), F


def silhouette(C):
    f = C.filled()
    return "\n".join("%3d %s" % (y, "".join("#" if (x, y) in f else "." for x in range(C.w))) for y in range(C.h))


def _components(f):
    seen = set()
    comps = []
    for p in f:
        if p in seen:
            continue
        st = [p]
        comp = set()
        seen.add(p)
        while st:
            x, y = st.pop()
            comp.add((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in f and q not in seen:
                        seen.add(q)
                        st.append(q)
        comps.append(comp)
    return comps


def _tone(C, c):
    """Brightness of a color relative to its own material ramp (0..1); raw luminance for off-ramp colors."""
    r = C.pal.ramp_of(c)
    if r:
        return r[1] / float(len(C.pal.ramps[r[0]]) - 1)
    return lum(c)


def _corr(a, b):
    n = len(a)
    if n < 3:
        return 0.0
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va <= 0 or vb <= 0:
        return 0.0
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def _cdist(a, b):
    ra, rb = rgb(a), rgb(b)
    return math.sqrt(sum((p - q) ** 2 for p, q in zip(ra, rb)))

# ---------------------------------------------------------------- convert (any image -> palette pixel art)

def cutout_background(im, thresh=28):
    """Images without transparency (typical AI illustrations on a flat dark/light background): make the background transparent.
    Flood-fills from the four corners with a color tolerance, so dark parts INSIDE the object survive."""
    from PIL import ImageDraw
    im = im.convert("RGBA")
    if im.getextrema()[3][0] < 255:
        return im  # already has transparency
    w, h = im.size
    key = (255, 0, 255)
    rgb_im = im.convert("RGB")
    for pt in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if rgb_im.getpixel(pt) != key:
            ImageDraw.floodfill(rgb_im, pt, key, thresh=thresh)
    out = im.copy()
    px_rgb, px = rgb_im.load(), out.load()
    cleared = 0
    for y in range(h):
        for x in range(w):
            if px_rgb[x, y] == key:
                px[x, y] = (0, 0, 0, 0)
                cleared += 1
    # a cutout that removed almost nothing or almost everything was not a background: keep the original
    return out if 0.05 < cleared / float(w * h) < 0.97 else im


def two_ramp_map(C, dark, glow, boost=True):
    """Map every pixel to a 'body' ramp (dark/neutral parts) or a 'glow' ramp (bright, saturated parts such as lava veins, gems, flames).
    Restores the body-vs-glow contrast that nearest-color matching loses on AI illustrations."""
    import colorsys
    D = [rgb(c) for c in C.pal.ramps[dark]]
    G = [rgb(c) for c in C.pal.ramps[glow]]
    for y in range(C.h):
        for x in range(C.w):
            c = C.g[y][x]
            if not c:
                continue
            r, g, b = rgb(c)
            h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            if (s > 0.45 and v > 0.5) or (v > 0.78 and s > 0.25):
                t = min(1.0, max(0.0, (v - 0.45) / 0.55))
                C.g[y][x] = hx(G[min(len(G) - 1, int(t * len(G)))])
            else:
                C.g[y][x] = hx(D[min(len(D) - 2, max(0, int((v / 0.75) * (len(D) - 1))))])
    return C


def auto_ramps(im, pal):
    """Pick (body, glow) ramps for a dark illustration with glowing parts, or None when the image has no real glow
    (then plain palette matching is better). Glow = saturated + bright pixels; its dominant hue picks the glow ramp."""
    import colorsys
    small = im.convert("RGBA")
    small.thumbnail((96, 96))
    px = [p for p in small.get_flattened_data() if p[3] >= 128] if hasattr(small, "get_flattened_data") else [p for p in small.getdata() if p[3] >= 128]
    if len(px) < 50:
        return None
    hues = [0] * 6
    glow = body = dark = 0
    vsum = 0.0
    for r, g, b, _a in px:
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        vsum += v
        if v < 0.3:
            dark += 1
        if (s > 0.45 and v > 0.7) or (v > 0.85 and s > 0.25):
            glow += 1
            d = h * 360
            hues[0 if (d < 50 or d >= 330) else 1 if d < 70 else 2 if d < 170 else 3 if d < 200 else 4 if d < 260 else 5] += 1
        elif v < 0.62:
            body += 1
    n = float(len(px))
    if glow / n < 0.03 or body / n < 0.25 or dark / n < 0.25 or vsum / n > 0.55:  # needs a very dark body with emissive glow
        return None
    glow_ramp = ["fire", "brass", "green", "glass", "blue", "purple"][max(range(6), key=lambda i: hues[i])]
    body_ramp = "stone" if "stone" in pal.ramps else "iron"
    if glow_ramp not in pal.ramps or body_ramp not in pal.ramps:
        return None
    return [body_ramp, glow_ramp]


def convert(im, size, palette=None, colors=None, do_outline=True, ramps=None, enhance=True):
    big = max(im.size) >= 256  # illustrations/photos, not already-pixelated sprites
    if max(im.size) > 768:  # background cut-out and scaling are pure Python: work on a sane size
        im = im.copy()
        im.thumbnail((768, 768), Image.LANCZOS)
    im = cutout_background(im)
    if ramps == ["auto"]:
        ramps = auto_ramps(im, Palette(palette)) if big else None
    if enhance and im.mode == "RGBA":  # AI illustrations are dark and soft: more contrast/saturation survives downscaling
        from PIL import ImageEnhance
        a = im.split()[3]
        rgb_im = ImageEnhance.Color(ImageEnhance.Contrast(im.convert("RGB")).enhance(1.35)).enhance(1.4)
        im = rgb_im.convert("RGBA")
        im.putalpha(a)
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    s = (size - 2) / float(max(im.width, im.height))
    tw, th = max(1, int(round(im.width * s))), max(1, int(round(im.height * s)))
    small = im.resize((tw, th), Image.BOX)
    C = Canvas(size, size, palette)
    ox, oy = (size - tw) // 2, (size - th) // 2
    p = small.load()
    raw = {}
    for y in range(th):
        for x in range(tw):
            q = p[x, y]
            if q[3] >= 128:
                raw[(x + ox, y + oy)] = hx(q)
    if colors:  # reduce distinct colors first (median cut)
        tmp = Image.new("RGB", (len(raw) or 1, 1))
        keys = list(raw)
        tmp.putdata([rgb(raw[k]) for k in keys] or [(0, 0, 0)])
        q = tmp.quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGB")
        for i, k in enumerate(keys):
            raw[k] = hx(q.getpixel((i, 0)))
    for (x, y), c in raw.items():
        C.g[y][x] = C.pal.nearest(c) if palette else c
    if ramps:
        two_ramp_map(C, ramps[0], ramps[1])
    clean(C)
    if do_outline:
        f = C.filled()
        for (x, y) in edge(f):
            darken(C, {(x, y)}, 2)
        outline(C)
    return C

# ---------------------------------------------------------------- CLI

def _arg(args, name, default=None, cast=str):
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i:i + 2]
        return cast(v)
    return default


def _flag(args, name):
    if name in args:
        args.remove(name)
        return True
    return False


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    if cmd == "render":
        out = _arg(args, "-o")
        scale = _arg(args, "--scale", 1, int)
        prev = _flag(args, "--preview")
        step_dir = _arg(args, "--step-dir") or os.environ.get("PXL_STEP_DIR")
        as_json = _flag(args, "--json")
        C = load_any(args[0])
        out = out or os.path.splitext(args[0])[0] + ".png"
        C.save(out, scale=scale, preview=prev)
        sc, F = lint(C)
        step = None
        if step_dir:  # live-watch support: every render also lands as step_###.png (+ .json with lint) in step_dir
            os.makedirs(step_dir, exist_ok=True)
            n = len([f for f in os.listdir(step_dir) if f.startswith("step_") and f.endswith(".png")]) + 1
            step = os.path.join(step_dir, "step_%03d.png" % n)
            C.save(step)
            json.dump({"step": n, "score": sc, "lint": F, "source": os.path.abspath(args[0]), "out": os.path.abspath(out)},
                      open(step[:-4] + ".json", "w", encoding="utf-8"), ensure_ascii=False)
        if as_json:
            print(json.dumps({"out": out, "w": C.w, "h": C.h, "score": sc, "lint": F, "step": step}, ensure_ascii=False))
        else:
            print("wrote %s (%dx%d)%s  lint score %d" % (out, C.w, C.h, " + preview " + os.path.splitext(out)[0] + "_x8.png" if prev else "", sc))
            for l in F:
                print("  " + l)
            if _flag(args, "--show"):  # one call = render + lint + ASCII view (saves an agent turn)
                print(show(C, False))
    elif cmd == "diff":
        # pixel difference between two images; with --region, reports changes outside the region separately
        region = _arg(args, "--region")
        A, B = load_any(args[0]), load_any(args[1])
        w, h = max(A.w, B.w), max(A.h, B.h)
        box = [int(v) for v in region.split(",")] if region else None
        inside = outside = 0
        pts = []
        for y in range(h):
            for x in range(w):
                if A.get(x, y) != B.get(x, y):
                    if box and box[0] <= x <= box[2] and box[1] <= y <= box[3]:
                        inside += 1
                    else:
                        outside += 1
                        if len(pts) < 20:
                            pts.append((x, y))
        print(json.dumps({"changed_inside": inside, "changed_outside": outside, "outside_examples": pts, "region": box}))
    elif cmd == "crop":
        # crop a region (x0,y0,x1,y1) and optionally upscale: for region feedback (vision) or ASCII (blind)
        region = _arg(args, "--region")
        scale = _arg(args, "--scale", 8, int)
        out = _arg(args, "-o")
        ascii_ = _flag(args, "--ascii")
        C = load_any(args[0])
        x0, y0, x1, y1 = [int(v) for v in region.split(",")]
        part = crop(C, x0, y0, x1, y1)
        if ascii_:
            print("region %d,%d-%d,%d (top-left = %d,%d):" % (x0, y0, x1, y1, x0, y0))
            print(show(part))
        if out:
            save_preview(part.image(), out, scale=scale)
            print("wrote", out)
    elif cmd == "palette-from":
        # build a palette json (ramps grouped by hue, dark->light) from any PNG's colors
        out = _arg(args, "-o")
        name = _arg(args, "--name") or os.path.splitext(os.path.basename(args[0]))[0]
        im = Image.open(args[0]).convert("RGBA")
        px_ = im.load()
        cols = sorted({hx(px_[x, y]) for y in range(im.height) for x in range(im.width) if px_[x, y][3] >= 128})
        groups = {}
        for c in cols:
            r, g, b = [v / 255.0 for v in rgb(c)]
            hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
            key = "grey" if ss < 0.15 else "h%03d" % (int(hh * 12) * 30)
            groups.setdefault(key, []).append(c)
        ramps = {k: sorted(v, key=lum) for k, v in groups.items() if len(v) >= 2}
        flat = {"c%02d" % i: c for i, c in enumerate(cols)}
        d = {"name": name, "outline": min(cols, key=lum), "ramps": ramps, "colors": flat, "chars": {"o": "outline"}}
        s_ = json.dumps(d, indent=1)
        if out:
            open(out, "w").write(s_)
            print("wrote", out, "(%d colors, %d ramps)" % (len(cols), len(ramps)))
        else:
            print(s_)
    elif cmd == "show":
        lm = _flag(args, "--lum")
        print(show(load_any(args[0]), lm))
    elif cmd == "silhouette":
        print(silhouette(load_any(args[0])))
    elif cmd == "lint":
        sym = _arg(args, "--sym")
        budget = _arg(args, "--budget", None, int)
        pal = _arg(args, "--palette")
        light = _arg(args, "--light", "nw")
        C = load_any(args[0])
        sc, F = lint(C, sym=sym, budget=budget, palette=pal, light=light)
        print("score %d/100" % sc)
        for l in F:
            print("- " + l)
    elif cmd == "dump":
        out = _arg(args, "-o")
        pal = _arg(args, "--palette", DEFAULT_PALETTE)
        snap = _flag(args, "--snap")
        C = load_any(args[0], pal)
        if snap:  # map every color to the nearest palette color (fewer chars, palette-true example)
            for y in range(C.h):
                for x in range(C.w):
                    if C.g[y][x]:
                        C.g[y][x] = C.pal.nearest(C.g[y][x])
        d = to_grid(C, pal)
        s = json.dumps(d, ensure_ascii=False, indent=1)
        if out:
            open(out, "w", encoding="utf-8").write(s)
            print("wrote", out)
        else:
            print(s)
    elif cmd == "convert":
        size = _arg(args, "--size", 48, int)
        pal = _arg(args, "--palette", DEFAULT_PALETTE)
        colors = _arg(args, "--colors", None, int)
        out = _arg(args, "-o") or os.path.splitext(args[0])[0] + "_px.png"
        ramps = _arg(args, "--ramps")  # "body,glow" e.g. stone,fire: two-ramp mapping for dark illustrations with glowing parts
        C = convert(Image.open(args[0]), size, None if pal == "none" else pal, colors, ramps=ramps.split(",") if ramps and ramps != "none" else None, enhance=not _flag(args, "--no-enhance"))
        C.save(out, preview=True)
        print("wrote", out)
    elif cmd == "snap":
        # Palette-index strictness: every opaque pixel -> nearest palette colour (no resize). With --grid, first repair the
        # pixel grid of an enlarged/blurred image using proper-pixel-art (optional dependency, MIT; skipped if missing).
        pal = _arg(args, "--palette", DEFAULT_PALETTE)
        out = _arg(args, "-o") or os.path.splitext(args[0])[0] + "_snap.png"
        im = Image.open(args[0]).convert("RGBA")
        if "--grid" in args:
            try:
                from proper_pixel_art.image import pixelate
                im = pixelate(im).image.convert("RGBA")
            except Exception as ex:  # noqa: BLE001
                print("grid repair skipped:", ex)
        C = Canvas(im.width, im.height, pal)
        px_ = im.load()
        off = 0
        for y in range(im.height):
            for x in range(im.width):
                q = px_[x, y]
                if q[3] >= 128:
                    c = hx(q)
                    n = C.pal.nearest(c)
                    off += n != c
                    C.g[y][x] = n
        C.save(out, preview=False)
        print("wrote %s (%d pixels moved onto palette)" % (out, off))
    elif cmd == "variant":
        # Recolor an existing on-style sprite (kitbash): snap to palette, then swap material ramps.
        out = _arg(args, "-o")
        swap = _arg(args, "--swap", "")
        hue = _arg(args, "--hue", "")
        region = _arg(args, "--region", None)
        pal = _arg(args, "--palette", DEFAULT_PALETTE)
        C = load_any(args[0], pal)
        allp = C.filled()
        if region:  # x0,y0,x1,y1 limits the change to a box (e.g. only the blade)
            x0, y0, x1, y1 = [int(v) for v in region.split(",")]
            allp = {p for p in allp if x0 <= p[0] <= x1 and y0 <= p[1] <= y1}
        for spec in [p for p in hue.split(",") if p]:
            # SRC:DST[:RANGE[:SAT]] in degrees: shift pixels whose hue is within RANGE of SRC to DST, keeping
            # lightness (the original shading survives exactly). SAT multiplies saturation (0 = grey/steel).
            parts = spec.split(":")
            src, dst = float(parts[0]), float(parts[1])
            rng_ = float(parts[2]) if len(parts) > 2 else 25.0
            satm = float(parts[3]) if len(parts) > 3 else 1.0
            n = recolor_hue(C, allp, src, dst, rng_, satm)
            print("hue %s: %d px" % (spec, n))
        if swap:
            for p in allp:
                C.g[p[1]][p[0]] = C.pal.nearest(C.g[p[1]][p[0]])
            for pair in [p for p in swap.split(",") if p]:
                a, b = pair.split(":")
                for src in a.split("+"):
                    ramp_shift(C, allp, src, b)
        out = out or os.path.splitext(args[0])[0] + "_variant.png"
        C.save(out, preview=True)
        print("wrote", out)
    elif cmd == "sheet":
        out = _arg(args, "-o", "sheet.png")
        scale = _arg(args, "--scale", 4, int)
        ims = [(os.path.splitext(os.path.basename(p))[0], load_any(p).image()) for p in args]
        cell = max(max(i.width, i.height) for _, i in ims) * scale
        from PIL import ImageDraw
        sh = Image.new("RGBA", ((cell + 8) * len(ims) + 8, cell + 30), rgb("#2A1D16") + (255,))
        d = ImageDraw.Draw(sh)
        for k, (name, im) in enumerate(ims):
            big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
            x = 8 + k * (cell + 8)
            sh.alpha_composite(big, (x + (cell - big.width) // 2, 22 + (cell - big.height) // 2))
            d.text((x, 4), "%d %s" % (k + 1, name[:22]), fill=(241, 230, 207, 255))
        sh.save(out)
        print("wrote", out)
    elif cmd == "palette":
        p = Palette(args[0] if args else DEFAULT_PALETTE)
        print("palette %s  outline %s" % (p.name, p.outline))
        for k, v in p.ramps.items():
            print("  ramp %-10s %s" % (k, " ".join(v)))
        for k, v in p.colors.items():
            print("  color %-9s %s" % (k, v))
        if p.chars:
            print("  chars: " + " ".join("%s=%s" % kv for kv in p.chars.items()))
    elif cmd == "ramp":
        n = int(args[1]) if len(args) > 1 else 5
        print(" ".join(make_ramp(args[0], n)))
    else:
        print("unknown command", cmd)
        return 2
    return 0


__all__ = [n for n in dir() if not n.startswith("_") and n not in ("json", "math", "os", "random", "sys", "colorsys", "Image", "HERE", "main")]

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
