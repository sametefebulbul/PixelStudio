import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// server/src or server/dist -> repo root
export const ROOT = resolve(here, "..", "..");
export const ENGINE = join(ROOT, "engine");
export const PXL = join(ENGINE, "scripts", "pxl.py");
export const SKILL_MD = join(ENGINE, "SKILL.md");
export const WEB_DIST = join(ROOT, "web", "dist");
export const PYTHON = process.env.PXL_PYTHON || "python3";
export const PORT = Number(process.env.PORT || 5178);
export const HOST = "127.0.0.1";

/** Where projects live. Default: ~/.pixel-studio/projects (override with PIXEL_STUDIO_HOME). */
export const DATA = resolve(process.env.PIXEL_STUDIO_HOME || join(homedir(), ".pixel-studio"));
export const PROJECTS = join(DATA, "projects");
export const SETTINGS_FILE = join(DATA, "settings.json");
if (!existsSync(PROJECTS)) mkdirSync(PROJECTS, { recursive: true });
