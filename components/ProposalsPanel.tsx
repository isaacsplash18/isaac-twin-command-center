"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { postAction, useApi } from "./useApi";

/** Mirrors lib/proposals.ts PositionUpdateProposal (client-side shape only). */
interface Proposal {
  id: string;
  createdAt: string;
  updatedAt: string;
  affectedPositionId: string;
  topic: string;
  currentPositionText: string;
  proposedPositionText: string;
  reason: string;
  evidenceSummary: string;
  confidence: "low" | "medium" | "high";
  status: "pending" | "accepted" | "rejected" | "applied";
}

const CONFIDENCE_CLASS: Record<Proposal["confidence"], string> = {
  low: "text-oxbright",
  medium: "text-amber",
  high: "text-phosphor",
};

const ACCEPT_TOAST = "ACCEPTED — APPLY TO NOTION MANUALLY (NOT AUTO-APPLIED)";

/**
 * PROPOSED UPDATES panel (Phase 4 — plan §4.2). Deterministic pending
 * PositionUpdateProposals derived from sharpen/reject calibration verdicts.
 * Accept/reject is a status-flip only — accepting never mutates the canonical
 * Positions Library (apply stays manual). Renders nothing when the pending
 * queue is empty (the dashboard is already dense).
 */
export function ProposalsPanel({ index, onError }: { index: number; onError: (msg: string) => void }) {
  const { data, setData, refresh } = useApi<{ proposals: Proposal[] }>(
    "/api/proposals?status=pending",
    120_000
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const proposals = data?.proposals ?? [];
  if (proposals.length === 0) return null;

  const act = async (proposal: Proposal, kind: "accept" | "reject") => {
    setBusyId(proposal.id);
    // Optimistic removal from the pending list, restore on failure.
    setData((d) => (d ? { ...d, proposals: d.proposals.filter((p) => p.id !== proposal.id) } : d));
    const res = await postAction(`/api/proposals/${proposal.id}/${kind}`);
    setBusyId(null);
    if (res.ok) {
      if (kind === "accept") onError(ACCEPT_TOAST);
      setTimeout(() => refresh(), 1200);
    } else {
      setData((d) =>
        d && !d.proposals.some((p) => p.id === proposal.id)
          ? { ...d, proposals: [proposal, ...d.proposals] }
          : d
      );
      onError(res.error ?? `${kind === "accept" ? "Accept" : "Reject"} failed`);
    }
  };

  const MiniBtn = ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 items-center justify-center border border-hairline px-2 py-0.5 font-mono text-[11px] tracking-wider text-ink-dim hover:text-ink disabled:opacity-40 sm:min-h-0 sm:text-[9px]"
    >
      {label}
    </button>
  );

  return (
    <FrameCard index={index} className="p-4">
      <h2 className="font-mono text-[10px] tracking-[0.2em] text-ink-dim">PROPOSED UPDATES</h2>
      <ul className="mt-2">
        {proposals.map((p) => (
          <li key={p.id} className="border-b border-hairline-faint py-3 last:border-b-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.topic || "Untitled"}</span>
              <span className={`font-mono text-[9px] tracking-wider uppercase ${CONFIDENCE_CLASS[p.confidence]}`}>
                {p.confidence}
              </span>
            </div>

            <div className="mt-2 space-y-1.5">
              <div>
                <div className="font-mono text-[9px] tracking-[0.2em] text-ink-dim/70">CURRENT</div>
                <p className="mt-0.5 whitespace-pre-line break-words font-serif text-xs leading-snug text-ink-dim">
                  {p.currentPositionText || "—"}
                </p>
              </div>
              <div>
                <div className="font-mono text-[9px] tracking-[0.2em] text-ink-dim/70">PROPOSED</div>
                <p className="mt-0.5 whitespace-pre-line break-words font-serif text-xs leading-snug text-ink">
                  {p.proposedPositionText || "—"}
                </p>
              </div>
            </div>

            {p.reason && <p className="mt-2 break-words font-mono text-[9px] leading-snug text-ink-dim/80">{p.reason}</p>}

            <div className="mt-2 flex gap-2">
              <MiniBtn label="ACCEPT" disabled={busyId !== null} onClick={() => act(p, "accept")} />
              <MiniBtn label="REJECT" disabled={busyId !== null} onClick={() => act(p, "reject")} />
            </div>
          </li>
        ))}
      </ul>
    </FrameCard>
  );
}
