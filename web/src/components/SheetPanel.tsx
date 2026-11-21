import { useState } from "react";
import { api } from "../api";
import type { Strings } from "../i18n";
import type { Settings } from "../types";

interface Piece { file: string; w: number; h: number; area: number; path: string; url: string }
const ROLES = ["", "south", "north", "east", "west"] as const;

interface Props {
  s: Strings;
  pid: string;
  settings: Settings;
  busy: boolean;
  /** run id of the latest piece conversion (to build the character pack from) */
  lastRun: string | null;
  onConvert: (pieces: { path: string; label?: string; w: number; h: number }[]) => Promise<string | null>;
}

/** Sprite / character sheet: split into pieces, convert them at one common scale, assign directions, export a character pack. */
export function SheetPanel({ s, pid, settings, busy, lastRun, onConvert }: Props) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [on, setOn] = useState<Record<number, boolean>>({});
  const [role, setRole] = useState<Record<number, string>>({});
  const [name, setName] = useState("character");
  const [dest, setDest] = useState("");
  const [mirror, setMirror] = useState(true);
  const [err, setErr] = useState("");
  const [files, setFiles] = useState<{ name: string; url: string }[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [order, setOrder] = useState<number[]>([]); // piece index -> variant k in the last run

  async function split() {
    setErr("");
    try {
      const r = await api.split(pid, settings.reference!);
      setPieces(r.pieces);
      setOn(Object.fromEntries(r.pieces.map((p, i) => [i, p.area >= 0.02])));
      setRole({});
      setFiles([]);
    } catch (e) {
      setErr(String(e));
    }
  }
  async function convert() {
    const idx = pieces.map((_, i) => i).filter((i) => on[i]);
    const id = await onConvert(idx.map((i) => ({ path: pieces[i].path, label: role[i] || `#${i + 1}`, w: pieces[i].w, h: pieces[i].h })));
    if (id) {
      setRunId(id);
      setOrder(idx);
    }
  }
  async function pack() {
    setErr("");
    const rid = runId ?? lastRun;
    if (!rid) return;
    const roles: Record<string, string> = {};
    order.forEach((pi, k) => role[pi] && (roles[String(k)] = role[pi]));
    try {
      const r = await api.character(pid, { run: rid, name, roles, mirror, dest: dest || undefined });
      setFiles(r.files);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="sheetpanel">
      <h3>{s.sheetTitle}</h3>
      <button className="btn sm" disabled={busy} onClick={split}>✂ {s.sheetSplit}</button>
      {pieces.length > 0 && (
        <>
          <div className="muted">{s.sheetHint}</div>
          <div className="pieces">
            {pieces.map((p, i) => (
              <div key={p.file} className={"piece" + (on[i] ? " on" : "")}>
                <label className="row">
                  <input type="checkbox" checked={!!on[i]} onChange={(e) => setOn({ ...on, [i]: e.target.checked })} />
                  <span className="muted">{p.w}×{p.h}</span>
                </label>
                <img src={p.url} style={{ maxWidth: 88, maxHeight: 88, background: "#241b14", borderRadius: 4 }} />
                <select value={role[i] ?? ""} onChange={(e) => setRole({ ...role, [i]: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r ? s.roles[r] : s.roles.none}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button className="btn primary" disabled={busy || !Object.values(on).some(Boolean)} onClick={convert}>⚡ {s.sheetConvert}</button>
        </>
      )}
      {(runId ?? lastRun) && order.length > 0 && (
        <div className="charpack">
          <h3>{s.charTitle}</h3>
          <div className="muted">{s.charHint}</div>
          <label className="f">{s.charName}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="f">{s.charDest}<input value={dest} placeholder="/home/…/assets/npc" onChange={(e) => setDest(e.target.value)} /></label>
          <label className="row"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> {s.charMirror}</label>
          <button className="btn primary" disabled={busy || !Object.values(role).some(Boolean)} onClick={pack}>📦 {s.charPack}</button>
          {files.length > 0 && (
            <div className="muted">{files.map((f) => <div key={f.name}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></div>)}</div>
          )}
        </div>
      )}
      {err && <div className="err-text">{err}</div>}
    </div>
  );
}
