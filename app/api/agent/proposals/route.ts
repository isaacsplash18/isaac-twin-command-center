/**
 * GET /api/agent/proposals?status=pending|accepted|rejected|applied&limit=<=100>
 * Agent API (docs/AGENT-API.md). Bearer AGENT_API_TOKEN. Read-only view of the
 * PositionUpdateProposals / amendments (lib/proposals.ts queryProposals).
 * Unlike the session lane, an unknown `status` is a 400, not silently ignored.
 */

import { NextRequest } from "next/server";
import { agentJson, agentRoute, methodNotAllowed } from "@/lib/agent-api";
import { ActionError } from "@/lib/actions";
import { ProposalStatus, queryProposals } from "@/lib/proposals";

export const dynamic = "force-dynamic";

const STATUSES: ProposalStatus[] = ["pending", "accepted", "rejected", "applied"];

export async function GET(req: NextRequest) {
  return agentRoute(req, "GET /api/agent/proposals", async () => {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    if (statusParam && !STATUSES.includes(statusParam as ProposalStatus)) {
      throw new ActionError(`status must be one of ${STATUSES.join(", ")}`, 400);
    }
    const limitParam = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 100) : 20;
    const proposals = await queryProposals({ status: (statusParam as ProposalStatus) || undefined, limit });
    return agentJson({ proposals });
  });
}

export const POST = methodNotAllowed("GET");
export const PUT = methodNotAllowed("GET");
export const PATCH = methodNotAllowed("GET");
export const DELETE = methodNotAllowed("GET");
