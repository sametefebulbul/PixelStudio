import { useEffect, useRef, useState } from "react";
import type { Strings } from "../i18n";
import type { AgentEvent, Comment, Variant } from "../types";
import type { VariantView } from "../useRun";
import { PixelCanvas, type Region } from "./PixelCanvas";

interface Props {
  s: Strings;
  size: number;
  variant?: Variant;
  view?: VariantView;
  comments: (Comment & { index: number })[];
  draft: Region | null;
  setDraft: (r: Region | null) => void;
  onCancel?: () => void;
  showScript?: () => void;
  fallbackSrc?: string; // fix runs: show the parent image until the first new step arrives
}

/** Canvas + live step timeline + agent log for the selected variant. */
export function Stage({ s, size, variant, view, comments, draft, setDraft, onCancel, showScript, fallbackSrc }: Props) {
  const [zoom, setZoom] = useState(Math.max(4, Math.floor(512 / size)));
  const [grid, setGrid] = useState(true);
  const [bg, setBg] = useState<"dark" | "light" | "checker">("dark");
  const [stepSel, setStepSel] = useState<number | null>(null); // null = follow latest
  const [hover, setHover] = useState<[number, number] | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const steps = view?.steps ?? [];
  const running = variant?.status === "running" || variant?.status === "queued";

  useEffect(() => setZoom(Math.max(4, Math.floor(512 / size))), [size]);
  useEffect(() => setStepSel(null), [variant?.k]);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view?.log.length]);

  const shown = stepSel != null ? steps.find((x) => x.n === stepSel) : undefined;
  const src = shown?.url ?? view?.final ?? steps[steps.length - 1]?.url ?? fallbackSrc;
  const cur = shown ?? steps[steps.length - 1];

  return (
    <div className="stage">
      <div className="canvas-tools">
        <strong>{s.canvas}</strong>
        {variant && <span className={"chip " + (variant.status === "done" ? "ok" : variant.status === "error" ? "err" : running ? "warn" : "")}>{s.status[variant.status]}</span>}
        {variant && <span className="chip">{variant.model}</span>}
        {cur?.score != null && <span className="chip">{s.score} {cur.score}</span>}
        {variant?.outsideChange && variant.outsideChange.outside > 0 && <span className="chip warn">{s.outsideChanged(variant.outsideChange.outside)}</span>}
        <span style={{ flex: 1 }} />
        <span className="coords">{hover ? `x ${hover[0]}  y ${hover[1]}` : draft ? `${draft[0]},${draft[1]} → ${draft[2]},${draft[3]}` : ""}</span>
        <span className="seg">
          {[2, 4, 8, 12, 16].filter((z) => z * size <= 1100).map((z) => (
            <button key={z} className={zoom === z ? "on" : ""} onClick={() => setZoom(z)}>{z}×</button>
          ))}
        </span>
        <button className={"btn sm" + (grid ? " on" : "")} onClick={() => setGrid(!grid)}>{s.grid}</button>
        <span className="seg">
          {(["dark", "light", "checker"] as const).map((b) => (
            <button key={b} className={bg === b ? "on" : ""} onClick={() => setBg(b)}>{s.bgs[b]}</button>
          ))}
        </span>
        {showScript && variant?.status === "done" && <button className="btn sm" onClick={showScript}>{s.script}</button>}
        {running && onCancel && <button className="btn sm danger" onClick={onCancel}>{s.cancel}</button>}
      </div>

      <div className="canvas-wrap">
        {src ? (
          <PixelCanvas src={src} size={size} zoom={zoom} grid={grid} bg={bg} comments={comments} draft={draft}
            onSelect={(r) => setDraft(r)} onHover={setHover} />
        ) : (
          <div className="muted">{running ? s.drawing : s.noRun}</div>
        )}
      </div>

      {steps.length > 0 && (
        <div className="card">
          <h3>
            {s.steps} ({steps.length}) {running && <span className="dot run" />} {running && <span className="muted">{s.live}</span>}
            {stepSel != null && <button className="btn sm right" onClick={() => setStepSel(null)}>⏭ {s.live}</button>}
          </h3>
          {steps.length > 1 && (
            <input type="range" min={0} max={steps.length - 1} value={stepSel != null ? steps.findIndex((x) => x.n === stepSel) : steps.length - 1}
              onChange={(e) => setStepSel(steps[Number(e.target.value)].n)} />
          )}
          <div className="timeline">
            {steps.map((st) => (
              <div key={st.n} className={"st" + ((stepSel ?? steps[steps.length - 1].n) === st.n ? " on" : "")} onClick={() => setStepSel(st.n)}>
                <img src={st.url} />
                #{st.n}{st.score != null ? ` · ${st.score}` : ""}
              </div>
            ))}
          </div>
          {cur?.lint && <div className="muted mono">{cur.lint.filter((l) => !l.startsWith("STATS")).join("\n") || "OK"}</div>}
        </div>
      )}

      {view && view.log.length > 0 && (
        <details className="card" open={running}>
          <summary><strong>{s.log}</strong> <span className="muted">({view.log.length})</span></summary>
          <div className="log" ref={logRef}>
            {view.log.map((e, i) => <LogLine key={i} e={e} />)}
          </div>
        </details>
      )}
      {variant?.error && <div className="err-text">{variant.error}</div>}
    </div>
  );
}

function LogLine({ e }: { e: AgentEvent }) {
  switch (e.t) {
    case "text": return <div className="e">{e.text}</div>;
    case "thinking": return <div className="e think">💭 {e.text}</div>;
    case "tool": return <div className="e tool">▶ {e.name}: {e.detail}</div>;
    case "tool_result": return <div className={"e res" + (e.ok ? "" : " bad")}>{e.ok ? "✓" : "✕"} {e.detail}</div>;
    case "step": return <div className="e step">◆ step {e.n}{e.score != null ? ` · lint ${e.score}` : ""}</div>;
    case "warn": return <div className="e warn">⚠ {e.text}</div>;
    case "status": return <div className="e res">— {e.status}{e.error ? ": " + e.error : ""}</div>;
    default: return null;
  }
}
