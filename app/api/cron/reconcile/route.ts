import { NextRequest, NextResponse } from "next/server";
import { runReconciler } from "@/lib/publisher";
import { timingSafeEqualStr } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return (
    timingSafeEqualStr(auth, `Bearer ${secret}`) ||
    timingSafeEqualStr(req.headers.get("x-cron-secret") ?? "", secret)
  );
}

async function run(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const result = await runReconciler();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Reconciler cron failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Reconciler failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
