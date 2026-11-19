import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { SETTINGS_FILE } from "../config.js";
import { pxl } from "../engine.js";
import { safeJoin } from "../store.js";
import { clip, type DrawArgs, type Provider } from "./types.js";

/** Keys: env first, then ~/.pixel-studio/settings.json {"anthropicKey","openaiKey","openaiBaseUrl"} (written from the UI). */
export function apiSettings(): { anthropicKey?: string; openaiKey?: string; openaiBaseUrl?: string; openaiModels?: string } {
  let s: any = {};
  if (existsSync(SETTINGS_FILE)) {
    try {
      s = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  return {
    anthropicKey: process.env.ANTHROPIC_API_KEY || s.anthropicKey,
    openaiKey: process.env.OPENAI_API_KEY || s.openaiKey,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || s.openaiBaseUrl || "https://api.openai.com/v1",
    openaiModels: s.openaiModels,
  };
}

export function saveApiSettings(patch: Record<string, string>) {
  let s: any = {};
  if (existsSync(SETTINGS_FILE)) s = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
  writeFileSync(SETTINGS_FILE, JSON.stringify({ ...s, ...patch }, null, 1), { mode: 0o600 });
}

// ---- tools shared by both APIs ------------------------------------------------------------
const TOOLS = [
  { name: "write_file", description: "Create or overwrite a text file in the working directory (e.g. draw.py).", schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "read_file", description: "Read a text file from the working directory.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "pxl", description: "Run the pxl toolkit CLI: e.g. args='render draw.py -o final.png --preview', 'lint final.png', 'show final.png', 'silhouette final.png'.", schema: { type: "object", properties: { args: { type: "string" } }, required: ["args"] } },
  { name: "view_image", description: "Look at a PNG in the working directory (vision models only), e.g. final_x8.png.", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];

type ToolOut = { text: string; image?: { b64: string; mime: string } };

async function runTool(name: string, input: any, a: DrawArgs): Promise<ToolOut> {
  try {
    if (name === "write_file") {
      writeFileSync(safeJoin(a.cwd, input.path), String(input.content ?? ""));
      return { text: "wrote " + input.path };
    }
    if (name === "read_file") return { text: clip(readFileSync(safeJoin(a.cwd, input.path), "utf-8"), 20000) };
    if (name === "pxl") {
      const args = String(input.args ?? "").match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, "")) ?? [];
      if (!["render", "lint", "show", "silhouette", "dump", "crop", "diff", "palette"].includes(args[0])) return { text: "only render|lint|show|silhouette|dump|crop|diff|palette are allowed" };
      const r = await pxl(args, { cwd: a.cwd, env: a.env, timeoutMs: 90_000 });
      return { text: clip((r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim(), 12000) || "(no output)" };
    }
    if (name === "view_image") {
      if (!a.vision) return { text: "this model cannot view images; use pxl show / silhouette / lint" };
      const p = safeJoin(a.cwd, input.path);
      return { text: "image " + input.path, image: { b64: readFileSync(p).toString("base64"), mime: extname(p) === ".png" ? "image/png" : "image/jpeg" } };
    }
    return { text: "unknown tool " + name };
  } catch (e) {
    return { text: "error: " + String(e) };
  }
}

const MAX_TURNS = 40;

// ---- Anthropic Messages API ---------------------------------------------------------------
export const anthropicApi: Provider = {
  id: "anthropic-api",
  vision: () => true,
  async status() {
    const k = apiSettings().anthropicKey;
    return {
      id: "anthropic-api",
      label: "Anthropic API (key)",
      ok: !!k,
      detail: k ? "key set" : "set ANTHROPIC_API_KEY or add a key in Settings",
      models: [
        { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", vision: true },
        { id: "claude-opus-5-5", label: "Claude Opus 5.5", vision: true },
        { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", vision: true },
      ],
    };
  },
  async complete(prompt, model, signal) {
    const j = await anthropicCall({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }, signal);
    return (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  },
  async draw(a) {
    const messages: any[] = [{ role: "user", content: a.prompt }];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (a.signal.aborted) return { ok: false, error: "cancelled" };
      let j: any;
      try {
        j = await anthropicCall(
          { model: a.model, max_tokens: 8192, tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })), messages },
          a.signal,
        );
      } catch (e) {
        return { ok: false, error: String(e) };
      }
      messages.push({ role: "assistant", content: j.content });
      const results: any[] = [];
      for (const c of j.content ?? []) {
        if (c.type === "text" && c.text.trim()) a.onEvent({ t: "text", text: c.text });
        if (c.type === "tool_use") {
          a.onEvent({ t: "tool", name: c.name, detail: clip(c.input?.args ?? c.input?.path ?? "", 300) });
          const out = await runTool(c.name, c.input, a);
          a.onEvent({ t: "tool_result", ok: !out.text.startsWith("error"), detail: clip(out.text, 400) });
          results.push({
            type: "tool_result",
            tool_use_id: c.id,
            content: out.image ? [{ type: "image", source: { type: "base64", media_type: out.image.mime, data: out.image.b64 } }] : out.text,
          });
        }
      }
      if (j.stop_reason !== "tool_use") return { ok: true };
      messages.push({ role: "user", content: results });
    }
    return { ok: false, error: "too many turns" };
  },
};

async function anthropicCall(body: any, signal?: AbortSignal): Promise<any> {
  const key = apiSettings().anthropicKey;
  if (!key) throw new Error("no Anthropic API key");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Anthropic API " + r.status + ": " + clip(j.error?.message ?? JSON.stringify(j), 300));
  return j;
}

// ---- OpenAI-compatible Chat Completions (OpenAI, OpenRouter, local servers …) -----------------
export const openaiApi: Provider = {
  id: "openai-api",
  vision: (model) => !/glm-5\.3$|deepseek-v4-pro|text/i.test(model),
  async status() {
    const s = apiSettings();
    const models = (s.openaiModels || "gpt-5.1,gpt-5.1-mini").split(",").map((m) => ({ id: m.trim(), label: m.trim(), vision: true }));
    return { id: "openai-api", label: "OpenAI-compatible API (key)", ok: !!s.openaiKey, detail: s.openaiKey ? s.openaiBaseUrl! : "set OPENAI_API_KEY (+ OPENAI_BASE_URL) or add it in Settings", models };
  },
  async complete(prompt, model, signal) {
    const j = await openaiCall({ model, messages: [{ role: "user", content: prompt }] }, signal);
    return j.choices?.[0]?.message?.content ?? "";
  },
  async draw(a) {
    const messages: any[] = [{ role: "user", content: a.prompt }];
    const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (a.signal.aborted) return { ok: false, error: "cancelled" };
      let j: any;
      try {
        j = await openaiCall({ model: a.model, messages, tools }, a.signal);
      } catch (e) {
        return { ok: false, error: String(e) };
      }
      const msg = j.choices?.[0]?.message ?? {};
      messages.push(msg);
      if (msg.content?.trim?.()) a.onEvent({ t: "text", text: msg.content });
      const calls = msg.tool_calls ?? [];
      if (!calls.length) return { ok: true };
      const images: any[] = [];
      for (const c of calls) {
        let input: any = {};
        try {
          input = JSON.parse(c.function?.arguments || "{}");
        } catch {
          /* ignore */
        }
        a.onEvent({ t: "tool", name: c.function?.name, detail: clip(input.args ?? input.path ?? "", 300) });
        const out = await runTool(c.function?.name, input, a);
        a.onEvent({ t: "tool_result", ok: !out.text.startsWith("error"), detail: clip(out.text, 400) });
        messages.push({ role: "tool", tool_call_id: c.id, content: out.text });
        if (out.image) images.push({ type: "image_url", image_url: { url: `data:${out.image.mime};base64,${out.image.b64}` } });
      }
      if (images.length) messages.push({ role: "user", content: [{ type: "text", text: "Requested image(s):" }, ...images] });
    }
    return { ok: false, error: "too many turns" };
  },
};

async function openaiCall(body: any, signal?: AbortSignal): Promise<any> {
  const s = apiSettings();
  if (!s.openaiKey) throw new Error("no OpenAI-compatible API key");
  const r = await fetch(s.openaiBaseUrl!.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + s.openaiKey },
    body: JSON.stringify(body),
    signal,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("API " + r.status + ": " + clip(j.error?.message ?? JSON.stringify(j), 300));
  return j;
}
