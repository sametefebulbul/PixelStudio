import { useState } from "react";
import type { Strings } from "../i18n";
import type { Comment } from "../types";
import type { Region } from "./PixelCanvas";

interface Props {
  s: Strings;
  comments: (Comment & { index: number })[];
  draft: Region | null;
  setDraft: (r: Region | null) => void;
  canComment: boolean;
  onAdd: (region: Region, text: string) => void;
  onPatch: (id: string, patch: Partial<Comment>) => void;
  onDelete: (id: string) => void;
  onApply: (ids: string[]) => void;
  busy: boolean;
}

/** Artifact-style region comments: select a box on the canvas, pin a note, apply open notes in one fix round. */
export function Comments({ s, comments, draft, setDraft, canComment, onAdd, onPatch, onDelete, onApply, busy }: Props) {
  const [text, setText] = useState("");
  const open = comments.filter((c) => c.status === "open");
  return (
    <div className="card">
      <h3>{s.comments} {open.length > 0 && <span className="chip warn">{open.length}</span>}</h3>
      {!canComment ? <div className="muted">{s.noRun}</div> : !draft ? <div className="muted">{s.commentHint}</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="muted mono">x {draft[0]}–{draft[2]}, y {draft[1]}–{draft[3]} ({draft[2] - draft[0] + 1}×{draft[3] - draft[1] + 1})</div>
          <textarea autoFocus rows={2} value={text} placeholder={s.commentPh} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) { onAdd(draft, text.trim()); setText(""); setDraft(null); } }} />
          <div className="row">
            <button className="btn primary sm" disabled={!text.trim()} onClick={() => { onAdd(draft, text.trim()); setText(""); setDraft(null); }}>{s.add}</button>
            <button className="btn sm ghost" onClick={() => setDraft(null)}>✕</button>
          </div>
        </div>
      )}
      {comments.map((c) => (
        <div key={c.id} className="cmt">
          <div className="hd">
            <span className={"pin " + c.status}>{c.index}</span>
            <span className="muted mono">{c.region[0]},{c.region[1]}–{c.region[2]},{c.region[3]}</span>
            <span className={"chip " + (c.status === "applied" ? "ok" : c.status === "rejected" ? "" : "warn")}>
              {c.status === "open" ? s.statusOpen : c.status === "applied" ? s.statusApplied : s.statusRejected}
            </span>
            <span style={{ flex: 1 }} />
            {c.status === "open" ? <button className="btn sm ghost" onClick={() => onPatch(c.id, { status: "rejected" })}>{s.reject}</button>
              : <button className="btn sm ghost" onClick={() => onPatch(c.id, { status: "open" })}>{s.reopen}</button>}
            <button className="btn sm ghost danger" onClick={() => onDelete(c.id)}>✕</button>
          </div>
          <div>{c.text}</div>
        </div>
      ))}
      {open.length > 0 && <button className="btn primary" disabled={busy} onClick={() => onApply(open.map((c) => c.id))}>{s.applyFixN(open.length)}</button>}
    </div>
  );
}
