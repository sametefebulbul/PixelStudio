import { spawn } from "node:child_process";

/** Spawn a CLI, stream stdout line by line, honour abort. Resolves with exit code + full stderr. */
export function runLines(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; signal?: AbortSignal; onLine: (line: string) => void; stdin?: string },
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.cwd ? { PWD: opts.cwd } : {}), ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    const kill = () => p.kill("SIGTERM");
    opts.signal?.addEventListener("abort", kill, { once: true });
    p.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) opts.onLine(line);
      }
    });
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    if (opts.stdin !== undefined) p.stdin.end(opts.stdin);
    else p.stdin.end();
    p.on("close", (code) => {
      if (buf.trim()) opts.onLine(buf.trim());
      opts.signal?.removeEventListener("abort", kill);
      resolve({ code: code ?? 1, stderr });
    });
    p.on("error", (err) => resolve({ code: 127, stderr: String(err) }));
  });
}

export async function which(cmd: string, versionArg = "--version"): Promise<string | null> {
  let out = "";
  const r = await runLines(cmd, [versionArg], { onLine: (l) => (out += l + "\n") });
  return r.code === 0 ? out.trim().split("\n")[0] : null;
}
