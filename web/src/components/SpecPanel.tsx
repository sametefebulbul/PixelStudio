import { useState } from "react";
import type { Strings } from "../i18n";
import type { Spec } from "../types";

interface Props {
  s: Strings;
  spec: Spec | null;
  setSpec: (s: Spec) => void;
  busy: boolean;
  onDraw: () => void;
  variants: number;
}

/** Preview + edit of the refined prompt before drawing ("onaylarsam çiz"). */
export function SpecPanel({ s, spec, setSpec, busy, onDraw, variants }: Props) {
  const [tab, setTab] = useState<"form" | "raw">("form");
  const [raw, setRaw] = useState("");
  const [rawErr, setRawErr] = useState("");
  if (!spec) return <div className="card"><h3>{s.spec}</h3><div className="muted">{s.specEmpty}</div></div>;
  const upd = (patch: Partial<Spec>) => setSpec({ ...spec, ...patch });
  const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="card">
      <h3>
        {s.spec}
        <span className="chip">{s.routes[spec.route]}</span>
        <span className="chip">{spec.size}×{spec.size}</span>
        <span className="right seg">
          <button className={tab === "form" ? "on" : ""} onClick={() => setTab("form")}>Form</button>
          <button className={tab === "raw" ? "on" : ""} onClick={() => { setRaw(JSON.stringify(spec, null, 2)); setTab("raw"); }}>{s.specRaw}</button>
        </span>
      </h3>
      {tab === "form" ? (
        <>
          <input type="text" value={spec.title} onChange={(e) => upd({ title: e.target.value })} />
          <label className="f">
            {s.specPrompt}
            <textarea className="mono" rows={9} value={spec.prompt} onChange={(e) => upd({ prompt: e.target.value })} />
          </label>
          <details>
            <summary className="muted">{s.specParts} ({spec.parts.length}) · {s.specDetails} · {s.specAvoid}</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <label className="f">{s.composition}<input type="text" value={spec.composition} onChange={(e) => upd({ composition: e.target.value })} /></label>
              {spec.parts.map((p, i) => (
                <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="text" style={{ maxWidth: 110 }} value={p.name} onChange={(e) => { const parts = [...spec.parts]; parts[i] = { ...p, name: e.target.value }; upd({ parts }); }} />
                  <input type="text" style={{ maxWidth: 90 }} value={p.ramp ?? p.material} onChange={(e) => { const parts = [...spec.parts]; parts[i] = { ...p, ramp: e.target.value }; upd({ parts }); }} />
                  <input type="text" value={[p.shape, p.where].filter(Boolean).join(" · ")} onChange={(e) => { const parts = [...spec.parts]; parts[i] = { ...p, shape: e.target.value, where: "" }; upd({ parts }); }} />
                </div>
              ))}
              <label className="f">{s.specDetails}<textarea rows={3} value={spec.details.join("\n")} onChange={(e) => upd({ details: lines(e.target.value) })} /></label>
              <label className="f">{s.specAvoid}<textarea rows={2} value={spec.avoid.join("\n")} onChange={(e) => upd({ avoid: lines(e.target.value) })} /></label>
            </div>
          </details>
        </>
      ) : (
        <>
          <textarea className="mono" rows={16} value={raw} onChange={(e) => {
            setRaw(e.target.value);
            try { setSpec(JSON.parse(e.target.value)); setRawErr(""); } catch (err) { setRawErr(String(err)); }
          }} />
          {rawErr && <div className="err-text">{rawErr}</div>}
        </>
      )}
      <button className="btn primary" disabled={busy || !spec.prompt.trim()} onClick={onDraw}>
        {busy ? s.drawing : `${s.draw} · ${variants}×`}
      </button>
    </div>
  );
}
