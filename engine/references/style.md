# Default style sheet (fantasy RPG items)

Palette: `assets/palettes/studio.json` – 17 material ramps × 5 tones (0 darkest → 4 lightest) + warm near-black outline. Any palette with the same ramp names works with the recipes.

| Material | Ramp | Notes |
|---|---|---|
| Blades, plate, helms | `steel` | high contrast; bright edge line along the lit side (tone 4), dark core line on shadow side (tone 0–1) |
| Old/dark iron, rims, axes | `iron` | neutral grey |
| Belts, grips, pouches, boots | `leather` | low contrast, diagonal wrap stripes (tone 1), stitches (linen 3) |
| Hafts, staves, shields, crates | `wood` | vertical grain streaks (tone 1), plank seams (tone 0) |
| Cloth, paper, rope, cork | `linen` | soft folds; paper uses tones 2–4 |
| Fittings, coins, buckles, crowns | `brass` | warm, glint tone 4 |
| Potions, gems, cloth dye | `red`, `blue`, `green`, `purple` | liquids: surface line one tone lighter |
| Glass, ice, magic glow | `glass` | rim + 1–2 streak highlights, content visible through |
| Plants, moss, swamp | `green`, `moss` | |
| Teeth, bone, horn | `bone` | |
| Fur, hide | `fur` | strand clusters, not noise |
| Flame, embers | `fire` | |
| Rocks, ore | `stone` | |

## Composition
- 48×48 canvas, object uses ~40–46 px on its long axis, 1–2 px free border.
- Long items (swords, staves, spears, bows, axes): diagonal, grip bottom-left, business end top-right.
- Round/compact items (helms, shields, potions, bags): centered, slight ¾ view, sitting on an implied ground (flatter bottom, darker lower third).

## Light and form
- Light from top-left. Lit edge: tones 3–4. Core: 2. Shadow side: 1. Rim/occlusion: 0.
- Each material keeps its own ramp; parts in shadow of another part: `bias=-0.15` or `darken`.
- Glints: metals 1–3 px of tone 4 / `white` on the lit edge; glass a curved streak.

## Lines
- Outer contour: 1 px `outline` everywhere (corners may be open for rounder look – default).
- Inner separations (plate edges, straps, seams): darkest tone of the material, 1 px.
- Avoid: double outlines, outline-black textures, isolated single pixels, dithering on small sprites.

## Size tiers
- 48 px item: 3–5 tones/material, 2–4 signature details.
- 24 px UI icon: 3 tones, 1–2 details, chunkier shapes, outline kept.
- 12–16 px glyph (tab filters): one flat color (white/cream), no outline, the game tints it.
