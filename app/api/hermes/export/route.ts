/**
 * GET /api/hermes/export — Hermes-readable calibration export (Phase 5 —
 * docs/hermes-calibration-plan.md §4.3). Machine lane only: authenticated via
 * `Authorization: Bearer ${HERMES_API_TOKEN}` (lib/machine-auth.ts), NOT the
 * human session cookie. Self-authenticates — see the middleware public-list
 * comment for why this path is exempt from the session check.
 *
 * Response shape is documented in docs/hermes-integration.md and considered
 * stable; a breaking change bumps `version`. No secrets are ever included —
 * `publisher.mode` is derived from whether TYPEFULLY_API_KEY is set, the key
 * itself is never returned.
 *
 * Degrades gracefully: any unconfigured lane (DS_CALIBRATION_EVENTS,
 * DS_PROPOSALS, or a content platform's DS env var) returns an empty
 * array/zero count for that lane plus an entry in `warnings`, rather than
 * failing the whole export.
 */

import { NextRequest, NextResponse } from "next/server";
import { isMachineAuthorized } from "@/lib/machine-auth";
import { queryCalibrationEvents } from "@/lib/calibration-events";
import { queryProposals } from "@/lib/proposals";
import { PLATFORMS, TYPEFULLY_ENABLED } from "@/lib/config";
import { itemsWithStatus } from "@/lib/items";
import { queryEvents, readSelectProp } from "@/lib/notion";

export const dynamic = "force-dynamic";

const EXPORT_VERSION = 1;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function resolveSince(param: string | null): string {
  if (param) {
    const parsed = Date.parse(param);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
}

function resolveLimit(param: string | null): number {
  const n = param ? Number(param) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), MAX_LIMIT);
  return DEFAULT_LIMIT;
}

export async function GET(req: NextRequest) {
  if (!isMachineAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const since = resolveSince(url.searchParams.get("since"));
    const limit = resolveLimit(url.searchParams.get("limit"));

    const warnings: string[] = [];
    if (!process.env.DS_CALIBRATION_EVENTS) {
      warnings.push("DS_CALIBRATION_EVENTS not configured — events[] is empty");
    }
    if (!process.env.DS_PROPOSALS) {
      warnings.push("DS_PROPOSALS not configured — proposals.pending/accepted are empty");
    }

    // Each lane degrades independently: a transient Notion error on a
    // *configured* lane returns an empty result + a warning rather than 500ing
    // the whole export (the documented "degrades gracefully" contract).
    const [events, pending, accepted, pipelineEvents24h] = await Promise.all([
      queryCalibrationEvents({ sinceIso: since, limit }).catch((err) => {
        warnings.push(`calibration events query failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }),
      queryProposals({ status: "pending", limit: 100 }).catch((err) => {
        warnings.push(`pending proposals query failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }),
      queryProposals({ status: "accepted", limit: 100 }).catch((err) => {
        warnings.push(`accepted proposals query failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }),
      // Publish failures in the last 24h, from the Pipeline Events KPI log
      // (Phase 10 — same source as the dashboard's failure banner).
      queryEvents(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).catch(() => []),
    ]);
    const failures24h = pipelineEvents24h.filter((e) => readSelectProp(e, "Event") === "Publish-failed").length;

    // drafts.pendingReview: count of Status=Draft across the 4 content DBs.
    // Each platform lane degrades independently — an unconfigured or
    // not-yet-migrated DS never fails the whole export.
    let pendingReview = 0;
    await Promise.all(
      PLATFORMS.map(async (p) => {
        if (!process.env[p.dsEnv]) {
          warnings.push(`${p.dsEnv} not configured — ${p.label} excluded from drafts.pendingReview`);
          return;
        }
        try {
          const drafts = await itemsWithStatus(p, "Draft", { limit: 100 });
          pendingReview += drafts.length;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Missing select option = schema not migrated yet; not a hard failure.
          if (!message.includes("not found for property")) {
            warnings.push(`${p.label} draft count failed: ${message}`);
          }
        }
      })
    );

    return NextResponse.json({
      version: EXPORT_VERSION,
      generatedAt: new Date().toISOString(),
      since,
      events,
      proposals: { pending, accepted },
      drafts: { pendingReview },
      publisher: { mode: TYPEFULLY_ENABLED ? "typefully" : "manual", failures24h },
      warnings,
    });
  } catch (err) {
    console.error("GET /api/hermes/export failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Hermes export failed" },
      { status: 500 }
    );
  }
}
