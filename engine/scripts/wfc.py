#!/usr/bin/env python3
"""Wave Function Collapse (simple tiled model), written from scratch for Pixel Studio. No dependencies.

Learn adjacency rules and tile frequencies from an example tile map (a 2D list of tile ids), then generate
a new map of any size, deterministically from a seed. Use it for terrain / ground layouts of maps and scenes:
the tiles themselves (autotile sprites) are drawn separately.

  python3 wfc.py selftest
  python3 wfc.py gen --sample sample.json --w 24 --h 24 --seed 7 [-o out.json]

sample.json: {"tiles": [["g","g","p"], ["g","p","p"], ...]}  (rows of tile ids)
Output: {"seed": n, "tiles": [[...], ...]}.
"""
import json
import random
import sys

DIRS = [(0, -1), (1, 0), (0, 1), (-1, 0)]  # N E S W


def learn(sample):
    """Return (tile ids, weights, rules) where rules[d][a] = set of tiles allowed next to a in direction d."""
    ids = sorted({t for row in sample for t in row})
    weights = {t: 0 for t in ids}
    rules = [{t: set() for t in ids} for _ in DIRS]
    h, w = len(sample), len(sample[0])
    for y in range(h):
        for x in range(w):
            a = sample[y][x]
            weights[a] += 1
            for d, (dx, dy) in enumerate(DIRS):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    rules[d][a].add(sample[ny][nx])
    return ids, weights, rules


def generate(sample, width, height, seed, max_restarts=50):
    ids, weights, rules = learn(sample)
    rng = random.Random(seed)
    for _ in range(max_restarts):
        grid = [[set(ids) for _ in range(width)] for _ in range(height)]
        if _run(grid, ids, weights, rules, rng, width, height):
            return [[next(iter(c)) for c in row] for row in grid]
    raise RuntimeError("WFC: no consistent map after %d restarts" % max_restarts)


def _run(grid, ids, weights, rules, rng, width, height):
    while True:
        best, best_h = None, 1e9
        for y in range(height):
            for x in range(width):
                n = len(grid[y][x])
                if n == 0:
                    return False
                if n > 1:
                    # entropy proxy: fewer options first, tiny seeded jitter breaks ties
                    h = n + rng.random() * 0.1
                    if h < best_h:
                        best, best_h = (x, y), h
        if best is None:
            return True
        x, y = best
        opts = sorted(grid[y][x])
        pick = rng.choices(opts, weights=[weights[t] for t in opts])[0]
        grid[y][x] = {pick}
        if not _propagate(grid, rules, width, height, [(x, y)]):
            return False


def _propagate(grid, rules, width, height, stack):
    while stack:
        x, y = stack.pop()
        here = grid[y][x]
        for d, (dx, dy) in enumerate(DIRS):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < width and 0 <= ny < height):
                continue
            allowed = set()
            for t in here:
                allowed |= rules[d][t]
            cell = grid[ny][nx]
            new = cell & allowed
            if len(new) < len(cell):
                if not new:
                    return False
                grid[ny][nx] = new
                stack.append((nx, ny))
    return True


def valid(tiles, rules):
    h, w = len(tiles), len(tiles[0])
    for y in range(h):
        for x in range(w):
            for d, (dx, dy) in enumerate(DIRS):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and tiles[ny][nx] not in rules[d][tiles[y][x]]:
                    return False
    return True


def selftest():
    # a tiny landscape sample: water -> sand -> grass -> forest bands with a path
    sample = [list(r) for r in [
        "wwwsgg",
        "wwsggg",
        "wssgpg",
        "ssgggp",
        "sgggfp",
        "ggfffg",
        "gfffgg",
    ]]
    _, _, rules = learn(sample)
    ok = 0
    for seed in range(1, 13):
        a = generate(sample, 24, 24, seed)
        assert valid(a, rules), "invalid adjacency for seed %d" % seed
        assert a == generate(sample, 24, 24, seed), "not deterministic for seed %d" % seed
        ok += 1
    print("wfc selftest ok: %d seeds, 24x24, valid and deterministic" % ok)


def main(argv):
    if len(argv) < 2 or argv[1] == "selftest":
        return selftest()
    if argv[1] == "gen":
        a = {argv[i]: argv[i + 1] for i in range(2, len(argv) - 1, 2)}
        sample = json.load(open(a["--sample"]))["tiles"]
        seed = int(a.get("--seed", 1))
        out = {"seed": seed, "tiles": generate(sample, int(a.get("--w", 24)), int(a.get("--h", 24)), seed)}
        text = json.dumps(out)
        if "-o" in a:
            open(a["-o"], "w").write(text)
        else:
            print(text)
        return
    print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
