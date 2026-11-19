import { anthropicApi, openaiApi } from "./api.js";
import { claudeCli } from "./claude.js";
import { opencode } from "./opencode.js";
import type { Provider } from "./types.js";

export const PROVIDERS: Record<string, Provider> = {
  "claude-cli": claudeCli,
  opencode,
  "anthropic-api": anthropicApi,
  "openai-api": openaiApi,
};

export function provider(id: string): Provider {
  const p = PROVIDERS[id];
  if (!p) throw new Error("unknown provider " + id);
  return p;
}
