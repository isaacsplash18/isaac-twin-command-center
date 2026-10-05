/**
 * POST /api/agent/proposals/[id]/reject — flip Status pending → rejected via the
 * shared decideProposal guard (lib/actions.ts). Agent API, Bearer AGENT_API_TOKEN.
 *
 * Status flip only: `accepted` NEVER applies an amendment to the Positions
 * Library / voice / constitution (plan §8 rule 5) — that stays a human step.
 * Replay-safe: re-POSTing when the proposal is already rejected is
 * `200 { noop: true }`; a proposal in any other non-pending status is a 409.
 */

import { NextRequest } from "next/server";
import { ActionError, decideProposal } from "@/lib/actions";
import { agentJson, agentRoute, assertNotionId, methodNotAllowed } from "@/lib/agent-api";
import { getProposal } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return agentRoute(req, "POST /api/agent/proposals/[id]/reject", async () => {
    const id = assertNotionId((await params).id, "id");
    try {
      const proposal = await decideProposal(id, "rejected");
      return agentJson({ ok: true, id, action: "reject", status: proposal.status, noop: false, proposal });
    } catch (err) {
      if (err instanceof ActionError && err.status === 409) {
        const current = await getProposal(id).catch(() => null);
        if (current?.status === "rejected") {
          return agentJson({ ok: true, id, action: "reject", status: current.status, noop: true, note: "already-rejected", proposal: current });
        }
      }
      throw err;
    }
  });
}

export const GET = methodNotAllowed("POST");
export const PUT = methodNotAllowed("POST");
export const PATCH = methodNotAllowed("POST");
export const DELETE = methodNotAllowed("POST");
