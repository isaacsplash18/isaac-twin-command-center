"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { StatusPill } from "./StatusPill";
import { postAction } from "./useApi";
import { ContentItem, formatSgt, twinPulse } from "./types";

/**
 * Queue & Posted panel (PRD §7.2) + the "post manually" lane (PRD §7.1).
 * Rejected items stay visible here (last 10) so a decision always leaves
 * a visible trace in the command center.
 */
export function QueuePanel({
  approved,
  queued,
  posted,
  manual,
  rejected,
  index,
  onChanged,
  onError,
}: {
  approved: ContentItem[];
  queued: ContentItem[];
  posted: ContentItem[];
  manual: ContentItem[];
  rejected: ContentItem[];
  index: number;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (path: string, pulse = false) => {
    setBusyId(path);
    const res = await postAction(path);
    setBusyId(null);
    if (res.ok) {
      if (pulse) twinPulse("approve");
      onChanged();
    } else {
      twinPulse("error");
      onError(res.error ?? "Action failed");
    }
  };

  const Row = ({ item, children }: { item: ContentItem; children?: React.ReactNode }) => (
    <li className="flex flex-col gap-1 border-b border-hairline-faint py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <a
          href={item.notionUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
        >
          {item.title || item.body.slice(0, 60) || "Untitled"}
        </a>
        <StatusPill status={item.status} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-dim/80">
          {item.platformLabel.toUpperCase()}
          {item.scheduledAt && ` · ${formatSgt(item.scheduledAt)}`}
        </span>
        <span className="flex gap-2">{children}</span>
      </div>
    </li>
  );

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
      <h2 className="font-mono text-[10px] tracking-[0.2em] text-ink-dim">QUEUE &amp; POSTED</h2>

      {manual.length > 0 && (
        <>
          <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-amber">APPROVED — POST MANUALLY</h3>
          <ul className="mt-1">
            {manual.map((item) => (
              <Row key={item.id} item={item}>
                <MiniBtn
                  label="COPY"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      [item.body || item.title, item.slides].filter(Boolean).join("\n\n---\n\n")
                    )
                  }
                />
                <MiniBtn
                  label="MARK POSTED"
                  disabled={busyId !== null}
                  onClick={() => run(`/api/items/${item.id}/mark-posted`, true)}
                />
              </Row>
            ))}
          </ul>
        </>
      )}

      {approved.length > 0 && (
        <>
          <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-ink-dim/80">APPROVED — AWAITING SCHEDULER</h3>
          <ul className="mt-1">
            {approved.map((item) => (
              <Row key={item.id} item={item}>
                <MiniBtn
                  label="PUBLISH NEXT SLOT"
                  disabled={busyId !== null}
                  onClick={() => run(`/api/items/${item.id}/publish-next`, true)}
                />
              </Row>
            ))}
          </ul>
        </>
      )}

      {queued.length > 0 && (
        <>
          <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-ink-dim/80">SCHEDULED</h3>
          <ul className="mt-1">
            {queued.map((item) => (
              <Row key={item.id} item={item}>
                <MiniBtn
                  label="UNQUEUE"
                  disabled={busyId !== null}
                  onClick={() => run(`/api/items/${item.id}/unqueue`)}
                />
              </Row>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-ink-dim/80">RECENTLY POSTED</h3>
      {posted.length === 0 ? (
        <p className="mt-1 py-1 font-mono text-[10px] text-ink-dim/60">Nothing posted yet.</p>
      ) : (
        <ul className="mt-1">
          {posted.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      )}

      {rejected.length > 0 && (
        <>
          <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-ink-dim/80">RECENTLY REJECTED</h3>
          <ul className="mt-1">
            {rejected.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </FrameCard>
  );
}
