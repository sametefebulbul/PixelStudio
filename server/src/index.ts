import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { appendFileSync } from "node:fs";
import { DATA, HOST, PORT, PROJECTS, WEB_DIST } from "./config.js";
import { checkPython, listLibrary, listPalettes, pxl } from "./engine.js";
import { history, subscribe } from "./events.js";
import { cancel, fileUrl, refine, startConvert, startFix, startRun } from "./jobs.js";
import { saveApiSettings, apiSettings } from "./providers/api.js";
import { PROVIDERS } from "./providers/index.js";
import { queueState } from "./queue.js";
import { addComment, createProject, getProject, getRun, listProjects, newId, projectDir, safeJoin, updateProject, updateRun, variantDir } from "./store.js";
import type { AgentEvent, Settings, Spec } from "./types.js";

const app = new Hono();
const MIME: Record<string, string> = { ".png": "image/png", ".json": "application/json", ".py": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };

const fail = (c: any, e: unknown, code = 400) => c.json({ error: String(e instanceof Error ? e.message : e) }, code);

// ---------------------------------------------------------------- meta
app.get("/api/status", async (c) => {
  const [py, ...provs] = await Promise.all([checkPython(), ...Object.values(PROVIDERS).map((p) => p.status())]);
  return c.json({ python: py, providers: provs, queue: queueState() });
});
app.get("/api/palettes", (c) => c.json(listPalettes()));
app.get("/api/library", (c) => c.json(listLibrary()));
app.get("/api/library/image", async (c) => {
  const path = c.req.query("path") ?? "";
  if (!listLibrary().some((l) => l.path === path)) return c.text("not in library", 404);
  if (path.endsWith(".png")) return new Response(readFileSync(path), { headers: { "content-type": "image/png" } });
  // grid json -> render to png on the fly (cached next to the project data)
  const out = join(PROJECTS, "..", "cache", path.replace(/[^a-z0-9]+/gi, "_") + ".png");
  mkdirSync(join(PROJECTS, "..", "cache"), { recursive: true });
  if (!existsSync(out)) await pxl(["render", path, "-o", out]);
  return new Response(readFileSync(out), { headers: { "content-type": "image/png" } });
});
app.get("/api/settings", (c) => {
  const s = apiSettings();
  return c.json({ anthropicKey: s.anthropicKey ? "set" : "", openaiKey: s.openaiKey ? "set" : "", openaiBaseUrl: s.openaiBaseUrl, openaiModels: s.openaiModels ?? "" });
});
app.post("/api/settings", async (c) => {
  const b = await c.req.json();
  const patch: Record<string, string> = {};
  for (const k of ["anthropicKey", "openaiKey", "openaiBaseUrl", "openaiModels"]) if (typeof b[k] === "string" && b[k] !== "set") patch[k] = b[k];
  saveApiSettings(patch);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- projects
app.get("/api/projects", (c) => c.json(listProjects().map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt, runs: p.runs.length }))));
app.post("/api/projects", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  return c.json(createProject(b.title ?? "", b.settings));
});
app.get("/api/projects/:pid", (c) => {
  try {
    const p = getProject(c.req.param("pid"));
    const runs = p.runs.map((rid) => {
      try {
        return getRun(p.id, rid);
      } catch {
        return null;
      }
    });
    return c.json({ project: p, runs: runs.filter(Boolean) });
  } catch (e) {
    return fail(c, e, 404);
  }
});
app.patch("/api/projects/:pid", async (c) => {
  const b = await c.req.json();
  const p = updateProject(c.req.param("pid"), (p) => {
    if (typeof b.title === "string") p.title = b.title;
    if (typeof b.brief === "string") p.brief = b.brief;
    if (b.settings) p.settings = { ...p.settings, ...b.settings };
    if (b.spec) p.spec = b.spec;
  });
  return c.json(p);
});

app.post("/api/projects/:pid/refine", async (c) => {
  const pid = c.req.param("pid");
  const b = await c.req.json();
  try {
    const spec = await refine(pid, String(b.brief ?? ""), b.settings as Settings, b.refineProvider, b.refineModel);
    return c.json(spec);
  } catch (e) {
    return fail(c, e, 500);
  }
});

app.post("/api/projects/:pid/upload", async (c) => {
  const pid = c.req.param("pid");
  const body = await c.req.parseBody();
  const f = body.file;
  if (!(f instanceof File)) return fail(c, "no file");
  const ext = extname(f.name).toLowerCase() || ".png";
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return fail(c, "image files only");
  const path = join(projectDir(pid), "uploads", newId("u") + ext);
  writeFileSync(path, Buffer.from(await f.arrayBuffer()));
  return c.json({ path, url: fileUrl(path) });
});

// ---------------------------------------------------------------- runs
app.post("/api/projects/:pid/runs", async (c) => {
  const b = await c.req.json();
  try {
    return c.json(startRun(c.req.param("pid"), { spec: b.spec as Spec, settings: b.settings as Settings }));
  } catch (e) {
    return fail(c, e);
  }
});
app.get("/api/projects/:pid/runs/:rid", (c) => c.json(getRun(c.req.param("pid"), c.req.param("rid"))));
app.post("/api/projects/:pid/runs/:rid/cancel", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  cancel(c.req.param("pid"), c.req.param("rid"), b.k);
  return c.json({ ok: true });
});
app.post("/api/projects/:pid/runs/:rid/variants/:k/star", (c) => {
  const k = Number(c.req.param("k"));
  const r = updateRun(c.req.param("pid"), c.req.param("rid"), (r) => (r.variants[k].starred = !r.variants[k].starred));
  return c.json(r.variants[k]);
});
/** The user's own rating (1-5 + note). Also appended to ~/.pixel-studio/ratings.jsonl so methods/models/settings can be compared by what the user actually prefers. */
app.post("/api/projects/:pid/runs/:rid/variants/:k/rate", async (c) => {
  const b = await c.req.json();
  const k = Number(c.req.param("k"));
  const rating = Math.max(1, Math.min(5, Math.round(Number(b.rating))));
  const r = updateRun(c.req.param("pid"), c.req.param("rid"), (r) => {
    r.variants[k].rating = rating;
    r.variants[k].note = typeof b.note === "string" ? b.note.slice(0, 500) : undefined;
  });
  try {
    appendFileSync(join(DATA, "ratings.jsonl"), JSON.stringify({ at: Date.now(), project: r.projectId, run: r.id, k, rating, note: r.variants[k].note, title: r.spec.title, size: r.spec.size, kind: r.kind, method: r.settings.method, model: r.settings.model, provider: r.settings.provider, critic: r.settings.critic, steps: r.variants[k].steps, lint: r.variants[k].score }) + "\n");
  } catch {
    /* ignore */
  }
  return c.json(r.variants[k]);
});
app.get("/api/projects/:pid/runs/:rid/variants/:k/script", (c) => {
  const f = join(variantDir(c.req.param("pid"), c.req.param("rid"), Number(c.req.param("k"))), "draw.py");
  return existsSync(f) ? c.text(readFileSync(f, "utf-8")) : c.text("", 404);
});
app.get("/api/projects/:pid/runs/:rid/events", (c) => {
  const pid = c.req.param("pid");
  const rid = c.req.param("rid");
  return streamSSE(c, async (stream) => {
    for (const e of history(pid, rid)) await stream.writeSSE({ data: JSON.stringify(e) });
    await stream.writeSSE({ event: "replayed", data: "{}" });
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    const off = subscribe(pid, rid, (e) => {
      queue.push(e);
      wake?.();
    });
    stream.onAbort(() => off());
    while (!stream.aborted) {
      if (!queue.length) await new Promise<void>((r) => ((wake = r), setTimeout(r, 15000)));
      wake = null;
      if (!queue.length) {
        await stream.writeSSE({ event: "ping", data: "{}" });
        continue;
      }
      while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
    }
    off();
  });
});

// ---------------------------------------------------------------- comments + fix
app.post("/api/projects/:pid/comments", async (c) => {
  const b = await c.req.json();
  const region = (b.region as number[]).map((v) => Math.round(v)) as [number, number, number, number];
  return c.json(addComment(c.req.param("pid"), { runId: b.runId, k: Number(b.k), region, text: String(b.text ?? "") }));
});
app.patch("/api/projects/:pid/comments/:cid", async (c) => {
  const b = await c.req.json();
  const p = updateProject(c.req.param("pid"), (p) => {
    const cm = p.comments.find((x) => x.id === c.req.param("cid"));
    if (!cm) return;
    if (typeof b.text === "string") cm.text = b.text;
    if (b.status) cm.status = b.status;
  });
  return c.json(p.comments);
});
app.delete("/api/projects/:pid/comments/:cid", (c) => {
  const p = updateProject(c.req.param("pid"), (p) => (p.comments = p.comments.filter((x) => x.id !== c.req.param("cid"))));
  return c.json(p.comments);
});
app.post("/api/projects/:pid/fix", async (c) => {
  const b = await c.req.json();
  try {
    return c.json(startFix(c.req.param("pid"), { run: b.run, k: Number(b.k) }, b.commentIds ?? [], b.settings));
  } catch (e) {
    return fail(c, e);
  }
});
/** Reference image -> pixel art without a model (instant). */
app.post("/api/projects/:pid/convert", async (c) => {
  const b = await c.req.json();
  try {
    return c.json(startConvert(c.req.param("pid"), b.settings as Settings, Array.isArray(b.pieces) ? b.pieces : undefined));
  } catch (e) {
    return fail(c, e);
  }
});
/** Sprite/character sheet -> separate pieces (found automatically). */
app.post("/api/projects/:pid/split", async (c) => {
  const pid = c.req.param("pid");
  const b = await c.req.json();
  const src = String(b.path ?? "");
  if (!src.startsWith(PROJECTS) || !existsSync(src)) return fail(c, "image not found");
  const dir = join(projectDir(pid), "uploads", newId("split"));
  mkdirSync(dir, { recursive: true });
  const r = await pxl(["split", src, "-o", dir, "--gap", String(Number(b.gap ?? 1))], { timeoutMs: 120_000 });
  if (r.code !== 0) return fail(c, r.stderr.slice(0, 300), 500);
  const pieces = (JSON.parse(r.stdout) as { file: string; w: number; h: number; area: number }[]).map((p) => ({ ...p, path: join(dir, p.file), url: fileUrl(join(dir, p.file)) }));
  return c.json({ pieces });
});

/** Character pack: converted views (south/north/east/west) -> aligned set, strip sheet and anchors JSON. */
app.post("/api/projects/:pid/character", async (c) => {
  const pid = c.req.param("pid");
  const b = await c.req.json();
  const roles = (b.roles ?? {}) as Record<string, string>;
  const args: string[] = [];
  for (const [k, role] of Object.entries(roles)) {
    if (!["south", "north", "east", "west"].includes(role)) continue;
    const f = join(variantDir(pid, b.run, Number(k)), "final.png");
    if (existsSync(f)) args.push(`${role}=${f}`);
  }
  if (!args.length) return fail(c, "assign at least one direction (south/north/east/west)");
  const name = String(b.name || "character").replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const outDir = join(projectDir(pid), "exports", name);
  mkdirSync(outDir, { recursive: true });
  const r = await pxl(["char-pack", "--name", name, "--out", outDir, ...(b.mirror === false ? ["--no-mirror"] : []), ...args]);
  if (r.code !== 0) return fail(c, r.stderr.slice(0, 300), 500);
  const info = JSON.parse(r.stdout);
  if (b.dest) {
    try {
      mkdirSync(String(b.dest), { recursive: true });
      for (const f of [...Object.values<any>(info.directions).map((d) => d.file), info.sheet, name + ".json"]) copyFileSync(join(outDir, f), join(String(b.dest), f));
    } catch (e) {
      return fail(c, e);
    }
  }
  const files = [...Object.values<any>(info.directions).map((d) => d.file), info.sheet, name + ".json"].map((f) => ({ name: f, path: join(outDir, f), url: fileUrl(join(outDir, f)) }));
  return c.json({ info, files });
});

/** "Bundan devam et": a whole-canvas instruction on a chosen variant. */
app.post("/api/projects/:pid/continue", async (c) => {
  const pid = c.req.param("pid");
  const b = await c.req.json();
  const run = getRun(pid, b.run);
  const size = run.spec.size;
  const cm = addComment(pid, { runId: b.run, k: Number(b.k), region: [0, 0, size - 1, size - 1], text: String(b.instruction || "Improve the overall quality; keep the design.") });
  return c.json(startFix(pid, { run: b.run, k: Number(b.k) }, [cm.id], b.settings));
});

// ---------------------------------------------------------------- export
app.post("/api/projects/:pid/export", async (c) => {
  const pid = c.req.param("pid");
  const b = await c.req.json();
  const dir = variantDir(pid, b.run, Number(b.k));
  const src = join(dir, "final.png");
  if (!existsSync(src)) return fail(c, "no final.png");
  const scale = Math.max(1, Math.min(16, Number(b.scale) || 1));
  const name = String(b.name || getRun(pid, b.run).spec.title || "sprite").replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const outDir = join(projectDir(pid), "exports");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${name}${scale > 1 ? "@" + scale + "x" : ""}.png`);
  await pxl(["render", src, "-o", out, "--scale", String(scale)]);
  const files = [out];
  if (existsSync(join(dir, "draw.py"))) {
    copyFileSync(join(dir, "draw.py"), join(outDir, name + ".py"));
    files.push(join(outDir, name + ".py"));
  }
  const grid = await pxl(["dump", src, "-o", join(outDir, name + ".json")]);
  if (grid.code === 0) files.push(join(outDir, name + ".json"));
  if (b.dest) {
    try {
      mkdirSync(b.dest, { recursive: true });
      copyFileSync(out, join(b.dest, `${name}.png`));
    } catch (e) {
      return fail(c, e);
    }
  }
  return c.json({ files: files.map((f) => ({ path: f, url: fileUrl(f) })) });
});

// ---------------------------------------------------------------- files + web
app.get("/files/*", (c) => {
  const rel = decodeURIComponent(c.req.path.replace(/^\/files\//, ""));
  let p: string;
  try {
    p = safeJoin(PROJECTS, rel);
  } catch {
    return c.text("bad path", 400);
  }
  if (!existsSync(p) || !statSync(p).isFile()) return c.text("not found", 404);
  return new Response(readFileSync(p), { headers: { "content-type": MIME[extname(p)] ?? "application/octet-stream", "cache-control": "no-cache" } });
});

app.get("*", (c) => {
  if (!existsSync(WEB_DIST)) return c.text("Web UI not built. Run `npm run build` (or `npm run dev` for development).", 503);
  let p: string;
  try {
    p = safeJoin(WEB_DIST, c.req.path.replace(/^\//, "") || "index.html");
  } catch {
    return c.text("bad path", 400);
  }
  if (!existsSync(p) || !statSync(p).isFile()) p = join(WEB_DIST, "index.html");
  return new Response(readFileSync(p), { headers: { "content-type": MIME[extname(p)] ?? "application/octet-stream" } });
});

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`Pixel Studio → http://${HOST}:${info.port}  (projects: ${PROJECTS})`);
});
