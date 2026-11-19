#!/usr/bin/env python3
"""Draw the bench subjects with one strategy.

  python3 bench/run.py S2 [--model sonnet] [--effort medium] [--only sword,axe] [--par 3] [--tag name]

Strategies:
  S1  procedural script (masks -> shade -> outline), the original workflow
  S2  direct grid: the model writes the pixel grid row by row
  S3  hybrid: procedural block-in, then hand-painting the dumped grid
  S4  S3 + 2 critic rounds (a vision critic lists the worst problems with pixel regions; the artist fixes them)
Output: bench/runs/<tag or strategy>/<subject>/{final.png, steps/, log.jsonl}
The subject's own CC0 reference is hidden from the artist (refs/ holds only OTHER examples)."""
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ENGINE = os.path.join(ROOT, "engine")
PXL = os.path.join(ENGINE, "scripts", "pxl.py")
EXAMPLES = os.path.join(ENGINE, "references", "examples")
SUBJECTS = json.load(open(os.path.join(HERE, "subjects.json")))


def claude(prompt, cwd, model, effort, tools=True, timeout=1500):
    args = ["claude", "-p", "--output-format", "stream-json", "--verbose", "--model", model, "--no-session-persistence", "--strict-mcp-config"]
    if effort:
        args += ["--effort", effort]
    if tools:
        args += ["--tools", "Bash", "Read", "Write", "Edit", "--allowedTools", "Bash(python3:*)", "Read", "Write", "Edit",
                 "--permission-mode", "acceptEdits", "--add-dir", ENGINE]
    else:
        args += ["--tools", "Read", "--allowedTools", "Read"]
    env = {**os.environ, "PXL_STEP_DIR": os.path.join(cwd, "steps"), "PYTHONDONTWRITEBYTECODE": "1"}
    t0 = time.time()
    p = subprocess.run(args, input=prompt, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    text, result = [], ""
    with open(os.path.join(cwd, "log.jsonl"), "a") as log:
        for line in p.stdout.splitlines():
            log.write(line + "\n")
            try:
                j = json.loads(line)
            except Exception:
                continue
            if j.get("type") == "result":
                result = str(j.get("result", ""))
            if j.get("type") == "assistant":
                for c in j["message"].get("content", []):
                    if c.get("type") == "text":
                        text.append(c["text"])
    return result or "\n".join(text), time.time() - t0


def header(s):
    return f"""You are a pixel artist. Draw a {s['size']}x{s['size']} sprite of: {s['brief']}.
Transparent background, palette "studio" (see `python3 {PXL} palette studio`), light from the top-left, 1px dark outline.
First read {ENGINE}/SKILL.md and {ENGINE}/references/technique.md (especially 1b: the object must work in the real world).
Hand-made reference sprites of OTHER objects are in ./refs (PNG to look at, JSON grids to read) — study 2 of them for proportions, tone count, highlights and texture. Do NOT open {EXAMPLES}.
Work only in the current directory. Every `python3 {PXL} render ...` you run is recorded as a step: render after each stage.
The result must be ./final.png ({s['size']}x{s['size']}). Look at final_x8.png after renders (render with --preview).
"""


PROMPTS = {
    "S1": lambda s: header(s) + f"""
Method: write ./draw.py with the pxl toolkit (masks -> shade -> outline -> details) as described in SKILL.md, render with
  python3 {PXL} render draw.py -o final.png --preview
then check with lint and the preview, at most 3 fix rounds.""",
    "S2": lambda s: header(s) + f"""
Method: DIRECT GRID. Write ./grid.json yourself:
  {{"palette": "studio", "legend": {{"o": "outline", "a": "steel.1", "b": "steel.3", "c": "#FFFBEF", ...}}, "rows": ["{'.' * s['size']}", ... {s['size']} rows of {s['size']} chars]}}
('.' = transparent; legend values are palette refs "ramp.i" (0 darkest..4 lightest), "outline", or #hex).
Plan first: on paper decide the silhouette row by row (where each row starts/ends), then flat colors, then shadow/light, highlights, texture hints, outline.
Render: python3 {PXL} render grid.json -o final.png --preview   (rows are checked; fix any length errors).
Then improve by editing individual rows (Edit tool) — at most 4 improvement rounds, rendering after each.""",
    "S3": lambda s: header(s) + f"""
Method: HYBRID.
1) Block in with ./draw.py (masks -> shade -> outline): correct silhouette, proportions and base tones. Render: python3 {PXL} render draw.py -o final.png --preview
2) Convert to an editable grid: python3 {PXL} dump final.png --snap -o grid.json   (each row is one line in the file)
3) Hand-paint grid.json like a pixel artist (Edit tool, row by row): crisp highlights and glints, texture hints (2-3 pixels), clean curves and 1:1/2:1 diagonals, manual anti-aliasing in inner corners, inner separation lines, remove anything that reads as noise. Add legend entries if you need colors.
   Render after each pass: python3 {PXL} render grid.json -o final.png --preview   — at most 4 passes.""",
}
PROMPTS["S4"] = PROMPTS["S3"]

CRITIC = """You are a strict pixel-art art director. Look at {img} (a {n}x{n} sprite shown at 8x on dark and light backgrounds) meant to be: {brief}.
Compare with the hand-made references in ./refs if helpful. Name the 3 WORST problems that keep it from looking hand-made and professional — e.g. wrong/implausible proportions (could a person use or wear it?), unreadable silhouette, muddy values, missing or misplaced highlights, noisy texture, bad curves/jaggies, outline issues.
For each: the pixel region (x0,y0,x1,y1 in sprite pixels, 0..{m}) and a concrete fix. Reply with only a numbered list."""

FIX = """An art director reviewed ./final.png ({brief}). Fix these problems by editing ./grid.json (or draw.py if a structural change is needed, then dump again), keeping everything else intact:
{critique}
Render after each change: python3 {pxl} render grid.json -o final.png --preview. At most 3 passes."""


def make_refs(cwd, subject):
    refs = os.path.join(cwd, "refs")
    os.makedirs(refs, exist_ok=True)
    for f in os.listdir(EXAMPLES):
        if subject.get("ref") and f.startswith(subject["ref"] + "."):
            continue  # hide the subject's own reference
        if f.endswith(".png") or f.endswith(".json"):
            shutil.copy(os.path.join(EXAMPLES, f), refs)


def run_one(strategy, s, out, model, effort):
    cwd = os.path.join(out, s["id"])
    if os.path.exists(os.path.join(cwd, "final.png")):
        return s["id"], "skip"
    shutil.rmtree(cwd, ignore_errors=True)
    os.makedirs(os.path.join(cwd, "steps"))
    make_refs(cwd, s)
    _, dt = claude(PROMPTS[strategy](s), cwd, model, effort)
    total = dt
    if strategy == "S4" and os.path.exists(os.path.join(cwd, "final.png")):
        for r in range(2):
            subprocess.run([sys.executable, PXL, "render", os.path.join(cwd, "final.png"), "-o", os.path.join(cwd, "crit.png"), "--preview"], capture_output=True)
            crit, dt = claude(CRITIC.format(img="crit_x8.png", n=s["size"], m=s["size"] - 1, brief=s["brief"]), cwd, model, effort, tools=False, timeout=600)
            open(os.path.join(cwd, "critique_%d.txt" % (r + 1)), "w").write(crit)
            total += dt
            if not os.path.exists(os.path.join(cwd, "grid.json")):
                subprocess.run([sys.executable, PXL, "dump", os.path.join(cwd, "final.png"), "--snap", "-o", os.path.join(cwd, "grid.json")], capture_output=True)
            _, dt = claude(FIX.format(brief=s["brief"], critique=crit, pxl=PXL), cwd, model, effort)
            total += dt
    ok = os.path.exists(os.path.join(cwd, "final.png"))
    json.dump({"strategy": strategy, "model": model, "effort": effort, "seconds": round(total), "ok": ok}, open(os.path.join(cwd, "meta.json"), "w"))
    return s["id"], ("ok %ds" % total) if ok else "NO final.png"


if __name__ == "__main__":
    a = sys.argv[1:]
    strategy = a[0]

    def opt(name, default):
        return a[a.index(name) + 1] if name in a else default

    model, effort, par = opt("--model", "sonnet"), opt("--effort", "medium"), int(opt("--par", "3"))
    only = opt("--only", "")
    tag = opt("--tag", strategy + "_" + model)
    subs = [s for s in SUBJECTS if not only or s["id"] in only.split(",")]
    out = os.path.join(HERE, "runs", tag)
    os.makedirs(out, exist_ok=True)
    with ThreadPoolExecutor(par) as ex:
        for sid, st in ex.map(lambda s: run_one(strategy, s, out, model, effort), subs):
            print(f"{tag} {sid}: {st}", flush=True)
