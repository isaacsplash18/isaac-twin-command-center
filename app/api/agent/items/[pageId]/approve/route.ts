/**
 * POST /api/agent/items/[pageId]/approve — Draft → Approved via lib/actions
 * approveItem, calibration source "agent". Agent API (docs/AGENT-API.md),
 * Bearer AGENT_API_TOKEN. Never publishes: an Approved item only becomes
 * Queued when the publisher cron (or an explicit /publish-next) picks it up.
 *
 * Replay-safe: a 409 (item already
 * moved off Draft) is `200 { noop: true, note: "already-decided", status }`.
 * Callers must read `status` to see what the item actually is.
 */

import { NextRequest } from "next/server";
import { approveItem } from "@/lib/actions";
import { agentRoute, assertNotionId, itemAction, methodNotAllowed } from "@/lib/agent-api";
import { RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: RouteParams) {
  return agentRoute(req, "POST /api/agent/items/[pageId]/approve", async () => {
    const id = assertNotionId((await params).pageId);
    return itemAction(id, "approve", async () => {
      const item = await approveItem(id, "agent");
      return { status: item.status, item };
    });
  });
}

export const GET = methodNotAllowed("POST");
export const PUT = methodNotAllowed("POST");
export const PATCH = methodNotAllowed("POST");
export const DELETE = methodNotAllowed("POST");
