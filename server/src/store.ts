import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { PROJECTS } from "./config.js";
import type { Comment, Project, Run, Settings } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";

export const newId = (prefix: string) => prefix + "_" + Date.now().toString(36) + randomBytes(3).toString("hex");

function writeJson(path: string, data: unknown) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, path); // atomic replace
}
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf-8")) as T;

export const projectDir = (pid: string) => safeJoin(PROJECTS, pid);
export const runDir = (pid: string, rid: string) => safeJoin(projectDir(pid), "runs", rid);
export const variantDir = (pid: string, rid: string, k: number) => join(runDir(pid, rid), "v" + k);

/** Join that refuses to escape `base` (ids come from URLs). */
export function safeJoin(base: string, ...parts: string[]): string {
  const p = resolve(base, ...parts);
  if (p !== resolve(base) && !p.startsWith(resolve(base) + sep)) throw new Error("bad path");
  return p;
}

export function listProjects(): Project[] {
  return readdirSync(PROJECTS)
    .filter((d) => existsSync(join(PROJECTS, d, "project.json")))
    .map((d) => readJson<Project>(join(PROJECTS, d, "project.json")))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createProject(title: string, settings?: Partial<Settings>): Project {
  const id = newId("p");
  const now = Date.now();
  const p: Project = { id, title: title || "Untitled", createdAt: now, updatedAt: now, brief: "", settings: { ...DEFAULT_SETTINGS, ...settings }, runs: [], comments: [] };
  mkdirSync(join(projectDir(id), "runs"), { recursive: true });
  mkdirSync(join(projectDir(id), "uploads"), { recursive: true });
  saveProject(p);
  return p;
}

export function getProject(pid: string): Project {
  return readJson<Project>(join(projectDir(pid), "project.json"));
}

export function saveProject(p: Project) {
  p.updatedAt = Date.now();
  writeJson(join(projectDir(p.id), "project.json"), p);
}

export function saveRun(r: Run) {
  mkdirSync(runDir(r.projectId, r.id), { recursive: true });
  writeJson(join(runDir(r.projectId, r.id), "run.json"), r);
}

export function getRun(pid: string, rid: string): Run {
  return readJson<Run>(join(runDir(pid, rid), "run.json"));
}

export function updateRun(pid: string, rid: string, fn: (r: Run) => void): Run {
  const r = getRun(pid, rid);
  fn(r);
  saveRun(r);
  return r;
}

export function updateProject(pid: string, fn: (p: Project) => void): Project {
  const p = getProject(pid);
  fn(p);
  saveProject(p);
  return p;
}

export function addComment(pid: string, c: Omit<Comment, "id" | "createdAt" | "status">): Comment {
  const full: Comment = { ...c, id: newId("c"), createdAt: Date.now(), status: "open" };
  updateProject(pid, (p) => p.comments.push(full));
  return full;
}
