import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE } from "./config.js";
import { LIBRARY } from "./engine.js";
import type { Spec } from "./types.js";

/** Synonym groups: a subject word and an example name word match when they share a group. */
const GROUPS: string[][] = [
  ["sword", "blade", "saber", "rapier", "katana", "claymore", "sword1", "sword3"],
  ["dagger", "knife", "dirk"],
  ["axe", "hatchet", "cleaver"],
  ["hammer", "maul", "warhammer"],
  ["mace", "flail", "club", "morningstar"],
  ["bow", "longbow", "shortbow"],
  ["crossbow", "arbalest"],
  ["key", "lockpick"],
  ["scroll", "parchment", "letter", "map", "book"],
  ["torch", "lantern", "candle"],
  ["urn", "vase", "pot", "jar", "amphora"],
  ["mug", "cup", "tankard", "goblet", "stein"],
  ["sack", "bag", "pouch", "purse", "satchel"],
  ["ingot", "bar"],
  ["chain", "link", "chainmail"],
  ["cloth", "fabric", "robe", "cape", "cloak"],
  ["leather", "hide", "pelt"],
  ["shovel", "spade", "shovel", "pickaxe", "tool"],
  ["mushroom", "toadstool", "fungus"],
  ["herb", "plant", "leaf", "flower"],
  ["egg"],
  ["log", "wood", "plank", "branch"],
  ["inkpot", "ink", "inkwell", "bottle", "potion", "flask", "vial"],
];

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
const norm = (w: string) => w.replace(/\d+$/, "").replace(/(es|s)$/, "");
const groupOf = (w: string) => GROUPS.findIndex((g) => g.some((x) => norm(x) === norm(w)));

interface Ex {
  name: string;
  file: string;
}

function allExamples(): Ex[] {
  const out: Ex[] = [];
  for (const dir of [join(ENGINE, "references", "examples"), join(LIBRARY, "examples")]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("LICENSE")))
      out.push({ name: f.replace(/\.json$/, ""), file: join(dir, f) });
  }
  return out;
}

/** The hand-made sprites (CC0 + the user's private library) closest to the subject, ranked by shared words / synonym groups. */
export function pickExemplars(spec: Spec, max = 2): Ex[] {
  const want = new Set(words(`${spec.title} ${spec.subject}`).map(norm));
  const wantGroups = new Set([...want, ...spec.parts.map((p) => norm(p.name))].map(groupOf).filter((g) => g >= 0));
  const scored = allExamples()
    .map((e) => {
      const ws = words(e.name.replace(/^(inv|wpn)_/, "")).map(norm);
      let sc = 0;
      for (const w of ws) {
        if (want.has(w)) sc += 3;
        else if (wantGroups.has(groupOf(w))) sc += 2;
      }
      return { e, sc };
    })
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc);
  const picked = scored.slice(0, max).map((x) => x.e);
  if (!picked.length) {
    // nothing related: one well-made metal object still teaches outline, ramps and highlights
    const fb = allExamples().find((e) => e.name === "inv_iron_ingot");
    if (fb) picked.push(fb);
  }
  return picked;
}

/** Prompt section with the chosen references as palette grids (text-only models can read them). */
export function exemplarText(spec: Spec): string {
  const blocks: string[] = [];
  for (const e of pickExemplars(spec)) {
    try {
      const j = JSON.parse(readFileSync(e.file, "utf-8"));
      const rows: string[] = j.rows ?? [];
      blocks.push(`### ${e.name} (${rows[0]?.length ?? "?"}x${rows.length}, palette ${j.palette ?? "?"})\nlegend: ${JSON.stringify(j.legend)}\n${rows.join("\n")}`);
    } catch {
      /* unreadable example: skip */
    }
  }
  if (!blocks.length) return "";
  return `## Hand-made reference sprites (grids; '.' = transparent)
Study how a human pixel artist places the outline, how many tones each material gets, where the highlight sits, how thick the parts are relative to the canvas and how little noise there is. Match this level of cleanliness and readability; do NOT copy the shapes (your subject is different).

${blocks.join("\n\n")}`;
}
