"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { postAction, useApi } from "./useApi";

type TargetType =
  | "position"
  | "voice"
  | "constitution"
  | "workflow"
  | "unclassified";

/** Mirrors lib/proposals.ts PositionUpdateProposal (client-side shape only). */
interface Amendment {
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
  targetType: TargetType;
  targetRef: string;
}

const CONFIDENCE_CLASS: Record<Amendment["confidence"], string> = {
  low: "text-oxbright",
  medium: "text-amber",
  high: "text-phosphor",
};

// The four canonical lanes are always shown; unclassified appears only when non-empty.
const LANES: { type: TargetType; label: string }[] = [
  { type: "voice", label: "Voice" },
  { type: "constitution", label: "Principles" },
  { type: "position", label: "Positions" },
  { type: "workflow", label: "Workflows" },
];
const TARGET_OPTIONS: TargetType[] = [
  "position",
  "voice",
  "constitution",
  "workflow",
  "unclassified",
];

const ACCEPT_TOAST =
  "Accepted. This suggestion is saved, but it has not changed the canonical files. Isaac must apply it separately.";

/** PATCH an amendment (edit proposed text / reclassify). */
async function patchAmendment(
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const json = await res.json().catch(() => ({}));
    return { ok: false, error: json?.error || `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * IDENTITY CALIBRATION panel (Identity Calibration layer). Pending amendments —
 * deterministic, never-invented signals derived from draft edits/rejections and
 * survey verdicts — sorted into VOICE / CONSTITUTION / POSITIONS / WORKFLOWS
 * lanes, plus an UNCLASSIFIED inbox. Each card can be edited, reclassified, then
 * ACCEPTed or REJECTed. Accepting only flips a status — it NEVER mutates any
 * canonical file (Positions Library, voice/constitution packs, workflows). The
 * apply step stays a manual, human action.
 */
export function IdentityCalibrationPanel({
  index,
  onError,
}: {
  index: number;
  onError: (msg: string) => void;
}) {
  const { data, error, loading, setData, refresh } = useApi<{
    proposals: Amendment[];
  }>("/api/proposals?status=pending", 120_000);
  const [busyId, setBusyId] = useState<string | null>(null);

  const proposals = data?.proposals ?? [];

  const removeLocal = (id: string) =>
    setData((d) =>
      d ? { ...d, proposals: d.proposals.filter((p) => p.id !== id) } : d,
    );
  const updateLocal = (id: string, patch: Partial<Amendment>) =>
    setData((d) =>
      d
        ? {
            ...d,
            proposals: d.proposals.map((p) =>
              p.id === id ? { ...p, ...patch } : p,
            ),
          }
        : d,
    );

  const decide = async (a: Amendment, kind: "accept" | "reject") => {
    setBusyId(a.id);
    removeLocal(a.id); // optimistic
    const res = await postAction(`/api/proposals/${a.id}/${kind}`);
    setBusyId(null);
    if (res.ok) {
      if (kind === "accept") onError(ACCEPT_TOAST);
      setTimeout(() => refresh(), 1200);
    } else {
      // Restore on failure.
      setData((d) =>
        d && !d.proposals.some((p) => p.id === a.id)
          ? { ...d, proposals: [a, ...d.proposals] }
          : d,
      );
      onError(res.error ?? `${kind === "accept" ? "Accept" : "Reject"} failed`);
    }
  };

  const classify = async (a: Amendment, targetType: TargetType) => {
    if (targetType === a.targetType) return;
    setBusyId(a.id);
    const res = await patchAmendment(a.id, { targetType });
    setBusyId(null);
    if (res.ok) updateLocal(a.id, { targetType });
    else onError(res.error ?? "Reclassify failed");
  };

  const saveText = async (
    a: Amendment,
    proposedText: string,
  ): Promise<boolean> => {
    setBusyId(a.id);
    const res = await patchAmendment(a.id, { proposedText });
    setBusyId(null);
    if (res.ok) {
      updateLocal(a.id, { proposedPositionText: proposedText });
      return true;
    }
    onError(res.error ?? "Save failed");
    return false;
  };

  const unclassified = proposals.filter((p) => p.targetType === "unclassified");

  return (
    <FrameCard index={index} className="p-4">
      <h2 className="panel-heading">Suggested improvements</h2>
      <p className="mt-1 break-words text-[13px] leading-snug text-ink-dim/80">
        Accepting a suggestion saves it for review. It does not change your
        canonical files; those changes must be applied separately.
      </p>

      {loading && !data && (
        <p className="mt-3 text-[13px] text-ink-dim">Loading suggestions…</p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-oxbright"
        >
          <span>Could not load suggestions: {error}</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refresh()}
            disabled={loading}
          >
            {loading ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {data &&
        LANES.map((lane) => (
          <Lane
            key={lane.type}
            label={lane.label}
            items={proposals.filter((p) => p.targetType === lane.type)}
            busyId={busyId}
            onDecide={decide}
            onClassify={classify}
            onSaveText={saveText}
          />
        ))}

      {data && unclassified.length > 0 && (
        <Lane
          label="Unclassified"
          items={unclassified}
          busyId={busyId}
          onDecide={decide}
          onClassify={classify}
          onSaveText={saveText}
        />
      )}
    </FrameCard>
  );
}

function Lane({
  label,
  items,
  busyId,
  onDecide,
  onClassify,
  onSaveText,
}: {
  label: string;
  items: Amendment[];
  busyId: string | null;
  onDecide: (a: Amendment, kind: "accept" | "reject") => void;
  onClassify: (a: Amendment, t: TargetType) => void;
  onSaveText: (a: Amendment, text: string) => Promise<boolean>;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink-dim">{label}</h3>
        {items.length > 0 && (
          <span className="text-[13px] text-ink-dim/70">{items.length}</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-[13px] text-ink-dim/70">
          No pending suggestions.
        </p>
      ) : (
        <ul className="mt-1">
          {items.map((a) => (
            <AmendmentCard
              key={a.id}
              a={a}
              busy={busyId !== null}
              onDecide={onDecide}
              onClassify={onClassify}
              onSaveText={onSaveText}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AmendmentCard({
  a,
  busy,
  onDecide,
  onClassify,
  onSaveText,
}: {
  a: Amendment;
  busy: boolean;
  onDecide: (a: Amendment, kind: "accept" | "reject") => void;
  onClassify: (a: Amendment, t: TargetType) => void;
  onSaveText: (a: Amendment, text: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a.proposedPositionText);

  const MiniBtn = ({
    label,
    onClick,
    disabled,
  }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="btn btn-secondary"
    >
      {label}
    </button>
  );

  return (
    <li className="border-b border-hairline-faint py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {a.targetRef && (
            <span className="mr-1 text-[13px] text-ink-dim">{a.targetRef}</span>
          )}
          {a.topic || "Untitled"}
        </span>
        <span
          className={`text-[13px] capitalize ${CONFIDENCE_CLASS[a.confidence]}`}
        >
          {a.confidence} confidence
        </span>
      </div>

      {a.evidenceSummary && (
        <p className="mt-1 whitespace-pre-line break-words text-[13px] leading-snug text-ink-dim/80">
          {a.evidenceSummary}
        </p>
      )}

      {a.currentPositionText && (
        <div className="mt-2">
          <div className="text-[13px] text-ink-dim">Current position</div>
          <p className="mt-0.5 whitespace-pre-line break-words font-serif text-[13px] leading-snug text-ink-dim">
            {a.currentPositionText}
          </p>
        </div>
      )}

      <div className="mt-2">
        <div className="text-[13px] text-ink-dim">Suggested position</div>
        {editing ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.max(3, text.split("\n").length + 1)}
              className="mt-1 w-full resize-y border border-hairline bg-ground p-2 font-serif text-[13px] leading-snug text-ink focus:border-ink/40 focus:outline-none"
              autoFocus
            />
            <div className="mt-1 flex gap-2">
              <MiniBtn
                label="Save"
                disabled={busy}
                onClick={async () => {
                  if (await onSaveText(a, text)) setEditing(false);
                }}
              />
              <MiniBtn
                label="Cancel"
                onClick={() => {
                  setText(a.proposedPositionText);
                  setEditing(false);
                }}
              />
            </div>
          </>
        ) : (
          <p className="mt-0.5 whitespace-pre-line break-words font-serif text-[13px] leading-snug text-ink">
            {a.proposedPositionText || "—"}
          </p>
        )}
      </div>

      {a.reason && (
        <p className="mt-2 break-words text-[13px] leading-snug text-ink-dim/80">
          {a.reason}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[13px] text-ink-dim/80">
          <span>Category</span>
          <select
            value={a.targetType}
            disabled={busy}
            onChange={(e) => onClassify(a, e.target.value as TargetType)}
            className="min-h-11 border border-hairline bg-ground px-2 py-1 text-[13px] text-ink focus:border-ink/40 focus:outline-none disabled:opacity-40 sm:min-h-0"
          >
            {TARGET_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "constitution"
                  ? "Principles"
                  : t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </label>
        {!editing && (
          <MiniBtn
            label="Edit"
            disabled={busy}
            onClick={() => setEditing(true)}
          />
        )}
        <MiniBtn
          label="Accept"
          disabled={busy}
          onClick={() => onDecide(a, "accept")}
        />
        <MiniBtn
          label="Reject"
          disabled={busy}
          onClick={() => onDecide(a, "reject")}
        />
      </div>
    </li>
  );
}
