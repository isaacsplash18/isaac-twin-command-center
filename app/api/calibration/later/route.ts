import { NextRequest } from "next/server";
import { ActionError } from "@/lib/actions";
import { logCalibrationEvent } from "@/lib/calibration-events";
import { handleAction } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/calibration/later
 * body: { objectId, topic? }
 *
 * Fired when Isaac taps LATER on a calibration question in NovaStage — no
 * survey/page mutation, just an inspectable "deferred" signal so the pattern
 * (which questions keep getting skipped) is visible later.
 */
export async function POST(req: NextRequest) {
  return handleAction(async () => {
    const body = await req.json().catch(() => ({}));
    const objectId = String(body?.objectId ?? "");
    const topic = body?.topic ? String(body.topic) : undefined;
    if (!objectId) throw new ActionError("objectId required", 400);

    await logCalibrationEvent({
      action: "later",
      objectType: "calibration_card",
      objectId,
      topic,
      status: "pending",
    });
    return { ok: true };
  });
}
