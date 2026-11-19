import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PROJECTS } from "./config.js";
import { emit } from "./events.js";
import { listPalettes, pxl } from "./engine.js";
import { criticFixPrompt, criticPrompt, drawPrompt, fixPrompt, pickPrompt, refinePrompt } from "./prompts.js";
import { provider } from "./providers/index.js";
import { enqueue } from "./queue.js";
import { getProject, getRun, newId, saveRun, updateProject, updateRun, variantDir } from "./store.js";
import type { Comment, Run, Settings, Spec, Variant } from "./types.js";

const controllers = new Map<string, AbortController>(); // `${rid}/${k}`

export const fileUrl = (abs: string) => "/files/" + relative(PROJECTS, abs).split("\\").join("/");

// ---------------------------------------------------------------- refine (prompt'a çevir)

/** Extract the first JSON object from model text (handles ```json fences and prose around it). */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const a = src.indexOf("{");
  const b = src.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object in model output");
  return JSON.parse(src.slice(a, b + 1));
}

export function normalizeSpec(raw: any, s: Settings): Spec {
  const style = raw.style ?? {};
  const spec: Spec = {
    title: String(raw.title ?? "sprite").slice(0, 80),
    subject: String(raw.subject ?? ""),
    size: Math.max(8, Math.min(128, Number(raw.size) || s.size)),
    route: (["draw", "variant", "kitbash", "convert"].includes(raw.route) ? raw.route : s.route === "auto" ? "draw" : s.route) as Spec["route"],
    composition: String(raw.composition ?? ""),
    parts: Array.isArray(raw.parts) ? raw.parts.map((p: any) => ({ name: String(p.name ?? ""), material: String(p.material ?? ""), ramp: p.ramp, shape: p.shape, where: p.where })) : [],
    details: Array.isArray(raw.details) ? raw.details.map(String) : [],
    avoid: Array.isArray(raw.avoid) ? raw.avoid.map(String) : [],
    palette: String(raw.palette ?? s.palette),
    style: {
      light: String(style.light ?? s.light),
      outline: String(style.outline ?? s.outline),
      shading: String(style.shading ?? s.shading),
      dither: Boolean(style.dither ?? s.dither),
      tones: Number(style.tones ?? s.tones),
      detail: String(style.detail ?? s.detail),
    },
    variantOps: Array.isArray(raw.variantOps) ? raw.variantOps.map((o: any) => ({ src: Number(o.src), dst: Number(o.dst), range: o.range != null ? Number(o.range) : 25, sat: o.sat != null ? Number(o.sat) : 1, region: o.region ?? null })) : undefined,
    prompt: String(raw.prompt ?? ""),
  };
  if (!spec.prompt.trim()) throw new Error("spec has no prompt");
  return spec;
}

export async function refine(pid: string, brief: string, s: Settings, refineProvider?: string, refineModel?: string): Promise<Spec> {
  const pal = listPalettes().find((p) => p.name === s.palette);
  const prov = provider(refineProvider ?? s.provider);
  const model = refineModel ?? s.model;
  const prompt = refinePrompt(brief, s, pal, s.baseItem);
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await prov.complete(attempt === 0 ? prompt : prompt + `\n\nYour previous answer was not valid (${lastErr}). Return ONLY the JSON object.`, model);
    try {
      const spec = normalizeSpec(extractJson(text), s);
      updateProject(pid, (p) => {
        p.brief = brief;
        p.settings = s;
        p.spec = spec;
      });
      return spec;
    } catch (e) {
      lastErr = String(e);
    }
  }
  throw new Error("could not get a valid spec: " + lastErr);
}

// ---------------------------------------------------------------- runs

export function startRun(pid: string, opts: { spec: Spec; settings: Settings; kind?: Run["kind"]; parent?: { run: string; k: number }; commentIds?: string[] }): Run {
  const s = opts.settings;
  const kind = opts.kind ?? (opts.spec.route === "variant" && s.baseItem ? "variant" : "draw");
  const n = kind === "variant" ? Math.max(1, Math.min(6, opts.spec.variantOps?.length ? s.variants : 1)) : Math.max(1, Math.min(6, s.variants));
  const run: Run = {
    id: newId("r"),
    projectId: pid,
    kind,
    createdAt: Date.now(),
    settings: s,
    spec: opts.spec,
    parent: opts.parent,
    commentIds: opts.commentIds,
    variants: Array.from({ length: n }, (_, k): Variant => ({ k, status: "queued", provider: s.provider, model: s.model, seed: s.seed + k * 101, steps: 0 })),
  };
  saveRun(run);
  updateProject(pid, (p) => {
    p.runs.unshift(run.id);
    p.spec = opts.spec;
    p.settings = s;
  });
  for (const v of run.variants) {
    const dir = variantDir(pid, run.id, v.k);
    mkdirSync(join(dir, "steps"), { recursive: true });
    if (kind === "variant") void runVariantOps(pid, run, v.k);
    else enqueue(s.provider, () => runAgent(pid, run.id, v.k));
  }
  return run;
}

function setStatus(pid: string, rid: string, k: number, patch: Partial<Variant>) {
  const r = updateRun(pid, rid, (r) => Object.assign(r.variants[k], patch));
  if (patch.status) emit(pid, rid, { t: "status", k, status: patch.status, error: patch.error });
  const ended = (v: Variant) => ["done", "error", "cancelled"].includes(v.status);
  if (patch.status && ended(r.variants[k]) && r.variants.every(ended) && r.settings.autoPick && r.kind !== "fix" && r.variants.filter((v) => v.status === "done").length > 1)
    void autoPick(pid, rid);
}

/** A vision model looks at all finished variations side by side and stars the best one. */
async function autoPick(pid: string, rid: string) {
  const run = getRun(pid, rid);
  const prov = provider(run.settings.provider);
  if (!prov.vision(run.settings.model) || run.variants.some((v) => v.starred)) return;
  const done = run.variants.filter((v) => v.status === "done");
  const dir = join(variantDir(pid, rid, 0), "..");
  const sheet = join(dir, "pick_sheet.png");
  await pxl(["sheet", ...done.map((v) => join(variantDir(pid, rid, v.k), "final.png")), "-o", sheet, "--scale", "6"]);
  const ctrl = new AbortController();
  await prov.draw({
    prompt: pickPrompt(done.length, run.spec), cwd: dir, model: run.settings.model, vision: true, signal: ctrl.signal,
    env: { PYTHONDONTWRITEBYTECODE: "1" }, attach: run.settings.provider === "opencode" ? [sheet] : [], onEvent: () => {},
  });
  try {
    const j = JSON.parse(readFileSync(join(dir, "pick.json"), "utf-8"));
    const v = done[Number(j.best) - 1];
    if (!v) return;
    updateRun(pid, rid, (r) => (r.variants[v.k].starred = true));
    emit(pid, rid, { t: "text", k: v.k, text: `★ auto-pick: #${v.k + 1} — ${j.reason ?? ""}` });
    emit(pid, rid, { t: "status", k: v.k, status: "done" });
  } catch {
    /* no pick */
  }
}

/** Watch steps/ for new step_###.png written by `pxl render` (PXL_STEP_DIR) and stream them. */
function watchSteps(pid: string, rid: string, k: number): () => void {
  const dir = join(variantDir(pid, rid, k), "steps");
  const seen = new Set<string>();
  const tick = () => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((f) => /^step_\d+\.png$/.test(f)).sort()) {
      if (seen.has(f)) continue;
      const meta = join(dir, f.replace(".png", ".json"));
      if (!existsSync(meta)) continue; // json is written after the png: wait for it
      seen.add(f);
      let info: any = {};
      try {
        info = JSON.parse(readFileSync(meta, "utf-8"));
      } catch {
        /* partial */
      }
      const n = Number(f.slice(5, 8));
      updateRun(pid, rid, (r) => {
        r.variants[k].steps = Math.max(r.variants[k].steps, n);
        r.variants[k].score = info.score;
      });
      emit(pid, rid, { t: "step", k, n, url: fileUrl(join(dir, f)), score: info.score, lint: info.lint });
    }
  };
  const iv = setInterval(tick, 500);
  return () => {
    tick();
    clearInterval(iv);
  };
}

async function runAgent(pid: string, rid: string, k: number) {
  const run = getRun(pid, rid);
  if (run.variants[k].status === "cancelled") return;
  const s = run.settings;
  const prov = provider(s.provider);
  const vision = prov.vision(s.model);
  const cwd = variantDir(pid, rid, k);
  const ctrl = new AbortController();
  controllers.set(rid + "/" + k, ctrl);
  setStatus(pid, rid, k, { status: "running", startedAt: Date.now() });
  const stop = watchSteps(pid, rid, k);
  const inline = s.provider === "anthropic-api" || s.provider === "openai-api";
  let prompt: string;
  const attach: string[] = [];
  try {
    if (run.kind === "fix" && run.parent) {
      // start from the parent's script and image
      const pdir = variantDir(pid, run.parent.run, run.parent.k);
      copyFileSync(join(pdir, "draw.py"), join(cwd, "draw.py"));
      copyFileSync(join(pdir, "final.png"), join(cwd, "current.png"));
      const proj = getProject(pid);
      const comments = proj.comments.filter((c) => run.commentIds?.includes(c.id));
      const asciiCrops: string[] = [];
      const cropFiles: string[] = [];
      for (const [i, c] of comments.entries()) {
        const pad = 2;
        const region = [Math.max(0, c.region[0] - pad), Math.max(0, c.region[1] - pad), c.region[2] + pad, c.region[3] + pad].join(",");
        const file = join(cwd, `region_${i + 1}.png`);
        const r = await pxl(["crop", join(cwd, "current.png"), "--region", region, "--ascii", "-o", file]);
        asciiCrops.push(r.stdout.split("\nwrote")[0]);
        cropFiles.push(`region_${i + 1}.png`);
        if (vision) attach.push(file);
      }
      prompt = fixPrompt(comments, s, { vision, asciiCrops, cropFiles, inline });
    } else {
      let extra = "";
      if (run.spec.route === "convert" && s.reference) {
        await pxl(["convert", s.reference, "--size", String(run.spec.size), "--palette", run.spec.palette, "-o", join(cwd, "start.png")]);
        extra = `\n\nThe user's reference image was converted to ./start.png (${run.spec.size}px, on palette). Begin with \`C = load("start.png")\` and refine it (clean shapes, shading, outline, details) instead of drawing from scratch.`;
      } else if ((run.spec.route === "kitbash" || run.spec.route === "variant") && s.baseItem) {
        extra = `\n\nBase sprite to build from: ${s.baseItem}. Use \`A = load(path)\`, crop()/stamp()/recolor_hue() to reuse its hand-made pixels; draw only what is new.`;
      }
      prompt = drawPrompt(run.spec, s, { k, seed: run.variants[k].seed, vision, inline }) + extra;
    }
    {
      prompt += `\n\nWORKING DIRECTORY (all your files go here): ${cwd}`;
    }
    const res = await prov.draw({
      prompt,
      cwd,
      model: s.model,
      effort: s.effort,
      vision,
      env: { PXL_STEP_DIR: join(cwd, "steps"), PYTHONDONTWRITEBYTECODE: "1" },
      signal: ctrl.signal,
      attach,
      onEvent: (e) => emit(pid, rid, { ...e, k } as any),
    });
    // automatic art-director rounds (new drawings only; region fixes are already targeted)
    const rounds = run.kind === "fix" ? 0 : Math.max(0, Math.min(3, s.critic ?? 0));
    for (let r = 0; r < rounds && res.ok && !ctrl.signal.aborted && existsSync(join(cwd, "final.png")); r++) {
      emit(pid, rid, { t: "text", k, text: `— art director round ${r + 1}/${rounds}` });
      await pxl(["render", join(cwd, "final.png"), "-o", join(cwd, "crit.png"), "--preview"]);
      const common = { cwd, model: s.model, effort: s.effort, vision, env: { PXL_STEP_DIR: join(cwd, "steps"), PYTHONDONTWRITEBYTECODE: "1" }, signal: ctrl.signal, onEvent: (e: any) => emit(pid, rid, { ...e, k } as any) };
      await prov.draw({ ...common, prompt: criticPrompt(run.spec, vision), attach: vision && s.provider === "opencode" ? [join(cwd, "crit_x8.png")] : [] });
      const cf = join(cwd, "critique.txt");
      if (!existsSync(cf)) break;
      const critique = readFileSync(cf, "utf-8").trim();
      copyFileSync(cf, join(cwd, `critique_${r + 1}.txt`));
      emit(pid, rid, { t: "text", k, text: "Art director:\n" + critique });
      await prov.draw({ ...common, prompt: criticFixPrompt(critique) });
    }
    stop();
    const final = join(cwd, "final.png");
    if (existsSync(final)) {
      const lint = await pxl(["lint", final]);
      const score = Number(lint.stdout.match(/score (\d+)/)?.[1] ?? NaN);
      let outsideChange: Variant["outsideChange"];
      if (run.kind === "fix" && existsSync(join(cwd, "current.png"))) {
        const proj = getProject(pid);
        const boxes = proj.comments.filter((c) => run.commentIds?.includes(c.id)).map((c) => c.region);
        if (boxes.length) {
          const u = [Math.min(...boxes.map((b) => b[0])) - 2, Math.min(...boxes.map((b) => b[1])) - 2, Math.max(...boxes.map((b) => b[2])) + 2, Math.max(...boxes.map((b) => b[3])) + 2];
          const d = await pxl(["diff", join(cwd, "current.png"), final, "--region", u.join(",")]);
          try {
            const j = JSON.parse(d.stdout);
            outsideChange = { inside: j.changed_inside, outside: j.changed_outside };
            if (j.changed_outside > 0) emit(pid, rid, { t: "warn", k, text: `${j.changed_outside} pixels changed outside the commented regions` });
          } catch {
            /* ignore */
          }
        }
        updateProject(pid, (p) => p.comments.forEach((c) => run.commentIds?.includes(c.id) && ((c.status = "applied"), (c.appliedIn = rid))));
      }
      emit(pid, rid, { t: "final", k, url: fileUrl(final) + "?t=" + Date.now(), score });
      setStatus(pid, rid, k, { status: res.ok ? "done" : "error", error: res.ok ? undefined : res.error, score, endedAt: Date.now(), outsideChange });
    } else {
      setStatus(pid, rid, k, { status: ctrl.signal.aborted ? "cancelled" : "error", error: res.error ?? "no final.png produced", endedAt: Date.now() });
    }
  } catch (e) {
    stop();
    setStatus(pid, rid, k, { status: "error", error: String(e), endedAt: Date.now() });
  } finally {
    controllers.delete(rid + "/" + k);
  }
}

/** Variant route: recolor an existing sprite directly with pxl (no LLM call, instant). */
async function runVariantOps(pid: string, run: Run, k: number) {
  const s = run.settings;
  const cwd = variantDir(pid, run.id, k);
  setStatus(pid, run.id, k, { status: "running", startedAt: Date.now() });
  const ops = run.spec.variantOps ?? [];
  // candidate k: apply op k (if several ops were proposed) — or all ops for k=0
  const chosen = ops.length > 1 && run.variants.length > 1 ? [ops[k % ops.length]] : ops;
  const args = ["variant", s.baseItem!, "-o", join(cwd, "final.png")];
  const hue = chosen.map((o) => [o.src, o.dst, o.range ?? 25, o.sat ?? 1].join(":")).join(",");
  if (hue) args.push("--hue", hue);
  const region = chosen.find((o) => o.region)?.region;
  if (region) args.push("--region", region.join(","));
  const r = await pxl(args);
  emit(pid, run.id, { t: "tool", k, name: "pxl variant", detail: args.slice(1).join(" ") });
  emit(pid, run.id, { t: "tool_result", k, ok: r.code === 0, detail: (r.stdout + r.stderr).trim().slice(0, 400) });
  if (r.code !== 0) return setStatus(pid, run.id, k, { status: "error", error: r.stderr.slice(0, 300), endedAt: Date.now() });
  await pxl(["render", join(cwd, "final.png"), "-o", join(cwd, "final.png")], { env: { PXL_STEP_DIR: join(cwd, "steps") } });
  const stop = watchSteps(pid, run.id, k);
  stop();
  emit(pid, run.id, { t: "final", k, url: fileUrl(join(cwd, "final.png")) + "?t=" + Date.now() });
  setStatus(pid, run.id, k, { status: "done", endedAt: Date.now(), steps: 1 });
}

export function cancel(pid: string, rid: string, k?: number) {
  const run = getRun(pid, rid);
  for (const v of run.variants) {
    if (k !== undefined && v.k !== k) continue;
    const c = controllers.get(rid + "/" + v.k);
    if (c) c.abort();
    else if (v.status === "queued") setStatus(pid, rid, v.k, { status: "cancelled" });
  }
}

export function startFix(pid: string, parent: { run: string; k: number }, commentIds: string[], settings?: Partial<Settings>): Run {
  const pr = getRun(pid, parent.run);
  const s = { ...pr.settings, ...settings, variants: settings?.variants ?? 1 };
  return startRun(pid, { spec: pr.spec, settings: s, kind: "fix", parent, commentIds });
}

export type { Comment };
