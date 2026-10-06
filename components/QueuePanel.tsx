"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { postAction } from "./useApi";
import { ContentItem, formatSgt } from "./types";

type Props = {
  approved: ContentItem[];
  queued: ContentItem[];
  posted: ContentItem[];
  manual: ContentItem[];
  rejected: ContentItem[];
  index: number;
  onChanged: () => void;
  onError: (message: string) => void;
};
export function QueuePanel({
  approved,
  queued,
  posted,
  manual,
  rejected,
  onChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const run = async (item: ContentItem, action: string, success: string) => {
    setBusy(item.id);
    const res = await postAction(`/api/items/${item.id}/${action}`);
    setBusy(null);
    if (res.ok) {
      onError(success);
      onChanged();
    } else
      onError(
        res.error || "That action could not be completed. Please try again.",
      );
  };
  const copy = async (item: ContentItem) => {
    try {
      await navigator.clipboard.writeText(
        [item.body || item.title, item.slides]
          .filter(Boolean)
          .join("\n\n---\n\n"),
      );
      setCopied(item.id);
      onError(
        "Copied. Paste into the platform, publish, then mark as posted here.",
      );
    } catch {
      onError(
        "Clipboard access was blocked. Open the post in Notion to copy the content.",
      );
    }
  };
  const row = (item: ContentItem, action?: React.ReactNode) => (
    <li
      key={item.id}
      className="flex flex-col gap-3 border-t border-hairline-faint py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold text-oxblood">
          {item.platformLabel}
        </p>
        <a
          href={item.notionUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block break-words text-base font-semibold hover:underline"
        >
          {item.title || item.body.slice(0, 100) || "Untitled post"}{" "}
          <span className="text-ink-dim">↗</span>
        </a>
        <p className="mt-1 text-sm text-ink-dim">
          {item.scheduledAt
            ? `${formatSgt(item.scheduledAt)} SGT`
            : item.status === "Approved"
              ? item.autoPublish
                ? "Waiting for the scheduler"
                : "Ready for you to post"
              : item.status}
        </p>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </li>
  );
  return (
    <div className="space-y-6">
      {manual.length > 0 && (
        <FrameCard className="p-5 sm:p-7">
          <h2 className="panel-heading">
            Ready to post manually{" "}
            <span className="ml-2 text-ink-dim">{manual.length}</span>
          </h2>
          <p className="mt-1 text-sm text-ink-dim">
            Copy your content, publish it in the platform, then mark it as
            posted.
          </p>
          <ul className="mt-4">
            {manual.map((item) =>
              row(
                item,
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={() => copy(item)}
                  >
                    {copied === item.id ? "Copy again" : "Copy content"}
                  </button>
                  <button
                    disabled={!!busy}
                    className="btn btn-primary"
                    onClick={() =>
                      run(item, "mark-posted", "Marked as posted.")
                    }
                  >
                    {busy === item.id ? "Updating…" : "Mark as posted"}
                  </button>
                </>,
              ),
            )}
          </ul>
        </FrameCard>
      )}
      {approved.length > 0 && (
        <FrameCard className="p-5 sm:p-7">
          <h2 className="panel-heading">
            Waiting for scheduling{" "}
            <span className="ml-2 text-ink-dim">{approved.length}</span>
          </h2>
          <p className="mt-1 text-sm text-ink-dim">
            The scheduler assigns the next available slot. You can also schedule
            a post now.
          </p>
          <ul className="mt-4">
            {approved.map((item) =>
              row(
                item,
                <button
                  disabled={!!busy}
                  className="btn btn-secondary"
                  onClick={() =>
                    run(
                      item,
                      "publish-next",
                      "Sent to the next available slot. Refreshing the schedule…",
                    )
                  }
                >
                  {busy === item.id ? "Scheduling…" : "Schedule next slot"}
                </button>,
              ),
            )}
          </ul>
        </FrameCard>
      )}
      <FrameCard className="p-5 sm:p-7">
        <h2 className="panel-heading">
          Scheduled <span className="ml-2 text-ink-dim">{queued.length}</span>
        </h2>
        <p className="mt-1 text-sm text-ink-dim">
          All times are Singapore time (SGT).
        </p>
        {queued.length ? (
          <ul className="mt-4">
            {queued.map((item) =>
              row(
                item,
                <button
                  disabled={!!busy}
                  className="btn btn-secondary"
                  onClick={() =>
                    run(
                      item,
                      "unqueue",
                      "Removed from this slot. The post is approved and may be scheduled again.",
                    )
                  }
                >
                  {busy === item.id ? "Updating…" : "Release slot"}
                </button>,
              ),
            )}
          </ul>
        ) : (
          <p className="mt-5 rounded-xl bg-ground p-5 text-sm text-ink-dim">
            No scheduled posts are shown. Approve an automatic-publishing draft
            to add it to the scheduler.
          </p>
        )}
      </FrameCard>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <FrameCard className="p-5 sm:p-7">
          <h2 className="panel-heading">Recently posted</h2>
          {posted.length ? (
            <ul className="mt-4">{posted.map((item) => row(item))}</ul>
          ) : (
            <p className="mt-3 text-sm text-ink-dim">
              Your published posts will appear here.
            </p>
          )}
        </FrameCard>
        <FrameCard className="p-5 sm:p-7">
          <h2 className="panel-heading">Recently rejected</h2>
          {rejected.length ? (
            <ul className="mt-4">{rejected.map((item) => row(item))}</ul>
          ) : (
            <p className="mt-3 text-sm text-ink-dim">
              No rejected posts are shown.
            </p>
          )}
        </FrameCard>
      </div>
    </div>
  );
}
