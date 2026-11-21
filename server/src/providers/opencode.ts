import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clip, type DrawArgs, type Provider } from "./types.js";
import { runLines, which } from "./proc.js";

/** Model list + image capability from opencode's model cache. */
function models(): { id: string; label: string; vision: boolean }[] {
  const f = join(homedir(), ".cache", "opencode", "models.json");
  const fallback = [
    { id: "opencode-go/glm-5.3", label: "GLM 5.3 (blind)", vision: false },
    { id: "opencode-go/deepseek-v4.1-flash", label: "DeepSeek v4.1 flash (vision)", vision: true },
  ];
  if (!existsSync(f)) return fallback;
  try {
    const m = JSON.parse(readFileSync(f, "utf-8"));
    const out: { id: string; label: string; vision: boolean }[] = [];
    for (const [prov, p] of Object.entries<any>(m)) {
      if (!String(prov).startsWith("opencode")) continue;
      for (const [id, mm] of Object.entries<any>(p.models ?? {})) {
        if (!/glm|deepseek|qwen|kimi|minimax/i.test(id)) continue;
        const vision = (mm.modalities?.input ?? []).includes("image");
        out.push({ id: `${prov}/${id}`, label: `${mm.name ?? id}${vision ? " · vision" : " · blind"}`, vision });
      }
    }
    return out.length ? out : fallback;
  } catch {
    return fallback;
  }
}

/** Map the UI effort (low|medium|high) to a reasoning level the model really offers; returns "model#variant" or the plain id.
 *  Thinking time was ~80% of a DeepSeek run, so "medium" (the UI default) maps to the cheapest level. */
export function withEffort(model: string, effort?: string): string {
  if (model.includes("#")) return model;
  const f = join(homedir(), ".cache", "opencode", "models.json");
  try {
    const [prov, ...rest] = model.split("/");
    const mm = JSON.parse(readFileSync(f, "utf-8"))?.[prov]?.models?.[rest.join("/")];
    const values: string[] = (mm?.reasoning_options ?? []).find((o: any) => o.type === "effort")?.values ?? [];
    if (!values.length) return model;
    const want = effort === "high" ? "high" : effort === "low" || effort === "medium" || !effort ? "low" : effort;
    const pick = values.includes(want) ? want : want === "low" ? values[0] : values[values.length - 1];
    return `${model}#${pick}`;
  } catch {
    return model;
  }
}

export const opencode: Provider = {
  id: "opencode",
  vision: (model) => models().find((m) => m.id === model)?.vision ?? false,
  async status() {
    const v = await which("opencode");
    return { id: "opencode", label: "opencode (GLM / DeepSeek …)", ok: !!v, detail: v ?? "`opencode` not found on PATH", models: models() };
  },
  async complete(prompt, model, signal) {
    let text = "";
    const r = await runLines("opencode", ["run", "--standalone", "--format", "json", "-m", model, prompt], {
      signal,
      onLine: (l) => {
        try {
          const j = JSON.parse(l);
          if (j.type === "text") text += j.part?.text ?? "";
        } catch {
          /* ignore */
        }
      },
    });
    if (r.code !== 0 && !text) throw new Error("opencode exited " + r.code + ": " + clip(r.stderr, 300));
    return text;
  },
  async draw(a: DrawArgs) {
    const args = ["run", "--standalone", "--format", "json", "-m", withEffort(a.model, a.effort), "--auto"];
    for (const f of a.attach ?? []) args.push("-f", f);
    args.push(a.prompt);
    let sawText = false;
    const r = await runLines("opencode", args, {
      cwd: a.cwd,
      env: a.env,
      signal: a.signal,
      onLine: (line) => {
        let j: any;
        try {
          j = JSON.parse(line);
        } catch {
          return;
        }
        const part = j.part ?? {};
        if (j.type === "text" && part.text) {
          sawText = true;
          a.onEvent({ t: "text", text: part.text });
        } else if (j.type === "reasoning" && part.text) {
          a.onEvent({ t: "thinking", text: clip(part.text, 1200) });
        } else if (j.type === "tool_use") {
          const st = part.state ?? {};
          const inp = st.input ?? {};
          a.onEvent({ t: "tool", name: part.tool ?? "tool", detail: clip(inp.command ?? inp.path ?? inp.filePath ?? JSON.stringify(inp), 300) });
          if (st.status === "completed" || st.status === "error") a.onEvent({ t: "tool_result", ok: st.status === "completed", detail: clip(String(st.output ?? st.error ?? ""), 400) });
        } else if (j.type === "error") {
          a.onEvent({ t: "warn", text: clip(JSON.stringify(j.error ?? j), 300) });
        }
      },
    });
    if (a.signal.aborted) return { ok: false, error: "cancelled" };
    if (r.code !== 0) return { ok: false, error: clip(r.stderr || "opencode exited " + r.code, 300) };
    return { ok: true, error: sawText ? undefined : undefined };
  },
};
