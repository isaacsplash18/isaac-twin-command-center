"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";
import { Kpis } from "./types";

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/**
 * Hi-tech HUD gauge: a perspective-tilted 3D ring (CSS rotateX) with a
 * glowing oxblood progress arc, an outer tick ring and a slowly rotating
 * inner dial. Mono digits float upright above the plane.
 */
function Gauge3D({ value, windowDays }: { value: number | null; windowDays: number }) {
  const R = 82;
  const C = 2 * Math.PI * R;
  const frac = value ?? 0;
  const ticks = Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2);
  return (
    <div className="relative flex h-[150px] w-full items-center justify-center" aria-label="Untouched approval rate">
      <div style={{ transform: "perspective(420px) rotateX(58deg)" }}>
        <svg width="230" height="230" viewBox="0 0 230 230" className="overflow-visible">
          <defs>
            <filter id="gaugeGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* outer tick ring */}
          {ticks.map((a, i) => (
            <line
              key={i}
              x1={115 + Math.cos(a) * 100}
              y1={115 + Math.sin(a) * 100}
              x2={115 + Math.cos(a) * (i % 4 === 0 ? 92 : 96)}
              y2={115 + Math.sin(a) * (i % 4 === 0 ? 92 : 96)}
              stroke={`rgba(25,26,28,${i % 4 === 0 ? 0.3 : 0.12})`}
              strokeWidth="1"
            />
          ))}
          {/* base ring */}
          <circle cx="115" cy="115" r={R} fill="none" stroke="rgba(25,26,28,0.08)" strokeWidth="6" />
          {/* progress arc, glowing */}
          <circle
            cx="115"
            cy="115"
            r={R}
            fill="none"
            stroke="#A61B1C"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${C * frac} ${C}`}
            transform="rotate(-90 115 115)"
            filter="url(#gaugeGlow)"
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
          {/* progress head marker */}
          {value != null && (
            <circle
              cx={115 + Math.cos(Math.PI * 2 * frac - Math.PI / 2) * R}
              cy={115 + Math.sin(Math.PI * 2 * frac - Math.PI / 2) * R}
              r="4"
              fill="#A61B1C"
              filter="url(#gaugeGlow)"
            />
          )}
          {/* rotating inner dial */}
          <g className="motion-safe:animate-[spin_28s_linear_infinite]" style={{ transformOrigin: "115px 115px" }}>
            <circle cx="115" cy="115" r="62" fill="none" stroke="rgba(25,26,28,0.14)" strokeWidth="1" strokeDasharray="3 9" />
            <circle cx="115" cy="115" r="50" fill="none" stroke="rgba(166,27,28,0.25)" strokeWidth="1" strokeDasharray="30 190" />
          </g>
          <circle cx="115" cy="115" r="36" fill="none" stroke="rgba(25,26,28,0.06)" strokeWidth="10" />
        </svg>
      </div>
      {/* upright readout floating above the tilted plane */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-3xl font-semibold text-ink drop-shadow-[0_0_10px_rgba(166,27,28,0.35)]">
          {pct(value)}
        </span>
        <span className="font-mono text-[9px] tracking-[0.3em] text-ink-dim">UNTOUCHED · {windowDays}D</span>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke="rgba(25,26,28,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
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
              className={`flex min-h-11 items-center justify-center px-2 py-0.5 text-[11px] tracking-wider sm:min-h-0 sm:text-[10px] ${
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
            <Gauge3D value={data.overall.untouchedApprovalRate} windowDays={windowDays} />
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
