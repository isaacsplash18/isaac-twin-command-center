/**
 * Queue lanes shared by the human lane (/api/queue) and the Agent API
 * (/api/agent/state) — one derivation, two surfaces.
 */

import { PLATFORMS } from "./config";
import { ContentItem, itemsWithStatus } from "./items";

export interface QueueLanes {
  /** status Draft, newest first, full bodies (approval queue) */
  drafts: ContentItem[];
  /** IG items Approved (post-manually lane), full bodies */
  manual: ContentItem[];
  /** X/LinkedIn/Substack Approved, awaiting the publisher cron */
  approved: ContentItem[];
  /** status Queued (in Typefully) */
  queued: ContentItem[];
  /** last 10 Posted across platforms */
  posted: ContentItem[];
  /** last 10 Rejected across platforms */
  rejected: ContentItem[];
  fetchedAt: string;
  warning?: string;
}

export async function loadQueue(opts: { draftLimit?: number } = {}): Promise<QueueLanes> {
  const draftLimit = opts.draftLimit ?? 20;
  const drafts: ContentItem[] = [];
  const manual: ContentItem[] = [];
  const approved: ContentItem[] = [];
  const queued: ContentItem[] = [];
  const posted: ContentItem[] = [];
  const rejected: ContentItem[] = [];

  const errors: string[] = [];
  // Each lane degrades independently: pre-migration DBs lack the Queued/
  // Rejected options and Notion 400s on filters for unknown select options.
  const lane = (p: (typeof PLATFORMS)[number], status: string, o: Parameters<typeof itemsWithStatus>[2]) =>
    itemsWithStatus(p, status, o).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      // Missing select option = schema not migrated yet; not a failure.
      if (!message.includes("not found for property")) errors.push(`${p.label}/${status}: ${message}`);
      return [];
    });

  await Promise.all(
    PLATFORMS.map(async (p) => {
      const [d, a, q, po, re] = await Promise.all([
        lane(p, "Draft", { withBody: true, limit: draftLimit }),
        lane(p, "Approved", { withBody: p.autoPublish ? false : true, limit: 20 }),
        lane(p, "Queued", { limit: 20 }),
        lane(p, "Posted", { limit: 10 }),
        lane(p, "Rejected", { limit: 10 }),
      ]);
      drafts.push(...d);
      (p.autoPublish ? approved : manual).push(...a);
      queued.push(...q);
      posted.push(...po);
      rejected.push(...re);
    })
  );

  const byCreatedDesc = (a: ContentItem, b: ContentItem) => b.createdTime.localeCompare(a.createdTime);
  drafts.sort(byCreatedDesc);
  manual.sort(byCreatedDesc);
  approved.sort(byCreatedDesc);
  queued.sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999"));
  posted.sort((a, b) => b.lastEditedTime.localeCompare(a.lastEditedTime));
  rejected.sort((a, b) => b.lastEditedTime.localeCompare(a.lastEditedTime));

  return {
    drafts,
    manual,
    approved,
    queued,
    posted: posted.slice(0, 10),
    rejected: rejected.slice(0, 10),
    fetchedAt: new Date().toISOString(),
    ...(errors.length ? { warning: errors.join(" · ") } : {}),
  };
}
