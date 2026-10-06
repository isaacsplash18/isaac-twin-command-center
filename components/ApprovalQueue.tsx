"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { FrameCard } from "./FrameCard";
import { postAction } from "./useApi";
import {
  ContentItem,
  PLATFORM_TABS,
  PlatformKey,
  formatSgt,
  twinPulse,
} from "./types";

const CHAR_LIMITS: Partial<Record<PlatformKey, number>> = {
  x: 280,
  linkedin: 3000,
  substack: 600,
};

type Props = {
  drafts: ContentItem[];
  tab: PlatformKey | "all";
  onTab: (tab: PlatformKey | "all") => void;
  onRemoved: (id: string) => void;
  onError: (id: string, item: ContentItem, message: string) => void;
  onToast: (message: string) => void;
  onUpdated: (item: ContentItem) => void;
  incomplete?: boolean;
};

export function ApprovalQueue({
  drafts,
  tab,
  onTab,
  incomplete,
  ...callbacks
}: Props) {
  const [query, setQuery] = useState("");
  const visible = drafts.filter(
    (d) =>
      (tab === "all" || d.platform === tab) &&
      `${d.title} ${d.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section aria-label="Drafts to review">
      <div className="mb-5 flex flex-col gap-4">
        <div
          className="flex gap-2 overflow-x-auto pb-1 [&>button]:shrink-0"
          aria-label="Filter by platform"
        >
          {PLATFORM_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onTab(t.key)}
              aria-pressed={tab === t.key}
              className={`btn ${tab === t.key ? "bg-ink text-white" : "btn-secondary"}`}
            >
              {t.label}
              <span
                className={tab === t.key ? "text-white/75" : "text-ink-dim"}
              >
                {
                  drafts.filter((d) => t.key === "all" || d.platform === t.key)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3">
          <span aria-hidden="true" className="text-ink-dim">
            ⌕
          </span>
          <span className="sr-only">Search drafts</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a draft by topic or phrase…"
            className="min-w-0 w-full bg-transparent outline-none"
          />
        </label>
      </div>
      {visible.length === 0 ? (
        <FrameCard className="p-8 text-center">
          <h3 className="text-lg font-semibold">
            {query || tab !== "all"
              ? "No matching drafts"
              : incomplete
                ? "Drafts are temporarily unavailable"
                : "You’re all caught up"}
          </h3>
          <p className="mt-2 text-sm text-ink-dim">
            {query || tab !== "all"
              ? "Try a different phrase or view all platforms."
              : incomplete
                ? "Some sources could not load. Retry the connection above."
                : "New drafts will appear here when they’re ready for review."}
          </p>
          {(query || tab !== "all") && (
            <button
              className="btn btn-secondary mt-4"
              onClick={() => {
                setQuery("");
                onTab("all");
              }}
            >
              Clear filters
            </button>
          )}
        </FrameCard>
      ) : (
        <div className="flex flex-col gap-6">
          <AnimatePresence initial={false}>
            {visible.map((item) => (
              <DraftCard key={item.id} item={item} {...callbacks} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function DraftCard({
  item,
  onRemoved,
  onError,
  onToast,
  onUpdated,
}: Pick<Props, "onRemoved" | "onError" | "onToast" | "onUpdated"> & {
  item: ContentItem;
}) {
  const [body, setBody] = useState(item.body);
  const [text, setText] = useState(item.body);
  const [edited, setEdited] = useState(item.editedBeforeApproval);
  const [original, setOriginal] = useState(item.originalDraft);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [floatingActions, setFloatingActions] = useState(false);
  useEffect(() => {
    const update = () => {
      const box = articleRef.current?.getBoundingClientRect();
      setFloatingActions(
        !!box &&
          window.innerWidth < 768 &&
          box.top < 160 &&
          box.bottom > window.innerHeight - 80,
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.style.height = "auto";
      textRef.current.style.height = `${textRef.current.scrollHeight}px`;
    }
  }, [editing, text]);
  // Preserve unsaved work while polling; accept refreshed content only outside editing.
  useEffect(() => {
    if (!editing) {
      setBody(item.body);
      setText(item.body);
      setEdited(item.editedBeforeApproval);
    }
  }, [item.body, item.editedBeforeApproval, editing]);

  const fail = (message: string) => {
    setError(message);
    setBusy(null);
    twinPulse("error");
    onError(item.id, item, message);
  };
  const approve = async () => {
    setBusy("approve");
    setError(null);
    const res = await postAction(`/api/items/${item.id}/approve`);
    if (!res.ok) return fail(res.error || "Approval failed. Please try again.");
    twinPulse("approve");
    onToast(
      item.autoPublish
        ? "Approved. Waiting for the scheduler — see Schedule for progress."
        : "Approved. Ready to copy and post from Schedule.",
    );
    onRemoved(item.id);
  };
  const save = async (andApprove = false) => {
    if (!text.trim()) {
      setError("Add some content before saving.");
      return;
    }
    setBusy(andApprove ? "save-approve" : "save");
    setError(null);
    const res = await postAction(`/api/items/${item.id}/edit`, { text });
    if (!res.ok)
      return fail(
        res.error || "Changes could not be saved. Your text is still here.",
      );
    setOriginal(original || body);
    setBody(text);
    setEdited(true);
    // Keep the parent snapshot current so polling and cancellation preserve the saved text.
    onUpdated({
      ...item,
      body: text,
      editedBeforeApproval: true,
      originalDraft: original || body,
    });
    if (andApprove) await approve();
    else {
      setBusy(null);
      setEditing(false);
      onToast("Changes saved. This draft still needs approval.");
    }
  };
  const reject = async (feedback?: string) => {
    setBusy("reject");
    setError(null);
    const res = await postAction(
      `/api/items/${item.id}/reject`,
      feedback ? { reason: feedback } : undefined,
    );
    if (!res.ok)
      return fail(
        res.error || "Could not reject this draft. Please try again.",
      );
    onToast(
      feedback
        ? "Draft rejected. Your feedback was saved for training."
        : "Draft rejected without feedback.",
    );
    onRemoved(item.id);
  };
  const limit = CHAR_LIMITS[item.platform];
  const startEditing = () => {
    setEditing(true);
    setRejecting(false);
    setError(null);
  };
  return (
    <article
      ref={articleRef}
      id={`draft-${item.id}`}
      tabIndex={-1}
      className="scroll-mt-28"
      aria-label={`${item.platformLabel} draft: ${item.title || body.slice(0, 50)}`}
    >
      <FrameCard sweep className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-ground px-2.5 py-1 font-semibold">
              {item.platformLabel}
            </span>
            {edited && <span className="text-amber">Edited</span>}
            {item.inCanva && <span className="text-ink-dim">In Canva</span>}
          </div>
          <time className="text-ink-dim" dateTime={item.createdTime}>
            {formatSgt(item.createdTime)}
          </time>
        </div>
        {item.title && item.title !== body && (
          <h3 className="mt-5 text-base font-semibold">{item.title}</h3>
        )}
        {editing ? (
          <div className="mt-5">
            <label
              htmlFor={`edit-${item.id}`}
              className="mb-2 block text-sm font-semibold"
            >
              Edit draft
            </label>
            <textarea
              id={`edit-${item.id}`}
              ref={textRef}
              autoFocus
              disabled={!!busy}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-none rounded-xl border border-hairline bg-ground/50 p-4 font-serif text-lg leading-relaxed"
            />
            {original && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer py-2 text-ink-dim">
                  Compare with original
                </summary>
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-ground p-4 font-serif text-lg">
                  {original}
                </p>
              </details>
            )}
          </div>
        ) : (
          <p className="mt-5 max-w-[68ch] whitespace-pre-wrap break-words font-serif text-[19px] leading-[1.65]">
            {body}
          </p>
        )}
        {item.slides && (
          <details className="mt-4 rounded-xl bg-ground/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Slide text
            </summary>
            <p className="mt-3 whitespace-pre-wrap font-serif text-lg">
              {item.slides}
            </p>
          </details>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-dim">
          <span>
            {limit
              ? `${(editing ? text : body).length} / ${limit} characters${(editing ? text : body).length > limit ? " · Review length" : ""}`
              : `${body.length} characters`}
          </span>
          <a
            href={item.notionUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Open in Notion ↗
          </a>
        </div>
        <div className="mt-2 rounded-lg bg-ground/65 px-3 py-2 text-sm text-ink-dim">
          {item.autoPublish
            ? "Automatic publishing · Approval sends this to the scheduler."
            : "Manual publishing · After approval, copy the content and post it yourself."}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-oxblood">
            {error}
          </p>
        )}
        <div className="mt-5 min-h-[60px] md:min-h-0">
          <div
            className={
              floatingActions && !editing && !rejecting
                ? "review-actions fixed inset-x-4 z-20 rounded-xl border border-hairline bg-white p-2 shadow-lg"
                : "rounded-xl bg-white"
            }
          >
            {editing ? (
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!!busy}
                  className="btn btn-primary flex-1"
                  onClick={() => save(true)}
                >
                  {busy === "save-approve" || busy === "approve"
                    ? "Saving & approving…"
                    : "Save & approve"}
                </button>
                <button
                  disabled={!!busy}
                  className="btn btn-secondary"
                  onClick={() => save()}
                >
                  {busy === "save" ? "Saving…" : "Save changes"}
                </button>
                <button
                  disabled={!!busy}
                  className="btn btn-quiet"
                  onClick={() => {
                    setText(body);
                    setEditing(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : rejecting ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) reject(reason.trim() || undefined);
                }}
              >
                <label
                  htmlFor={`reason-${item.id}`}
                  className="block text-sm font-semibold"
                >
                  What should your twin learn?{" "}
                  <span className="font-normal text-ink-dim">Optional</span>
                </label>
                <textarea
                  id={`reason-${item.id}`}
                  autoFocus
                  disabled={!!busy}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. This sounds too promotional."
                  className="mt-2 w-full rounded-lg border border-hairline p-3"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    disabled={!!busy}
                    className="btn btn-primary"
                    type="submit"
                  >
                    {busy
                      ? "Rejecting…"
                      : reason.trim()
                        ? "Reject & save feedback"
                        : "Reject without feedback"}
                  </button>
                  <button
                    disabled={!!busy}
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => {
                      setRejecting(false);
                      setReason("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex gap-2">
                <button
                  disabled={!!busy}
                  className="btn btn-primary flex-1"
                  onClick={approve}
                >
                  {busy ? "Approving…" : "Approve"}
                </button>
                <button
                  disabled={!!busy}
                  className="btn btn-secondary"
                  onClick={startEditing}
                >
                  Edit
                </button>
                <button
                  disabled={!!busy}
                  className="btn btn-quiet"
                  onClick={() => setRejecting(true)}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>
      </FrameCard>
    </article>
  );
}
