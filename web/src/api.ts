import type { Comment, LibItem, Palette, Project, ProviderStatus, Run, Settings, Spec } from "./types";

async function j<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data as T;
}

export const api = {
  status: () => j<{ python: { ok: boolean; detail: string }; providers: ProviderStatus[]; queue: Record<string, { running: number; waiting: number }> }>("GET", "/api/status"),
  palettes: () => j<Palette[]>("GET", "/api/palettes"),
  library: () => j<LibItem[]>("GET", "/api/library"),
  libraryImage: (path: string) => "/api/library/image?path=" + encodeURIComponent(path),
  settings: () => j<{ anthropicKey: string; openaiKey: string; openaiBaseUrl: string; openaiModels: string }>("GET", "/api/settings"),
  saveSettings: (s: Record<string, string>) => j("POST", "/api/settings", s),
  projects: () => j<{ id: string; title: string; updatedAt: number; runs: number }[]>("GET", "/api/projects"),
  createProject: (title: string, settings?: Partial<Settings>) => j<Project>("POST", "/api/projects", { title, settings }),
  project: (pid: string) => j<{ project: Project; runs: Run[] }>("GET", `/api/projects/${pid}`),
  patchProject: (pid: string, patch: Partial<Project>) => j<Project>("PATCH", `/api/projects/${pid}`, patch),
  refine: (pid: string, brief: string, settings: Settings) => j<Spec>("POST", `/api/projects/${pid}/refine`, { brief, settings }),
  startRun: (pid: string, spec: Spec, settings: Settings) => j<Run>("POST", `/api/projects/${pid}/runs`, { spec, settings }),
  convert: (pid: string, settings: Settings) => j<Run>("POST", `/api/projects/${pid}/convert`, { settings }),
  run: (pid: string, rid: string) => j<Run>("GET", `/api/projects/${pid}/runs/${rid}`),
  cancel: (pid: string, rid: string, k?: number) => j("POST", `/api/projects/${pid}/runs/${rid}/cancel`, { k }),
  star: (pid: string, rid: string, k: number) => j("POST", `/api/projects/${pid}/runs/${rid}/variants/${k}/star`),
  rate: (pid: string, rid: string, k: number, rating: number, note?: string) => j("POST", `/api/projects/${pid}/runs/${rid}/variants/${k}/rate`, { rating, note }),
  script: async (pid: string, rid: string, k: number) => (await fetch(`/api/projects/${pid}/runs/${rid}/variants/${k}/script`)).text(),
  addComment: (pid: string, c: { runId: string; k: number; region: number[]; text: string }) => j<Comment>("POST", `/api/projects/${pid}/comments`, c),
  patchComment: (pid: string, cid: string, patch: Partial<Comment>) => j<Comment[]>("PATCH", `/api/projects/${pid}/comments/${cid}`, patch),
  deleteComment: (pid: string, cid: string) => j<Comment[]>("DELETE", `/api/projects/${pid}/comments/${cid}`),
  fix: (pid: string, run: string, k: number, commentIds: string[], settings?: Partial<Settings>) => j<Run>("POST", `/api/projects/${pid}/fix`, { run, k, commentIds, settings }),
  continueFrom: (pid: string, run: string, k: number, instruction: string, settings?: Partial<Settings>) => j<Run>("POST", `/api/projects/${pid}/continue`, { run, k, instruction, settings }),
  exportPng: (pid: string, run: string, k: number, scale: number, name?: string, dest?: string) => j<{ files: { path: string; url: string }[] }>("POST", `/api/projects/${pid}/export`, { run, k, scale, name, dest }),
  upload: async (pid: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/projects/${pid}/upload`, { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d as { path: string; url: string };
  },
};

/** URL of a variant's file on the server. */
export const variantFile = (pid: string, rid: string, k: number, file: string) => `/files/${pid}/runs/${rid}/v${k}/${file}`;
