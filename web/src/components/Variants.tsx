import { useState } from "react";
import type { Strings } from "../i18n";
import type { Run } from "../types";
import type { VariantView } from "../useRun";

interface Props {
  s: Strings;
  run: Run;
  views: Record<number, VariantView>;
  selected: number;
  setSelected: (k: number) => void;
  onStar: (k: number) => void;
  onContinue: (k: number, instruction: string) => void;
  onRate: (k: number, rating: number, note?: string) => void;
}

const img = (v?: VariantView) => v?.final ?? v?.steps[v.steps.length - 1]?.url;

/** Variation grid + compare (side by side / swipe) + "continue from this". */
export function Variants({ s, run, views, selected, setSelected, onStar, onContinue, onRate }: Props) {
  const [cmp, setCmp] = useState<number[]>([]);
  const [mode, setMode] = useState<"side" | "swipe">("side");
  const [swipe, setSwipe] = useState(50);
  const [instr, setInstr] = useState("");
  const [note, setNote] = useState("");
  const toggleCmp = (k: number) => setCmp((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k].slice(-2)));
  const a = cmp[0], b = cmp[1];

  return (
    <div className="card">
      <h3>{s.variantsTitle} <span className="chip">{s.runKinds[run.kind]}</span></h3>
      <div className="vgrid">
        {run.variants.map((v) => (
          <div key={v.k} className={"vcell" + (v.k === selected ? " on" : "") + (cmp.includes(v.k) ? " cmp" : "")}
            onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? toggleCmp(v.k) : setSelected(v.k))}>
            <button className={"starbtn" + (v.starred ? " on" : "")} title={s.star} onClick={(e) => { e.stopPropagation(); onStar(v.k); }}>★</button>
            <div className="thumb">{img(views[v.k]) ? <img src={img(views[v.k])} /> : <span className={"dot" + (v.status === "running" ? " run" : "")} />}</div>
            <div className="meta">
              <span>#{v.k + 1}</span>
              <span className={v.status === "done" ? "" : v.status === "error" ? "err-text" : ""}>{v.status === "done" ? (v.rating ? "★".repeat(v.rating) : `${s.score} ${v.score ?? "–"}`) : s.status[v.status]}</span>
            </div>
          </div>
        ))}
      </div>
      {run.variants.length > 1 && <div className="muted">{s.compareHint}</div>}
      {a != null && b != null && (
        <>
          <div className="row">
            <strong>{s.compare}</strong>
            <span className="seg">
              <button className={mode === "side" ? "on" : ""} onClick={() => setMode("side")}>{s.compareSide}</button>
              <button className={mode === "swipe" ? "on" : ""} onClick={() => setMode("swipe")}>{s.compareSwipe}</button>
            </span>
            <button className="btn sm ghost" onClick={() => setCmp([])}>✕</button>
          </div>
          {mode === "side" ? (
            <div className="cmp-view">
              {[a, b].map((k) => <div key={k} className="pane"><img src={img(views[k])} />#{k + 1} · {s.score} {run.variants[k].score ?? "–"}</div>)}
            </div>
          ) : (
            <>
              <div className="swipe">
                <img src={img(views[b])} />
                <div className="top" style={{ clipPath: `inset(0 ${100 - swipe}% 0 0)` }}><img src={img(views[a])} /></div>
                <div className="bar" style={{ left: swipe + "%" }} />
              </div>
              <input type="range" min={0} max={100} value={swipe} onChange={(e) => setSwipe(Number(e.target.value))} />
              <div className="row muted"><span>#{a + 1}</span><span style={{ flex: 1 }} /><span>#{b + 1}</span></div>
            </>
          )}
        </>
      )}
      {run.variants[selected]?.status === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="row">
            <span className="muted">{s.rate} #{selected + 1}</span>
            <span className="seg">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={run.variants[selected].rating === n ? "on" : ""} onClick={() => { onRate(selected, n, note || undefined); setNote(""); }}>{n}</button>
              ))}
            </span>
          </div>
          <input type="text" value={note} placeholder={s.ratePh} onChange={(e) => setNote(e.target.value)} />
          <textarea rows={2} value={instr} placeholder={s.contPh} onChange={(e) => setInstr(e.target.value)} />
          <button className="btn" onClick={() => { onContinue(selected, instr); setInstr(""); }}>↻ {s.cont} (#{selected + 1})</button>
        </div>
      )}
    </div>
  );
}
