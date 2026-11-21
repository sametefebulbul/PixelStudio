// Mirrors server/src/types.ts (kept separate so the web build has no server imports).
export type Route = "auto" | "variant" | "kitbash" | "draw" | "convert";
export type ProviderId = "claude-cli" | "opencode" | "anthropic-api" | "openai-api";

export interface Settings {
  size: number;
  palette: string;
  route: Route;
  provider: ProviderId;
  model: string;
  effort?: "low" | "medium" | "high";
  variants: number;
  seed: number;
  light: string;
  outline: "full" | "selective" | "none";
  shading: string;
  dither: boolean;
  tones: number;
  detail: "low" | "medium" | "high";
  maxToolCalls?: number; // agent budget (0 = unlimited); default 30
  maxMinutes?: number; // agent time budget (0 = unlimited); default 2
  maxRounds: number;
  negative: string;
  method?: "procedural" | "grid" | "hybrid";
  critic?: number;
  autoPick?: boolean;
  baseItem?: string;
  reference?: string;
}

export interface SpecPart {
  name: string;
  material: string;
  ramp?: string;
  shape?: string;
  where?: string;
}

export interface Spec {
  title: string;
  subject: string;
  size: number;
  route: Route;
  composition: string;
  parts: SpecPart[];
  details: string[];
  avoid: string[];
  palette: string;
  style: { light: string; outline: string; shading: string; dither: boolean; tones: number; detail: string };
  variantOps?: { src: number; dst: number; range?: number; sat?: number; region?: number[] | null }[];
  prompt: string;
}

export type VariantStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface Variant {
  k: number;
  status: VariantStatus;
  provider: ProviderId;
  model: string;
  seed: number;
  steps: number;
  score?: number;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  starred?: boolean;
  preCriticStep?: number; // step number of the version before the art-director fix pass (kept so a worse fix can be undone)
  rating?: number;
  note?: string;
  outsideChange?: { inside: number; outside: number };
}

export interface Run {
  id: string;
  projectId: string;
  kind: "draw" | "fix" | "variant";
  createdAt: number;
  settings: Settings;
  spec: Spec;
  parent?: { run: string; k: number };
  commentIds?: string[];
  variants: Variant[];
}

export interface Comment {
  id: string;
  runId: string;
  k: number;
  region: [number, number, number, number];
  text: string;
  status: "open" | "applied" | "rejected";
  createdAt: number;
  appliedIn?: string;
}

export interface Project {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  brief: string;
  settings: Settings;
  spec?: Spec;
  runs: string[];
  comments: Comment[];
}

export type AgentEvent =
  | { t: "status"; k: number; status: VariantStatus; error?: string; at?: number }
  | { t: "text"; k: number; text: string; at?: number }
  | { t: "thinking"; k: number; text: string; at?: number }
  | { t: "tool"; k: number; name: string; detail: string; at?: number }
  | { t: "tool_result"; k: number; ok: boolean; detail: string; at?: number }
  | { t: "step"; k: number; n: number; url: string; score?: number; lint?: string[]; at?: number }
  | { t: "final"; k: number; url: string; score?: number; at?: number }
  | { t: "warn"; k: number; text: string; at?: number };

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  ok: boolean;
  detail: string;
  models: { id: string; label: string; vision: boolean }[];
}

export interface Palette {
  name: string;
  outline: string;
  ramps: Record<string, string[]>;
  colors: Record<string, string>;
  note?: string;
}

export interface LibItem {
  name: string;
  path: string;
  group: string;
}
