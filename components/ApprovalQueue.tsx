"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { FrameCard } from "./FrameCard";
import { postAction } from "./useApi";
import { ContentItem, PLATFORM_TABS, PlatformKey, formatSgt, twinPulse } from "./types";

/**
 * Per-platform char limits: X is a hard 280 (over → oxbright); LinkedIn a soft
 * 3000 and Substack Notes a soft 600 (over → amber). The Substack platform
 * ceiling is 10,000, but a Note that runs past ~600 has stopped being an
 * observation, so the amber is a voice guardrail, not a platform one.
 */
const CHAR_LIMITS: Partial<Record<PlatformKey, { limit: number; hard: boolean }>> = {
  x: { limit: 280, hard: true },
  linkedin: { limit: 3000, hard: false },
  substack: { limit: 600, hard: false },
};

/**
 * Home-screen approval queue (PRD §7.1): stacked cards, newest first,
 * platform tabs, Approve/Reject/Edit/Open-in-Notion, optimistic updates,
 * <100ms tap-to-update.
 */
export function ApprovalQueue({
  drafts,
  tab,
  onTab,
  onRemoved,
  onError,
  onToast,
}: {
  drafts: ContentItem[];
  tab: PlatformKey | "all";
  onTab: (t: PlatformKey | "all") => void;
  onRemoved: (id: string) => void;
  onError: (id: string, item: ContentItem, message: string) => void;
  onToast: (message: string) => void;
}) {
  const visible = drafts.filter((d) => tab === "all" || d.platform === tab);

  return (
    <section aria-label="Approval queue">
      <div className="mb-3 flex flex-wrap gap-px">
        {PLATFORM_TABS.map((t) => {
          const count = drafts.filter((d) => t.key === "all" || d.platform === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onTab(t.key)}
              className={`flex min-h-11 items-center justify-center px-3 py-1.5 font-mono text-[11px] tracking-[0.1em] transition-colors sm:min-h-0 ${
                tab === t.key ? "bg-panel text-ink border border-hairline" : "text-ink-dim hover:text-ink border border-transparent"
              }`}
            >
              {t.label}
              {count > 0 && <span className="ml-1.5 text-oxbright">{count}</span>}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <FrameCard className="p-8 text-center">
          <p className="font-mono text-xs tracking-[0.12em] text-ink-dim">QUEUE CLEAR.</p>
        </FrameCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {visible.map((item, i) => (
              <DraftCard key={item.id} item={item} index={i} onRemoved={onRemoved} onError={onError} onToast={onToast} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function DraftCard({
  item,
  index,
  onRemoved,
  onError,
  onToast,
}: {
  item: ContentItem;
  index: number;
  onRemoved: (id: string) => void;
  onError: (id: string, item: ContentItem, message: string) => void;
  onToast: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.body);
  const [busy, setBusy] = useState<null | "approve" | "reject" | "save">(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Autosize the edit textarea to its content (no fixed rows, no scrollbars).
  useEffect(() => {
    const el = taRef.current;
    if (editing && el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, text]);

  const act = async (kind: "approve" | "reject", rejectReason?: string) => {
    setBusy(kind);
    if (kind === "approve") {
      // Copy while still inside the tap gesture (clipboard API requirement),
      // so the approved text is ready to paste into the platform app.
      const clip = [text || item.title, item.slides].filter(Boolean).join("\n\n---\n\n");
      try {
        await navigator.clipboard.writeText(clip);
        onToast("COPIED — PASTE & POST, THEN MARK POSTED");
      } catch {
        /* clipboard denied — the manual lane still has a COPY button */
      }
      twinPulse("approve");
    }
    onRemoved(item.id); // optimistic — card leaves immediately
    const res = await postAction(
      `/api/items/${item.id}/${kind}`,
      kind === "reject" && rejectReason ? { reason: rejectReason } : undefined
    );
    if (!res.ok) {
      twinPulse("error");
      onError(item.id, item, res.error ?? `${kind} failed`);
    }
  };

  const saveEdit = async () => {
    setBusy("save");
    const res = await postAction(`/api/items/${item.id}/edit`, { text });
    setBusy(null);
    if (res.ok) {
      item.body = text;
      item.editedBeforeApproval = true;
      setEditing(false);
    } else {
      twinPulse("error");
      onError(item.id, item, res.error ?? "Edit failed");
    }
  };

  const cancelReject = () => {
    setRejecting(false);
    setReason("");
  };

  const limitDef = CHAR_LIMITS[item.platform];
  const over = limitDef ? text.length > limitDef.limit : false;
  const counterClass = !over
    ? "text-ink-dim/70"
    : limitDef?.hard
      ? "text-oxbright"
      : "text-amber";

  return (
    <FrameCard index={index} sweep className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[0.12em] text-ink-dim">
          {item.platformLabel.toUpperCase()}
          {item.editedBeforeApproval && <span className="ml-2 text-amber">EDITED</span>}
          {item.inCanva && <span className="ml-2 text-slate">IN CANVA</span>}
        </span>
        <span className="font-mono text-[11px] text-ink-dim/80">{formatSgt(item.createdTime)}</span>
      </div>

      {item.platform === "x" && item.title && item.title !== item.body && (
        <p className="mt-2 font-mono text-[11px] tracking-wider text-ink-dim">HOOK: {item.title}</p>
      )}

      {editing ? (
        <>
          {item.originalDraft && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                className="flex min-h-11 items-center border border-hairline px-2 py-0.5 font-mono text-[11px] tracking-wider text-ink-dim hover:text-ink sm:min-h-0"
              >
                {showOriginal ? "HIDE ORIGINAL" : "VS ORIGINAL"}
              </button>
            </div>
          )}
          {showOriginal && item.originalDraft && (
            <div className="mt-2 border border-hairline-faint bg-ground/40 p-3">
              <div className="font-mono text-[11px] tracking-[0.12em] text-ink-dim/70">ORIGINAL DRAFT</div>
              <div className="mt-1 whitespace-pre-wrap break-words font-serif text-sm leading-relaxed text-ink-dim">
                {item.originalDraft}
              </div>
            </div>
          )}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-3 w-full resize-none overflow-hidden border border-hairline bg-ground p-3 font-serif text-[15px] leading-relaxed text-ink focus:border-ink/40 focus:outline-none"
            autoFocus
          />
        </>
      ) : (
        // The content is the hero — Newsreader, reads like writing (PRD §5.2)
        <div className="mt-3 whitespace-pre-wrap break-words font-serif text-[15px] leading-relaxed text-ink">{item.body}</div>
      )}

      {item.slides && !editing && (
        <details className="mt-3 border border-hairline-faint p-3">
          <summary className="cursor-pointer font-mono text-[11px] tracking-[0.1em] text-ink-dim">
            SLIDE TEXTS
          </summary>
          <div className="mt-2 whitespace-pre-wrap break-words font-serif text-sm leading-relaxed text-ink-dim">{item.slides}</div>
        </details>
      )}

      <div className="mt-2 flex items-center justify-between">
        {limitDef ? (
          <span className={`font-mono text-[11px] ${counterClass}`}>
            {text.length} / {limitDef.limit} CH
          </span>
        ) : (
          <span />
        )}
        <a
          href={item.notionUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] tracking-wider text-ink-dim underline decoration-hairline underline-offset-4 hover:text-ink"
        >
          OPEN IN NOTION ↗
        </a>
      </div>

      <div className="mt-4 flex gap-2">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy === "save"}
              onClick={saveEdit}
              className="flex min-h-11 flex-1 items-center justify-center border border-ink/30 bg-ink/10 px-4 py-2.5 font-mono text-xs tracking-[0.1em] text-ink hover:bg-ink/15 disabled:opacity-50 sm:min-h-0"
            >
              {busy === "save" ? "SAVING…" : "SAVE"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(item.body);
              }}
              className="flex min-h-11 items-center justify-center border border-hairline px-4 py-2.5 font-mono text-xs tracking-[0.1em] text-ink-dim hover:text-ink sm:min-h-0"
            >
              CANCEL
            </button>
          </>
        ) : rejecting ? (
          // Inline reject-with-reason row (one extra tap max). The reason
          // becomes a pending unclassified amendment; SKIP rejects with none.
          // Escape or focus leaving the row cancels.
          <div
            className="flex w-full gap-2"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cancelReject();
            }}
          >
            <input
              type="text"
              value={reason}
              autoFocus
              placeholder="Why? (optional — becomes a calibration signal)"
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelReject();
                if (e.key === "Enter") act("reject", reason.trim() || undefined);
              }}
              className="min-h-11 min-w-0 flex-1 border border-hairline bg-ground px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-dim/50 focus:border-ink/40 focus:outline-none sm:min-h-0"
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("reject", reason.trim() || undefined)}
              className="flex min-h-11 items-center justify-center border border-oxbright/60 bg-oxblood/30 px-3 py-2 font-mono text-xs tracking-[0.1em] text-ink hover:bg-oxblood/50 disabled:opacity-50 sm:min-h-0"
            >
              REJECT
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("reject")}
              className="flex min-h-11 items-center justify-center border border-hairline px-3 py-2 font-mono text-xs tracking-[0.1em] text-ink-dim hover:text-ink disabled:opacity-50 sm:min-h-0"
            >
              SKIP
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("approve")}
              className="flex min-h-11 flex-1 items-center justify-center border border-oxbright/60 bg-oxblood/30 px-4 py-2.5 font-mono text-xs tracking-[0.1em] text-ink hover:bg-oxblood/50 active:bg-oxblood/70 disabled:opacity-50 sm:min-h-0"
            >
              APPROVE
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setRejecting(true)}
              className="flex min-h-11 items-center justify-center border border-hairline px-4 py-2.5 font-mono text-xs tracking-[0.1em] text-ink-dim hover:text-ink disabled:opacity-50 sm:min-h-0"
            >
              REJECT
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex min-h-11 items-center justify-center border border-hairline px-4 py-2.5 font-mono text-xs tracking-[0.1em] text-ink-dim hover:text-ink sm:min-h-0"
            >
              EDIT
            </button>
          </>
        )}
      </div>
    </FrameCard>
  );
}
