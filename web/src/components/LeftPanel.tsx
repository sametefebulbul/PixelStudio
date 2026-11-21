import { SheetPanel } from "./SheetPanel";
import { api } from "../api";
import type { Strings } from "../i18n";
import type { LibItem, Palette, ProviderStatus, Settings } from "../types";

interface Props {
  s: Strings;
  pid: string;
  brief: string;
  setBrief: (v: string) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  providers: ProviderStatus[];
  palettes: Palette[];
  library: LibItem[];
  busy: boolean;
  onRefine: () => void;
  onConvert: () => void;
  onConvertPieces: (pieces: { path: string; label?: string; w: number; h: number }[]) => Promise<string | null>;
  lastConvertRun: string | null;
}

const SIZES = [16, 24, 32, 48, 64, 96, 128];
const LIGHTS = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

export function LeftPanel({ s, pid, brief, setBrief, settings, setSettings, providers, palettes, library, busy, onRefine, onConvert, onConvertPieces, lastConvertRun }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });
  const prov = providers.find((p) => p.id === settings.provider);
  const pal = palettes.find((p) => p.name === settings.palette);
  const model = prov?.models.find((m) => m.id === settings.model);

  return (
    <>
      <div className="card">
        <h3>{s.brief}</h3>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={s.briefPh} rows={5}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRefine(); }} />
        <label className="f">
          {s.negative}
          <input type="text" value={settings.negative} placeholder={s.negativePh} onChange={(e) => set("negative", e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !brief.trim()} onClick={onRefine}>{busy ? s.refining : s.toPrompt + "  ⌘↵"}</button>
      </div>

      <div className="card">
        <h3>{s.settings}</h3>
        <div className="grid2">
          <label className="f">
            {s.provider}
            <select value={settings.provider} onChange={(e) => {
              const p = providers.find((x) => x.id === e.target.value);
              setSettings({ ...settings, provider: e.target.value as Settings["provider"], model: p?.models[0]?.id ?? settings.model });
            }}>
              {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.ok}>{p.label}{p.ok ? "" : " ✕"}</option>)}
            </select>
          </label>
          <label className="f">
            {s.model}
            <select value={settings.model} onChange={(e) => set("model", e.target.value)}>
              {(prov?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          {model && <span className={"chip " + (model.vision ? "info" : "warn")}>{model.vision ? s.vision : s.blind}</span>}
          {settings.provider === "claude-cli" && (
            <>
              <span className="muted">{s.effort}</span>
              <span className="seg">
                {(["low", "medium", "high"] as const).map((e) => (
                  <button key={e} className={settings.effort === e ? "on" : ""} onClick={() => set("effort", e)}>{e}</button>
                ))}
              </span>
            </>
          )}
        </div>
        <div className="grid2">
          <label className="f">
            {s.size}
            <select value={settings.size} onChange={(e) => set("size", Number(e.target.value))}>
              {SIZES.map((n) => <option key={n} value={n}>{n}×{n}</option>)}
            </select>
          </label>
          <label className="f">
            {s.palette}
            <select value={settings.palette} onChange={(e) => set("palette", e.target.value)}>
              {palettes.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
        </div>
        {pal && (
          <div className="row" title={pal.note}>
            {Object.entries(pal.ramps).slice(0, 10).map(([name, tones]) => (
              <span key={name} className="ramp" title={name}>{tones.map((c) => <span key={c} style={{ background: c }} />)}</span>
            ))}
          </div>
        )}
        <label className="f">
          {s.method}
          <select value={settings.method ?? "hybrid"} onChange={(e) => set("method", e.target.value as Settings["method"])}>
            {Object.entries(s.methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="grid2">
          <label className="f">
            {s.critic}: {settings.critic ?? 0}
            <input type="range" min={0} max={3} value={settings.critic ?? 0} onChange={(e) => set("critic", Number(e.target.value))} />
          </label>
          <label className="chk" style={{ alignSelf: "end" }}><input type="checkbox" checked={settings.autoPick ?? false} onChange={(e) => set("autoPick", e.target.checked)} /> {s.autoPick}</label>
        </div>
        <label className="f">
          {s.route}
          <select value={settings.route} onChange={(e) => set("route", e.target.value as Settings["route"])}>
            {Object.entries(s.routes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="grid2">
          <label className="f">
            {s.variants}: {settings.variants}
            <input type="range" min={1} max={6} value={settings.variants} onChange={(e) => set("variants", Number(e.target.value))} />
          </label>
          <label className="f">
            {s.seed}
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input type="number" value={settings.seed} onChange={(e) => set("seed", Number(e.target.value))} />
              <button className="btn sm" title="random" onClick={() => set("seed", Math.floor(Math.random() * 99999))}>🎲</button>
            </div>
          </label>
          <label className="f">
            {s.light}
            <select value={settings.light} onChange={(e) => set("light", e.target.value)}>
              {LIGHTS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="f">
            {s.outline}
            <select value={settings.outline} onChange={(e) => set("outline", e.target.value as Settings["outline"])}>
              {Object.entries(s.outlines).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="f">
            {s.shading}
            <select value={settings.shading} onChange={(e) => set("shading", e.target.value)}>
              {Object.entries(s.shadings).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="f">
            {s.detail}
            <select value={settings.detail} onChange={(e) => set("detail", e.target.value as Settings["detail"])}>
              {Object.entries(s.details).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="f">
            {s.tones}: {settings.tones}
            <input type="range" min={3} max={5} value={settings.tones} onChange={(e) => set("tones", Number(e.target.value))} />
          </label>
          <label className="f">
            {s.rounds}: {settings.maxRounds}
            <input type="range" min={0} max={5} value={settings.maxRounds} onChange={(e) => set("maxRounds", Number(e.target.value))} />
          </label>
        </div>
        <label className="chk"><input type="checkbox" checked={settings.dither} onChange={(e) => set("dither", e.target.checked)} /> {s.dither}</label>
      </div>

      <div className="card">
        <h3>{s.base}</h3>
        <select value={settings.baseItem ?? ""} onChange={(e) => set("baseItem", e.target.value || undefined)}>
          <option value="">{s.baseNone}</option>
          {library.map((l) => <option key={l.path} value={l.path}>{l.group} / {l.name}</option>)}
        </select>
        {settings.baseItem && <img src={api.libraryImage(settings.baseItem)} style={{ width: 96, imageRendering: "pixelated", background: "#241b14", borderRadius: 6 }} />}
        <h3>{s.reference}</h3>
        <div className="row">
          <input type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = await api.upload(pid, f);
            setSettings({ ...settings, reference: r.path, route: settings.route === "auto" ? "convert" : settings.route });
          }} />
        </div>
        {settings.reference && (
          <div className="row">
            <img src={"/files/" + settings.reference.split("/projects/")[1]} style={{ width: 96, imageRendering: "pixelated", borderRadius: 6 }} />
            <button className="btn sm" onClick={() => set("reference", undefined)}>✕</button>
          </div>
        )}
        {settings.reference && (
          <>
            <label className="f">
              {s.convertRamps}
              <select value={settings.convertRamps ?? "auto"} onChange={(e) => set("convertRamps", e.target.value)}>
                <option value="auto">{s.rampsAuto}</option>
                <option value="none">{s.rampsNone}</option>
                <option value="stone,fire">stone + fire</option>
                <option value="stone,brass">stone + brass</option>
                <option value="stone,glass">stone + glass</option>
                <option value="stone,green">stone + green</option>
                <option value="stone,purple">stone + purple</option>
              </select>
            </label>
            <button className="btn primary" disabled={busy} onClick={onConvert} title={s.convertHint}>⚡ {s.convertNow}</button>
            <SheetPanel s={s} pid={pid} settings={settings} busy={busy} lastRun={lastConvertRun} onConvert={onConvertPieces} />
          </>
        )}
      </div>
    </>
  );
}
