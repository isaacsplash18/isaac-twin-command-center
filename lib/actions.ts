/**
 * Item lifecycle actions shared by the API routes. Every action re-reads the
 * page first (other agents write to these DBs) and refuses to act on items
 * whose status has moved on. Every state change is logged to Pipeline Events.
 */

import { PLATFORM_EVENT_NAMES } from "./config";
import { readItemBody, toContentItem, platformFromPage } from "./items";
import { CalibrationPlatform, logCalibrationEvent } from "./calibration-events";
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

export async function approveItem(pageId: string) {
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

  await logEvent({
    event: edited ? "Approved-with-edits" : "Approved",
    platform: PLATFORM_EVENT_NAMES[p.key],
    itemUrl: page.url,
    diff: edited && original ? buildDiff(original, body) : undefined,
  });

  await logCalibrationEvent({
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

export async function rejectItem(pageId: string) {
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Draft") throw new ActionError(`Cannot reject an item with status "${status ?? "unknown"}"`);
  const dsId = process.env[p.dsEnv]!;
  await updatePage(pageId, await buildStatusUpdate(dsId, "Rejected"));
  await logEvent({ event: "Rejected", platform: PLATFORM_EVENT_NAMES[p.key], itemUrl: page.url });
  await logCalibrationEvent({
    action: "reject",
    objectType: "draft",
    objectId: pageId,
    platform: calibrationPlatform(p.key),
    topic: readTitle(page),
  });
  return { ok: true };
}

export async function editItem(pageId: string, newText: string) {
  if (!newText.trim()) throw new ActionError("Draft body cannot be empty", 400);
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Draft") throw new ActionError(`Cannot edit an item with status "${status ?? "unknown"}"`);

  // Snapshot the pre-edit body once, so the Edit Ledger diff has a baseline.
  const existingOriginal = readRichTextProp(page, "Original Draft");
  const currentBody = await readItemBody(page, p);
  const updates: Record<string, unknown> = { "Edited Before Approval": { checkbox: true } };
  if (!existingOriginal) {
    updates["Original Draft"] = richTextValue(currentBody || newText);
  }
  if (p.bodyProp) {
    // Body lives in a rich-text property (IG Story Copy / Caption)
    updates[p.bodyProp] = richTextValue(newText);
  } else {
    await writeBody(pageId, newText);
  }
  await updatePage(pageId, updates as never);
  await logCalibrationEvent({
    action: "edit",
    objectType: "draft",
    objectId: pageId,
    platform: calibrationPlatform(p.key),
    topic: readTitle(page),
    previousText: currentBody,
    newText,
    rawUserText: newText,
  });
  return { ok: true, body: newText };
}

/** IG manual lane: Isaac posted it himself → Posted. */
export async function markPostedItem(pageId: string) {
  const { page, p } = await loadItem(pageId);
  const status = readStatus(page);
  if (status !== "Approved") throw new ActionError(`Cannot mark-posted an item with status "${status ?? "unknown"}"`);
  const dsId = process.env[p.dsEnv]!;
  await updatePage(pageId, await buildStatusUpdate(dsId, "Posted"));
  await logEvent({
    event: "Posted",
    platform: PLATFORM_EVENT_NAMES[p.key],
    itemUrl: page.url,
    notes: "Posted manually",
  });
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
