import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, variantFile } from "./api";
import { Comments } from "./components/Comments";
import { ExportBox, History, ProvidersModal, ScriptModal } from "./components/Extras";
import { LeftPanel } from "./components/LeftPanel";
import type { Region } from "./components/PixelCanvas";
import { SpecPanel } from "./components/SpecPanel";
import { Stage } from "./components/Stage";
import { Variants } from "./components/Variants";
import { STRINGS } from "./i18n";
import type { LibItem, Palette, Project, ProviderStatus, Run, Settings, Spec } from "./types";
import { useRun } from "./useRun";

const LS = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
  return null;
};

export default function App() {
  const [lang, setLang] = useState<"tr" | "en">((LS("ps.lang") as "tr" | "en") || (navigator.language.startsWith("tr") ? "tr" : "en"));
  const [theme, setTheme] = useState<"dark" | "light">((LS("ps.theme") as "dark" | "light") || "dark");
  const s = STRINGS[lang];
  const [status, setStatus] = useState<{ python?: { ok: boolean; detail: string }; providers: ProviderStatus[] }>({ providers: [] });
  const [palettes, setPalettes] = useState<Palette[]>([]);
  const [library, setLibrary] = useState<LibItem[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string; updatedAt: number; runs: number }[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [brief, setBrief] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [rid, setRid] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [draft, setDraft] = useState<Region | null>(null);
  const [busy, setBusy] = useState<"" | "refine" | "draw" | "convert">("");
  const [err, setErr] = useState("");
  const [modal, setModal] = useState<"" | "providers" | "script">("");
  const [scriptText, setScriptText] = useState("");
  const pid = project?.id ?? null;
  const { run, views } = useRun(pid, rid);

  useEffect(() => { document.documentElement.dataset.theme = theme; LS("ps.theme", theme); }, [theme]);
  useEffect(() => { LS("ps.lang", lang); }, [lang]);
  const loadStatus = useCallback(() => api.status().then(setStatus).catch(() => {}), []);
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return; // StrictMode runs effects twice in dev: boot once
    booted.current = true;
    loadStatus();
    api.palettes().then(setPalettes);
    api.library().then(setLibrary);
    api.projects().then(async (ps) => {
      setProjects(ps);
      const last = LS("ps.project");
      const id = ps.find((p) => p.id === last)?.id ?? ps[0]?.id;
      if (id) openProject(id);
      else newProject();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openProject(id: string) {
    const { project: p, runs: rs } = await api.project(id);
    setProject(p);
    setRuns(rs);
    setBrief(p.brief);
    setSettings(p.settings);
    setSpec(p.spec ?? null);
    setRid(rs[0]?.id ?? null);
    setSel(0);
    setDraft(null);
    LS("ps.project", id);
  }
  async function newProject() {
    const p = await api.createProject(s.untitled, settings ?? undefined);
    setProjects(await api.projects());
    await openProject(p.id);
  }
  const reloadProject = useCallback(async () => {
    if (!pid) return;
    const { project: p, runs: rs } = await api.project(pid);
    setProject(p);
    setRuns(rs);
  }, [pid]);
  // keep run list fresh while something is running
  useEffect(() => {
    if (!run) return;
    const t = setTimeout(reloadProject, 300);
    return () => clearTimeout(t);
  }, [run, reloadProject]);

  // Runs started from elsewhere (API, another tab) show up without F5: poll the run list and follow a newer run.
  const topRun = useRef<string | null>(null);
  useEffect(() => { topRun.current = runs[0]?.id ?? null; }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pid) return;
    const t = setInterval(async () => {
      try {
        const { project: p, runs: rs } = await api.project(pid);
        setProject(p);
        setRuns(rs);
        const top = rs[0]?.id ?? null;
        if (top && top !== topRun.current) {
          topRun.current = top;
          setRid(top);
          setSel(0);
          setDraft(null);
        }
      } catch {
        /* server restarting */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [pid]);

  // persist edits (debounced)
  useEffect(() => {
    if (!pid || !settings) return;
    const t = setTimeout(() => api.patchProject(pid, { brief, settings, ...(spec ? { spec } : {}) }), 600);
    return () => clearTimeout(t);
  }, [pid, brief, settings, spec]);

  async function refine() {
    if (!pid || !settings) return;
    setBusy("refine");
    setErr("");
    try {
      const sp = await api.refine(pid, brief, settings);
      setSpec(sp);
      if (project?.title === s.untitled || project?.title === "Untitled" || project?.title === "Adsız") {
        await api.patchProject(pid, { title: sp.title });
        setProjects(await api.projects());
        reloadProject();
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }
  async function convertNow() {
    if (!pid || !settings) return;
    setBusy("convert");
    setErr("");
    try {
      const r = await api.convert(pid, settings);
      setRid(r.id);
      setSel(0);
      setDraft(null);
      await reloadProject();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }
  async function draw() {
    if (!pid || !settings || !spec) return;
    setBusy("draw");
    setErr("");
    try {
      const r = await api.startRun(pid, spec, { ...settings, size: spec.size });
      setRid(r.id);
      setSel(0);
      setDraft(null);
      await reloadProject();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }

  const comments = useMemo(() => {
    if (!project || !rid) return [];
    return project.comments.filter((c) => c.runId === rid && c.k === sel).map((c, i) => ({ ...c, index: i + 1 }));
  }, [project, rid, sel]);
  const variant = run?.variants[sel];
  const size = run?.spec.size ?? spec?.size ?? settings?.size ?? 48;

  if (!settings) return <div className="app"><div className="topbar"><span className="brand"><span className="logo" />{s.appName}</span></div></div>;

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand"><span className="logo" />{s.appName}</span>
        <select style={{ width: 220 }} value={pid ?? ""} onChange={(e) => openProject(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.runs})</option>)}
        </select>
        <button className="btn sm" onClick={newProject}>+ {s.newProject}</button>
        <span className="spacer" />
        {err && <span className="err-text" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={err}>{err}</span>}
        <button className="btn sm" onClick={() => { loadStatus(); setModal("providers"); }}>
          {status.providers.map((p) => <span key={p.id} className={"dot " + (p.ok ? "ok" : "err")} style={{ marginRight: 3 }} title={p.label} />)} {s.providers}
        </button>
        <button className="btn sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button>
        <button className="btn sm" onClick={() => setLang(lang === "tr" ? "en" : "tr")}>{s.lang}</button>
      </div>

      <div className="main">
        <div className="col left">
          {pid && <LeftPanel s={s} pid={pid} brief={brief} setBrief={setBrief} settings={settings} setSettings={setSettings}
            providers={status.providers} palettes={palettes} library={library} busy={busy === "refine" || busy === "convert"} onRefine={refine} onConvert={convertNow} />}
        </div>

        <div className="col">
          <SpecPanel s={s} spec={spec} setSpec={setSpec} busy={busy === "draw"} onDraw={draw} variants={settings.variants} />
          <Stage s={s} size={size} variant={variant} view={views[sel]} comments={comments} draft={draft} setDraft={setDraft}
            onCancel={pid && rid ? () => api.cancel(pid, rid, sel) : undefined}
            showScript={pid && rid ? async () => { setScriptText(await api.script(pid, rid, sel)); setModal("script"); } : undefined}
            fallbackSrc={pid && run?.parent ? variantFile(pid, run.parent.run, run.parent.k, "final.png") : undefined} />
        </div>

        <div className="col right">
          {run && pid && (
            <Variants s={s} run={run} views={views} selected={sel} setSelected={(k) => { setSel(k); setDraft(null); }}
              onStar={async (k) => { await api.star(pid, run.id, k); reloadProject(); }}
              onRate={async (k, rating, note) => { await api.rate(pid, run.id, k, rating, note); reloadProject(); }}
              onContinue={async (k, instruction) => { const r = await api.continueFrom(pid, run.id, k, instruction); setRid(r.id); setSel(0); reloadProject(); }} />
          )}
          {pid && (
            <Comments s={s} comments={comments} draft={draft} setDraft={setDraft} canComment={variant?.status === "done"} busy={false}
              onAdd={async (region, text) => { if (!rid) return; await api.addComment(pid, { runId: rid, k: sel, region, text }); reloadProject(); }}
              onPatch={async (id, patch) => { await api.patchComment(pid, id, patch); reloadProject(); }}
              onDelete={async (id) => { await api.deleteComment(pid, id); reloadProject(); }}
              onApply={async (ids) => { if (!rid) return; const r = await api.fix(pid, rid, sel, ids); setRid(r.id); setSel(0); setDraft(null); reloadProject(); }} />
          )}
          {run && pid && <ExportBox s={s} pid={pid} run={run} k={sel} />}
          {pid && <History s={s} pid={pid} runs={runs} current={rid} onPick={(id, k) => { setRid(id); setSel(k ?? 0); setDraft(null); }} />}
        </div>
      </div>

      {modal === "providers" && <ProvidersModal s={s} providers={status.providers} python={status.python} onClose={() => setModal("")} onSaved={loadStatus} />}
      {modal === "script" && <ScriptModal s={s} text={scriptText} onClose={() => setModal("")} />}
    </div>
  );
}
