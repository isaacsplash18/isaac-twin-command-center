"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";

type Scope = "once" | "always" | "unspecified";
interface TrainingExample {
  id: string;
  topic: string;
  platform: string;
  previousText: string;
  newText: string;
  reason: string;
  scope: Scope;
  usedInDrafts: number;
}
interface TrainingRun {
  id: string;
  routine: string;
  platform: string;
  createdAt: string;
  draftId: string;
  feedbackIds: string[];
  preferenceIds?: string[];
  sourcePages?: {id:string;revision:string|null}[];
  feedbackCutoff?: string;
}
interface TrainingData {
  examples: TrainingExample[];
  runs: TrainingRun[];
  metrics: {
    reviewed: number;
    untouchedApprovalRate: number | null;
    editedApprovalRate: number | null;
    rejectionRate: number | null;
    averageEditPercent: number | null;
  };
  perPlatform?: Record<string,TrainingData["metrics"]>;
  warnings: string[];
}

const fieldClass = "w-full rounded-lg border border-hairline-faint bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-oxbright focus:ring-2 focus:ring-oxbright/15";
const showRate = (value: number | null) => value == null ? "—" : `${Math.round(value * 100)}%`;

/** Reports recorded routine usage and feedback; it does not imply model retraining. */
export function TrainingProgressPanel({ index }: { index: number }) {
  const { data, error, loading, setData, refresh } = useApi<TrainingData>("/api/training", 120_000);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const save = async (example: TrainingExample, reason: string, scope: Scope) => {
    setBusyId(example.id);
    setNotice("");
    try {
      const response = await fetch(`/api/training/examples/${encodeURIComponent(example.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);
      setData((current) => current ? {
        ...current,
        examples: current.examples.map((item) => item.id === example.id ? { ...item, reason, scope } : item),
      } : current);
      setNotice("Feedback preference saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save feedback preference.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <FrameCard index={index} className="p-4 sm:p-5">
      <h2 className="panel-heading">Training progress</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-dim">
        Recorded routine activity and review outcomes. These reports do not mean the underlying model was retrained.
      </p>

      {loading && !data && <p className="mt-4 text-sm text-ink-dim" role="status">Loading training activity…</p>}
      {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-oxbright">
        <span>Could not load training activity: {error}</span>
        <button type="button" className="btn btn-secondary" onClick={() => refresh()} disabled={loading}>{loading ? "Retrying…" : "Retry"}</button>
      </div>}

      {data && <>
        <section aria-labelledby="training-metrics" className="mt-5">
          <h3 id="training-metrics" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Reported review metrics</h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Reviewed" value={String(data.metrics.reviewed)} />
            <Metric label="Untouched approval" value={showRate(data.metrics.untouchedApprovalRate)} />
            <Metric label="Edited approval" value={showRate(data.metrics.editedApprovalRate)} />
            <Metric label="Rejection" value={showRate(data.metrics.rejectionRate)} />
            <Metric label="Average edit" value={data.metrics.averageEditPercent == null ? "—" : `${Math.round(data.metrics.averageEditPercent)}%`} />
          </dl>
        </section>

        {data.warnings.length > 0 && <section aria-label="Training report warnings" className="mt-4 rounded-lg border border-amber/30 bg-amber/5 p-3">
          <h3 className="text-sm font-semibold text-ink">Report notes</h3>
          <ul className="mt-1 list-inside list-disc space-y-1 text-[13px] text-ink-dim">{data.warnings.map((warning, i) => <li key={`${i}-${warning}`}>{warning}</li>)}</ul>
        </section>}

        {data.perPlatform && <details className="mt-3 text-sm"><summary className="cursor-pointer">Metrics by platform</summary>{Object.entries(data.perPlatform).map(([key, m]) => <p key={key} className="mt-2">{key}: {m.reviewed} reviews · {showRate(m.untouchedApprovalRate)} untouched · {showRate(m.editedApprovalRate)} edited · {showRate(m.rejectionRate)} rejected</p>)}</details>}
        {data.runs.length === 0 && <p className="mt-4 text-sm text-ink-dim">No routine usage reported yet.</p>}
        {data.examples.length === 0 && data.runs.length === 0 ? (
          <p className="mt-5 rounded-lg border border-hairline-faint bg-ground p-3 text-sm text-ink-dim">Your edits and rejection reasons will appear here.</p>
        ) : <>
          {data.runs.length > 0 && <section aria-labelledby="training-runs" className="mt-5">
            <h3 id="training-runs" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Routine runs ({data.runs.length})</h3>
            <ul className="mt-2 divide-y divide-hairline-faint rounded-lg border border-hairline-faint bg-ground px-3">
              {data.runs.map((run) => <li key={run.id} className="py-3">
                <p className="break-words text-sm font-semibold text-ink">{run.routine} <span className="font-normal text-ink-dim">· {run.platform}</span></p>
                <p className="mt-1 break-words text-xs text-ink-dim">{formatDate(run.createdAt)} · draft {run.draftId || "not reported"} · {run.feedbackIds.length} feedback item{run.feedbackIds.length === 1 ? "" : "s"} · {run.preferenceIds?.length ?? 0} comparison preferences</p>
                {run.sourcePages?.length ? <details className="mt-2 text-xs"><summary className="cursor-pointer">Sources reported by routine</summary><p>Feedback read through: {formatDate(run.feedbackCutoff || run.createdAt)}</p><ul>{run.sourcePages.map(source => <li key={source.id}><a className="underline" href={`https://www.notion.so/${source.id.replace(/-/g, "")}`} target="_blank" rel="noreferrer">Open source ↗</a> · {source.revision ? formatDate(source.revision) : "Revision not reported"}</li>)}</ul></details> : null}
              </li>)}
            </ul>
          </section>}

          {data.examples.length > 0 && <section aria-labelledby="training-examples" className="mt-5">
            <h3 id="training-examples" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Feedback examples ({data.examples.length})</h3>
            <ul className="mt-2 space-y-3">{data.examples.map((example) => <ExampleCard key={example.id} example={example} busy={busyId === example.id} onSave={save} />)}</ul>
          </section>}
        </>}
        {notice && <p role="status" className="mt-3 text-sm text-ink-dim">{notice}</p>}
      </>}
    </FrameCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-hairline-faint bg-ground p-3">
    <dt className="text-[11px] leading-snug text-ink-dim">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</dd>
  </div>;
}

function ExampleCard({ example, busy, onSave }: { example: TrainingExample; busy: boolean; onSave: (example: TrainingExample, reason: string, scope: Scope) => void }) {
  const [reason, setReason] = useState(example.reason);
  const [scope, setScope] = useState<Scope>(example.scope);
  return <li className="rounded-lg border border-hairline-faint bg-ground p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="break-words text-sm font-semibold text-ink">{example.topic}</p><p className="mt-0.5 text-xs text-ink-dim">{example.platform} · reported used in {example.usedInDrafts} draft{example.usedInDrafts === 1 ? "" : "s"}</p></div>
      <span className="rounded-full bg-slate/5 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-dim">{example.scope}</span>
    </div>
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-ink-dim hover:text-ink">View before and after</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <TextBlock label="Previous draft" text={example.previousText} />
        <TextBlock label="Revised draft" text={example.newText} />
      </div>
    </details>
    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
      <label className="block text-xs font-medium text-ink-dim">Reason
        <textarea className={`${fieldClass} mt-1 min-h-20 resize-y`} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
      </label>
      <label className="block text-xs font-medium text-ink-dim">How broadly should this apply?
        <select className={`${fieldClass} mt-1`} value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
          <option value="unspecified">Unspecified</option><option value="once">This time only</option><option value="always">Apply routinely</option>
        </select>
      </label>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onSave(example, reason, scope)}>{busy ? "Saving…" : "Save feedback"}</button>
    </div>
  </li>;
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return <div className="min-w-0 rounded-md bg-slate/5 p-2.5"><p className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">{label}</p><p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">{text || "No text reported"}</p></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
