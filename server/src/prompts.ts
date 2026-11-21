import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PXL, PYTHON, SKILL_MD, ENGINE } from "./config.js";
import type { PaletteInfo } from "./engine.js";
import type { Comment, Settings, Spec } from "./types.js";

export const SPEC_SCHEMA_HINT = `{
  "title": "short name",
  "subject": "one sentence: what it is",
  "size": 48,
  "route": "draw | variant | kitbash | convert",
  "composition": "orientation, how much of the canvas it fills, view angle",
  "parts": [{"name": "blade", "material": "steel", "ramp": "steel", "shape": "long tapered blade ~6px wide", "where": "diagonal from (14,30) to (44,3)"}],
  "details": ["2-4 signature details that make it read"],
  "avoid": ["things to avoid"],
  "palette": "palette name",
  "style": {"light": "nw", "outline": "full|selective|none", "shading": "form|cyl|bevel|flat|auto", "dither": false, "tones": 4, "detail": "low|medium|high"},
  "variantOps": [{"src": 0, "dst": 215, "range": 30, "sat": 1.0, "region": null}],
  "prompt": "the complete drawing brief for the pixel artist (English, 6-14 lines): subject, size, composition with rough coordinates, each part with material/ramp/shading style, details, light, outline, avoid list"
}`;

export function refinePrompt(brief: string, s: Settings, pal: PaletteInfo | undefined, baseItem?: string): string {
  const ramps = pal ? Object.keys(pal.ramps).join(", ") : "";
  return `You turn a user's pixel-art request into a precise drawing spec for an LLM pixel artist that draws with code (masks -> auto shading -> outline -> details) using the "pxl" toolkit.

User request (any language):
"""${brief}"""

Settings chosen in the UI (respect them; the request text may override only when it is explicit):
- canvas ${s.size}x${s.size}, palette "${s.palette}" (ramps: ${ramps}), light from ${s.light}, outline ${s.outline}, shading ${s.shading}, dither at band edges ${s.dither ? "on" : "off"}, ${s.tones} tones per material, detail ${s.detail}
- route: ${s.route}${baseItem ? `, base sprite: ${baseItem}` : ""}
- avoid: ${s.negative || "(none)"}

Rules:
- Route "auto": choose "variant" ONLY if a base sprite is given and the request is a recolor of it; "convert" only if a reference image is given; otherwise "draw".
- For "variant", fill "variantOps" (hue degrees: red 0, orange 30, yellow 55, green 120, cyan 185, blue 215, purple 280; range = hue tolerance; sat multiplies saturation, 0.3 = greyer/steel, 1.5 = richer; region [x0,y0,x1,y1] or null). For other routes omit it.
- Use only ramp names from the palette for "ramp". Coordinates must fit the canvas; the object fills ~80-90% of it with >=1px free border; long items diagonal bottom-left -> top-right.
- "prompt" is the full brief the artist will read; write it in English, concrete and measurable (sizes in px, coordinates, which ramp tones).
- Plausibility: the object must be usable in the real world. In "composition" and each part's "shape", state real proportions and function (e.g. helmet: dome only slightly taller than a skull, ~40% of the helmet height; face opening at eye height and wide enough to see through; grip about a hand wide; blade ~70% of the sword; stopper fits the neck; parts physically connected). Add a line "Function check:" to the prompt listing what must work (see, hold, pour, wear...).
- Keep the user's intent; do not add unrequested subjects, text or effects.

Return ONLY one JSON object, no prose, matching:
${SPEC_SCHEMA_HINT}`;
}

const skillText = () => readFileSync(SKILL_MD, "utf-8");

const RECIPES: [RegExp, string][] = [
  [/helm|helmet|hood|cap|hat|crown/i, "helm"],
  [/sword|blade|dagger|knife|axe|spear|mace|hammer|staff|wand/i, "sword"],
  [/potion|flask|bottle|vial|jar|urn|mug|cup/i, "potion"],
  [/pouch|bag|sack|purse/i, "pouch"],
  [/scroll|book|letter|map|paper/i, "scroll"],
  [/shield|buckler/i, "shield_round"],
];

/** Technique notes + the recipes closest to the subject (so the agent does not have to go and read them: reading cost ~45% of all turns). */
export function knowledgeText(spec: Spec): string {
  const hay = `${spec.title} ${spec.subject}`;
  const names = RECIPES.filter(([re]) => re.test(hay)).map(([, n]) => n);
  const pick = (names.length ? names : ["sword"]).slice(0, 2);
  const parts: string[] = [];
  const tech = join(ENGINE, "references", "technique.md");
  if (existsSync(tech)) parts.push("## Technique notes\n" + readFileSync(tech, "utf-8"));
  for (const n of pick) {
    const f = join(ENGINE, "references", "recipes", n + ".py");
    if (existsSync(f)) parts.push(`## Recipe: ${n}.py (a complete working draw script; copy its structure)\n\`\`\`python\n${readFileSync(f, "utf-8")}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/** Instructions for the drawing agent. `inline` = embed SKILL.md (API providers have no file access to it). */
export function drawPrompt(spec: Spec, s: Settings, opts: { k: number; seed: number; vision: boolean; inline: boolean; startFrom?: string }): string {
  const variety =
    opts.k === 0
      ? "Follow the brief closely."
      : `This is candidate #${opts.k + 1} of several: keep the brief, but choose a noticeably different take (proportions, part shapes, tone placement or detail choice). Use seed ${opts.seed} for any textures.`;
  return `You are a pixel artist working with the pxl toolkit. ${opts.inline ? "The skill guide is below." : `First read the skill guide: ${SKILL_MD} and the technique notes ${ENGINE}/references/technique.md (recipes in ${ENGINE}/references/recipes, CC0 example sprites (PNG + grid JSON) in ${ENGINE}/references/examples).`}

${opts.inline ? "Everything you need (skill guide, technique notes, a matching recipe) is included below. Do NOT read other files, do NOT open pxl.py or the examples folder, do NOT explore the engine: start drawing immediately. Every extra tool call costs minutes.\n" : ""}Work ONLY inside the current directory (its absolute path is given at the end of this brief); use relative file names for everything you create (draw.py, grid.json, final.png) and never create files elsewhere, never in the engine folder or its parents.
${methodBlock(s.method ?? "hybrid", spec.size)}
- Every render is captured automatically as a numbered step the user watches live, so render after each meaningful stage — at least 3 renders.
- Check: ${PYTHON} ${PXL} lint final.png${opts.vision ? "  and LOOK at final_x8.png after each render." : `  and ${PYTHON} ${PXL} show final.png (you cannot see images: use the ASCII view, silhouette and lint).`}
- At most ${s.maxRounds} fix rounds after the first complete version. Finish with final.png present, then reply with 2-4 lines: what you drew, final lint score, key decisions.
${opts.startFrom ? `- Start from the existing ./draw.py (a previous version) and modify it; do not rewrite from scratch unless asked.` : ""}

${variety}

## Brief
${spec.prompt}

Canvas ${spec.size}x${spec.size}, palette "${spec.palette}". Light ${spec.style.light}; outline ${spec.style.outline}; shading ${spec.style.shading}; band-edge dither ${spec.style.dither ? "on" : "off"}; ${spec.style.tones} tones per material; detail ${spec.style.detail}.
Avoid: ${[...spec.avoid, s.negative].filter(Boolean).join("; ") || "(nothing special)"}
${opts.inline ? "\n## Skill guide\n" + skillText() + "\n\n" + knowledgeText(spec) : ""}`;
}

/** How the artist works. "hybrid" = procedural block-in then hand-painting the dumped grid. */
export function methodBlock(method: string, size: number): string {
  const renderPy = `${PYTHON} ${PXL} render draw.py -o final.png --preview --show`;
  const renderGrid = `${PYTHON} ${PXL} render grid.json -o final.png --preview --show`;
  if (method === "procedural")
    return `Method: PROCEDURAL. Write ./draw.py (\`from pxl import *\`, masks -> shade -> outline -> details, canvas left in global C) and render with: ${renderPy}`;
  if (method === "grid")
    return `Method: DIRECT GRID. Write ./grid.json yourself: {"palette": "<palette>", "legend": {"o": "outline", "a": "steel.1", "b": "#FFFBEF", ...}, "rows": [${size} strings of ${size} chars]} ('.' = transparent; legend values are "ramp.i" (0 darkest..4 lightest), "outline", or #hex).
Plan the silhouette row by row first, then flat colors, shadow/light, highlights, texture hints, outline. Render with: ${renderGrid}. Improve by editing individual rows (one row per line in the file).`;
  return `Method: HYBRID.
1) Block in with ./draw.py (\`from pxl import *\`, masks -> shade -> outline): correct silhouette, real-world proportions and base tones. Render: ${renderPy}
2) Make it editable: ${PYTHON} ${PXL} dump final.png --snap -o grid.json   (each row is one line)
3) Hand-paint grid.json like a pixel artist, row by row: crisp highlights and glints, texture hints (2-3 px), clean curves and 1:1/2:1 diagonals, manual anti-aliasing in inner corners, inner separation lines, remove noise. Add legend entries if needed. Make as few, larger passes as possible (rewrite whole blocks of rows per edit, 2 passes max). Render after each pass: ${renderGrid}   (the output already contains the lint report and the ASCII view: do not call lint/show again).`;
}

/** Art-director round: look at the sprite and write the 3 worst problems (no edits). */
export function criticPrompt(spec: Spec, vision: boolean): string {
  const m = spec.size - 1;
  return `You are a strict pixel-art art director. ${vision ? "Look at ./crit_x8.png (the sprite at 8x on dark and light backgrounds)." : `Read the sprite with: ${PYTHON} ${PXL} show final.png --lum  and  ${PYTHON} ${PXL} silhouette final.png`}
It should be: ${spec.subject || spec.title}. Brief: ${spec.prompt.slice(0, 600)}
Name the 3 WORST problems that keep it from looking hand-made and professional: implausible proportions or function (could a person use/wear/hold it?), unreadable silhouette, muddy values, missing/misplaced highlights, noisy texture, jaggies, outline issues.
For each give the pixel region (x0,y0,x1,y1 within 0..${m}) and a concrete fix. Write them as a numbered list to ./critique.txt and do NOT edit any other file.`;
}

export function criticFixPrompt(critique: string): string {
  return `An art director reviewed ./final.png. Fix these problems (edit ./grid.json if it exists, otherwise ./draw.py; for structural changes edit draw.py, render, and dump again), keep everything else intact:
${critique}
Render after each change: ${PYTHON} ${PXL} render grid.json -o final.png --preview  (or draw.py if there is no grid.json). At most 2 passes. Reply with one line per problem: what you changed.`;
}

export function pickPrompt(n: number, spec: Spec): string {
  return `Look at ./pick_sheet.png: ${n} candidate sprites numbered 1..${n} for "${spec.subject || spec.title}". Choose the best one as a pixel-art director would (readability, real-world plausibility, light, materials, cleanliness, appeal).
Write ONLY this JSON to ./pick.json: {"best": <number 1..${n}>, "reason": "<one sentence>"} and edit nothing else.`;
}

/** Region-feedback round: comments carry pixel boxes; the agent must change only those areas. */
export function fixPrompt(comments: Comment[], s: Settings, opts: { vision: boolean; asciiCrops: string[]; cropFiles: string[]; inline: boolean }): string {
  const items = comments
    .map((c, i) => {
      const [x0, y0, x1, y1] = c.region;
      return `${i + 1}. Region x ${x0}-${x1}, y ${y0}-${y1} (inclusive sprite pixels): "${c.text}"${opts.vision && opts.cropFiles[i] ? `\n   Zoomed crop: ${opts.cropFiles[i]}` : ""}${!opts.vision && opts.asciiCrops[i] ? `\n   ASCII of that region:\n${opts.asciiCrops[i]}` : ""}`;
    })
    .join("\n");
  return `You are a pixel artist revising your own sprite with the pxl toolkit. ${opts.inline ? "" : `Skill guide: ${SKILL_MD}.`}
The current directory holds draw.py (the script that produced the current sprite) and current.png (what the user saw).

The user left feedback pinned to regions of the sprite:
${items}

Rules:
- Change ONLY what the feedback asks, inside (or immediately around) those regions. Everything else must stay pixel-identical — the app measures changes outside the regions and reports them to the user.
- Edit ./draw.py (prefer small targeted edits: change a shape, a ramp, add px() touch-ups) and render with: ${PYTHON} ${PXL} render draw.py -o final.png --preview
- Render after each change (each render is shown live). Check with lint${opts.vision ? " and by looking at final_x8.png" : " and the ASCII view (show)"}. At most ${Math.max(1, s.maxRounds)} rounds.
- Finish with final.png present and reply with one line per feedback item: what you changed.`;
}
