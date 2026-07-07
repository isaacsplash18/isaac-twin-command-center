import { NextRequest } from "next/server";
import { ActionError } from "@/lib/actions";
import {
  PROPOSAL_TARGET_TYPES,
  ProposalTargetType,
  getProposal,
  updateProposal,
} from "@/lib/proposals";
import { handleAction } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/proposals/[id] — session lane. Edit an amendment before accepting:
 * body { proposedText?, targetType?, targetRef? }. Only while status is
 * `pending` (409 otherwise, same discipline as accept/reject). This edits the
 * reviewable amendment row itself — it never touches canonical identity.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleAction(async () => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      throw new ActionError("Body must be JSON: { proposedText?, targetType?, targetRef? }", 400);
    }

    const fields: { proposedText?: string; targetType?: ProposalTargetType; targetRef?: string } = {};
    if (body.proposedText !== undefined) {
      if (typeof body.proposedText !== "string") throw new ActionError("proposedText must be a string", 400);
      fields.proposedText = body.proposedText;
    }
    if (body.targetType !== undefined) {
      if (!PROPOSAL_TARGET_TYPES.includes(body.targetType as ProposalTargetType)) {
        throw new ActionError(`targetType must be one of: ${PROPOSAL_TARGET_TYPES.join(", ")}`, 400);
      }
      fields.targetType = body.targetType as ProposalTargetType;
    }
    if (body.targetRef !== undefined) {
      if (typeof body.targetRef !== "string") throw new ActionError("targetRef must be a string", 400);
      fields.targetRef = body.targetRef;
    }
    if (Object.keys(fields).length === 0) {
      throw new ActionError("Nothing to update — provide proposedText, targetType, or targetRef", 400);
    }

    const current = await getProposal(id);
    if (current.status !== "pending") {
      throw new ActionError(`Cannot edit a proposal with status "${current.status}"`, 409);
    }
    return updateProposal(id, fields);
  });
}
