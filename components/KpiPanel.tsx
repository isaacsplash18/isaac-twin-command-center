"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";
import { Kpis } from "./types";

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Large radial arc gauge — hairline strokes, mono percentage centred (PRD §5.4). */
function ArcGauge({ value }: { value: number | null }) {
  const R = 56;
  const C = Math.PI * R; // semicircle length
  const frac = value ?? 0;
  return (
    <svg viewBox="0 0 140 84" className="w-full max-w-[220px]" aria-label="Untouched approval rate">
      <path d="M 14 76 A 56 56 0 0 1 126 76" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
      <path
        d="M 14 76 A 56 56 0 0 1 126 76"
        fill="none"
        stroke="#A61B1C"
        strokeWidth="1.5"
        strokeDasharray={`${C * frac} ${C}`}
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      {/* tick marks */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const a = Math.PI * (1 - t);
        const x1 = 70 + Math.cos(a) * 60;
        const y1 = 76 - Math.sin(a) * 60;
        const x2 = 70 + Math.cos(a) * 64;
        const y2 = 76 - Math.sin(a) * 64;
        return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />;
      })}
      <text x="70" y="66" textAnchor="middle" className="fill-ink" style={{ font: "600 24px var(--font-plex-mono)" }}>
        {pct(value)}
      </text>
      <text x="70" y="80" textAnchor="middle" className="fill-ink-dim" style={{ font: "10px var(--font-plex-mono)", letterSpacing: "0.12em" }}>
        UNTOUCHED
      </text>
    </svg>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke="rgba(232,232,227,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-hairline-faint px-3 py-2">
      <div className="font-mono text-[9px] tracking-[0.15em] text-ink-dim">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-ink">{value}</div>
      {sub && <div className="font-mono text-[9px] text-ink-dim/80">{sub}</div>}
    </div>
  );
}

export function KpiPanel({ index }: { index: number }) {
  const [windowDays, setWindowDays] = useState<7 | 28>(7);
  const { data, error, loading } = useApi<Kpis>(`/api/kpis?window=${windowDays}`, 120_000);

  return (
    <FrameCard index={index} className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-[10px] tracking-[0.2em] text-ink-dim">TWIN PERFORMANCE</h2>
        <div className="flex gap-px font-mono text-[10px]">
          {([7, 28] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindowDays(w)}
              className={`px-2 py-0.5 tracking-wider ${
                windowDays === w ? "bg-ink/10 text-ink" : "text-ink-dim hover:text-ink"
              }`}
            >
              {w}D
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 font-mono text-xs text-oxbright">{error}</p>}
      {loading && !data && <p className="mt-3 font-mono text-xs text-ink-dim">Computing…</p>}

      {data && (
        <>
          <div className="mt-3 flex justify-center">
            <ArcGauge value={data.overall.untouchedApprovalRate} />
          </div>
          <div className="mt-1">
            <Sparkline values={data.dailyApprovals} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="EDIT RATE" value={pct(data.overall.editRate)} />
            <Stat label="REJECTION" value={pct(data.overall.rejectionRate)} />
            <Stat label="DECISIONS" value={String(data.overall.decisions)} />
            <Stat label="DRAFTS/WK" value={data.overall.draftsPerWeek.toFixed(1)} />
            <Stat
              label="MED. APPROVAL"
              value={
                data.overall.medianTimeToApprovalHours == null
                  ? "—"
                  : `${data.overall.medianTimeToApprovalHours.toFixed(1)}h`
              }
            />
            <Stat label="PUB FAILURES" value={String(data.overall.publishFailures)} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 border-t border-hairline-faint pt-2">
            {(["x", "linkedin", "ig-story", "ig-carousel"] as const).map((k) => (
              <div key={k}>
                <div className="font-mono text-[9px] tracking-wider text-ink-dim/80">
                  {k === "x" ? "X" : k === "linkedin" ? "LI" : k === "ig-story" ? "IG-S" : "IG-C"}
                </div>
                <div className="font-mono text-xs text-ink">{pct(data.perPlatform[k]?.untouchedApprovalRate)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </FrameCard>
  );
}
