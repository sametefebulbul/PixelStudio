import { useEffect, useState } from "react";
import { api, variantFile } from "../api";
import type { Strings } from "../i18n";
import type { ProviderStatus, Run } from "../types";

export function History({ s, pid, runs, current, onPick }: { s: Strings; pid: string; runs: Run[]; current: string | null; onPick: (rid: string, k?: number) => void }) {
  if (!runs.length) return null;
  return (
    <div className="card">
      <h3>{s.history} <span className="chip">{runs.length}</span></h3>
      <div className="hist">
        {runs.map((r) => {
          const best = r.variants.find((v) => v.starred) ?? r.variants.find((v) => v.status === "done") ?? r.variants[0];
          return (
            <div key={r.id} className={"h" + (r.id === current ? " on" : "")} onClick={() => onPick(r.id, best?.k)}>
              <img src={best && best.status === "done" ? variantFile(pid, r.id, best.k, "final.png") : undefined} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.spec.title}</div>
                <div className="muted">{s.runKinds[r.kind]} · {r.variants.length}× · {new Date(r.createdAt).toLocaleTimeString()}</div>
              </div>
              {r.variants.some((v) => v.status === "running" || v.status === "queued") && <span className="dot run" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ExportBox({ s, pid, run, k }: { s: Strings; pid: string; run: Run; k: number }) {
  const [scale, setScale] = useState(1);
  const [dest, setDest] = useState("");
  const [files, setFiles] = useState<{ path: string; url: string }[]>([]);
  const [err, setErr] = useState("");
  if (run.variants[k]?.status !== "done") return null;
  return (
    <div className="card">
      <h3>{s.export}</h3>
      <div className="row">
        <span className="muted">{s.scale}</span>
        <span className="seg">{[1, 2, 4, 8].map((n) => <button key={n} className={scale === n ? "on" : ""} onClick={() => setScale(n)}>{n}×</button>)}</span>
      </div>
      <input type="text" placeholder={s.exportTo} value={dest} onChange={(e) => setDest(e.target.value)} />
      <button className="btn" onClick={async () => {
        setErr("");
        try {
          const r = await api.exportPng(pid, run.id, k, scale, run.spec.title, dest || undefined);
          setFiles(r.files);
        } catch (e) { setErr(String(e)); }
      }}>⬇ {s.export}</button>
      {files.map((f) => <a key={f.path} href={f.url} download>{f.path.split("/").pop()}</a>)}
      {err && <div className="err-text">{err}</div>}
    </div>
  );
}

export function ProvidersModal({ s, providers, python, onClose, onSaved }: { s: Strings; providers: ProviderStatus[]; python?: { ok: boolean; detail: string }; onClose: () => void; onSaved: () => void }) {
  const [keys, setKeys] = useState({ anthropicKey: "", openaiKey: "", openaiBaseUrl: "", openaiModels: "" });
  useEffect(() => { api.settings().then((k) => setKeys(k)); }, []);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>{s.providers}</h3>
        <div className="row"><span className={"dot " + (python?.ok ? "ok" : "err")} /> Python engine — <span className="muted">{python?.detail}</span></div>
        {providers.map((p) => (
          <div key={p.id} className="row"><span className={"dot " + (p.ok ? "ok" : "err")} /> <strong>{p.label}</strong> <span className="muted">{p.detail}</span></div>
        ))}
        <h3 style={{ margin: 0 }}>{s.apiKeys}</h3>
        <label className="f">Anthropic API key<input type="password" value={keys.anthropicKey} onChange={(e) => setKeys({ ...keys, anthropicKey: e.target.value })} /></label>
        <label className="f">OpenAI-compatible API key<input type="password" value={keys.openaiKey} onChange={(e) => setKeys({ ...keys, openaiKey: e.target.value })} /></label>
        <label className="f">Base URL<input type="text" value={keys.openaiBaseUrl} onChange={(e) => setKeys({ ...keys, openaiBaseUrl: e.target.value })} /></label>
        <label className="f">Models (comma separated)<input type="text" value={keys.openaiModels} onChange={(e) => setKeys({ ...keys, openaiModels: e.target.value })} /></label>
        <div className="muted">Keys are stored locally in ~/.pixel-studio/settings.json (mode 600) and only sent to the provider you choose.</div>
        <div className="row">
          <button className="btn primary" onClick={async () => { await api.saveSettings(keys); onSaved(); onClose(); }}>{s.save}</button>
          <button className="btn" onClick={onClose}>{s.close}</button>
        </div>
      </div>
    </div>
  );
}

export function ScriptModal({ s, text, onClose }: { s: Strings; text: string; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: "min(820px,94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="row"><strong>draw.py</strong><span style={{ flex: 1 }} /><button className="btn sm" onClick={() => navigator.clipboard.writeText(text)}>Copy</button><button className="btn sm" onClick={onClose}>{s.close}</button></div>
        <pre className="code">{text}</pre>
      </div>
    </div>
  );
}
