/**
 * POST /api/agent/items/[pageId]/publish-next — push ONE already-Approved item
 * into the next free Typefully slot now (lib/publisher.ts publishOne). Agent
 * API, Bearer AGENT_API_TOKEN. Only Approved items qualify — a Draft is a 409,
 * so nothing can publish without a prior explicit approve. IG items are posted
 * manually (400).
 *
 * Replay-safe: if the item is already Queued/Posted (a duplicate request, or
 * the cron got there first) the 409 becomes `200 { noop: true }`, and no second
 * Typefully draft is ever created (publishOne re-reads status + Typefully ID).
 */

import { NextRequest } from "next/server";
import { agentRoute, assertNotionId, itemAction, methodNotAllowed } from "@/lib/agent-api";
import { publishOne } from "@/lib/publisher";
import { RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: RouteParams) {
  return agentRoute(req, "POST /api/agent/items/[pageId]/publish-next", async () => {
    const id = assertNotionId((await params).pageId);
    return itemAction(
      id,
      "publish-next",
      async () => {
        const { slot, typefullyId } = await publishOne(id);
        return { status: "Queued", slot, typefullyId };
      },
      {
        isReplay: (s) => s === "Queued" || s === "Posted",
        note: (s) => (s === "Posted" ? "already-posted" : "already-queued"),
      }
    );
  });
}

export const GET = methodNotAllowed("POST");
export const PUT = methodNotAllowed("POST");
export const PATCH = methodNotAllowed("POST");
export const DELETE = methodNotAllowed("POST");
