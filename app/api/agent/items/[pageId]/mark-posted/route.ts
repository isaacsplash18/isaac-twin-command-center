/**
 * POST /api/agent/items/[pageId]/mark-posted — Approved → Posted via lib/actions
 * markPostedItem (the manual lane: someone posted it by hand, e.g. IG). Agent
 * API, Bearer AGENT_API_TOKEN. Does not post anything anywhere itself.
 *
 * Replay-safe: re-POSTing for an item that is already Posted is
 * `200 { noop: true, note: "already-posted" }`; any other non-Approved status
 * is a real 409 (a Draft cannot be marked posted).
 */

import { NextRequest } from "next/server";
import { markPostedItem } from "@/lib/actions";
import { agentRoute, assertNotionId, itemAction, methodNotAllowed } from "@/lib/agent-api";
import { RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: RouteParams) {
  return agentRoute(req, "POST /api/agent/items/[pageId]/mark-posted", async () => {
    const id = assertNotionId((await params).pageId);
    return itemAction(
      id,
      "mark-posted",
      async () => {
        await markPostedItem(id);
        return { status: "Posted" };
      },
      { isReplay: (s) => s === "Posted", note: () => "already-posted" }
    );
  });
}

export const GET = methodNotAllowed("POST");
export const PUT = methodNotAllowed("POST");
export const PATCH = methodNotAllowed("POST");
export const DELETE = methodNotAllowed("POST");
