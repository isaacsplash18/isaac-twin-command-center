/**
 * GET /api/agent/state — one-call overview for an external agent (Agent API,
 * docs/AGENT-API.md). Bearer AGENT_API_TOKEN, NOT the session cookie
 * (self-authenticates; /api/agent/ is in middleware.ts PUBLIC_PREFIXES).
 *
 * Reuses the queue derivation (lib/queue.ts) and the export's publisher /
 * proposal counts. Read-only. Lanes degrade independently: a failing lane is
 * empty/zero plus an entry in `warnings`, never a 500 for the whole call.
 */

import { NextRequest } from "next/server";
import { agentJson, agentRoute, methodNotAllowed } from "@/lib/agent-api";
import { PLATFORMS, PUBLISHER_MODE } from "@/lib/config";
import { ContentItem } from "@/lib/items";
import { publishFailures24h } from "@/lib/kpis";
import { queryProposals } from "@/lib/proposals";
import { loadQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

function summary(i: ContentItem) {
  return {
    id: i.id,
    platform: i.platform,
    title: i.title,
    status: i.status,
    scheduledAt: i.scheduledAt,
    // No dedicated Posted At property exists; for Posted items this is the best
    // available proxy (the status flip is normally the last edit).
    updatedAt: i.lastEditedTime,
  };
}

export async function GET(req: NextRequest) {
  return agentRoute(req, "GET /api/agent/state", async () => {
    const warnings: string[] = [];
    if (!process.env.DS_PROPOSALS) warnings.push("DS_PROPOSALS not configured — proposals.pending is 0");

    const [queue, pendingProposals, failures24h] = await Promise.all([
      loadQueue({ draftLimit: 100 }),
      queryProposals({ status: "pending", limit: 100 }).catch((err) => {
        warnings.push(`pending proposals query failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }),
      publishFailures24h().catch((err) => {
        warnings.push(`publish failures query failed: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
      }),
    ]);
    if (queue.warning) warnings.push(queue.warning);

    return agentJson({
      generatedAt: new Date().toISOString(),
      drafts: queue.drafts.map((d) => ({
        id: d.id,
        platform: d.platform,
        title: d.title,
        body: d.body,
        createdAt: d.createdTime,
      })),
      lanes: {
        approved: queue.approved.map(summary),
        queued: queue.queued.map(summary),
        posted: queue.posted.map(summary),
        manual: queue.manual.map(summary),
        rejected: queue.rejected.map(summary),
      },
      publisher: {
        mode: PUBLISHER_MODE, // "typefully" | "buffer" | "manual"
        autoPlatforms: PLATFORMS.filter((p) => p.autoPublish).map((p) => p.key),
        failures24h,
      },
      proposals: { pending: pendingProposals.length },
      warnings,
    });
  });
}

export const POST = methodNotAllowed("GET");
export const PUT = methodNotAllowed("GET");
export const PATCH = methodNotAllowed("GET");
export const DELETE = methodNotAllowed("GET");
