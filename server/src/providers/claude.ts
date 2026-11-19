import { ENGINE } from "../config.js";
import { clip, type DrawArgs, type Provider } from "./types.js";
import { runLines, which } from "./proc.js";

const MODELS = [
  { id: "sonnet", label: "Claude Sonnet", vision: true },
  { id: "opus", label: "Claude Opus", vision: true },
  { id: "haiku", label: "Claude Haiku", vision: true },
];

// Isolated headless run: no MCP servers, no session saved.
const BASE = ["--no-session-persistence", "--strict-mcp-config"];

/** Claude Code CLI (`claude -p`), runs on the user's subscription login. */
export const claudeCli: Provider = {
  id: "claude-cli",
  vision: () => true,
  async status() {
    const v = await which("claude");
    return { id: "claude-cli", label: "Claude (CLI, subscription)", ok: !!v, detail: v ?? "`claude` not found on PATH", models: MODELS };
  },
  async complete(prompt, model, signal) {
    let out = "";
    const r = await runLines("claude", ["-p", "--output-format", "json", "--model", model, "--tools", "", ...BASE], {
      stdin: prompt,
      signal,
      onLine: (l) => (out += l),
    });
    if (r.code !== 0) throw new Error("claude exited " + r.code + ": " + clip(r.stderr || out, 300));
    const j = JSON.parse(out);
    if (j.is_error) throw new Error(clip(String(j.result), 300));
    return String(j.result ?? "");
  },
  async draw(a: DrawArgs) {
    let result: { ok: boolean; error?: string } = { ok: false, error: "no result" };
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--model", a.model,
      "--tools", "Bash", "Read", "Write", "Edit",
      "--allowedTools", "Bash(python3:*)", "Read", "Write", "Edit",
      "--permission-mode", "acceptEdits",
      "--add-dir", ENGINE,
      ...BASE,
    ];
    if (a.effort) args.push("--effort", a.effort);
    const r = await runLines("claude", args, {
      cwd: a.cwd,
      env: a.env,
      signal: a.signal,
      stdin: a.prompt,
      onLine: (line) => {
        let j: any;
        try {
          j = JSON.parse(line);
        } catch {
          return;
        }
        if (j.type === "assistant") {
          for (const c of j.message?.content ?? []) {
            if (c.type === "text" && c.text?.trim()) a.onEvent({ t: "text", text: c.text });
            else if (c.type === "thinking" && c.thinking) a.onEvent({ t: "thinking", text: clip(c.thinking, 1200) });
            else if (c.type === "tool_use") a.onEvent({ t: "tool", name: c.name, detail: clip(c.input?.command ?? c.input?.file_path ?? JSON.stringify(c.input), 300) });
          }
        } else if (j.type === "user") {
          for (const c of j.message?.content ?? []) {
            if (c.type === "tool_result") {
              const txt = Array.isArray(c.content) ? c.content.map((x: any) => x.text ?? "").join(" ") : String(c.content ?? "");
              a.onEvent({ t: "tool_result", ok: !c.is_error, detail: clip(txt, 400) });
            }
          }
        } else if (j.type === "result") {
          result = j.is_error ? { ok: false, error: clip(String(j.result ?? j.subtype), 300) } : { ok: true };
        }
      },
    });
    if (a.signal.aborted) return { ok: false, error: "cancelled" };
    if (r.code !== 0 && result.ok) return result; // result already reported success
    if (r.code !== 0 && !result.error) return { ok: false, error: clip(r.stderr, 300) };
    return result;
  },
};
