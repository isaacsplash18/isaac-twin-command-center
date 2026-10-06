/**
 * /api/agent/drafts — Agent API (docs/AGENT-API.md). Bearer AGENT_API_TOKEN.
 *
 * GET  — pending-review drafts (Status=Draft) with full bodies, newest first.
 * POST — create a draft using shared lib/items.ts validation. Always lands
 *        as Status=Draft, NEVER publishes. Provenance `createdBy` is forced to
 *        "agent" on this lane regardless of the body.
 */

import { NextRequest } from "next/server";
import { agentJson, agentRoute, methodNotAllowed, readJsonBody } from "@/lib/agent-api";
import { createDraft, listPendingDrafts, parseDraftInput } from "@/lib/items";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return agentRoute(req, "GET /api/agent/drafts", async () => {
    const { drafts, warnings } = await listPendingDrafts();
    return agentJson({
      drafts: drafts.map(({ pageId, ...rest }) => ({ id: pageId, ...rest })),
      warnings,
    });
  });
}

export async function POST(req: NextRequest) {
  return agentRoute(req, "POST /api/agent/drafts", async () => {
    const body = await readJsonBody(req, true);
    const result = await createDraft({ ...parseDraftInput(body), createdBy: "agent" });
    return agentJson({ ...result }, 201);
  });
}

export const PUT = methodNotAllowed("GET, POST");
export const PATCH = methodNotAllowed("GET, POST");
export const DELETE = methodNotAllowed("GET, POST");
