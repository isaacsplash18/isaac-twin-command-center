/**
 * Publisher + reconciler cores (PRD §8). Invoked by the Vercel crons and by
 * the "Publish next slot" manual override.
 *
 * Safety rails:
 *  - Only ever touches items whose status is exactly "Approved"/"Queued".
 *  - Idempotent: items that already carry a Typefully ID are skipped.
 *  - On Typefully failure the item stays Approved and a Publish-failed
 *    event is logged.
 */

import { PLATFORMS, PLATFORM_EVENT_NAMES, PlatformConfig, dataSourceId } from "./config";
import { itemsWithStatus, buildStatusUpdate, ContentItem } from "./items";
import { getPage, logEvent, queryDataSource, readBody, readDateProp, readRichTextProp, readStatus, richTextValue, updatePage } from "./notion";
import { nextFreeSlot, SchedulablePlatform } from "./scheduling";
import { createScheduledDraft, deleteDraft, getDraftState } from "./typefully";
import { platformFromPage } from "./items";
import { ActionError } from "./actions";

export interface PublishResult {
  scheduled: { pageId: string; platform: string; slot: string; typefullyId: string }[];
  failed: { pageId: string; platform: string; error: string }[];
  skipped: number;
}

async function takenSlots(p: PlatformConfig): Promise<string[]> {
  const queued = await itemsWithStatus(p, "Queued");
  return queued.map((i) => i.scheduledAt).filter((s): s is string => !!s);
}

async function scheduleOne(
  p: PlatformConfig,
  item: ContentItem,
  taken: string[],
  now: Date
): Promise<{ slot: string; typefullyId: string }> {
  const body = item.body || (await readBody(item.id)) || item.title;
  if (!body.trim()) throw new Error("Empty draft body");
  const slot = nextFreeSlot(p.key as SchedulablePlatform, now, taken);
  const draft = await createScheduledDraft({
    platform: p.key as SchedulablePlatform,
    body,
    publishAtIso: slot,
  });
  try {
    await updatePage(item.id, {
      ...(await buildStatusUpdate(dataSourceId(p), "Queued")),
      "Typefully ID": richTextValue(draft.id),
      "Scheduled At": { date: { start: slot } },
    });
  } catch (err) {
    // The Typefully draft was created but Notion never recorded its ID, so
    // the idempotency guard (runPublisher skips items that already carry a
    // Typefully ID) can't see it — the next run would create a SECOND draft
    // and double-schedule the post. Roll the Typefully side back so the item
    // stays cleanly Approved and can be retried.
    try {
      await deleteDraft(draft.id);
    } catch (rollbackErr) {
      // Rollback failed too: the draft is now orphaned in Typefully with no
      // Notion pointer. Record its id in a Publish-failed event so the
      // reconciler/human can find and remove it, then rethrow.
      const notionMsg = err instanceof Error ? err.message : String(err);
      const rollbackMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      await logEvent({
        event: "Publish-failed",
        platform: PLATFORM_EVENT_NAMES[p.key],
        itemUrl: item.notionUrl,
        notes: `ORPHANED Typefully draft ${draft.id} — Notion write failed after create and rollback (deleteDraft) also failed; remove it manually. Notion error: ${notionMsg}; rollback error: ${rollbackMsg}`,
      }).catch(() => {});
      throw err;
    }
    throw err;
  }
  await logEvent({
    event: "Queued",
    platform: PLATFORM_EVENT_NAMES[p.key],
    itemUrl: item.notionUrl,
    notes: `Typefully draft ${draft.id}, slot ${slot}`,
  });
  return { slot, typefullyId: draft.id };
}

export async function runPublisher(): Promise<PublishResult> {
  const now = new Date();
  const result: PublishResult = { scheduled: [], failed: [], skipped: 0 };

  for (const p of PLATFORMS.filter((p) => p.autoPublish)) {
    let approved: ContentItem[];
    let taken: string[];
    try {
      [approved, taken] = await Promise.all([itemsWithStatus(p, "Approved", { withBody: true }), takenSlots(p)]);
    } catch (err) {
      result.failed.push({ pageId: "-", platform: p.key, error: `Query failed: ${err}` });
      continue;
    }
    // Oldest approved first — FIFO into slots.
    approved.sort((a, b) => (a.approvedAt ?? a.createdTime).localeCompare(b.approvedAt ?? b.createdTime));
    for (const item of approved) {
      if (item.typefullyId) {
        result.skipped++;
        continue; // idempotency: already sent to Typefully on a previous run
      }
      try {
        const { slot, typefullyId } = await scheduleOne(p, item, taken, now);
        taken.push(slot);
        result.scheduled.push({ pageId: item.id, platform: p.key, slot, typefullyId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.failed.push({ pageId: item.id, platform: p.key, error: message });
        await logEvent({
          event: "Publish-failed",
          platform: PLATFORM_EVENT_NAMES[p.key],
          itemUrl: item.notionUrl,
          notes: `Scheduling failed: ${message.slice(0, 500)}`,
        }).catch(() => {});
      }
    }
  }
  return result;
}

/** "Publish next slot" override for a single Approved item. */
export async function publishOne(pageId: string): Promise<{ slot: string; typefullyId: string }> {
  const page = await getPage(pageId);
  const p = platformFromPage(page);
  // ActionErrors (not plain Errors) so callers get 400/409 instead of 500; the
  // human-lane UI only reads `{ error }` so it is unaffected by the status change.
  if (!p) throw new ActionError("Page does not belong to a configured content database", 400);
  if (!p.autoPublish) throw new ActionError("IG items are posted manually", 400);
  if (readStatus(page) !== "Approved") throw new ActionError("Only Approved items can be published");
  if (readRichTextProp(page, "Typefully ID")) throw new ActionError("Item is already in Typefully");
  const item = {
    id: page.id,
    notionUrl: page.url,
    title: "",
    body: await readBody(page.id),
    approvedAt: readDateProp(page, "Approved At"),
    createdTime: page.created_time,
  } as ContentItem;
  return scheduleOne(p, item, await takenSlots(p), new Date());
}

export interface ReconcileResult {
  posted: string[];
  late: string[];
  checked: number;
}

const LATE_THRESHOLD_MS = 2 * 3600_000;

/** Has a Publish-failed event already been logged for this item? (dedupes hourly re-runs) */
async function alreadyFlaggedLate(itemUrl: string): Promise<boolean> {
  const dsEvents = process.env.DS_EVENTS;
  if (!dsEvents) return false;
  try {
    const rows = await queryDataSource(dsEvents, {
      filter: {
        and: [
          { property: "Item", url: { equals: itemUrl } },
          { property: "Event", select: { equals: "Publish-failed" } },
        ],
      },
      page_size: 1,
    });
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function runReconciler(): Promise<ReconcileResult> {
  const now = Date.now();
  const result: ReconcileResult = { posted: [], late: [], checked: 0 };

  for (const p of PLATFORMS.filter((p) => p.autoPublish)) {
    let queued: ContentItem[];
    try {
      queued = await itemsWithStatus(p, "Queued");
    } catch {
      continue;
    }
    for (const item of queued) {
      if (!item.scheduledAt || new Date(item.scheduledAt).getTime() > now) continue;
      if (!item.typefullyId) continue;
      result.checked++;
      let state;
      try {
        state = await getDraftState(item.typefullyId);
      } catch (err) {
        console.error(`Reconciler: Typefully lookup failed for ${item.typefullyId}:`, err);
        continue;
      }
      if (state.status === "published") {
        await updatePage(item.id, await buildStatusUpdate(dataSourceId(p), "Posted"));
        await logEvent({
          event: "Posted",
          platform: PLATFORM_EVENT_NAMES[p.key],
          itemUrl: item.notionUrl,
          notes: state.publishedUrl ?? undefined,
        });
        result.posted.push(item.id);
      } else if (
        state.status === "error" ||
        now - new Date(item.scheduledAt).getTime() > LATE_THRESHOLD_MS
      ) {
        if (!(await alreadyFlaggedLate(item.notionUrl))) {
          await logEvent({
            event: "Publish-failed",
            platform: PLATFORM_EVENT_NAMES[p.key],
            itemUrl: item.notionUrl,
            notes:
              state.status === "error"
                ? "Typefully reports publish error"
                : `Still unpublished >2h past slot (Typefully status: ${state.status})`,
          });
        }
        result.late.push(item.id);
      }
    }
  }
  return result;
}
