/**
 * CalibrationEvents (Phase 3 — docs/hermes-calibration-plan.md §4.1).
 *
 * A richer, structured event log alongside Pipeline Events (KPI-grade,
 * unchanged — see lib/notion.ts logEvent / lib/kpis.ts). CalibrationEvents
 * capture the raw human signal behind approve/reject/edit and the weekly
 * calibration card (confirm/sharpen/reject/submit/later): rawUserText,
 * previous/new text snapshots, and any affected Position ids.
 *
 * Persisted to a Notion data source (DS_CALIBRATION_EVENTS, created by
 * `npm run migrate` — never hand-created). Never mutates canonical identity
 * data itself; this module only ever appends a log page.
 */

import {
  getDataSourceSchema,
  notionFetch,
  queryDataSource,
  readRichTextProp,
  readSelectProp,
  richTextValue,
  titlePropertyName,
} from "./notion";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export type CalibrationSource = "command_center" | "telegram" | "hermes";
export type CalibrationObjectType = "draft" | "position" | "calibration_card" | "wiki_note";
export type CalibrationPlatform = "x" | "linkedin" | "substack" | "ig_story" | "ig_carousel" | "unknown";
export type CalibrationAction = "approve" | "reject" | "edit" | "confirm" | "sharpen" | "submit" | "later";
export type CalibrationStatus = "pending" | "accepted" | "rejected" | "applied";

export interface CalibrationEvent {
  id: string;
  /** Notion `created_time` — not a custom property. */
  createdAt: string;
  source: CalibrationSource;
  objectType: CalibrationObjectType;
  objectId: string;
  platform: CalibrationPlatform;
  topic: string;
  action: CalibrationAction;
  rawUserText: string;
  previousText: string;
  newText: string;
  affectedPositionIds: string[];
  inferredDelta: string;
  status: CalibrationStatus;
}

export interface LogCalibrationEventInput {
  source?: CalibrationSource;
  objectType: CalibrationObjectType;
  objectId: string;
  platform?: CalibrationPlatform;
  topic?: string;
  action: CalibrationAction;
  rawUserText?: string;
  previousText?: string;
  newText?: string;
  affectedPositionIds?: string[];
  inferredDelta?: string;
  status?: CalibrationStatus;
}

// Notion rich_text items cap at 2000 chars; richTextValue() chunks automatically,
// but we truncate the input first (same 1900 convention as lib/calibration.ts)
// to keep event snapshots bounded and cheap.
const MAX_FIELD = 1900;
function truncate(text: string | undefined): string {
  return (text ?? "").slice(0, MAX_FIELD);
}

function pageToEvent(page: Json): CalibrationEvent {
  const affectedRaw = readRichTextProp(page, "Affected Position IDs");
  return {
    id: page.id,
    createdAt: page.created_time,
    source: (readSelectProp(page, "Source") as CalibrationSource) ?? "command_center",
    objectType: (readSelectProp(page, "Object Type") as CalibrationObjectType) ?? "draft",
    objectId: readRichTextProp(page, "Object ID"),
    platform: (readSelectProp(page, "Platform") as CalibrationPlatform) ?? "unknown",
    topic: readRichTextProp(page, "Topic"),
    action: (readSelectProp(page, "Action") as CalibrationAction) ?? "submit",
    rawUserText: readRichTextProp(page, "Raw User Text"),
    previousText: readRichTextProp(page, "Previous Text"),
    newText: readRichTextProp(page, "New Text"),
    affectedPositionIds: affectedRaw
      ? affectedRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    inferredDelta: readRichTextProp(page, "Inferred Delta"),
    status: (readSelectProp(page, "Status") as CalibrationStatus) ?? "pending",
  };
}

/**
 * Create a CalibrationEvent page. Fire-and-forget safe: like `logEvent`,
 * returns null (and warns) when DS_CALIBRATION_EVENTS is unset, and never
 * throws — a calibration-event write failure must never break the user
 * action (approve/reject/edit/confirm/sharpen/submit/later) that triggered it.
 */
export async function logCalibrationEvent(input: LogCalibrationEventInput): Promise<CalibrationEvent | null> {
  const dsCalibrationEvents = process.env.DS_CALIBRATION_EVENTS;
  if (!dsCalibrationEvents) {
    console.warn("DS_CALIBRATION_EVENTS not set — skipping calibration event log:", input.action, input.objectId);
    return null;
  }
  try {
    const source = input.source ?? "command_center";
    const platform = input.platform ?? "unknown";
    const status = input.status ?? "pending";
    const topic = truncate(input.topic);
    const affectedPositionIds = input.affectedPositionIds ?? [];
    const name = `${input.action} — ${input.objectType} — ${topic || input.objectId}`.slice(0, 200);

    const schema = await getDataSourceSchema(dsCalibrationEvents);
    const titleProp = titlePropertyName(schema);

    const page = await notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: dsCalibrationEvents },
        properties: {
          [titleProp]: { title: [{ type: "text", text: { content: name } }] },
          Source: { select: { name: source } },
          "Object Type": { select: { name: input.objectType } },
          "Object ID": richTextValue(truncate(input.objectId)),
          Platform: { select: { name: platform } },
          Topic: richTextValue(topic),
          Action: { select: { name: input.action } },
          "Raw User Text": richTextValue(truncate(input.rawUserText)),
          "Previous Text": richTextValue(truncate(input.previousText)),
          "New Text": richTextValue(truncate(input.newText)),
          "Affected Position IDs": richTextValue(truncate(affectedPositionIds.join(","))),
          "Inferred Delta": richTextValue(truncate(input.inferredDelta)),
          Status: { select: { name: status } },
        },
      }),
    });

    return pageToEvent(page);
  } catch (err) {
    console.warn("logCalibrationEvent failed (non-fatal):", err);
    return null;
  }
}

/** Recent CalibrationEvents, newest first. Returns [] when unconfigured. */
export async function queryCalibrationEvents(
  opts: { sinceIso?: string; limit?: number } = {}
): Promise<CalibrationEvent[]> {
  const dsCalibrationEvents = process.env.DS_CALIBRATION_EVENTS;
  if (!dsCalibrationEvents) return [];
  const limit = Math.min(opts.limit ?? 50, 100);
  const pages = await queryDataSource(dsCalibrationEvents, {
    ...(opts.sinceIso
      ? { filter: { timestamp: "created_time", created_time: { on_or_after: opts.sinceIso } } }
      : {}),
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: limit,
  });
  return pages.slice(0, limit).map(pageToEvent);
}
