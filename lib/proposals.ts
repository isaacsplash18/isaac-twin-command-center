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
}

// Same 1900-char snapshot bound as calibration events / lib/calibration.ts.
const MAX_FIELD = 1900;
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
  };
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
    const name = `${topic}`.slice(0, 200) || affectedPositionId;

    const schema = await getDataSourceSchema(ds);
    const titleProp = titlePropertyName(schema);

    const page = await notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: ds },
        properties: {
          [titleProp]: { title: [{ type: "text", text: { content: name } }] },
          "Source Event IDs": richTextValue(truncate(event.id)),
          "Affected Position ID": richTextValue(truncate(affectedPositionId)),
          Topic: richTextValue(truncate(topic)),
          "Current Position Text": richTextValue(truncate(currentPositionText)),
          "Proposed Position Text": richTextValue(truncate(rawUserText)),
          Reason: richTextValue(truncate(reason)),
          "Evidence Summary": richTextValue(truncate(evidenceSummary)),
          Confidence: { select: { name: confidence } },
          Status: { select: { name: "pending" } },
        },
      }),
    });

    return pageToProposal(page);
  } catch (err) {
    console.warn("maybeCreateProposalFromEvent failed (non-fatal):", err);
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
