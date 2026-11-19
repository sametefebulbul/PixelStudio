---
name: pixel-art
description: Draw game-ready pixel art (icons 12–32 px, items/objects 32–64 px) as PNG without any image generator, by writing a short Python drawing script against the bundled `pxl` toolkit (masks → auto shading → outline → details), then checking it with text feedback (ASCII view + lint) or by looking at the 8× preview if you can read images. Use for inventory/UI icons, weapons, armor, potions, bags, trinkets, materials, small props, palette conversion of existing images. Works for text-only models too.
---

# pixel-art

You are the artist; `scripts/pxl.py` is your brush. You never place 2,304 pixels by hand: you describe **shapes as masks**, let `shade()` light them, `outline()` contour them, then add a few hand-placed details. Then you **check** and **fix**.

Paths below are relative to this skill folder (`~/.claude/skills/pixel-art/`). Run commands with `python3 scripts/pxl.py ...`.

## 0. Know your mode (decide once, at the start)
- **Visual mode** – you can open/read PNG images (Claude, deepseek-v4.1-flash, glm-5.3-flash…): after each render, look at `<name>_x8.png` (dark and light background side by side) **and** read the lint.
- **Blind mode** – you cannot read images (glm-5.3, deepseek-v4-pro…): rely on `pxl.py show` (ASCII with a coordinate ruler), `pxl.py silhouette`, `pxl.py show --lum` (luminance 0–9) and `pxl.py lint`. Never claim you "see" the image.

## 0b. Pick the route — best quality first
You are not a painter: something re-used or converted from good art beats something imagined from scratch. Take the first route that fits:
1. **Variant of existing art** (best: keeps hand-made shading exactly). A new potion color, a red robe, a blue-steel helm, a "crystal" sword:
   `python3 scripts/pxl.py variant <game_item.png> --hue SRC:DST[:RANGE[:SAT]] [--region x0,y0,x1,y1] -o out.png`
   (hue degrees: red 0, orange 30, yellow 55, green 120, cyan 185, blue 215, purple 280; SAT 0.3 = desaturate toward steel, 1.5 = richer). `--region` keeps e.g. the cork or belt untouched. In scripts: `recolor_hue(C, mask, src, dst, range, sat)`.
2. **Kitbash parts** of existing sprites: `A = load("sword.png"); part = crop(A, x0,y0,x1,y1, keep=mask)`; `stamp(C, part, x, y)`; then `recolor_hue`, `outline`. E.g. a new axe = existing axe head + another weapon's haft.
3. **Draw new** from a recipe (procedural masks + shading), then a **hand touch-up pass** on the grid (`dump --snap` → edit rows → `render`), comparing side by side with the closest game example (`sheet`).
4. **Convert a reference image** (the user's sketch, a photo, any generated picture): `convert ref.png --size 48 [--colors 16]`, then refine with a script. Never invent a complex organic subject (creature, character face) from scratch at 48 px — ask for a reference.

When drawing (route 3), make **2–3 candidates** with different proportions/tones, put them next to the closest example with `python3 scripts/pxl.py sheet cand1.png cand2.png references/examples/<x>.json -o pick.png`, and pick (visual mode) or ask a vision model to pick.

## 1. Brief → plan (write this down before drawing, 4–6 lines)
Read `references/technique.md` once (silhouette, values, highlights, texture by suggestion, clean-up) — especially **1b: it must work in the real world** (a helmet you can see out of, a grip a hand fits, a stopper that fits the neck).
1. Subject, canvas size (items: **32×32** or **48×48**; UI icons: **24×24**; tab/glyph icons: 12–16, single color).
2. Pose/orientation: long items diagonal **bottom-left → top-right** (blade/tip/head top-right); round items centered, front or ¾ view.
3. Parts list with materials → palette ramps (see `python3 scripts/pxl.py palette`): e.g. blade=steel, guard=brass, grip=leather.
4. Rough coordinates of each part (bbox / polygon points). The object must fill **~80–90 %** of the canvas with ≥1 px free border.
5. 2–3 signature details that make it read (rivets, stitching, cork, wax seal, wood grain, glint).
6. **Function check**: real proportions of each part and what must work (see through, hold, pour, wear). Fix the plan if any part would not work.

## 1c. Pick a method
- **hybrid** (default for 24–48 px): block in with a script (correct silhouette/proportions/base tones), `pxl.py dump final.png --snap -o grid.json`, then hand-paint `grid.json` row by row (highlights, texture hints, clean curves, inner lines), `render grid.json`.
- **grid**: write the rows yourself after planning the silhouette row by row; best for ≤32 px.
- **procedural**: script only; fastest, most generic.
- After the first version, do one critic pass: look at the 8× preview as a strict art director, list the 3 worst problems with pixel regions, fix only those.

## 2. Draw (script)
Start from the closest recipe in `references/recipes/` (sword, potion, shield_round, helm, pouch, scroll) — copy it, then change shapes/ramps. A script must leave the canvas in global `C`.

```python
from pxl import *
C = canvas(48, 48)                                  # palette "studio" by default (or canvas(48, 48, "endesga32"), a private one from ~/.pixel-studio/library/palettes)
blade = mask_poly([(14,31),(36,9),(40,7),(38,11),(16,33)])
shade(C, blade, "steel", style="cyl")               # long object -> cyl ; blob -> round ; flat plate -> bevel/flat
guard = mask_poly([(9,29),(12,26),(21,35),(18,38)]); shade(C, guard, "brass", style="cyl")
grip = mask_line(9,36,14,31, width=3); shade(C, grip, "leather", style="cyl")
texture(C, grip, "diag", ["leather.1"], step=2)      # wrap
shade(C, mask_circle(7,39,2), "brass", style="round")
outline(C)                                           # ALWAYS last structural step (details on top are fine)
center(C)
```
Render: `python3 scripts/pxl.py render work/sword.py -o work/sword.png --preview`

**Order of operations (back to front):** big masses → smaller parts on top → inner separation lines (`inner_line`, darkest tone of that material) → textures → `outline(C)` → highlights/glints (`px`, short `fill(mask_line(...))` with tone 4 or `white`) → `center(C)`.

### Toolkit cheat-sheet (all in `pxl`)
- Masks (sets of (x,y)): `mask_rect(x0,y0,x1,y1)`, `mask_circle(cx,cy,r)`, `mask_ellipse(cx,cy,rx,ry)`, `mask_poly([(x,y),...])`, `mask_line(x0,y0,x1,y1,width)`, `mask_curve([p0,p1,p2(,p3)], width)`; set algebra `a | b`, `a - b`, `a & b`; `grow(m,r)`, `shrink(m,r)`, `edge(m)`, `translate(m,dx,dy)`, `mirror_mask(m, axis_x=23.5)`; `region(C, color)` = mask of pixels with that color; `bbox(m)`.
- Paint: `fill(C,m,color)`, `px(C,x,y,color)`, `line(C,x0,y0,x1,y1,color,width)`, `flood(C,x,y,color)`, `erase(C,m)`.
- Light: `shade(C, m, ramp, light="nw", style="form|cyl|round|flat|bevel", levels=[1,2,3,4], dither=False, bias=0.0, highlight=True, rim=True)`.
  - `form` = real volume: a smooth height field lit in 3D at 4× and averaged down (blobs, bags, fruit, helmets, heads). `cyl` = long objects (blades, hafts, limbs): bands run along the length. `bevel` = flat plates/buckles. `round` = quick fallback.
  - `dither=True` keeps flat bands and dithers only a thin strip where two bands meet (pro look on ≥32 px; off for 24 px icons).
  - `levels` picks ramp indices (0 darkest…4 lightest). **Metal: mostly light tones** (`levels=[2,3,4]`) + a dark line on the shadow edge + white glint — not mid-grey. Cloth/leather/wood: `[1,2,3]` low contrast. `bias` ±0.2 for a part in shadow.
- Edges: `outline(C)` (full warm-black contour), `outline(C, selective=True)` (lit side uses the material's darkest tone – softer), `inner_line(C, m, "steel.0")`, `rim_light(C)` (lights the lit-side edge one tone; call before `outline`), `glint(C, mask, "white", pos=0.85, length=0.7)` (specular streak along a long object's lit edge).
- Silhouette: `smooth_mask(m)` removes 1 px nubs and fills 1 px holes/dents (use on every hand-made polygon before shading); `edge_check(m)` lists them.
- Tone edits: `darken(C, m, 1)`, `lighten(C, m, 1)` (move along the ramp), `ramp_shift(C, m, "steel", "brass")`, `recolor(C, m, {"red.2": "blue.2"})`.
- Texture: `texture(C, m, kind, [color(s)], step=2, seed=1)` kinds: `chain` (mail), `weave` (cloth), `grain`/`grain_h` (wood), `stripes_h/v`, `diag` (wraps, ropes), `dots`, `checker`, `bayer`, `noise`. Use the material's tone 1 (or 3 for light accents) – never outline black.
- Clean-up: `clean(C)` removes orphan pixels, `center(C)`, `mirror(C,"x")` (symmetric objects: draw the left half then mirror), `flip(C)`.
- Colors: `"steel.3"`, `"outline"`, `"white"`, `"black"`, `"#RRGGBB"` (avoid: stay in palette), `None` = transparent.

## 3. Check → fix (max 3 rounds)
1. `python3 scripts/pxl.py lint work/x.png [--sym x]` – fix every finding that is not an intentional choice (e.g. regular stitch dots may count as NOISE: that is fine).
2. Visual mode: look at `x_x8.png`. Blind mode: `show work/x.png` and `silhouette work/x.png`; ask yourself: *Is the silhouette recognisable as the subject with all color removed? Is the light side (top-left) brighter? Does each material have 3+ tones? Are parts separated by dark lines?*
3. Edit the script (not the PNG) and re-render. Stop when lint score ≥ 85 and the silhouette reads.
   Calibration: hand-made pro sprites score 75–85 (they contain intentional texture specks); lint is a helper that points at concrete pixels, not the judge. A clean, readable, on-style sprite beats a perfect score.

## 4. Style rules (default look – see `references/style.md` and `references/examples/`)
- One light: top-left (`nw`). Shadow side bottom-right, cast shadow inside recesses (`darken`).
- Contour: 1 px warm near-black around the whole object; never 2 px; inner lines use the material's darkest tone, not black.
- 3–5 tones per material, hue-shifted ramps from the palette; metals high contrast with a 1–3 px bright glint; wood/leather low contrast with texture; glass = rim + streak highlight + tinted content.
- No anti-aliasing gradients, no noise sprinkles, no single stray pixels, no "pillow shading" (bright middle, dark all around).
- **Proportions from references, not from memory:** open the closest example (`references/examples/`) and match its size on the canvas, part thickness (a 48 px sword blade is ~6 px wide, guard 3 px), and value (how light the main material is). Put yours next to it with `sheet` before you call it done.
- Every tone patch must have a reason (light side, shadow side, fold, seam, cast shadow, glint). Patches without a reason are noise.
- Big readable shapes first; details only where they identify the item. At 48 px: 2–4 details. At 24 px: 1–2 details, 3 tones, chunkier shapes. At 12–16 px (tab glyphs): flat single color silhouette, no outline.

## 5. Few-shot reference
`references/examples/` holds hand-made CC0 32 px sprites (weapons `wpn_*`, inventory items `inv_*`), each as PNG (look at it in visual mode) and as a grid JSON (`{"legend":{char:color}, "rows":[...]}`, read it in blind mode). Study 1–2 of the same category before drawing: proportions, outline, how few tones they use, where the highlights sit, how texture is suggested with 2–3 pixels. Private sets (e.g. a game's own art) live in `~/.pixel-studio/library/examples/`.

## 6. Other inputs / outputs
- Tiny icons can be written directly as a grid JSON (`{"palette":"studio","legend":{"o":"outline","a":"steel.3",...},"rows":[...]}`) and rendered the same way. Legacy UI grids use `"palette":"wf_ui"` (letters of the game's `render_icons.py`).
- `pxl.py dump some.png --snap` → grid JSON (study or edit an existing sprite).
- `pxl.py convert any.png --size 48 [--colors 16]` → downscale + snap to palette + clean + outline (turn a reference or a rough image into on-style pixel art, then refine with a script).
- Export: `C.save(path)` writes 1× PNG (transparent). For Godot projects put it under `assets/art/...` and run `godot --headless --path <project> --import`.

## 7. Deliverable
Report: output path(s), final lint score, the 2–3 design decisions, and (visual mode) what you checked in the preview. Keep the script next to the PNG (`<name>.py`) so it can be edited later.
