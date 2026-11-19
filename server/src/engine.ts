import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ENGINE, PXL, PYTHON } from "./config.js";

/** Private user library (palettes/examples that must not be committed). */
export const LIBRARY = process.env.PXL_LIBRARY || join(homedir(), ".pixel-studio", "library");

export interface PyResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `python3 pxl.py <args>` and collect output. */
export function pxl(args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<PyResult> {
  return new Promise((resolve) => {
    const p = spawn(PYTHON, [PXL, ...args], { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    p.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(err) });
    });
  });
}

export interface PaletteInfo {
  name: string;
  outline: string;
  ramps: Record<string, string[]>;
  colors: Record<string, string>;
  note?: string;
}

export function listPalettes(): PaletteInfo[] {
  const dirs = [join(ENGINE, "assets", "palettes"), join(LIBRARY, "palettes")].filter((d) => existsSync(d));
  const out: PaletteInfo[] = [];
  for (const dir of dirs)
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      const name = d.name ?? f.replace(".json", "");
      if (!out.some((p) => p.name === name)) out.push({ name, outline: d.outline, ramps: d.ramps ?? {}, colors: d.colors ?? {}, note: d.note });
    }
  return out.sort((a, b) => (a.name === "studio" ? -1 : b.name === "studio" ? 1 : a.name.localeCompare(b.name)));
}

/** Sprites a user can start from (variant / kitbash): engine examples + folders listed in PIXEL_STUDIO_LIBRARY (":"-separated). */
export function listLibrary(): { name: string; path: string; group: string }[] {
  const out: { name: string; path: string; group: string }[] = [];
  const ex = join(ENGINE, "references", "examples");
  for (const f of readdirSync(ex).filter((f) => f.endsWith(".png"))) out.push({ name: f.replace(".png", ""), path: join(ex, f), group: "examples (CC0)" });
  const lib = join(LIBRARY, "examples");
  if (existsSync(lib)) for (const f of readdirSync(lib).filter((f) => f.endsWith(".png") || f.endsWith(".json"))) out.push({ name: f.replace(/\.(png|json)$/, ""), path: join(lib, f), group: "library" });
  for (const dir of (process.env.PIXEL_STUDIO_LIBRARY || "").split(":").filter(Boolean)) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".png"))) out.push({ name: f.replace(".png", ""), path: join(dir, f), group: dir.split("/").slice(-2).join("/") });
  }
  return out;
}

export async function checkPython(): Promise<{ ok: boolean; detail: string }> {
  const r = await pxl(["palette", "studio"], { timeoutMs: 15000 });
  return r.code === 0 ? { ok: true, detail: "python3 + Pillow" } : { ok: false, detail: (r.stderr || r.stdout).slice(0, 300) };
}
