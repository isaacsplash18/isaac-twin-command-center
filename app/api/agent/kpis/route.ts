/**
 * GET /api/agent/kpis?window=7|28 — the same KPI payload the dashboard uses
 * (lib/kpis.ts computeKpis), wrapped with `version`. Bearer AGENT_API_TOKEN.
 * Anything but `28` ⇒ 7, like /api/kpis.
 */

import { NextRequest } from "next/server";
import { agentJson, agentRoute, methodNotAllowed } from "@/lib/agent-api";
import { computeKpis } from "@/lib/kpis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return agentRoute(req, "GET /api/agent/kpis", async () => {
    const windowDays = req.nextUrl.searchParams.get("window") === "28" ? 28 : 7;
    return agentJson({ ...(await computeKpis(windowDays)) });
  });
}

export const POST = methodNotAllowed("GET");
export const PUT = methodNotAllowed("GET");
export const PATCH = methodNotAllowed("GET");
export const DELETE = methodNotAllowed("GET");
