import { NextRequest, NextResponse } from "next/server";
import { computeKpis } from "@/lib/kpis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const windowDays = req.nextUrl.searchParams.get("window") === "28" ? 28 : 7;
  try {
    return NextResponse.json(await computeKpis(windowDays));
  } catch (err) {
    console.error("GET /api/kpis failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "KPI fetch failed" }, { status: 500 });
  }
}
