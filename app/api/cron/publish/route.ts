import { NextRequest, NextResponse } from "next/server";
import { runPublisher } from "@/lib/publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}` || req.headers.get("x-cron-secret") === secret;
}

async function run(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const result = await runPublisher();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Publisher cron failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Publisher failed" }, { status: 500 });
  }
}

// Vercel cron invokes with GET; keep POST for manual/webhook triggering.
export const GET = run;
export const POST = run;
