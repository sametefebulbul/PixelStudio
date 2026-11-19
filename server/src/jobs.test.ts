import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson, normalizeSpec } from "./jobs.js";
import { DEFAULT_SETTINGS } from "./types.js";

test("extractJson handles fences and prose", () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a": 1}\n```\nbye'), { a: 1 });
  assert.deepEqual(extractJson('sure {"b": [1,2]} done'), { b: [1, 2] });
  assert.throws(() => extractJson("no json here"));
});

test("normalizeSpec fills defaults and clamps", () => {
  const s = normalizeSpec({ title: "x", prompt: "draw x", size: 999, route: "weird" }, { ...DEFAULT_SETTINGS, route: "auto" });
  assert.equal(s.size, 128);
  assert.equal(s.route, "draw");
  assert.equal(s.style.light, "nw");
  assert.deepEqual(s.parts, []);
});

test("normalizeSpec rejects an empty prompt", () => {
  assert.throws(() => normalizeSpec({ title: "x" }, DEFAULT_SETTINGS));
});
