/**
 * PositionUpdateProposals (Phase 4 — docs/hermes-calibration-plan.md §4.2).
 *
 * A proposal is a *reviewable*, pending change to a canonical Position, derived
 * deterministically (no LLM) from a CalibrationEvent. Proposals never mutate the
 * Positions Library, the survey page, or the twin repo — creating one only appends
 * a log page; accepting one only flips a Status select. `accepted ≠ applied`:
 * applying a proposal to canonical identity stays a manual, human step in v1
 * (plan §8 rule 5).
 *
 * Persisted to a Notion data source (DS_PROPOSALS, created by `npm run migrate` —
 * never hand-created). Everything here is fire-and-forget safe on the generation
 * path: a proposal-write failure must never break the calibration action that
 * triggered it.
 */

import { CalibrationEvent } from "./calibration-events";
import {
  getDataSourceSchema,
  notionFetch,
  queryDataSource,
  readRichTextProp,
  readSelectProp,
  readTitle,
  richTextValue,
  titlePropertyName,
} from "./notion";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export type ProposalConfidence = "low" | "medium" | "high";
export type ProposalStatus = "pending" | "accepted" | "rejected" | "applied";

/**
 * Identity Calibration: which canonical surface an amendment targets. `position`
 * is the back-compat default — a row written before this field existed (no
 * Target Type) reads back as `position`. `unclassified` is the inbox lane for
 * signals we captured but haven't classified yet (e.g. a bare rejection reason).
 */
export type ProposalTargetType = "position" | "voice" | "constitution" | "workflow" | "unclassified";

export const PROPOSAL_TARGET_TYPES: ProposalTargetType[] = [
  "position",
  "voice",
  "constitution",
  "workflow",
  "unclassified",
];

export interface PositionUpdateProposal {
  id: string;
  /** Notion `created_time`. */
  createdAt: string;
  /** Notion `last_edited_time`. */
  updatedAt: string;
  sourceEventIds: string[];
  affectedPositionId: string;
  topic: string;
  currentPositionText: string;
  proposedPositionText: string;
  reason: string;
  evidenceSummary: string;
  confidence: ProposalConfidence;
  status: ProposalStatus;
  /** Canonical surface this amendment targets. Missing → "position" (back-compat). */
  targetType: ProposalTargetType;
  /** Platform key for workflow/voice amendments, free label otherwise. "" when absent. */
  targetRef: string;
  appliedUrl?: string;
  appliedAt?: string;
  appliedRevision?: string;
}

// Preserve long-form correction snapshots across rich-text chunks.
const MAX_FIELD = 60000;
function truncate(text: string | undefined): string {
  return (text ?? "").slice(0, MAX_FIELD);
}

function splitIds(raw: string): string[] {
  return raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function pageToProposal(page: Json): PositionUpdateProposal {
  return {
    id: page.id,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    sourceEventIds: splitIds(readRichTextProp(page, "Source Event IDs")),
    affectedPositionId: readRichTextProp(page, "Affected Position ID"),
    topic: readRichTextProp(page, "Topic"),
    currentPositionText: readRichTextProp(page, "Current Position Text"),
    proposedPositionText: readRichTextProp(page, "Proposed Position Text"),
    reason: readRichTextProp(page, "Reason"),
    evidenceSummary: readRichTextProp(page, "Evidence Summary"),
    confidence: (readSelectProp(page, "Confidence") as ProposalConfidence) ?? "low",
    status: (readSelectProp(page, "Status") as ProposalStatus) ?? "pending",
    // Missing Target Type = "position" (back-compat with pre-Identity-Calibration rows).
    targetType: (readSelectProp(page, "Target Type") as ProposalTargetType) ?? "position",
    targetRef: readRichTextProp(page, "Target Ref"),
    appliedUrl: page.properties?.["Applied URL"]?.url ?? "",
    appliedAt: page.properties?.["Applied At"]?.date?.start ?? "",
    appliedRevision: readRichTextProp(page, "Applied Revision"),
  };
}

// Matches the Notion "unknown property" validation error, so a proposals DB
// that hasn't had Target Type / Target Ref migrated on yet still gets a
// proposal written (without those two props) rather than the generation failing.
const TARGET_PROP_MISMATCH = /Target Type|Target Ref|is not a property that exists|property that does not exist|is not a valid property/i;

/** Fields for a single proposal page write, shared by both generators. */
interface ProposalDraft {
  sourceEventIds: string[];
  affectedPositionId: string;
  topic: string;
  currentPositionText: string;
  proposedPositionText: string;
  reason: string;
  evidenceSummary: string;
  confidence: ProposalConfidence;
  targetType: ProposalTargetType;
  targetRef: string;
  appliedUrl?: string;
  appliedAt?: string;
  appliedRevision?: string;
}

/**
 * Create one proposal page from a ProposalDraft. Writes Target Type / Target Ref
 * when the schema has them, and retries without them on a schema-mismatch (the
 * additive props may not be migrated yet — same defensive pattern as
 * lib/items.ts `createDraft`). Assumes DS_PROPOSALS is set (callers check).
 */
async function writeProposal(ds: string, d: ProposalDraft): Promise<PositionUpdateProposal> {
  const schema = await getDataSourceSchema(ds);
  const titleProp = titlePropertyName(schema);
  const name = (`${d.topic}`.trim() || d.targetRef || d.targetType).slice(0, 200);

  const baseProperties: Record<string, unknown> = {
    [titleProp]: { title: [{ type: "text", text: { content: name } }] },
    "Source Event IDs": richTextValue(truncate(d.sourceEventIds.join(","))),
    "Affected Position ID": richTextValue(truncate(d.affectedPositionId)),
    Topic: richTextValue(truncate(d.topic)),
    "Current Position Text": richTextValue(truncate(d.currentPositionText)),
    "Proposed Position Text": richTextValue(truncate(d.proposedPositionText)),
    Reason: richTextValue(truncate(d.reason)),
    "Evidence Summary": richTextValue(truncate(d.evidenceSummary)),
    Confidence: { select: { name: d.confidence } },
    Status: { select: { name: "pending" } },
  };
  const targetProperties: Record<string, unknown> = {
    "Target Type": { select: { name: d.targetType } },
    "Target Ref": richTextValue(truncate(d.targetRef)),
  };

  const create = (properties: Record<string, unknown>) =>
    notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: ds },
        properties,
      }),
    });

  try {
    return pageToProposal(await create({ ...baseProperties, ...targetProperties }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!TARGET_PROP_MISMATCH.test(message)) throw err;
    console.warn("Target Type / Target Ref not yet migrated — writing proposal without them (run npm run migrate)");
    return pageToProposal(await create(baseProperties));
  }
}

/**
 * Read the current canonical text of a Position, defensively. The Positions
 * Library title prop is "Position"; "Nuance"/"Basis" are optional rich_text
 * that may or may not exist. We never mutate the page — read only.
 */
async function readCurrentPositionText(positionPageId: string): Promise<{ title: string; text: string }> {
  const page = await notionFetch(`/pages/${positionPageId}`);
  const title = readTitle(page); // reads whichever prop is the title (Positions Library: "Position")
  const nuance = readRichTextProp(page, "Nuance");
  const basis = readRichTextProp(page, "Basis");
  const text = [title, nuance && `Nuance: ${nuance}`, basis && `Basis: ${basis}`]
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

/**
 * Deterministic v1 generator (no LLM). Turns a single CalibrationEvent into at
 * most one pending proposal:
 *
 *   - action "sharpen" + non-empty rawUserText + ≥1 affectedPositionId
 *       → proposal, confidence "medium"
 *   - action "reject"  + non-empty rawUserText + ≥1 affectedPositionId
 *       → proposal (position contested), confidence "low"
 *   - anything else (confirm/submit/later/approve/edit, no text, no position)
 *       → null. Never guess.
 *
 * Idempotency: if a `pending` proposal already exists for the same Affected
 * Position ID, returns null (v1 does not dedup/merge multiple events into one
 * proposal — see plan §9 limitations). Fire-and-forget safe: warns + returns
 * null when DS_PROPOSALS is unset, and never throws.
 */
export async function maybeCreateProposalFromEvent(
  event: CalibrationEvent | null
): Promise<PositionUpdateProposal | null> {
  if (!event) return null;

  // Gate 1: only sharpen / reject-verdict events qualify.
  const confidence: ProposalConfidence | null =
    event.action === "sharpen" ? "medium" : event.action === "reject" ? "low" : null;
  if (!confidence) return null;

  // Gate 2: need Isaac's own words AND a linked position — else no proposal.
  const rawUserText = (event.rawUserText ?? "").trim();
  const affectedPositionId = (event.affectedPositionIds ?? []).find(Boolean) ?? "";
  if (!rawUserText || !affectedPositionId) return null;

  const ds = process.env.DS_PROPOSALS;
  if (!ds) {
    console.warn("DS_PROPOSALS not set — skipping proposal generation for event", event.id);
    return null;
  }

  try {
    // Idempotency: skip if a pending proposal already exists for this position.
    const existing = await queryDataSource(
      ds,
      {
        filter: {
          and: [
            { property: "Affected Position ID", rich_text: { equals: affectedPositionId } },
            { property: "Status", select: { equals: "pending" } },
          ],
        },
        page_size: 1,
      },
      1
    );
    if (existing.length > 0) {
      console.warn(
        `Pending proposal already exists for position ${affectedPositionId} — not duplicating (v1: no merge).`
      );
      return null;
    }

    // Current canonical text snapshot (read-only).
    let currentPositionText = "";
    let positionTitle = "";
    try {
      const current = await readCurrentPositionText(affectedPositionId);
      currentPositionText = current.text;
      positionTitle = current.title;
    } catch (err) {
      // A missing/unreadable position must not block the proposal — record the
      // gap in the snapshot rather than inventing text.
      console.warn(`Could not read position ${affectedPositionId} for proposal:`, err);
      currentPositionText = `(could not read position ${affectedPositionId})`;
    }

    const reason =
      event.action === "sharpen"
        ? "Isaac's own words from a SHARPEN verdict on the weekly survey"
        : "REJECT verdict — position contested";

    const topic = event.topic || positionTitle || affectedPositionId;
    const evidenceSummary = `${event.action} · event ${event.id} · ${new Date(event.createdAt).toISOString()}`;

    return await writeProposal(ds, {
      sourceEventIds: [event.id],
      affectedPositionId,
      topic,
      currentPositionText,
      proposedPositionText: rawUserText,
      reason,
      evidenceSummary,
      confidence,
      // Survey-driven proposals target a canonical Position (back-compat default).
      targetType: "position",
      targetRef: "",
    });
  } catch (err) {
    console.warn("maybeCreateProposalFromEvent failed (non-fatal):", err);
    return null;
  }
}

/**
 * Identity Calibration: turn a *draft* CalibrationEvent (approve/reject/edit on
 * a draft card) into at most one pending amendment. Deterministic, never
 * invented, never auto-applied:
 *
 *   - draft "edit"  → voice amendment: targetRef = platform, proposedText = the
 *                     new body, evidence = before/after excerpt, confidence low.
 *   - draft "reject" WITH a non-empty reason → unclassified amendment: proposedText
 *                     = the reason verbatim, evidence = draft title + platform,
 *                     confidence low.
 *   - draft "reject" with NO reason → null (no signal — an honest boundary).
 *   - anything else (approve, non-draft object) → null.
 *
 * Idempotency: skip if a pending proposal already references this source event id
 * (query-before-create). Fire-and-forget safe: warns + returns null when
 * DS_PROPOSALS is unset, and never throws — a generation failure must never fail
 * the user's approve/reject/edit action.
 */
export async function maybeCreateAmendmentFromDraftEvent(
  event: CalibrationEvent | null
): Promise<PositionUpdateProposal | null> {
  if (!event || event.objectType !== "draft") return null;

  const platform = event.platform || "unknown";
  let targetType: ProposalTargetType;
  let proposedText: string;
  let evidenceSummary: string;
  let reason: string;

  if (event.action === "edit") {
    proposedText = (event.newText ?? "").trim();
    if (!proposedText) return null;
    targetType = "voice";
    reason = "auto-generated from a draft edit — classify/edit before accepting";
    const before = (event.previousText ?? "").slice(0, 400);
    const after = proposedText.slice(0, 400);
    evidenceSummary = `Draft edit on ${platform}\nBEFORE: ${before}\nAFTER: ${after}`;
  } else if (event.action === "reject") {
    proposedText = (event.rawUserText ?? "").trim();
    if (!proposedText) return null; // reject with no reason → no amendment
    targetType = "unclassified";
    reason = "auto-generated from a draft rejection reason — classify/edit before accepting";
    evidenceSummary = `Draft reject — ${event.topic || event.objectId} · ${platform}`;
  } else {
    return null;
  }

  const ds = process.env.DS_PROPOSALS;
  if (!ds) {
    console.warn("DS_PROPOSALS not set — skipping amendment generation for draft event", event.id);
    return null;
  }

  try {
    // Idempotency by source event id (each edit/reject gets a fresh event id).
    const existing = await queryDataSource(
      ds,
      {
        filter: {
          and: [
            { property: "Source Event IDs", rich_text: { contains: event.id } },
            { property: "Status", select: { equals: "pending" } },
          ],
        },
        page_size: 1,
      },
      1
    );
    if (existing.length > 0) {
      console.warn(`Pending amendment already exists for event ${event.id} — not duplicating.`);
      return null;
    }

    const trailer = `${event.action} · draft event ${event.id} · ${new Date(event.createdAt).toISOString()}`;
    return await writeProposal(ds, {
      sourceEventIds: [event.id],
      affectedPositionId: "",
      topic: event.topic || `${platform} draft`,
      currentPositionText: "",
      proposedPositionText: proposedText,
      reason,
      evidenceSummary: `${evidenceSummary}\n${trailer}`,
      confidence: "low",
      targetType,
      targetRef: platform,
    });
  } catch (err) {
    console.warn("maybeCreateAmendmentFromDraftEvent failed (non-fatal):", err);
    return null;
  }
}

/** Recent proposals, newest first. Returns [] when unconfigured. */
export async function queryProposals(
  opts: { status?: ProposalStatus; limit?: number } = {}
): Promise<PositionUpdateProposal[]> {
  const ds = process.env.DS_PROPOSALS;
  if (!ds) return [];
  const limit = Math.min(opts.limit ?? 50, 100);
  const pages = await queryDataSource(ds, {
    ...(opts.status ? { filter: { property: "Status", select: { equals: opts.status } } } : {}),
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: limit,
  });
  return pages.slice(0, limit).map(pageToProposal);
}

/** Read a single proposal (for the re-read-before-write guard in the routes). */
export async function getProposal(id: string): Promise<PositionUpdateProposal> {
  const page = await notionFetch(`/pages/${id}`);
  return pageToProposal(page);
}

/**
 * Flip a proposal's Status select — nothing else. Deliberately does NOT touch
 * the Positions Library, the survey page, or the twin repo (plan §8 rule 5:
 * accepted ≠ applied). Returns the updated proposal.
 */
export async function setProposalStatus(
  id: string,
  status: "accepted" | "rejected"
): Promise<PositionUpdateProposal> {
  const page = await notionFetch(`/pages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { Status: { select: { name: status } } } }),
  });
  return pageToProposal(page);
}

/**
 * Identity Calibration: edit an amendment's proposed text and/or reclassify it
 * (Target Type / Target Ref) before Isaac accepts it. Session-lane only, guarded
 * to `pending` by the route. Never touches canonical identity — this only edits
 * the reviewable amendment row itself. Returns the updated proposal.
 */
export async function updateProposal(
  id: string,
  fields: { proposedText?: string; targetType?: ProposalTargetType; targetRef?: string }
): Promise<PositionUpdateProposal> {
  const properties: Record<string, unknown> = {};
  if (fields.proposedText !== undefined) {
    properties["Proposed Position Text"] = richTextValue(truncate(fields.proposedText));
  }
  if (fields.targetType !== undefined) {
    properties["Target Type"] = { select: { name: fields.targetType } };
  }
  if (fields.targetRef !== undefined) {
    properties["Target Ref"] = richTextValue(truncate(fields.targetRef));
  }
  const page = await notionFetch(`/pages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  return pageToProposal(page);
}
