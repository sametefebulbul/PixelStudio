#!/usr/bin/env node
// Launch Pixel Studio: start the local server (127.0.0.1) and open the browser.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "5178";
const server = join(root, "server", "dist", "index.js");

if (!existsSync(server) || !existsSync(join(root, "web", "dist", "index.html"))) {
  console.log("First run: building Pixel Studio…");
  const r = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const py = spawnSync(process.env.PXL_PYTHON || "python3", ["-c", "import PIL"], { stdio: "ignore" });
if (py.status !== 0) console.warn("⚠ python3 with Pillow is required for the drawing engine:  pip install pillow");

const child = spawn(process.execPath, [server], { stdio: "inherit", env: { ...process.env, PORT: port } });
const url = `http://127.0.0.1:${port}`;
if (!process.argv.includes("--no-open")) {
  setTimeout(() => {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).on("error", () => {});
  }, 800);
}
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code) => process.exit(code ?? 0));
