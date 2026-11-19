#!/usr/bin/env python3
"""Blind judge: compare strategies subject by subject with a vision model.

  python3 bench/judge.py S1_sonnet S2_sonnet S3_sonnet [--model opus] [--out bench/RESULTS.md]

For each subject: candidates are shuffled under neutral letters and shown at 8x on one sheet next to the
hand-made CC0 reference (when one exists). The judge scores every candidate 1-10 on a fixed rubric and ranks them.
Writes bench/results/<runs...>.json, a Markdown table and a contact sheet."""
import json
import os
import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EXAMPLES = os.path.join(ROOT, "engine", "references", "examples")
SUBJECTS = json.load(open(os.path.join(HERE, "subjects.json")))
CRIT = ["readability", "silhouette", "plausibility", "light", "material", "cleanliness", "appeal"]

PROMPT = """You are judging pixel-art sprites for a fantasy game. Read the image {sheet}.
It shows {n} candidate sprites labelled {labels}, each a {size}x{size} sprite drawn at 8x on a dark and a light background{refnote}.
Subject: {brief}.
Score EVERY candidate 1-10 (10 = indistinguishable from excellent hand-made pixel art) on:
- readability: instantly recognisable at 1x
- silhouette: clean, characterful shape, no lumps/nubs
- plausibility: real-world proportions and function (could a person use/wear/hold it? parts connected?)
- light: consistent top-left light, clear values
- material: does it read as its materials (metal, wood, glass, cloth...)
- cleanliness: no noise, clean lines/curves, sensible outline
- appeal: overall aesthetic quality
Be strict and consistent; use the full scale. Reply with ONLY JSON:
{{"scores": {{"A": {{"readability": n, ...}}, ...}}, "ranking": ["best label", ...], "notes": {{"A": "one short sentence", ...}}}}"""


def sheet(items, ref, path, size):
    S = 8
    cell = size * S
    cols = len(items) + (1 if ref else 0)
    im = Image.new("RGBA", (cols * (cell * 2 + 24) + 16, cell + 40), (30, 24, 20, 255))
    d = ImageDraw.Draw(im)
    x = 12
    for label, p in items + ([("R (hand-made reference)", ref)] if ref else []):
        spr = Image.open(p).convert("RGBA")
        if spr.size != (size, size):
            c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            c.alpha_composite(spr.crop((0, 0, min(size, spr.width), min(size, spr.height))))
            spr = c
        big = spr.resize((cell, cell), Image.NEAREST)
        dark = Image.new("RGBA", (cell, cell), (36, 27, 20, 255)); dark.alpha_composite(big)
        light = Image.new("RGBA", (cell, cell), (205, 195, 175, 255)); light.alpha_composite(big)
        im.alpha_composite(dark, (x, 30)); im.alpha_composite(light, (x + cell + 4, 30))
        d.text((x, 8), label, fill=(240, 230, 210, 255))
        x += cell * 2 + 24
    im.save(path)


def judge_subject(s, runs, model, outdir):
    cands = [(r, EXAMPLES + "/" + s["ref"] + ".png" if r == "reference" else os.path.join(HERE, "runs", r, s["id"], "final.png")) for r in runs if r != "reference" or s.get("ref")]
    cands = [(r, p) for r, p in cands if os.path.exists(p)]
    if not cands:
        return s["id"], None
    rnd = random.Random(hash(s["id"]) & 0xFFFF)
    rnd.shuffle(cands)
    labels = [chr(65 + i) for i in range(len(cands))]
    ref = os.path.join(EXAMPLES, s["ref"] + ".png") if s.get("ref") and "reference" not in runs else None
    sp = os.path.join(outdir, "sheet_%s.png" % s["id"])
    sheet(list(zip(labels, [p for _, p in cands])), ref, sp, s["size"])
    prompt = PROMPT.format(sheet=sp, n=len(cands), labels=", ".join(labels), size=s["size"], brief=s["brief"],
                           refnote=" — and on the right a hand-made reference R of the same subject for calibration (do not score R)" if ref else "")
    for attempt in range(2):
        p = subprocess.run(["claude", "-p", "--output-format", "json", "--model", model, "--tools", "Read", "--allowedTools", "Read",
                            "--add-dir", outdir, "--no-session-persistence", "--strict-mcp-config"], input=prompt, capture_output=True, text=True, timeout=600)
        try:
            txt = json.loads(p.stdout)["result"]
            j = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
            mapping = dict(zip(labels, [r for r, _ in cands]))
            return s["id"], {"scores": {mapping[k]: v for k, v in j["scores"].items() if k in mapping},
                             "ranking": [mapping[k] for k in j.get("ranking", []) if k in mapping],
                             "notes": {mapping[k]: v for k, v in j.get("notes", {}).items() if k in mapping}}
        except Exception as e:  # noqa: BLE001
            err = str(e)
    return s["id"], {"error": err}


if __name__ == "__main__":
    a = sys.argv[1:]
    model = a[a.index("--model") + 1] if "--model" in a else "opus"
    runs = [x for x in a if not x.startswith("--") and x != model]
    outdir = os.path.join(HERE, "results", "__".join(runs))
    os.makedirs(outdir, exist_ok=True)
    with ThreadPoolExecutor(3) as ex:
        res = dict(ex.map(lambda s: judge_subject(s, runs, model, outdir), SUBJECTS))
    json.dump(res, open(os.path.join(outdir, "judge.json"), "w"), indent=1)
    # aggregate
    agg = {r: {c: [] for c in CRIT + ["mean"]} for r in runs}
    wins = {r: 0 for r in runs}
    for sid, j in res.items():
        if not j or "scores" not in j:
            continue
        for r, sc in j["scores"].items():
            vals = [float(sc.get(c, 0)) for c in CRIT]
            for c, v in zip(CRIT, vals):
                agg[r][c].append(v)
            agg[r]["mean"].append(sum(vals) / len(vals))
        if j["ranking"]:
            wins[j["ranking"][0]] += 1
    mean = lambda xs: sum(xs) / len(xs) if xs else 0  # noqa: E731
    lines = ["| strategy | " + " | ".join(CRIT) + " | **mean** | wins |", "|---" * (len(CRIT) + 3) + "|"]
    for r in sorted(runs, key=lambda r: -mean(agg[r]["mean"])):
        lines.append("| %s | " % r + " | ".join("%.1f" % mean(agg[r][c]) for c in CRIT) + " | **%.2f** | %d |" % (mean(agg[r]["mean"]), wins[r]))
    per = ["", "| subject | " + " | ".join(runs) + " |", "|---" * (len(runs) + 1) + "|"]
    for sid, j in res.items():
        if j and "scores" in j:
            per.append("| %s | " % sid + " | ".join("%.1f" % mean([float(j["scores"].get(r, {}).get(c, 0)) for c in CRIT]) if r in j["scores"] else "–" for r in runs) + " |")
    report = "\n".join(lines + per)
    open(os.path.join(outdir, "RESULTS.md"), "w").write(report + "\n")
    print(report)
    # contact sheet of everything
    rows = [s for s in SUBJECTS if any(os.path.exists(os.path.join(HERE, "runs", r, s["id"], "final.png")) for r in runs)]
    S = 4
    cs = Image.new("RGBA", ((len(runs) + 1) * (32 * S + 10) + 90, len(rows) * (32 * S + 10) + 24), (30, 24, 20, 255))
    d = ImageDraw.Draw(cs)
    for i, r in enumerate(runs + ["reference"]):
        d.text((90 + i * (32 * S + 10), 4), r[:18], fill=(240, 230, 210, 255))
    for j, s in enumerate(rows):
        y = 20 + j * (32 * S + 10)
        d.text((4, y + 50), s["id"], fill=(240, 230, 210, 255))
        for i, r in enumerate(runs + ["reference"]):
            p = os.path.join(EXAMPLES, s["ref"] + ".png") if r == "reference" and s.get("ref") else os.path.join(HERE, "runs", r, s["id"], "final.png")
            if os.path.exists(p):
                spr = Image.open(p).convert("RGBA").crop((0, 0, 32, 32)).resize((32 * S, 32 * S), Image.NEAREST)
                bg = Image.new("RGBA", spr.size, (36, 27, 20, 255)); bg.alpha_composite(spr)
                cs.alpha_composite(bg, (90 + i * (32 * S + 10), y))
    cs.save(os.path.join(outdir, "contact.png"))
    print("contact sheet:", os.path.join(outdir, "contact.png"))
