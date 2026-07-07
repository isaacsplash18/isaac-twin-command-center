/**
 * Item lifecycle actions shared by the API routes. Every action re-reads the
 * page first (other agents write to these DBs) and refuses to act on items
 * whose status has moved on. Every state change is logged to Pipeline Events.
 */

import { PLATFORM_EVENT_NAMES } from "./config";
import { readItemBody, toContentItem, platformFromPage } from "./items";
import { CalibrationPlatform, CalibrationSource, logCalibrationEvent } from "./calibration-events";
import { maybeCreateAmendmentFromDraftEvent } from "./proposals";
import {
  buildStatusUpdate,
  getPage,
  logEvent,
  readCheckboxProp,
  readRichTextProp,
  readStatus,
  readTitle,
  richTextValue,
  updatePage,
  writeBody,
} from "./notion";

/** Map the app's platform key (e.g. "ig-story") to the CalibrationEvents schema's snake_case value. */
function calibrationPlatform(key: string): CalibrationPlatform {
  const mapped = key.replace(/-/g, "_");
  return (["x", "linkedin", "ig_story", "ig_carousel"].includes(mapped) ? mapped : "unknown") as CalibrationPlatform;
}

export class ActionError extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message);
  }
}

async function loadItem(pageId: string) {
  const page = await getPage(pageId);
  const p = platformFromPage(page);
  if (!p) throw new ActionError("Page does not belong to a configured content database", 400);
  return { page, p };
}

function buildDiff(original: string, approved: string): string {
  return `ORIGINAL\n--------\n${original}\n\nAPPROVED\n--------\n${approved}`;
}

export async function approveItem(pageId: string, source: CalibrationSource = "command_center") {
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Draft") throw new ActionError(`Cannot approve an item with status "${status ?? "unknown"}"`);

  const dsId = process.env[p.dsEnv]!;
  const edited = readCheckboxProp(page, "Edited Before Approval");
  const original = readRichTextProp(page, "Original Draft");
  const body = await readItemBody(page, p);

  try {
    await updatePage(pageId, {
      ...(await buildStatusUpdate(dsId, "Approved")),
      "Approved At": { date: { start: new Date().toISOString() } },
    });
  } catch (err) {
    // Pre-migration DBs lack "Approved At" — approve on status alone rather
    // than blocking the flow. Run `npm run migrate` to get full tracking.
    if (err instanceof Error && /Approved At|property that does not exist|not a property/i.test(err.message)) {
      console.warn("Approved At missing (run npm run migrate) — approving with status only");
      await updatePage(pageId, await buildStatusUpdate(dsId, "Approved"));
    } else {
      throw err;
    }
  }

  // Non-fatal: the status flip already committed, so a transient Pipeline
  // Events write failure must not 500 an applied action (a retry would hit
  // the `!== "Draft"` guard). Same discipline as logCalibrationEvent.
  await logEvent({
    event: edited ? "Approved-with-edits" : "Approved",
    platform: PLATFORM_EVENT_NAMES[p.key],
    itemUrl: page.url,
    diff: edited && original ? buildDiff(original, body) : undefined,
  }).catch((err) => console.warn("logEvent (Approved) failed — action already applied:", err));

  await logCalibrationEvent({
    source,
    action: "approve",
    objectType: "draft",
    objectId: pageId,
    platform: calibrationPlatform(p.key),
    topic: readTitle(page),
    previousText: edited && original ? original : undefined,
    newText: body,
  });

  return toContentItem(await getPage(pageId), p, false);
}

export async function rejectItem(pageId: string, source: CalibrationSource = "command_center", reason?: string) {
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Draft") throw new ActionError(`Cannot reject an item with status "${status ?? "unknown"}"`);
  const dsId = process.env[p.dsEnv]!;
  await updatePage(pageId, await buildStatusUpdate(dsId, "Rejected"));
  // Non-fatal: status already flipped; don't 500 an applied reject on a
  // transient Pipeline Events failure (matches logCalibrationEvent).
  await logEvent({ event: "Rejected", platform: PLATFORM_EVENT_NAMES[p.key], itemUrl: page.url }).catch((err) =>
    console.warn("logEvent (Rejected) failed — action already applied:", err)
  );
  const rejectEvent = await logCalibrationEvent({
    source,
    action: "reject",
    objectType: "draft",
    objectId: pageId,
    platform: calibrationPlatform(p.key),
    topic: readTitle(page),
    rawUserText: reason,
  });
  // Identity Calibration: a rejection WITH a reason becomes a pending
  // unclassified amendment (no reason → no amendment). Fire-and-forget safe —
  // the reject already committed; generation never throws.
  await maybeCreateAmendmentFromDraftEvent(rejectEvent);
  return { ok: true };
}

export async function editItem(pageId: string, newText: string, source: CalibrationSource = "command_center") {
  if (!newText.trim()) throw new ActionError("Draft body cannot be empty", 400);
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Draft") throw new ActionError(`Cannot edit an item with status "${status ?? "unknown"}"`);

  // Snapshot the pre-edit body once, so the Edit Ledger diff has a baseline.
  const existingOriginal = readRichTextProp(page, "Original Draft");
  const currentBody = await readItemBody(page, p);
  const snapshotUpdates: Record<string, unknown> = { "Edited Before Approval": { checkbox: true } };
  if (!existingOriginal) {
    snapshotUpdates["Original Draft"] = richTextValue(currentBody || newText);
  }
  // Matches the Notion "unknown property" errors raised by a pre-migration DB
  // lacking Original Draft / Edited Before Approval.
  const snapshotPropMissing = /Original Draft|Edited Before Approval|property that does not exist|not a property/i;

  if (p.bodyProp) {
    // Body lives in a rich-text property (IG Story Copy / Caption) — the body
    // prop and the snapshot/flag land in the SAME updatePage as before.
    const updates = { ...snapshotUpdates, [p.bodyProp]: richTextValue(newText) };
    try {
      await updatePage(pageId, updates as never);
    } catch (err) {
      // Pre-migration DBs lack the snapshot props — persist the body alone
      // rather than blocking the edit (mirrors approveItem's fallback).
      if (err instanceof Error && snapshotPropMissing.test(err.message)) {
        console.warn("Original Draft / Edited Before Approval missing (run npm run migrate) — editing body only");
        await updatePage(pageId, { [p.bodyProp]: richTextValue(newText) } as never);
      } else {
        throw err;
      }
    }
  } else {
    // Block body (X / LinkedIn): persist the snapshot + flag FIRST, then
    // mutate the body, so a failure between them can never leave the body
    // changed with the true original never saved.
    try {
      await updatePage(pageId, snapshotUpdates as never);
    } catch (err) {
      // Pre-migration DBs lack the snapshot props — warn and proceed to the
      // body change rather than mutating the body then throwing (the old bug).
      if (err instanceof Error && snapshotPropMissing.test(err.message)) {
        console.warn("Original Draft / Edited Before Approval missing (run npm run migrate) — editing body only");
      } else {
        throw err;
      }
    }
    await writeBody(pageId, newText);
  }
  const editEvent = await logCalibrationEvent({
    source,
    action: "edit",
    objectType: "draft",
    objectId: pageId,
    platform: calibrationPlatform(p.key),
    topic: readTitle(page),
    previousText: currentBody,
    newText,
    rawUserText: newText,
  });
  // Identity Calibration: a draft edit becomes a pending voice amendment
  // (proposedText = the new body). Fire-and-forget safe — the edit already
  // committed; generation never throws.
  await maybeCreateAmendmentFromDraftEvent(editEvent);
  return { ok: true, body: newText };
}

/** IG manual lane: Isaac posted it himself → Posted. */
export async function markPostedItem(pageId: string) {
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Approved") throw new ActionError(`Cannot mark-posted an item with status "${status ?? "unknown"}"`);
  const dsId = process.env[p.dsEnv]!;
  await updatePage(pageId, await buildStatusUpdate(dsId, "Posted"));
  // Non-fatal: status already flipped to Posted; don't 500 an applied action
  // on a transient Pipeline Events failure (matches logCalibrationEvent).
  await logEvent({
    event: "Posted",
    platform: PLATFORM_EVENT_NAMES[p.key],
    itemUrl: page.url,
    notes: "Posted manually",
  }).catch((err) => console.warn("logEvent (Posted) failed — action already applied:", err));
  return { ok: true };
}

/** Delete the Typefully draft and put the item back into the Approved pool. */
export async function unqueueItem(pageId: string) {
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Queued") throw new ActionError(`Cannot unqueue an item with status "${status ?? "unknown"}"`);
  const typefullyId = readRichTextProp(page, "Typefully ID");
  if (typefullyId) {
    const { deleteDraft } = await import("./typefully");
    try {
      await deleteDraft(typefullyId);
    } catch (err) {
      // A 404 means the draft is already gone in Typefully — safe to proceed.
      if (!(err instanceof Error && err.message.includes("404"))) throw err;
    }
  }
  const dsId = process.env[p.dsEnv]!;
  await updatePage(pageId, {
    ...(await buildStatusUpdate(dsId, "Approved")),
    "Typefully ID": richTextValue(""),
    "Scheduled At": { date: null },
  });
  return { ok: true };
}
