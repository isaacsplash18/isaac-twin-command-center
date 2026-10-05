/**
 * POST /api/agent/items/[pageId]/edit — `{ text }` replaces the Draft body via
 * lib/actions editItem, calibration source "agent" (the edit becomes a pending
 * voice amendment; never auto-applied). The item STAYS a Draft — approve it
 * separately. Agent API, Bearer AGENT_API_TOKEN.
 *
 * Not converted to a no-op on 409: if the item is no longer a Draft the edit
 * did NOT apply, so the 409 passes through. Re-sending the same text while the
 * item is still a Draft is harmless.
 */

import { NextRequest } from "next/server";
import { ActionError, editItem } from "@/lib/actions";
import { agentJson, agentRoute, assertNotionId, methodNotAllowed, readJsonBody } from "@/lib/agent-api";
import { RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: RouteParams) {
  return agentRoute(req, "POST /api/agent/items/[pageId]/edit", async () => {
    const id = assertNotionId((await params).pageId);
    const body = await readJsonBody(req, true);
    if (typeof body.text !== "string") throw new ActionError("Body must be JSON: { text: string }", 400);
    const result = await editItem(id, body.text, "agent");
    return agentJson({ ok: true, id, action: "edit", status: "Draft", noop: false, body: result.body });
  });
}

export const GET = methodNotAllowed("POST");
export const PUT = methodNotAllowed("POST");
export const PATCH = methodNotAllowed("POST");
export const DELETE = methodNotAllowed("POST");
