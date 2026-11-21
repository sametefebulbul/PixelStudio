export type Route = "auto" | "variant" | "kitbash" | "draw" | "convert";
export type ProviderId = "claude-cli" | "opencode" | "anthropic-api" | "openai-api";

export interface Settings {
  size: number; // 16..64
  palette: string; // palette name in engine/assets/palettes
  route: Route;
  provider: ProviderId;
  model: string; // e.g. "sonnet", "opencode-go/glm-5.3", "claude-sonnet-5-5", "gpt-..."
  effort?: "low" | "medium" | "high";
  variants: number; // 1..6
  seed: number;
  light: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
  outline: "full" | "selective" | "none";
  shading: "auto" | "form" | "cyl" | "bevel" | "flat";
  dither: boolean;
  tones: number; // 3..5 per material
  detail: "low" | "medium" | "high";
  maxToolCalls?: number; // agent budget (0 = unlimited); default 45 for non-Claude providers
  maxMinutes?: number; // agent time budget (0 = unlimited); default 10 for non-Claude providers
  maxRounds: number; // fix rounds 0..5
  negative: string; // things to avoid
  method?: "procedural" | "grid" | "hybrid"; // how the artist works (see engine SKILL.md)
  critic?: number; // automatic art-director rounds after the first version (0..3)
  autoPick?: boolean; // let a vision model star the best variation when all are done
  baseItem?: string; // path to an existing sprite (variant / kitbash routes)
  reference?: string; // uploaded reference image path (convert route)
}

export interface SpecPart {
  name: string;
  material: string;
  ramp?: string;
  shape?: string;
  where?: string;
}

export interface VariantOp {
  src: number;
  dst: number;
  range?: number;
  sat?: number;
  region?: [number, number, number, number] | null;
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
  variantOps?: VariantOp[];
  prompt: string; // the full drawing prompt the drawer receives (user-editable)
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
  rating?: number; // 1..5 given by the user (the real judge)
  note?: string;
  outsideChange?: { inside: number; outside: number }; // fix runs: pixels changed outside commented regions
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
  region: [number, number, number, number]; // x0,y0,x1,y1 in sprite pixels, inclusive
  text: string;
  status: "open" | "applied" | "rejected";
  createdAt: number;
  appliedIn?: string; // run id
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
  | { t: "status"; k: number; status: VariantStatus; error?: string }
  | { t: "text"; k: number; text: string }
  | { t: "thinking"; k: number; text: string }
  | { t: "tool"; k: number; name: string; detail: string }
  | { t: "tool_result"; k: number; ok: boolean; detail: string }
  | { t: "step"; k: number; n: number; url: string; score?: number; lint?: string[] }
  | { t: "final"; k: number; url: string; score?: number }
  | { t: "warn"; k: number; text: string };

export const DEFAULT_SETTINGS: Settings = {
  size: 48,
  palette: "studio",
  route: "auto",
  provider: "claude-cli",
  model: "sonnet",
  effort: "medium",
  variants: 3,
  seed: 1,
  light: "nw",
  outline: "full",
  shading: "auto",
  dither: false,
  tones: 4,
  detail: "medium",
  maxRounds: 3,
  negative: "",
  method: "hybrid",
  critic: 0, // measured: the fix pass often made DeepSeek sprites worse; opt-in, the pre-critic version stays selectable
  autoPick: true,
};
