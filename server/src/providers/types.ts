import type { AgentEvent } from "../types.js";

type DistOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type Emit = (e: DistOmit<AgentEvent, "k">) => void;

export interface DrawArgs {
  prompt: string;
  cwd: string;
  model: string;
  effort?: string;
  vision: boolean;
  env: Record<string, string>;
  signal: AbortSignal;
  onEvent: Emit;
  attach?: string[]; // image files to attach (vision models), e.g. region crops
}

export interface ProviderStatus {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  models: { id: string; label: string; vision: boolean }[];
}

export interface Provider {
  id: string;
  status(): Promise<ProviderStatus>;
  vision(model: string): boolean;
  /** One-shot text completion (prompt refinement). Returns the model's text. */
  complete(prompt: string, model: string, signal?: AbortSignal): Promise<string>;
  /** Run the drawing agent in `cwd` until it finishes. */
  draw(a: DrawArgs): Promise<{ ok: boolean; error?: string }>;
}

export const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + "…" : s);
