import { NextRequest, NextResponse } from "next/server";
import { queryCalibrationEvents } from "@/lib/calibration-events";

export const dynamic = "force-dynamic";

/**
 * GET /api/calibration-events?limit=50&since=ISO
 * Inspection surface for CalibrationEvents (Phase 3). Session-authed by
 * middleware like every other /api/* route — no allowlist change needed.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;
    const since = searchParams.get("since") ?? undefined;
    const events = await queryCalibrationEvents({ sinceIso: since, limit });
    return NextResponse.json({ events });
  } catch (err) {
    console.error("GET /api/calibration-events failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Calibration events fetch failed" },
      { status: 500 }
    );
  }
}
