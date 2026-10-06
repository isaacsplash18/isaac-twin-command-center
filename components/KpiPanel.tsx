"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";
import { Kpis } from "./types";

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 24}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="h-6 w-full"
      aria-hidden
    >
      <polyline
        points={pts}
        fill="none"
        stroke="rgba(25,26,28,0.35)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border border-hairline-faint px-2 py-2">
      <div className="text-[13px] leading-snug text-ink-dim">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-ink">{value}</div>
      {sub && <div className="text-[13px] text-ink-dim/80">{sub}</div>}
    </div>
  );
}

export function KpiPanel({ index }: { index: number }) {
  const [windowDays, setWindowDays] = useState<7 | 28>(7);
  const { data, error, loading } = useApi<Kpis>(
    `/api/kpis?window=${windowDays}`,
    120_000,
  );

  return (
    <FrameCard index={index} className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="panel-heading">Twin performance</h2>
        <div className="flex gap-px text-[13px]">
          {([7, 28] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={windowDays === w}
              onClick={() => setWindowDays(w)}
              className={`flex min-h-11 items-center justify-center px-2 py-0.5 text-[13px]  ${
                windowDays === w
                  ? "bg-ink/10 text-ink"
                  : "text-ink-dim hover:text-ink"
              }`}
            >
              {w} days
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-oxbright">{error}</p>}
      {loading && !data && (
        <p className="mt-3 text-sm text-ink-dim">Computing…</p>
      )}

      {data && (
        <>
          <div className="mt-5">
            <div className="font-mono text-4xl leading-none text-ink">
              {pct(data.overall.untouchedApprovalRate)}
            </div>
            <p className="mt-2 text-[13px] text-ink-dim">
              Untouched approval rate · {windowDays} days
            </p>
          </div>
          <div className="mt-4">
            <p className="mb-1 text-[13px] text-ink-dim">Daily approvals</p>
            <Sparkline values={data.dailyApprovals} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              label="Edited before approval"
              value={pct(data.overall.editRate)}
            />
            <Stat
              label="Rejection rate"
              value={pct(data.overall.rejectionRate)}
            />
            <Stat label="Decisions" value={String(data.overall.decisions)} />
            <Stat
              label="Drafts per week"
              value={data.overall.draftsPerWeek.toFixed(1)}
            />
            <Stat
              label="Median approval time"
              value={
                data.overall.medianTimeToApprovalHours == null
                  ? "—"
                  : `${data.overall.medianTimeToApprovalHours.toFixed(1)}h`
              }
            />
            <Stat
              label="Publishing failures"
              value={String(data.overall.publishFailures)}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-hairline-faint pt-2">
            {(
              [
                ["x", "X"],
                ["linkedin", "LinkedIn"],
                ["substack", "Substack"],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <div className="text-[13px] text-ink-dim">{label}</div>
                <div className="font-mono text-sm text-ink">
                  {pct(data.perPlatform[k]?.untouchedApprovalRate)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </FrameCard>
  );
}
