#!/usr/bin/env python3
"""Engine self-test (no network, a few seconds): python3 engine/scripts/selftest.py"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pxl  # noqa: E402

PXL = os.path.join(HERE, "pxl.py")
RECIPES = os.path.join(HERE, "..", "references", "recipes")
fails = []


def check(name, cond, info=""):
    print(("ok   " if cond else "FAIL ") + name + (("  " + info) if info and not cond else ""))
    if not cond:
        fails.append(name)


def run(*args, env=None):
    return subprocess.run([sys.executable, PXL, *args], capture_output=True, text=True, env={**os.environ, **(env or {})})


with tempfile.TemporaryDirectory() as t:
    # every recipe renders and lints >= 80
    for f in sorted(os.listdir(RECIPES)):
        if f.endswith(".py"):
            C = pxl.run_script(os.path.join(RECIPES, f))
            sc, _ = pxl.lint(C)
            check("recipe " + f, sc >= 80, "score %d" % sc)
    C = pxl.run_script(os.path.join(RECIPES, "potion.py"))
    png = os.path.join(t, "p.png")
    C.save(png)
    # png -> grid -> png round trip
    g = pxl.to_grid(pxl.load_any(png))
    C2 = pxl.from_grid(g)
    check("grid round trip", C2.g == pxl.load_any(png).g)
    # step dir capture
    steps = os.path.join(t, "steps")
    r = run("render", os.path.join(RECIPES, "sword.py"), "-o", os.path.join(t, "s.png"), "--json", env={"PXL_STEP_DIR": steps})
    j = json.loads(r.stdout)
    check("render --json + step dir", j["step"] and os.path.exists(os.path.join(steps, "step_001.png")) and os.path.exists(os.path.join(steps, "step_001.json")))
    # diff with region
    r = run("diff", png, png, "--region", "0,0,10,10")
    check("diff identical", json.loads(r.stdout)["changed_outside"] == 0)
    r = run("diff", png, os.path.join(t, "s.png"), "--region", "0,0,5,5")
    check("diff detects outside changes", json.loads(r.stdout)["changed_outside"] > 0)
    # lint catches a deliberately bad sprite (pillow shading, no outline)
    B = pxl.canvas(48, 48)
    for (x, y) in pxl.mask_circle(24, 24, 18):
        d = ((x - 24) ** 2 + (y - 24) ** 2) ** 0.5
        B.set(x, y, "red.%d" % (4 - min(3, int(d / 5))))
    sc, F = pxl.lint(B)
    check("lint flags pillow + outline", any("PILLOW" in l for l in F) and any("OUTLINE" in l for l in F), str(F))
    # hue variant keeps lightness
    V = pxl.load_any(png)
    n = pxl.recolor_hue(V, V.filled(), 0, 215, 30)
    check("recolor_hue changes red pixels", n > 50)
    # every palette loads and resolves its ramps
    for f in os.listdir(os.path.join(HERE, "..", "assets", "palettes")):
        P = pxl.Palette(f[:-5])
        check("palette " + f, len(P.ramps) > 0 and P.outline.startswith("#"))

print("\n%d failure(s)" % len(fails))
sys.exit(1 if fails else 0)
