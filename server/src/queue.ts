/** Tiny per-provider concurrency queue (opencode workspaces have a concurrent-call limit). */
type Job = () => Promise<void>;

const LIMITS: Record<string, number> = {
  "claude-cli": Number(process.env.PS_LIMIT_CLAUDE || 3),
  opencode: Number(process.env.PS_LIMIT_OPENCODE || 2),
  "anthropic-api": Number(process.env.PS_LIMIT_API || 4),
  "openai-api": Number(process.env.PS_LIMIT_API || 4),
};
const running = new Map<string, number>();
const waiting = new Map<string, Job[]>();

export function enqueue(provider: string, job: Job) {
  if (!waiting.has(provider)) waiting.set(provider, []);
  waiting.get(provider)!.push(job);
  pump(provider);
}

function pump(provider: string) {
  const limit = LIMITS[provider] ?? 2;
  const q = waiting.get(provider) ?? [];
  while ((running.get(provider) ?? 0) < limit && q.length) {
    const job = q.shift()!;
    running.set(provider, (running.get(provider) ?? 0) + 1);
    job()
      .catch(() => {})
      .finally(() => {
        running.set(provider, (running.get(provider) ?? 1) - 1);
        pump(provider);
      });
  }
}

export function queueState() {
  return Object.fromEntries([...new Set([...running.keys(), ...waiting.keys()])].map((p) => [p, { running: running.get(p) ?? 0, waiting: waiting.get(p)?.length ?? 0 }]));
}
