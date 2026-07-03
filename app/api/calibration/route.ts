import { NextResponse } from "next/server";
import { readSurvey } from "@/lib/calibration";

export const dynamic = "force-dynamic";

/** GET /api/calibration — this week's Weekly Positions Survey questions. */
export async function GET() {
  try {
    return NextResponse.json(await readSurvey());
  } catch (err) {
    console.error("GET /api/calibration failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Calibration fetch failed" },
      { status: 500 }
    );
  }
}
