import { NextRequest } from "next/server";
import { rejectItem } from "@/lib/actions";
import { handleAction, RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/items/[pageId]/reject — optional JSON body { reason?: string }.
 * A reason (from the inline reason row in the approval queue) is passed through
 * to rejectItem, which records it on the CalibrationEvent and — via Identity
 * Calibration — turns it into a pending unclassified amendment. No body (the
 * SKIP path, or the command palette) still rejects, without a reason.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { pageId } = await params;
  return handleAction(async () => {
    let reason: string | undefined;
    try {
      const body = await req.json();
      const raw = typeof body?.reason === "string" ? body.reason.trim() : "";
      reason = raw || undefined;
    } catch {
      // No/invalid body → reject without a reason (backward compatible).
    }
    return rejectItem(pageId, "command_center", reason);
  });
}
