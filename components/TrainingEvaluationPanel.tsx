"use client";

import { FormEvent, useMemo, useState } from "react";
import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";

interface EvaluationCase {
  id: string;
  title: string;
  platform: string;
  prompt: string;
  criteria: string[];
}

interface Evaluation {
  id: string;
  caseId: string;
  baseline: string;
  candidate: string;
  baselineVersion: string;
  candidateVersion: string;
  winner: "baseline" | "candidate" | "tie";
  notes: string;
  violations: string[];
  createdAt: string;
}

interface EvaluationData {
  cases: EvaluationCase[];
  evaluations: Evaluation[];
  warnings: string[];
}

const fieldClass = "w-full rounded-lg border border-hairline-faint bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-oxbright focus:ring-2 focus:ring-oxbright/15";

/** Human-recorded comparisons; this panel never generates or scores text. */
export function TrainingEvaluationPanel({ index }: { index: number }) {
  const { data, error, loading, refresh } = useApi<EvaluationData>("/api/training/evaluations", 120_000);
  const [caseId, setCaseId] = useState("");
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState("");
  const [baselineVersion, setBaselineVersion] = useState("");
  const [candidateVersion, setCandidateVersion] = useState("");
  const [winner, setWinner] = useState<Evaluation["winner"] | "">("");
  const [notes, setNotes] = useState("");
  const [violations, setViolations] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const cases = data?.cases ?? [];
  const selectedCaseId = cases.some((item) => item.id === caseId) ? caseId : cases[0]?.id ?? "";
  const selectedCase = cases.find((item) => item.id === selectedCaseId);
  const evaluations = data?.evaluations ?? [];
  const caseTitles = useMemo(() => new Map(cases.map((item) => [item.id, item.title])), [cases]);
  const outcomeGroups = useMemo(() => {
    const groups = new Map<string, { baselineVersion: string; candidateVersion: string; baseline: number; candidate: number; tie: number }>();
    for (const evaluation of evaluations) {
      const key = JSON.stringify([evaluation.baselineVersion, evaluation.candidateVersion]);
      const group = groups.get(key) ?? { baselineVersion: evaluation.baselineVersion, candidateVersion: evaluation.candidateVersion, baseline: 0, candidate: 0, tie: 0 };
      group[evaluation.winner] += 1;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => (b.candidate + b.baseline + b.tie) - (a.candidate + a.baseline + a.tie));
  }, [evaluations]);
  const violationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const evaluation of evaluations) for (const violation of evaluation.violations) {
      const label = violation.trim();
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [evaluations]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCaseId || !winner) return;
    setSaving(true);
    setNotice("");
    const payload = {
      caseId: selectedCaseId,
      baseline,
      candidate,
      baselineVersion,
      candidateVersion,
      winner,
      notes,
      violations: violations.split(",").map((rule) => rule.trim()).filter(Boolean),
    };
    try {
      const response = await fetch("/api/training/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);
      setBaseline("");
      setCandidate("");
      setNotes("");
      setViolations("");
      setNotice("Evaluation saved.");
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? `Could not save evaluation: ${err.message}` : "Could not save evaluation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FrameCard index={index} className="p-4 sm:p-5">
      <h2 className="panel-heading">Human evaluations</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-dim">Record a human judgment between baseline and candidate drafts for a fixed case. No model generation or automated scoring is used.</p>

      {loading && !data && <p className="mt-4 text-sm text-ink-dim" role="status">Loading evaluation cases and saved comparisons…</p>}
      {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-oxbright"><span>Could not load evaluations: {error}</span><button type="button" className="btn btn-secondary" onClick={() => refresh()} disabled={loading}>{loading ? "Retrying…" : "Retry"}</button></div>}

      {data && <>
        {data.warnings.length > 0 && <section aria-label="Evaluation warnings" className="mt-4 rounded-lg border border-amber/30 bg-amber/5 p-3"><h3 className="text-sm font-semibold text-ink">Data notes</h3><ul className="mt-1 list-inside list-disc space-y-1 text-[13px] text-ink-dim">{data.warnings.map((warning, i) => <li key={`${i}-${warning}`}>{warning}</li>)}</ul></section>}

        <section aria-label="Evaluation summary" className="mt-4 grid grid-cols-2 gap-2">
          <Metric label="Saved pairs" value={String(evaluations.length)} />
          <Metric label="Version pairs" value={String(outcomeGroups.length)} />
        </section>

        {outcomeGroups.length > 0 && <section aria-labelledby="version-outcomes" className="mt-4">
          <h3 id="version-outcomes" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Outcomes by version pair</h3>
          <ul className="mt-2 divide-y divide-hairline-faint rounded-lg border border-hairline-faint bg-ground/60 px-3">{outcomeGroups.map((group) => {
            const sampleCount = group.baseline + group.candidate + group.tie;
            return <li key={JSON.stringify([group.baselineVersion, group.candidateVersion])} className="py-2.5">
              <p className="break-words text-sm font-semibold text-ink">{group.baselineVersion} vs {group.candidateVersion}</p>
              <p className="mt-1 text-xs text-ink-dim">n={sampleCount}: candidate {group.candidate} wins ({Math.round(group.candidate / sampleCount * 100)}%), baseline {group.baseline} wins, ties {group.tie}</p>
            </li>;
          })}</ul>
        </section>}

        {violationCounts.length > 0 && <section aria-labelledby="repeated-violations" className="mt-4">
          <h3 id="repeated-violations" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Reported rule violations</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">{violationCounts.map(([rule, count]) => <li key={rule} className="flex items-start justify-between gap-3 rounded-lg border border-hairline-faint bg-ground/60 p-3 text-sm"><span className="break-words text-ink">{rule}</span><span className="shrink-0 font-mono text-xs tabular-nums text-ink-dim">{count} report{count === 1 ? "" : "s"}</span></li>)}</ul>
        </section>}

        {cases.length === 0 ? <p className="mt-4 rounded-lg border border-hairline-faint bg-ground/70 p-3 text-sm text-ink-dim">No fixed evaluation cases are available.</p> : <>
          <section aria-labelledby="evaluation-case-heading" className="mt-5">
            <h3 id="evaluation-case-heading" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Evaluation case</h3>
            <label className="mt-2 block text-xs font-medium text-ink-dim">Fixed case
              <select className={`${fieldClass} mt-1`} value={selectedCaseId} onChange={(event) => setCaseId(event.target.value)}>
                {cases.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.platform}</option>)}
              </select>
            </label>
            {selectedCase && <div className="mt-3 rounded-lg border border-hairline-faint bg-ground/60 p-3">
              <p className="text-xs font-medium text-ink-dim">Prompt</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{selectedCase.prompt}</p>
              <p className="mt-3 text-xs font-medium text-ink-dim">Criteria</p>
              {selectedCase.criteria.length ? <ul className="mt-1 list-inside list-disc space-y-1 text-[13px] text-ink">{selectedCase.criteria.map((criterion, i) => <li key={`${i}-${criterion}`}>{criterion}</li>)}</ul> : <p className="mt-1 text-[13px] text-ink-dim">No criteria listed.</p>}
            </div>}
          </section>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Record comparison</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink-dim">Baseline version
                <input required className={`${fieldClass} mt-1`} value={baselineVersion} onChange={(event) => setBaselineVersion(event.target.value)} placeholder="e.g. baseline-v1" />
              </label>
              <label className="block text-xs font-medium text-ink-dim">Candidate version
                <input required className={`${fieldClass} mt-1`} value={candidateVersion} onChange={(event) => setCandidateVersion(event.target.value)} placeholder="e.g. candidate-v2" />
              </label>
              <label className="block text-xs font-medium text-ink-dim">Baseline text
                <textarea required rows={5} className={`${fieldClass} mt-1 resize-y`} value={baseline} onChange={(event) => setBaseline(event.target.value)} />
              </label>
              <label className="block text-xs font-medium text-ink-dim">Candidate text
                <textarea required rows={5} className={`${fieldClass} mt-1 resize-y`} value={candidate} onChange={(event) => setCandidate(event.target.value)} />
              </label>
            </div>
            <fieldset>
              <legend className="text-xs font-medium text-ink-dim">Human judgment</legend>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink">
                {(["baseline", "candidate", "tie"] as const).map((value) => <label key={value} className="inline-flex items-center gap-2"><input required type="radio" name="evaluation-winner" value={value} checked={winner === value} onChange={() => setWinner(value)} className="accent-oxbright" />{value === "tie" ? "Tie" : `${value[0].toUpperCase()}${value.slice(1)} wins`}</label>)}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink-dim">Notes (optional)<textarea rows={3} className={`${fieldClass} mt-1 resize-y`} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
              <label className="block text-xs font-medium text-ink-dim">Violated rules (optional, comma-separated)<input className={`${fieldClass} mt-1`} value={violations} onChange={(event) => setViolations(event.target.value)} placeholder="e.g. unsupported claim, wrong tone" /></label>
            </div>
            <div className="flex flex-wrap items-center gap-3"><button type="submit" className="btn btn-secondary" disabled={saving || !selectedCaseId || !winner}>{saving ? "Saving…" : "Save evaluation"}</button>{notice && <p role="status" className={`text-sm ${notice.startsWith("Could not") ? "text-oxbright" : "text-ink-dim"}`}>{notice}</p>}</div>
          </form>
        </>}

        <section aria-labelledby="recent-evaluations" className="mt-5">
          <h3 id="recent-evaluations" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Recent results ({evaluations.length})</h3>
          {evaluations.length === 0 ? <p className="mt-2 rounded-lg border border-hairline-faint bg-ground/70 p-3 text-sm text-ink-dim">No saved comparisons yet.</p> : <ul className="mt-2 divide-y divide-hairline-faint rounded-lg border border-hairline-faint bg-ground/60 px-3">{[...evaluations].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 8).map((item) => <li key={item.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold text-ink">{caseTitles.get(item.caseId) ?? item.caseId}</p><p className="mt-0.5 text-xs text-ink-dim">{item.baselineVersion} vs {item.candidateVersion} · {formatDate(item.createdAt)}</p></div><span className="rounded-full bg-slate/5 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-dim">{item.winner === "tie" ? "Tie" : `${item.winner} wins`}</span></div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><TextBlock label="Baseline" text={item.baseline} /><TextBlock label="Candidate" text={item.candidate} /></div>
            {(item.notes || item.violations.length > 0) && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-dim">{item.notes}{item.notes && item.violations.length ? " · " : ""}{item.violations.length ? `Violated rules: ${item.violations.join(", ")}` : ""}</p>}
          </li>)}</ul>}
        </section>
      </>}
    </FrameCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-hairline-faint bg-ground/70 p-3"><p className="text-[11px] leading-snug text-ink-dim">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</p></div>;
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return <div className="min-w-0 rounded-md bg-slate/5 p-2.5"><p className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">{label}</p><p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">{text || "No text recorded"}</p></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
