import { NextRequest } from "next/server";
import { decideProposal } from "@/lib/actions";
import { handleAction } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/proposals/[id]/accept — flip Status pending → accepted.
 *
 * accepted ≠ applied (plan §8 rule 5): this only marks the proposal; it never
 * mutates the Positions Library, the survey page, or the twin repo. Re-reads
 * before write and 409s if the proposal has already moved on (same discipline
 * as lib/actions.ts).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleAction(() => decideProposal(id, "accepted"));
}
