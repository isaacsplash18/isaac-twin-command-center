import { NextRequest } from "next/server";
import { decideProposal } from "@/lib/actions";
import { handleAction } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/proposals/[id]/reject — flip Status pending → rejected.
 *
 * Status-flip only; touches nothing canonical. Re-reads before write and 409s
 * if the proposal has already moved on (same discipline as lib/actions.ts).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleAction(() => decideProposal(id, "rejected"));
}
