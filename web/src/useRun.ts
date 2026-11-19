import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AgentEvent, Run } from "./types";

export interface StepView {
  n: number;
  url: string;
  score?: number;
  lint?: string[];
  at?: number;
}

export interface VariantView {
  steps: StepView[];
  log: AgentEvent[];
  final?: string;
}

/** Live state of one run: replays events.jsonl over SSE, then streams new events. */
export function useRun(pid: string | null, rid: string | null) {
  const [run, setRun] = useState<Run | null>(null);
  const [views, setViews] = useState<Record<number, VariantView>>({});
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setViews({});
    setRun(null);
    if (!pid || !rid) return;
    let alive = true;
    api.run(pid, rid).then((r) => alive && setRun(r));
    const es = new EventSource(`/api/projects/${pid}/runs/${rid}/events`);
    esRef.current = es;
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as AgentEvent;
      if (!("k" in e)) return;
      setViews((prev) => {
        const v: VariantView = prev[e.k] ? { ...prev[e.k] } : { steps: [], log: [] };
        if (e.t === "step") {
          if (!v.steps.some((s) => s.n === e.n)) v.steps = [...v.steps, { n: e.n, url: e.url, score: e.score, lint: e.lint, at: e.at }].sort((a, b) => a.n - b.n);
          v.log = [...v.log, e];
        } else if (e.t === "final") {
          v.final = e.url;
        } else {
          v.log = [...v.log, e];
        }
        return { ...prev, [e.k]: v };
      });
      if (e.t === "status" || e.t === "final") api.run(pid, rid).then((r) => alive && setRun(r));
    };
    return () => {
      alive = false;
      es.close();
    };
  }, [pid, rid]);

  return { run, views, refresh: () => pid && rid && api.run(pid, rid).then(setRun) };
}
