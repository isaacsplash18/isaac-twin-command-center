import { NextRequest, NextResponse } from "next/server";
import { ProposalStatus, queryProposals } from "@/lib/proposals";

export const dynamic = "force-dynamic";

const STATUSES: ProposalStatus[] = ["pending", "accepted", "rejected", "applied"];

/**
 * GET /api/proposals?status=pending&limit=20
 * Inspection surface for PositionUpdateProposals (Phase 4). Session-authed by
 * middleware like every other /api/* route — no allowlist change needed.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const status = statusParam && STATUSES.includes(statusParam as ProposalStatus)
      ? (statusParam as ProposalStatus)
      : undefined;
    const limitParam = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;
    const proposals = await queryProposals({ status, limit });
    return NextResponse.json({ proposals });
  } catch (err) {
    console.error("GET /api/proposals failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proposals fetch failed" },
      { status: 500 }
    );
  }
}
