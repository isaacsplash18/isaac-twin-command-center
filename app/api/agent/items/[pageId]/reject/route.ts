/**
 * POST /api/agent/items/[pageId]/reject — Draft → Rejected via lib/actions
 * rejectItem, calibration source "agent". Optional JSON body `{ reason? }`: a
 * reason lands on the CalibrationEvent and (Identity Calibration) becomes a
 * pending, never-auto-applied amendment. Agent API, Bearer AGENT_API_TOKEN.
 *
 * Replay-safe: a 409 (already moved off Draft) is
 * `200 { noop: true, note: "already-decided", status }`.
 */

import { NextRequest } from "next/server";
import { rejectItem } from "@/lib/actions";
import { agentRoute, assertNotionId, itemAction, methodNotAllowed, readJsonBody } from "@/lib/agent-api";
import { RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: RouteParams) {
  return agentRoute(req, "POST /api/agent/items/[pageId]/reject", async () => {
    const id = assertNotionId((await params).pageId);
    const body = await readJsonBody(req, false);
    const reason = typeof body.reason === "string" ? body.reason.trim() || undefined : undefined;
    return itemAction(id, "reject", async () => {
      await rejectItem(id, "agent", reason);
      return { status: "Rejected" };
    });
  });
}

export const GET = methodNotAllowed("POST");
export const PUT = methodNotAllowed("POST");
export const PATCH = methodNotAllowed("POST");
export const DELETE = methodNotAllowed("POST");
