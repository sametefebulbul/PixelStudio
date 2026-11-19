import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "./store.js";
import type { AgentEvent } from "./types.js";

type Listener = (e: AgentEvent) => void;
const listeners = new Map<string, Set<Listener>>();

const key = (pid: string, rid: string) => pid + "/" + rid;

/** Publish an event for a run: appended to runs/<rid>/events.jsonl (replayable) and pushed to live SSE listeners. */
export function emit(pid: string, rid: string, e: AgentEvent) {
  try {
    appendFileSync(join(runDir(pid, rid), "events.jsonl"), JSON.stringify({ ...e, at: Date.now() }) + "\n");
  } catch {
    /* run dir may be gone */
  }
  listeners.get(key(pid, rid))?.forEach((l) => l(e));
}

export function subscribe(pid: string, rid: string, l: Listener): () => void {
  const k = key(pid, rid);
  if (!listeners.has(k)) listeners.set(k, new Set());
  listeners.get(k)!.add(l);
  return () => listeners.get(k)?.delete(l);
}

export function history(pid: string, rid: string): AgentEvent[] {
  const f = join(runDir(pid, rid), "events.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AgentEvent);
}
